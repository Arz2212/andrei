import cron from "node-cron";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import {
  extractLocalTimeParts,
  formatIsoDate,
  formatTaskTimeRange,
  getAssistantSettings,
  getDueTaskReminders,
  getOwnerBotDbClient,
  getOwnerProfile,
  getTodayOverview,
  getWaitingTasks,
  markTaskReminderSent,
} from "@life-os/db";
import { botConfig } from "../config";
import { markdownToTelegramHtml } from "../telegram-helpers";

const sentReminderKeys = new Set<string>();
let reminderTickRunning = false;

export function startProactiveScheduler(bot: Bot<Context>): void {
  // 1. Every 1 minute: fire exact-time meeting & task reminders
  cron.schedule("* * * * *", async () => {
    if (reminderTickRunning) return;
    reminderTickRunning = true;
    try {
      const { db } = await getOwnerBotDbClient();
      const [profile, settings] = await Promise.all([
        getOwnerProfile(db),
        getAssistantSettings(db),
      ]);

      if (settings && !settings.proactive_reminders_enabled) return;

      const targetChatId = profile?.telegram_user_id || botConfig.allowedTelegramUserId;
      if (!targetChatId) return;

      const tz = profile?.timezone || "Europe/Moscow";
      const now = new Date();
      const dueReminders = await getDueTaskReminders(db, now);

      for (const task of dueReminders) {
        if (!task.scheduled_start_at) continue;

        // Mark sent immediately before/on send so concurrent/next ticks never duplicate
        await markTaskReminderSent(db, task.id);

        const startParts = extractLocalTimeParts(task.scheduled_start_at, tz);
        const rangeLabel = formatTaskTimeRange(task, tz) || startParts.timeStr;
        const minsUntilStart = Math.round(
          (Date.parse(task.scheduled_start_at) - now.getTime()) / 60_000
        );
        const leadMins = task.remind_before_minutes ?? 15;

        const header =
          leadMins > 0 && minsUntilStart > 1
            ? `⏰ **Скоро ${task.is_meeting ? "встреча" : "задача"} (через ${minsUntilStart} мин, в ${startParts.timeStr}):**`
            : `🔔 **Время ${task.is_meeting ? "встречи" : "задачи"} (${rangeLabel}):**`;

        const lines = [header, `📌 **${task.title}**`];
        if (task.notes) {
          lines.push(`💬 ${task.notes}`);
        }

        const kb = new InlineKeyboard()
          .text("✅ Выполнено", `rem:done:${task.id}`)
          .text("💤 Напомнить через 10 мин", `rem:snooze:${task.id}:10`);

        await bot.api
          .sendMessage(targetChatId, markdownToTelegramHtml(lines.join("\n")), {
            parse_mode: "HTML",
            reply_markup: kb,
          })
          .catch((e) => console.warn("[scheduler] Failed to send meeting reminder:", e));
      }
    } catch (err) {
      console.error("[scheduler:1m] Tick error:", err);
    } finally {
      reminderTickRunning = false;
    }
  });

  // 2. Every 15 minutes: due 'waiting' follow-ups & evening review digest
  cron.schedule("*/15 * * * *", async () => {
    try {
      const { db } = await getOwnerBotDbClient();
      const [profile, settings] = await Promise.all([
        getOwnerProfile(db),
        getAssistantSettings(db),
      ]);

      if (!settings?.proactive_reminders_enabled) return;

      const targetChatId = profile?.telegram_user_id || botConfig.allowedTelegramUserId;
      if (!targetChatId) return;

      const tz = profile?.timezone || "Europe/Moscow";
      const today = formatIsoDate(new Date(), tz);
      const now = new Date();

      const waitingTasks = await getWaitingTasks(db);
      for (const task of waitingTasks) {
        if (!task.follow_up_at) continue;
        const followTime = new Date(task.follow_up_at);
        const dedupeKey = `waiting:${task.id}:${today}`;
        if (followTime <= now && !sentReminderKeys.has(dedupeKey)) {
          sentReminderKeys.add(dedupeKey);
          const who = task.waiting_on_person ? ` от **${task.waiting_on_person}**` : "";
          const msg = `🔔 **Пора напомнить о себе**\nЗадача в ожидании${who}: **${task.title}**`;
          await bot.api
            .sendMessage(targetChatId, markdownToTelegramHtml(msg), {
              parse_mode: "HTML",
            })
            .catch((e) => console.warn("[scheduler] Failed to send waiting reminder:", e));
        }
      }

      const hhmm = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now);

      const eveningTarget = (settings.evening_review_time || "21:30").slice(0, 5);
      const eveningKey = `evening:${today}`;
      if (hhmm >= eveningTarget && hhmm < "22:00" && !sentReminderKeys.has(eveningKey)) {
        sentReminderKeys.add(eveningKey);
        const overview = await getTodayOverview(db, today);
        const doneCount = overview.todayTasks.filter((t) => t.status === "done").length;
        const text = [
          `🌙 **Короткий итог дня (${today})**`,
          `Сегодня закрыто задач: **${doneCount} из ${overview.todayTasks.length}**.`,
          "Скинь пару слов голосом или текстом, как прошёл день и что берём главным фокусом на завтра (или оцени день по сферам в веб-дневнике).",
        ].join("\n");

        await bot.api
          .sendMessage(targetChatId, markdownToTelegramHtml(text), {
            parse_mode: "HTML",
          })
          .catch(() => {});
      }
    } catch (err) {
      console.error("[scheduler:15m] Tick error:", err);
    }
  });
}
