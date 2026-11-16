import {
  escapeTelegramHtml,
  extractLocalTimeParts,
  formatTaskTimeRange,
  getAssistantSettings,
  getDailyReview,
  getOwnerProfile,
  getTodayOverview,
  hasDigestBeenSentForDate,
  recordDigestSentForDate,
  resolveDefaultTelegramChatId,
  type AssistantSettings,
  type DaySlot,
  type Task,
  type TypedSupabaseClient,
} from "@life-os/db";
import { sendTelegramPush } from "./telegram-push";

const SLOT_LABELS: Record<DaySlot, string> = {
  morning: "☀️ Утро",
  afternoon: "🌤 День",
  evening: "🌙 Вечер",
  any: "📌 Гибко",
};

function parseHhMmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const clean = hhmm.trim().slice(0, 5);
  const match = /^(\d{2}):(\d{2})$/.exec(clean);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function formatRussianDayHeader(dateStr: string, timeZone: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(anchor);
}

function formatDurationCompact(minutes: number): string {
  if (minutes <= 0) return "0 мин";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

export async function buildMorningDigestHtml(
  db: TypedSupabaseClient,
  todayDate: string,
  timeZone: string,
  appUrl: string
): Promise<string> {
  const overview = await getTodayOverview(db, todayDate);
  const activeTasks = overview.todayTasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled"
  );
  const timedTasks = activeTasks.filter((t) => Boolean(t.scheduled_start_at));
  const flexibleTasks = activeTasks.filter((t) => !t.scheduled_start_at);

  const totalPlannedMins = activeTasks.reduce(
    (acc, t) => acc + (t.estimated_minutes ?? (t.is_meeting ? 60 : 30)),
    0
  );
  const bufferMins =
    overview.dayPlan?.buffer_minutes ?? overview.profile?.daily_buffer_minutes ?? 90;

  const lines: string[] = [
    `☀️ <b>Утренняя сводка · ${escapeTelegramHtml(formatRussianDayHeader(todayDate, timeZone))}</b>`,
  ];

  if (overview.dayPlan?.main_focus) {
    lines.push(`\n🎯 <b>Фокус дня:</b> ${escapeTelegramHtml(overview.dayPlan.main_focus)}`);
  }

  lines.push(
    `⏱ В плане: <b>${formatDurationCompact(totalPlannedMins)}</b> · защитный резерв <b>${formatDurationCompact(bufferMins)}</b>`
  );

  if (timedTasks.length > 0) {
    const meetingLines = timedTasks.slice(0, 8).map((t) => {
      const range = formatTaskTimeRange(t, timeZone) ?? "ко времени";
      return `• <code>${escapeTelegramHtml(range)}</code> — ${escapeTelegramHtml(t.title)}`;
    });
    lines.push(`\n🗓 <b>Ко времени (${timedTasks.length}):</b>\n${meetingLines.join("\n")}`);
  }

  if (flexibleTasks.length > 0) {
    const flexLines = flexibleTasks.slice(0, 8).map((t) => {
      const slot = SLOT_LABELS[(t.day_slot as DaySlot) || "any"] ?? "📌";
      const mins = t.estimated_minutes ? ` <i>(${t.estimated_minutes} м)</i>` : "";
      return `• ${slot}: ${escapeTelegramHtml(t.title)}${mins}`;
    });
    lines.push(`\n📋 <b>Гибкие слоты (${flexibleTasks.length}):</b>\n${flexLines.join("\n")}`);
  }

  if (timedTasks.length === 0 && flexibleTasks.length === 0) {
    lines.push(`\n✨ <b>На сегодня жёстких задач пока нет</b> — можно спокойно задать главный шаг дня.`);
  }

  const dueWaiting = overview.waitingTasks.filter((w) => {
    if (!w.follow_up_at) return false;
    const followDate = extractLocalTimeParts(w.follow_up_at, timeZone).dateStr;
    return followDate <= todayDate;
  });

  if (dueWaiting.length > 0) {
    const waitLines = dueWaiting.slice(0, 4).map((w) => {
      const who = w.waiting_on_person ? ` (${escapeTelegramHtml(w.waiting_on_person)})` : "";
      return `• ${escapeTelegramHtml(w.title)}${who}`;
    });
    lines.push(`\n⏳ <b>Пора пингануть (${dueWaiting.length}):</b>\n${waitLines.join("\n")}`);
  }

  lines.push(`\n🔗 <a href="${escapeTelegramHtml(appUrl)}">Открыть план в Life OS</a>`);
  return lines.join("\n");
}

export async function buildEveningReviewNudgeHtml(
  db: TypedSupabaseClient,
  todayDate: string,
  timeZone: string,
  appUrl: string
): Promise<string> {
  const overview = await getTodayOverview(db, todayDate);
  const doneTasks: Task[] = overview.todayTasks.filter((t) => t.status === "done");
  const openTasks: Task[] = overview.todayTasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled"
  );

  const lines: string[] = [
    `🌙 <b>Вечернее подведение итогов · ${escapeTelegramHtml(formatRussianDayHeader(todayDate, timeZone))}</b>`,
    `\n✅ Закрыто за день: <b>${doneTasks.length}</b> · осталось открытых: <b>${openTasks.length}</b>`,
    `\nНадиктуй в чат короткие итоги (задачи, здоровье, питание, привычки + главный шаг на завтра) или отметь на сайте:`,
    `🔗 <a href="${escapeTelegramHtml(`${appUrl}/journal`)}">Заполнить вечернюю оценку</a>`,
  ];

  return lines.join("\n");
}

export class DigestCheckController {
  private sentLocks = new Set<string>();
  private cachedSettings: AssistantSettings | null = null;
  private lastSettingsFetchMs = 0;

  invalidateSettingsCache(): void {
    this.lastSettingsFetchMs = 0;
  }

  async checkAndSendDigests(params: {
    db: TypedSupabaseClient;
    userId: string;
    botToken: string;
    fallbackChatId: number;
    appUrl: string;
    now?: Date;
  }): Promise<void> {
    const now = params.now ?? new Date();
    if (!this.cachedSettings || Date.now() - this.lastSettingsFetchMs > 55_000) {
      this.cachedSettings = await getAssistantSettings(params.db);
      this.lastSettingsFetchMs = Date.now();
    }

    const settings = this.cachedSettings;
    if (!settings || !settings.proactive_reminders_enabled) {
      return;
    }

    const profile = await getOwnerProfile(params.db);
    const timeZone = profile?.timezone || "Europe/Moscow";
    const chatId = resolveDefaultTelegramChatId(
      profile?.telegram_user_id ?? params.fallbackChatId
    );

    const localNow = extractLocalTimeParts(now.toISOString(), timeZone);
    const nowMinutesOfDay = localNow.hour * 60 + localNow.minute;
    const todayDate = localNow.dateStr;

    // 1) Morning Digest (triggers within a 15-minute window starting at morning_digest_time)
    const morningTargetMins = parseHhMmToMinutes(settings.morning_digest_time);
    if (
      morningTargetMins !== null &&
      nowMinutesOfDay >= morningTargetMins &&
      nowMinutesOfDay <= morningTargetMins + 15
    ) {
      const lockKey = `morning_digest:${todayDate}`;
      if (!this.sentLocks.has(lockKey)) {
        const alreadySent = await hasDigestBeenSentForDate(
          params.db,
          "morning_digest",
          todayDate
        );
        if (alreadySent) {
          this.sentLocks.add(lockKey);
        } else {
          this.sentLocks.add(lockKey);
          try {
            const html = await buildMorningDigestHtml(
              params.db,
              todayDate,
              timeZone,
              params.appUrl
            );
            await sendTelegramPush({
              botToken: params.botToken,
              chatId,
              htmlText: html,
            });
            await recordDigestSentForDate(params.db, {
              userId: params.userId,
              entityType: "morning_digest",
              dateStr: todayDate,
              messageText: html,
              telegramChatId: chatId,
              status: "sent",
            });
            console.info(`[notifier] Sent morning_digest for ${todayDate} to chat ${chatId}`);
          } catch (err) {
            this.sentLocks.delete(lockKey);
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[notifier] Failed morning_digest for ${todayDate}:`, msg);
          }
        }
      }
    }

    // 2) Evening Review Nudge (triggers within a 15-minute window if today's review isn't filled yet)
    const eveningTargetMins = parseHhMmToMinutes(settings.evening_review_time);
    if (
      eveningTargetMins !== null &&
      nowMinutesOfDay >= eveningTargetMins &&
      nowMinutesOfDay <= eveningTargetMins + 15
    ) {
      const lockKey = `evening_review:${todayDate}`;
      if (!this.sentLocks.has(lockKey)) {
        const [alreadySent, existingReview] = await Promise.all([
          hasDigestBeenSentForDate(params.db, "evening_review", todayDate),
          getDailyReview(params.db, todayDate),
        ]);

        if (alreadySent || existingReview) {
          this.sentLocks.add(lockKey);
        } else {
          this.sentLocks.add(lockKey);
          try {
            const html = await buildEveningReviewNudgeHtml(
              params.db,
              todayDate,
              timeZone,
              params.appUrl
            );
            await sendTelegramPush({
              botToken: params.botToken,
              chatId,
              htmlText: html,
            });
            await recordDigestSentForDate(params.db, {
              userId: params.userId,
              entityType: "evening_review",
              dateStr: todayDate,
              messageText: html,
              telegramChatId: chatId,
              status: "sent",
            });
            console.info(`[notifier] Sent evening_review nudge for ${todayDate} to chat ${chatId}`);
          } catch (err) {
            this.sentLocks.delete(lockKey);
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[notifier] Failed evening_review nudge for ${todayDate}:`, msg);
          }
        }
      }
    }
  }
}
