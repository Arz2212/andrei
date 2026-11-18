import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  archiveHabit,
  createTask,
  deleteGoal,
  deleteHabit,
  findGoalByQueryOrId,
  findHabitByQueryOrId,
  formatIsoDate,
  getGoalWithDetails,
  getLifeAnalyticsSummary,
  getOwnerBotDbClient,
  linkTaskToGoal,
  listGoalsWithDetails,
  listHabitsWithStats,
  manageGoalMilestone,
  setGoalStatus,
  toggleHabitCheckin,
  updateGoalNumericValue,
  upsertGoal,
  upsertHabit,
  type DaySlot,
  type GoalLifeArea,
  type GoalMilestoneDraftInput,
  type GoalProgressMode,
  type GoalStatus,
  type GoalWithDetails,
  type HabitCadence,
  type HabitPreferredSlot,
  type HabitWithStats,
  type RecordSource,
} from "@life-os/db";
import {
  DEFAULT_TIMEZONE,
  errResult,
  formatTaskForMcp,
  normalizePriority,
  okResult,
  resolveDateInput,
  resolveTaskTarget,
} from "../helpers";

const MilestoneInputItemSchema = z.union([
  z.string().min(1).max(300),
  z.object({
    id: z.number().int().positive().optional(),
    title: z.string().min(1).max(300).describe("Название этапа / вехи цели"),
    due_date: z
      .string()
      .nullable()
      .optional()
      .describe("Контрольная дата вехи YYYY-MM-DD или today/+14d"),
    is_completed: z.boolean().optional().describe("Выполнена ли веха"),
    sort_order: z.number().int().optional(),
  }),
]);

function formatGoalForMcp(goal: GoalWithDetails) {
  return {
    id: goal.id,
    title: goal.title,
    life_area: goal.life_area,
    status: goal.status,
    motivation_note: goal.motivation_note,
    progress_mode: goal.progress_mode,
    start_value: Number(goal.start_value ?? 0),
    current_value: Number(goal.current_value ?? 0),
    target_value: goal.target_value !== null ? Number(goal.target_value) : null,
    unit: goal.unit,
    start_date: goal.start_date,
    target_date: goal.target_date,
    progress: {
      progress_pct: goal.progress.progressPct,
      progressPct: goal.progress.progressPct,
      done_count: goal.progress.doneCount,
      total_count: goal.progress.totalCount,
      start_value: goal.progress.startValue,
      current_value: goal.progress.currentValue,
      target_value: goal.progress.targetValue,
      unit: goal.progress.unit,
      is_decreasing_numeric: goal.progress.isDecreasingNumeric,
      is_stalled: goal.progress.isStalled,
      isStalled: goal.progress.isStalled,
      stalled_reason: goal.progress.stalledReason,
      next_actions: goal.progress.nextActions.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        planned_date: t.planned_date,
        day_slot: t.day_slot,
        priority: t.priority,
      })),
      open_milestones: goal.progress.openMilestones,
    },
    milestones: goal.milestones,
    linked_tasks: goal.linkedTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      planned_date: t.planned_date,
      due_date: t.due_date,
      day_slot: t.day_slot,
      priority: t.priority,
    })),
    linked_projects: goal.linkedProjects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
    })),
    linked_habits: goal.linkedHabits.map((h) => ({
      id: h.id,
      title: h.title,
      cadence: h.cadence,
      target_per_week: h.target_per_week,
    })),
  };
}

function formatHabitForMcp(habit: HabitWithStats) {
  return {
    id: habit.id,
    title: habit.title,
    description: habit.description,
    icon_name: habit.icon_name,
    color_token: habit.color_token,
    goal_id: habit.goal_id,
    goal_title: habit.goalTitle,
    goalTitle: habit.goalTitle,
    cadence: habit.cadence,
    target_per_week: habit.target_per_week,
    preferred_slot: habit.preferred_slot,
    reminder_time: habit.reminder_time ? habit.reminder_time.slice(0, 5) : null,
    is_archived: habit.is_archived,
    completed_on_date: habit.completedOnAnchorDate,
    completedOnAnchorDate: habit.completedOnAnchorDate,
    anchorDateNote: habit.anchorDateNote,
    current_streak: habit.currentStreak,
    currentStreak: habit.currentStreak,
    best_streak: habit.bestStreak,
    bestStreak: habit.bestStreak,
    this_week_done: habit.thisWeekDone,
    thisWeekDone: habit.thisWeekDone,
    this_week_target: habit.thisWeekTarget,
    thisWeekTarget: habit.thisWeekTarget,
    adherence_30d_pct: habit.adherence30dPct,
    adherence30dPct: habit.adherence30dPct,
    history: habit.history,
  };
}

function normalizeReminderClockTime(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw.trim() === "") return null;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?$/.exec(raw.trim());
  if (!match) {
    throw new Error(
      `Некорректный формат времени напоминания "${raw}". Используй ЧЧ:ММ по МСК (например, 09:00 или 21:15).`
    );
  }
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function registerGoalsAndHabitsTools(server: McpServer): void {
  // ==========================================================================
  // 1. GOALS & 1-TAP HABITS OVERVIEW (`get_goals_and_habits`)
  // ==========================================================================

  server.registerTool(
    "get_goals_and_habits",
    {
      title: "Полная сводка целей, вех, конкретных шагов и привычек (со стриками и стабильностью)",
      description:
        "Возвращает развёрнутый срез целей (`listGoalsWithDetails`: расчётный `%`, режим `tasks_linked | numeric | milestones`, значения `start_value -> current_value / target_value`, этапы `milestones`, привязанные задачи, признак пробуксовки `isStalled`) и трекеров привычек (`listHabitsWithStats`: отметка за день, текущий и лучший стрик, выполнение за неделю `thisWeekDone/thisWeekTarget`, стабильность за 30 дней и 21-дневная матрица истории).",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("Дата проверки привычек YYYY-MM-DD или today/yesterday (по умолчанию сегодня по МСК)"),
        anchor_date: z
          .string()
          .optional()
          .describe("Алиас для date (YYYY-MM-DD или today/yesterday)"),
        status: z
          .enum(["active", "paused", "achieved", "dropped", "all"])
          .optional()
          .describe("Фильтр целей по статусу (по умолчанию 'active'; передай 'all' для всех статусов)"),
        life_area: z
          .enum(["work", "study", "launch", "personal", "health", "finance"])
          .optional()
          .describe("Фильтр целей по сфере жизни"),
        include_archived_habits: z
          .boolean()
          .optional()
          .describe("Включить ли архивные привычки (по умолчанию false)"),
        history_days: z
          .number()
          .int()
          .min(7)
          .max(90)
          .optional()
          .describe("Глубина истории ячеек привычек в днях (по умолчанию 21)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const dateStr =
          resolveDateInput(args.date ?? args.anchor_date) ??
          formatIsoDate(new Date(), DEFAULT_TIMEZONE);

        const [goals, habits] = await Promise.all([
          listGoalsWithDetails(db, {
            status: (args.status ?? "active") as GoalStatus | "all",
            lifeArea: args.life_area,
          }),
          listHabitsWithStats(db, dateStr, args.history_days ?? 21, {
            includeArchived: Boolean(args.include_archived_habits),
            timeZone: DEFAULT_TIMEZONE,
          }),
        ]);

        const activeHabits = habits.filter((h) => !h.is_archived);
        const doneHabitsCount = activeHabits.filter((h) => h.completedOnAnchorDate).length;
        const activeGoals = goals.filter((g) => g.status === "active");
        const stalledGoals = activeGoals.filter((g) => g.progress.isStalled);

        return okResult({
          ok: true,
          date: dateStr,
          goals_summary: {
            returned_count: goals.length,
            active_count: activeGoals.length,
            avg_progress_pct:
              activeGoals.length > 0
                ? Math.round(
                    activeGoals.reduce((s, g) => s + g.progress.progressPct, 0) /
                      activeGoals.length
                  )
                : 0,
            stalled_count: stalledGoals.length,
            stalled_goal_titles: stalledGoals.map((g) => g.title),
          },
          goals: goals.map(formatGoalForMcp),
          habits_summary: {
            today_done: doneHabitsCount,
            today_total: activeHabits.length,
            completion_pct:
              activeHabits.length > 0
                ? Math.round((doneHabitsCount / activeHabits.length) * 100)
                : 0,
            top_streak: activeHabits.reduce((mx, h) => Math.max(mx, h.currentStreak), 0),
          },
          habits: habits.map(formatHabitForMcp),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 2. GOAL LIFECYCLE & NUMERIC PROGRESS (`manage_goal`)
  // ==========================================================================

  server.registerTool(
    "manage_goal",
    {
      title: "Управление целями (создание, изменение, сдвиг числового прогресса, пауза, достижение, удаление)",
      description:
        "Полное управление целями по всем 3 режимам прогресса (`tasks_linked`, `numeric`, `milestones`) без знания внутренних ID (`list | get | create | update | update_progress | pause | achieve | drop | resume | delete`). Корректно считает как растущие числовые цели (`0 -> 300 000 ₽`), так и убывающие (`84 -> 79 кг`).",
      inputSchema: {
        action: z
          .enum([
            "list",
            "get",
            "create",
            "update",
            "update_progress",
            "pause",
            "achieve",
            "drop",
            "resume",
            "delete",
          ])
          .describe(
            "Действие: list, get, create, update, update_progress, pause, achieve, drop, resume, delete"
          ),
        goal_id: z.number().int().positive().optional().describe("Точный ID цели, если известен"),
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткий поиск цели по названию или сфере (не требует знания ID!)"),
        life_area: z
          .enum(["work", "study", "launch", "personal", "health", "finance"])
          .optional()
          .describe("Сфера жизни: work, study, launch, personal, health, finance"),
        title: z.string().max(300).optional().describe("Название цели"),
        motivation_note: z
          .string()
          .max(2000)
          .nullable()
          .optional()
          .describe("Мотивационная заметка «Зачем мне это»"),
        progress_mode: z
          .enum(["tasks_linked", "numeric", "milestones"])
          .optional()
          .describe(
            "Режим расчёта прогресса: tasks_linked (по связанным задачам), numeric (числовая метрика), milestones (по этапам/вехам)"
          ),
        start_value: z
          .number()
          .optional()
          .describe("Стартовое значение для numeric-цели (например, 0 для накоплений или 84 для снижения веса с 84 до 79 кг)"),
        current_value: z
          .number()
          .optional()
          .describe("Текущее числовое значение для numeric-цели (или точное новое значение в update_progress)"),
        target_value: z
          .number()
          .nullable()
          .optional()
          .describe("Целевое числовое значение (например, 300000 или 79)"),
        delta: z
          .number()
          .optional()
          .describe("Изменение текущего значения со знаком для update_progress (например, +15000 или -0.5)"),
        unit: z
          .string()
          .max(40)
          .nullable()
          .optional()
          .describe("Единица измерения (например, '₽', 'кг', 'книг', 'клиентов')"),
        auto_mark_achieved: z
          .boolean()
          .optional()
          .describe("Автоматически перевести цель в статус 'achieved' при достижении 100% в update_progress"),
        start_date: z.string().optional().describe("Дата старта YYYY-MM-DD или today"),
        target_date: z
          .string()
          .nullable()
          .optional()
          .describe("Целевой срок YYYY-MM-DD (null чтобы очистить)"),
        status: z
          .enum(["active", "paused", "achieved", "dropped", "all"])
          .optional()
          .describe("Статус цели (для фильтрации list или явной смены при update)"),
        milestones: z
          .array(MilestoneInputItemSchema)
          .optional()
          .describe("Начальный или обновлённый список вех (этапов) цели"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const goals = await listGoalsWithDetails(db, {
            status: (args.status ?? "all") as GoalStatus | "all",
            lifeArea: args.life_area,
          });
          return okResult({
            ok: true,
            count: goals.length,
            goals: goals.map(formatGoalForMcp),
          });
        }

        const normalizeMilestoneDrafts = (
          raw?: Array<z.infer<typeof MilestoneInputItemSchema>>
        ): GoalMilestoneDraftInput[] | undefined => {
          if (raw === undefined) return undefined;
          return raw.map((item, idx) => {
            if (typeof item === "string") {
              return {
                title: item.trim(),
                due_date: null,
                is_completed: false,
                sort_order: idx + 1,
              };
            }
            return {
              id: item.id,
              title: item.title.trim(),
              due_date: item.due_date ? resolveDateInput(item.due_date) : null,
              is_completed: Boolean(item.is_completed),
              sort_order: item.sort_order ?? idx + 1,
            };
          });
        };

        if (args.action === "create") {
          const title = (args.title ?? args.query ?? "").trim();
          if (!title) {
            return errResult("Для создания цели укажи `title`.");
          }

          const inferredMode: GoalProgressMode =
            args.progress_mode ??
            (args.milestones && args.milestones.length > 0
              ? "milestones"
              : args.target_value !== undefined && args.target_value !== null
                ? "numeric"
                : "tasks_linked");

          const created = await upsertGoal(db, userId, {
            life_area: (args.life_area ?? "personal") as GoalLifeArea,
            title,
            motivation_note: args.motivation_note?.trim() || null,
            progress_mode: inferredMode,
            start_value: args.start_value,
            current_value: args.current_value,
            target_value: args.target_value,
            unit: args.unit?.trim() || null,
            start_date: args.start_date ? resolveDateInput(args.start_date) ?? undefined : undefined,
            target_date:
              args.target_date === null
                ? null
                : args.target_date
                  ? resolveDateInput(args.target_date)
                  : undefined,
            status:
              args.status && args.status !== "all" ? (args.status as GoalStatus) : "active",
            milestones: normalizeMilestoneDrafts(args.milestones),
          });

          return okResult({
            ok: true,
            goal: formatGoalForMcp(created),
          });
        }

        // Resolve existing goal for get / update / update_progress / pause / achieve / drop / resume / delete
        const lookupRef =
          args.goal_id ?? (args.action === "update" ? args.query : args.query ?? args.title);
        if (!lookupRef) {
          return errResult("Укажи `query` (название цели) или `goal_id`.");
        }

        const { goal, matches } = await findGoalByQueryOrId(db, lookupRef);
        if (!goal) {
          return errResult(
            `Цель по запросу «${lookupRef}» не найдена. Вызови get_goals_and_habits или manage_goal(action='list').`
          );
        }

        if (
          !args.goal_id &&
          typeof lookupRef === "string" &&
          matches.length > 1 &&
          (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
        ) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько похожих целей. Уточни название или передай goal_id.",
            candidates: matches.slice(0, 5).map((m) => ({
              id: m.item.id,
              title: m.item.title,
              life_area: m.item.life_area,
              status: m.item.status,
              progress_pct: m.item.progress.progressPct,
              score: m.score,
            })),
          });
        }

        if (args.action === "get") {
          return okResult({
            ok: true,
            goal: formatGoalForMcp(goal),
          });
        }

        if (args.action === "update_progress") {
          if (args.current_value === undefined && args.delta === undefined) {
            return errResult(
              "Для action='update_progress' передай новое значение `current_value` или изменение `delta` (например, +15000)."
            );
          }
          const updated = await updateGoalNumericValue(db, userId, goal.id, {
            value: args.current_value,
            delta: args.delta,
            autoMarkAchieved: Boolean(args.auto_mark_achieved),
          });
          return okResult({
            ok: true,
            goal: formatGoalForMcp(updated),
          });
        }

        if (
          args.action === "pause" ||
          args.action === "achieve" ||
          args.action === "drop" ||
          args.action === "resume"
        ) {
          const statusMap: Record<string, GoalStatus> = {
            pause: "paused",
            achieve: "achieved",
            drop: "dropped",
            resume: "active",
          };
          const updated = await setGoalStatus(db, goal.id, statusMap[args.action]);
          return okResult({
            ok: true,
            goal: formatGoalForMcp(updated),
          });
        }

        if (args.action === "delete") {
          const { deletedGoal } = await deleteGoal(db, goal.id);
          return okResult({
            ok: true,
            deleted_goal: {
              id: deletedGoal.id,
              title: deletedGoal.title,
              life_area: deletedGoal.life_area,
            },
          });
        }

        // action === "update"
        const updated = await upsertGoal(db, userId, {
          id: goal.id,
          life_area: args.life_area as GoalLifeArea | undefined,
          title: args.title?.trim() || undefined,
          motivation_note:
            args.motivation_note === undefined
              ? undefined
              : args.motivation_note?.trim() || null,
          progress_mode: args.progress_mode as GoalProgressMode | undefined,
          start_value: args.start_value,
          current_value: args.current_value,
          target_value: args.target_value,
          unit: args.unit === undefined ? undefined : args.unit?.trim() || null,
          start_date: args.start_date ? resolveDateInput(args.start_date) ?? undefined : undefined,
          target_date:
            args.target_date === undefined
              ? undefined
              : args.target_date === null
                ? null
                : resolveDateInput(args.target_date),
          status:
            args.status && args.status !== "all" ? (args.status as GoalStatus) : undefined,
          milestones: normalizeMilestoneDrafts(args.milestones),
        });

        return okResult({
          ok: true,
          goal: formatGoalForMcp(updated),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 3. GOAL MILESTONES (`manage_goal_milestone`)
  // ==========================================================================

  server.registerTool(
    "manage_goal_milestone",
    {
      title: "Этапы (вехи) цели: добавление, отметка выполнения, редактирование, удаление",
      description:
        "Управляет контрольными вехами цели (`add | toggle | update | delete`) с нечётким поиском как самой цели (`goal_query` / `goal_id`), так и конкретной вехи (`milestone_query` / `milestone_id`) без необходимости знать ID.",
      inputSchema: {
        action: z
          .enum(["add", "toggle", "update", "delete"])
          .describe("Действие: add, toggle, update, delete"),
        goal_id: z.number().int().positive().optional().describe("ID цели, если известен"),
        goal_query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткое название цели (например, 'научная работа' или 'семестр')"),
        goal: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Алиас для goal_id / goal_query"),
        milestone_id: z.number().int().positive().optional().describe("ID вехи, если известен"),
        milestone_query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткий поиск вехи по названию (для toggle / update / delete)"),
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Алиас для milestone_query"),
        title: z.string().max(300).optional().describe("Название новой вехи (для add) или новое название (для update)"),
        due_date: z
          .string()
          .nullable()
          .optional()
          .describe("Контрольная дата вехи YYYY-MM-DD или today/+7d"),
        is_completed: z
          .boolean()
          .optional()
          .describe("Явный статус выполнения вехи (при toggle без этого поля статус переключается автоматически)"),
        sort_order: z.number().int().optional().describe("Порядок сортировки вехи"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const goalRef = args.goal_id ?? args.goal_query ?? args.goal;
        const milestoneRef =
          args.milestone_id ??
          args.milestone_query ??
          args.query ??
          (args.action !== "add" && args.action !== "update" ? args.title : undefined);

        const dueDate =
          args.due_date === undefined
            ? undefined
            : args.due_date === null
              ? null
              : resolveDateInput(args.due_date);

        const res = await manageGoalMilestone(db, userId, args.action, {
          goalIdOrQuery: goalRef,
          milestoneIdOrQuery: milestoneRef,
          title: args.title,
          dueDate,
          isCompleted: args.is_completed,
          sortOrder: args.sort_order,
        });

        return okResult({
          ok: true,
          milestone: res.milestone,
          goal: formatGoalForMcp(res.goal),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 4. LINK TASK TO GOAL / CREATE NEXT CONCRETE STEP (`link_task_to_goal`)
  // ==========================================================================

  server.registerTool(
    "link_task_to_goal",
    {
      title: "Привязать задачу к цели или создать конкретный следующий шаг по цели",
      description:
        "Переводит цель из абстракции в реальные действия: привязывает (или отвязывает при `unlink: true`) существующую задачу к цели нечётким поиском без ID, ЛИБО сразу создаёт новую конкретную задачу-шаг (`create_task_title`), привязанную к этой цели, мгновенно снимая статус пробуксовки `isStalled`!",
      inputSchema: {
        goal_id: z.number().int().positive().optional().describe("ID цели"),
        goal_query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткое название цели (например, 'Life OS', 'резерв', 'вес')"),
        goal: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Алиас для goal_id / goal_query"),
        task_id: z.number().int().positive().optional().describe("ID существующей задачи"),
        task_query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткое название существующей задачи для привязки/отвязки"),
        query: z.string().max(250).optional().describe("Алиас для task_query"),
        unlink: z
          .boolean()
          .optional()
          .describe("Если true — отвязывает найденную задачу от цели (goal_id = null)"),
        create_task_title: z
          .string()
          .max(400)
          .optional()
          .describe(
            "Если передано — создаёт НОВУЮ конкретную задачу-шаг с этим названием и сразу привязывает её к выбранной цели!"
          ),
        planned_date: z
          .string()
          .nullable()
          .optional()
          .describe("Дата нового шага YYYY-MM-DD или today/tomorrow (по умолчанию сегодня по МСК)"),
        date: z
          .string()
          .nullable()
          .optional()
          .describe("Алиас для planned_date"),
        day_slot: z
          .enum(["morning", "afternoon", "evening", "any"])
          .optional()
          .describe("Слот дня для нового шага (morning / afternoon / evening / any)"),
        priority: z
          .union([
            z.number().int().min(1).max(4),
            z.enum(["1", "2", "3", "4", "critical", "high", "normal", "medium", "low"]),
          ])
          .optional()
          .describe("Приоритет нового шага (по умолчанию 2 — Важно)"),
        duration_minutes: z
          .number()
          .int()
          .min(5)
          .max(480)
          .optional()
          .describe("Оценка времени в минутах (по умолчанию 30)"),
        description: z.string().max(2000).nullable().optional().describe("Заметка к создаваемому шагу"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const goalRef = args.goal_id ?? args.goal_query ?? args.goal;

        // Flow A: Create a brand-new concrete next-step task directly linked to the goal
        if (args.create_task_title?.trim()) {
          if (!goalRef) {
            return errResult(
              "Укажи цель (`goal_query` или `goal_id`), для которой создаётся следующий шаг."
            );
          }
          const { goal, matches } = await findGoalByQueryOrId(db, goalRef);
          if (!goal) {
            return errResult(`Цель «${goalRef}» не найдена.`);
          }
          if (
            !args.goal_id &&
            typeof goalRef === "string" &&
            matches.length > 1 &&
            (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
          ) {
            return okResult({
              ok: false,
              needs_clarification: true,
              message: "Найдено несколько похожих целей. Уточни goal_query или goal_id.",
              candidates: matches.slice(0, 5).map((m) => ({
                id: m.item.id,
                title: m.item.title,
                score: m.score,
              })),
            });
          }

          const rawDate = args.planned_date !== undefined ? args.planned_date : args.date;
          const plannedDate =
            rawDate === null ? null : resolveDateInput(rawDate) ?? formatIsoDate();

          const createdTask = await createTask(db, {
            user_id: userId,
            title: args.create_task_title.trim(),
            notes: args.description?.trim() || null,
            goal_id: goal.id,
            status: plannedDate ? "todo" : "inbox",
            priority: normalizePriority(args.priority, 2),
            planned_date: plannedDate,
            day_slot: (args.day_slot ?? "any") as DaySlot,
            estimated_minutes: args.duration_minutes ?? 30,
            source: "mcp",
          });

          await db
            .from("goals")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", goal.id);

          const refreshedGoal = await getGoalWithDetails(db, goal.id);
          return okResult({
            ok: true,
            mode: "created_and_linked",
            task: formatTaskForMcp(createdTask),
            goal: refreshedGoal ? formatGoalForMcp(refreshedGoal) : null,
          });
        }

        // Flow B: Link or unlink an existing task
        const taskRef = args.task_id ?? args.task_query ?? args.query;
        if (!taskRef) {
          return errResult(
            "Передай `task_query` / `task_id` существующей задачи ИЛИ `create_task_title` для создания нового шага по цели."
          );
        }

        if (!args.unlink && !goalRef) {
          return errResult(
            "Укажи целевую цель (`goal_query` или `goal_id`) либо передай `unlink: true` для отвязки."
          );
        }

        // Check task ambiguity via resolveTaskTarget first when using fuzzy query
        let resolvedTaskId: number | string = taskRef;
        if (!args.task_id && typeof taskRef === "string" && !/^\d+$/.test(taskRef.trim())) {
          const check = await resolveTaskTarget(db, { query: taskRef, includeDone: true });
          if (check.error) return errResult(check.error);
          if (check.candidates) {
            return okResult({
              ok: false,
              needs_clarification: true,
              message: "Найдено несколько похожих задач. Уточни название или передай task_id.",
              candidates: check.candidates,
            });
          }
          resolvedTaskId = check.task!.id;
        }

        const res = await linkTaskToGoal(db, {
          taskIdOrQuery: resolvedTaskId,
          goalIdOrQuery: args.unlink ? null : goalRef!,
        });

        return okResult({
          ok: true,
          mode: args.unlink ? "unlinked" : "linked",
          task: formatTaskForMcp(res.task),
          goal: res.goal ? formatGoalForMcp(res.goal) : null,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 5. HABIT MANAGEMENT & REMINDER SYNC (`manage_habit`)
  // ==========================================================================

  server.registerTool(
    "manage_habit",
    {
      title: "Управление привычками (создание, настройка частоты/слота/будильника, архивация, удаление)",
      description:
        "Управляет трекерами привычек (`list | create | update | archive | unarchive | delete`) с нечётким поиском без ID. Поддерживает ежедневные привычки (`daily`) и привычки с недельной нормой (`weekly_target`, например 3 раза в неделю), привязку к цели и время ежедневного напоминания `reminder_time` (ЧЧ:ММ по МСК), которое автоматически синхронизируется в `reminders_queue`!",
      inputSchema: {
        action: z
          .enum(["list", "create", "update", "archive", "unarchive", "delete"])
          .describe("Действие: list, create, update, archive, unarchive, delete"),
        habit_id: z.number().int().positive().optional().describe("Точный ID привычки, если известен"),
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткий поиск привычки по названию (для update / archive / unarchive / delete)"),
        title: z
          .string()
          .max(250)
          .optional()
          .describe("Название привычки (например, 'Чтение 20 минут', 'Вода 2 л')"),
        description: z
          .string()
          .max(1000)
          .nullable()
          .optional()
          .describe("Краткое пояснение или якорь привычки"),
        icon_name: z.string().max(60).optional().describe("Имя иконки Lucide (например, 'droplets', 'book-open', 'dumbbell')"),
        color_token: z
          .string()
          .max(60)
          .optional()
          .describe("Цветовой токен (например, 'domain-health', 'domain-mind', 'domain-work')"),
        goal_id: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("ID связанной цели (null чтобы отвязать)"),
        goal_query: z
          .string()
          .max(250)
          .nullable()
          .optional()
          .describe("Нечёткое название связанной цели"),
        goal: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Алиас для goal_id / goal_query"),
        cadence: z
          .enum(["daily", "weekly_target"])
          .optional()
          .describe("Режим частоты: daily (каждый день) или weekly_target (N раз в неделю)"),
        target_per_week: z
          .number()
          .int()
          .min(1)
          .max(7)
          .optional()
          .describe("Целевое число выполнений в неделю (1..7; для daily по умолчанию 7, для weekly_target — 3)"),
        preferred_slot: z
          .enum(["morning", "afternoon", "evening", "any"])
          .optional()
          .describe("Предпочтительный слот дня: morning, afternoon, evening, any"),
        reminder_time: z
          .string()
          .nullable()
          .optional()
          .describe("Ежедневное время напоминания в Telegram в формате ЧЧ:ММ по МСК (например, '21:15'; null чтобы выключить)"),
        telegram_chat_id: z
          .union([z.number(), z.string()])
          .optional()
          .describe("Опциональный Telegram Chat ID собеседника для напоминаний по этой привычке"),
        sort_order: z.number().int().optional().describe("Порядок сортировки"),
        include_archived: z.boolean().optional().describe("Включить архивные привычки в list"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();

        if (args.action === "list") {
          const habits = await listHabitsWithStats(db, undefined, 21, {
            includeArchived: Boolean(args.include_archived),
            timeZone: DEFAULT_TIMEZONE,
          });
          return okResult({
            ok: true,
            count: habits.length,
            habits: habits.map(formatHabitForMcp),
          });
        }

        // Resolve optional goal link if provided
        const rawGoalRef =
          args.goal !== undefined
            ? args.goal
            : args.goal_id !== undefined
              ? args.goal_id
              : args.goal_query;
        let resolvedGoalId: number | null | undefined = undefined;
        if (rawGoalRef !== undefined) {
          if (rawGoalRef === null || rawGoalRef === "") {
            resolvedGoalId = null;
          } else {
            const { goal } = await findGoalByQueryOrId(db, rawGoalRef);
            if (!goal) {
              return errResult(`Цель «${rawGoalRef}» не найдена.`);
            }
            resolvedGoalId = goal.id;
          }
        }

        const normalizedReminder = normalizeReminderClockTime(args.reminder_time);

        if (args.action === "create") {
          const title = (args.title ?? args.query ?? "").trim();
          if (!title) {
            return errResult("Для создания привычки укажи `title`.");
          }

          const created = await upsertHabit(db, userId, {
            goal_id: resolvedGoalId ?? null,
            title,
            description: args.description?.trim() || null,
            icon_name: args.icon_name,
            color_token: args.color_token,
            cadence: (args.cadence ??
              (args.target_per_week && args.target_per_week < 7
                ? "weekly_target"
                : "daily")) as HabitCadence,
            target_per_week: args.target_per_week,
            preferred_slot: args.preferred_slot as HabitPreferredSlot | undefined,
            reminder_time: normalizedReminder ?? null,
            sort_order: args.sort_order,
          });

          const explicitChatId =
            args.telegram_chat_id !== undefined && Number.isFinite(Number(args.telegram_chat_id))
              ? Number(args.telegram_chat_id)
              : undefined;
          if (explicitChatId && created.reminder_time) {
            await db
              .from("reminders_queue")
              .update({ telegram_chat_id: explicitChatId })
              .eq("entity_type", "habit_reminder")
              .eq("entity_id", String(created.id))
              .eq("status", "pending");
          }

          return okResult({
            ok: true,
            habit: formatHabitForMcp(created),
          });
        }

        // Resolve existing habit for update / archive / unarchive / delete
        const lookupRef =
          args.habit_id ?? (args.action === "update" ? args.query : args.query ?? args.title);
        if (!lookupRef) {
          return errResult("Укажи `query` (название привычки) или `habit_id`.");
        }

        const { habit, matches } = await findHabitByQueryOrId(db, lookupRef, true);
        if (!habit) {
          return errResult(
            `Привычка по запросу «${lookupRef}» не найдена. Вызови get_goals_and_habits.`
          );
        }
        if (
          !args.habit_id &&
          typeof lookupRef === "string" &&
          matches.length > 1 &&
          (matches[0].score < 0.88 || matches[0].score - matches[1].score < 0.1)
        ) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько похожих привычек. Уточни название или habit_id.",
            candidates: matches.slice(0, 5).map((m) => ({
              id: m.item.id,
              title: m.item.title,
              is_archived: m.item.is_archived,
              score: m.score,
            })),
          });
        }

        if (args.action === "archive" || args.action === "unarchive") {
          const archivedRow = await archiveHabit(db, habit.id, args.action === "archive");
          return okResult({
            ok: true,
            habit: archivedRow,
          });
        }

        if (args.action === "delete") {
          const { deletedHabit } = await deleteHabit(db, habit.id);
          return okResult({
            ok: true,
            deleted_habit: deletedHabit,
          });
        }

        // action === "update"
        const updated = await upsertHabit(db, userId, {
          id: habit.id,
          goal_id: resolvedGoalId,
          title: args.title?.trim() || undefined,
          description:
            args.description === undefined ? undefined : args.description?.trim() || null,
          icon_name: args.icon_name,
          color_token: args.color_token,
          cadence: args.cadence as HabitCadence | undefined,
          target_per_week: args.target_per_week,
          preferred_slot: args.preferred_slot as HabitPreferredSlot | undefined,
          reminder_time: normalizedReminder,
          sort_order: args.sort_order,
        });

        const explicitUpdateChatId =
          args.telegram_chat_id !== undefined && Number.isFinite(Number(args.telegram_chat_id))
            ? Number(args.telegram_chat_id)
            : undefined;
        if (explicitUpdateChatId && updated.reminder_time) {
          await db
            .from("reminders_queue")
            .update({ telegram_chat_id: explicitUpdateChatId })
            .eq("entity_type", "habit_reminder")
            .eq("entity_id", String(updated.id))
            .eq("status", "pending");
        }

        return okResult({
          ok: true,
          habit: formatHabitForMcp(updated),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 6. 1-TAP HABIT CHECK-IN (`log_habit_checkin`)
  // ==========================================================================

  server.registerTool(
    "log_habit_checkin",
    {
      title: "Отметить выполнение привычки в 1 тап (по названию без ID, с пересчётом стрика)",
      description:
        "Отмечает выполнение привычки (или снимает отметку при `completed: false`) за выбранный день нечётким поиском по названию ('вода', 'шаги', 'чтение', 'силовая'), автоматически сдвигает будильник привычки на завтра и возвращает обновлённый стрик `currentStreak` и недельный прогресс `thisWeekDone / thisWeekTarget`.",
      inputSchema: {
        query: z
          .string()
          .max(250)
          .optional()
          .describe("Нечёткое название привычки (например, 'вода', 'шаги', 'чтение' или несколько через запятую / 'и')"),
        queries: z
          .array(z.string().min(1).max(200))
          .optional()
          .describe("Массив названий привычек для одновременной отметки нескольких привычек за один вызов"),
        habit_id: z.number().int().positive().optional().describe("Точный ID привычки, если известен"),
        date: z
          .string()
          .optional()
          .describe("Дата отметки YYYY-MM-DD или today/yesterday (по умолчанию сегодня по МСК)"),
        completed: z
          .boolean()
          .optional()
          .describe("true — выполнено (по умолчанию), false — снять отметку"),
        toggle: z
          .boolean()
          .optional()
          .describe("Если true — инвертирует текущее состояние отметки за выбранную дату"),
        note: z.string().max(500).nullable().optional().describe("Опциональная короткая заметка к отметке"),
        source: z
          .enum(["web", "telegram", "mcp", "openclaw"])
          .optional()
          .describe("Источник отметки (по умолчанию 'openclaw')"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const dateStr =
          resolveDateInput(args.date) ?? formatIsoDate(new Date(), DEFAULT_TIMEZONE);
        const desiredCompleted = args.toggle
          ? undefined
          : args.completed !== undefined
            ? args.completed
            : true;
        const source: RecordSource = (args.source ?? "openclaw") as RecordSource;

        const multiQueries =
          args.queries && args.queries.length > 0
            ? args.queries
            : !args.habit_id && args.query && /[,;]|\s+и\s+/iu.test(args.query)
              ? args.query
                  .split(/[,;]+|\s+и\s+/iu)
                  .map((s) => s.trim())
                  .filter(Boolean)
              : null;

        if (multiQueries && multiQueries.length > 1) {
          const results: Array<{
            habit: ReturnType<typeof formatHabitForMcp>;
            completed: boolean;
          }> = [];
          const notFound: string[] = [];
          for (const q of multiQueries) {
            const { habit } = await findHabitByQueryOrId(db, q, false);
            if (!habit) {
              notFound.push(q);
              continue;
            }
            const res = await toggleHabitCheckin(db, userId, {
              habitIdOrQuery: habit.id,
              date: dateStr,
              completed: desiredCompleted,
              note: args.note,
              source,
              timeZone: DEFAULT_TIMEZONE,
            });
            results.push({
              habit: formatHabitForMcp(res.habit),
              completed: res.completed,
            });
          }
          return okResult({
            ok: true,
            date: dateStr,
            updated_count: results.length,
            results,
            not_found: notFound,
          });
        }

        const ref = args.habit_id ?? args.query?.trim();
        if (!ref) {
          return errResult("Укажи `query` (название привычки) или `habit_id`.");
        }

        const res = await toggleHabitCheckin(db, userId, {
          habitIdOrQuery: ref,
          date: dateStr,
          completed: desiredCompleted,
          note: args.note,
          source,
          timeZone: DEFAULT_TIMEZONE,
        });

        return okResult({
          ok: true,
          date: dateStr,
          completed: res.completed,
          habit: formatHabitForMcp(res.habit),
          log: res.log,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 7. CROSS-LIFE ANALYTICS & PROACTIVE INSIGHTS (`get_life_analytics_and_proactive_brief`)
  // ==========================================================================

  server.registerTool(
    "get_life_analytics_and_proactive_brief",
    {
      title: "Кросс-доменная аналитика жизни и проактивный разбор («Напарник подсвечивает»)",
      description:
        "Собирает единую числовую сводку за 7 / 14 / 30 дней по всем контурам Life OS (выполненные и просроченные задачи, соблюдение буфера, стабильность и стрики привычек, прогресс целей и цели без следующего шага `stalledGoals`, энергия/настроение/напряжение/вечерние оценки, тренировки в окне и средний КБЖУ + динамика веса) вместе с готовыми проактивными наблюдениями `proactiveInsights[]`.",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("Опорная конечная дата периода YYYY-MM-DD или today (по умолчанию сегодня по МСК)"),
        anchor_date: z
          .string()
          .optional()
          .describe("Алиас для date"),
        window_days: z
          .number()
          .int()
          .min(7)
          .max(90)
          .optional()
          .describe("Окно анализа в днях: 7, 14 или 30 (по умолчанию 14)"),
        days: z
          .number()
          .int()
          .min(7)
          .max(90)
          .optional()
          .describe("Алиас для window_days"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const anchorDate =
          resolveDateInput(args.date ?? args.anchor_date) ??
          formatIsoDate(new Date(), DEFAULT_TIMEZONE);
        const windowDays = args.window_days ?? args.days ?? 14;

        const summary = await getLifeAnalyticsSummary(
          db,
          anchorDate,
          windowDays,
          DEFAULT_TIMEZONE
        );

        return okResult({
          ok: true,
          ...summary,
          goals: {
            ...summary.goals,
            stalledGoals: summary.goals.stalledGoals.map(formatGoalForMcp),
            activeGoals: summary.goals.activeGoals.map(formatGoalForMcp),
          },
          habits: {
            ...summary.habits,
            matrix21d: summary.habits.matrix21d.map(formatHabitForMcp),
          },
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
