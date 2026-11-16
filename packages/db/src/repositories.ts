import type { Json } from "./database.types";
import {
  cancelEntityRemindersInQueue,
  DEFAULT_REMINDER_LEAD_MINUTES,
  REMINDER_DISABLED_SENTINEL,
  syncTaskRemindersToQueue,
} from "./reminders";
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
  DashboardWidgetLayoutItem,
  DayPlan,
  DayPlanUpdate,
  DaySlot,
  EveningReviewCriterion,
  EveningReviewCriterionInsert,
  EveningReviewCriterionUpdate,
  FinanceBalanceSummary,
  FuzzyProjectMatch,
  FuzzyTaskMatch,
  PendingAction,
  PendingActionInsert,
  PendingActionUpdate,
  Project,
  ProjectInsert,
  ProjectUpdate,
  StateCheckin,
  StateCheckinInsert,
  StateCheckinUpdate,
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

export { DEFAULT_REMINDER_LEAD_MINUTES, REMINDER_DISABLED_SENTINEL };

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

export function getWeekBoundsIso(anchorDateStr: string): {
  weekStart: string;
  weekEnd: string;
  dates: string[];
} {
  const [y, m, d] = anchorDateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const jsDay = dt.getUTCDay();
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  const weekStart = addDaysToIsoDate(anchorDateStr, diffToMonday);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysToIsoDate(weekStart, i));
  return {
    weekStart,
    weekEnd: dates[6],
    dates,
  };
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
// Title Similarity, Deduplication & Fuzzy Search (Tasks & Projects)
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
  "задачу",
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

function stemRussianToken(word: string): string {
  let w = word;
  if (w.startsWith("научрук")) return "научн";
  if (w.startsWith("позвон") || w.startsWith("созвон") || w.startsWith("звон")) return "звон";
  if (w.startsWith("напис") || w.startsWith("письм")) return "напис";
  if (w.length >= 6) w = w.slice(0, 5);
  else if (w.length === 5) w = w.slice(0, 4);
  else if (w.length === 4 && /[аяуюеиыо]$/.test(w)) w = w.slice(0, 3);
  return w;
}

function tokenizeTaskTitle(title: string, filterStopwords = true): string[] {
  const norm = normalizeTaskTitleForDedup(title);
  if (!norm) return [];
  return norm
    .split(" ")
    .filter((w) => w.length >= 3 && (!filterStopwords || !RU_EN_STOPWORDS.has(w)))
    .map(stemRussianToken);
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

export async function findTasksByFuzzyQuery(
  db: TypedSupabaseClient,
  queryText: string,
  options: {
    status?: TaskStatus | TaskStatus[];
    plannedDate?: string;
    includeDone?: boolean;
    limit?: number;
  } = {}
): Promise<FuzzyTaskMatch[]> {
  const normQuery = normalizeTaskTitleForDedup(queryText);
  if (!normQuery) return [];

  let dbQuery = db.from("tasks").select("*").neq("status", "cancelled");
  if (options.status) {
    if (Array.isArray(options.status)) {
      dbQuery = dbQuery.in("status", options.status);
    } else {
      dbQuery = dbQuery.eq("status", options.status);
    }
  } else if (options.includeDone === false) {
    dbQuery = dbQuery.neq("status", "done");
  }

  if (options.plannedDate) {
    dbQuery = dbQuery.eq("planned_date", options.plannedDate);
  }

  const { data, error } = await dbQuery;
  if (error) throw error;

  const queryTokens = Array.from(new Set(tokenizeTaskTitle(queryText, true)));
  const fallbackQueryTokens =
    queryTokens.length > 0
      ? queryTokens
      : Array.from(new Set(tokenizeTaskTitle(queryText, false)));

  const scored: FuzzyTaskMatch[] = [];
  for (const task of data ?? []) {
    const normTitle = normalizeTaskTitleForDedup(task.title);
    let score = 0;

    if (normTitle === normQuery) {
      score = 1.0;
    } else if (normTitle.includes(normQuery) || (normQuery.length >= 6 && normQuery.includes(normTitle))) {
      score = 0.92;
    } else if (fallbackQueryTokens.length > 0) {
      const titleTokens = new Set(tokenizeTaskTitle(task.title, false));
      const notesTokens = task.notes ? new Set(tokenizeTaskTitle(task.notes, false)) : new Set<string>();
      const waitingTokens = task.waiting_on_person
        ? new Set(tokenizeTaskTitle(task.waiting_on_person, false))
        : new Set<string>();
      const tagTokens = Array.isArray(task.tags)
        ? new Set(task.tags.flatMap((tg) => tokenizeTaskTitle(tg, false)))
        : new Set<string>();

      let titleHits = 0;
      let auxHits = 0;
      for (const qt of fallbackQueryTokens) {
        if (titleTokens.has(qt)) {
          titleHits += 1;
        } else if (
          Array.from(titleTokens).some((tt) => tt.startsWith(qt) || qt.startsWith(tt))
        ) {
          titleHits += 0.85;
        } else if (notesTokens.has(qt) || waitingTokens.has(qt) || tagTokens.has(qt)) {
          auxHits += 0.5;
        }
      }

      const coverage = (titleHits + auxHits) / fallbackQueryTokens.length;
      const precision =
        titleTokens.size > 0 ? titleHits / Math.max(titleTokens.size, fallbackQueryTokens.length) : 0;
      score = coverage * 0.78 + precision * 0.22;
    }

    if (score >= 0.35) {
      const activeBoost = task.status !== "done" ? 0.02 : 0;
      scored.push({ task, score: Math.min(1, Number((score + activeBoost).toFixed(3))) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, options.limit ?? 8);
}

export async function findProjectsByFuzzyQuery(
  db: TypedSupabaseClient,
  queryText: string,
  includeArchived = false
): Promise<FuzzyProjectMatch[]> {
  const normQuery = normalizeTaskTitleForDedup(queryText);
  if (!normQuery) return [];

  const projects = await listProjects(db, includeArchived);
  const qTokens = Array.from(new Set(tokenizeTaskTitle(queryText, false)));
  const results: FuzzyProjectMatch[] = [];

  for (const project of projects) {
    const normTitle = normalizeTaskTitleForDedup(project.title);
    let score = 0;
    if (normTitle === normQuery) {
      score = 1.0;
    } else if (normTitle.includes(normQuery) || (normQuery.length >= 4 && normQuery.includes(normTitle))) {
      score = 0.9;
    } else if (qTokens.length > 0) {
      const pTokens = new Set(tokenizeTaskTitle(project.title, false));
      let hits = 0;
      for (const qt of qTokens) {
        if (pTokens.has(qt) || Array.from(pTokens).some((pt) => pt.startsWith(qt) || qt.startsWith(pt))) {
          hits += 1;
        }
      }
      score = hits / qTokens.length;
    }
    if (score >= 0.4) {
      results.push({ project, score: Number(score.toFixed(3)) });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
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
  patch: {
    is_visible?: boolean;
    desktop_order?: number;
    mobile_order?: number;
    desktop_col_span?: number;
  }
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

export async function updateDashboardWidgetsLayout(
  db: TypedSupabaseClient,
  userId: string,
  items: DashboardWidgetLayoutItem[]
): Promise<DashboardWidget[]> {
  const rows = items.map((item) => ({
    user_id: userId,
    widget_key: item.widget_key,
    is_visible: item.is_visible,
    desktop_order: item.desktop_order,
    mobile_order: item.mobile_order,
    desktop_col_span: item.desktop_col_span,
  }));

  const { data, error } = await db
    .from("dashboard_widgets")
    .upsert(rows, { onConflict: "user_id,widget_key" })
    .select("*");
  if (error) throw error;
  return (data ?? []).sort((a, b) => a.desktop_order - b.desktop_order);
}

export async function saveDashboardWidgetOrder(
  db: TypedSupabaseClient,
  userId: string,
  items: {
    widget_key: WidgetKey;
    is_visible: boolean;
    desktop_order: number;
    mobile_order: number;
    desktop_col_span?: number;
  }[]
): Promise<void> {
  await updateDashboardWidgetsLayout(
    db,
    userId,
    items.map((item) => ({
      widget_key: item.widget_key,
      is_visible: item.is_visible,
      desktop_order: item.desktop_order,
      mobile_order: item.mobile_order,
      desktop_col_span: item.desktop_col_span ?? 6,
    }))
  );
}

// ============================================================================
// Projects Full CRUD
// ============================================================================

export async function listProjects(
  db: TypedSupabaseClient,
  includeArchived = false
): Promise<Project[]> {
  let query = db
    .from("projects")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (!includeArchived) {
    query = query.neq("status", "archived");
  }
  const { data, error } = await query;
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

export async function deleteProject(
  db: TypedSupabaseClient,
  projectId: number
): Promise<void> {
  const { error } = await db.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

// ============================================================================
// Tasks, Range Queries, Exact Schedule, Time Conflicts & Automatic Queue Sync
// ============================================================================

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

export async function listTasksInDateRange(
  db: TypedSupabaseClient,
  params: {
    startDate: string;
    endDate: string;
    includeDone?: boolean;
    includeInbox?: boolean;
    timeZone?: string;
  }
): Promise<Task[]> {
  const includeDone = params.includeDone ?? true;
  const tz = params.timeZone ?? "Europe/Moscow";
  const rangeStartUtc = localClockToUtcIso(params.startDate, "00:00", tz);
  const nextDayStr = addDaysToIsoDate(params.endDate, 1);
  const rangeEndUtc = localClockToUtcIso(nextDayStr, "00:00", tz);

  let byPlannedQuery = db
    .from("tasks")
    .select("*")
    .neq("status", "cancelled")
    .gte("planned_date", params.startDate)
    .lte("planned_date", params.endDate);

  let byScheduledQuery = db
    .from("tasks")
    .select("*")
    .neq("status", "cancelled")
    .gte("scheduled_start_at", rangeStartUtc)
    .lt("scheduled_start_at", rangeEndUtc);

  if (!includeDone) {
    byPlannedQuery = byPlannedQuery.neq("status", "done");
    byScheduledQuery = byScheduledQuery.neq("status", "done");
  }

  const promises: PromiseLike<{ data: Task[] | null; error: unknown }>[] = [
    byPlannedQuery,
    byScheduledQuery,
  ];

  if (params.includeInbox) {
    promises.push(
      db.from("tasks").select("*").eq("status", "inbox").is("planned_date", null)
    );
  }

  const results = await Promise.all(promises);
  const byId = new Map<number, Task>();
  for (const res of results) {
    if (res.error) throw res.error;
    for (const row of res.data ?? []) {
      byId.set(row.id, row);
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    const dateA =
      a.planned_date ??
      (a.scheduled_start_at ? extractLocalTimeParts(a.scheduled_start_at, tz).dateStr : "9999-99-99");
    const dateB =
      b.planned_date ??
      (b.scheduled_start_at ? extractLocalTimeParts(b.scheduled_start_at, tz).dateStr : "9999-99-99");
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    if (a.scheduled_start_at && b.scheduled_start_at) {
      return Date.parse(a.scheduled_start_at) - Date.parse(b.scheduled_start_at);
    }
    if (a.scheduled_start_at) return -1;
    if (b.scheduled_start_at) return 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.sort_order - b.sort_order;
  });
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

    const hasExplicitOffsets =
      Array.isArray(next.remind_offsets_minutes) && next.remind_offsets_minutes.length > 0;

    if (next.remind_before_minutes === null && !hasExplicitOffsets) {
      // Explicit null from UI/MCP = disable reminder
      next.remind_offsets_minutes = [];
      if (next.reminder_sent_at === undefined) {
        next.reminder_sent_at = REMINDER_DISABLED_SENTINEL;
      }
    } else if (hasExplicitOffsets) {
      const cleanOffsets = Array.from(new Set(next.remind_offsets_minutes!)).sort((a, b) => b - a);
      next.remind_offsets_minutes = cleanOffsets;
      if (next.remind_before_minutes === undefined) {
        next.remind_before_minutes = cleanOffsets[0] ?? DEFAULT_REMINDER_LEAD_MINUTES;
      }
    } else if (typeof next.remind_before_minutes === "number") {
      next.remind_offsets_minutes = [next.remind_before_minutes];
    } else {
      // Smart default: 30 minutes before timed task/meeting!
      next.remind_before_minutes = DEFAULT_REMINDER_LEAD_MINUTES;
      next.remind_offsets_minutes = [DEFAULT_REMINDER_LEAD_MINUTES];
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
    next.remind_offsets_minutes = [];
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

    if (Array.isArray(next.remind_offsets_minutes)) {
      if (next.remind_offsets_minutes.length === 0 && next.remind_before_minutes === null) {
        next.reminder_sent_at = REMINDER_DISABLED_SENTINEL;
        next.reminder_snoozed_until = null;
      } else if (next.remind_offsets_minutes.length > 0) {
        next.remind_before_minutes =
          next.remind_before_minutes ?? next.remind_offsets_minutes[0];
        if (next.reminder_sent_at === undefined) {
          next.reminder_sent_at = null;
          next.reminder_snoozed_until = null;
        }
      }
    } else if (next.remind_before_minutes === null) {
      next.remind_offsets_minutes = [];
      next.reminder_sent_at = REMINDER_DISABLED_SENTINEL;
      next.reminder_snoozed_until = null;
    } else if (typeof next.remind_before_minutes === "number") {
      next.remind_offsets_minutes = [next.remind_before_minutes];
      if (next.reminder_sent_at === undefined) {
        next.reminder_sent_at = null;
        next.reminder_snoozed_until = null;
      }
    } else if (next.reminder_sent_at === undefined) {
      next.reminder_sent_at = null;
      next.reminder_snoozed_until = null;
    }
  } else if (Array.isArray(next.remind_offsets_minutes)) {
    if (next.remind_offsets_minutes.length === 0) {
      next.remind_before_minutes = null;
      next.reminder_sent_at = REMINDER_DISABLED_SENTINEL;
      next.reminder_snoozed_until = null;
    } else {
      next.remind_before_minutes = next.remind_offsets_minutes[0];
      if (next.reminder_sent_at === undefined) {
        next.reminder_sent_at = null;
        next.reminder_snoozed_until = null;
      }
    }
  } else if (next.remind_before_minutes !== undefined) {
    if (next.remind_before_minutes === null) {
      next.remind_offsets_minutes = [];
      next.reminder_sent_at = REMINDER_DISABLED_SENTINEL;
      next.reminder_snoozed_until = null;
    } else {
      next.remind_offsets_minutes = [next.remind_before_minutes];
      if (next.reminder_sent_at === undefined) {
        next.reminder_sent_at = null;
        next.reminder_snoozed_until = null;
      }
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
  await syncTaskRemindersToQueue(db, data, { timeZone });
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
  await syncTaskRemindersToQueue(db, data, { timeZone });
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
  await syncTaskRemindersToQueue(db, data);
  return data;
}

export async function deleteTask(db: TypedSupabaseClient, id: number): Promise<void> {
  await cancelEntityRemindersInQueue(db, String(id), ["task_start", "waiting_followup"]);
  const { error } = await db.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

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
    const leadMins = task.remind_before_minutes ?? DEFAULT_REMINDER_LEAD_MINUTES;
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

export async function getDayPlansInRange(
  db: TypedSupabaseClient,
  startDate: string,
  endDate: string
): Promise<DayPlan[]> {
  const { data, error } = await db
    .from("day_plans")
    .select("*")
    .gte("plan_date", startDate)
    .lte("plan_date", endDate)
    .order("plan_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
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
// State Check-ins (Pulse 1..10) & Evening Review Full CRUD
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

export async function getStateCheckin(
  db: TypedSupabaseClient,
  id: number
): Promise<StateCheckin | null> {
  const { data, error } = await db
    .from("state_checkins")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createStateCheckin(
  db: TypedSupabaseClient,
  input: StateCheckinInsert
): Promise<StateCheckin> {
  const { data, error } = await db.from("state_checkins").insert(input).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateStateCheckin(
  db: TypedSupabaseClient,
  id: number,
  patch: StateCheckinUpdate
): Promise<StateCheckin> {
  const { data, error } = await db
    .from("state_checkins")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteStateCheckin(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const { error } = await db.from("state_checkins").delete().eq("id", id);
  if (error) throw error;
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

export async function deleteDailyReview(
  db: TypedSupabaseClient,
  reviewDateOrId: string | number
): Promise<void> {
  const query = db.from("daily_reviews").delete();
  const { error } =
    typeof reviewDateOrId === "number"
      ? await query.eq("id", reviewDateOrId)
      : await query.eq("review_date", reviewDateOrId);
  if (error) throw error;
}

// ============================================================================
// Assistant Settings, Agreements, Threads & Pending Actions
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
              ? DEFAULT_REMINDER_LEAD_MINUTES
              : null;

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
          project_id: raw.project_id ? Number(raw.project_id) : null,
          status: (raw.status as TaskStatus) ?? "todo",
          priority: Number(raw.priority ?? 2),
          tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
          subtasks: (Array.isArray(raw.subtasks) ? raw.subtasks : []) as Json,
          planned_date: plannedDate,
          day_slot: daySlot,
          estimated_minutes: estimatedMinutes,
          due_date: raw.due_date ? String(raw.due_date) : null,
          scheduled_start_at: scheduledStartAt,
          scheduled_end_at: scheduledEndAt,
          is_meeting: isMeeting,
          remind_before_minutes: remindBeforeMinutes ?? undefined,
          remind_offsets_minutes: Array.isArray(raw.remind_offsets_minutes)
            ? (raw.remind_offsets_minutes as number[])
            : undefined,
          recurrence_rule: raw.recurrence_rule ? String(raw.recurrence_rule) : null,
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
// Composite Snapshot Helpers (Dashboard + MCP/Notifier Grounding)
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
    listTasksInDateRange(db, {
      startDate: todayDate,
      endDate: todayDate,
      includeDone: true,
    }),
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
  const [settings, agreements, overview, upcomingTasks, todayReview, eveningCriteria] =
    await Promise.all([
      getAssistantSettings(db),
      listAssistantAgreements(db, true),
      getTodayOverview(db, todayDate),
      listTasksInDateRange(db, {
        startDate: todayDate,
        endDate: horizonEnd,
        includeDone: false,
      }),
      getDailyReview(db, todayDate),
      listEveningCriteria(db),
    ]);

  return {
    settings,
    agreements,
    overview,
    upcomingTasks,
    todayReview,
    eveningCriteria,
  };
}

export type JsonPayload = Json;
