import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  claimDueReminder,
  getOwnerBotDbClient,
  listRemindersQueue,
  markReminderFailed,
  markTaskReminderSent,
  resolveDefaultTelegramChatId,
  type ReminderQueueItem,
  type TypedSupabaseClient,
} from "@life-os/db";
import { DigestCheckController } from "./digests";
import { sendTelegramPush } from "./telegram-push";

const HORIZON_MS = 65 * 60_000; // Arm exact setTimeout timers up to 65 minutes ahead
const STALE_CUTOFF_MS = 24 * 60 * 60_000; // Auto-cancel missed reminders older than 24h
const SWEEP_INTERVAL_MS = 60_000; // 60-second safety sweep (0 LLM tokens)

export interface NotifierWorkerOptions {
  telegramBotToken: string;
  ownerTelegramId: number;
  appUrl: string;
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

    // Keep Supabase Realtime WebSocket JWT fresh across 24/7 token refreshes
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

    await this.subscribeRealtime(db);
    await this.runSweep();

    this.sweepInterval = setInterval(() => {
      void this.runSweep();
    }, SWEEP_INTERVAL_MS);

    console.info(
      `[notifier] Online for owner=${userId} chat=${this.options.ownerTelegramId} (Realtime + 60s sweep active, Telegram polling DISABLED)`
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
          console.info("[notifier] Subscribed to Supabase Realtime (reminders_queue + assistant_settings)");
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
      // Stale reminder >24h old: cancel silently instead of surprising the user
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

  async deliverReminder(reminderId: number): Promise<boolean> {
    if (this.isStopped || this.inFlightIds.has(reminderId)) {
      return false;
    }

    this.inFlightIds.add(reminderId);
    this.clearTimer(reminderId);

    try {
      const { db } = await getOwnerBotDbClient();
      // Atomic DB transition pending -> sent prevents duplicate delivery across Realtime & sweep
      const claimed = await claimDueReminder(db, reminderId);
      if (!claimed) {
        return false;
      }

      const chatId = resolveDefaultTelegramChatId(
        claimed.telegram_chat_id || this.options.ownerTelegramId
      );

      try {
        const result = await sendTelegramPush({
          botToken: this.options.telegramBotToken,
          chatId,
          htmlText: claimed.message_text,
        });

        if (claimed.entity_type === "task_start" && claimed.entity_id) {
          const numericTaskId = Number(claimed.entity_id);
          if (Number.isFinite(numericTaskId) && numericTaskId > 0) {
            await markTaskReminderSent(db, numericTaskId).catch(() => undefined);
          }
        }

        console.info(
          `[notifier] Delivered reminder #${claimed.id} (${claimed.entity_type}) -> Telegram msg #${result.messageId}`
        );
        return true;
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
