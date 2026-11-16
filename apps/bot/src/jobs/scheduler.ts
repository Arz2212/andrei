import cron from "node-cron";
import type { Bot, Context } from "grammy";
import {
  formatIsoDate,
  getAssistantSettings,
  getOwnerBotDbClient,
  getOwnerProfile,
  getTodayOverview,
  getWaitingTasks,
} from "@life-os/db";
import { botConfig } from "../config";
import { markdownToTelegramHtml } from "../telegram-helpers";

const sentReminderKeys = new Set<string>();

export function startProactiveScheduler(bot: Bot<Context>): void {
  // Check every 15 minutes for due 'waiting' follow-ups & morning/evening digest windows
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

      // 1. Due waiting-for reminders
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

      // 2. Check local HH:MM for Evening Review gentle prompt
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
      console.error("[scheduler] Tick error:", err);
    }
  });
}
