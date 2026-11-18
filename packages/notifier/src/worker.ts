import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  claimDueReminder,
  escapeTelegramHtml,
  formatIsoDate,
  getOwnerBotDbClient,
  getOwnerProfile,
  listRemindersQueue,
  markReminderFailed,
  markTaskReminderSent,
  resolveNotifyTelegramIds,
  syncHabitReminderToQueue,
  type Habit,
  type ReminderEntityType,
  type ReminderQueueItem,
  type TypedSupabaseClient,
  type UserProfile,
} from "@life-os/db";
import { DigestCheckController } from "./digests";
import { sendTelegramPushFanout } from "./telegram-push";

export const SUPPORTED_QUEUE_ENTITY_TYPES: readonly ReminderEntityType[] = [
  "task_start",
  "task",
  "waiting_followup",
  "standalone_reminder",
  "custom",
  "morning_digest",
  "evening_review",
  "weekly_digest",
  "finance_obligation",
  "obligation_due",
  "credit_grace",
  "debt_due",
  "medical_followup",
  "medical_visit",
  "workout_window",
  "pantry_expiry",
  "habit_reminder",
  "goal_milestone",
] as const;

const HORIZON_MS = 65 * 60_000; // Arm exact setTimeout timers up to 65 minutes ahead
const STALE_CUTOFF_MS = 24 * 60 * 60_000; // Auto-cancel missed reminders older than 24h
const SWEEP_INTERVAL_MS = 60_000; // 60-second safety sweep (0 LLM tokens)

export interface NotifierWorkerOptions {
  telegramBotToken: string;
  ownerTelegramId: number;
  appUrl: string;
}

function ensureGoalsLinkOnHtml(
  htmlText: string,
  appUrl: string,
  linkLabel: string,
  pathSuffix = "/goals"
): string {
  if (htmlText.includes("<a href=")) {
    return htmlText;
  }
  const safeHref = escapeTelegramHtml(`${appUrl}${pathSuffix}`);
  return `${htmlText}\n\n🔗 <a href="${safeHref}">${escapeTelegramHtml(linkLabel)}</a>`;
}

/**
 * Resolves target Telegram chat IDs for a queued reminder:
 * - If a reminder explicitly targets a non-default chat (e.g. `561860059` created a personal reminder in Telegram,
 *   or `metadata.explicit_chat_id` is set), delivers directly to that specific chat ID.
 * - Otherwise (general web-created reminders, auto-synced task/habit/finance/health reminders where `telegram_chat_id`
 *   is null or the default primary owner ID), fans out to all deduplicated IDs in `resolveNotifyTelegramIds(profile)` (`[1479912341, 561860059]`).
 */
export function resolveReminderTargetChatIds(
  claimed: ReminderQueueItem,
  profile: UserProfile | null,
  fallbackPrimaryId: number
): number[] {
  const allSharedIds = resolveNotifyTelegramIds(profile);
  const defaultPrimaryId = Number(profile?.telegram_user_id || fallbackPrimaryId || 1479912341);
  const meta =
    claimed.metadata && typeof claimed.metadata === "object" && !Array.isArray(claimed.metadata)
      ? (claimed.metadata as Record<string, unknown>)
      : {};

  if (meta.fanout_all === true) {
    return allSharedIds;
  }

  const rowChatId = claimed.telegram_chat_id ? Number(claimed.telegram_chat_id) : null;
  if (
    rowChatId &&
    Number.isFinite(rowChatId) &&
    rowChatId > 0 &&
    (rowChatId !== defaultPrimaryId || meta.explicit_single_chat === true)
  ) {
    return [rowChatId];
  }

  return allSharedIds.length > 0 ? allSharedIds : [defaultPrimaryId];
}

export class NotifierWorker {
  private readonly options: NotifierWorkerOptions;
  private readonly timersById = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly inFlightIds = new Set<number>();
  private readonly digestController = new DigestCheckController();

  private db: TypedSupabaseClient | null = null;
  private userId: string | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  private authUnsubscribe: (() => void) | null = null;
  private isStopped = false;
  private isSweeping = false;

  constructor(options: NotifierWorkerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.isStopped = false;
    const { db, userId } = await getOwnerBotDbClient();
    this.db = db;
    this.userId = userId;

    const { data: sessionData } = await db.auth.getSession();
    if (sessionData.session?.access_token) {
      db.realtime.setAuth(sessionData.session.access_token);
    }

    const { data: authListener } = db.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        db.realtime.setAuth(session.access_token);
      }
    });
    this.authUnsubscribe = () => authListener.subscription.unsubscribe();

    const profile = await getOwnerProfile(db).catch(() => null);
    const sharedIds = resolveNotifyTelegramIds(profile);

    await this.subscribeRealtime(db);
    await this.runSweep();

    this.sweepInterval = setInterval(() => {
      void this.runSweep();
    }, SWEEP_INTERVAL_MS);

    console.info(
      `[notifier] Online for owner=${userId} chats=[${sharedIds.join(", ")}] (Realtime + 60s sweep active, Telegram polling DISABLED)`
    );
  }

  async stop(): Promise<void> {
    this.isStopped = true;

    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }

    for (const timer of this.timersById.values()) {
      clearTimeout(timer);
    }
    this.timersById.clear();

    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }

    if (this.db && this.realtimeChannel) {
      await this.db.removeChannel(this.realtimeChannel).catch(() => undefined);
      this.realtimeChannel = null;
    }

    console.info("[notifier] Gracefully stopped.");
  }

  private clearTimer(reminderId: number): void {
    const existing = this.timersById.get(reminderId);
    if (existing) {
      clearTimeout(existing);
      this.timersById.delete(reminderId);
    }
  }

  private async subscribeRealtime(db: TypedSupabaseClient): Promise<void> {
    if (this.realtimeChannel) {
      await db.removeChannel(this.realtimeChannel).catch(() => undefined);
    }

    const channel = db
      .channel("life-os-notifier-queue")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reminders_queue",
        },
        (payload) => {
          if (this.isStopped) return;
          if (payload.eventType === "DELETE") {
            const oldId = Number((payload.old as { id?: number })?.id);
            if (Number.isFinite(oldId)) {
              this.clearTimer(oldId);
            }
            return;
          }

          const row = payload.new as ReminderQueueItem | undefined;
          if (!row || typeof row.id !== "number") return;
          this.scheduleOrFireRow(row);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "assistant_settings",
        },
        () => {
          if (this.isStopped) return;
          this.digestController.invalidateSettingsCache();
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.info(
            "[notifier] Subscribed to Supabase Realtime (reminders_queue + assistant_settings)"
          );
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(
            `[notifier] Realtime channel status=${status}${err ? ` (${err.message})` : ""}; 60s sweep remains active`
          );
        }
      });

    this.realtimeChannel = channel;
  }

  private scheduleOrFireRow(row: ReminderQueueItem): void {
    this.clearTimer(row.id);

    if (row.status !== "pending" || this.isStopped) {
      return;
    }

    const triggerMs = Date.parse(row.trigger_at);
    if (Number.isNaN(triggerMs)) return;

    const nowMs = Date.now();
    const agePastDueMs = nowMs - triggerMs;

    if (agePastDueMs > STALE_CUTOFF_MS) {
      void this.cancelStaleReminder(row.id);
      return;
    }

    const delayMs = triggerMs - nowMs;
    if (delayMs <= 500) {
      void this.deliverReminder(row.id);
      return;
    }

    if (delayMs <= HORIZON_MS) {
      const timer = setTimeout(() => {
        this.timersById.delete(row.id);
        void this.deliverReminder(row.id);
      }, delayMs);
      this.timersById.set(row.id, timer);
    }
  }

  private async cancelStaleReminder(reminderId: number): Promise<void> {
    try {
      const { db } = await getOwnerBotDbClient();
      await db
        .from("reminders_queue")
        .update({
          status: "cancelled",
          error_text: "Skipped stale reminder older than 24h",
        })
        .eq("id", reminderId)
        .eq("status", "pending");
    } catch (err) {
      console.error(`[notifier] Failed cancelling stale reminder #${reminderId}:`, err);
    }
  }

  private async prepareHabitReminderDelivery(
    db: TypedSupabaseClient,
    claimed: ReminderQueueItem,
    timeZone: string
  ): Promise<{ shouldSend: boolean; htmlText: string; habitToRoll: Habit | null }> {
    const habitId = claimed.entity_id ? Number(claimed.entity_id) : NaN;

    if (!Number.isFinite(habitId) || habitId <= 0) {
      return {
        shouldSend: true,
        htmlText: ensureGoalsLinkOnHtml(
          claimed.message_text,
          this.options.appUrl,
          "Отметить в 1 тап в Life OS",
          "/goals"
        ),
        habitToRoll: null,
      };
    }

    const todayStr = formatIsoDate(new Date(), timeZone);
    const [{ data: habit }, { data: todayLog }] = await Promise.all([
      db.from("habits").select("*").eq("id", habitId).maybeSingle(),
      db
        .from("habit_logs")
        .select("completed")
        .eq("habit_id", habitId)
        .eq("logged_date", todayStr)
        .maybeSingle(),
    ]);

    if (!habit || habit.is_archived) {
      return {
        shouldSend: false,
        htmlText: claimed.message_text,
        habitToRoll: null,
      };
    }

    if (todayLog?.completed) {
      await syncHabitReminderToQueue(db, habit, {
        timeZone,
        completedToday: true,
      }).catch((err) => {
        console.error(
          `[notifier] Failed rolling tomorrow's habit_reminder for habit #${habit.id}:`,
          err
        );
      });
      return {
        shouldSend: false,
        htmlText: claimed.message_text,
        habitToRoll: null,
      };
    }

    const htmlText = ensureGoalsLinkOnHtml(
      claimed.message_text,
      this.options.appUrl,
      "Отметить в 1 тап в Life OS",
      "/goals"
    );

    return {
      shouldSend: true,
      htmlText,
      habitToRoll: habit,
    };
  }

  async deliverReminder(reminderId: number): Promise<boolean> {
    if (this.isStopped || this.inFlightIds.has(reminderId)) {
      return false;
    }

    this.inFlightIds.add(reminderId);
    this.clearTimer(reminderId);

    try {
      const { db } = await getOwnerBotDbClient();
      const claimed = await claimDueReminder(db, reminderId);
      if (!claimed) {
        return false;
      }

      const profile = await getOwnerProfile(db).catch(() => null);
      const timeZone = profile?.timezone || "Europe/Moscow";
      const targetChatIds = resolveReminderTargetChatIds(
        claimed,
        profile,
        this.options.ownerTelegramId
      );

      let htmlToSend = claimed.message_text;
      let habitToRoll: Habit | null = null;

      if (claimed.entity_type === "habit_reminder") {
        const prepared = await this.prepareHabitReminderDelivery(db, claimed, timeZone);
        if (!prepared.shouldSend) {
          console.info(
            `[notifier] Skipped habit_reminder #${claimed.id} (already completed today or archived; next day queued)`
          );
          return false;
        }
        htmlToSend = prepared.htmlText;
        habitToRoll = prepared.habitToRoll;
      } else if (claimed.entity_type === "goal_milestone") {
        htmlToSend = ensureGoalsLinkOnHtml(
          claimed.message_text.includes("<b>")
            ? claimed.message_text
            : `🎯 <b>Веха цели</b>\n\n📌 <b>${escapeTelegramHtml(claimed.message_text)}</b>`,
          this.options.appUrl,
          "Открыть цели в Life OS",
          "/goals?tab=goals"
        );
      }

      try {
        const fanout = await sendTelegramPushFanout({
          botToken: this.options.telegramBotToken,
          chatIds: targetChatIds,
          htmlText: htmlToSend,
        });

        if (
          (claimed.entity_type === "task_start" || claimed.entity_type === "task") &&
          claimed.entity_id
        ) {
          const numericTaskId = Number(claimed.entity_id);
          if (Number.isFinite(numericTaskId) && numericTaskId > 0) {
            await markTaskReminderSent(db, numericTaskId).catch(() => undefined);
          }
        }

        if (habitToRoll && !habitToRoll.is_archived && habitToRoll.reminder_time) {
          await syncHabitReminderToQueue(db, habitToRoll, {
            timeZone,
          }).catch((err) => {
            console.error(
              `[notifier] Failed scheduling next-day habit_reminder for habit #${habitToRoll.id}:`,
              err
            );
          });
        }

        const deliveredSummary =
          fanout.delivered.length > 0
            ? fanout.delivered.map((d) => `${d.chatId}:#${d.messageId}`).join(", ")
            : "skipped-uninitiated-only";
        console.info(
          `[notifier] Processed reminder #${claimed.id} (${claimed.entity_type}) -> [${deliveredSummary}]`
        );
        return fanout.delivered.length > 0;
      } catch (sendErr) {
        const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        await markReminderFailed(db, reminderId, errMsg).catch(() => undefined);
        console.error(`[notifier] Delivery failed for reminder #${reminderId}: ${errMsg}`);
        return false;
      }
    } catch (err) {
      console.error(`[notifier] Unexpected error claiming reminder #${reminderId}:`, err);
      return false;
    } finally {
      this.inFlightIds.delete(reminderId);
    }
  }

  async runSweep(): Promise<void> {
    if (this.isStopped || this.isSweeping) return;
    this.isSweeping = true;

    try {
      const { db, userId } = await getOwnerBotDbClient();
      this.db = db;
      this.userId = userId;

      const horizonIso = new Date(Date.now() + HORIZON_MS).toISOString();
      const pendingRows = await listRemindersQueue(db, {
        status: "pending",
        toTriggerAt: horizonIso,
        limit: 200,
      });

      for (const row of pendingRows) {
        this.scheduleOrFireRow(row);
      }

      await this.digestController.checkAndSendDigests({
        db,
        userId,
        botToken: this.options.telegramBotToken,
        fallbackChatId: this.options.ownerTelegramId,
        appUrl: this.options.appUrl,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[notifier] 60s sweep error: ${msg}`);
    } finally {
      this.isSweeping = false;
    }
  }
}
