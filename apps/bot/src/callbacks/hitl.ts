import { InlineKeyboard, type Bot, type Context } from "grammy";
import {
  appendAssistantMessage,
  cancelPendingAction,
  createStateCheckin,
  executePendingAction,
  getOrCreateThread,
  getOwnerBotDbClient,
  getPendingAction,
  snoozeTaskReminder,
  toggleTaskDone,
  updatePendingAction,
} from "@life-os/db";
import { markdownToTelegramHtml, replyFormatted } from "../telegram-helpers";

export function registerCallbackHandlers(bot: Bot<Context>): void {
  // Human-in-the-loop confirmation cards: hitl:<confirm|edit|cancel>:<id>
  bot.callbackQuery(/^hitl:(confirm|edit|cancel):(\d+)$/, async (ctx) => {
    const actionOp = ctx.match[1] as "confirm" | "edit" | "cancel";
    const actionId = Number(ctx.match[2]);

    try {
      const { db, userId } = await getOwnerBotDbClient();
      const existing = await getPendingAction(db, actionId);

      if (!existing) {
        await ctx.answerCallbackQuery({ text: "Карточка не найдена", show_alert: true });
        return;
      }

      const resolveThreadId = async (): Promise<number | null> => {
        if (existing.thread_id) return existing.thread_id;
        if (ctx.chat?.id) {
          const t = await getOrCreateThread(db, {
            userId,
            telegramChatId: ctx.chat.id,
            messageThreadId: ctx.callbackQuery.message?.message_thread_id,
          });
          return t.id;
        }
        return null;
      };

      if (actionOp === "confirm") {
        const { summary } = await executePendingAction(db, actionId);
        await ctx.answerCallbackQuery({ text: "✅ Подтверждено и сохранено!" });

        // Layer A: Record explicit confirmation marker in conversation history
        // so future turns know these items are ALREADY committed to DB!
        const threadId = await resolveThreadId();
        if (threadId) {
          await appendAssistantMessage(db, {
            user_id: userId,
            thread_id: threadId,
            role: "assistant",
            modality: "callback",
            content: `[СИСТЕМА: Карточка #${actionId} (${existing.action_kind}) ПОДТВЕРЖДЕНА пользователем и УЖЕ СОХРАНЕНА в базу данных (${summary}). Эти задачи/операции уже записаны — повторно в будущие карточки их НЕ включать!]`,
          }).catch(() => {});
        }

        const updatedText = `${existing.preview_markdown}\n\n✅ **Подтверждено** — ${summary}`;
        await ctx
          .editMessageText(markdownToTelegramHtml(updatedText), {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard(),
          })
          .catch(() => {});
        return;
      }

      if (actionOp === "edit") {
        await updatePendingAction(db, actionId, { status: "editing" });
        await ctx.answerCallbackQuery({ text: "✏️ Напиши или надиктуй, что исправить" });

        const updatedText = `${existing.preview_markdown}\n\n✏️ **Режим правки:** напиши или отправь голосовым, что поменять — пришлю обновлённую карточку.`;
        const cancelOnlyKeyboard = new InlineKeyboard().text(
          "❌ Отмена",
          `hitl:cancel:${actionId}`
        );

        await ctx
          .editMessageText(markdownToTelegramHtml(updatedText), {
            parse_mode: "HTML",
            reply_markup: cancelOnlyKeyboard,
          })
          .catch(() => {});
        return;
      }

      if (actionOp === "cancel") {
        await cancelPendingAction(db, actionId);
        await ctx.answerCallbackQuery({ text: "❌ Отменено" });

        const threadId = await resolveThreadId();
        if (threadId) {
          await appendAssistantMessage(db, {
            user_id: userId,
            thread_id: threadId,
            role: "assistant",
            modality: "callback",
            content: `[СИСТЕМА: Карточка #${actionId} (${existing.action_kind}) ОТМЕНЕНА пользователем — не предлагать её элементы повторно без нового явного запроса.]`,
          }).catch(() => {});
        }

        const updatedText = `${existing.preview_markdown}\n\n❌ **Отменено пользователем**`;
        await ctx
          .editMessageText(markdownToTelegramHtml(updatedText), {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard(),
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("[hitl-callback] Error:", err);
      await ctx
        .answerCallbackQuery({
          text: `Ошибка: ${(err as Error).message.slice(0, 140)}`,
          show_alert: true,
        })
        .catch(() => {});
    }
  });

  // Proactive meeting/task reminder actions: rem:done:<taskId> | rem:snooze:<taskId>:<mins>
  bot.callbackQuery(/^rem:done:(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    try {
      const { db } = await getOwnerBotDbClient();
      const updated = await toggleTaskDone(db, taskId, true);
      await ctx.answerCallbackQuery({ text: "✅ Задача отмечена выполненной!" });

      const baseHtml = `✅ <b>Выполнено:</b> ${markdownToTelegramHtml(updated.title)}`;
      await ctx
        .editMessageText(baseHtml, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard(),
        })
        .catch(() => {});
    } catch (err) {
      await ctx
        .answerCallbackQuery({
          text: `Ошибка: ${(err as Error).message.slice(0, 120)}`,
          show_alert: true,
        })
        .catch(() => {});
    }
  });

  bot.callbackQuery(/^rem:snooze:(\d+):(\d+)$/, async (ctx) => {
    const taskId = Number(ctx.match[1]);
    const mins = Number(ctx.match[2]) || 10;
    try {
      const { db } = await getOwnerBotDbClient();
      const updated = await snoozeTaskReminder(db, taskId, mins);
      await ctx.answerCallbackQuery({ text: `💤 Напомню через ${mins} мин` });

      const baseHtml = `💤 <b>Отложено на ${mins} мин:</b> ${markdownToTelegramHtml(updated.title)}`;
      await ctx
        .editMessageText(baseHtml, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard(),
        })
        .catch(() => {});
    } catch (err) {
      await ctx
        .answerCallbackQuery({
          text: `Ошибка: ${(err as Error).message.slice(0, 120)}`,
          show_alert: true,
        })
        .catch(() => {});
    }
  });

  // Quick 1-tap pulse buttons: pulse:<mood>:<energy>
  bot.callbackQuery(/^pulse:([1-5]):([1-5])$/, async (ctx) => {
    const mood = Number(ctx.match[1]);
    const energy = Number(ctx.match[2]);
    try {
      const { db, userId } = await getOwnerBotDbClient();
      await createStateCheckin(db, {
        user_id: userId,
        mood_score: mood,
        energy_score: energy,
        context_tags: ["quick-telegram"],
        source: "telegram",
      });
      await ctx.answerCallbackQuery({ text: "Пульс записан!" });
      await ctx
        .editMessageText(
          `✅ <b>Пульс состояния сохранён:</b> настроение ${mood}/5 · энергия ${energy}/5`,
          { parse_mode: "HTML" }
        )
        .catch(() => {
          replyFormatted(
            ctx,
            `✅ **Пульс состояния сохранён:** настроение ${mood}/5 · энергия ${energy}/5`
          );
        });
    } catch (err) {
      await ctx.answerCallbackQuery({
        text: `Не удалось сохранить: ${(err as Error).message.slice(0, 100)}`,
        show_alert: true,
      });
    }
  });
}
