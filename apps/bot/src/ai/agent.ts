import { generateText, tool, isStepCount, type ModelMessage } from "ai";
import { z } from "zod";
import {
  addDaysToIsoDate,
  appendAssistantMessage,
  areTaskTitlesSimilar,
  buildScheduledRangeFromClockTime,
  createAssistantAgreement,
  createPendingAction,
  createProject,
  createStateCheckin,
  deleteAssistantAgreement,
  deleteDailyReview,
  deleteProject,
  deleteStateCheckin,
  deleteTask,
  extractLocalTimeParts,
  findSimilarActiveTasks,
  findTasksByFuzzyQuery,
  findTimeConflicts,
  formatIsoDate,
  formatTaskTimeRange,
  getAssistantFullContext,
  getDailyReview,
  getOrCreateThread,
  getRecentThreadMessages,
  listAssistantAgreements,
  listEveningCriteria,
  listPendingActions,
  listProjects,
  listStateCheckins,
  listTasks,
  listTasksInDateRange,
  toggleTaskDone,
  updateAssistantAgreement,
  updatePendingAction,
  updateProject,
  updateStateCheckin,
  updateTask,
  upsertDailyReview,
  upsertDayPlan,
  type DaySlot,
  type LifeArea,
  type PendingAction,
  type Project,
  type Task,
  type TaskStatus,
  type TaskUpdate,
  type TypedSupabaseClient,
} from "@life-os/db";
import { getPolzaVisionFallbackModel, getPrimaryChatModel } from "./providers";
import {
  formatAgreementPreview,
  formatCreateTasksPreview,
  formatDayPlanPreview,
  formatRescheduleTasksPreview,
  formatTransactionsPreview,
  type StagedTaskItem,
  type StagedTaskRescheduleItem,
} from "./preview-cards";
import type { TopicDomain } from "../telegram-helpers";

export interface AgentTurnInput {
  db: TypedSupabaseClient;
  userId: string;
  telegramChatId: number;
  messageThreadId?: number;
  topicDomain: TopicDomain;
  userText: string;
  modality: "text" | "voice" | "photo";
  voiceTranscript?: string;
  imageAttachment?: {
    buffer: Buffer;
    mimeType: string;
  };
}

export interface StagedCardResult {
  action: PendingAction;
  replacedActionId?: number;
}

export interface AgentTurnOutput {
  replyText: string;
  stagedCards: StagedCardResult[];
}

function buildSevenDayCalendarHint(todayDate: string, timeZone: string): string {
  const lines: string[] = [];
  for (let offset = -1; offset < 7; offset += 1) {
    const dStr = addDaysToIsoDate(todayDate, offset);
    const [y, m, d] = dStr.split("-").map(Number);
    const weekday = new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      weekday: "long",
    }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
    const prefix =
      offset === -1
        ? "Вчера"
        : offset === 0
          ? "Сегодня"
          : offset === 1
            ? "Завтра"
            : offset === 2
              ? "Послезавтра"
              : "";
    lines.push(`  • ${dStr} — ${weekday}${prefix ? ` (${prefix})` : ""}`);
  }
  return lines.join("\n");
}

function formatTaskLineForPrompt(t: Task, timeZone: string): string {
  const timeRange = formatTaskTimeRange(t, timeZone);
  const timePart = timeRange ? `🕙 ${timeRange}` : `слот: ${t.day_slot}`;
  const meetTag = t.is_meeting ? " [ВСТРЕЧА/СОЗВОН]" : "";
  const projTag = t.project_id ? ` [proj#${t.project_id}]` : "";
  const estPart = !timeRange && t.estimated_minutes ? `, ~${t.estimated_minutes}м` : "";
  return `  - [#${t.id}] ${t.planned_date ?? "без даты"} (${timePart}${estPart})${meetTag}${projTag} [${t.status}] P${t.priority}: ${t.title}`;
}

function resolveClearFuzzyMatch(
  matches: Array<{ task: Task; score: number }>
): { resolved: Task | null; candidates: Array<{ id: number; title: string; planned_date: string | null; status: string; score: number }> } {
  const candidates = matches.slice(0, 5).map((m) => ({
    id: m.task.id,
    title: m.task.title,
    planned_date: m.task.planned_date,
    status: m.task.status,
    score: Number(m.score.toFixed(2)),
  }));

  if (matches.length === 0) return { resolved: null, candidates };
  const first = matches[0]!;
  if (matches.length === 1 && first.score >= 0.45) {
    return { resolved: first.task, candidates };
  }
  const second = matches[1]!;
  if (first.score >= 0.85 && first.score - second.score >= 0.15) {
    return { resolved: first.task, candidates };
  }
  if (first.score >= 0.65 && first.score - second.score >= 0.25) {
    return { resolved: first.task, candidates };
  }
  return { resolved: null, candidates };
}

function buildSystemPrompt(params: {
  todayDate: string;
  nowClockStr: string;
  timeZone: string;
  calendarHint: string;
  topicDomain: TopicDomain;
  personaName: string;
  customSystemPrompt: string;
  toneGuidelines: string;
  agreements: Array<{ id: number; scope: string; rule_text: string }>;
  projectsSummary: string;
  dayPlan: {
    available_minutes: number;
    buffer_minutes: number;
    main_focus: string | null;
    energy_mode: string;
  } | null;
  todayTasksSummary: string;
  upcoming14DaysSummary: string;
  waitingSummary: string;
  latestPulseSummary: string;
  todayReviewSummary: string;
  safeToSpendSummary: string;
  openPendingSummary: string;
  editingAction: PendingAction | null;
}): string {
  const agreementsBlock =
    params.agreements.length > 0
      ? params.agreements
          .map((a) => `  • [#${a.id}] [${a.scope}] ${a.rule_text}`)
          .join("\n")
      : "  Пока нет отдельных зафиксированных правил.";

  const avail = params.dayPlan?.available_minutes ?? 480;
  const buf = params.dayPlan?.buffer_minutes ?? 90;
  const netCapacity = Math.max(avail - buf, 0);

  const editingBlock = params.editingAction
    ? [
        "=== АКТИВНОЕ РЕДАКТИРОВАНИЕ КАРТОЧКИ ПРЕВЬЮ ===",
        `Пользователь нажал «✏️ Исправить» на карточке #${params.editingAction.id} (тип: ${params.editingAction.action_kind}).`,
        `Текущий черновик payload: ${JSON.stringify(params.editingAction.payload)}`,
        "Учти правку пользователя и вызови соответствующий stage-инструмент заново — он автоматически обновит эту карточку!",
      ].join("\n")
    : "";

  return [
    `Ты — «${params.personaName}», персональный бизнес- и лайф-ассистент внутри системы Life OS.`,
    `Сейчас: ${params.todayDate}, ${params.nowClockStr} (часовой пояс владельца: ${params.timeZone}, Москва UTC+3). Активный топик: ${params.topicDomain}.`,
    "Календарная сетка (сверяй дни недели строго по ней):",
    params.calendarHint,
    "",
    "=== ЛИЧНОСТЬ И ТОН ===",
    params.customSystemPrompt,
    `Тон общения: ${params.toneGuidelines}`,
    "",
    "=== ФОРМАТИРОВАНИЕ ОТВЕТОВ В TELEGRAM (НИКАКИХ СТЕН ТЕКСТА!) ===",
    "• Пиши КОРОТКИМИ воздушными блоками: максимум 1–2 предложения в одном абзаце, разделяй блоки пустой строкой.",
    "• Используй жирные мини-заголовки с эмодзи для структуры (`**⚡️ Сделано**`, `**📌 Главное**`, `**🗓 План**`, `**💡 Варианты**`), когда в ответе больше одной мысли.",
    "• Перечисления оформляй лаконичными буллитами `- ` (по одной короткой строке на пункт).",
    "• Никакого канцелярита, воды и длинных простыней текста.",
    "",
    "=== ЛИЧНЫЕ ДОГОВОРЁННОСТИ И ПРАВИЛА ВЛАДЕЛЬЦА ===",
    agreementsBlock,
    "",
    "=== АКТИВНЫЕ ПРОЕКТЫ ===",
    params.projectsSummary,
    "",
    "=== КАРТИНА СЕГОДНЯШНЕГО ДНЯ ===",
    `• Главный фокус дня: ${params.dayPlan?.main_focus || "не выбран"}`,
    `• Ресурс времени: доступно ${avail} мин, резерв ${buf} мин → чистая ёмкость ${netCapacity} мин (режим: ${params.dayPlan?.energy_mode ?? "normal"}).`,
    `• Задачи на сегодня (${params.todayDate}):\n${params.todayTasksSummary}`,
    `• Лист ожидания ответа (Waiting-For):\n${params.waitingSummary}`,
    `• Последний пульс состояния: ${params.latestPulseSummary}`,
    `• Вечерняя оценка сегодня: ${params.todayReviewSummary}`,
    `• Финансовый ориентир: ${params.safeToSpendSummary}`,
    "",
    "=== УЖЕ СОХРАНЁННЫЕ ЗАДАЧИ И ВСТРЕЧИ В БАЗЕ НА БЛИЖАЙШИЕ 14 ДНЕЙ (ПОВТОРНО НЕ СОЗДАВАТЬ!) ===",
    params.upcoming14DaysSummary,
    params.openPendingSummary,
    "",
    "=== ПРАВИЛА ИНСТРУМЕНТОВ И СТРОГИЙ АНТИ-ГАЛЛЮЦИНАЦИОННЫЙ ЗАПРЕТ ===",
    "1. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО ГАЛЛЮЦИНИРОВАТЬ ДЕЙСТВИЯ: НИКОГДА не пиши «Отметил», «Закрыл», «Перенёс», «Удалил», «Создал проект», «Сохранил пульс/оценку», если ты В ЭТОМ ХОДЕ реально не вызвал соответствующий инструмент и не получил `{ ok: true }`!",
    "2. ПРЯМЫЕ КОМАНДЫ ВЛАДЕЛЬЦА (выполняй сразу через direct-инструменты, чтобы сайт обновился мгновенно):",
    "   • «Отметь выполненной / верни в работу задачу...» → `completeOrReopenTask`.",
    "   • «Перенеси конкретную задачу на 15:00 / завтра / в ожидание / измени название» → `updateExistingTask`.",
    "   • «Удали конкретную задачу» → `deleteExistingTask`.",
    "   • «Создай / переименуй / закрой / удали проект» → `manageProject`.",
    "   • «Поставь главный фокус дня / измени буфер» → `updateDayPlanFocus`.",
    "   • «Запиши / исправь / удали пульс состояния» → `manageStatePulse`.",
    "   • «Запиши / обнови / удали вечернюю оценку дня» → `manageEveningReview` (на одну дату всегда ровно одна оценка!).",
    "   • «Добавь / измени / удали личное правило» → `manageAssistantAgreement`.",
    "3. КАРТОЧКИ ПОДТВЕРЖДЕНИЯ (Human-in-the-Loop через `stage*` инструменты):",
    "   • Надиктовка НОВЫХ задач/встреч из речи, разбор завала (предложение слотов для нескольких дел) и запись трат/доходов → оформляй через `stageNewTasks`, `stageTaskUpdates`, `stageFinanceTransactions` (отправят превью с кнопками `[✅ Подтвердить запись]` / `[✏️ Исправить]` / `[❌ Отмена]`).",
    "4. ЗАПРЕТ ДУБЛЕЙ И ТОЧНОЕ ВРЕМЯ (`Europe/Moscow`): в `stageNewTasks` передавай ТОЛЬКО новые задачи из ТЕКУЩЕГО сообщения (никогда не дублируй задачи из блока «УЖЕ СОХРАНЁННЫЕ ЗАДАЧИ»). Любое точное время («в 22 ровно», «в 14:00», «завтра в 12») передавай в `scheduled_time` (`HH:MM`) + `planned_date`, а не в `notes`! При конфликте времени обязательно предупреди и предложи свободное окно.",
    editingBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

const HALLUCINATED_MUTATION_REGEX =
  /(?:отметил(?:а)?\b.*выполнен|закрыл(?:а)?\s+задач|удалил(?:а)?\s+(?:задач|проект|оценк|пульс)|создал(?:а)?\s+проект|перен[её]с\s+задач|сохранил(?:а)?\s+(?:оценк|пульс|фокус)|записал(?:а)?\s+(?:пульс|оценк))/i;

export async function runConversationalTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  const { db, userId, telegramChatId, messageThreadId, topicDomain } = input;

  const fullCtx = await getAssistantFullContext(db);
  const timeZone = fullCtx.overview.profile?.timezone || "Europe/Moscow";
  const now = new Date();
  const todayDate = formatIsoDate(now, timeZone);
  const nowClockStr = extractLocalTimeParts(now.toISOString(), timeZone).timeStr;
  const calendarHint = buildSevenDayCalendarHint(todayDate, timeZone);

  const thread = await getOrCreateThread(db, {
    userId,
    telegramChatId,
    messageThreadId,
    topicDomain,
  });

  const priorMessages = await getRecentThreadMessages(db, thread.id, 10);
  const pendingList = await listPendingActions(db, ["editing", "pending"]);
  const editingAction =
    pendingList.find(
      (a) =>
        a.status === "editing" &&
        (a.thread_id === thread.id || a.telegram_chat_id === telegramChatId)
    ) ?? null;

  const openPendingForChat = pendingList.filter(
    (a) =>
      a.status === "pending" &&
      (a.thread_id === thread.id || a.telegram_chat_id === telegramChatId)
  );

  // Persist user message
  await appendAssistantMessage(db, {
    user_id: userId,
    thread_id: thread.id,
    role: "user",
    modality: input.modality,
    content: input.userText,
    voice_transcript: input.voiceTranscript ?? null,
  });

  const todayTasks = fullCtx.overview.todayTasks;
  const scheduledMinutes = todayTasks
    .filter((t) => t.status !== "done" && t.status !== "cancelled")
    .reduce((acc, t) => acc + (t.estimated_minutes ?? 30), 0);

  const todayTasksSummary =
    todayTasks.length > 0
      ? todayTasks.map((t) => formatTaskLineForPrompt(t, timeZone)).join("\n") +
        `\n  (Суммарно активных задач на сегодня ~${scheduledMinutes} мин)`
      : "  На сегодня задач пока нет.";

  const upcoming14DaysSummary =
    fullCtx.upcomingTasks.length > 0
      ? fullCtx.upcomingTasks.map((t) => formatTaskLineForPrompt(t, timeZone)).join("\n")
      : "  Запланированных активных задач на ближайшие 14 дней пока нет.";

  const projectsSummary =
    fullCtx.overview.projects.length > 0
      ? fullCtx.overview.projects
          .map(
            (p) =>
              `  • [#${p.id}] ${p.title} (сфера: ${p.life_area}, статус: ${p.status}${p.due_date ? `, срок: ${p.due_date}` : ""})`
          )
          .join("\n")
      : "  Активных проектов пока нет.";

  const waitingSummary =
    fullCtx.overview.waitingTasks.length > 0
      ? fullCtx.overview.waitingTasks
          .slice(0, 8)
          .map(
            (w) =>
              `  - [#${w.id}] ${w.title} (ждём: ${w.waiting_on_person || "не указан"}${w.follow_up_at ? `, напомнить ${w.follow_up_at.slice(0, 10)}` : ""})`
          )
          .join("\n")
      : "  Активных ожиданий нет.";

  const openPendingSummary =
    openPendingForChat.length > 0
      ? "\n=== ОТКРЫТЫЕ КАРТОЧКИ НА ПОДТВЕРЖДЕНИИ В ЧАТЕ ===\n" +
        openPendingForChat
          .slice(0, 3)
          .map(
            (p) =>
              `  - Карточка #${p.id} (${p.action_kind}, ждёт нажатия кнопки): ${JSON.stringify(p.payload)}`
          )
          .join("\n")
      : "";

  const latestCheckin = fullCtx.overview.latestCheckin;
  const latestPulseSummary = latestCheckin
    ? `[#${latestCheckin.id}] настроение ${latestCheckin.mood_score}/5, энергия ${latestCheckin.energy_score}/5 (${latestCheckin.logged_at.slice(0, 16)})${latestCheckin.note ? ` — «${latestCheckin.note}»` : ""}`
    : "сегодня ещё не отмечался.";

  const rev = fullCtx.todayReview;
  const todayReviewSummary = rev
    ? `заполнена (дела: ${rev.tasks_score ?? "—"}, здоровье: ${rev.health_score ?? "—"}, питание: ${rev.nutrition_score ?? "—"}, привычки: ${rev.habits_score ?? "—"}; главное: ${rev.day_highlight || "—"})`
    : "ещё не заполнена.";

  const fin = fullCtx.overview.financeSummary;
  const safeToSpendSummary = fin
    ? `Safe-to-Spend: ${Number(fin.safe_to_spend ?? 0).toLocaleString("ru-RU")} ₽ · Общий баланс: ${Number(fin.total_balance ?? 0).toLocaleString("ru-RU")} ₽ · Ожидают компенсации: ${Number(fin.pending_reimbursements ?? 0).toLocaleString("ru-RU")} ₽`
    : "счета пока не заполнены.";

  const systemPrompt = buildSystemPrompt({
    todayDate,
    nowClockStr,
    timeZone,
    calendarHint,
    topicDomain,
    personaName: fullCtx.settings?.persona_name || "Напарник",
    customSystemPrompt:
      fullCtx.settings?.system_prompt ||
      "Ты живой, собранный бизнес-ассистент владельца. Помогаешь держать фокус, не перегружать день без буфера и доводить дела до конца.",
    toneGuidelines:
      fullCtx.settings?.tone_guidelines ||
      "Общение на «ты», живое, короткое и структурное, иногда требовательное и с уместными подколами — строго без канцелярита и простыней текста.",
    agreements: fullCtx.agreements.map((a) => ({
      id: a.id,
      scope: a.scope,
      rule_text: a.rule_text,
    })),
    projectsSummary,
    dayPlan: fullCtx.overview.dayPlan,
    todayTasksSummary,
    upcoming14DaysSummary,
    waitingSummary,
    latestPulseSummary,
    todayReviewSummary,
    safeToSpendSummary,
    openPendingSummary,
    editingAction,
  });

  const stagedCards: StagedCardResult[] = [];

  async function saveOrReplacePendingCard(params: {
    actionKind: PendingAction["action_kind"];
    previewMarkdown: string;
    payload: Record<string, unknown>;
  }) {
    if (editingAction) {
      const updated = await updatePendingAction(db, editingAction.id, {
        action_kind: params.actionKind,
        preview_markdown: params.previewMarkdown,
        payload: params.payload as PendingAction["payload"],
        status: "pending",
      });
      stagedCards.push({ action: updated, replacedActionId: editingAction.id });
      return updated;
    }

    const created = await createPendingAction(db, {
      user_id: userId,
      thread_id: thread.id,
      action_kind: params.actionKind,
      preview_markdown: params.previewMarkdown,
      payload: params.payload as PendingAction["payload"],
      status: "pending",
      telegram_chat_id: telegramChatId,
    });
    stagedCards.push({ action: created });
    return created;
  }

  const tools = {
    // ------------------------------------------------------------------------
    // READ & QUERY TOOLS
    // ------------------------------------------------------------------------
    searchTasks: tool({
      description:
        "Ищет задачи и встречи за любой прошлый или будущий период, по статусу, проекту или по нечёткому названию.",
      inputSchema: z.object({
        status: z
          .enum(["inbox", "todo", "in_progress", "waiting", "done"])
          .optional()
          .describe("Фильтр по статусу"),
        fromDate: z.string().optional().describe("Начальная дата YYYY-MM-DD (включая прошлые дни)"),
        toDate: z.string().optional().describe("Конечная дата YYYY-MM-DD"),
        projectId: z.number().int().positive().optional(),
        query: z.string().optional().describe("Поиск по названию задачи"),
      }),
      execute: async ({ status, fromDate, toDate, projectId, query }) => {
        if (query && !fromDate && !toDate) {
          const fuzzy = await findTasksByFuzzyQuery(db, query, {
            status,
            includeDone: true,
            limit: 15,
          });
          return fuzzy.map(({ task: t, score }) => ({
            id: t.id,
            score: Number(score.toFixed(2)),
            title: t.title,
            status: t.status,
            priority: t.priority,
            project_id: t.project_id,
            planned_date: t.planned_date,
            day_slot: t.day_slot,
            time_range_msk: formatTaskTimeRange(t, timeZone),
            is_meeting: t.is_meeting,
            waiting_on_person: t.waiting_on_person,
          }));
        }

        const items =
          fromDate && toDate
            ? await listTasksInDateRange(db, {
                startDate: fromDate,
                endDate: toDate,
                includeDone: true,
                timeZone,
              })
            : await listTasks(db, {
                status,
                fromDate,
                toDate,
                projectId,
                includeDone: true,
              });

        const filtered = items.filter((t) => {
          if (status && t.status !== status) return false;
          if (projectId && t.project_id !== projectId) return false;
          if (query) {
            return `${t.title} ${t.notes ?? ""} ${t.waiting_on_person ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase());
          }
          return true;
        });

        return filtered.slice(0, 35).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          project_id: t.project_id,
          planned_date: t.planned_date,
          day_slot: t.day_slot,
          time_range_msk: formatTaskTimeRange(t, timeZone),
          is_meeting: t.is_meeting,
          remind_before_minutes: t.remind_before_minutes,
          estimated_minutes: t.estimated_minutes,
          waiting_on_person: t.waiting_on_person,
          follow_up_at: t.follow_up_at,
        }));
      },
    }),

    checkScheduleConflicts: tool({
      description:
        "Проверяет, свободно ли указанное точное время (Europe/Moscow) или есть пересечение с уже запланированными встречами/задачами.",
      inputSchema: z.object({
        planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        scheduled_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        scheduled_end_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
          .optional(),
        duration_minutes: z.number().int().min(5).max(480).optional(),
        is_meeting: z.boolean().default(true),
        exclude_task_id: z.number().int().positive().optional(),
      }),
      execute: async ({
        planned_date,
        scheduled_time,
        scheduled_end_time,
        duration_minutes,
        is_meeting,
        exclude_task_id,
      }) => {
        const range = buildScheduledRangeFromClockTime({
          dateStr: planned_date,
          startTime: scheduled_time,
          endTime: scheduled_end_time ?? null,
          durationMinutes: duration_minutes ?? null,
          isMeeting: is_meeting,
          timeZone,
        });
        const conflicts = await findTimeConflicts(db, {
          startAt: range.scheduled_start_at,
          endAt: range.scheduled_end_at,
          durationMinutes: range.estimated_minutes,
          isMeeting: is_meeting,
          excludeTaskId: exclude_task_id,
          timeZone,
        });
        return {
          has_conflicts: conflicts.length > 0,
          checked_slot: `${planned_date} ${scheduled_time} (${range.estimated_minutes} мин)`,
          conflicts: conflicts.map((c) => ({
            task_id: c.task.id,
            title: c.task.title,
            time_range_msk: c.timeRangeLabel,
            planned_date: c.plannedDate,
          })),
        };
      },
    }),

    // ------------------------------------------------------------------------
    // DIRECT EXECUTION TOOLS (FULL WEB PARITY — IMMEDIATE DB SYNC)
    // ------------------------------------------------------------------------
    completeOrReopenTask: tool({
      description:
        "Мгновенно отмечает одну или несколько существующих задач выполненными (done: true) или возвращает в работу (done: false) в базе данных Supabase. Работает как по task_id, так и по названию (title_query).",
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              task_id: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Точный ID задачи из списка [#id], если известен"),
              title_query: z
                .string()
                .optional()
                .describe("Название или ключевые слова задачи (например 'позвонить Даше')"),
              planned_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional(),
              done: z
                .boolean()
                .default(true)
                .describe("true = отметить выполненной, false = вернуть в невыполненные"),
            })
          )
          .min(1),
      }),
      execute: async ({ items }) => {
        const results: Array<Record<string, unknown>> = [];
        for (const item of items) {
          let targetId = item.task_id;
          if (!targetId && item.title_query) {
            let matches = await findTasksByFuzzyQuery(db, item.title_query, {
              plannedDate: item.planned_date,
              includeDone: !item.done,
              limit: 5,
            });
            if (matches.length === 0) {
              matches = await findTasksByFuzzyQuery(db, item.title_query, {
                plannedDate: item.planned_date,
                includeDone: true,
                limit: 5,
              });
            }
            const { resolved, candidates } = resolveClearFuzzyMatch(matches);
            if (!resolved) {
              results.push({
                ok: false,
                query: item.title_query,
                reason: candidates.length > 0 ? "ambiguous_match" : "task_not_found",
                candidates,
              });
              continue;
            }
            if ((item.done && resolved.status === "done") || (!item.done && resolved.status !== "done")) {
              results.push({
                ok: true,
                already_in_desired_state: true,
                task_id: resolved.id,
                title: resolved.title,
                new_status: resolved.status,
                planned_date: resolved.planned_date,
              });
              continue;
            }
            targetId = resolved.id;
          }

          if (!targetId) {
            results.push({
              ok: false,
              reason: "missing_task_id_or_title_query",
            });
            continue;
          }

          const updated = await toggleTaskDone(db, targetId, item.done);
          results.push({
            ok: true,
            task_id: updated.id,
            title: updated.title,
            new_status: updated.status,
            planned_date: updated.planned_date,
          });
        }

        return {
          ok: results.every((r) => r.ok === true),
          results,
        };
      },
    }),

    updateExistingTask: tool({
      description:
        "Мгновенно обновляет существующую задачу или встречу в БД: переносит дату/слот/точное время (HH:MM МСК), меняет название, проект, приоритет, длительность или переводит в «Ожидание».",
      inputSchema: z.object({
        task_id: z.number().int().positive().optional().describe("ID задачи [#id]"),
        title_query: z
          .string()
          .optional()
          .describe("Поиск задачи по названию, если ID не указан"),
        new_title: z.string().min(1).optional(),
        notes: z.string().nullable().optional(),
        project_id: z.number().int().positive().nullable().optional(),
        status: z
          .enum(["inbox", "todo", "in_progress", "waiting", "done", "cancelled"])
          .optional(),
        priority: z.number().int().min(1).max(4).optional(),
        planned_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        day_slot: z.enum(["morning", "afternoon", "evening", "any"]).optional(),
        scheduled_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
          .nullable()
          .optional()
          .describe("Точное время HH:MM по Москве (или null, чтобы сбросить точное время)"),
        scheduled_end_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
          .nullable()
          .optional(),
        estimated_minutes: z.number().int().min(5).max(480).nullable().optional(),
        is_meeting: z.boolean().optional(),
        remind_before_minutes: z.number().int().min(0).max(1440).nullable().optional(),
        waiting_on_person: z.string().nullable().optional(),
        waiting_context: z.string().nullable().optional(),
        follow_up_at: z.string().nullable().optional(),
      }),
      execute: async (params) => {
        let targetTask: Task | null = null;
        if (params.task_id) {
          targetTask =
            fullCtx.upcomingTasks.find((t) => t.id === params.task_id) ??
            fullCtx.overview.todayTasks.find((t) => t.id === params.task_id) ??
            fullCtx.overview.waitingTasks.find((t) => t.id === params.task_id) ??
            null;
          if (!targetTask) {
            const all = await listTasks(db, { includeDone: true });
            targetTask = all.find((t) => t.id === params.task_id) ?? null;
          }
        } else if (params.title_query) {
          const matches = await findTasksByFuzzyQuery(db, params.title_query, {
            includeDone: true,
            limit: 5,
          });
          const { resolved, candidates } = resolveClearFuzzyMatch(matches);
          if (!resolved) {
            return {
              ok: false,
              reason: candidates.length > 0 ? "ambiguous_match" : "task_not_found",
              candidates,
            };
          }
          targetTask = resolved;
        }

        if (!targetTask) {
          return { ok: false, reason: "task_not_found" };
        }

        const patch: TaskUpdate = {};
        if (params.new_title !== undefined) patch.title = params.new_title;
        if (params.notes !== undefined) patch.notes = params.notes;
        if (params.project_id !== undefined) patch.project_id = params.project_id;
        if (params.status !== undefined) {
          patch.status = params.status as TaskStatus;
          if (params.status === "done") patch.completed_at = new Date().toISOString();
          if (params.status === "waiting" && !targetTask.waiting_since) {
            patch.waiting_since = todayDate;
          }
        }
        if (params.priority !== undefined) patch.priority = params.priority;
        if (params.planned_date !== undefined) patch.planned_date = params.planned_date;
        if (params.day_slot !== undefined) patch.day_slot = params.day_slot;
        if (params.estimated_minutes !== undefined) {
          patch.estimated_minutes = params.estimated_minutes;
        }
        if (params.is_meeting !== undefined) patch.is_meeting = params.is_meeting;
        if (params.remind_before_minutes !== undefined) {
          patch.remind_before_minutes = params.remind_before_minutes;
        }
        if (params.waiting_on_person !== undefined) {
          patch.waiting_on_person = params.waiting_on_person;
        }
        if (params.waiting_context !== undefined) {
          patch.waiting_context = params.waiting_context;
        }
        if (params.follow_up_at !== undefined) patch.follow_up_at = params.follow_up_at;

        const conflicts: Array<{ id: number; title: string; time_range: string }> = [];
        if (params.scheduled_time === null) {
          patch.scheduled_start_at = null;
          patch.scheduled_end_at = null;
        } else if (params.scheduled_time) {
          const effDate = params.planned_date ?? targetTask.planned_date ?? todayDate;
          const effMeeting = params.is_meeting ?? targetTask.is_meeting;
          const effEst = params.estimated_minutes ?? targetTask.estimated_minutes;
          const built = buildScheduledRangeFromClockTime({
            dateStr: effDate,
            startTime: params.scheduled_time,
            endTime: params.scheduled_end_time ?? null,
            durationMinutes: effEst,
            isMeeting: effMeeting,
            timeZone,
          });
          patch.scheduled_start_at = built.scheduled_start_at;
          patch.scheduled_end_at = built.scheduled_end_at;
          patch.planned_date = built.planned_date;
          patch.day_slot = built.day_slot;
          patch.estimated_minutes = built.estimated_minutes;

          const foundConflicts = await findTimeConflicts(db, {
            startAt: built.scheduled_start_at,
            endAt: built.scheduled_end_at,
            durationMinutes: built.estimated_minutes,
            isMeeting: effMeeting,
            excludeTaskId: targetTask.id,
            timeZone,
          });
          for (const c of foundConflicts) {
            conflicts.push({
              id: c.task.id,
              title: c.task.title,
              time_range: c.timeRangeLabel,
            });
          }
        }

        const updated = await updateTask(db, targetTask.id, patch, timeZone);
        return {
          ok: true,
          task: {
            id: updated.id,
            title: updated.title,
            status: updated.status,
            planned_date: updated.planned_date,
            day_slot: updated.day_slot,
            time_range_msk: formatTaskTimeRange(updated, timeZone),
            project_id: updated.project_id,
          },
          has_conflicts: conflicts.length > 0,
          conflicts,
        };
      },
    }),

    deleteExistingTask: tool({
      description:
        "Удаляет конкретную задачу из базы данных по её ID или однозначному названию.",
      inputSchema: z.object({
        task_id: z.number().int().positive().optional(),
        title_query: z.string().optional(),
      }),
      execute: async ({ task_id, title_query }) => {
        let targetId = task_id;
        let deletedTitle = "";

        if (!targetId && title_query) {
          const matches = await findTasksByFuzzyQuery(db, title_query, {
            includeDone: true,
            limit: 5,
          });
          const { resolved, candidates } = resolveClearFuzzyMatch(matches);
          if (!resolved) {
            return {
              ok: false,
              reason: candidates.length > 0 ? "ambiguous_match" : "task_not_found",
              candidates,
            };
          }
          targetId = resolved.id;
          deletedTitle = resolved.title;
        } else if (targetId) {
          const all = await listTasks(db, { includeDone: true });
          const found = all.find((t) => t.id === targetId);
          if (!found) return { ok: false, reason: "task_not_found" };
          deletedTitle = found.title;
        }

        if (!targetId) return { ok: false, reason: "missing_task_id_or_title_query" };
        await deleteTask(db, targetId);
        return { ok: true, deleted_task_id: targetId, deleted_title: deletedTitle };
      },
    }),

    manageProject: tool({
      description:
        "Полное управление проектами: список проектов, создание нового проекта, редактирование (название, сфера, статус, дедлайн) или удаление проекта.",
      inputSchema: z.object({
        action: z.enum(["list", "create", "update", "delete"]),
        project_id: z.number().int().positive().optional(),
        title_query: z.string().optional().describe("Поиск проекта по названию для update/delete"),
        title: z.string().optional().describe("Название проекта (для create или переименования)"),
        description: z.string().nullable().optional(),
        life_area: z.enum(["work", "study", "launch", "personal", "health"]).optional(),
        due_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        status: z.enum(["active", "on_hold", "completed", "archived"]).optional(),
      }),
      execute: async (params) => {
        const allProjects = await listProjects(db, true);

        if (params.action === "list") {
          return {
            ok: true,
            projects: allProjects.map((p) => ({
              id: p.id,
              title: p.title,
              life_area: p.life_area,
              status: p.status,
              due_date: p.due_date,
              description: p.description,
            })),
          };
        }

        if (params.action === "create") {
          if (!params.title?.trim()) {
            return { ok: false, reason: "missing_project_title" };
          }
          const area: LifeArea = params.life_area ?? "work";
          const created = await createProject(db, {
            user_id: userId,
            title: params.title.trim(),
            description: params.description ?? null,
            life_area: area,
            accent_token: `domain-${area === "study" || area === "launch" ? "work" : area === "personal" ? "mind" : area}`,
            due_date: params.due_date ?? null,
            status: params.status ?? "active",
          });
          return { ok: true, created_project: created };
        }

        let target: Project | undefined;
        if (params.project_id) {
          target = allProjects.find((p) => p.id === params.project_id);
        } else if (params.title_query) {
          const q = params.title_query.trim().toLowerCase();
          target = allProjects.find(
            (p) =>
              p.title.toLowerCase() === q ||
              p.title.toLowerCase().includes(q) ||
              areTaskTitlesSimilar(p.title, params.title_query!)
          );
        }

        if (!target) {
          return {
            ok: false,
            reason: "project_not_found",
            available_projects: allProjects.map((p) => ({ id: p.id, title: p.title })),
          };
        }

        if (params.action === "delete") {
          await deleteProject(db, target.id);
          return { ok: true, deleted_project_id: target.id, deleted_title: target.title };
        }

        const updated = await updateProject(db, target.id, {
          ...(params.title ? { title: params.title.trim() } : {}),
          ...(params.description !== undefined ? { description: params.description } : {}),
          ...(params.life_area ? { life_area: params.life_area } : {}),
          ...(params.due_date !== undefined ? { due_date: params.due_date } : {}),
          ...(params.status ? { status: params.status } : {}),
        });
        return { ok: true, updated_project: updated };
      },
    }),

    updateDayPlanFocus: tool({
      description:
        "Мгновенно сохраняет главный фокус дня, доступное рабочее время, защитный резерв (буфер) или режим энергии для указанной даты.",
      inputSchema: z.object({
        plan_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .default(todayDate),
        main_focus: z.string().nullable().optional(),
        available_minutes: z.number().int().min(60).max(960).optional(),
        buffer_minutes: z.number().int().min(0).max(480).optional(),
        energy_mode: z.enum(["low", "normal", "high", "recovery"]).optional(),
        notes: z.string().nullable().optional(),
      }),
      execute: async (payload) => {
        const saved = await upsertDayPlan(db, userId, payload.plan_date, {
          ...(payload.main_focus !== undefined ? { main_focus: payload.main_focus } : {}),
          ...(payload.available_minutes !== undefined
            ? { available_minutes: payload.available_minutes }
            : {}),
          ...(payload.buffer_minutes !== undefined
            ? { buffer_minutes: payload.buffer_minutes }
            : {}),
          ...(payload.energy_mode !== undefined ? { energy_mode: payload.energy_mode } : {}),
          ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        });
        return { ok: true, day_plan: saved };
      },
    }),

    manageStatePulse: tool({
      description:
        "Полное управление пульсом состояния (настроение/энергия 1..5): просмотр истории, запись нового чекина, редактирование (по checkin_id или последнего чекина use_latest=true) или удаление.",
      inputSchema: z.object({
        action: z.enum(["list", "create", "update", "delete"]).default("create"),
        checkin_id: z.number().int().positive().optional(),
        use_latest: z
          .boolean()
          .default(false)
          .describe("true = редактировать/удалить самый последний чекин состояния"),
        mood_score: z.number().int().min(1).max(5).optional(),
        energy_score: z.number().int().min(1).max(5).optional(),
        tension_score: z.number().int().min(1).max(5).nullable().optional(),
        context_tags: z.array(z.string()).optional(),
        note: z.string().nullable().optional(),
        limit: z.number().int().min(1).max(20).default(7),
      }),
      execute: async (params) => {
        if (params.action === "list") {
          const list = await listStateCheckins(db, params.limit);
          return { ok: true, checkins: list };
        }

        if (params.action === "create") {
          if (!params.mood_score || !params.energy_score) {
            return { ok: false, reason: "mood_score_and_energy_score_required" };
          }
          const saved = await createStateCheckin(db, {
            user_id: userId,
            mood_score: params.mood_score,
            energy_score: params.energy_score,
            tension_score: params.tension_score ?? null,
            context_tags: params.context_tags ?? [],
            note: params.note ?? null,
            source: "telegram",
          });
          return { ok: true, checkin: saved };
        }

        let targetId = params.checkin_id;
        if (!targetId && params.use_latest) {
          const latest = (await listStateCheckins(db, 1))[0];
          targetId = latest?.id;
        }
        if (!targetId) {
          return { ok: false, reason: "checkin_not_found" };
        }

        if (params.action === "delete") {
          await deleteStateCheckin(db, targetId);
          return { ok: true, deleted_checkin_id: targetId };
        }

        const updated = await updateStateCheckin(db, targetId, {
          ...(params.mood_score !== undefined ? { mood_score: params.mood_score } : {}),
          ...(params.energy_score !== undefined ? { energy_score: params.energy_score } : {}),
          ...(params.tension_score !== undefined ? { tension_score: params.tension_score } : {}),
          ...(params.context_tags !== undefined ? { context_tags: params.context_tags } : {}),
          ...(params.note !== undefined ? { note: params.note } : {}),
        });
        return { ok: true, checkin: updated };
      },
    }),

    manageEveningReview: tool({
      description:
        "Полное управление вечерней раздельной оценкой дня (одна оценка на одну дату YYYY-MM-DD): просмотр (get), сохранение/обновление (upsert) или удаление (delete).",
      inputSchema: z.object({
        action: z.enum(["get", "upsert", "delete"]).default("upsert"),
        review_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .default(todayDate),
        tasks_score: z.number().int().min(1).max(10).nullable().optional(),
        health_score: z.number().int().min(1).max(10).nullable().optional(),
        nutrition_score: z.number().int().min(1).max(10).nullable().optional(),
        habits_score: z.number().int().min(1).max(10).nullable().optional(),
        day_highlight: z.string().nullable().optional(),
        what_drained_energy: z.string().nullable().optional(),
        tomorrow_main_thing: z.string().nullable().optional(),
      }),
      execute: async (params) => {
        if (params.action === "get") {
          const [review, criteria] = await Promise.all([
            getDailyReview(db, params.review_date),
            listEveningCriteria(db),
          ]);
          return { ok: true, review_date: params.review_date, review, criteria };
        }

        if (params.action === "delete") {
          await deleteDailyReview(db, params.review_date);
          return { ok: true, deleted_review_date: params.review_date };
        }

        const existing = await getDailyReview(db, params.review_date);
        const saved = await upsertDailyReview(db, {
          user_id: userId,
          review_date: params.review_date,
          tasks_score:
            params.tasks_score !== undefined ? params.tasks_score : (existing?.tasks_score ?? null),
          health_score:
            params.health_score !== undefined
              ? params.health_score
              : (existing?.health_score ?? null),
          nutrition_score:
            params.nutrition_score !== undefined
              ? params.nutrition_score
              : (existing?.nutrition_score ?? null),
          habits_score:
            params.habits_score !== undefined
              ? params.habits_score
              : (existing?.habits_score ?? null),
          day_highlight:
            params.day_highlight !== undefined
              ? params.day_highlight
              : (existing?.day_highlight ?? null),
          what_drained_energy:
            params.what_drained_energy !== undefined
              ? params.what_drained_energy
              : (existing?.what_drained_energy ?? null),
          tomorrow_main_thing:
            params.tomorrow_main_thing !== undefined
              ? params.tomorrow_main_thing
              : (existing?.tomorrow_main_thing ?? null),
        });
        return {
          ok: true,
          was_updated: Boolean(existing),
          review: saved,
        };
      },
    }),

    manageAssistantAgreement: tool({
      description:
        "Управление личными правилами и договорённостями владельца с ИИ-ассистентом (просмотр, добавление, изменение, удаление).",
      inputSchema: z.object({
        action: z.enum(["list", "create", "update", "delete"]),
        agreement_id: z.number().int().positive().optional(),
        scope: z
          .enum(["general", "planning", "finance", "health", "nutrition", "communication"])
          .default("general"),
        rule_text: z.string().optional(),
        is_active: z.boolean().optional(),
      }),
      execute: async (params) => {
        if (params.action === "list") {
          const rules = await listAssistantAgreements(db, false);
          return { ok: true, agreements: rules };
        }
        if (params.action === "create") {
          if (!params.rule_text?.trim()) return { ok: false, reason: "missing_rule_text" };
          const created = await createAssistantAgreement(db, {
            user_id: userId,
            scope: params.scope,
            rule_text: params.rule_text.trim(),
            source: "telegram_confirmed",
          });
          return { ok: true, agreement: created };
        }
        if (!params.agreement_id) return { ok: false, reason: "missing_agreement_id" };
        if (params.action === "delete") {
          await deleteAssistantAgreement(db, params.agreement_id);
          return { ok: true, deleted_agreement_id: params.agreement_id };
        }
        const updated = await updateAssistantAgreement(db, params.agreement_id, {
          ...(params.rule_text ? { rule_text: params.rule_text.trim() } : {}),
          ...(params.scope ? { scope: params.scope } : {}),
          ...(params.is_active !== undefined ? { is_active: params.is_active } : {}),
        });
        return { ok: true, agreement: updated };
      },
    }),

    // ------------------------------------------------------------------------
    // HUMAN-IN-THE-LOOP STAGING TOOLS (PREVIEW CARDS)
    // ------------------------------------------------------------------------
    stageNewTasks: tool({
      description:
        "Готовит карточку подтверждения (Human-in-the-loop) СТРОГО для НОВЫХ задач и встреч из ТЕКУЩЕГО сообщения пользователя. Категорически запрещено повторно передавать сюда задачи из прошлых сообщений чата, которые уже сохранены в БД! Если указано точное время (например 14:00 или 22:00), обязательно заполни scheduled_time + planned_date.",
      inputSchema: z.object({
        tasks: z
          .array(
            z.object({
              title: z.string().min(1).describe("Чёткая формулировка задачи или встречи"),
              notes: z
                .string()
                .optional()
                .describe("Дополнительный контекст (НЕ пиши сюда время вместо scheduled_time!)"),
              project_id: z.number().int().positive().nullable().optional(),
              status: z.enum(["inbox", "todo", "waiting"]).default("todo"),
              priority: z.number().int().min(1).max(4).default(2),
              planned_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .nullable()
                .optional(),
              scheduled_time: z
                .string()
                .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
                .nullable()
                .optional()
                .describe("Точное время начала HH:MM по Москве (например '22:00' или '14:00')"),
              scheduled_end_time: z
                .string()
                .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
                .nullable()
                .optional(),
              is_meeting: z.boolean().default(false),
              remind_before_minutes: z.number().int().min(0).max(1440).nullable().optional(),
              day_slot: z.enum(["morning", "afternoon", "evening", "any"]).default("any"),
              estimated_minutes: z.number().int().min(5).max(480).optional(),
              due_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional(),
              allow_duplicate: z.boolean().optional(),
              waiting_on_person: z.string().optional(),
              waiting_context: z.string().optional(),
              follow_up_at: z.string().optional(),
            })
          )
          .min(1),
      }),
      execute: async ({ tasks }) => {
        const prepared: StagedTaskItem[] = [];
        const skippedExisting: Array<{
          existing_id: number;
          title: string;
          planned_date: string | null;
        }> = [];
        const allConflicts: Array<{ proposed_title: string; conflicts_with: string }> = [];

        for (const raw of tasks) {
          let plannedDate = raw.planned_date ?? (raw.scheduled_time ? todayDate : null);
          let daySlot: DaySlot = raw.day_slot ?? "any";
          let estMins =
            raw.estimated_minutes ?? (raw.is_meeting ? 60 : raw.scheduled_time ? 30 : undefined);
          let scheduledStartAt: string | null = null;
          let scheduledEndAt: string | null = null;

          if (raw.scheduled_time && plannedDate) {
            const built = buildScheduledRangeFromClockTime({
              dateStr: plannedDate,
              startTime: raw.scheduled_time,
              endTime: raw.scheduled_end_time ?? null,
              durationMinutes: estMins ?? null,
              isMeeting: raw.is_meeting,
              timeZone,
            });
            scheduledStartAt = built.scheduled_start_at;
            scheduledEndAt = built.scheduled_end_at;
            plannedDate = built.planned_date;
            daySlot = built.day_slot;
            estMins = built.estimated_minutes;
          }

          const remindBefore =
            raw.remind_before_minutes === null
              ? null
              : raw.remind_before_minutes !== undefined
                ? raw.remind_before_minutes
                : scheduledStartAt
                  ? 15
                  : null;

          const dupInBatch = prepared.some(
            (p) =>
              p.planned_date === plannedDate && areTaskTitlesSimilar(p.title, raw.title)
          );
          if (dupInBatch) continue;

          if (!editingAction && !raw.allow_duplicate) {
            const existing = await findSimilarActiveTasks(db, {
              plannedDate,
              title: raw.title,
            });
            if (existing.length > 0) {
              skippedExisting.push({
                existing_id: existing[0].id,
                title: existing[0].title,
                planned_date: existing[0].planned_date,
              });
              continue;
            }
          }

          const conflictWarnings: string[] = [];
          if (scheduledStartAt) {
            const dbConflicts = await findTimeConflicts(db, {
              startAt: scheduledStartAt,
              endAt: scheduledEndAt,
              durationMinutes: estMins,
              isMeeting: raw.is_meeting,
              timeZone,
            });
            for (const c of dbConflicts) {
              const msg = `пересекается с «${c.task.title}» (${c.timeRangeLabel})`;
              conflictWarnings.push(msg);
              allConflicts.push({ proposed_title: raw.title, conflicts_with: msg });
            }
          }

          prepared.push({
            title: raw.title,
            notes: raw.notes ?? null,
            status: raw.status,
            priority: raw.priority,
            planned_date: plannedDate,
            day_slot: daySlot,
            estimated_minutes: estMins ?? null,
            due_date: raw.due_date ?? null,
            scheduled_start_at: scheduledStartAt,
            scheduled_end_at: scheduledEndAt,
            scheduled_time: raw.scheduled_time ?? null,
            scheduled_end_time: raw.scheduled_end_time ?? null,
            is_meeting: raw.is_meeting,
            remind_before_minutes: remindBefore,
            allow_duplicate: raw.allow_duplicate,
            waiting_on_person: raw.waiting_on_person ?? null,
            waiting_context: raw.waiting_context ?? null,
            follow_up_at: raw.follow_up_at ?? null,
            conflict_warnings: conflictWarnings,
          });
        }

        for (let i = 0; i < prepared.length; i += 1) {
          const a = prepared[i];
          if (!a.scheduled_start_at || !a.scheduled_end_at) continue;
          const aStart = Date.parse(a.scheduled_start_at);
          const aEnd = Date.parse(a.scheduled_end_at);

          for (let j = i + 1; j < prepared.length; j += 1) {
            const b = prepared[j];
            if (!b.scheduled_start_at || !b.scheduled_end_at) continue;
            const bStart = Date.parse(b.scheduled_start_at);
            const bEnd = Date.parse(b.scheduled_end_at);

            if (aStart < bEnd && aEnd > bStart) {
              const bRange =
                formatTaskTimeRange(
                  { scheduled_start_at: b.scheduled_start_at, scheduled_end_at: b.scheduled_end_at },
                  timeZone
                ) ?? "";
              const aRange =
                formatTaskTimeRange(
                  { scheduled_start_at: a.scheduled_start_at, scheduled_end_at: a.scheduled_end_at },
                  timeZone
                ) ?? "";
              const warnA = `накладывается в этом же списке на «${b.title}» (${bRange})`;
              const warnB = `накладывается в этом же списке на «${a.title}» (${aRange})`;
              a.conflict_warnings = [...(a.conflict_warnings ?? []), warnA];
              b.conflict_warnings = [...(b.conflict_warnings ?? []), warnB];
              allConflicts.push({ proposed_title: a.title, conflicts_with: warnA });
            }
          }
        }

        if (prepared.length === 0) {
          return {
            status: "already_saved_in_db",
            message:
              "Все перечисленные задачи уже есть в базе данных (дубли отфильтрованы). Если нужно изменить существующую задачу, используй updateExistingTask.",
            skipped_existing_tasks: skippedExisting,
          };
        }

        const preview = formatCreateTasksPreview(prepared, timeZone);
        const payloadTasks = prepared.map(({ conflict_warnings: _cw, ...rest }) => rest);
        const card = await saveOrReplacePendingCard({
          actionKind: "create_tasks",
          previewMarkdown: preview,
          payload: { tasks: payloadTasks },
        });

        return {
          staged_action_id: card.id,
          status: "awaiting_user_confirmation",
          tasks_count: prepared.length,
          skipped_existing_tasks: skippedExisting,
          has_conflicts: allConflicts.length > 0,
          conflicts: allConflicts,
        };
      },
    }),

    stageTaskUpdates: tool({
      description:
        "Готовит карточку подтверждения для пакетного перераспределения нескольких задач по слотам/датам (например, при разборе завала).",
      inputSchema: z.object({
        updates: z
          .array(
            z.object({
              task_id: z.number().int().positive(),
              task_title: z.string().optional(),
              planned_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .nullable()
                .optional(),
              scheduled_time: z
                .string()
                .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
                .nullable()
                .optional(),
              scheduled_end_time: z
                .string()
                .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
                .nullable()
                .optional(),
              estimated_minutes: z.number().int().min(5).max(480).nullable().optional(),
              is_meeting: z.boolean().optional(),
              remind_before_minutes: z.number().int().min(0).max(1440).nullable().optional(),
              day_slot: z.enum(["morning", "afternoon", "evening", "any"]).optional(),
              status: z
                .enum(["inbox", "todo", "in_progress", "waiting", "done", "cancelled"])
                .optional(),
              priority: z.number().int().min(1).max(4).optional(),
              waiting_on_person: z.string().nullable().optional(),
              follow_up_at: z.string().nullable().optional(),
            })
          )
          .min(1),
      }),
      execute: async ({ updates }) => {
        const preparedUpdates: StagedTaskRescheduleItem[] = [];
        const allConflicts: Array<{ task_id: number; conflicts_with: string }> = [];

        for (const u of updates) {
          let plannedDate = u.planned_date;
          let daySlot = u.day_slot;
          let scheduledStartAt: string | null | undefined;
          let scheduledEndAt: string | null | undefined;
          let estMins = u.estimated_minutes;

          if (u.scheduled_time && !plannedDate) {
            const existingMatch = fullCtx.upcomingTasks.find((t) => t.id === u.task_id);
            plannedDate = existingMatch?.planned_date ?? todayDate;
          }

          if (u.scheduled_time === null) {
            scheduledStartAt = null;
            scheduledEndAt = null;
          } else if (u.scheduled_time && plannedDate) {
            const built = buildScheduledRangeFromClockTime({
              dateStr: plannedDate,
              startTime: u.scheduled_time,
              endTime: u.scheduled_end_time ?? null,
              durationMinutes: estMins ?? undefined,
              isMeeting: u.is_meeting,
              timeZone,
            });
            scheduledStartAt = built.scheduled_start_at;
            scheduledEndAt = built.scheduled_end_at;
            plannedDate = built.planned_date;
            daySlot = built.day_slot;
            estMins = estMins ?? built.estimated_minutes;
          }

          const conflictWarnings: string[] = [];
          if (scheduledStartAt) {
            const dbConflicts = await findTimeConflicts(db, {
              startAt: scheduledStartAt,
              endAt: scheduledEndAt,
              durationMinutes: estMins ?? undefined,
              isMeeting: u.is_meeting,
              excludeTaskId: u.task_id,
              timeZone,
            });
            for (const c of dbConflicts) {
              const msg = `пересекается с «${c.task.title}» (${c.timeRangeLabel})`;
              conflictWarnings.push(msg);
              allConflicts.push({ task_id: u.task_id, conflicts_with: msg });
            }
          }

          preparedUpdates.push({
            task_id: u.task_id,
            task_title: u.task_title,
            planned_date: plannedDate,
            day_slot: daySlot,
            estimated_minutes: estMins,
            scheduled_start_at: scheduledStartAt,
            scheduled_end_at: scheduledEndAt,
            scheduled_time: u.scheduled_time,
            scheduled_end_time: u.scheduled_end_time,
            is_meeting: u.is_meeting,
            remind_before_minutes: u.remind_before_minutes,
            status: u.status,
            priority: u.priority,
            waiting_on_person: u.waiting_on_person,
            follow_up_at: u.follow_up_at,
            conflict_warnings: conflictWarnings,
          });
        }

        const preview = formatRescheduleTasksPreview(preparedUpdates, timeZone);
        const cleanUpdates = preparedUpdates.map(({ conflict_warnings: _cw, ...rest }) => rest);
        const card = await saveOrReplacePendingCard({
          actionKind: "reschedule_tasks",
          previewMarkdown: preview,
          payload: { updates: cleanUpdates },
        });
        return {
          staged_action_id: card.id,
          status: "awaiting_user_confirmation",
          updates_count: cleanUpdates.length,
          has_conflicts: allConflicts.length > 0,
          conflicts: allConflicts,
        };
      },
    }),

    stageFinanceTransactions: tool({
      description:
        "Готовит карточку подтверждения для записи одной или нескольких трат / доходов из фразы или фото чека.",
      inputSchema: z.object({
        kind: z.enum(["create_expenses", "create_income"]).default("create_expenses"),
        items: z
          .array(
            z.object({
              amount: z.number().positive(),
              currency: z.string().length(3).default("RUB"),
              category_name: z.string().min(1),
              description: z.string().optional(),
              spend_nature: z
                .enum(["personal", "work_reimbursable", "shared_reimbursable"])
                .default("personal"),
              reimbursable_amount: z.number().min(0).default(0),
            })
          )
          .min(1),
      }),
      execute: async ({ kind, items }) => {
        const sourceTag =
          input.modality === "voice"
            ? "telegram_voice"
            : input.modality === "photo"
              ? "telegram_photo"
              : "telegram_text";
        const enriched = items.map((it) => ({ ...it, source: sourceTag }));
        const preview = formatTransactionsPreview(kind, enriched);
        const card = await saveOrReplacePendingCard({
          actionKind: kind,
          previewMarkdown: preview,
          payload: { items: enriched },
        });
        return {
          staged_action_id: card.id,
          status: "awaiting_user_confirmation",
          items_count: enriched.length,
        };
      },
    }),

    stageNewAgreement: tool({
      description:
        "Готовит карточку подтверждения для сохранения предложенного в диалоге нового постоянного правила.",
      inputSchema: z.object({
        scope: z
          .enum(["general", "planning", "finance", "health", "nutrition", "communication"])
          .default("general"),
        rule_text: z.string().min(3),
      }),
      execute: async ({ scope, rule_text }) => {
        const preview = formatAgreementPreview(scope, rule_text);
        const card = await saveOrReplacePendingCard({
          actionKind: "save_agreement",
          previewMarkdown: preview,
          payload: { scope, rule_text },
        });
        return {
          staged_action_id: card.id,
          status: "awaiting_user_confirmation",
        };
      },
    }),
  };

  const historyMessages: ModelMessage[] = priorMessages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        m.role === "user" ? `[Прошлое сообщение диалога]: ${m.content}` : m.content,
    }));

  const currentPromptText = editingAction
    ? `[ТЕКУЩАЯ ПРАВКА К КАРТОЧКЕ #${editingAction.id}]: ${input.userText}`
    : `[ТЕКУЩЕЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ]: ${input.userText}`;

  const currentUserMessage: ModelMessage = input.imageAttachment
    ? {
        role: "user",
        content: [
          {
            type: "text",
            text:
              currentPromptText ||
              "Посмотри на прикреплённое фото и помоги разобрать его в контексте моих задач, чеков или записей.",
          },
          {
            type: "image",
            image: new Uint8Array(input.imageAttachment.buffer),
            mediaType: input.imageAttachment.mimeType,
          },
        ],
      }
    : {
        role: "user",
        content: currentPromptText,
      };

  const messages: ModelMessage[] = [...historyMessages, currentUserMessage];

  let replyText = "";
  let totalToolCalls = 0;

  const runModel = async (modelToUse: ReturnType<typeof getPrimaryChatModel>, extraMsgs: ModelMessage[] = []) => {
    const res = await generateText({
      model: modelToUse,
      system: systemPrompt,
      messages: [...messages, ...extraMsgs],
      tools,
      stopWhen: isStepCount(6),
    });
    const callsCount = res.steps.reduce((acc, s) => acc + (s.toolCalls?.length ?? 0), 0);
    return { text: res.text.trim(), callsCount };
  };

  try {
    const primaryModel = getPrimaryChatModel(fullCtx.settings?.model_id);
    const firstPass = await runModel(primaryModel);
    replyText = firstPass.text;
    totalToolCalls = firstPass.callsCount;

    // Programmatic Anti-Hallucination Guard: if 0 tools ran, yet the model claimed it mutated DB, force tool call!
    if (totalToolCalls === 0 && HALLUCINATED_MUTATION_REGEX.test(replyText)) {
      console.warn(
        "[agent] Anti-hallucination guard triggered: model claimed mutation with 0 tool calls. Retrying with explicit enforcement."
      );
      const retryPass = await runModel(primaryModel, [
        { role: "assistant", content: replyText },
        {
          role: "user",
          content:
            "[СИСТЕМНАЯ ПРОВЕРКА]: Ты ответил, что выполнил изменение в базе, но НЕ вызвал ни одного инструмента (0 tool calls)! Вызови нужный инструмент прямо сейчас, чтобы действие реально записалось в Supabase, и затем коротко подтверди.",
        },
      ]);
      replyText = retryPass.text;
      totalToolCalls += retryPass.callsCount;
    }
  } catch (err) {
    if (input.imageAttachment) {
      console.warn(
        `[agent] DeepSeek vision failed (${(err as Error).message}), retrying photo turn via Polza.ai fallback.`
      );
      const fallbackPass = await runModel(getPolzaVisionFallbackModel());
      replyText = fallbackPass.text;
      totalToolCalls = fallbackPass.callsCount;
    } else {
      throw err;
    }
  }

  if (!replyText) {
    replyText =
      stagedCards.length > 0
        ? "Подготовил карточку на проверку ниже — глянь и подтверди, если всё ок."
        : "Готово, изменения в системе.";
  }

  await appendAssistantMessage(db, {
    user_id: userId,
    thread_id: thread.id,
    role: "assistant",
    modality: "text",
    content: replyText,
    intent_kind: stagedCards.length > 0 ? "action_proposal" : "conversation",
  });

  return {
    replyText,
    stagedCards,
  };
}
