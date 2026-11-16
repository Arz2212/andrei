import { InlineKeyboard, type Bot, type Context } from "grammy";
import {
  cancelPendingAction,
  createStateCheckin,
  executePendingAction,
  getOwnerBotDbClient,
  getPendingAction,
  updatePendingAction,
} from "@life-os/db";
import { markdownToTelegramHtml, replyFormatted } from "../telegram-helpers";

export function registerCallbackHandlers(bot: Bot<Context>): void {
  // Human-in-the-loop confirmation cards: hitl:<confirm|edit|cancel>:<id>
  bot.callbackQuery(/^hitl:(confirm|edit|cancel):(\d+)$/, async (ctx) => {
    const actionOp = ctx.match[1] as "confirm" | "edit" | "cancel";
    const actionId = Number(ctx.match[2]);

    try {
      const { db } = await getOwnerBotDbClient();
      const existing = await getPendingAction(db, actionId);

      if (!existing) {
        await ctx.answerCallbackQuery({ text: "Карточка не найдена", show_alert: true });
        return;
      }

      if (actionOp === "confirm") {
        const { summary } = await executePendingAction(db, actionId);
        await ctx.answerCallbackQuery({ text: "✅ Подтверждено и сохранено!" });

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
