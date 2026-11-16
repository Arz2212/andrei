import { generateText, tool, isStepCount, type ModelMessage } from "ai";
import { z } from "zod";
import {
  addDaysToIsoDate,
  appendAssistantMessage,
  areTaskTitlesSimilar,
  buildScheduledRangeFromClockTime,
  createPendingAction,
  createStateCheckin,
  extractLocalTimeParts,
  findSimilarActiveTasks,
  findTimeConflicts,
  formatIsoDate,
  formatTaskTimeRange,
  getAssistantFullContext,
  getOrCreateThread,
  getRecentThreadMessages,
  listPendingActions,
  listStateCheckins,
  listTasks,
  updatePendingAction,
  type DaySlot,
  type PendingAction,
  type Task,
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
  for (let offset = 0; offset < 7; offset += 1) {
    const dStr = addDaysToIsoDate(todayDate, offset);
    const [y, m, d] = dStr.split("-").map(Number);
    const weekday = new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      weekday: "long",
    }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
    const prefix = offset === 0 ? "Сегодня" : offset === 1 ? "Завтра" : offset === 2 ? "Послезавтра" : "";
    lines.push(`  • ${dStr} — ${weekday}${prefix ? ` (${prefix})` : ""}`);
  }
  return lines.join("\n");
}

function formatTaskLineForPrompt(t: Task, timeZone: string): string {
  const timeRange = formatTaskTimeRange(t, timeZone);
  const timePart = timeRange ? `🕙 ${timeRange}` : `слот: ${t.day_slot}`;
  const meetTag = t.is_meeting ? " [ВСТРЕЧА/СОЗВОН]" : "";
  const estPart = !timeRange && t.estimated_minutes ? `, ~${t.estimated_minutes}м` : "";
  return `  - [#${t.id}] ${t.planned_date ?? "без даты"} (${timePart}${estPart})${meetTag} [${t.status}] P${t.priority}: ${t.title}`;
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
  agreements: Array<{ scope: string; rule_text: string }>;
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
  safeToSpendSummary: string;
  openPendingSummary: string;
  editingAction: PendingAction | null;
}): string {
  const agreementsBlock =
    params.agreements.length > 0
      ? params.agreements.map((a, i) => `${i + 1}. [${a.scope}] ${a.rule_text}`).join("\n")
      : "Пока нет отдельных зафиксированных правил.";

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
    "Календарная сетка ближайших 7 дней (сверяй дни недели строго по ней):",
    params.calendarHint,
    "",
    "=== ЛИЧНОСТЬ И ТОН (из настроек владельца) ===",
    params.customSystemPrompt,
    `Тон общения: ${params.toneGuidelines}`,
    "Строгие запреты по стилю: никакого канцелярита, никакого постоянного стёба или унижения, никаких пустых простыней текста. Помогай переходить к конкретному действию.",
    "",
    "=== ЛИЧНЫЕ ДОГОВОРЁННОСТИ И ПРАВИЛА ВЛАДЕЛЬЦА ===",
    agreementsBlock,
    "",
    "=== КАРТИНА СЕГОДНЯШНЕГО ДНЯ ===",
    `• Главный фокус дня: ${params.dayPlan?.main_focus || "не выбран"}`,
    `• Ресурс времени: доступно ${avail} мин, защитный буфер ${buf} мин → чистая ёмкость под задачи ${netCapacity} мин (режим энергии: ${params.dayPlan?.energy_mode ?? "normal"}).`,
    `• Задачи на сегодня (${params.todayDate}):\n${params.todayTasksSummary}`,
    `• Лист ожидания ответа (Waiting-For):\n${params.waitingSummary}`,
    `• Последний пульс состояния: ${params.latestPulseSummary}`,
    `• Финансовый ориентир: ${params.safeToSpendSummary}`,
    "",
    "=== УЖЕ СОХРАНЁННЫЕ ЗАДАЧИ И ВСТРЕЧИ В БАЗЕ НА БЛИЖАЙШИЕ 14 ДНЕЙ (ПОВТОРНО НЕ СОЗДАВАТЬ!) ===",
    params.upcoming14DaysSummary,
    params.openPendingSummary,
    "",
    "=== КРИТИЧЕСКИЕ ПРАВИЛА РАБОТЫ, ТОЧНОГО ВРЕМЕНИ, КОНФЛИКТОВ И ЗАЩИТЫ ОТ ДУБЛЕЙ ===",
    "1. ЗАПРЕТ НА ДУБЛИРОВАНИЕ СТАРЫХ ЗАДАЧ ИЗ ИСТОРИИ ЧАТА: в `stageNewTasks` передавай СТРОГО только НОВЫЕ задачи из ТЕКУЩЕГО запроса пользователя (либо редактируй активную карточку в режиме `editing`). КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО повторно включать задачи и встречи из прошлых сообщений чата, которые уже есть в блоке «УЖЕ СОХРАНЁННЫЕ ЗАДАЧИ И ВСТРЕЧИ В БАЗЕ»! Если нужно поменять время уже сохранённой задачи [#id], используй `stageTaskUpdates` с её `task_id`.",
    "2. СТРУКТУРИРОВАННОЕ ТОЧНОЕ ВРЕМЯ (`Europe/Moscow`): когда пользователь называет конкретное время («в 22 ровно», «в 14:00», «завтра в 12», «с 15:00 до 16:30»), ОБЯЗАТЕЛЬНО передавай `planned_date` (`YYYY-MM-DD`) и `scheduled_time` (`HH:MM`, например `\"22:00\"` или `\"14:00\"`), `is_meeting: true` для встреч/звонков, `estimated_minutes` (60 для встреч, 15 для звонков/напоминаний) и `remind_before_minutes` (`0` если просят напомнить ровно в момент начала / «ровно в 22:00», `15` по умолчанию для встреч). НИКОГДА не прячь время просто текстом в `notes`!",
    "3. ПРОВЕРКА КОНФЛИКТОВ ВРЕМЕНИ: если `stageNewTasks`, `stageTaskUpdates` или `checkScheduleConflicts` возвращают `has_conflicts: true` (слот уже занят другой встречей/задачей), обязательно явно предупреди пользователя о наложении («В 12:00 уже стоит встреча с сестрой 12:00–13:00») и предложи ближайшее свободное окно.",
    "4. ОТЛИЧАЙ РАЗГОВОР ОТ КОМАНДЫ ЗАПИСИ: если пользователь просто рассуждает, жалуется на перегруз или советуется — поддержи живой диалог без лишних карточек. При завале помоги выделить 1–3 приоритета и предложи слот.",
    "5. ПОДТВЕРЖДЕНИЕ ЧЕРЕЗ ПРЕВЬЮ (Human-in-the-Loop): любые новые задачи, переносы, траты и правила оформляй через `stage*` инструменты. Они отправят карточку с кнопками [✅ Подтвердить запись] / [✏️ Исправить] / [❌ Отмена]. В своём ответе дай короткий живой комментарий на 1–3 предложения без копирования всей карточки.",
    editingBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

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
          .map((p) => `  - Карточка #${p.id} (${p.action_kind}, ждёт нажатия кнопки): ${JSON.stringify(p.payload)}`)
          .join("\n")
      : "";

  const latestCheckin = fullCtx.overview.latestCheckin;
  const latestPulseSummary = latestCheckin
    ? `настроение ${latestCheckin.mood_score}/5, энергия ${latestCheckin.energy_score}/5 (${latestCheckin.logged_at.slice(0, 16)})${latestCheckin.note ? ` — «${latestCheckin.note}»` : ""}`
    : "сегодня ещё не отмечался.";

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
      "Общение на «ты», живое, поддерживающее, иногда требовательное и с уместными подколами — строго без канцелярита.",
    agreements: fullCtx.agreements.map((a) => ({ scope: a.scope, rule_text: a.rule_text })),
    dayPlan: fullCtx.overview.dayPlan,
    todayTasksSummary,
    upcoming14DaysSummary,
    waitingSummary,
    latestPulseSummary,
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
    searchTasks: tool({
      description:
        "Ищет задачи и встречи пользователя по статусу, диапазону дат или ключевым словам.",
      inputSchema: z.object({
        status: z
          .enum(["inbox", "todo", "in_progress", "waiting", "done"])
          .optional()
          .describe("Фильтр по статусу"),
        fromDate: z.string().optional().describe("Начальная дата YYYY-MM-DD"),
        toDate: z.string().optional().describe("Конечная дата YYYY-MM-DD"),
        query: z.string().optional().describe("Поиск по названию/заметке"),
      }),
      execute: async ({ status, fromDate, toDate, query }) => {
        const items = await listTasks(db, {
          status,
          fromDate,
          toDate,
          includeDone: status === "done",
        });
        const filtered = query
          ? items.filter((t) =>
              `${t.title} ${t.notes ?? ""} ${t.waiting_on_person ?? ""}`
                .toLowerCase()
                .includes(query.toLowerCase())
            )
          : items;
        return filtered.slice(0, 30).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          planned_date: t.planned_date,
          day_slot: t.day_slot,
          time_range_msk: formatTaskTimeRange(t, timeZone),
          scheduled_start_at: t.scheduled_start_at,
          scheduled_end_at: t.scheduled_end_at,
          is_meeting: t.is_meeting,
          remind_before_minutes: t.remind_before_minutes,
          estimated_minutes: t.estimated_minutes,
          due_date: t.due_date,
          waiting_on_person: t.waiting_on_person,
          follow_up_at: t.follow_up_at,
        }));
      },
    }),

    checkScheduleConflicts: tool({
      description:
        "Проверяет, свободно ли указанное точное время (Europe/Moscow) или есть пересечение с уже запланированными встречами/задачами.",
      inputSchema: z.object({
        planned_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Дата YYYY-MM-DD"),
        scheduled_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
          .describe("Время начала HH:MM по Москве"),
        scheduled_end_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
          .optional()
          .describe("Время окончания HH:MM"),
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

    getStateHistory: tool({
      description: "Возвращает последние отметки настроения и энергии за последние дни.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).default(7),
      }),
      execute: async ({ limit }) => {
        const list = await listStateCheckins(db, limit);
        return list.map((c) => ({
          logged_at: c.logged_at,
          mood_score: c.mood_score,
          energy_score: c.energy_score,
          tension_score: c.tension_score,
          note: c.note,
          tags: c.context_tags,
        }));
      },
    }),

    recordStatePulse: tool({
      description:
        "Мгновенно сохраняет короткую отметку текущего настроения и энергии (1..5), когда пользователь явно сообщает своё состояние.",
      inputSchema: z.object({
        mood_score: z.number().int().min(1).max(5).describe("Настроение от 1 до 5"),
        energy_score: z.number().int().min(1).max(5).describe("Энергия от 1 до 5"),
        tension_score: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Уровень напряжения/стресса от 1 до 5"),
        context_tags: z.array(z.string()).default([]),
        note: z.string().optional().describe("Короткая заметка к состоянию"),
      }),
      execute: async ({ mood_score, energy_score, tension_score, context_tags, note }) => {
        const saved = await createStateCheckin(db, {
          user_id: userId,
          mood_score,
          energy_score,
          tension_score: tension_score ?? null,
          context_tags,
          note: note ?? null,
          source: "telegram",
        });
        return {
          saved: true,
          id: saved.id,
          mood_score: saved.mood_score,
          energy_score: saved.energy_score,
        };
      },
    }),

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
              status: z.enum(["inbox", "todo", "waiting"]).default("todo"),
              priority: z.number().int().min(1).max(4).default(2),
              planned_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .nullable()
                .optional()
                .describe("Дата YYYY-MM-DD (обязательна, если задано scheduled_time)"),
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
                .optional()
                .describe("Точное время окончания HH:MM, если известно"),
              is_meeting: z
                .boolean()
                .default(false)
                .describe("true для встреч, созвонов, звонков ко времени"),
              remind_before_minutes: z
                .number()
                .int()
                .min(0)
                .max(1440)
                .nullable()
                .optional()
                .describe(
                  "За сколько минут прислать напоминание в Telegram: 0 = ровно в момент начала ('ровно в 22:00'), 15 = по умолчанию для встреч, null = не напоминать"
                ),
              day_slot: z.enum(["morning", "afternoon", "evening", "any"]).default("any"),
              estimated_minutes: z
                .number()
                .int()
                .min(5)
                .max(480)
                .optional()
                .describe("Длительность в минутах (по умолчанию 60 для встреч, 15 для звонков)"),
              due_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional(),
              allow_duplicate: z
                .boolean()
                .optional()
                .describe("true ТОЛЬКО если пользователь прямо попросил создать дубликат задачи"),
              waiting_on_person: z.string().optional().describe("От кого ждём ответ"),
              waiting_context: z.string().optional(),
              follow_up_at: z
                .string()
                .optional()
                .describe("ISO дата/время напоминания по ожиданию"),
            })
          )
          .min(1),
      }),
      execute: async ({ tasks }) => {
        const prepared: StagedTaskItem[] = [];
        const skippedExisting: Array<{ existing_id: number; title: string; planned_date: string | null }> = [];
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

          // Deduplicate within the same batch
          const dupInBatch = prepared.some(
            (p) =>
              p.planned_date === plannedDate && areTaskTitlesSimilar(p.title, raw.title)
          );
          if (dupInBatch) continue;

          // Hard-filter tasks already saved in DB on the same planned_date (unless editing or explicit allow_duplicate)
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

        // Also check pairwise time overlaps inside the same staged batch!
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
              "Все перечисленные задачи уже есть в базе данных (дубли отфильтрованы, повторная карточка не отправлена). Если нужно изменить время существующей задачи, используй stageTaskUpdates.",
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
        "Готовит карточку подтверждения для переноса УЖЕ СУЩЕСТВУЮЩИХ задач/встреч (#task_id) на другую дату/слот/точное время, смены приоритета или перевода в «Ожидание».",
      inputSchema: z.object({
        updates: z
          .array(
            z.object({
              task_id: z.number().int().positive().describe("ID существующей задачи в БД"),
              task_title: z.string().optional().describe("Название задачи для превью"),
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
                .describe("Новое точное время HH:MM по Москве (или null, чтобы убрать точное время)"),
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

          // Look up existing task if planned_date wasn't supplied with scheduled_time
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

    stageDayPlanUpdate: tool({
      description:
        "Готовит карточку подтверждения для изменения главного фокуса дня, доступного времени или защитного буфера дня.",
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
        const preview = formatDayPlanPreview(payload);
        const card = await saveOrReplacePendingCard({
          actionKind: "update_day_plan",
          previewMarkdown: preview,
          payload,
        });
        return {
          staged_action_id: card.id,
          status: "awaiting_user_confirmation",
        };
      },
    }),

    stageFinanceTransactions: tool({
      description:
        "Готовит карточку подтверждения для записи одной или нескольких трат / доходов из фразы или фото чека (включая пометку рабочих и общих покупок с компенсацией).",
      inputSchema: z.object({
        kind: z.enum(["create_expenses", "create_income"]).default("create_expenses"),
        items: z
          .array(
            z.object({
              amount: z.number().positive().describe("Сумма операции"),
              currency: z.string().length(3).default("RUB"),
              category_name: z.string().min(1).describe("Категория (Еда, Такси, Подписки и т.д.)"),
              description: z.string().optional().describe("Детали покупки / мерчант"),
              spend_nature: z
                .enum(["personal", "work_reimbursable", "shared_reimbursable"])
                .default("personal"),
              reimbursable_amount: z
                .number()
                .min(0)
                .default(0)
                .describe("Сумма к возврату (для рабочих/общих покупок)"),
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
        "Готовит карточку подтверждения для сохранения нового постоянного правила или договорённости с пользователем.",
      inputSchema: z.object({
        scope: z
          .enum(["general", "planning", "finance", "health", "nutrition", "communication"])
          .default("general"),
        rule_text: z.string().min(3).describe("Чёткая формулировка правила"),
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

  // Build conversation history cleanly separating past turns from the CURRENT user message
  const historyMessages: ModelMessage[] = priorMessages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        m.role === "user"
          ? `[Прошлое сообщение диалога]: ${m.content}`
          : m.content,
    }));

  const currentPromptText = editingAction
    ? `[ТЕКУЩАЯ ПРАВКА К КАРТОЧКЕ #${editingAction.id}]: ${input.userText}`
    : `[ТЕКУЩЕЕ СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ (обрабатывай только новые намерения из него, не дублируй задачи, которые уже есть в БД)]: ${input.userText}`;

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
  try {
    const result = await generateText({
      model: getPrimaryChatModel(fullCtx.settings?.model_id),
      system: systemPrompt,
      messages,
      tools,
      stopWhen: isStepCount(6),
    });
    replyText = result.text.trim();
  } catch (err) {
    if (input.imageAttachment) {
      console.warn(
        `[agent] DeepSeek vision failed (${(err as Error).message}), retrying photo turn via Polza.ai fallback.`
      );
      const fallbackResult = await generateText({
        model: getPolzaVisionFallbackModel(),
        system: systemPrompt,
        messages,
        tools,
        stopWhen: isStepCount(6),
      });
      replyText = fallbackResult.text.trim();
    } else {
      throw err;
    }
  }

  if (!replyText) {
    replyText =
      stagedCards.length > 0
        ? "Подготовил карточку на проверку ниже — глянь и подтверди, если всё ок."
        : "Принял, на связи.";
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
