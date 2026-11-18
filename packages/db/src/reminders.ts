import type { Json } from "./database.types";
import type {
  ReminderEntityType,
  ReminderQueueItem,
  ReminderStatus,
  Task,
  TypedSupabaseClient,
} from "./types";

export const DEFAULT_REMINDER_LEAD_MINUTES = 30;
export const REMINDER_DISABLED_SENTINEL = "2099-12-31T23:59:59.000Z";

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatReminderClockRange(
  scheduledStartAt: string,
  scheduledEndAt: string | null,
  timeZone = "Europe/Moscow"
): string {
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const startLabel = fmt.format(new Date(scheduledStartAt));
  if (!scheduledEndAt) return startLabel;
  const endLabel = fmt.format(new Date(scheduledEndAt));
  return endLabel === startLabel ? startLabel : `${startLabel}–${endLabel}`;
}

export function resolveDefaultTelegramChatId(explicitChatId?: number | null): number {
  if (explicitChatId && Number.isFinite(explicitChatId)) return explicitChatId;
  const fromEnv = Number(process.env.ALLOWED_TELEGRAM_USER_ID || 1479912341);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 1479912341;
}

export async function cancelEntityRemindersInQueue(
  db: TypedSupabaseClient,
  entityId: string,
  entityTypes: ReminderEntityType[] = ["task_start", "waiting_followup"]
): Promise<number> {
  const { data, error } = await db
    .from("reminders_queue")
    .update({ status: "cancelled" })
    .eq("entity_id", entityId)
    .in("entity_type", entityTypes)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Automatically synchronizes `public.reminders_queue` rows whenever a task
 * is created, updated, completed/reopened, or moved to `waiting`.
 */
export async function syncTaskRemindersToQueue(
  db: TypedSupabaseClient,
  task: Task,
  options: { timeZone?: string; telegramChatId?: number } = {}
): Promise<ReminderQueueItem[]> {
  const entityId = String(task.id);
  await cancelEntityRemindersInQueue(db, entityId, ["task_start", "waiting_followup"]);

  if (task.status === "done" || task.status === "cancelled") {
    return [];
  }

  const timeZone = options.timeZone ?? "Europe/Moscow";
  const telegramChatId = resolveDefaultTelegramChatId(options.telegramChatId);
  const nowMs = Date.now();
  const rowsToInsert: {
    user_id: string;
    entity_type: ReminderEntityType;
    entity_id: string;
    trigger_at: string;
    message_text: string;
    status: "pending";
    telegram_chat_id: number;
    metadata: Json;
  }[] = [];

  // 1) Timed task / meeting start reminders
  if (
    task.scheduled_start_at &&
    task.reminder_sent_at !== REMINDER_DISABLED_SENTINEL
  ) {
    const startMs = Date.parse(task.scheduled_start_at);
    // Only schedule reminders if the event hasn't already ended/passed long ago
    if (!Number.isNaN(startMs) && startMs >= nowMs - 5 * 60_000) {
      const rawOffsets =
        Array.isArray(task.remind_offsets_minutes) && task.remind_offsets_minutes.length > 0
          ? task.remind_offsets_minutes
          : typeof task.remind_before_minutes === "number"
            ? [task.remind_before_minutes]
            : [DEFAULT_REMINDER_LEAD_MINUTES];

      const uniqueOffsets = Array.from(
        new Set(rawOffsets.filter((n) => Number.isFinite(n) && n >= 0 && n <= 1440))
      ).sort((a, b) => b - a);

      const timeLabel = formatReminderClockRange(
        task.scheduled_start_at,
        task.scheduled_end_at,
        timeZone
      );
      const safeTitle = escapeTelegramHtml(task.title);
      const notesSnippet = task.notes
        ? `\n\n💬 ${escapeTelegramHtml(task.notes.slice(0, 240))}`
        : "";

      for (const offsetMin of uniqueOffsets) {
        const triggerMs = startMs - offsetMin * 60_000;
        const headerLine =
          offsetMin > 0
            ? `⏰ <b>Скоро ${task.is_meeting ? "встреча" : "задача"} (через ${offsetMin} мин · ${timeLabel})</b>`
            : `🔔 <b>Время ${task.is_meeting ? "встречи" : "задачи"} (${timeLabel})</b>`;

        rowsToInsert.push({
          user_id: task.user_id,
          entity_type: "task_start",
          entity_id: entityId,
          trigger_at: new Date(triggerMs).toISOString(),
          message_text: `${headerLine}\n\n📌 <b>${safeTitle}</b>${notesSnippet}`,
          status: "pending",
          telegram_chat_id: telegramChatId,
          metadata: {
            task_id: task.id,
            offset_minutes: offsetMin,
            scheduled_start_at: task.scheduled_start_at,
            is_meeting: task.is_meeting,
          },
        });
      }
    }
  }

  // 2) Waiting-for follow-up reminder
  if (task.status === "waiting" && task.follow_up_at) {
    const followMs = Date.parse(task.follow_up_at);
    if (!Number.isNaN(followMs) && followMs >= nowMs - 24 * 60 * 60_000) {
      const safeTitle = escapeTelegramHtml(task.title);
      const personLine = task.waiting_on_person
        ? `\n👤 Ждём: <b>${escapeTelegramHtml(task.waiting_on_person)}</b>`
        : "";
      const ctxLine = task.waiting_context
        ? `\n💬 ${escapeTelegramHtml(task.waiting_context.slice(0, 220))}`
        : "";

      rowsToInsert.push({
        user_id: task.user_id,
        entity_type: "waiting_followup",
        entity_id: entityId,
        trigger_at: new Date(followMs).toISOString(),
        message_text: `⏳ <b>Напоминание по ожиданию</b>\n\n📌 <b>${safeTitle}</b>${personLine}${ctxLine}`,
        status: "pending",
        telegram_chat_id: telegramChatId,
        metadata: {
          task_id: task.id,
          waiting_on_person: task.waiting_on_person,
        },
      });
    }
  }

  if (rowsToInsert.length === 0) return [];

  const { data, error } = await db
    .from("reminders_queue")
    .insert(rowsToInsert)
    .select("*");
  if (error) throw error;
  return data ?? [];
}

export async function createStandaloneReminder(
  db: TypedSupabaseClient,
  params: {
    userId: string;
    triggerAt: string;
    messageText: string;
    telegramChatId?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<ReminderQueueItem> {
  const formattedText = params.messageText.includes("<b>")
    ? params.messageText
    : `🔔 <b>Напоминание</b>\n\n📌 <b>${escapeTelegramHtml(params.messageText)}</b>`;

  const { data, error } = await db
    .from("reminders_queue")
    .insert({
      user_id: params.userId,
      entity_type: "standalone_reminder",
      entity_id: null,
      trigger_at: params.triggerAt,
      message_text: formattedText,
      status: "pending",
      telegram_chat_id: resolveDefaultTelegramChatId(params.telegramChatId),
      metadata: (params.metadata ?? { raw_text: params.messageText }) as Json,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export interface ListRemindersQueueFilter {
  status?: ReminderStatus | ReminderStatus[];
  entityType?: ReminderEntityType | ReminderEntityType[];
  fromTriggerAt?: string;
  toTriggerAt?: string;
  limit?: number;
}

export async function listRemindersQueue(
  db: TypedSupabaseClient,
  filter: ListRemindersQueueFilter = {}
): Promise<ReminderQueueItem[]> {
  let query = db
    .from("reminders_queue")
    .select("*")
    .order("trigger_at", { ascending: true })
    .limit(filter.limit ?? 100);

  if (filter.status) {
    if (Array.isArray(filter.status)) {
      query = query.in("status", filter.status);
    } else {
      query = query.eq("status", filter.status);
    }
  }

  if (filter.entityType) {
    if (Array.isArray(filter.entityType)) {
      query = query.in("entity_type", filter.entityType);
    } else {
      query = query.eq("entity_type", filter.entityType);
    }
  }

  if (filter.fromTriggerAt) {
    query = query.gte("trigger_at", filter.fromTriggerAt);
  }
  if (filter.toTriggerAt) {
    query = query.lte("trigger_at", filter.toTriggerAt);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function cancelReminderByIdOrQuery(
  db: TypedSupabaseClient,
  idOrQuery: number | string,
  options: { cancelAllMatches?: boolean } = {}
): Promise<{ cancelled: ReminderQueueItem[]; candidates?: ReminderQueueItem[] }> {
  const numericId =
    typeof idOrQuery === "number"
      ? idOrQuery
      : /^\d+$/.test(idOrQuery.trim())
        ? Number(idOrQuery.trim())
        : null;

  if (numericId !== null) {
    const { data, error } = await db
      .from("reminders_queue")
      .update({ status: "cancelled" })
      .eq("id", numericId)
      .eq("status", "pending")
      .select("*");
    if (error) throw error;
    return { cancelled: data ?? [] };
  }

  const q = String(idOrQuery)
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim();
  if (!q) return { cancelled: [] };

  const pending = await listRemindersQueue(db, { status: "pending", limit: 100 });
  const matches = pending.filter((r) => {
    const hay = r.message_text
      .replace(/<[^>]+>/g, " ")
      .toLowerCase()
      .replace(/ё/g, "е");
    if (hay.includes(q)) return true;
    const words = q.split(/\s+/).filter((w) => w.length >= 3);
    return words.length > 0 && words.every((w) => hay.includes(w.slice(0, 4)));
  });

  if (matches.length === 0) return { cancelled: [] };
  if (matches.length > 1 && !options.cancelAllMatches) {
    return { cancelled: [], candidates: matches };
  }

  const ids = matches.map((m) => m.id);
  const { data, error } = await db
    .from("reminders_queue")
    .update({ status: "cancelled" })
    .in("id", ids)
    .eq("status", "pending")
    .select("*");
  if (error) throw error;
  return { cancelled: data ?? [] };
}

/**
 * Atomically claims a `pending` reminder by transitioning it to `sent`.
 * Returns the claimed row if this caller won the claim, or `null` if already sent/cancelled.
 */
export async function claimDueReminder(
  db: TypedSupabaseClient,
  reminderId: number
): Promise<ReminderQueueItem | null> {
  const { data, error } = await db
    .from("reminders_queue")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      error_text: null,
    })
    .eq("id", reminderId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function markReminderFailed(
  db: TypedSupabaseClient,
  reminderId: number,
  errorText: string
): Promise<ReminderQueueItem | null> {
  const { data, error } = await db
    .from("reminders_queue")
    .update({
      status: "failed",
      error_text: errorText.slice(0, 1000),
    })
    .eq("id", reminderId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function hasDigestBeenSentForDate(
  db: TypedSupabaseClient,
  entityType: "morning_digest" | "evening_review" | "weekly_digest",
  dateStr: string
): Promise<boolean> {
  const { data, error } = await db
    .from("reminders_queue")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", dateStr)
    .eq("status", "sent")
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function recordDigestSentForDate(
  db: TypedSupabaseClient,
  params: {
    userId: string;
    entityType: "morning_digest" | "evening_review" | "weekly_digest";
    dateStr: string;
    messageText: string;
    telegramChatId?: number;
    status?: "sent" | "failed";
    errorText?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<ReminderQueueItem> {
  const status = params.status ?? "sent";
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("reminders_queue")
    .insert({
      user_id: params.userId,
      entity_type: params.entityType,
      entity_id: params.dateStr,
      trigger_at: nowIso,
      message_text: params.messageText,
      status,
      sent_at: status === "sent" ? nowIso : null,
      error_text: params.errorText ?? null,
      telegram_chat_id: resolveDefaultTelegramChatId(params.telegramChatId),
      metadata: (params.metadata ?? { date: params.dateStr }) as Json,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
