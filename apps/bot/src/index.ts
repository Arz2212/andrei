import { Bot, type Context } from "grammy";
import {
  getOwnerBotDbClient,
  getOwnerProfile,
  updatePendingAction,
} from "@life-os/db";
import { botConfig } from "./config";
import { ownerGuardMiddleware } from "./middlewares/owner-guard";
import { registerCommands } from "./commands";
import { registerCallbackHandlers } from "./callbacks/hitl";
import { runConversationalTurn } from "./ai/agent";
import { transcribeAudioBuffer } from "./ai/transcribe";
import {
  buildHitlKeyboard,
  downloadTelegramFile,
  escapeHtml,
  getThreadReplyParams,
  replyFormatted,
  resolveTopicDomain,
} from "./telegram-helpers";
import { startProactiveScheduler } from "./jobs/scheduler";

const bot = new Bot(botConfig.telegramBotToken);

// 1. Strict owner-only access filter
bot.use(ownerGuardMiddleware);

// 2. Commands & Inline Callback Handlers
registerCommands(bot);
registerCallbackHandlers(bot);

async function dispatchTurnAndSendReplies(
  ctx: Context,
  params: {
    userText: string;
    modality: "text" | "voice" | "photo";
    voiceTranscript?: string;
    imageAttachment?: { buffer: Buffer; mimeType: string };
  }
) {
  const threadParams = getThreadReplyParams(ctx);
  await ctx.api
    .sendChatAction(ctx.chat!.id, "typing", threadParams)
    .catch(() => {});

  const { db, userId } = await getOwnerBotDbClient();
  const profile = await getOwnerProfile(db);
  const topicDomain = resolveTopicDomain(
    profile?.telegram_topic_map,
    ctx.msg?.message_thread_id
  );

  const result = await runConversationalTurn({
    db,
    userId,
    telegramChatId: ctx.chat!.id,
    messageThreadId: ctx.msg?.message_thread_id,
    topicDomain,
    userText: params.userText,
    modality: params.modality,
    voiceTranscript: params.voiceTranscript,
    imageAttachment: params.imageAttachment,
  });

  // Send conversational reply
  if (result.replyText) {
    await replyFormatted(ctx, result.replyText);
  }

  // Send Human-in-the-loop preview cards with [✅ Подтвердить] / [✏️ Исправить] / [❌ Отмена]
  for (const staged of result.stagedCards) {
    const sent = await replyFormatted(
      ctx,
      staged.action.preview_markdown,
      buildHitlKeyboard(staged.action.id)
    );
    await updatePendingAction(db, staged.action.id, {
      telegram_chat_id: ctx.chat!.id,
      telegram_message_id: sent.message_id,
    }).catch(() => {});
  }
}

// 3. Voice & Audio messages (DeepSeek first -> Polza.ai STT fallback)
bot.on(["message:voice", "message:audio"], async (ctx) => {
  const threadParams = getThreadReplyParams(ctx);
  try {
    await ctx.api
      .sendChatAction(ctx.chat.id, "typing", threadParams)
      .catch(() => {});

    const media = ctx.msg.voice ?? ctx.msg.audio!;
    const mimeType = media.mime_type || "audio/ogg";
    const ext = mimeType.includes("mp3") || mimeType.includes("mpeg") ? "mp3" : "ogg";
    const { buffer } = await downloadTelegramFile(ctx, media.file_id);

    const transcription = await transcribeAudioBuffer(
      buffer,
      `voice.${ext}`,
      mimeType
    );

    if (!transcription.text) {
      await replyFormatted(
        ctx,
        "Не расслышал речь в голосовом — попробуй записать чуть громче или напиши коротко текстом."
      );
      return;
    }

    await ctx.reply(
      `<blockquote>🎙 ${escapeHtml(transcription.text)}</blockquote>`,
      {
        parse_mode: "HTML",
        ...threadParams,
      }
    );

    const caption = ctx.msg.caption?.trim();
    const combinedText = caption
      ? `${transcription.text}\n(Подпись: ${caption})`
      : transcription.text;

    await dispatchTurnAndSendReplies(ctx, {
      userText: combinedText,
      modality: "voice",
      voiceTranscript: transcription.text,
    });
  } catch (err) {
    console.error("[bot:voice] Error:", err);
    await replyFormatted(
      ctx,
      `Не удалось обработать голосовое сообщение: ${(err as Error).message}`
    );
  }
});

// 4. Photo messages (DeepSeek multimodal vision primary, Polza.ai vision fallback)
bot.on("message:photo", async (ctx) => {
  try {
    const photos = ctx.msg.photo;
    const largest = photos[photos.length - 1]!;
    const { buffer, filePath } = await downloadTelegramFile(ctx, largest.file_id);
    const mimeType = filePath.toLowerCase().endsWith(".png")
      ? "image/png"
      : "image/jpeg";

    const caption =
      ctx.msg.caption?.trim() ||
      "Разбери это фото. Если это чек или трата — подготовь карточку подтверждения трат; если список дел или скрин задачи — предложи карточку задачи; иначе коротко резюмируй по делу.";

    await dispatchTurnAndSendReplies(ctx, {
      userText: caption,
      modality: "photo",
      imageAttachment: { buffer, mimeType },
    });
  } catch (err) {
    console.error("[bot:photo] Error:", err);
    await replyFormatted(
      ctx,
      `Не удалось обработать изображение: ${(err as Error).message}`
    );
  }
});

// 5. Text messages (ignores unknown slash commands gracefully)
bot.on("message:text", async (ctx) => {
  const text = ctx.msg.text.trim();
  if (!text || text.startsWith("/")) return;

  try {
    await dispatchTurnAndSendReplies(ctx, {
      userText: text,
      modality: "text",
    });
  } catch (err) {
    console.error("[bot:text] Error:", err);
    await replyFormatted(
      ctx,
      `Произошла заминка при ответе ассистента: ${(err as Error).message}`
    );
  }
});

bot.catch((err) => {
  console.error(`[bot] Unhandled error in update ${err.ctx.update.update_id}:`, err.error);
});

async function bootstrap() {
  // Verify DB connection & owner RLS auth on startup
  const { userId } = await getOwnerBotDbClient();
  console.log(`[life-os-bot] Supabase owner session ready (uid: ${userId})`);

  await bot.api.setMyCommands([
    { command: "today", description: "Картина дня, слоты и буфер времени" },
    { command: "waiting", description: "Лист ожидания ответа" },
    { command: "pulse", description: "Отметить настроение и энергию" },
    { command: "help", description: "Подсказка по возможностям" },
  ]);

  startProactiveScheduler(bot);

  const shutdown = () => {
    console.log("[life-os-bot] Stopping polling gracefully...");
    bot.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await bot.start({
    onStart: (botInfo) => {
      console.log(
        `[life-os-bot] Polling active as @${botInfo.username} (owner Telegram ID: ${botConfig.allowedTelegramUserId})`
      );
    },
  });
}

bootstrap().catch((err) => {
  console.error("[life-os-bot] Fatal startup error:", err);
  process.exit(1);
});
