import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  DEFAULT_REMINDER_LEAD_MINUTES,
  REMINDER_DISABLED_SENTINEL,
  addDaysToIsoDate,
  buildScheduledRangeFromClockTime,
  extractLocalTimeParts,
  findGoalByQueryOrId,
  findProjectsByFuzzyQuery,
  findTasksByFuzzyQuery,
  formatIsoDate,
  formatTaskTimeRange,
  localClockToUtcIso,
  type DaySlot,
  type Goal,
  type Project,
  type SubtaskItem,
  type Task,
  type TaskStatus,
  type TypedSupabaseClient,
} from "@life-os/db";

export const DEFAULT_TIMEZONE = "Europe/Moscow";

/**
 * Loads `/root/life-os/.env` silently without writing anything to stdout.
 */
export function loadEnvSilently(): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(currentDir, "../../../.env"),
    path.resolve(currentDir, "../../.env"),
    path.resolve(currentDir, "../.env"),
    "/root/life-os/.env",
    path.resolve(process.cwd(), ".env"),
  ];

  for (const envPath of candidatePaths) {
    try {
      if (!fs.existsSync(envPath)) continue;
      const content = fs.readFileSync(envPath, "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
      break;
    } catch {
      // Ignore unreadable candidate path
    }
  }
}

export function okResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function errResult(message: string, details?: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          details !== undefined ? { ok: false, error: message, details } : { ok: false, error: message },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Resolves flexible date inputs (`YYYY-MM-DD`, `today`, `tomorrow`, `yesterday`, `сегодня`, `завтра`, `вчера`, `+N`, `-N`).
 */
export function resolveDateInput(
  raw: string | null | undefined,
  timeZone = DEFAULT_TIMEZONE
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  const today = formatIsoDate(new Date(), timeZone);
  if (trimmed === "today" || trimmed === "сегодня") return today;
  if (trimmed === "tomorrow" || trimmed === "завтра") return addDaysToIsoDate(today, 1);
  if (trimmed === "day_after_tomorrow" || trimmed === "послезавтра") return addDaysToIsoDate(today, 2);
  if (trimmed === "yesterday" || trimmed === "вчера") return addDaysToIsoDate(today, -1);

  const relMatch = /^([+-]\d{1,3})d?$/.exec(trimmed);
  if (relMatch) {
    return addDaysToIsoDate(today, Number(relMatch[1]));
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return formatIsoDate(new Date(parsed), timeZone);
  }

  throw new Error(
    `Некорректный формат даты "${raw}". Используй YYYY-MM-DD (например, ${today}) или today/tomorrow.`
  );
}

/**
 * Normalizes priority (`1..4` or string labels).
 */
export function normalizePriority(
  input: number | string | undefined,
  fallback = 2
): number {
  if (input === undefined) return fallback;
  if (typeof input === "number") {
    return Math.max(1, Math.min(4, Math.round(input)));
  }
  const norm = input.trim().toLowerCase();
  if (norm === "1" || norm === "critical" || norm === "top" || norm === "главное" || norm === "высокий" || norm === "high") {
    return 1;
  }
  if (norm === "2" || norm === "normal" || norm === "medium" || norm === "важно" || norm === "обычный") {
    return 2;
  }
  if (norm === "3" || norm === "low" || norm === "низкий" || norm === "обычное") {
    return 3;
  }
  if (norm === "4" || norm === "someday" || norm === "когда-нибудь") {
    return 4;
  }
  return fallback;
}

/**
 * Infers whether a title sounds like a meeting/call when `is_meeting` is omitted.
 */
export function inferIsMeetingFromTitle(title: string): boolean {
  const norm = title.toLowerCase().replace(/ё/g, "е");
  return /(встреч|созвон|звонок|позвон|митинг|зум|zoom|call|консультац|прием у|интервью)/u.test(
    norm
  );
}

/**
 * Normalizes `remind_before_minutes` (`number | number[] | null | undefined`)
 * into `{ primary: number | null; offsets: number[]; disableSentinel: string | null }`.
 */
export function normalizeRemindInput(
  input: number | number[] | null | undefined,
  hasStartTime: boolean
): {
  remind_before_minutes: number | null;
  remind_offsets_minutes: number[];
  reminder_sent_at?: string | null;
} {
  if (!hasStartTime) {
    return {
      remind_before_minutes: null,
      remind_offsets_minutes: [],
    };
  }

  if (input === null) {
    return {
      remind_before_minutes: null,
      remind_offsets_minutes: [],
      reminder_sent_at: REMINDER_DISABLED_SENTINEL,
    };
  }

  if (input === undefined) {
    return {
      remind_before_minutes: DEFAULT_REMINDER_LEAD_MINUTES,
      remind_offsets_minutes: [DEFAULT_REMINDER_LEAD_MINUTES],
      reminder_sent_at: null,
    };
  }

  const arr = (Array.isArray(input) ? input : [input])
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 1440);

  if (arr.length === 0) {
    return {
      remind_before_minutes: null,
      remind_offsets_minutes: [],
      reminder_sent_at: REMINDER_DISABLED_SENTINEL,
    };
  }

  const uniqueSorted = Array.from(new Set(arr)).sort((a, b) => a - b);
  return {
    remind_before_minutes: uniqueSorted[0],
    remind_offsets_minutes: uniqueSorted,
    reminder_sent_at: null,
  };
}

/**
 * Converts string[] or object[] into clean `SubtaskItem[]`.
 */
export function normalizeSubtasksInput(
  raw: Array<string | { id?: string; title: string; done?: boolean }> | undefined
): SubtaskItem[] | undefined {
  if (!raw) return undefined;
  const items: SubtaskItem[] = [];
  raw.forEach((entry, idx) => {
    if (typeof entry === "string") {
      const t = entry.trim();
      if (t) {
        items.push({
          id: `sub_${Date.now().toString(36)}_${idx + 1}`,
          title: t,
          done: false,
        });
      }
    } else if (entry && typeof entry.title === "string" && entry.title.trim()) {
      items.push({
        id: entry.id?.trim() || `sub_${Date.now().toString(36)}_${idx + 1}`,
        title: entry.title.trim(),
        done: Boolean(entry.done),
      });
    }
  });
  return items;
}

/**
 * Parses `starts_at` / `ends_at` (either `HH:MM` in `Europe/Moscow` or full ISO timestamp)
 * into consistent task schedule fields.
 */
export function resolveScheduleInputs(params: {
  plannedDate?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  durationMinutes?: number | null;
  isMeeting?: boolean;
  daySlot?: DaySlot;
  timeZone?: string;
}): {
  planned_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  day_slot: DaySlot;
  estimated_minutes: number | null;
} {
  const tz = params.timeZone ?? DEFAULT_TIMEZONE;
  const resolvedDate = resolveDateInput(params.plannedDate, tz);

  if (!params.startsAt) {
    return {
      planned_date: resolvedDate,
      scheduled_start_at: null,
      scheduled_end_at: null,
      day_slot: params.daySlot ?? "any",
      estimated_minutes: params.durationMinutes ?? null,
    };
  }

  const rawStart = params.startsAt.trim();
  const clockRegex = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const startClockMatch = clockRegex.exec(rawStart);

  if (startClockMatch) {
    const hh = startClockMatch[1].padStart(2, "0");
    const mm = startClockMatch[2];
    const baseDate = resolvedDate ?? formatIsoDate(new Date(), tz);

    let endClock: string | null = null;
    if (params.endsAt) {
      const endMatch = clockRegex.exec(params.endsAt.trim());
      if (endMatch) {
        endClock = `${endMatch[1].padStart(2, "0")}:${endMatch[2]}`;
      }
    }

    const built = buildScheduledRangeFromClockTime({
      dateStr: baseDate,
      startTime: `${hh}:${mm}`,
      endTime: endClock,
      durationMinutes: params.durationMinutes,
      isMeeting: params.isMeeting,
      timeZone: tz,
    });

    if (params.endsAt && !endClock) {
      const parsedEnd = Date.parse(params.endsAt);
      if (!Number.isNaN(parsedEnd) && parsedEnd > Date.parse(built.scheduled_start_at)) {
        built.scheduled_end_at = new Date(parsedEnd).toISOString();
        built.estimated_minutes = Math.max(
          5,
          Math.round((parsedEnd - Date.parse(built.scheduled_start_at)) / 60_000)
        );
      }
    }

    return {
      planned_date: built.planned_date,
      scheduled_start_at: built.scheduled_start_at,
      scheduled_end_at: built.scheduled_end_at,
      day_slot: built.day_slot,
      estimated_minutes: built.estimated_minutes,
    };
  }

  // Otherwise treat `startsAt` as ISO or `YYYY-MM-DD HH:MM`
  const dateClockMatch = /^(\d{4}-\d{2}-\d{2})[T\s]+([01]?\d|2[0-3]):([0-5]\d)$/.exec(rawStart);
  const startIso = dateClockMatch
    ? localClockToUtcIso(
        dateClockMatch[1],
        `${dateClockMatch[2].padStart(2, "0")}:${dateClockMatch[3]}`,
        tz
      )
    : new Date(rawStart).toISOString();

  if (Number.isNaN(Date.parse(startIso))) {
    throw new Error(`Не удалось разобрать время начала "${params.startsAt}". Используй ЧЧ:ММ (например, 14:00) или ISO.`);
  }

  const localStart = extractLocalTimeParts(startIso, tz);
  const defaultDur = params.isMeeting ? 60 : 30;
  let durationMins = params.durationMinutes ?? defaultDur;
  let endIso: string;

  if (params.endsAt) {
    const endClockMatch = clockRegex.exec(params.endsAt.trim());
    if (endClockMatch) {
      endIso = localClockToUtcIso(
        localStart.dateStr,
        `${endClockMatch[1].padStart(2, "0")}:${endClockMatch[2]}`,
        tz
      );
      if (Date.parse(endIso) <= Date.parse(startIso)) {
        endIso = new Date(Date.parse(endIso) + 24 * 60 * 60_000).toISOString();
      }
    } else {
      endIso = new Date(params.endsAt).toISOString();
    }
    durationMins = Math.max(
      5,
      Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000)
    );
  } else {
    endIso = new Date(Date.parse(startIso) + Math.max(5, durationMins) * 60_000).toISOString();
  }

  return {
    planned_date: resolvedDate ?? localStart.dateStr,
    scheduled_start_at: startIso,
    scheduled_end_at: endIso,
    day_slot: localStart.daySlot,
    estimated_minutes: durationMins,
  };
}

/**
 * Parses `follow_up_at` (`YYYY-MM-DD`, `YYYY-MM-DD HH:MM`, `HH:MM`, `tomorrow`, or ISO) into UTC ISO.
 */
export function resolveFollowUpTimestamp(
  raw: string | null | undefined,
  timeZone = DEFAULT_TIMEZONE
): string | null {
  if (raw === null) return null;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return localClockToUtcIso(trimmed, "10:00", timeZone);
  }
  const dtMatch = /^(\d{4}-\d{2}-\d{2})[T\s]+([01]?\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (dtMatch) {
    return localClockToUtcIso(
      dtMatch[1],
      `${dtMatch[2].padStart(2, "0")}:${dtMatch[3]}`,
      timeZone
    );
  }
  if (["today", "tomorrow", "сегодня", "завтра", "послезавтра"].includes(trimmed.toLowerCase())) {
    const d = resolveDateInput(trimmed, timeZone)!;
    return localClockToUtcIso(d, "10:00", timeZone);
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  throw new Error(`Не удалось разобрать дату напоминания follow_up_at: "${raw}"`);
}

/**
 * Resolves a project by numeric ID or fuzzy name query.
 */
export async function resolveProjectRef(
  db: TypedSupabaseClient,
  ref: number | string | null | undefined
): Promise<Project | null> {
  if (ref === null || ref === undefined || ref === "") return null;
  if (typeof ref === "number" || /^\d+$/.test(String(ref).trim())) {
    const id = Number(ref);
    const { data, error } = await db.from("projects").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }
  const matches = await findProjectsByFuzzyQuery(db, String(ref).trim(), true);
  return matches.length > 0 ? matches[0].project : null;
}

/**
 * Resolves a goal by numeric ID or fuzzy title query.
 */
export async function resolveGoalRef(
  db: TypedSupabaseClient,
  ref: number | string | null | undefined
): Promise<Goal | null> {
  if (ref === null || ref === undefined || ref === "") return null;
  const resolved = await findGoalByQueryOrId(db, ref);
  return resolved.goal;
}

/**
 * Formats a task row into a rich, human+LLM friendly summary object with MSK times.
 */
export function formatTaskForMcp(
  task: Task,
  projectMap?: Map<number, Project>,
  timeZone = DEFAULT_TIMEZONE
) {
  const timeRangeMsk = formatTaskTimeRange(task, timeZone);
  const subtasks = Array.isArray(task.subtasks) ? (task.subtasks as unknown as SubtaskItem[]) : [];
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    planned_date: task.planned_date,
    time_msk: timeRangeMsk,
    starts_at: task.scheduled_start_at,
    ends_at: task.scheduled_end_at,
    day_slot: task.day_slot,
    duration_minutes: task.estimated_minutes,
    is_meeting: task.is_meeting,
    due_date: task.due_date,
    project_id: task.project_id,
    project_title: task.project_id ? projectMap?.get(task.project_id)?.title ?? null : null,
    goal_id: task.goal_id,
    tags: task.tags ?? [],
    subtasks,
    remind_before_minutes:
      task.reminder_sent_at === REMINDER_DISABLED_SENTINEL
        ? []
        : task.remind_offsets_minutes?.length
          ? task.remind_offsets_minutes
          : task.remind_before_minutes !== null
            ? [task.remind_before_minutes]
            : [],
    recurrence_rule: task.recurrence_rule,
    waiting:
      task.status === "waiting" || task.waiting_on_person
        ? {
            waiting_for_person: task.waiting_on_person,
            waiting_context: task.waiting_context,
            waiting_since: task.waiting_since,
            follow_up_at: task.follow_up_at,
          }
        : null,
    description: task.notes,
    completed_at: task.completed_at,
  };
}

/**
 * Resolves a single target task by optional `task_id` or (`query` + optional `date`).
 * Never requires knowing internal IDs; returns candidate list if genuinely ambiguous.
 */
export async function resolveTaskTarget(
  db: TypedSupabaseClient,
  params: {
    task_id?: number;
    query?: string;
    date?: string;
    includeDone?: boolean;
    status?: TaskStatus | TaskStatus[];
  }
): Promise<{
  task?: Task;
  candidates?: Array<{ id: number; title: string; planned_date: string | null; time_msk: string | null; status: string; score: number }>;
  error?: string;
}> {
  if (params.task_id) {
    const { data, error } = await db
      .from("tasks")
      .select("*")
      .eq("id", params.task_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return { error: `Задача с id=${params.task_id} не найдена.` };
    }
    return { task: data };
  }

  const q = params.query?.trim();
  if (!q) {
    return { error: "Укажи текстовый запрос `query` (название задачи) или `task_id`." };
  }

  const resolvedDate = resolveDateInput(params.date);
  let matches = await findTasksByFuzzyQuery(db, q, {
    plannedDate: resolvedDate ?? undefined,
    includeDone: params.includeDone ?? true,
    status: params.status,
    limit: 6,
  });

  // Fallback across all dates if date filter yielded nothing
  if (matches.length === 0 && resolvedDate) {
    matches = await findTasksByFuzzyQuery(db, q, {
      includeDone: params.includeDone ?? true,
      status: params.status,
      limit: 6,
    });
  }

  if (matches.length === 0) {
    return {
      error: `Не найдено задач по запросу «${q}»${resolvedDate ? ` (дата ${resolvedDate})` : ""}. Вызови list_tasks или get_day_overview для уточнения.`,
    };
  }

  if (matches.length === 1) {
    return { task: matches[0].task };
  }

  const top = matches[0];
  const second = matches[1];
  if (top.score >= 0.88 && top.score - second.score >= 0.12) {
    return { task: top.task };
  }
  if (top.score >= 0.72 && top.score - second.score >= 0.2) {
    return { task: top.task };
  }

  return {
    candidates: matches.slice(0, 5).map((m) => ({
      id: m.task.id,
      title: m.task.title,
      planned_date: m.task.planned_date,
      time_msk: formatTaskTimeRange(m.task, DEFAULT_TIMEZONE),
      status: m.task.status,
      score: m.score,
    })),
  };
}

/**
 * Computes free time windows between 09:00 and 22:00 MSK for a given day's tasks.
 */
export function computeFreeWindowsMsk(
  tasks: Task[],
  dateStr: string,
  timeZone = DEFAULT_TIMEZONE
): string[] {
  const dayStartMin = 9 * 60;
  const dayEndMin = 22 * 60;
  const busy: Array<[number, number]> = [];

  for (const t of tasks) {
    if (t.status === "done" || t.status === "cancelled" || !t.scheduled_start_at) continue;
    const startParts = extractLocalTimeParts(t.scheduled_start_at, timeZone);
    if (startParts.dateStr !== dateStr) continue;
    const sMin = startParts.hour * 60 + startParts.minute;
    const dur = t.estimated_minutes ?? (t.is_meeting ? 60 : 30);
    const eMin = t.scheduled_end_at
      ? (() => {
          const ep = extractLocalTimeParts(t.scheduled_end_at, timeZone);
          return ep.dateStr === dateStr ? ep.hour * 60 + ep.minute : sMin + dur;
        })()
      : sMin + dur;
    busy.push([Math.max(dayStartMin, sMin), Math.min(dayEndMin, Math.max(sMin + 15, eMin))]);
  }

  busy.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of busy) {
    if (merged.length === 0 || interval[0] > merged[merged.length - 1][1]) {
      merged.push([...interval]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], interval[1]);
    }
  }

  const fmt = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

  const free: string[] = [];
  let cursor = dayStartMin;
  for (const [bStart, bEnd] of merged) {
    if (bStart - cursor >= 30) {
      free.push(`${fmt(cursor)}–${fmt(bStart)}`);
    }
    cursor = Math.max(cursor, bEnd);
  }
  if (dayEndMin - cursor >= 30) {
    free.push(`${fmt(cursor)}–${fmt(dayEndMin)}`);
  }
  return free;
}
