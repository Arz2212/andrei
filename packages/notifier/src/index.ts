import {
  claimDueReminder,
  createStandaloneReminder,
  getOwnerBotDbClient,
  markReminderFailed,
} from "@life-os/db";
import { loadNotifierEnv } from "./env";
import { sendTelegramPush } from "./telegram-push";
import { NotifierWorker } from "./worker";

export { loadNotifierEnv } from "./env";
export { NotifierWorker } from "./worker";
export { sendTelegramPush, stripHtmlToPlainText } from "./telegram-push";
export {
  buildMorningDigestHtml,
  buildEveningReviewNudgeHtml,
  buildWeeklyDigestHtml,
  DigestCheckController,
} from "./digests";

async function runCli(): Promise<void> {
  const env = loadNotifierEnv();
  const args = process.argv.slice(2);

  // `--enqueue-test`: inserts a `pending` row due immediately so a running PM2 notifier delivers it via Realtime
  if (args.includes("--enqueue-test")) {
    const idx = args.indexOf("--enqueue-test");
    const customMsg = args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : null;
    const { db, userId } = await getOwnerBotDbClient();
    const row = await createStandaloneReminder(db, {
      userId,
      triggerAt: new Date().toISOString(),
      telegramChatId: env.ownerTelegramId,
      messageText:
        customMsg ??
        "✅ <b>Life OS Notifier подключён</b>\n\n• Локальный MCP-сервер (<code>packages/mcp</code>) готов к подключению OpenClaw\n• Очередь <code>reminders_queue</code> и пуш-уведомления активны\n• Telegram polling отключён — токен свободен без конфликтов 409",
      metadata: { source: "cli_enqueue_test" },
    });
    console.info(`[notifier] Enqueued pending reminder #${row.id} for chat ${row.telegram_chat_id}`);
    return;
  }

  // `--send-test`: records a reminder in `reminders_queue`, claims it atomically, and pushes via HTTP immediately
  if (args.includes("--send-test")) {
    const idx = args.indexOf("--send-test");
    const customMsg = args[idx + 1] && !args[idx + 1].startsWith("--") ? args[idx + 1] : null;
    const { db, userId } = await getOwnerBotDbClient();
    const row = await createStandaloneReminder(db, {
      userId,
      triggerAt: new Date().toISOString(),
      telegramChatId: env.ownerTelegramId,
      messageText:
        customMsg ??
        "✅ <b>Life OS Notifier подключён</b>\n\n• Локальный MCP-сервер (<code>packages/mcp</code>) готов к подключению OpenClaw\n• Очередь <code>reminders_queue</code> и пуш-уведомления активны\n• Telegram polling отключён — токен свободен без конфликтов 409",
      metadata: { source: "cli_send_test" },
    });
    const claimed = await claimDueReminder(db, row.id);
    if (!claimed) {
      console.info(`[notifier] Test reminder #${row.id} was already claimed by active PM2 worker.`);
      return;
    }
    try {
      const res = await sendTelegramPush({
        botToken: env.telegramBotToken,
        chatId: claimed.telegram_chat_id,
        htmlText: claimed.message_text,
      });
      console.info(
        `[notifier] Sent test push #${claimed.id} -> chat ${res.chatId} (Telegram message_id=${res.messageId})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markReminderFailed(db, row.id, msg);
      throw err;
    }
    return;
  }

  const worker = new NotifierWorker({
    telegramBotToken: env.telegramBotToken,
    ownerTelegramId: env.ownerTelegramId,
    appUrl: env.appUrl,
  });

  if (args.includes("--once")) {
    await worker.runSweep();
    await worker.stop();
    return;
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[notifier] Received ${signal}, shutting down...`);
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await worker.start();
}

if (process.env.LIFE_OS_NOTIFIER_NO_AUTOSTART !== "1") {
  runCli().catch((err) => {
    console.error("[notifier] Fatal startup error:", err);
    process.exit(1);
  });
}
