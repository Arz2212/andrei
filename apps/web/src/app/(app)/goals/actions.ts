"use server";

import { revalidatePath } from "next/cache";
import {
  archiveHabit,
  deleteGoal,
  deleteHabit,
  linkTaskToGoal,
  manageGoalMilestone,
  setGoalStatus,
  toggleHabitCheckin,
  toggleTaskDone,
  updateGoalNumericValue,
  upsertGoal,
  upsertHabit,
  upsertTask,
  type DaySlot,
  type GoalStatus,
  type UpsertGoalParams,
  type UpsertHabitParams,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";

function revalidateGoalsEcosystem() {
  revalidatePath("/goals");
  revalidatePath("/");
  revalidatePath("/tasks");
}

// ============================================================================
// 1-Tap Habits Actions
// ============================================================================

export async function toggleHabitCheckinAction(payload: {
  habitId: number;
  date?: string;
  completed?: boolean;
  note?: string | null;
}) {
  const { db, userId } = await requireOwnerSession();
  const res = await toggleHabitCheckin(db, userId, {
    habitIdOrQuery: payload.habitId,
    date: payload.date,
    completed: payload.completed,
    note: payload.note,
    source: "web",
  });
  revalidateGoalsEcosystem();
  return res;
}

export async function saveHabitAction(payload: UpsertHabitParams) {
  const { db, userId } = await requireOwnerSession();
  const saved = await upsertHabit(db, userId, payload);
  revalidateGoalsEcosystem();
  return saved;
}

export async function archiveHabitAction(payload: {
  habitId: number;
  archived?: boolean;
}) {
  const { db } = await requireOwnerSession();
  const saved = await archiveHabit(db, payload.habitId, payload.archived ?? true);
  revalidateGoalsEcosystem();
  return saved;
}

export async function deleteHabitAction(habitId: number) {
  const { db } = await requireOwnerSession();
  const res = await deleteHabit(db, habitId);
  revalidateGoalsEcosystem();
  return res;
}

// ============================================================================
// Goals & Milestones Actions
// ============================================================================

export async function saveGoalAction(payload: UpsertGoalParams) {
  const { db, userId } = await requireOwnerSession();
  const saved = await upsertGoal(db, userId, payload);
  revalidateGoalsEcosystem();
  return saved;
}

export async function updateGoalNumericAction(payload: {
  goalId: number;
  value?: number;
  delta?: number;
  autoMarkAchieved?: boolean;
}) {
  const { db, userId } = await requireOwnerSession();
  const updated = await updateGoalNumericValue(db, userId, payload.goalId, {
    value: payload.value,
    delta: payload.delta,
    autoMarkAchieved: payload.autoMarkAchieved ?? true,
  });
  revalidateGoalsEcosystem();
  return updated;
}

export async function setGoalStatusAction(payload: {
  goalId: number;
  status: GoalStatus;
}) {
  const { db } = await requireOwnerSession();
  const updated = await setGoalStatus(db, payload.goalId, payload.status);
  revalidateGoalsEcosystem();
  return updated;
}

export async function deleteGoalAction(goalId: number) {
  const { db } = await requireOwnerSession();
  const res = await deleteGoal(db, goalId);
  revalidateGoalsEcosystem();
  return res;
}

export async function manageGoalMilestoneAction(payload: {
  action: "add" | "toggle" | "update" | "delete";
  goalId?: number;
  milestoneId?: number;
  title?: string;
  dueDate?: string | null;
  isCompleted?: boolean;
  sortOrder?: number;
}) {
  const { db, userId } = await requireOwnerSession();
  const res = await manageGoalMilestone(db, userId, payload.action, {
    goalIdOrQuery: payload.goalId,
    milestoneIdOrQuery: payload.milestoneId,
    title: payload.title,
    dueDate: payload.dueDate,
    isCompleted: payload.isCompleted,
    sortOrder: payload.sortOrder,
  });
  revalidateGoalsEcosystem();
  return res;
}

// ============================================================================
// Goal Concrete Step Tasks Actions
// ============================================================================

export async function createGoalStepTaskAction(payload: {
  goalId: number;
  title: string;
  planned_date?: string | null;
  day_slot?: DaySlot;
  priority?: number;
}) {
  const { db, userId } = await requireOwnerSession();
  const cleanTitle = payload.title.trim();
  if (!cleanTitle) {
    throw new Error("Укажите название шага");
  }

  const created = await upsertTask(db, {
    user_id: userId,
    goal_id: payload.goalId,
    title: cleanTitle,
    status: "todo",
    planned_date: payload.planned_date || null,
    day_slot: payload.day_slot ?? "any",
    priority: payload.priority ?? 2,
    source: "web",
  });

  await db
    .from("goals")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", payload.goalId);

  revalidateGoalsEcosystem();
  return created;
}

export async function toggleGoalLinkedTaskAction(payload: {
  taskId: number;
  completed: boolean;
}) {
  const { db } = await requireOwnerSession();
  const task = await toggleTaskDone(db, payload.taskId, payload.completed);
  if (task.goal_id) {
    await db
      .from("goals")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", task.goal_id);
  }
  revalidateGoalsEcosystem();
  return task;
}

export async function unlinkTaskFromGoalAction(taskId: number) {
  const { db } = await requireOwnerSession();
  const res = await linkTaskToGoal(db, {
    taskIdOrQuery: taskId,
    goalIdOrQuery: null,
  });
  revalidateGoalsEcosystem();
  return res;
}
