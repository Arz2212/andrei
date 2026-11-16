import { generateText, tool, isStepCount, type ModelMessage } from "ai";
import { z } from "zod";
import {
  appendAssistantMessage,
  createPendingAction,
  createStateCheckin,
  formatIsoDate,
  getAssistantFullContext,
  getOrCreateThread,
  getRecentThreadMessages,
  listPendingActions,
  listStateCheckins,
  listTasks,
  updatePendingAction,
  type PendingAction,
  type TypedSupabaseClient,
} from "@life-os/db";
import { getPolzaVisionFallbackModel, getPrimaryChatModel } from "./providers";
import {
  formatAgreementPreview,
  formatCreateTasksPreview,
  formatDayPlanPreview,
  formatRescheduleTasksPreview,
  formatTransactionsPreview,
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

function buildSystemPrompt(params: {
  todayDate: string;
  timeZone: string;
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
  waitingSummary: string;
  latestPulseSummary: string;
  safeToSpendSummary: string;
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
    `Сегодняшняя дата: ${params.todayDate} (часовой пояс: ${params.timeZone}). Активный топик/контекст: ${params.topicDomain}.`,
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
    `• Задачи на сегодня по слотам:\n${params.todayTasksSummary}`,
    `• Лист ожидания ответа (Waiting-For):\n${params.waitingSummary}`,
    `• Последний пульс состояния: ${params.latestPulseSummary}`,
    `• Финансовый ориентир: ${params.safeToSpendSummary}`,
    "",
    "=== КРИТИЧЕСКИЕ ПРАВИЛА РАБОТЫ И HUMAN-IN-THE-LOOP ===",
    "1. ОТЛИЧАЙ РАЗГОВОР ОТ КОМАНДЫ ЗАПИСИ: если пользователь просто делится мыслями, сомневается, жалуется на усталость или обсуждает идею — НЕ создавай молча задачи или траты! Поддержи диалог, помоги прояснить мысль и при необходимости спроси, стоит ли фиксировать шаг.",
    "2. СЦЕНАРИЙ РАЗБОРА ЗАВАЛА: если пользователь в панике или перегрузе («куча задач, не знаю за что хвататься»), помоги выгрузить список, выдели 1–3 действительно главных дела, сверься с чистой ёмкостью дня и защитным буфером (Утро / День / Вечер) и предложи конкретный слот («Эту задачу можем поставить в дневной слот. Возьмёшь в это окно?»). Обновление плана оформляй через карточку подтверждения.",
    "3. РАЗДЕЛЯЙ АКТИВНУЮ РАБОТУ И ОЖИДАНИЕ: если шаг зависит от ответа другого человека (клиент, подрядчик, врач), предлагай статус `waiting` с указанием `waiting_on_person` и даты напоминания `follow_up_at`.",
    "4. ПОДТВЕРЖДЕНИЕ ЧЕРЕЗ ПРЕВЬЮ (Human-in-the-Loop): любые новые задачи из речи, переносы плана, запись трат/доходов или сохранение новых правил выполняй ТОЛЬКО через `stage*` инструменты. Они сами отправят карточку с кнопками [✅ Подтвердить] / [✏️ Исправить] / [❌ Отмена]. В своём текстовом ответе не дублируй всю таблицу карточки — дай живой короткий комментарий на 1–3 предложения.",
    "5. РАБОЧИЕ И ОБЩИЕ ПОКУПКИ: если трата рабочая под возврат или общая с друзьями, ставь `spend_nature: 'work_reimbursable'` или `'shared_reimbursable'`, чтобы она не искажала личную аналитику.",
    editingBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runConversationalTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  const { db, userId, telegramChatId, messageThreadId, topicDomain } = input;

  const fullCtx = await getAssistantFullContext(db);
  const timeZone = fullCtx.overview.profile?.timezone || "Europe/Moscow";
  const todayDate = formatIsoDate(new Date(), timeZone);

  const thread = await getOrCreateThread(db, {
    userId,
    telegramChatId,
    messageThreadId,
    topicDomain,
  });

  const priorMessages = await getRecentThreadMessages(db, thread.id, 14);
  const pendingList = await listPendingActions(db, ["editing", "pending"]);
  const editingAction =
    pendingList.find(
      (a) => a.status === "editing" && (a.thread_id === thread.id || a.telegram_chat_id === telegramChatId)
    ) ?? null;

  // Record incoming user message
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
      ? todayTasks
          .map(
            (t) =>
              `  - [#${t.id}] [${t.status}] (${t.day_slot}${t.estimated_minutes ? `, ${t.estimated_minutes}м` : ""}) P${t.priority}: ${t.title}`
          )
          .join("\n") + `\n  (Суммарно запланировано активных задач примерно на ${scheduledMinutes} мин)`
      : "  На сегодня задач в слотах пока нет.";

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
    timeZone,
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
    waitingSummary,
    latestPulseSummary,
    safeToSpendSummary,
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
        "Ищет задачи пользователя по статусу, диапазону дат или ключевым словам (все дела, неделя, ожидания).",
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
        return filtered.slice(0, 25).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          planned_date: t.planned_date,
          day_slot: t.day_slot,
          estimated_minutes: t.estimated_minutes,
          due_date: t.due_date,
          waiting_on_person: t.waiting_on_person,
          follow_up_at: t.follow_up_at,
        }));
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
        "Готовит карточку подтверждения (Human-in-the-loop) для добавления одной или нескольких новых задач (включая слоты Утро/День/Вечер или статус Ожидание).",
      inputSchema: z.object({
        tasks: z
          .array(
            z.object({
              title: z.string().min(1).describe("Чёткая формулировка задачи с глагола"),
              notes: z.string().optional(),
              status: z.enum(["inbox", "todo", "waiting"]).default("todo"),
              priority: z.number().int().min(1).max(4).default(2),
              planned_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .nullable()
                .optional()
                .describe("Дата YYYY-MM-DD или null для Входящих"),
              day_slot: z.enum(["morning", "afternoon", "evening", "any"]).default("any"),
              estimated_minutes: z.number().int().min(5).max(480).optional(),
              due_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional(),
              waiting_on_person: z.string().optional().describe("От кого ждём ответ"),
              waiting_context: z.string().optional(),
              follow_up_at: z
                .string()
                .optional()
                .describe("ISO дата/время напоминания (например 2026-11-18T10:00:00Z)"),
            })
          )
          .min(1),
      }),
      execute: async ({ tasks }) => {
        const preview = formatCreateTasksPreview(tasks);
        const card = await saveOrReplacePendingCard({
          actionKind: "create_tasks",
          previewMarkdown: preview,
          payload: { tasks },
        });
        return {
          staged_action_id: card.id,
          status: "awaiting_user_confirmation",
          tasks_count: tasks.length,
        };
      },
    }),

    stageTaskUpdates: tool({
      description:
        "Готовит карточку подтверждения для переноса существующих задач между слотами/датами, смены приоритета или перевода в «Ожидание».",
      inputSchema: z.object({
        updates: z
          .array(
            z.object({
              task_id: z.number().int().positive().describe("ID существующей задачи"),
              task_title: z.string().optional().describe("Название задачи для превью"),
              planned_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .nullable()
                .optional(),
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
        const preview = formatRescheduleTasksPreview(updates);
        const card = await saveOrReplacePendingCard({
          actionKind: "reschedule_tasks",
          previewMarkdown: preview,
          payload: { updates },
        });
        return {
          staged_action_id: card.id,
          status: "awaiting_user_confirmation",
          updates_count: updates.length,
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

  // Build conversation history
  const historyMessages: ModelMessage[] = priorMessages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const currentUserMessage: ModelMessage = input.imageAttachment
    ? {
        role: "user",
        content: [
          {
            type: "text",
            text:
              input.userText ||
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
        content: input.userText,
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
    // If photo vision failed on DeepSeek for an unusual image encoding, fallback to Polza vision
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
