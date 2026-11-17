import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Json } from "@life-os/db";
import {
  cancelReminderByIdOrQuery,
  createAssistantAgreement,
  createProject,
  createStandaloneReminder,
  createTask,
  deleteAssistantAgreement,
  deleteProject,
  deleteTask,
  extractLocalTimeParts,
  findProjectsByFuzzyQuery,
  findSimilarActiveTasks,
  findTasksByFuzzyQuery,
  findTimeConflicts,
  formatIsoDate,
  getAssistantFullContext,
  getDayPlan,
  getDayPlansInRange,
  getOwnerBotDbClient,
  getTodayOverview,
  getWaitingTasks,
  getWeekBoundsIso,
  listAssistantAgreements,
  listProjects,
  listRemindersQueue,
  listTasks,
  listTasksInDateRange,
  localClockToUtcIso,
  toggleTaskDone,
  updateAssistantAgreement,
  updateProject,
  updateTask,
  upsertDayPlan,
  type DaySlot,
  type LifeArea,
  type SubtaskItem,
  type Task,
  type TaskStatus,
  type TaskUpdate,
} from "@life-os/db";
import {
  DEFAULT_TIMEZONE,
  computeFreeWindowsMsk,
  errResult,
  formatTaskForMcp,
  inferIsMeetingFromTitle,
  normalizePriority,
  normalizeRemindInput,
  normalizeSubtasksInput,
  okResult,
  resolveDateInput,
  resolveFollowUpTimestamp,
  resolveGoalRef,
  resolveProjectRef,
  resolveScheduleInputs,
  resolveTaskTarget,
} from "../helpers";

const SubtaskEntrySchema = z.union([
  z.string().min(1).max(400),
  z.object({
    id: z.string().optional(),
    title: z.string().min(1).max(400),
    done: z.boolean().optional(),
  }),
]);

const PriorityFlexibleSchema = z.union([
  z.number().int().min(1).max(4),
  z.enum(["1", "2", "3", "4", "critical", "high", "normal", "medium", "low"]),
]);

const RemindBeforeFlexibleSchema = z
  .union([
    z.number().int().min(0).max(1440),
    z.array(z.number().int().min(0).max(1440)),
  ])
  .nullable();

const ACCENT_BY_AREA: Record<LifeArea, string> = {
  work: "domain-work",
  study: "domain-mind",
  launch: "domain-finance",
  personal: "domain-nutrition",
  health: "domain-health",
};

export function registerOverviewAndTaskTools(server: McpServer): void {
  // ==========================================================================
  // 1. RICH READ & SUMMARY TOOLS
  // ==========================================================================

  server.registerTool(
    "get_day_overview",
    {
      title: "Картина дня (полная сводка)",
      description:
        "Возвращает полную картину выбранного дня (по умолчанию сегодня по МСК): фокус дня, загрузку и буфер, встречи по часам, задачи по слотам Утро/День/Вечер, лист Ожидание, ближайшие будильники reminders_queue, пульс состояния, вечерний чекин и баланс Safe-to-Spend.",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("Дата YYYY-MM-DD или today/tomorrow/yesterday (по умолчанию сегодня по МСК)"),
        include_inbox: z
          .boolean()
          .optional()
          .describe("Включить ли неразобранные входящие задачи без даты (по умолчанию true)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const targetDate = resolveDateInput(args.date) ?? formatIsoDate();
        const overview = await getTodayOverview(db, targetDate);
        const projectMap = new Map(overview.projects.map((p) => [p.id, p]));

        const dayStartUtc = localClockToUtcIso(targetDate, "00:00", DEFAULT_TIMEZONE);
        const dayEndUtc = localClockToUtcIso(targetDate, "23:59", DEFAULT_TIMEZONE);

        const [dayReminders, inboxTasks, dailyReviewRes] = await Promise.all([
          listRemindersQueue(db, {
            status: "pending",
            fromTriggerAt: dayStartUtc,
            toTriggerAt: dayEndUtc,
            limit: 30,
          }),
          args.include_inbox === false
            ? Promise.resolve([] as Task[])
            : listTasks(db, { status: "inbox" }),
          db.from("daily_reviews").select("*").eq("review_date", targetDate).maybeSingle(),
        ]);

        const activeDayTasks = overview.todayTasks.filter((t) => t.status !== "done");
        const completedDayTasks = overview.todayTasks.filter((t) => t.status === "done");
        const plannedMinutes = activeDayTasks.reduce(
          (sum, t) => sum + (t.estimated_minutes ?? 30),
          0
        );
        const availableMinutes =
          overview.dayPlan?.available_minutes ?? overview.profile?.default_available_minutes ?? 480;
        const bufferMinutes =
          overview.dayPlan?.buffer_minutes ?? overview.profile?.daily_buffer_minutes ?? 90;
        const safeCapacityMinutes = Math.max(0, availableMinutes - bufferMinutes);

        return okResult({
          ok: true,
          date: targetDate,
          timezone: overview.profile?.timezone ?? DEFAULT_TIMEZONE,
          day_plan: {
            main_focus: overview.dayPlan?.main_focus ?? null,
            energy_mode: overview.dayPlan?.energy_mode ?? "normal",
            available_minutes: availableMinutes,
            buffer_minutes: bufferMinutes,
            planned_active_minutes: plannedMinutes,
            remaining_before_buffer_minutes: safeCapacityMinutes - plannedMinutes,
            is_overloaded: plannedMinutes > safeCapacityMinutes,
            notes: overview.dayPlan?.notes ?? null,
          },
          timed_schedule: overview.todayTasks
            .filter((t) => Boolean(t.scheduled_start_at))
            .map((t) => formatTaskForMcp(t, projectMap)),
          slot_tasks: {
            morning: overview.todayTasks
              .filter((t) => !t.scheduled_start_at && t.day_slot === "morning")
              .map((t) => formatTaskForMcp(t, projectMap)),
            afternoon: overview.todayTasks
              .filter((t) => !t.scheduled_start_at && t.day_slot === "afternoon")
              .map((t) => formatTaskForMcp(t, projectMap)),
            evening: overview.todayTasks
              .filter((t) => !t.scheduled_start_at && t.day_slot === "evening")
              .map((t) => formatTaskForMcp(t, projectMap)),
            any: overview.todayTasks
              .filter((t) => !t.scheduled_start_at && t.day_slot === "any")
              .map((t) => formatTaskForMcp(t, projectMap)),
          },
          free_windows_msk: computeFreeWindowsMsk(overview.todayTasks, targetDate),
          completed_count: completedDayTasks.length,
          inbox_tasks: inboxTasks.slice(0, 15).map((t) => formatTaskForMcp(t, projectMap)),
          waiting_for: overview.waitingTasks.map((t) => formatTaskForMcp(t, projectMap)),
          pending_reminders: dayReminders.map((r) => ({
            id: r.id,
            entity_type: r.entity_type,
            trigger_at: r.trigger_at,
            trigger_time_msk: extractLocalTimeParts(r.trigger_at, DEFAULT_TIMEZONE).timeStr,
            message_text: r.message_text.replace(/<[^>]+>/g, ""),
          })),
          latest_state_pulse: overview.latestCheckin,
          evening_review: dailyReviewRes.data ?? null,
          finance_summary: overview.financeSummary,
          today_meals: overview.todayMeals.map((m) => ({
            id: m.id,
            meal_slot: m.meal_slot,
            status: m.status,
            planned_servings: Number(m.planned_servings),
            title: m.recipe?.title ?? m.custom_meal_title ?? "Блюдо",
          })),
          unchecked_shopping_count: overview.uncheckedShoppingItems.length,
          active_workout_windows: overview.activeWorkoutWindows.map((w) => ({
            id: w.id,
            title: w.title,
            window_start_date: w.window_start_date,
            window_end_date: w.window_end_date,
            preferred_slot: w.preferred_slot,
            status: w.status,
          })),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "get_week_overview",
    {
      title: "Расписание и загрузка недели (Пн–Вс)",
      description:
        "Возвращает 7-дневный календарный срез недели (Пн–Вс) вокруг любой прошлой, текущей или будущей даты, включая встречи по времени, слотовые задачи, выполненные дела и свободные окна.",
      inputSchema: {
        anchor_date: z
          .string()
          .optional()
          .describe("Любая дата внутри нужной недели YYYY-MM-DD или today/tomorrow (по умолчанию сегодня)"),
        include_completed: z
          .boolean()
          .optional()
          .describe("Включить выполненные задачи (по умолчанию true для просмотра истории)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const anchor = resolveDateInput(args.anchor_date) ?? formatIsoDate();
        const bounds = getWeekBoundsIso(anchor);
        const includeDone = args.include_completed ?? true;

        const [tasks, dayPlans, projects] = await Promise.all([
          listTasksInDateRange(db, {
            startDate: bounds.weekStart,
            endDate: bounds.weekEnd,
            includeDone,
          }),
          getDayPlansInRange(db, bounds.weekStart, bounds.weekEnd),
          listProjects(db),
        ]);

        const projectMap = new Map(projects.map((p) => [p.id, p]));
        const planByDate = new Map(dayPlans.map((dp) => [dp.plan_date, dp]));

        const days = bounds.dates.map((dateIso) => {
          const dayTasks = tasks.filter((t) => {
            const effDate = t.scheduled_start_at
              ? extractLocalTimeParts(t.scheduled_start_at, DEFAULT_TIMEZONE).dateStr
              : t.planned_date;
            return effDate === dateIso;
          });
          const activeMins = dayTasks
            .filter((t) => t.status !== "done" && t.status !== "cancelled")
            .reduce((sum, t) => sum + (t.estimated_minutes ?? 30), 0);
          const dp = planByDate.get(dateIso);

          return {
            date: dateIso,
            main_focus: dp?.main_focus ?? null,
            active_planned_minutes: activeMins,
            buffer_minutes: dp?.buffer_minutes ?? 90,
            free_windows_msk: computeFreeWindowsMsk(dayTasks, dateIso),
            tasks: dayTasks.map((t) => formatTaskForMcp(t, projectMap)),
          };
        });

        return okResult({
          ok: true,
          week_start: bounds.weekStart,
          week_end: bounds.weekEnd,
          total_tasks: tasks.length,
          days,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "get_assistant_context",
    {
      title: "Контекст личности ассистента и личных договорённостей",
      description:
        "Читает актуальные системные настройки ассистента с сайта (имя, системный промпт, тон, время сводок), активные личные договорённости (assistant_agreements) и правила вечерней оценки.",
      inputSchema: {},
    },
    async () => {
      try {
        const { db } = await getOwnerBotDbClient();
        const ctx = await getAssistantFullContext(db);
        return okResult({
          ok: true,
          profile: {
            display_name: ctx.overview.profile?.display_name ?? "Андрей",
            timezone: ctx.overview.profile?.timezone ?? DEFAULT_TIMEZONE,
            daily_buffer_minutes: ctx.overview.profile?.daily_buffer_minutes ?? 90,
            default_available_minutes: ctx.overview.profile?.default_available_minutes ?? 480,
            feature_flags: ctx.overview.profile?.feature_flags ?? {},
          },
          assistant_settings: ctx.settings,
          active_agreements: ctx.agreements,
          evening_review_criteria: ctx.eveningCriteria,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      title: "Поиск и фильтрация задач",
      description:
        "Возвращает список задач по текстовому запросу, дате, диапазону дат, статусу, проекту, слоту дня или тегу.",
      inputSchema: {
        search_query: z
          .string()
          .optional()
          .describe("Нечёткий текстовый поиск по названию, заметкам, тегам или человеку в ожидании"),
        date: z.string().optional().describe("Конкретная дата YYYY-MM-DD или today/tomorrow/yesterday"),
        start_date: z.string().optional().describe("Начало периода YYYY-MM-DD"),
        end_date: z.string().optional().describe("Конец периода YYYY-MM-DD"),
        status: z
          .union([
            z.enum(["inbox", "todo", "in_progress", "waiting", "done", "cancelled"]),
            z.array(z.enum(["inbox", "todo", "in_progress", "waiting", "done", "cancelled"])),
          ])
          .optional()
          .describe("Фильтр по статусу или массиву статусов"),
        project: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Название проекта (нечёткий поиск) или ID проекта"),
        day_slot: z
          .enum(["morning", "afternoon", "evening", "any"])
          .optional()
          .describe("Фильтр по гибкому слоту дня"),
        tag: z.string().optional().describe("Фильтр по тегу"),
        is_meeting: z.boolean().optional().describe("Только встречи/звонки (true) или только обычные задачи (false)"),
        include_completed: z.boolean().optional().describe("Включать выполненные задачи (по умолчанию true)"),
        limit: z.number().int().min(1).max(200).optional().describe("Максимум записей (по умолчанию 50)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const projects = await listProjects(db, true);
        const projectMap = new Map(projects.map((p) => [p.id, p]));

        let resolvedProjectId: number | undefined;
        if (args.project !== undefined) {
          const proj = await resolveProjectRef(db, args.project);
          if (!proj) {
            return okResult({
              ok: true,
              count: 0,
              note: `Проект по запросу «${args.project}» не найден.`,
              tasks: [],
            });
          }
          resolvedProjectId = proj.id;
        }

        const singleDate = resolveDateInput(args.date);
        const startDate = resolveDateInput(args.start_date);
        const endDate = resolveDateInput(args.end_date);
        const includeDone = args.include_completed ?? true;

        let rows: Task[];
        if (args.search_query?.trim()) {
          const matches = await findTasksByFuzzyQuery(db, args.search_query.trim(), {
            plannedDate: singleDate ?? undefined,
            status: args.status as TaskStatus | TaskStatus[] | undefined,
            includeDone,
            limit: args.limit ?? 30,
          });
          rows = matches.map((m) => m.task);
        } else if (singleDate || (startDate && endDate)) {
          rows = await listTasksInDateRange(db, {
            startDate: singleDate ?? startDate!,
            endDate: singleDate ?? endDate!,
            includeDone,
          });
        } else {
          rows = await listTasks(db, {
            status: args.status as TaskStatus | TaskStatus[] | undefined,
            fromDate: startDate ?? undefined,
            toDate: endDate ?? undefined,
            projectId: resolvedProjectId,
            includeDone,
          });
        }

        if (resolvedProjectId !== undefined) {
          rows = rows.filter((t) => t.project_id === resolvedProjectId);
        }
        if (args.status) {
          const allowed = new Set(Array.isArray(args.status) ? args.status : [args.status]);
          rows = rows.filter((t) => allowed.has(t.status as TaskStatus));
        }
        if (args.day_slot) {
          rows = rows.filter((t) => t.day_slot === args.day_slot);
        }
        if (args.tag?.trim()) {
          const needle = args.tag.trim().toLowerCase();
          rows = rows.filter((t) => (t.tags ?? []).some((tg) => tg.toLowerCase().includes(needle)));
        }
        if (args.is_meeting !== undefined) {
          rows = rows.filter((t) => t.is_meeting === args.is_meeting);
        }

        const limited = rows.slice(0, args.limit ?? 50);
        return okResult({
          ok: true,
          count: limited.length,
          tasks: limited.map((t) => formatTaskForMcp(t, projectMap)),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "get_waiting_for",
    {
      title: "Список «Ожидание ответа»",
      description:
        "Возвращает все задачи и договорённости на стороне других людей (статус waiting: от кого ждём, контекст, когда напомнить и просроченные пинги).",
      inputSchema: {
        only_due: z
          .boolean()
          .optional()
          .describe("Если true — вернуть только те ожидания, по которым уже пора напомнить"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const [waiting, projects] = await Promise.all([getWaitingTasks(db), listProjects(db, true)]);
        const projectMap = new Map(projects.map((p) => [p.id, p]));
        const nowMs = Date.now();

        const enriched = waiting
          .map((t) => {
            const isOverdue = t.follow_up_at ? Date.parse(t.follow_up_at) <= nowMs : false;
            return {
              ...formatTaskForMcp(t, projectMap),
              is_follow_up_due: isOverdue,
            };
          })
          .filter((item) => (args.only_due ? item.is_follow_up_due : true));

        return okResult({
          ok: true,
          count: enriched.length,
          waiting_items: enriched,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "check_schedule_conflicts",
    {
      title: "Проверка пересечений расписания и подбор окон",
      description:
        "Проверяет, свободно ли указанное время (Europe/Moscow), возвращает пересекающиеся встречи и список свободных окон дня.",
      inputSchema: {
        date: z.string().describe("Дата YYYY-MM-DD или today/tomorrow"),
        starts_at: z.string().describe("Время начала ЧЧ:ММ по МСК (например, 14:00) или ISO"),
        ends_at: z.string().optional().describe("Время окончания ЧЧ:ММ по МСК или ISO"),
        duration_minutes: z
          .number()
          .int()
          .min(5)
          .max(720)
          .optional()
          .describe("Длительность в минутах (по умолчанию 60)"),
        exclude_task_id: z.number().int().positive().optional().describe("ID задачи, которую нужно исключить при переносе"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const sched = resolveScheduleInputs({
          plannedDate: args.date,
          startsAt: args.starts_at,
          endsAt: args.ends_at ?? null,
          durationMinutes: args.duration_minutes ?? 60,
          isMeeting: true,
        });

        const targetDate = sched.planned_date ?? formatIsoDate();
        const [conflicts, dayTasks] = await Promise.all([
          findTimeConflicts(db, {
            startAt: sched.scheduled_start_at!,
            endAt: sched.scheduled_end_at,
            durationMinutes: sched.estimated_minutes,
            excludeTaskId: args.exclude_task_id,
          }),
          listTasksInDateRange(db, {
            startDate: targetDate,
            endDate: targetDate,
            includeDone: false,
          }),
        ]);

        return okResult({
          ok: true,
          date: targetDate,
          checked_range: {
            starts_at: sched.scheduled_start_at,
            ends_at: sched.scheduled_end_at,
          },
          has_conflicts: conflicts.length > 0,
          conflicts: conflicts.map((c) => ({
            id: c.task.id,
            title: c.task.title,
            time_msk: c.timeRangeLabel,
            is_meeting: c.task.is_meeting,
          })),
          free_windows_msk: computeFreeWindowsMsk(dayTasks, targetDate),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 2. TASKS, MEETINGS, PROJECTS & DAY PLAN MUTATION TOOLS (100% PARITY)
  // ==========================================================================

  server.registerTool(
    "create_task",
    {
      title: "Создать задачу или встречу (100% полей формы + умные дефолты)",
      description:
        "Создаёт задачу, встречу по точному времени или элемент в листе «Ожидание». Обязателен только title; все остальные поля опциональны с умными дефолтами. Автоматически синхронизирует будильники в reminders_queue (по умолчанию за 30 минут для встреч со временем) и проверяет пересечения.",
      inputSchema: {
        title: z.string().min(1).max(400).describe("Название задачи или встречи (единственное обязательное поле)"),
        description: z
          .string()
          .max(4000)
          .nullable()
          .optional()
          .describe("Описание, заметки, ссылки или критерий готовности"),
        subtasks: z
          .array(SubtaskEntrySchema)
          .optional()
          .describe("Чеклист подзадач (массив строк или объектов { title, done })"),
        project: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Название проекта (найдётся нечётким поиском) или его ID"),
        goal: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Название цели или её ID"),
        priority: PriorityFlexibleSchema.optional().describe(
          "Приоритет: 1 (Главное/high), 2 (Важно/normal — по умолчанию), 3 (Обычное/low), 4 (Когда-нибудь)"
        ),
        tags: z.array(z.string().min(1).max(60)).optional().describe("Массив тегов задачи"),
        status: z
          .enum(["inbox", "todo", "in_progress", "waiting", "done"])
          .optional()
          .describe("Статус: todo (по умолчанию при наличии даты), inbox (входящие без даты), in_progress, waiting, done"),
        date: z
          .string()
          .nullable()
          .optional()
          .describe("Дата в плане YYYY-MM-DD или today/tomorrow (по умолчанию сегодня, если не inbox)"),
        starts_at: z
          .string()
          .nullable()
          .optional()
          .describe("Точное время начала по МСК в формате ЧЧ:ММ (например, '14:00' или '22:00') либо ISO"),
        ends_at: z
          .string()
          .nullable()
          .optional()
          .describe("Точное время окончания по МСК (ЧЧ:ММ) либо ISO"),
        duration_minutes: z
          .number()
          .int()
          .min(5)
          .max(720)
          .nullable()
          .optional()
          .describe("Оценка длительности в минутах (умный дефолт: 60 для встреч, 30 для задач)"),
        day_slot: z
          .enum(["morning", "afternoon", "evening", "any"])
          .optional()
          .describe("Гибкий слот дня: morning (Утро), afternoon (День), evening (Вечер), any (Гибко)"),
        is_meeting: z
          .boolean()
          .optional()
          .describe("Признак встречи/звонка ко времени (умный дефолт по названию и наличию starts_at)"),
        due_date: z
          .string()
          .nullable()
          .optional()
          .describe("Жёсткий дедлайн YYYY-MM-DD"),
        remind_before_minutes: RemindBeforeFlexibleSchema.optional().describe(
          "За сколько минут прислать уведомление в Telegram: число или массив чисел (например, [60, 15] или 0 для ровно в момент начала; null чтобы отключить; по умолчанию [30] при наличии starts_at)"
        ),
        recurrence_rule: z
          .string()
          .max(200)
          .nullable()
          .optional()
          .describe("Правило повтора: daily, weekdays, weekly, biweekly, monthly или произвольная строка"),
        waiting_for_person: z
          .string()
          .max(200)
          .nullable()
          .optional()
          .describe("От кого ждём ответ (для блока «Ожидание»)"),
        waiting_context: z
          .string()
          .max(1000)
          .nullable()
          .optional()
          .describe("Что именно ждём (смета, правки, документы)"),
        follow_up_at: z
          .string()
          .nullable()
          .optional()
          .describe("Когда напомнить по ожиданию: YYYY-MM-DD, 'YYYY-MM-DD ЧЧ:ММ' по МСК или ISO"),
        allow_duplicate: z
          .boolean()
          .optional()
          .describe("Разрешить создание дубля, если похожая активная задача на эту дату уже есть (по умолчанию false)"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const title = args.title.trim();

        const isWaitingImplicit = Boolean(args.waiting_for_person?.trim());
        const status: TaskStatus =
          args.status ??
          (isWaitingImplicit
            ? "waiting"
            : args.date === null && !args.starts_at
              ? "inbox"
              : "todo");

        const isMeeting =
          args.is_meeting ?? (Boolean(args.starts_at) && inferIsMeetingFromTitle(title));

        const defaultDate =
          status === "inbox"
            ? null
            : args.date !== undefined
              ? args.date
              : formatIsoDate();

        const sched = resolveScheduleInputs({
          plannedDate: defaultDate,
          startsAt: args.starts_at ?? null,
          endsAt: args.ends_at ?? null,
          durationMinutes:
            args.duration_minutes !== undefined
              ? args.duration_minutes
              : args.starts_at
                ? isMeeting
                  ? 60
                  : 30
                : 30,
          isMeeting,
          daySlot: args.day_slot ?? "any",
        });

        // Deduplication guard unless allow_duplicate is explicitly set
        if (!args.allow_duplicate) {
          const dupes = await findSimilarActiveTasks(db, {
            plannedDate: sched.planned_date,
            title,
          });
          if (dupes.length > 0) {
            const existing = dupes[0];
            return okResult({
              ok: true,
              deduplicated: true,
              note: "Похожая активная задача на эту дату уже существует в базе (дубль не создан). Используй update_task для изменения или передай allow_duplicate: true.",
              task: formatTaskForMcp(existing),
            });
          }
        }

        const [resolvedProject, resolvedGoal] = await Promise.all([
          resolveProjectRef(db, args.project),
          resolveGoalRef(db, args.goal),
        ]);

        const remindNormalized = normalizeRemindInput(
          args.remind_before_minutes,
          Boolean(sched.scheduled_start_at)
        );

        const conflicts = sched.scheduled_start_at
          ? await findTimeConflicts(db, {
              startAt: sched.scheduled_start_at,
              endAt: sched.scheduled_end_at,
              durationMinutes: sched.estimated_minutes,
              isMeeting,
            })
          : [];

        const subtasks = normalizeSubtasksInput(args.subtasks) ?? [];
        const dueDate = resolveDateInput(args.due_date);
        const followUpIso = resolveFollowUpTimestamp(args.follow_up_at);

        const created = await createTask(db, {
          user_id: userId,
          title,
          notes: args.description?.trim() || null,
          subtasks: subtasks as unknown as Json,
          tags: args.tags ?? [],
          project_id: resolvedProject?.id ?? null,
          goal_id: resolvedGoal?.id ?? null,
          status,
          priority: normalizePriority(args.priority, 2),
          planned_date: sched.planned_date,
          day_slot: sched.day_slot,
          estimated_minutes: sched.estimated_minutes,
          due_date: dueDate,
          scheduled_start_at: sched.scheduled_start_at,
          scheduled_end_at: sched.scheduled_end_at,
          is_meeting: isMeeting,
          remind_before_minutes: remindNormalized.remind_before_minutes,
          remind_offsets_minutes: remindNormalized.remind_offsets_minutes,
          reminder_sent_at: remindNormalized.reminder_sent_at,
          recurrence_rule: args.recurrence_rule?.trim() || null,
          waiting_on_person: args.waiting_for_person?.trim() || null,
          waiting_context: args.waiting_context?.trim() || null,
          waiting_since: status === "waiting" ? formatIsoDate() : null,
          follow_up_at: followUpIso,
          source: "mcp",
        });

        const syncedReminders = await listRemindersQueue(db, {
          status: "pending",
          limit: 20,
        });
        const taskReminders = syncedReminders.filter((r) => r.entity_id === String(created.id));
        const projectMap = resolvedProject ? new Map([[resolvedProject.id, resolvedProject]]) : undefined;

        return okResult({
          ok: true,
          task: formatTaskForMcp(created, projectMap),
          reminders_scheduled: taskReminders.map((r) => ({
            id: r.id,
            entity_type: r.entity_type,
            trigger_at: r.trigger_at,
            trigger_time_msk: extractLocalTimeParts(r.trigger_at, DEFAULT_TIMEZONE).timeStr,
          })),
          schedule_conflicts: conflicts.map((c) => ({
            id: c.task.id,
            title: c.task.title,
            time_msk: c.timeRangeLabel,
          })),
          warning:
            conflicts.length > 0
              ? `Внимание: время пересекается с ${conflicts
                  .map((c) => `«${c.task.title}» (${c.timeRangeLabel})`)
                  .join(", ")}`
              : null,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      title: "Изменить задачу или встречу (по названию/дате без знания ID)",
      description:
        "Точечно изменяет любые поля существующей задачи или встречи. Находит задачу по текстовому запросу query и опциональной target_date (либо по task_id). Передавай только те поля, которые нужно поменять; будильники в reminders_queue пересчитаются автоматически.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Текстовый поиск целевой задачи по названию (не нужно знать ID)"),
        target_date: z
          .string()
          .optional()
          .describe("Опциональная дата YYYY-MM-DD (или today/tomorrow) для сужения поиска задачи"),
        task_id: z.number().int().positive().optional().describe("Опциональный точный ID задачи, если известен"),
        title: z.string().min(1).max(400).optional().describe("Новое название задачи"),
        description: z.string().max(4000).nullable().optional().describe("Новое описание/заметки (null чтобы очистить)"),
        subtasks: z
          .array(SubtaskEntrySchema)
          .optional()
          .describe("Полная замена чеклиста подзадач"),
        add_subtasks: z
          .array(z.string().min(1).max(400))
          .optional()
          .describe("Добавить новые пункты в существующий чеклист подзадач"),
        toggle_subtask_query: z
          .string()
          .optional()
          .describe("Отметить/снять подзадачу внутри чеклиста по её тексту"),
        project: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Новый проект по названию/ID (null чтобы отвязать от проекта)"),
        goal: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Новая цель по названию/ID (null чтобы отвязать)"),
        priority: PriorityFlexibleSchema.optional().describe("Новый приоритет 1..4"),
        tags: z.array(z.string().min(1).max(60)).optional().describe("Заменить массив тегов"),
        add_tags: z.array(z.string().min(1).max(60)).optional().describe("Добавить теги к существующим"),
        status: z
          .enum(["inbox", "todo", "in_progress", "waiting", "done", "cancelled"])
          .optional()
          .describe("Новый статус задачи"),
        date: z
          .string()
          .nullable()
          .optional()
          .describe("Новая дата в плане YYYY-MM-DD или today/tomorrow (null чтобы убрать дату)"),
        starts_at: z
          .string()
          .nullable()
          .optional()
          .describe("Новое точное время начала ЧЧ:ММ по МСК или ISO (null чтобы убрать точное время)"),
        ends_at: z
          .string()
          .nullable()
          .optional()
          .describe("Новое точное время окончания ЧЧ:ММ по МСК или ISO"),
        clear_exact_time: z
          .boolean()
          .optional()
          .describe("Если true — сбрасывает точное время, оставляя задачу в гибком слоте дня"),
        duration_minutes: z
          .number()
          .int()
          .min(5)
          .max(720)
          .nullable()
          .optional()
          .describe("Новая длительность в минутах"),
        day_slot: z
          .enum(["morning", "afternoon", "evening", "any"])
          .optional()
          .describe("Новый гибкий слот дня: morning, afternoon, evening, any"),
        is_meeting: z.boolean().optional().describe("Изменить признак встречи/звонка"),
        due_date: z.string().nullable().optional().describe("Новый жёсткий дедлайн YYYY-MM-DD (null чтобы очистить)"),
        remind_before_minutes: RemindBeforeFlexibleSchema.optional().describe(
          "Обновить будильники (число или массив минут, например [30, 10] или 0; null чтобы отключить)"
        ),
        recurrence_rule: z.string().max(200).nullable().optional().describe("Обновить правило повтора"),
        waiting_for_person: z.string().max(200).nullable().optional().describe("От кого ждём ответ"),
        waiting_context: z.string().max(1000).nullable().optional().describe("Контекст ожидания"),
        follow_up_at: z.string().nullable().optional().describe("Новая дата/время напоминания по ожиданию"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const resolved = await resolveTaskTarget(db, {
          task_id: args.task_id,
          query: args.query,
          date: args.target_date,
          includeDone: true,
        });

        if (resolved.error) {
          return errResult(resolved.error);
        }
        if (resolved.candidates) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько похожих задач. Уточни дату или передай точный task_id.",
            candidates: resolved.candidates,
          });
        }

        const current = resolved.task!;
        const patch: TaskUpdate = {};

        if (args.title !== undefined) patch.title = args.title.trim();
        if (args.description !== undefined) {
          patch.notes = args.description ? args.description.trim() : null;
        }
        if (args.priority !== undefined) {
          patch.priority = normalizePriority(args.priority, current.priority);
        }
        if (args.status !== undefined) {
          patch.status = args.status;
          patch.completed_at = args.status === "done" ? new Date().toISOString() : null;
        }
        if (args.is_meeting !== undefined) patch.is_meeting = args.is_meeting;
        if (args.day_slot !== undefined) patch.day_slot = args.day_slot;
        if (args.duration_minutes !== undefined) patch.estimated_minutes = args.duration_minutes;
        if (args.due_date !== undefined) patch.due_date = resolveDateInput(args.due_date);
        if (args.recurrence_rule !== undefined) {
          patch.recurrence_rule = args.recurrence_rule ? args.recurrence_rule.trim() : null;
        }

        // Tags update
        if (args.tags !== undefined) {
          patch.tags = args.tags;
        } else if (args.add_tags?.length) {
          patch.tags = Array.from(new Set([...(current.tags ?? []), ...args.add_tags]));
        }

        // Subtasks update
        const existingSubs: SubtaskItem[] = Array.isArray(current.subtasks)
          ? (current.subtasks as unknown as SubtaskItem[])
          : [];
        if (args.subtasks !== undefined) {
          patch.subtasks = (normalizeSubtasksInput(args.subtasks) ?? []) as unknown as Json;
        } else if (args.add_subtasks?.length || args.toggle_subtask_query) {
          let nextSubs = [...existingSubs];
          if (args.add_subtasks?.length) {
            const added = normalizeSubtasksInput(args.add_subtasks) ?? [];
            nextSubs = [...nextSubs, ...added];
          }
          if (args.toggle_subtask_query?.trim()) {
            const qSub = args.toggle_subtask_query.trim().toLowerCase();
            nextSubs = nextSubs.map((s) =>
              s.title.toLowerCase().includes(qSub) ? { ...s, done: !s.done } : s
            );
          }
          patch.subtasks = nextSubs as unknown as Json;
        }

        // Project & Goal links
        if (args.project !== undefined) {
          if (args.project === null || args.project === "") {
            patch.project_id = null;
          } else {
            const proj = await resolveProjectRef(db, args.project);
            if (!proj) {
              return errResult(`Проект «${args.project}» не найден.`);
            }
            patch.project_id = proj.id;
          }
        }

        if (args.goal !== undefined) {
          if (args.goal === null || args.goal === "") {
            patch.goal_id = null;
          } else {
            const goal = await resolveGoalRef(db, args.goal);
            if (!goal) {
              return errResult(`Цель «${args.goal}» не найдена.`);
            }
            patch.goal_id = goal.id;
          }
        }

        // Date & exact time rescheduling
        const effectiveIsMeeting = args.is_meeting ?? current.is_meeting;
        const effectiveDuration =
          args.duration_minutes !== undefined ? args.duration_minutes : current.estimated_minutes;

        if (args.clear_exact_time || args.starts_at === null) {
          patch.scheduled_start_at = null;
          patch.scheduled_end_at = null;
          if (args.date !== undefined) {
            patch.planned_date = resolveDateInput(args.date);
          }
        } else if (args.starts_at !== undefined || args.ends_at !== undefined || args.date !== undefined) {
          const nextDateStr =
            args.date !== undefined
              ? resolveDateInput(args.date)
              : current.planned_date ??
                (current.scheduled_start_at
                  ? extractLocalTimeParts(current.scheduled_start_at, DEFAULT_TIMEZONE).dateStr
                  : formatIsoDate());

          const nextStartClockOrIso =
            args.starts_at !== undefined
              ? args.starts_at
              : current.scheduled_start_at
                ? extractLocalTimeParts(current.scheduled_start_at, DEFAULT_TIMEZONE).timeStr
                : null;

          if (nextStartClockOrIso && nextDateStr) {
            const sched = resolveScheduleInputs({
              plannedDate: nextDateStr,
              startsAt: nextStartClockOrIso,
              endsAt: args.ends_at ?? null,
              durationMinutes: effectiveDuration,
              isMeeting: effectiveIsMeeting,
              daySlot: (args.day_slot ?? (current.day_slot as DaySlot)) || "any",
            });
            patch.planned_date = sched.planned_date;
            patch.scheduled_start_at = sched.scheduled_start_at;
            patch.scheduled_end_at = sched.scheduled_end_at;
            patch.day_slot = args.day_slot ?? sched.day_slot;
            patch.estimated_minutes = sched.estimated_minutes;
          } else {
            patch.planned_date = nextDateStr;
            if (nextDateStr === null) {
              patch.scheduled_start_at = null;
              patch.scheduled_end_at = null;
            }
          }
        }

        // Reminders update
        const willHaveStart =
          patch.scheduled_start_at !== undefined
            ? Boolean(patch.scheduled_start_at)
            : Boolean(current.scheduled_start_at);

        if (args.remind_before_minutes !== undefined) {
          const rem = normalizeRemindInput(args.remind_before_minutes, willHaveStart);
          patch.remind_before_minutes = rem.remind_before_minutes;
          patch.remind_offsets_minutes = rem.remind_offsets_minutes;
          if (rem.reminder_sent_at !== undefined) {
            patch.reminder_sent_at = rem.reminder_sent_at;
          }
        }

        // Waiting block update
        if (args.waiting_for_person !== undefined) {
          patch.waiting_on_person = args.waiting_for_person?.trim() || null;
          if (patch.waiting_on_person && args.status === undefined && current.status !== "waiting") {
            patch.status = "waiting";
            patch.waiting_since = formatIsoDate();
          }
        }
        if (args.waiting_context !== undefined) {
          patch.waiting_context = args.waiting_context?.trim() || null;
        }
        if (args.follow_up_at !== undefined) {
          patch.follow_up_at = resolveFollowUpTimestamp(args.follow_up_at);
        }

        const updated = await updateTask(db, current.id, patch);

        const conflicts = updated.scheduled_start_at
          ? await findTimeConflicts(db, {
              startAt: updated.scheduled_start_at,
              endAt: updated.scheduled_end_at,
              durationMinutes: updated.estimated_minutes,
              isMeeting: updated.is_meeting,
              excludeTaskId: updated.id,
            })
          : [];

        const syncedReminders = (
          await listRemindersQueue(db, { status: "pending", limit: 30 })
        ).filter((r) => r.entity_id === String(updated.id));

        return okResult({
          ok: true,
          task: formatTaskForMcp(updated),
          reminders_scheduled: syncedReminders.map((r) => ({
            id: r.id,
            entity_type: r.entity_type,
            trigger_at: r.trigger_at,
            trigger_time_msk: extractLocalTimeParts(r.trigger_at, DEFAULT_TIMEZONE).timeStr,
          })),
          schedule_conflicts: conflicts.map((c) => ({
            id: c.task.id,
            title: c.task.title,
            time_msk: c.timeRangeLabel,
          })),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "complete_task",
    {
      title: "Отметить задачу выполненной (или вернуть в работу)",
      description:
        "Отмечает одну или несколько задач выполненными (done: true) либо возвращает в работу (done: false) по текстовому запросу/названию и дате без знания ID. Автоматически отменяет ожидающие будильники задачи.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Название или ключевые слова задачи (например, 'позвонить Даше' или 'спортзал')"),
        queries: z
          .array(z.string().min(1))
          .optional()
          .describe("Массив названий задач, если нужно отметить сразу несколько дел за один раз"),
        date: z
          .string()
          .optional()
          .describe("Опциональная дата YYYY-MM-DD или today/tomorrow для уточнения"),
        task_id: z.number().int().positive().optional().describe("Опциональный ID задачи"),
        done: z
          .boolean()
          .optional()
          .describe("true — отметить выполненной (по умолчанию), false — вернуть обратно в todo"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const markDone = args.done ?? true;

        if (args.queries && args.queries.length > 0) {
          const updatedTasks: ReturnType<typeof formatTaskForMcp>[] = [];
          const unresolved: Array<{ query: string; reason: string; candidates?: unknown }> = [];

          for (const q of args.queries) {
            const res = await resolveTaskTarget(db, {
              query: q,
              date: args.date,
              includeDone: !markDone,
            });
            if (res.task) {
              const upd = await toggleTaskDone(db, res.task.id, markDone);
              updatedTasks.push(formatTaskForMcp(upd));
            } else {
              unresolved.push({
                query: q,
                reason: res.error ?? "Найдено несколько вариантов",
                candidates: res.candidates,
              });
            }
          }

          return okResult({
            ok: updatedTasks.length > 0,
            done: markDone,
            updated_count: updatedTasks.length,
            updated_tasks: updatedTasks,
            unresolved,
          });
        }

        const resolved = await resolveTaskTarget(db, {
          task_id: args.task_id,
          query: args.query,
          date: args.date,
          includeDone: true,
        });

        if (resolved.error) return errResult(resolved.error);
        if (resolved.candidates) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько подходящих задач — уточни название, дату или выбери task_id.",
            candidates: resolved.candidates,
          });
        }

        const updated = await toggleTaskDone(db, resolved.task!.id, markDone);
        return okResult({
          ok: true,
          done: markDone,
          task: formatTaskForMcp(updated),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "delete_task",
    {
      title: "Удалить задачу или встречу",
      description:
        "Удаляет задачу или встречу по текстовому запросу и опциональной дате (либо по task_id) и автоматически отменяет все её будильники в reminders_queue.",
      inputSchema: {
        query: z.string().optional().describe("Название удаляемой задачи"),
        date: z.string().optional().describe("Опциональная дата задачи YYYY-MM-DD или today/tomorrow"),
        task_id: z.number().int().positive().optional().describe("Опциональный ID задачи"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const resolved = await resolveTaskTarget(db, {
          task_id: args.task_id,
          query: args.query,
          date: args.date,
          includeDone: true,
        });

        if (resolved.error) return errResult(resolved.error);
        if (resolved.candidates) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько похожих задач. Уточни дату или task_id перед удалением.",
            candidates: resolved.candidates,
          });
        }

        const victim = resolved.task!;
        await deleteTask(db, victim.id);
        return okResult({
          ok: true,
          deleted_task: {
            id: victim.id,
            title: victim.title,
            planned_date: victim.planned_date,
          },
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "set_day_plan",
    {
      title: "Обновить фокус, буфер и ёмкость дня",
      description:
        "Устанавливает главный фокус дня (main_focus), доступное время (available_minutes), защитный буфер (buffer_minutes), режим энергии и заметку к плану дня.",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("Дата YYYY-MM-DD или today/tomorrow (по умолчанию сегодня по МСК)"),
        main_focus: z.string().max(500).nullable().optional().describe("Главная опора / фокус дня"),
        available_minutes: z
          .number()
          .int()
          .min(60)
          .max(1440)
          .optional()
          .describe("Всего рабочих минут на день (например, 480 = 8 часов)"),
        buffer_minutes: z
          .number()
          .int()
          .min(0)
          .max(720)
          .optional()
          .describe("Защитный резерв дня в минутах (например, 90)"),
        energy_mode: z
          .enum(["low", "normal", "high", "recovery"])
          .optional()
          .describe("Режим энергии дня: low, normal, high, recovery"),
        notes: z.string().max(2000).nullable().optional().describe("Заметка к плану дня"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const planDate = resolveDateInput(args.date) ?? formatIsoDate();
        const saved = await upsertDayPlan(db, userId, planDate, {
          main_focus: args.main_focus !== undefined ? args.main_focus : undefined,
          available_minutes: args.available_minutes,
          buffer_minutes: args.buffer_minutes,
          energy_mode: args.energy_mode,
          notes: args.notes !== undefined ? args.notes : undefined,
        });
        return okResult({ ok: true, day_plan: saved });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 3. PROJECTS MANAGEMENT TOOLS
  // ==========================================================================

  server.registerTool(
    "list_projects",
    {
      title: "Список проектов",
      description: "Возвращает все проекты со статистикой активных и выполненных задач.",
      inputSchema: {
        include_archived: z.boolean().optional().describe("Включать архивные проекты (по умолчанию false)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const [projects, tasks] = await Promise.all([
          listProjects(db, args.include_archived ?? false),
          listTasks(db, { includeDone: true }),
        ]);

        const items = projects.map((p) => {
          const projTasks = tasks.filter((t) => t.project_id === p.id && t.status !== "cancelled");
          const activeCount = projTasks.filter((t) => t.status !== "done").length;
          const doneCount = projTasks.filter((t) => t.status === "done").length;
          return {
            ...p,
            active_tasks_count: activeCount,
            completed_tasks_count: doneCount,
          };
        });

        return okResult({ ok: true, count: items.length, projects: items });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "create_project",
    {
      title: "Создать проект",
      description: "Создаёт новый проект в выбранной сфере жизни (work, study, launch, personal, health).",
      inputSchema: {
        title: z.string().min(1).max(250).describe("Название проекта"),
        life_area: z
          .enum(["work", "study", "launch", "personal", "health"])
          .optional()
          .describe("Сфера проекта (по умолчанию work)"),
        description: z.string().max(2000).nullable().optional().describe("Описание или критерий завершения"),
        due_date: z.string().nullable().optional().describe("Целевая дата завершения YYYY-MM-DD"),
        goal: z.union([z.string(), z.number()]).nullable().optional().describe("Связанная цель по названию или ID"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const area: LifeArea = args.life_area ?? "work";
        const goal = await resolveGoalRef(db, args.goal);
        const created = await createProject(db, {
          user_id: userId,
          title: args.title.trim(),
          life_area: area,
          accent_token: ACCENT_BY_AREA[area],
          description: args.description?.trim() || null,
          due_date: resolveDateInput(args.due_date),
          goal_id: goal?.id ?? null,
          status: "active",
        });
        return okResult({ ok: true, project: created });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "update_project",
    {
      title: "Изменить проект (по названию или ID)",
      description: "Обновляет название, сферу, описание, дедлайн или статус проекта.",
      inputSchema: {
        query: z.string().optional().describe("Текущее название проекта для поиска"),
        project_id: z.number().int().positive().optional().describe("Опциональный ID проекта"),
        title: z.string().min(1).max(250).optional().describe("Новое название проекта"),
        life_area: z.enum(["work", "study", "launch", "personal", "health"]).optional(),
        description: z.string().max(2000).nullable().optional(),
        due_date: z.string().nullable().optional().describe("Дедлайн YYYY-MM-DD или null"),
        status: z.enum(["active", "on_hold", "completed", "archived"]).optional(),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        let targetId = args.project_id;
        if (!targetId) {
          if (!args.query?.trim()) {
            return errResult("Укажи `query` (название проекта) или `project_id`.");
          }
          const matches = await findProjectsByFuzzyQuery(db, args.query.trim(), true);
          if (matches.length === 0) {
            return errResult(`Проект по запросу «${args.query}» не найден.`);
          }
          targetId = matches[0].project.id;
        }

        const updated = await updateProject(db, targetId, {
          title: args.title?.trim(),
          life_area: args.life_area,
          accent_token: args.life_area ? ACCENT_BY_AREA[args.life_area] : undefined,
          description:
            args.description !== undefined ? args.description?.trim() || null : undefined,
          due_date: args.due_date !== undefined ? resolveDateInput(args.due_date) : undefined,
          status: args.status,
        });
        return okResult({ ok: true, project: updated });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "delete_project",
    {
      title: "Удалить проект (по названию или ID)",
      description:
        "Удаляет проект (задачи внутри проекта не удаляются, а аккуратно отвязываются от него).",
      inputSchema: {
        query: z.string().optional().describe("Название удаляемого проекта"),
        project_id: z.number().int().positive().optional().describe("ID удаляемого проекта"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const proj = await resolveProjectRef(db, args.project_id ?? args.query);
        if (!proj) {
          return errResult("Проект для удаления не найден.");
        }
        await deleteProject(db, proj.id);
        return okResult({
          ok: true,
          deleted_project: { id: proj.id, title: proj.title },
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 4. QUICK REMINDERS QUEUE TOOLS (`reminders_queue` + `packages/notifier`)
  // ==========================================================================

  server.registerTool(
    "create_reminder",
    {
      title: "Поставить быструю напоминалку в Telegram",
      description:
        "Создаёт точный будильник в таблице reminders_queue (например: «напомни через 20 минут выключить духовку» или «напомни завтра в 09:30 позвонить врачу»). Сервис packages/notifier доставит пуш-уведомление в Telegram секунда в секунду.",
      inputSchema: {
        message_text: z
          .string()
          .min(1)
          .max(1000)
          .describe("Текст напоминания (что именно нужно сделать)"),
        in_minutes: z
          .number()
          .min(0.1)
          .max(43200)
          .optional()
          .describe("Через сколько минут прислать уведомление (например, 20 для «через 20 минут»)"),
        date: z
          .string()
          .optional()
          .describe("Дата напоминания YYYY-MM-DD или today/tomorrow (если указано time_msk)"),
        time_msk: z
          .string()
          .optional()
          .describe("Точное время ЧЧ:ММ по Москве (например, '18:45')"),
        trigger_at: z
          .string()
          .optional()
          .describe("Альтернативно: полный ISO-таймстемп срабатывания"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        let triggerIso: string;

        if (args.in_minutes !== undefined) {
          triggerIso = new Date(Date.now() + Math.round(args.in_minutes * 60_000)).toISOString();
        } else if (args.time_msk) {
          const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(args.time_msk.trim());
          if (!m) {
            return errResult("Некорректный формат `time_msk` — укажи ЧЧ:ММ (например, 18:30).");
          }
          const hhmm = `${m[1].padStart(2, "0")}:${m[2]}`;
          let baseDate = resolveDateInput(args.date) ?? formatIsoDate();
          let candidateIso = localClockToUtcIso(baseDate, hhmm, DEFAULT_TIMEZONE);
          // If no explicit date was passed and the clock time already passed today, schedule for tomorrow
          if (!args.date && Date.parse(candidateIso) <= Date.now() - 30_000) {
            baseDate = addDaysForReminder(baseDate, 1);
            candidateIso = localClockToUtcIso(baseDate, hhmm, DEFAULT_TIMEZONE);
          }
          triggerIso = candidateIso;
        } else if (args.trigger_at) {
          const parsed = Date.parse(args.trigger_at);
          if (Number.isNaN(parsed)) {
            return errResult(`Некорректный trigger_at: "${args.trigger_at}"`);
          }
          triggerIso = new Date(parsed).toISOString();
        } else {
          return errResult("Укажи `in_minutes` (через сколько минут), `time_msk` (ЧЧ:ММ) или `trigger_at`.");
        }

        const created = await createStandaloneReminder(db, {
          userId,
          triggerAt: triggerIso,
          messageText: args.message_text.trim(),
        });

        const mskParts = extractLocalTimeParts(created.trigger_at, DEFAULT_TIMEZONE);
        return okResult({
          ok: true,
          reminder: {
            id: created.id,
            status: created.status,
            trigger_at: created.trigger_at,
            trigger_msk: `${mskParts.dateStr} ${mskParts.timeStr}`,
            telegram_chat_id: created.telegram_chat_id,
            message_text: args.message_text.trim(),
          },
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "list_reminders",
    {
      title: "Список запланированных будильников и напоминаний",
      description: "Показывает очередь уведомлений в reminders_queue (по умолчанию активные pending).",
      inputSchema: {
        status: z
          .enum(["pending", "sent", "cancelled", "failed"])
          .optional()
          .describe("Статус напоминаний (по умолчанию pending)"),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const rows = await listRemindersQueue(db, {
          status: args.status ?? "pending",
          limit: args.limit ?? 40,
        });
        return okResult({
          ok: true,
          count: rows.length,
          reminders: rows.map((r) => {
            const msk = extractLocalTimeParts(r.trigger_at, DEFAULT_TIMEZONE);
            return {
              id: r.id,
              entity_type: r.entity_type,
              entity_id: r.entity_id,
              status: r.status,
              trigger_at: r.trigger_at,
              trigger_msk: `${msk.dateStr} ${msk.timeStr}`,
              message_text: r.message_text.replace(/<[^>]+>/g, ""),
            };
          }),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "cancel_reminder",
    {
      title: "Отменить будильник / напоминание",
      description: "Отменяет ожидающее напоминание в reminders_queue по тексту запроса или ID.",
      inputSchema: {
        query: z.string().optional().describe("Текст напоминания для поиска"),
        reminder_id: z.number().int().positive().optional().describe("ID записи в reminders_queue"),
        cancel_all_matches: z.boolean().optional().describe("Отменить все совпавшие напоминания"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const target = args.reminder_id ?? args.query?.trim();
        if (!target) {
          return errResult("Укажи `query` (текст напоминания) или `reminder_id`.");
        }
        const res = await cancelReminderByIdOrQuery(db, target, {
          cancelAllMatches: args.cancel_all_matches ?? false,
        });
        if (res.candidates && res.candidates.length > 0) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько активных напоминаний. Уточни reminder_id или передай cancel_all_matches: true.",
            candidates: res.candidates.map((c) => ({
              id: c.id,
              trigger_at: c.trigger_at,
              message_text: c.message_text.replace(/<[^>]+>/g, ""),
            })),
          });
        }
        return okResult({
          ok: true,
          cancelled_count: res.cancelled.length,
          cancelled: res.cancelled.map((c) => ({
            id: c.id,
            trigger_at: c.trigger_at,
            message_text: c.message_text.replace(/<[^>]+>/g, ""),
          })),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 5. WORKING AGREEMENTS (`assistant_agreements`)
  // ==========================================================================

  server.registerTool(
    "manage_agreement",
    {
      title: "Управление личными договорённостями с ассистентом",
      description:
        "Просмотр, добавление, включение/выключение или удаление рабочих правил пользователя (например: «после 19:00 рабочие созвоны не ставить»). Системные настройки самого сайта меняются только в вебе.",
      inputSchema: {
        action: z.enum(["list", "add", "toggle", "delete"]).describe("Действие над правилами"),
        rule_text: z.string().max(1000).optional().describe("Текст нового правила (для add) или поиск (для delete/toggle)"),
        scope: z
          .enum(["general", "planning", "finance", "health", "nutrition", "communication"])
          .optional()
          .describe("Сфера правила (по умолчанию planning)"),
        agreement_id: z.number().int().positive().optional().describe("Опциональный ID правила"),
        is_active: z.boolean().optional().describe("Активность правила для toggle"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        if (args.action === "list") {
          const all = await listAssistantAgreements(db, false);
          return okResult({ ok: true, count: all.length, agreements: all });
        }
        if (args.action === "add") {
          if (!args.rule_text?.trim()) {
            return errResult("Для добавления правила укажи `rule_text`.");
          }
          const created = await createAssistantAgreement(db, {
            user_id: userId,
            scope: args.scope ?? "planning",
            rule_text: args.rule_text.trim(),
            source: "telegram_confirmed",
          });
          return okResult({ ok: true, agreement: created });
        }

        const all = await listAssistantAgreements(db, false);
        const match = args.agreement_id
          ? all.find((a) => a.id === args.agreement_id)
          : args.rule_text?.trim()
            ? all.find((a) =>
                a.rule_text.toLowerCase().includes(args.rule_text!.trim().toLowerCase())
              )
            : undefined;

        if (!match) {
          return errResult("Договорённость не найдена по указанному запросу или ID.");
        }

        if (args.action === "delete") {
          await deleteAssistantAgreement(db, match.id);
          return okResult({ ok: true, deleted: match });
        }

        const updated = await updateAssistantAgreement(db, match.id, {
          is_active: args.is_active ?? !match.is_active,
        });
        return okResult({ ok: true, agreement: updated });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

function addDaysForReminder(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0)).toISOString().slice(0, 10);
}
