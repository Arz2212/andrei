import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Json } from "@life-os/db";
import {
  createDefaultTelegramOnboardingEntry,
  getOwnerBotDbClient,
  getOwnerProfile,
  getTelegramOnboardingState,
  resolveNotifyTelegramIds,
  updateOwnerProfile,
  updateTelegramOnboardingState,
} from "@life-os/db";
import { errResult, okResult } from "../helpers";

const ONBOARDING_STEPS_ROADMAP = [
  {
    step: 1,
    key: "step1_intro",
    title: "Знакомство, имя и комфортный стиль общения",
    fields: ["display_name", "occupation_or_role", "tone_guidelines", "morning_digest_time", "evening_review_time"],
  },
  {
    step: 2,
    key: "step2_spheres_finance",
    title: "Главные фокусы жизни и базовые финансовые счета + категории трат",
    fields: ["priority_spheres", "accounts_created", "categories_created"],
  },
  {
    step: 3,
    key: "step3_goals_tasks_habits",
    title: "Первые 1–3 цели, ближайшие задачи в план и ежедневные привычки в 1 тап",
    fields: ["goals_created", "tasks_created", "habits_created"],
  },
  {
    step: 4,
    key: "step4_nutrition",
    title: "Цель по питанию, расчёт нормы КБЖУ с ИИ, текущий вес и вкусовые предпочтения",
    fields: ["nutrition_goal_mode", "kcal_target", "weight_kg", "food_preferences"],
  },
  {
    step: 5,
    key: "step5_done",
    title: "Финал онбординга и короткая памятка по ежедневному использованию Life OS",
    fields: ["completed"],
  },
];

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTelegramTypingIndicator(token: string, chatId: number | string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        action: "typing",
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Non-fatal: typing indicator is purely cosmetic
  }
}

async function sendSingleTelegramBubble(params: {
  token: string;
  chatId: number | string;
  text: string;
  parseMode?: "HTML" | "Markdown";
}): Promise<{ messageId: number | null }> {
  const endpoint = `https://api.telegram.org/bot${params.token}/sendMessage`;

  const attemptSend = async (mode?: "HTML" | "Markdown") => {
    const payload: Record<string, unknown> = {
      chat_id: params.chatId,
      text: params.text,
      disable_web_page_preview: true,
    };
    if (mode) payload.parse_mode = mode;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      description?: string;
      error_code?: number;
      result?: { message_id?: number };
    };
    return { httpStatus: res.status, json };
  };

  let { json } = await attemptSend(params.parseMode);

  // If optional parse_mode triggered a Telegram entity parse error, retry as plain text
  if (
    !json.ok &&
    params.parseMode &&
    typeof json.description === "string" &&
    json.description.toLowerCase().includes("parse")
  ) {
    const retry = await attemptSend(undefined);
    json = retry.json;
  }

  if (!json.ok) {
    throw new Error(
      `Ошибка отправки сообщения в Telegram (${json.error_code ?? "API"}): ${
        json.description ?? "неизвестная ошибка"
      }`
    );
  }

  return { messageId: json.result?.message_id ?? null };
}

export function registerOnboardingAndTelegramTools(server: McpServer): void {
  // ==========================================================================
  // 1. STATEFUL MULTI-STEP TELEGRAM ONBOARDING (`manage_telegram_onboarding`)
  // ==========================================================================

  server.registerTool(
    "manage_telegram_onboarding",
    {
      title: "Пошаговый онбординг пользователя в Telegram (статус, сохранение шагов и настроек профиля)",
      description:
        "Хранит и обновляет прогресс пошагового знакомства и первичной настройки Life OS в Supabase (`user_profiles.telegram_onboarding`), чтобы онбординг шёл живым диалогом по шагам 1..5 и не сбрасывался между сессиями (`get | update_step | complete | reset`). Позволяет одновременно сохранить имя пользователя (`display_name`), стиль общения (`tone_guidelines`) и время утренней/вечерней сводки.",
      inputSchema: {
        action: z
          .enum(["get", "update_step", "complete", "reset"])
          .describe("Действие: get, update_step, complete, reset"),
        telegram_user_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Telegram User ID собеседника (по умолчанию второй подключённый ID онбординга)"),
        current_step: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Номер текущего/следующего активного шага онбординга (1..5)"),
        completed_step: z
          .string()
          .max(100)
          .optional()
          .describe(
            "Ключ только что завершённого шага (например: 'step1_intro', 'step2_spheres_finance', 'step3_goals_tasks_habits', 'step4_nutrition', 'step5_done')"
          ),
        completed_steps: z
          .array(z.string().min(1).max(100))
          .optional()
          .describe("Опциональный массив завершённых шагов"),
        answers: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Словарь ответов и предпочтений пользователя с текущего шага (добавляется поверх предыдущих ответов)"),
        display_name: z
          .string()
          .max(120)
          .optional()
          .describe("Как обращаться к пользователю (сохраняется прямо в user_profiles.display_name)"),
        tone_guidelines: z
          .string()
          .max(1000)
          .optional()
          .describe("Предпочтительный стиль и тон общения ассистента (сохраняется в assistant_settings.tone_guidelines)"),
        morning_digest_time: z
          .string()
          .max(10)
          .optional()
          .describe("Время утренней сводки ЧЧ:ММ по МСК (например, '08:30')"),
        evening_review_time: z
          .string()
          .max(10)
          .optional()
          .describe("Время вечернего подведения итогов ЧЧ:ММ по МСК (например, '21:30')"),
        daily_buffer_minutes: z
          .number()
          .int()
          .min(0)
          .max(480)
          .optional()
          .describe("Ежедневный защитный буфер времени в минутах (например, 90)"),
        default_available_minutes: z
          .number()
          .int()
          .min(60)
          .max(960)
          .optional()
          .describe("Доступная ёмкость рабочего дня в минутах (например, 480)"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const tgId =
          args.telegram_user_id !== undefined && String(args.telegram_user_id).trim() !== ""
            ? String(args.telegram_user_id).trim()
            : "561860059";

        if (args.action === "get") {
          const state = await getTelegramOnboardingState(db, tgId);
          return okResult({
            ok: true,
            telegram_user_id: state.telegramUserId,
            status: state.status,
            current_step: state.current_step,
            completed_steps: state.completed_steps,
            answers: state.answers,
            updated_at: state.updated_at,
            display_name: state.displayName,
            notify_telegram_ids: state.notifyTelegramIds,
            assistant_settings: state.assistantSettings
              ? {
                  persona_name: state.assistantSettings.persona_name,
                  tone_guidelines: state.assistantSettings.tone_guidelines,
                  morning_digest_time: state.assistantSettings.morning_digest_time,
                  evening_review_time: state.assistantSettings.evening_review_time,
                }
              : null,
            steps_roadmap: ONBOARDING_STEPS_ROADMAP,
          });
        }

        if (args.action === "reset") {
          const profile = await getOwnerProfile(db);
          const rawMap =
            profile?.telegram_onboarding &&
            typeof profile.telegram_onboarding === "object" &&
            !Array.isArray(profile.telegram_onboarding)
              ? { ...(profile.telegram_onboarding as Record<string, unknown>) }
              : {};
          const fresh = {
            ...createDefaultTelegramOnboardingEntry(),
            updated_at: null,
          };
          rawMap[tgId] = fresh;
          await updateOwnerProfile(db, userId, {
            telegram_onboarding: rawMap as unknown as Json,
          });
          const state = await getTelegramOnboardingState(db, tgId);
          return okResult({
            ok: true,
            reset: true,
            telegram_user_id: state.telegramUserId,
            status: state.status,
            current_step: state.current_step,
            completed_steps: state.completed_steps,
            answers: state.answers,
            steps_roadmap: ONBOARDING_STEPS_ROADMAP,
          });
        }

        const isCompleting = args.action === "complete";
        const updated = await updateTelegramOnboardingState(db, userId, tgId, {
          status: isCompleting ? "completed" : "in_progress",
          currentStep: isCompleting ? 5 : args.current_step,
          completedStep: isCompleting
            ? args.completed_step ?? "step5_done"
            : args.completed_step,
          completedSteps: args.completed_steps,
          answersPatch: args.answers,
          displayName: args.display_name,
          toneGuidelines: args.tone_guidelines,
          morningDigestTime: args.morning_digest_time,
          eveningReviewTime: args.evening_review_time,
          dailyBufferMinutes: args.daily_buffer_minutes,
          defaultAvailableMinutes: args.default_available_minutes,
        });

        return okResult({
          ok: true,
          telegram_user_id: updated.telegramUserId,
          status: updated.status,
          current_step: updated.current_step,
          completed_steps: updated.completed_steps,
          answers: updated.answers,
          display_name: updated.displayName,
          notify_telegram_ids: updated.notifyTelegramIds,
          assistant_settings: updated.assistantSettings
            ? {
                tone_guidelines: updated.assistantSettings.tone_guidelines,
                morning_digest_time: updated.assistantSettings.morning_digest_time,
                evening_review_time: updated.assistantSettings.evening_review_time,
              }
            : null,
          steps_roadmap: ONBOARDING_STEPS_ROADMAP,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 2. MULTI-BUBBLE OUTBOUND TELEGRAM SEQUENCE (`send_telegram_messages_sequence`)
  // ==========================================================================

  server.registerTool(
    "send_telegram_messages_sequence",
    {
      title: "Отправить серию из нескольких коротких сообщений в Telegram подряд (живые облачка вместо простыни)",
      description:
        "Отправляет от 2 до 5 коротких отдельных сообщений в Telegram с естественной индикацией набора текста (`typing` + пауза ~450 мс) строго через исходящий `POST /sendMessage` (без `getUpdates`!). Идеально для тёплого приветствия и пошагового онбординга, чтобы не присылать длинную стену текста одним сообщением. После успешного вызова этого инструмента ВСЕ сообщения уже доставлены пользователю — верни `NO_REPLY` (не дублируй их повторно финальным ответом!).",
      inputSchema: {
        chat_id: z
          .union([z.string(), z.number()])
          .describe("Telegram Chat ID собеседника (разрешены только доверенные ID владельца из профиля)"),
        messages: z
          .array(z.string().min(1).max(3500))
          .min(1)
          .max(6)
          .describe("Массив из 2–5 коротких, живых отдельных сообщений по порядку отправки"),
        delay_ms: z
          .number()
          .int()
          .min(150)
          .max(2000)
          .optional()
          .describe("Пауза между отдельными сообщениями в мс (по умолчанию 450)"),
        parse_mode: z
          .enum(["HTML", "Markdown"])
          .optional()
          .describe("Опциональный режим разметки (по умолчанию обычный чистый текст без риска ошибок экранирования)"),
        dry_run: z
          .boolean()
          .optional()
          .describe("Только для технической проверки без реальной отправки в Telegram (по умолчанию false)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const profile = await getOwnerProfile(db);
        const allowedIds = new Set(resolveNotifyTelegramIds(profile).map((id) => String(id)));

        const targetChatId = String(args.chat_id).trim();
        if (!targetChatId || !allowedIds.has(targetChatId)) {
          return errResult(
            `Отправка разрешена только на доверенные Telegram ID профиля (${Array.from(allowedIds).join(", ")}).`
          );
        }

        const cleanedMessages = args.messages
          .map((m) => m.trim())
          .filter((m) => m.length > 0);
        if (cleanedMessages.length === 0) {
          return errResult("Массив `messages` пуст.");
        }

        if (args.dry_run) {
          return okResult({
            ok: true,
            dry_run: true,
            chat_id: targetChatId,
            sent_count: cleanedMessages.length,
            note: "Dry-run validated cleanly.",
          });
        }

        const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
        if (!botToken) {
          return errResult("В окружении не найден TELEGRAM_BOT_TOKEN для отправки серии сообщений.");
        }

        const delayMs = args.delay_ms ?? 450;
        const messageIds: Array<number | null> = [];

        for (let i = 0; i < cleanedMessages.length; i += 1) {
          await sendTelegramTypingIndicator(botToken, targetChatId);
          if (i > 0 || delayMs > 0) {
            await sleepMs(i === 0 ? Math.min(250, delayMs) : delayMs);
          }
          const sent = await sendSingleTelegramBubble({
            token: botToken,
            chatId: targetChatId,
            text: cleanedMessages[i],
            parseMode: args.parse_mode,
          });
          messageIds.push(sent.messageId);
        }

        return okResult({
          ok: true,
          chat_id: targetChatId,
          sent_count: messageIds.length,
          message_ids: messageIds,
          note: "All messages already delivered directly to Telegram chat; return NO_REPLY or do not duplicate text.",
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
