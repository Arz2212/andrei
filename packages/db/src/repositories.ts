import type { Json } from "./database.types";
import type {
  AssistantAgreement,
  AssistantAgreementInsert,
  AssistantAgreementUpdate,
  AssistantMessage,
  AssistantMessageInsert,
  AssistantSettings,
  AssistantSettingsUpdate,
  AssistantThread,
  DailyReview,
  DailyReviewInsert,
  DashboardWidget,
  DayPlan,
  DayPlanUpdate,
  DaySlot,
  EveningReviewCriterion,
  EveningReviewCriterionInsert,
  EveningReviewCriterionUpdate,
  FinanceBalanceSummary,
  PendingAction,
  PendingActionInsert,
  PendingActionUpdate,
  Project,
  ProjectInsert,
  ProjectUpdate,
  StateCheckin,
  StateCheckinInsert,
  Task,
  TaskInsert,
  TaskStatus,
  TaskUpdate,
  TimeConflict,
  TypedSupabaseClient,
  UserProfile,
  UserProfileUpdate,
  WidgetKey,
} from "./types";

export const REMINDER_DISABLED_SENTINEL = "2099-12-31T23:59:59.000Z";

export function formatIsoDate(date: Date = new Date(), timeZone = "Europe/Moscow"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

export function deriveDaySlotFromHour(hour: number): DaySlot {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function extractLocalTimeParts(
  isoTimestamptz: string,
  timeZone = "Europe/Moscow"
): {
  dateStr: string;
  timeStr: string;
  hour: number;
  minute: number;
  daySlot: DaySlot;
} {
  const dt = new Date(isoTimestamptz);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const rawHour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const hh = String(rawHour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");

  return {
    dateStr: `${year}-${month}-${day}`,
    timeStr: `${hh}:${mm}`,
    hour: rawHour,
    minute,
    daySlot: deriveDaySlotFromHour(rawHour),
  };
}

/**
 * Converts a local calendar date (`YYYY-MM-DD`) and 24h clock time (`HH:MM`)
 * in `timeZone` (default `Europe/Moscow`) to an exact UTC ISO string.
 */
export function localClockToUtcIso(
  dateStr: string,
  timeStr: string,
  timeZone = "Europe/Moscow"
): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);

  const utcGuessMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const localAtGuess = extractLocalTimeParts(new Date(utcGuessMs).toISOString(), timeZone);
  const [ly, lm, ld] = localAtGuess.dateStr.split("-").map(Number);
  const localAsUtcMs = Date.UTC(ly, lm - 1, ld, localAtGuess.hour, localAtGuess.minute, 0, 0);
  const offsetMs = localAsUtcMs - utcGuessMs;

  return new Date(utcGuessMs - offsetMs).toISOString();
}

export function buildScheduledRangeFromClockTime(params: {
  dateStr: string;
  startTime: string;
  endTime?: string | null;
  durationMinutes?: number | null;
  isMeeting?: boolean;
  timeZone?: string;
}): {
  scheduled_start_at: string;
  scheduled_end_at: string;
  planned_date: string;
  day_slot: DaySlot;
  estimated_minutes: number;
} {
  const tz = params.timeZone ?? "Europe/Moscow";
  const startIso = localClockToUtcIso(params.dateStr, params.startTime, tz);
  const startMs = Date.parse(startIso);
  const defaultDuration = params.isMeeting ? 60 : 30;
  let endMs: number;
  let durationMinutes = params.durationMinutes ?? defaultDuration;

  if (params.endTime) {
    const candidateEndIso = localClockToUtcIso(params.dateStr, params.endTime, tz);
    const candidateEndMs = Date.parse(candidateEndIso);
    endMs =
      candidateEndMs > startMs
        ? candidateEndMs
        : candidateEndMs + 24 * 60 * 60_000;
    durationMinutes = Math.max(5, Math.round((endMs - startMs) / 60_000));
  } else {
    durationMinutes = Math.max(5, durationMinutes);
    endMs = startMs + durationMinutes * 60_000;
  }

  const localStart = extractLocalTimeParts(startIso, tz);

  return {
    scheduled_start_at: startIso,
    scheduled_end_at: new Date(endMs).toISOString(),
    planned_date: localStart.dateStr,
    day_slot: localStart.daySlot,
    estimated_minutes: durationMinutes,
  };
}

export function formatTaskTimeRange(
  task: Pick<Task, "scheduled_start_at" | "scheduled_end_at">,
  timeZone = "Europe/Moscow"
): string | null {
  if (!task.scheduled_start_at) return null;
  const start = extractLocalTimeParts(task.scheduled_start_at, timeZone);
  if (!task.scheduled_end_at) return start.timeStr;
  const end = extractLocalTimeParts(task.scheduled_end_at, timeZone);
  if (end.timeStr === start.timeStr) return start.timeStr;
  return `${start.timeStr}–${end.timeStr}`;
}

// ============================================================================
// Title Similarity & Deduplication Helpers
// ============================================================================

const RU_EN_STOPWORDS = new Set([
  "для",
  "или",
  "что",
  "как",
  "при",
  "это",
  "про",
  "над",
  "под",
  "около",
  "ровно",
  "тема",
  "нужно",
  "надо",
  "сделать",
  "задача",
  "задачи",
  "обсудить",
  "уточнить",
  "согласовать",
  "договориться",
  "наметить",
  "вопросы",
  "поводу",
  "the",
  "and",
  "with",
]);

export function normalizeTaskTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTaskTitle(title: string): string[] {
  const norm = normalizeTaskTitleForDedup(title);
  if (!norm) return [];
  return norm
    .split(" ")
    .filter((w) => w.length >= 3 && !RU_EN_STOPWORDS.has(w))
    .map((w) => {
      if (w.startsWith("научрук")) return "научн";
      return w.length >= 6 ? w.slice(0, 5) : w;
    });
}

export function areTaskTitlesSimilar(a: string, b: string): boolean {
  const normA = normalizeTaskTitleForDedup(a);
  const normB = normalizeTaskTitleForDedup(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.length >= 12 && normB.length >= 12) {
    if (normA.includes(normB) || normB.includes(normA)) return true;
  }

  const tokensA = Array.from(new Set(tokenizeTaskTitle(a)));
  const tokensB = Array.from(new Set(tokenizeTaskTitle(b)));
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const setB = new Set(tokensB);
  let overlap = 0;
  for (const t of tokensA) {
    if (setB.has(t)) overlap += 1;
  }

  const minLen = Math.min(tokensA.length, tokensB.length);
  if (minLen === 1) {
    return tokensA.length === 1 && tokensB.length === 1 && overlap === 1;
  }
  return overlap >= 2 && overlap / minLen >= 0.66;
}

export async function findSimilarActiveTasks(
  db: TypedSupabaseClient,
  params: { plannedDate?: string | null; title: string }
): Promise<Task[]> {
  let query = db
    .from("tasks")
    .select("*")
    .not("status", "in", '("done","cancelled")');

  if (params.plannedDate) {
    query = query.eq("planned_date", params.plannedDate);
  } else {
    query = query.is("planned_date", null);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).filter((t) => areTaskTitlesSimilar(t.title, params.title));
}

// ============================================================================
// Profile & Dashboard Widgets
// ============================================================================

export async function getOwnerProfile(db: TypedSupabaseClient): Promise<UserProfile | null> {
  const { data, error } = await db.from("user_profiles").select("*").limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateOwnerProfile(
  db: TypedSupabaseClient,
  userId: string,
  patch: UserProfileUpdate
): Promise<UserProfile> {
  const { data, error } = await db
    .from("user_profiles")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getDashboardWidgets(db: TypedSupabaseClient): Promise<DashboardWidget[]> {
  const { data, error } = await db
    .from("dashboard_widgets")
    .select("*")
    .order("desktop_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updateDashboardWidget(
  db: TypedSupabaseClient,
  userId: string,
  widgetKey: WidgetKey,
  patch: { is_visible?: boolean; desktop_order?: number; mobile_order?: number; desktop_col_span?: number }
): Promise<DashboardWidget> {
  const { data, error } = await db
    .from("dashboard_widgets")
    .update(patch)
    .eq("user_id", userId)
    .eq("widget_key", widgetKey)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function saveDashboardWidgetOrder(
  db: TypedSupabaseClient,
  userId: string,
  items: { widget_key: WidgetKey; is_visible: boolean; desktop_order: number; mobile_order: number; desktop_col_span?: number }[]
): Promise<void> {
  for (const item of items) {
    const { error } = await db
      .from("dashboard_widgets")
      .upsert(
        {
          user_id: userId,
          widget_key: item.widget_key,
          is_visible: item.is_visible,
          desktop_order: item.desktop_order,
          mobile_order: item.mobile_order,
          desktop_col_span: item.desktop_col_span ?? 6,
        },
        { onConflict: "user_id,widget_key" }
      );
    if (error) throw error;
  }
}

// ============================================================================
// Projects, Tasks, Exact Schedule, Time Conflicts & Reminders
// ============================================================================

export async function listProjects(db: TypedSupabaseClient): Promise<Project[]> {
  const { data, error } = await db
    .from("projects")
    .select("*")
    .neq("status", "archived")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createProject(
  db: TypedSupabaseClient,
  input: ProjectInsert
): Promise<Project> {
  const { data, error } = await db.from("projects").insert(input).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateProject(
  db: TypedSupabaseClient,
  id: number,
  patch: ProjectUpdate
): Promise<Project> {
  const { data, error } = await db
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export interface ListTasksFilter {
  status?: TaskStatus | TaskStatus[];
  plannedDate?: string;
  fromDate?: string;
  toDate?: string;
  projectId?: number;
  includeDone?: boolean;
}

export async function listTasks(
  db: TypedSupabaseClient,
  filter: ListTasksFilter = {}
): Promise<Task[]> {
  let query = db
    .from("tasks")
    .select("*")
    .order("scheduled_start_at", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (filter.status) {
    if (Array.isArray(filter.status)) {
      query = query.in("status", filter.status);
    } else {
      query = query.eq("status", filter.status);
    }
  } else if (!filter.includeDone) {
    query = query.neq("status", "cancelled");
  }

  if (filter.plannedDate) {
    query = query.eq("planned_date", filter.plannedDate);
  }
  if (filter.fromDate) {
    query = query.gte("planned_date", filter.fromDate);
  }
  if (filter.toDate) {
    query = query.lte("planned_date", filter.toDate);
  }
  if (filter.projectId) {
    query = query.eq("project_id", filter.projectId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getWaitingTasks(db: TypedSupabaseClient): Promise<Task[]> {
  const { data, error } = await db
    .from("tasks")
    .select("*")
    .eq("status", "waiting")
    .order("follow_up_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

function enrichScheduleFieldsOnInsert(
  input: TaskInsert,
  timeZone = "Europe/Moscow"
): TaskInsert {
  const next: TaskInsert = { ...input };
  if (next.scheduled_start_at) {
    const localStart = extractLocalTimeParts(next.scheduled_start_at, timeZone);
    next.planned_date = next.planned_date ?? localStart.dateStr;
    if (!next.day_slot || next.day_slot === "any") {
      next.day_slot = localStart.daySlot;
    }
    const defaultMins = next.is_meeting ? 60 : 30;
    const mins = next.estimated_minutes ?? defaultMins;
    if (!next.scheduled_end_at) {
      next.scheduled_end_at = new Date(
        Date.parse(next.scheduled_start_at) + mins * 60_000
      ).toISOString();
    }
    if (next.remind_before_minutes === undefined) {
      next.remind_before_minutes = 15;
    } else if (next.remind_before_minutes === null && next.reminder_sent_at === undefined) {
      // Explicit null from UI = disable Telegram reminder for this task
      next.reminder_sent_at = REMINDER_DISABLED_SENTINEL;
    }
  }
  return next;
}

function enrichScheduleFieldsOnUpdate(
  patch: TaskUpdate,
  timeZone = "Europe/Moscow"
): TaskUpdate {
  const next: TaskUpdate = { ...patch };
  if (next.scheduled_start_at === null) {
    next.scheduled_end_at = null;
    next.reminder_sent_at = null;
    next.reminder_snoozed_until = null;
  } else if (typeof next.scheduled_start_at === "string") {
    const localStart = extractLocalTimeParts(next.scheduled_start_at, timeZone);
    if (next.planned_date === undefined) {
      next.planned_date = localStart.dateStr;
    }
    if (next.day_slot === undefined || next.day_slot === "any") {
      next.day_slot = localStart.daySlot;
    }
    if (!next.scheduled_end_at) {
      const mins = next.estimated_minutes ?? (next.is_meeting ? 60 : 30);
      next.scheduled_end_at = new Date(
        Date.parse(next.scheduled_start_at) + mins * 60_000
      ).toISOString();
    }
    if (next.remind_before_minutes === null) {
      next.reminder_sent_at = REMINDER_DISABLED_SENTINEL;
      next.reminder_snoozed_until = null;
    } else if (next.reminder_sent_at === undefined) {
      next.reminder_sent_at = null;
      next.reminder_snoozed_until = null;
    }
  } else if (next.remind_before_minutes !== undefined) {
    if (next.remind_before_minutes === null) {
      next.reminder_sent_at = REMINDER_DISABLED_SENTINEL;
      next.reminder_snoozed_until = null;
    } else if (next.reminder_sent_at === undefined) {
      next.reminder_sent_at = null;
      next.reminder_snoozed_until = null;
    }
  }
  return next;
}

export async function createTask(
  db: TypedSupabaseClient,
  input: TaskInsert,
  timeZone = "Europe/Moscow"
): Promise<Task> {
  const prepared = enrichScheduleFieldsOnInsert(input, timeZone);
  const { data, error } = await db.from("tasks").insert(prepared).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateTask(
  db: TypedSupabaseClient,
  id: number,
  patch: TaskUpdate,
  timeZone = "Europe/Moscow"
): Promise<Task> {
  const prepared = enrichScheduleFieldsOnUpdate(patch, timeZone);
  const { data, error } = await db
    .from("tasks")
    .update(prepared)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function toggleTaskDone(
  db: TypedSupabaseClient,
  id: number,
  done: boolean
): Promise<Task> {
  const { data, error } = await db
    .from("tasks")
    .update({
      status: done ? "done" : "todo",
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTask(db: TypedSupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Checks whether `[startAt, endAt)` overlaps any active scheduled task/meeting.
 */
export async function findTimeConflicts(
  db: TypedSupabaseClient,
  params: {
    startAt: string;
    endAt?: string | null;
    durationMinutes?: number | null;
    isMeeting?: boolean;
    excludeTaskId?: number;
    timeZone?: string;
  }
): Promise<TimeConflict[]> {
  const tz = params.timeZone ?? "Europe/Moscow";
  const targetStartMs = Date.parse(params.startAt);
  if (Number.isNaN(targetStartMs)) return [];

  const fallbackMins = params.durationMinutes ?? (params.isMeeting ? 60 : 30);
  const rawEndMs = params.endAt
    ? Date.parse(params.endAt)
    : targetStartMs + Math.max(15, fallbackMins) * 60_000;
  const targetEndMs =
    !Number.isNaN(rawEndMs) && rawEndMs > targetStartMs
      ? rawEndMs
      : targetStartMs + 15 * 60_000;

  const windowFromIso = new Date(targetStartMs - 24 * 60 * 60_000).toISOString();
  const windowToIso = new Date(targetEndMs + 24 * 60 * 60_000).toISOString();

  let query = db
    .from("tasks")
    .select("*")
    .not("status", "in", '("done","cancelled")')
    .not("scheduled_start_at", "is", null)
    .gte("scheduled_start_at", windowFromIso)
    .lte("scheduled_start_at", windowToIso)
    .order("scheduled_start_at", { ascending: true });

  if (params.excludeTaskId) {
    query = query.neq("id", params.excludeTaskId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const conflicts: TimeConflict[] = [];
  for (const task of data ?? []) {
    if (!task.scheduled_start_at) continue;
    const sMs = Date.parse(task.scheduled_start_at);
    const estMins = task.estimated_minutes ?? (task.is_meeting ? 60 : 30);
    const eMs = task.scheduled_end_at
      ? Math.max(Date.parse(task.scheduled_end_at), sMs + 15 * 60_000)
      : sMs + Math.max(15, estMins) * 60_000;

    if (sMs < targetEndMs && eMs > targetStartMs) {
      const endIso = new Date(eMs).toISOString();
      conflicts.push({
        task,
        startIso: task.scheduled_start_at,
        endIso,
        timeRangeLabel:
          formatTaskTimeRange(
            { scheduled_start_at: task.scheduled_start_at, scheduled_end_at: endIso },
            tz
          ) ?? "",
        plannedDate: task.planned_date,
      });
    }
  }

  return conflicts;
}

/**
 * Returns active scheduled tasks whose Telegram reminder should fire now.
 */
export async function getDueTaskReminders(
  db: TypedSupabaseClient,
  now: Date = new Date()
): Promise<Task[]> {
  const nowMs = now.getTime();
  const lookbackIso = new Date(nowMs - 6 * 60 * 60_000).toISOString();
  const lookaheadIso = new Date(nowMs + 25 * 60 * 60_000).toISOString();

  const { data, error } = await db
    .from("tasks")
    .select("*")
    .not("status", "in", '("done","cancelled")')
    .not("scheduled_start_at", "is", null)
    .is("reminder_sent_at", null)
    .gte("scheduled_start_at", lookbackIso)
    .lte("scheduled_start_at", lookaheadIso)
    .order("scheduled_start_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).filter((task) => {
    if (!task.scheduled_start_at) return false;
    if (task.reminder_snoozed_until) {
      const snoozeMs = Date.parse(task.reminder_snoozed_until);
      return !Number.isNaN(snoozeMs) && nowMs >= snoozeMs && nowMs <= snoozeMs + 30 * 60_000;
    }
    const startMs = Date.parse(task.scheduled_start_at);
    const leadMins = task.remind_before_minutes ?? 15;
    const triggerMs = startMs - leadMins * 60_000;
    return nowMs >= triggerMs && startMs >= nowMs - 15 * 60_000;
  });
}

export async function markTaskReminderSent(
  db: TypedSupabaseClient,
  taskId: number
): Promise<Task> {
  const { data, error } = await db
    .from("tasks")
    .update({
      reminder_sent_at: new Date().toISOString(),
      reminder_snoozed_until: null,
    })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function snoozeTaskReminder(
  db: TypedSupabaseClient,
  taskId: number,
  snoozeMinutes = 10
): Promise<Task> {
  const snoozedUntil = new Date(Date.now() + Math.max(1, snoozeMinutes) * 60_000).toISOString();
  const { data, error } = await db
    .from("tasks")
    .update({
      reminder_sent_at: null,
      reminder_snoozed_until: snoozedUntil,
    })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getDayPlan(
  db: TypedSupabaseClient,
  planDate: string
): Promise<DayPlan | null> {
  const { data, error } = await db
    .from("day_plans")
    .select("*")
    .eq("plan_date", planDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertDayPlan(
  db: TypedSupabaseClient,
  userId: string,
  planDate: string,
  patch: DayPlanUpdate
): Promise<DayPlan> {
  const { data, error } = await db
    .from("day_plans")
    .upsert(
      {
        user_id: userId,
        plan_date: planDate,
        ...patch,
      },
      { onConflict: "user_id,plan_date" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ============================================================================
// State Check-ins & Evening Review
// ============================================================================

export async function listStateCheckins(
  db: TypedSupabaseClient,
  limit = 20
): Promise<StateCheckin[]> {
  const { data, error } = await db
    .from("state_checkins")
    .select("*")
    .order("logged_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function createStateCheckin(
  db: TypedSupabaseClient,
  input: StateCheckinInsert
): Promise<StateCheckin> {
  const { data, error } = await db.from("state_checkins").insert(input).select("*").single();
  if (error) throw error;
  return data;
}

export async function listEveningCriteria(
  db: TypedSupabaseClient
): Promise<EveningReviewCriterion[]> {
  const { data, error } = await db
    .from("evening_review_criteria")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function upsertEveningCriterion(
  db: TypedSupabaseClient,
  input: EveningReviewCriterionInsert
): Promise<EveningReviewCriterion> {
  const { data, error } = await db
    .from("evening_review_criteria")
    .upsert(input, { onConflict: "user_id,criterion_slug" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateEveningCriterion(
  db: TypedSupabaseClient,
  id: number,
  patch: EveningReviewCriterionUpdate
): Promise<EveningReviewCriterion> {
  const { data, error } = await db
    .from("evening_review_criteria")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEveningCriterion(db: TypedSupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("evening_review_criteria").delete().eq("id", id);
  if (error) throw error;
}

export async function getDailyReview(
  db: TypedSupabaseClient,
  reviewDate: string
): Promise<DailyReview | null> {
  const { data, error } = await db
    .from("daily_reviews")
    .select("*")
    .eq("review_date", reviewDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listDailyReviews(
  db: TypedSupabaseClient,
  limit = 14
): Promise<DailyReview[]> {
  const { data, error } = await db
    .from("daily_reviews")
    .select("*")
    .order("review_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function upsertDailyReview(
  db: TypedSupabaseClient,
  input: DailyReviewInsert
): Promise<DailyReview> {
  const { data, error } = await db
    .from("daily_reviews")
    .upsert(input, { onConflict: "user_id,review_date" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ============================================================================
// Assistant Settings, Agreements, Threads & Human-in-the-Loop Pending Actions
// ============================================================================

export async function getAssistantSettings(
  db: TypedSupabaseClient
): Promise<AssistantSettings | null> {
  const { data, error } = await db.from("assistant_settings").select("*").limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateAssistantSettings(
  db: TypedSupabaseClient,
  userId: string,
  patch: AssistantSettingsUpdate
): Promise<AssistantSettings> {
  const { data, error } = await db
    .from("assistant_settings")
    .update(patch)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listAssistantAgreements(
  db: TypedSupabaseClient,
  onlyActive = false
): Promise<AssistantAgreement[]> {
  let query = db
    .from("assistant_agreements")
    .select("*")
    .order("created_at", { ascending: true });
  if (onlyActive) {
    query = query.eq("is_active", true);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createAssistantAgreement(
  db: TypedSupabaseClient,
  input: AssistantAgreementInsert
): Promise<AssistantAgreement> {
  const { data, error } = await db
    .from("assistant_agreements")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateAssistantAgreement(
  db: TypedSupabaseClient,
  id: number,
  patch: AssistantAgreementUpdate
): Promise<AssistantAgreement> {
  const { data, error } = await db
    .from("assistant_agreements")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAssistantAgreement(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const { error } = await db.from("assistant_agreements").delete().eq("id", id);
  if (error) throw error;
}

export async function getOrCreateThread(
  db: TypedSupabaseClient,
  params: {
    userId: string;
    telegramChatId: number;
    messageThreadId?: number;
    topicDomain?: "assistant" | "finance" | "nutrition" | "health" | "journal";
  }
): Promise<AssistantThread> {
  const threadId = params.messageThreadId ?? 0;
  const { data: existing, error: selError } = await db
    .from("assistant_threads")
    .select("*")
    .eq("user_id", params.userId)
    .eq("telegram_chat_id", params.telegramChatId)
    .eq("message_thread_id", threadId)
    .maybeSingle();
  if (selError) throw selError;
  if (existing) return existing;

  const { data, error } = await db
    .from("assistant_threads")
    .insert({
      user_id: params.userId,
      telegram_chat_id: params.telegramChatId,
      message_thread_id: threadId,
      topic_domain: params.topicDomain ?? "assistant",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function appendAssistantMessage(
  db: TypedSupabaseClient,
  input: AssistantMessageInsert
): Promise<AssistantMessage> {
  const { data, error } = await db
    .from("assistant_messages")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getRecentThreadMessages(
  db: TypedSupabaseClient,
  threadId: number,
  limit = 16
): Promise<AssistantMessage[]> {
  const { data, error } = await db
    .from("assistant_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).reverse();
}

export async function listPendingActions(
  db: TypedSupabaseClient,
  statuses: ("pending" | "editing")[] = ["pending", "editing"]
): Promise<PendingAction[]> {
  const { data, error } = await db
    .from("pending_actions")
    .select("*")
    .in("status", statuses)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getPendingAction(
  db: TypedSupabaseClient,
  id: number
): Promise<PendingAction | null> {
  const { data, error } = await db
    .from("pending_actions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createPendingAction(
  db: TypedSupabaseClient,
  input: PendingActionInsert
): Promise<PendingAction> {
  const { data, error } = await db
    .from("pending_actions")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updatePendingAction(
  db: TypedSupabaseClient,
  id: number,
  patch: PendingActionUpdate
): Promise<PendingAction> {
  const { data, error } = await db
    .from("pending_actions")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function cancelPendingAction(
  db: TypedSupabaseClient,
  id: number
): Promise<PendingAction> {
  return updatePendingAction(db, id, {
    status: "cancelled",
    resolved_at: new Date().toISOString(),
  });
}

/**
 * Commits a confirmed Human-in-the-Loop pending action to live domain tables
 * (with automatic deduplication and exact-time support) and marks it `confirmed`.
 */
export async function executePendingAction(
  db: TypedSupabaseClient,
  id: number
): Promise<{ action: PendingAction; summary: string }> {
  const action = await getPendingAction(db, id);
  if (!action) throw new Error("Карточка действия не найдена");
  if (action.status === "confirmed") {
    return { action, summary: "Действие уже было подтверждено ранее." };
  }
  if (action.status === "cancelled" || action.status === "expired") {
    throw new Error("Действие уже отменено или истекло");
  }

  const profile = await getOwnerProfile(db);
  const timeZone = profile?.timezone ?? "Europe/Moscow";
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const userId = action.user_id;
  let summary = "Изменения сохранены.";

  if (action.action_kind === "create_tasks") {
    const items = Array.isArray(payload.tasks) ? payload.tasks : [];
    let created = 0;
    let updatedDupes = 0;

    for (const raw of items as Record<string, unknown>[]) {
      const title = String(raw.title ?? "Новая задача").trim();
      const isMeeting = Boolean(raw.is_meeting);
      let plannedDate = raw.planned_date ? String(raw.planned_date) : null;
      let daySlot = (raw.day_slot as DaySlot) ?? "any";
      let estimatedMinutes = raw.estimated_minutes ? Number(raw.estimated_minutes) : null;
      let scheduledStartAt = raw.scheduled_start_at ? String(raw.scheduled_start_at) : null;
      let scheduledEndAt = raw.scheduled_end_at ? String(raw.scheduled_end_at) : null;

      if (!scheduledStartAt && raw.scheduled_time && plannedDate) {
        const built = buildScheduledRangeFromClockTime({
          dateStr: plannedDate,
          startTime: String(raw.scheduled_time),
          endTime: raw.scheduled_end_time ? String(raw.scheduled_end_time) : null,
          durationMinutes: estimatedMinutes,
          isMeeting,
          timeZone,
        });
        scheduledStartAt = built.scheduled_start_at;
        scheduledEndAt = built.scheduled_end_at;
        plannedDate = built.planned_date;
        daySlot = built.day_slot;
        estimatedMinutes = estimatedMinutes ?? built.estimated_minutes;
      } else if (scheduledStartAt) {
        const localParts = extractLocalTimeParts(scheduledStartAt, timeZone);
        plannedDate = plannedDate ?? localParts.dateStr;
        if (!daySlot || daySlot === "any") daySlot = localParts.daySlot;
      }

      const remindBeforeMinutes =
        raw.remind_before_minutes === null
          ? null
          : raw.remind_before_minutes !== undefined
            ? Number(raw.remind_before_minutes)
            : scheduledStartAt
              ? 15
              : null;

      // Hard deduplication guard on the same planned_date
      const existingSimilar = await findSimilarActiveTasks(db, {
        plannedDate,
        title,
      });

      if (existingSimilar.length > 0 && !raw.allow_duplicate) {
        const target = existingSimilar[0];
        if (scheduledStartAt && !target.scheduled_start_at) {
          await updateTask(
            db,
            target.id,
            {
              scheduled_start_at: scheduledStartAt,
              scheduled_end_at: scheduledEndAt,
              is_meeting: isMeeting || target.is_meeting,
              remind_before_minutes: remindBeforeMinutes,
              day_slot: daySlot,
            },
            timeZone
          );
        }
        updatedDupes += 1;
        continue;
      }

      await createTask(
        db,
        {
          user_id: userId,
          title,
          notes: raw.notes ? String(raw.notes) : null,
          status: (raw.status as TaskStatus) ?? "todo",
          priority: Number(raw.priority ?? 2),
          planned_date: plannedDate,
          day_slot: daySlot,
          estimated_minutes: estimatedMinutes,
          due_date: raw.due_date ? String(raw.due_date) : null,
          scheduled_start_at: scheduledStartAt,
          scheduled_end_at: scheduledEndAt,
          is_meeting: isMeeting,
          remind_before_minutes: remindBeforeMinutes ?? undefined,
          waiting_on_person: raw.waiting_on_person ? String(raw.waiting_on_person) : null,
          waiting_context: raw.waiting_context ? String(raw.waiting_context) : null,
          waiting_since: raw.status === "waiting" ? formatIsoDate(new Date(), timeZone) : null,
          follow_up_at: raw.follow_up_at ? String(raw.follow_up_at) : null,
          source: "telegram",
        },
        timeZone
      );
      created += 1;
    }

    summary =
      updatedDupes > 0
        ? `Добавлено новых задач: ${created} (пропущено уже существующих дублей: ${updatedDupes}).`
        : `Добавлено задач: ${created}.`;
  } else if (action.action_kind === "reschedule_tasks") {
    const updates = Array.isArray(payload.updates) ? payload.updates : [];
    let count = 0;
    for (const u of updates as Record<string, unknown>[]) {
      if (!u.task_id) continue;
      const patch: TaskUpdate = {};
      if (u.planned_date !== undefined) {
        patch.planned_date = u.planned_date ? String(u.planned_date) : null;
      }
      if (u.day_slot !== undefined) patch.day_slot = String(u.day_slot) as DaySlot;
      if (u.status !== undefined) patch.status = String(u.status) as TaskStatus;
      if (u.priority !== undefined) patch.priority = Number(u.priority);
      if (u.estimated_minutes !== undefined) {
        patch.estimated_minutes = u.estimated_minutes ? Number(u.estimated_minutes) : null;
      }
      if (u.is_meeting !== undefined) patch.is_meeting = Boolean(u.is_meeting);

      if (u.scheduled_start_at !== undefined) {
        patch.scheduled_start_at = u.scheduled_start_at ? String(u.scheduled_start_at) : null;
      } else if (u.scheduled_time && (u.planned_date || typeof u.planned_date === "string")) {
        const built = buildScheduledRangeFromClockTime({
          dateStr: String(u.planned_date),
          startTime: String(u.scheduled_time),
          endTime: u.scheduled_end_time ? String(u.scheduled_end_time) : null,
          durationMinutes: u.estimated_minutes ? Number(u.estimated_minutes) : undefined,
          isMeeting: u.is_meeting !== undefined ? Boolean(u.is_meeting) : undefined,
          timeZone,
        });
        patch.scheduled_start_at = built.scheduled_start_at;
        patch.scheduled_end_at = built.scheduled_end_at;
        patch.planned_date = built.planned_date;
        patch.day_slot = built.day_slot;
      }
      if (u.scheduled_end_at !== undefined) {
        patch.scheduled_end_at = u.scheduled_end_at ? String(u.scheduled_end_at) : null;
      }
      if (u.remind_before_minutes !== undefined) {
        patch.remind_before_minutes =
          u.remind_before_minutes === null ? null : Number(u.remind_before_minutes);
      }
      if (u.waiting_on_person !== undefined) {
        patch.waiting_on_person = u.waiting_on_person ? String(u.waiting_on_person) : null;
      }
      if (u.follow_up_at !== undefined) {
        patch.follow_up_at = u.follow_up_at ? String(u.follow_up_at) : null;
      }
      await updateTask(db, Number(u.task_id), patch, timeZone);
      count += 1;
    }
    summary = `Обновлено задач в плане: ${count}.`;
  } else if (action.action_kind === "update_day_plan") {
    const planDate = String(payload.plan_date ?? formatIsoDate(new Date(), timeZone));
    await upsertDayPlan(db, userId, planDate, {
      main_focus:
        payload.main_focus !== undefined
          ? payload.main_focus
            ? String(payload.main_focus)
            : null
          : undefined,
      buffer_minutes:
        payload.buffer_minutes !== undefined ? Number(payload.buffer_minutes) : undefined,
      available_minutes:
        payload.available_minutes !== undefined ? Number(payload.available_minutes) : undefined,
      energy_mode: payload.energy_mode ? String(payload.energy_mode) : undefined,
      notes: payload.notes !== undefined ? (payload.notes ? String(payload.notes) : null) : undefined,
    });
    summary = `План дня на ${planDate} обновлён.`;
  } else if (action.action_kind === "save_agreement") {
    const ruleText = String(payload.rule_text ?? "").trim();
    if (ruleText) {
      await createAssistantAgreement(db, {
        user_id: userId,
        scope: (payload.scope as string) || "general",
        rule_text: ruleText,
        source: "telegram_confirmed",
      });
      summary = `Правило сохранено: «${ruleText}».`;
    }
  } else if (action.action_kind === "create_expenses" || action.action_kind === "create_income") {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const { data: defaultAcc } = await db
      .from("finance_accounts")
      .select("id, balance")
      .eq("user_id", userId)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!defaultAcc) {
      throw new Error("Не найден активный финансовый счёт для записи операции");
    }

    let total = 0;
    let count = 0;
    for (const item of items as Record<string, unknown>[]) {
      const amount = Number(item.amount ?? 0);
      if (amount <= 0) continue;
      const accountId = Number(item.account_id ?? defaultAcc.id);
      const kind = action.action_kind === "create_income" ? "income" : "expense";
      const spendNature = String(item.spend_nature ?? "personal");
      const reimbursable =
        spendNature === "personal" ? 0 : Number(item.reimbursable_amount ?? amount);

      const { error: txErr } = await db.from("finance_transactions").insert({
        user_id: userId,
        account_id: accountId,
        kind,
        amount,
        currency: String(item.currency ?? "RUB"),
        description: item.description ? String(item.description) : String(item.category_name ?? ""),
        spend_nature: spendNature,
        personal_share_amount: Math.max(amount - reimbursable, 0),
        reimbursable_amount: reimbursable,
        reimbursement_status: reimbursable > 0 ? "pending" : "not_applicable",
        source: (item.source as string) || "telegram_text",
      });
      if (txErr) throw txErr;
      total += amount;
      count += 1;
    }
    summary = `Записано операций: ${count} на сумму ${total.toLocaleString("ru-RU")} ₽.`;
  }

  const updated = await updatePendingAction(db, id, {
    status: "confirmed",
    resolved_at: new Date().toISOString(),
  });

  return { action: updated, summary };
}

// ============================================================================
// Composite Snapshot Helpers (Dashboard + Bot Grounding)
// ============================================================================

export async function getFinanceBalanceSummary(
  db: TypedSupabaseClient
): Promise<FinanceBalanceSummary | null> {
  const { data, error } = await db
    .from("v_finance_balance_summary")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getTodayOverview(
  db: TypedSupabaseClient,
  todayDate: string = formatIsoDate()
) {
  const [
    profile,
    widgets,
    dayPlan,
    todayTasks,
    waitingTasks,
    projects,
    recentCheckins,
    pendingActions,
    financeSummary,
  ] = await Promise.all([
    getOwnerProfile(db),
    getDashboardWidgets(db),
    getDayPlan(db, todayDate),
    listTasks(db, { plannedDate: todayDate, includeDone: true }),
    getWaitingTasks(db),
    listProjects(db),
    listStateCheckins(db, 5),
    listPendingActions(db, ["pending", "editing"]),
    getFinanceBalanceSummary(db),
  ]);

  return {
    todayDate,
    profile,
    widgets,
    dayPlan,
    todayTasks,
    waitingTasks,
    projects,
    latestCheckin: recentCheckins[0] ?? null,
    recentCheckins,
    pendingActions,
    financeSummary,
  };
}

export async function getAssistantFullContext(
  db: TypedSupabaseClient,
  todayDate: string = formatIsoDate()
) {
  const horizonEnd = addDaysToIsoDate(todayDate, 14);
  const [settings, agreements, overview, upcomingTasks] = await Promise.all([
    getAssistantSettings(db),
    listAssistantAgreements(db, true),
    getTodayOverview(db, todayDate),
    listTasks(db, {
      fromDate: todayDate,
      toDate: horizonEnd,
      status: ["inbox", "todo", "in_progress"],
    }),
  ]);

  return {
    settings,
    agreements,
    overview,
    upcomingTasks,
  };
}

export type JsonPayload = Json;
