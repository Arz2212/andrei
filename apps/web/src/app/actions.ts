"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  DEFAULT_REMINDER_LEAD_MINUTES,
  buildScheduledRangeFromClockTime,
  cancelPendingAction,
  createAssistantAgreement,
  createProject,
  createStateCheckin,
  createTask,
  deleteAssistantAgreement,
  deleteDailyReview,
  deleteEveningCriterion,
  deleteProject,
  deleteStateCheckin,
  deleteTask,
  executePendingAction,
  findTimeConflicts,
  formatIsoDate,
  getDailyReview,
  getDayPlan,
  getDayPlansInRange,
  getWeekBoundsIso,
  listTasksInDateRange,
  toggleTaskDone,
  updateAssistantAgreement,
  updateAssistantSettings,
  updateDashboardWidgetsLayout,
  updateOwnerProfile,
  updateProject,
  updateStateCheckin,
  updateTask,
  upsertDailyReview,
  upsertDayPlan,
  upsertEveningCriterion,
  type DailyReview,
  type DashboardWidgetLayoutItem,
  type Database,
  type DayPlan,
  type DaySlot,
  type LifeArea,
  type SubtaskItem,
  type Task,
  type TaskStatus,
} from "@life-os/db";
import { getServerSupabase, requireOwnerSession } from "@/lib/supabase/server";

function revalidateAll() {
  revalidatePath("/", "layout");
}

export async function signOutAction() {
  const db = await getServerSupabase();
  await db.auth.signOut();
  redirect("/login");
}

// ============================================================================
// Calendar & Day/Week Range Fetchers (Past / Present / Future)
// ============================================================================

export async function fetchDayScheduleAction(dateIso: string): Promise<{
  dateIso: string;
  tasks: Task[];
  dayPlan: DayPlan | null;
}> {
  const { db } = await requireOwnerSession();
  const [tasks, dayPlan] = await Promise.all([
    listTasksInDateRange(db, {
      startDate: dateIso,
      endDate: dateIso,
      includeDone: true,
    }),
    getDayPlan(db, dateIso),
  ]);
  return { dateIso, tasks, dayPlan };
}

export async function fetchWeekScheduleAction(anchorDateIso: string): Promise<{
  weekStart: string;
  weekEnd: string;
  dates: string[];
  tasks: Task[];
  dayPlans: DayPlan[];
}> {
  const { db } = await requireOwnerSession();
  const bounds = getWeekBoundsIso(anchorDateIso);
  const [tasks, dayPlans] = await Promise.all([
    listTasksInDateRange(db, {
      startDate: bounds.weekStart,
      endDate: bounds.weekEnd,
      includeDone: true,
    }),
    getDayPlansInRange(db, bounds.weekStart, bounds.weekEnd),
  ]);
  return {
    weekStart: bounds.weekStart,
    weekEnd: bounds.weekEnd,
    dates: bounds.dates,
    tasks,
    dayPlans,
  };
}

// ============================================================================
// Tasks, Exact Time Conflicts, Projects & Day Plan Actions
// ============================================================================

export async function toggleTaskAction(taskId: number, done: boolean) {
  const { db } = await requireOwnerSession();
  await toggleTaskDone(db, taskId, done);
  revalidateAll();
}

export interface ConflictPreviewItem {
  id: number;
  title: string;
  timeRangeLabel: string;
  plannedDate: string | null;
}

export async function checkTaskConflictAction(params: {
  plannedDate: string;
  startTime: string;
  durationMinutes?: number | null;
  isMeeting?: boolean;
  excludeTaskId?: number;
}): Promise<ConflictPreviewItem[]> {
  if (!params.plannedDate || !/^\d{2}:\d{2}$/.test(params.startTime)) {
    return [];
  }
  const { db } = await requireOwnerSession();
  const range = buildScheduledRangeFromClockTime({
    dateStr: params.plannedDate,
    startTime: params.startTime,
    durationMinutes: params.durationMinutes,
    isMeeting: params.isMeeting,
    timeZone: "Europe/Moscow",
  });
  const conflicts = await findTimeConflicts(db, {
    startAt: range.scheduled_start_at,
    endAt: range.scheduled_end_at,
    durationMinutes: range.estimated_minutes,
    isMeeting: params.isMeeting,
    excludeTaskId: params.excludeTaskId,
    timeZone: "Europe/Moscow",
  });
  return conflicts.map((c) => ({
    id: c.task.id,
    title: c.task.title,
    timeRangeLabel: c.timeRangeLabel,
    plannedDate: c.plannedDate,
  }));
}

export interface SaveTaskPayload {
  id?: number;
  title: string;
  notes?: string | null;
  status?: TaskStatus;
  priority?: number;
  tags?: string[];
  subtasks?: SubtaskItem[];
  recurrence_rule?: string | null;
  planned_date?: string | null;
  day_slot?: DaySlot;
  estimated_minutes?: number | null;
  due_date?: string | null;
  project_id?: number | null;
  scheduled_time?: string | null;
  is_meeting?: boolean;
  remind_before_minutes?: number | null;
  remind_offsets_minutes?: number[];
  waiting_on_person?: string | null;
  waiting_context?: string | null;
  follow_up_at?: string | null;
}

export async function saveTaskAction(payload: SaveTaskPayload) {
  const { db, userId } = await requireOwnerSession();
  const title = payload.title.trim();
  if (!title) throw new Error("Укажи название задачи");

  const status: TaskStatus = payload.status ?? "todo";
  const isWaiting = status === "waiting";
  const isMeeting = Boolean(payload.is_meeting);
  const rawTime = payload.scheduled_time?.trim() || null;

  let scheduledStartAt: string | null = null;
  let scheduledEndAt: string | null = null;
  let plannedDate: string | null = payload.planned_date || null;
  let daySlot: DaySlot = payload.day_slot ?? "any";
  let estimatedMinutes: number | null =
    payload.estimated_minutes && payload.estimated_minutes > 0
      ? payload.estimated_minutes
      : null;

  if (rawTime && /^\d{2}:\d{2}$/.test(rawTime)) {
    const baseDate = plannedDate || formatIsoDate();
    const range = buildScheduledRangeFromClockTime({
      dateStr: baseDate,
      startTime: rawTime,
      durationMinutes: estimatedMinutes ?? (isMeeting ? 60 : 30),
      isMeeting,
      timeZone: "Europe/Moscow",
    });
    scheduledStartAt = range.scheduled_start_at;
    scheduledEndAt = range.scheduled_end_at;
    plannedDate = range.planned_date;
    daySlot = range.day_slot;
    estimatedMinutes = range.estimated_minutes;
  }

  const remindBeforeMinutes = scheduledStartAt
    ? payload.remind_before_minutes !== undefined
      ? payload.remind_before_minutes
      : DEFAULT_REMINDER_LEAD_MINUTES
    : null;

  const remindOffsetsMinutes =
    scheduledStartAt && remindBeforeMinutes !== null
      ? payload.remind_offsets_minutes?.length
        ? payload.remind_offsets_minutes
        : [remindBeforeMinutes]
      : [];

  const cleanTags = (payload.tags ?? [])
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);

  const cleanSubtasks = (payload.subtasks ?? [])
    .filter((s) => s.title.trim().length > 0)
    .map((s) => ({
      id: s.id || `sub_${Math.random().toString(36).slice(2, 9)}`,
      title: s.title.trim(),
      done: Boolean(s.done),
    }));

  const common = {
    title,
    notes: payload.notes?.trim() || null,
    status,
    priority: payload.priority ?? 2,
    tags: cleanTags,
    subtasks:
      cleanSubtasks as unknown as Database["public"]["Tables"]["tasks"]["Insert"]["subtasks"],
    recurrence_rule: payload.recurrence_rule?.trim() || null,
    planned_date: plannedDate,
    day_slot: daySlot,
    estimated_minutes: estimatedMinutes,
    due_date: payload.due_date || null,
    project_id: payload.project_id || null,
    scheduled_start_at: scheduledStartAt,
    scheduled_end_at: scheduledEndAt,
    is_meeting: isMeeting,
    remind_before_minutes: remindBeforeMinutes,
    remind_offsets_minutes: remindOffsetsMinutes,
    waiting_on_person: isWaiting ? payload.waiting_on_person?.trim() || null : null,
    waiting_context: isWaiting ? payload.waiting_context?.trim() || null : null,
    follow_up_at:
      isWaiting && payload.follow_up_at
        ? new Date(payload.follow_up_at).toISOString()
        : null,
  };

  if (payload.id) {
    await updateTask(db, payload.id, common);
  } else {
    await createTask(db, {
      user_id: userId,
      ...common,
      waiting_since: isWaiting ? formatIsoDate() : null,
      source: "web",
    });
  }

  revalidateAll();
}

export async function deleteTaskAction(taskId: number) {
  const { db } = await requireOwnerSession();
  await deleteTask(db, taskId);
  revalidateAll();
}

export async function saveProjectAction(payload: {
  id?: number;
  title: string;
  life_area: LifeArea;
  description?: string | null;
  due_date?: string | null;
  status?: "active" | "on_hold" | "completed" | "archived";
}) {
  const { db, userId } = await requireOwnerSession();
  const title = payload.title.trim();
  if (!title) throw new Error("Укажи название проекта");

  const accentMap: Record<LifeArea, string> = {
    work: "domain-work",
    study: "domain-mind",
    launch: "domain-finance",
    personal: "domain-nutrition",
    health: "domain-health",
  };

  if (payload.id) {
    await updateProject(db, payload.id, {
      title,
      life_area: payload.life_area,
      description: payload.description?.trim() || null,
      due_date: payload.due_date || null,
      accent_token: accentMap[payload.life_area],
      status: payload.status ?? "active",
    });
  } else {
    await createProject(db, {
      user_id: userId,
      title,
      life_area: payload.life_area,
      description: payload.description?.trim() || null,
      due_date: payload.due_date || null,
      accent_token: accentMap[payload.life_area],
      status: payload.status ?? "active",
    });
  }

  revalidateAll();
}

export async function deleteProjectAction(projectId: number) {
  const { db } = await requireOwnerSession();
  await deleteProject(db, projectId);
  revalidateAll();
}

export async function saveDayPlanAction(payload: {
  plan_date: string;
  main_focus?: string | null;
  available_minutes: number;
  buffer_minutes: number;
  energy_mode?: "low" | "normal" | "high" | "recovery";
}) {
  const { db, userId } = await requireOwnerSession();
  await upsertDayPlan(db, userId, payload.plan_date, {
    main_focus: payload.main_focus?.trim() || null,
    available_minutes: Math.max(60, Math.min(1440, payload.available_minutes)),
    buffer_minutes: Math.max(0, Math.min(720, payload.buffer_minutes)),
    energy_mode: payload.energy_mode ?? "normal",
  });
  revalidateAll();
}

// ============================================================================
// Dashboard Customization & Pending Actions (HITL)
// ============================================================================

export async function saveDashboardWidgetsAction(
  items: DashboardWidgetLayoutItem[]
) {
  const { db, userId } = await requireOwnerSession();
  await updateDashboardWidgetsLayout(db, userId, items);
  revalidateAll();
}

export async function confirmPendingActionWeb(actionId: number) {
  const { db } = await requireOwnerSession();
  const res = await executePendingAction(db, actionId);
  revalidateAll();
  return res.summary;
}

export async function cancelPendingActionWeb(actionId: number) {
  const { db } = await requireOwnerSession();
  await cancelPendingAction(db, actionId);
  revalidateAll();
}

// ============================================================================
// State Pulse & Evening Split Review (Full CRUD)
// ============================================================================

export async function createStateCheckinAction(payload: {
  mood_score: number;
  energy_score: number;
  tension_score?: number | null;
  context_tags?: string[];
  note?: string | null;
}) {
  const { db, userId } = await requireOwnerSession();
  await createStateCheckin(db, {
    user_id: userId,
    mood_score: payload.mood_score,
    energy_score: payload.energy_score,
    tension_score: payload.tension_score ?? null,
    context_tags: payload.context_tags ?? [],
    note: payload.note?.trim() || null,
    source: "web",
  });
  revalidateAll();
}

export async function updateStateCheckinAction(
  id: number,
  payload: {
    mood_score: number;
    energy_score: number;
    tension_score?: number | null;
    context_tags?: string[];
    note?: string | null;
  }
) {
  const { db } = await requireOwnerSession();
  await updateStateCheckin(db, id, {
    mood_score: payload.mood_score,
    energy_score: payload.energy_score,
    tension_score: payload.tension_score ?? null,
    context_tags: payload.context_tags ?? [],
    note: payload.note?.trim() || null,
  });
  revalidateAll();
}

export async function deleteStateCheckinAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteStateCheckin(db, id);
  revalidateAll();
}

export async function fetchDailyReviewAction(
  reviewDate: string
): Promise<DailyReview | null> {
  const { db } = await requireOwnerSession();
  return getDailyReview(db, reviewDate);
}

export async function saveDailyReviewAction(payload: {
  review_date: string;
  tasks_score?: number | null;
  health_score?: number | null;
  nutrition_score?: number | null;
  habits_score?: number | null;
  day_highlight?: string | null;
  what_drained_energy?: string | null;
  tomorrow_main_thing?: string | null;
}) {
  const { db, userId } = await requireOwnerSession();
  await upsertDailyReview(db, {
    user_id: userId,
    review_date: payload.review_date,
    tasks_score: payload.tasks_score ?? null,
    health_score: payload.health_score ?? null,
    nutrition_score: payload.nutrition_score ?? null,
    habits_score: payload.habits_score ?? null,
    day_highlight: payload.day_highlight?.trim() || null,
    what_drained_energy: payload.what_drained_energy?.trim() || null,
    tomorrow_main_thing: payload.tomorrow_main_thing?.trim() || null,
  });
  revalidateAll();
}

export async function deleteDailyReviewAction(reviewDateOrId: string | number) {
  const { db } = await requireOwnerSession();
  await deleteDailyReview(db, reviewDateOrId);
  revalidateAll();
}

export async function saveEveningCriterionAction(payload: {
  criterion_slug: string;
  domain_key: "tasks" | "health" | "nutrition" | "habits" | "custom";
  label: string;
  scoring_rule_hint: string;
  max_score?: number;
}) {
  const { db, userId } = await requireOwnerSession();
  await upsertEveningCriterion(db, {
    user_id: userId,
    criterion_slug: payload.criterion_slug.trim(),
    domain_key: payload.domain_key,
    label: payload.label.trim(),
    scoring_rule_hint: payload.scoring_rule_hint.trim(),
    max_score: payload.max_score ?? 5,
    is_active: true,
  });
  revalidateAll();
}

export async function deleteEveningCriterionAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteEveningCriterion(db, id);
  revalidateAll();
}

// ============================================================================
// Assistant Settings, Agreements & Owner Profile
// ============================================================================

export async function saveAssistantSettingsAction(payload: {
  persona_name: string;
  system_prompt: string;
  tone_guidelines: string;
  morning_digest_time: string;
  evening_review_time: string;
  proactive_reminders_enabled: boolean;
}) {
  const { db, userId } = await requireOwnerSession();
  await updateAssistantSettings(db, userId, {
    persona_name: payload.persona_name.trim() || "Напарник",
    system_prompt: payload.system_prompt.trim(),
    tone_guidelines: payload.tone_guidelines.trim(),
    morning_digest_time: payload.morning_digest_time,
    evening_review_time: payload.evening_review_time,
    proactive_reminders_enabled: payload.proactive_reminders_enabled,
  });
  revalidateAll();
}

export async function createAgreementAction(payload: {
  scope:
    | "general"
    | "planning"
    | "finance"
    | "health"
    | "nutrition"
    | "communication";
  rule_text: string;
}) {
  const { db, userId } = await requireOwnerSession();
  const text = payload.rule_text.trim();
  if (!text) throw new Error("Введи формулировку правила");
  await createAssistantAgreement(db, {
    user_id: userId,
    scope: payload.scope,
    rule_text: text,
    source: "web",
  });
  revalidateAll();
}

export async function toggleAgreementAction(id: number, isActive: boolean) {
  const { db } = await requireOwnerSession();
  await updateAssistantAgreement(db, id, { is_active: isActive });
  revalidateAll();
}

export async function deleteAgreementAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteAssistantAgreement(db, id);
  revalidateAll();
}

export async function saveOwnerProfileSettingsAction(payload: {
  display_name: string;
  daily_buffer_minutes: number;
  default_available_minutes: number;
  telegram_forum_chat_id?: number | null;
  telegram_topic_map?: Record<string, number>;
  enable_calories_off: boolean;
}) {
  const { db, userId } = await requireOwnerSession();
  await updateOwnerProfile(db, userId, {
    display_name: payload.display_name.trim() || "Владелец",
    daily_buffer_minutes: payload.daily_buffer_minutes,
    default_available_minutes: payload.default_available_minutes,
    telegram_forum_chat_id: payload.telegram_forum_chat_id ?? null,
    telegram_topic_map: payload.telegram_topic_map ?? {},
    feature_flags: {
      enable_calories_off: payload.enable_calories_off,
    },
  });
  revalidateAll();
}
