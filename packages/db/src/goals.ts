import type { Json } from "./database.types";
import { listWorkoutPrograms, listWorkoutSessions } from "./health";
import { getNutritionAndWeightAnalytics } from "./nutrition";
import {
  cancelEntityRemindersInQueue,
  escapeTelegramHtml,
  resolveDefaultTelegramChatId,
} from "./reminders";
import {
  addDaysToIsoDate,
  findTasksByFuzzyQuery,
  formatIsoDate,
  getDayPlansInRange,
  getOwnerProfile,
  getWeekBoundsIso,
  localClockToUtcIso,
  normalizeTaskTitleForDedup,
  updateTask,
} from "./repositories";
import type {
  FuzzyFinanceMatch,
  Goal,
  GoalComputedProgress,
  GoalInsert,
  GoalLifeArea,
  GoalMilestone,
  GoalMilestoneInsert,
  GoalMilestoneUpdate,
  GoalProgressMode,
  GoalStatus,
  GoalUpdate,
  GoalWithDetails,
  Habit,
  HabitCadence,
  HabitHistoryCell,
  HabitInsert,
  HabitLog,
  HabitPreferredSlot,
  HabitUpdate,
  HabitWithStats,
  LifeAnalyticsSummary,
  ProactiveInsight,
  Project,
  RecordSource,
  Task,
  TodayGoalsSummary,
  TodayHabitsSummary,
  TypedSupabaseClient,
  UserProfile,
} from "./types";

function clampPct(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(100, Math.round(val)));
}

function round1(val: number): number {
  return Math.round((val + Number.EPSILON) * 10) / 10;
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

// ============================================================================
// Goals & Milestones Progress Computation (Supports Increasing & Decreasing!)
// ============================================================================

export function computeGoalProgress(
  goal: Goal,
  milestones: GoalMilestone[] = [],
  linkedTasks: Task[] = []
): GoalComputedProgress {
  const sortedMilestones = [...milestones].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });
  const doneMilestones = sortedMilestones.filter((m) => m.is_completed);
  const openMilestones = sortedMilestones.filter((m) => !m.is_completed);

  const nonCancelledTasks = linkedTasks.filter((t) => t.status !== "cancelled");
  const doneTasks = nonCancelledTasks.filter((t) => t.status === "done");
  const openTasks = nonCancelledTasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => {
      const dateA = a.planned_date ?? a.due_date ?? "9999-99-99";
      const dateB = b.planned_date ?? b.due_date ?? "9999-99-99";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id - b.id;
    });

  const startValue = Number(goal.start_value ?? 0);
  const currentValue = Number(goal.current_value ?? 0);
  const targetValue =
    goal.target_value !== null && goal.target_value !== undefined
      ? Number(goal.target_value)
      : null;
  const isDecreasingNumeric =
    goal.progress_mode === "numeric" && targetValue !== null && targetValue < startValue;

  let progressPct = 0;
  let doneCount = 0;
  let totalCount = 0;

  if (goal.progress_mode === "tasks_linked") {
    if (nonCancelledTasks.length > 0) {
      doneCount = doneTasks.length;
      totalCount = nonCancelledTasks.length;
      progressPct = clampPct((doneCount / totalCount) * 100);
    } else if (sortedMilestones.length > 0) {
      doneCount = doneMilestones.length;
      totalCount = sortedMilestones.length;
      progressPct = clampPct((doneCount / totalCount) * 100);
    } else {
      progressPct = goal.status === "achieved" ? 100 : 0;
    }
  } else if (goal.progress_mode === "milestones") {
    if (sortedMilestones.length > 0) {
      doneCount = doneMilestones.length;
      totalCount = sortedMilestones.length;
      progressPct = clampPct((doneCount / totalCount) * 100);
    } else if (nonCancelledTasks.length > 0) {
      doneCount = doneTasks.length;
      totalCount = nonCancelledTasks.length;
      progressPct = clampPct((doneCount / totalCount) * 100);
    } else {
      progressPct = goal.status === "achieved" ? 100 : 0;
    }
  } else {
    // numeric mode (both increasing e.g. 0 -> 300000 ₽ AND decreasing e.g. 84.0 -> 79.0 кг)
    doneCount = doneTasks.length + doneMilestones.length;
    totalCount = nonCancelledTasks.length + sortedMilestones.length;

    if (targetValue === null) {
      progressPct = goal.status === "achieved" ? 100 : 0;
    } else if (Math.abs(targetValue - startValue) < 1e-6) {
      if (Math.abs(currentValue - targetValue) < 1e-6) {
        progressPct = 100;
      } else if (targetValue > 0) {
        progressPct = clampPct((currentValue / targetValue) * 100);
      } else {
        progressPct = 0;
      }
    } else if (targetValue > startValue) {
      progressPct = clampPct(((currentValue - startValue) / (targetValue - startValue)) * 100);
    } else {
      progressPct = clampPct(((startValue - currentValue) / (startValue - targetValue)) * 100);
    }
  }

  if (goal.status === "achieved") {
    progressPct = 100;
  }

  let isStalled = false;
  let stalledReason: string | null = null;

  if (goal.status === "active" && progressPct < 100) {
    if (
      (goal.progress_mode === "tasks_linked" || goal.progress_mode === "milestones") &&
      openTasks.length === 0 &&
      openMilestones.length === 0
    ) {
      isStalled = true;
      stalledReason = "Нет активных следующих шагов или вех";
    } else {
      const timestamps: number[] = [Date.parse(goal.updated_at)];
      for (const t of nonCancelledTasks) {
        timestamps.push(Date.parse(t.updated_at));
      }
      for (const m of sortedMilestones) {
        timestamps.push(Date.parse(m.updated_at));
      }
      const latestActivityMs = Math.max(...timestamps.filter((ms) => !Number.isNaN(ms)));
      if (Date.now() - latestActivityMs > 14 * 86_400_000) {
        isStalled = true;
        stalledReason = "Без обновлений более 14 дней";
      }
    }
  }

  return {
    progressPct,
    doneCount,
    totalCount,
    currentValue: round2(currentValue),
    startValue: round2(startValue),
    targetValue: targetValue !== null ? round2(targetValue) : null,
    unit: goal.unit,
    isDecreasingNumeric,
    nextActions: openTasks.slice(0, 3),
    openMilestones: openMilestones.slice(0, 4),
    isStalled,
    stalledReason,
  };
}

// ============================================================================
// Goals & Milestones Repository
// ============================================================================

const GOAL_STATUS_SORT: Record<string, number> = {
  active: 1,
  paused: 2,
  achieved: 3,
  dropped: 4,
};

export async function listGoalsWithDetails(
  db: TypedSupabaseClient,
  opts: { status?: GoalStatus | "all"; lifeArea?: string } = {}
): Promise<GoalWithDetails[]> {
  let goalQuery = db
    .from("goals")
    .select("*")
    .order("target_date", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (opts.status && opts.status !== "all") {
    goalQuery = goalQuery.eq("status", opts.status);
  }
  if (opts.lifeArea) {
    goalQuery = goalQuery.eq("life_area", opts.lifeArea);
  }

  const [
    { data: goals, error: gErr },
    { data: milestones, error: mErr },
    { data: linkedTasks, error: tErr },
    { data: linkedProjects, error: pErr },
    { data: linkedHabits, error: hErr },
  ] = await Promise.all([
    goalQuery,
    db
      .from("goal_milestones")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    db.from("tasks").select("*").not("goal_id", "is", null).neq("status", "cancelled"),
    db.from("projects").select("*").not("goal_id", "is", null),
    db.from("habits").select("*").not("goal_id", "is", null).eq("is_archived", false),
  ]);

  if (gErr) throw gErr;
  if (mErr) throw mErr;
  if (tErr) throw tErr;
  if (pErr) throw pErr;
  if (hErr) throw hErr;

  const projectGoalMap = new Map<number, number>();
  const projectsByGoal = new Map<number, Project[]>();
  for (const p of linkedProjects ?? []) {
    if (!p.goal_id) continue;
    projectGoalMap.set(p.id, p.goal_id);
    const arr = projectsByGoal.get(p.goal_id) ?? [];
    arr.push(p);
    projectsByGoal.set(p.goal_id, arr);
  }

  // Also include tasks belonging to a project linked to the goal if task.goal_id is null
  let projectTasks: Task[] = [];
  if (projectGoalMap.size > 0) {
    const projectIds = Array.from(projectGoalMap.keys());
    const { data: pTasks, error: ptErr } = await db
      .from("tasks")
      .select("*")
      .in("project_id", projectIds)
      .is("goal_id", null)
      .neq("status", "cancelled");
    if (ptErr) throw ptErr;
    projectTasks = pTasks ?? [];
  }

  const milestonesByGoal = new Map<number, GoalMilestone[]>();
  for (const m of milestones ?? []) {
    const arr = milestonesByGoal.get(m.goal_id) ?? [];
    arr.push(m);
    milestonesByGoal.set(m.goal_id, arr);
  }

  const tasksByGoal = new Map<number, Map<number, Task>>();
  for (const t of linkedTasks ?? []) {
    if (!t.goal_id) continue;
    const map = tasksByGoal.get(t.goal_id) ?? new Map<number, Task>();
    map.set(t.id, t);
    tasksByGoal.set(t.goal_id, map);
  }
  for (const pt of projectTasks) {
    const gId = pt.project_id ? projectGoalMap.get(pt.project_id) : undefined;
    if (!gId) continue;
    const map = tasksByGoal.get(gId) ?? new Map<number, Task>();
    map.set(pt.id, pt);
    tasksByGoal.set(gId, map);
  }

  const habitsByGoal = new Map<number, Habit[]>();
  for (const h of linkedHabits ?? []) {
    if (!h.goal_id) continue;
    const arr = habitsByGoal.get(h.goal_id) ?? [];
    arr.push(h);
    habitsByGoal.set(h.goal_id, arr);
  }

  return (goals ?? [])
    .map((goal) => {
      const gMilestones = milestonesByGoal.get(goal.id) ?? [];
      const gTasks = Array.from(tasksByGoal.get(goal.id)?.values() ?? []);
      const gProjects = projectsByGoal.get(goal.id) ?? [];
      const gHabits = habitsByGoal.get(goal.id) ?? [];
      return {
        ...goal,
        milestones: gMilestones,
        linkedTasks: gTasks,
        linkedProjects: gProjects,
        linkedHabits: gHabits,
        progress: computeGoalProgress(goal, gMilestones, gTasks),
      };
    })
    .sort((a, b) => {
      const sA = GOAL_STATUS_SORT[a.status] ?? 9;
      const sB = GOAL_STATUS_SORT[b.status] ?? 9;
      if (sA !== sB) return sA - sB;
      const dA = a.target_date ?? "9999-99-99";
      const dB = b.target_date ?? "9999-99-99";
      if (dA !== dB) return dA.localeCompare(dB);
      return a.id - b.id;
    });
}

export async function getGoalWithDetails(
  db: TypedSupabaseClient,
  id: number
): Promise<GoalWithDetails | null> {
  const all = await listGoalsWithDetails(db, { status: "all" });
  return all.find((g) => g.id === id) ?? null;
}

export async function findGoalByQueryOrId(
  db: TypedSupabaseClient,
  queryOrId: string | number | null | undefined,
  opts: { includeAllStatuses?: boolean } = {}
): Promise<{
  goal: GoalWithDetails | null;
  matches: FuzzyFinanceMatch<GoalWithDetails>[];
}> {
  if (queryOrId === null || queryOrId === undefined || String(queryOrId).trim() === "") {
    return { goal: null, matches: [] };
  }

  const goals = await listGoalsWithDetails(db, {
    status: opts.includeAllStatuses === false ? "active" : "all",
  });

  if (typeof queryOrId === "number" || /^\d+$/.test(String(queryOrId).trim())) {
    const id = Number(queryOrId);
    const found = goals.find((g) => g.id === id) ?? null;
    return { goal: found, matches: found ? [{ item: found, score: 1 }] : [] };
  }

  const normQ = normalizeTaskTitleForDedup(String(queryOrId));
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<GoalWithDetails>[] = [];

  for (const g of goals) {
    const normTitle = normalizeTaskTitleForDedup(g.title);
    const hay = `${normTitle} ${normalizeTaskTitleForDedup(g.motivation_note ?? "")} ${g.life_area}`;
    let score = 0;

    if (normTitle === normQ) {
      score = 1.0;
    } else if (normTitle.includes(normQ) || (normQ.length >= 4 && normQ.includes(normTitle))) {
      score = 0.92;
    } else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        const stem = w.slice(0, Math.min(w.length, 4));
        if (hay.includes(stem)) hits += 1;
      }
      score = (hits / qWords.length) * 0.84;
    }

    if (score >= 0.38) {
      const activeBoost = g.status === "active" ? 0.03 : 0;
      scored.push({
        item: g,
        score: Math.min(1, Number((score + activeBoost).toFixed(3))),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return { goal: scored[0]?.item ?? null, matches: scored };
}

export interface GoalMilestoneDraftInput {
  id?: number;
  title: string;
  due_date?: string | null;
  is_completed?: boolean;
  sort_order?: number;
}

export interface UpsertGoalParams {
  id?: number;
  query?: string;
  life_area?: GoalLifeArea;
  title?: string;
  motivation_note?: string | null;
  progress_mode?: GoalProgressMode;
  start_value?: number;
  current_value?: number;
  target_value?: number | null;
  unit?: string | null;
  start_date?: string;
  target_date?: string | null;
  status?: GoalStatus;
  milestones?: GoalMilestoneDraftInput[];
}

export async function upsertGoal(
  db: TypedSupabaseClient,
  userId: string,
  input: UpsertGoalParams
): Promise<GoalWithDetails> {
  let targetId = input.id ?? null;
  if (!targetId && input.query) {
    const resolved = await findGoalByQueryOrId(db, input.query);
    targetId = resolved.goal?.id ?? null;
  }

  let goalRow: Goal;

  if (targetId) {
    const patch: GoalUpdate = {};
    if (input.life_area !== undefined) patch.life_area = input.life_area;
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.motivation_note !== undefined) patch.motivation_note = input.motivation_note;
    if (input.progress_mode !== undefined) patch.progress_mode = input.progress_mode;
    if (input.start_value !== undefined) patch.start_value = round2(Number(input.start_value));
    if (input.current_value !== undefined) {
      patch.current_value = round2(Number(input.current_value));
    }
    if (input.target_value !== undefined) {
      patch.target_value =
        input.target_value !== null ? round2(Number(input.target_value)) : null;
    }
    if (input.unit !== undefined) patch.unit = input.unit;
    if (input.start_date !== undefined) patch.start_date = input.start_date;
    if (input.target_date !== undefined) patch.target_date = input.target_date;
    if (input.status !== undefined) patch.status = input.status;

    const { data, error } = await db
      .from("goals")
      .update(patch)
      .eq("id", targetId)
      .select("*")
      .single();
    if (error) throw error;
    goalRow = data;
  } else {
    if (!input.title || !input.title.trim()) {
      throw new Error("Укажите название цели");
    }
    const mode: GoalProgressMode = input.progress_mode ?? "tasks_linked";
    const curVal = round2(Number(input.current_value ?? 0));
    const tgtVal =
      input.target_value !== undefined && input.target_value !== null
        ? round2(Number(input.target_value))
        : null;

    // Smart start_value default for decreasing numeric goals (e.g. weight 82 -> 78 kg)
    let startVal =
      input.start_value !== undefined ? round2(Number(input.start_value)) : 0;
    if (
      input.start_value === undefined &&
      mode === "numeric" &&
      tgtVal !== null &&
      curVal > tgtVal
    ) {
      startVal = curVal;
    }

    const insertPayload: GoalInsert = {
      user_id: userId,
      life_area: input.life_area ?? "personal",
      title: input.title.trim(),
      motivation_note: input.motivation_note ?? null,
      progress_mode: mode,
      start_value: startVal,
      current_value: curVal,
      target_value: tgtVal,
      unit: input.unit ?? null,
      start_date: input.start_date ?? formatIsoDate(new Date(), "Europe/Moscow"),
      target_date: input.target_date ?? null,
      status: input.status ?? "active",
    };

    const { data, error } = await db
      .from("goals")
      .insert(insertPayload)
      .select("*")
      .single();
    if (error) throw error;
    goalRow = data;
  }

  if (input.milestones !== undefined) {
    const cleanDrafts = input.milestones.filter((m) => m.title && m.title.trim());
    if (targetId) {
      const { error: delErr } = await db
        .from("goal_milestones")
        .delete()
        .eq("goal_id", goalRow.id);
      if (delErr) throw delErr;
    }

    if (cleanDrafts.length > 0) {
      const rows: GoalMilestoneInsert[] = cleanDrafts.map((m, idx) => ({
        user_id: userId,
        goal_id: goalRow.id,
        title: m.title.trim(),
        due_date: m.due_date ?? null,
        is_completed: Boolean(m.is_completed),
        completed_at: m.is_completed ? new Date().toISOString() : null,
        sort_order: m.sort_order ?? idx + 1,
      }));
      const { error: insErr } = await db.from("goal_milestones").insert(rows);
      if (insErr) throw insErr;

      if (goalRow.progress_mode === "milestones") {
        const doneCnt = rows.filter((r) => r.is_completed).length;
        await db
          .from("goals")
          .update({
            current_value: doneCnt,
            target_value: rows.length,
          })
          .eq("id", goalRow.id);
      }
    }
  }

  const full = await getGoalWithDetails(db, goalRow.id);
  if (!full) throw new Error("Цель не найдена после сохранения");
  return full;
}

export async function updateGoalNumericValue(
  db: TypedSupabaseClient,
  _userId: string,
  queryOrId: string | number,
  params: { value?: number; delta?: number; autoMarkAchieved?: boolean }
): Promise<GoalWithDetails> {
  const { goal } = await findGoalByQueryOrId(db, queryOrId);
  if (!goal) throw new Error(`Цель «${queryOrId}» не найдена`);

  const prevValue = Number(goal.current_value ?? 0);
  const nextValue =
    params.value !== undefined
      ? round2(Number(params.value))
      : params.delta !== undefined
        ? round2(prevValue + Number(params.delta))
        : prevValue;

  const patch: GoalUpdate = {
    current_value: nextValue,
  };

  if (params.autoMarkAchieved && goal.target_value !== null) {
    const simulated = computeGoalProgress(
      { ...goal, current_value: nextValue },
      goal.milestones,
      goal.linkedTasks
    );
    if (simulated.progressPct >= 100 && goal.status === "active") {
      patch.status = "achieved";
    }
  }

  const { error } = await db.from("goals").update(patch).eq("id", goal.id);
  if (error) throw error;

  return (await getGoalWithDetails(db, goal.id))!;
}

export async function setGoalStatus(
  db: TypedSupabaseClient,
  queryOrId: string | number,
  status: GoalStatus
): Promise<GoalWithDetails> {
  const { goal } = await findGoalByQueryOrId(db, queryOrId);
  if (!goal) throw new Error(`Цель «${queryOrId}» не найдена`);

  const { error } = await db.from("goals").update({ status }).eq("id", goal.id);
  if (error) throw error;

  return (await getGoalWithDetails(db, goal.id))!;
}

export async function deleteGoal(
  db: TypedSupabaseClient,
  queryOrId: string | number
): Promise<{ deletedGoal: GoalWithDetails }> {
  const { goal } = await findGoalByQueryOrId(db, queryOrId);
  if (!goal) throw new Error(`Цель «${queryOrId}» не найдена`);

  const { error } = await db.from("goals").delete().eq("id", goal.id);
  if (error) throw error;
  return { deletedGoal: goal };
}

export interface ManageGoalMilestoneParams {
  goalIdOrQuery?: number | string;
  milestoneIdOrQuery?: number | string;
  title?: string;
  dueDate?: string | null;
  isCompleted?: boolean;
  sortOrder?: number;
}

export async function manageGoalMilestone(
  db: TypedSupabaseClient,
  userId: string,
  action: "add" | "toggle" | "update" | "delete",
  input: ManageGoalMilestoneParams
): Promise<{ milestone: GoalMilestone | null; goal: GoalWithDetails }> {
  let goal: GoalWithDetails | null = null;
  let targetMilestone: GoalMilestone | null = null;

  if (input.goalIdOrQuery !== undefined && input.goalIdOrQuery !== null) {
    const resolved = await findGoalByQueryOrId(db, input.goalIdOrQuery);
    goal = resolved.goal;
  }

  if (
    input.milestoneIdOrQuery !== undefined &&
    input.milestoneIdOrQuery !== null &&
    String(input.milestoneIdOrQuery).trim() !== ""
  ) {
    const rawM = input.milestoneIdOrQuery;
    if (typeof rawM === "number" || /^\d+$/.test(String(rawM).trim())) {
      const mId = Number(rawM);
      const { data, error } = await db
        .from("goal_milestones")
        .select("*")
        .eq("id", mId)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        targetMilestone = data;
        if (!goal) {
          goal = await getGoalWithDetails(db, data.goal_id);
        }
      }
    } else {
      const candidatePool = goal
        ? goal.milestones
        : ((await db.from("goal_milestones").select("*")).data ?? []);
      const normM = normalizeTaskTitleForDedup(String(rawM));
      let bestScore = 0;
      for (const m of candidatePool) {
        const normTitle = normalizeTaskTitleForDedup(m.title);
        let score = 0;
        if (normTitle === normM) score = 1.0;
        else if (normTitle.includes(normM) || (normM.length >= 4 && normM.includes(normTitle))) {
          score = 0.9;
        } else {
          const words = normM.split(" ").filter((w) => w.length >= 2);
          if (words.length > 0) {
            const hits = words.filter((w) =>
              normTitle.includes(w.slice(0, Math.min(w.length, 4)))
            ).length;
            score = (hits / words.length) * 0.82;
          }
        }
        if (score > bestScore && score >= 0.4) {
          bestScore = score;
          targetMilestone = m;
        }
      }
      if (targetMilestone && !goal) {
        goal = await getGoalWithDetails(db, targetMilestone.goal_id);
      }
    }
  }

  if (!goal) {
    throw new Error("Не удалось определить цель для работы с вехой");
  }

  let savedMilestone: GoalMilestone | null = null;

  if (action === "add") {
    if (!input.title || !input.title.trim()) {
      throw new Error("Укажите название вехи");
    }
    const maxOrder = goal.milestones.reduce((mx, m) => Math.max(mx, m.sort_order), 0);
    const completed = Boolean(input.isCompleted);
    const { data, error } = await db
      .from("goal_milestones")
      .insert({
        user_id: userId,
        goal_id: goal.id,
        title: input.title.trim(),
        due_date: input.dueDate ?? null,
        is_completed: completed,
        completed_at: completed ? new Date().toISOString() : null,
        sort_order: input.sortOrder ?? maxOrder + 1,
      })
      .select("*")
      .single();
    if (error) throw error;
    savedMilestone = data;
  } else {
    if (!targetMilestone) {
      throw new Error("Веха цели не найдена");
    }

    if (action === "delete") {
      const { error } = await db
        .from("goal_milestones")
        .delete()
        .eq("id", targetMilestone.id);
      if (error) throw error;
      savedMilestone = null;
    } else if (action === "toggle") {
      const nextDone =
        input.isCompleted !== undefined ? input.isCompleted : !targetMilestone.is_completed;
      const { data, error } = await db
        .from("goal_milestones")
        .update({
          is_completed: nextDone,
          completed_at: nextDone ? new Date().toISOString() : null,
        })
        .eq("id", targetMilestone.id)
        .select("*")
        .single();
      if (error) throw error;
      savedMilestone = data;
    } else {
      const patch: GoalMilestoneUpdate = {};
      if (input.title !== undefined) patch.title = input.title.trim();
      if (input.dueDate !== undefined) patch.due_date = input.dueDate;
      if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
      if (input.isCompleted !== undefined) {
        patch.is_completed = input.isCompleted;
        patch.completed_at = input.isCompleted ? new Date().toISOString() : null;
      }
      const { data, error } = await db
        .from("goal_milestones")
        .update(patch)
        .eq("id", targetMilestone.id)
        .select("*")
        .single();
      if (error) throw error;
      savedMilestone = data;
    }
  }

  // Touch goal updated_at & sync current_value/target_value if progress_mode = 'milestones'
  const refreshedMilestonesRes = await db
    .from("goal_milestones")
    .select("*")
    .eq("goal_id", goal.id);
  const refreshedMilestones = refreshedMilestonesRes.data ?? [];

  const goalTouchPatch: GoalUpdate = {
    updated_at: new Date().toISOString(),
  };
  if (goal.progress_mode === "milestones") {
    goalTouchPatch.current_value = refreshedMilestones.filter((m) => m.is_completed).length;
    goalTouchPatch.target_value = refreshedMilestones.length;
  }
  await db.from("goals").update(goalTouchPatch).eq("id", goal.id);

  const updatedGoal = (await getGoalWithDetails(db, goal.id))!;
  return { milestone: savedMilestone, goal: updatedGoal };
}

export async function linkTaskToGoal(
  db: TypedSupabaseClient,
  params: {
    taskIdOrQuery: number | string;
    goalIdOrQuery: number | string | null;
  }
): Promise<{ task: Task; goal: GoalWithDetails | null }> {
  let targetTask: Task | null = null;
  if (
    typeof params.taskIdOrQuery === "number" ||
    /^\d+$/.test(String(params.taskIdOrQuery).trim())
  ) {
    const tId = Number(params.taskIdOrQuery);
    const { data, error } = await db.from("tasks").select("*").eq("id", tId).maybeSingle();
    if (error) throw error;
    targetTask = data;
  } else {
    const matches = await findTasksByFuzzyQuery(db, String(params.taskIdOrQuery), {
      includeDone: true,
      limit: 5,
    });
    targetTask = matches[0]?.task ?? null;
  }

  if (!targetTask) {
    throw new Error(`Задача «${params.taskIdOrQuery}» не найдена`);
  }

  let targetGoal: GoalWithDetails | null = null;
  if (
    params.goalIdOrQuery !== null &&
    params.goalIdOrQuery !== undefined &&
    String(params.goalIdOrQuery).trim() !== ""
  ) {
    const resolved = await findGoalByQueryOrId(db, params.goalIdOrQuery);
    if (!resolved.goal) {
      throw new Error(`Цель «${params.goalIdOrQuery}» не найдена`);
    }
    targetGoal = resolved.goal;
  }

  const updatedTask = await updateTask(db, targetTask.id, {
    goal_id: targetGoal ? targetGoal.id : null,
  });

  if (targetGoal) {
    await db
      .from("goals")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", targetGoal.id);
    targetGoal = await getGoalWithDetails(db, targetGoal.id);
  }

  return { task: updatedTask, goal: targetGoal };
}

// ============================================================================
// 1-Tap Habits, Reminders Sync, Streaks & 21-Day Heatmaps
// ============================================================================

export async function syncHabitReminderToQueue(
  db: TypedSupabaseClient,
  habit: Habit,
  options: { timeZone?: string; completedToday?: boolean } = {}
): Promise<void> {
  const entityId = String(habit.id);
  await cancelEntityRemindersInQueue(db, entityId, ["habit_reminder"]);

  if (habit.is_archived || !habit.reminder_time) {
    return;
  }

  const tz = options.timeZone ?? "Europe/Moscow";
  const hhmm = habit.reminder_time.slice(0, 5);
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(hhmm)) {
    return;
  }

  const todayStr = formatIsoDate(new Date(), tz);
  let completedToday = options.completedToday;
  if (completedToday === undefined) {
    const { data: todayLog } = await db
      .from("habit_logs")
      .select("completed")
      .eq("habit_id", habit.id)
      .eq("logged_date", todayStr)
      .maybeSingle();
    completedToday = Boolean(todayLog?.completed);
  }

  const todayTriggerIso = localClockToUtcIso(todayStr, hhmm, tz);
  const targetDate =
    !completedToday && Date.parse(todayTriggerIso) > Date.now() + 60_000
      ? todayStr
      : addDaysToIsoDate(todayStr, 1);
  const triggerAt = localClockToUtcIso(targetDate, hhmm, tz);

  const msg =
    `✨ <b>Напоминание о привычке (${escapeTelegramHtml(hhmm)})</b>\n\n` +
    `✅ <b>${escapeTelegramHtml(habit.title)}</b>` +
    (habit.description
      ? `\n💬 ${escapeTelegramHtml(habit.description.slice(0, 200))}`
      : "");

  const { error } = await db.from("reminders_queue").insert({
    user_id: habit.user_id,
    entity_type: "habit_reminder",
    entity_id: entityId,
    trigger_at: triggerAt,
    message_text: msg,
    status: "pending",
    telegram_chat_id: resolveDefaultTelegramChatId(),
    metadata: {
      habit_id: habit.id,
      reminder_time: hhmm,
      target_date: targetDate,
    } as Json,
  });
  if (error) throw error;
}

function computeHabitStreaksAndAdherence(params: {
  habit: Habit;
  completedMap: Map<string, { completed: boolean; note: string | null }>;
  anchorDate: string;
  historyDays: number;
}): {
  completedOnAnchorDate: boolean;
  anchorDateNote: string | null;
  history: HabitHistoryCell[];
  currentStreak: number;
  bestStreak: number;
  thisWeekDone: number;
  thisWeekTarget: number;
  adherence30dPct: number;
} {
  const { habit, completedMap, anchorDate, historyDays } = params;
  const anchorEntry = completedMap.get(anchorDate);
  const completedOnAnchorDate = Boolean(anchorEntry?.completed);
  const anchorDateNote = anchorEntry?.note ?? null;

  // 1) History array (oldest -> anchorDate)
  const history: HabitHistoryCell[] = [];
  for (let i = historyDays - 1; i >= 0; i--) {
    const d = addDaysToIsoDate(anchorDate, -i);
    const entry = completedMap.get(d);
    history.push({
      date: d,
      completed: Boolean(entry?.completed),
      note: entry?.note ?? null,
    });
  }

  // 2) This week's completions (Mon..Sun containing anchorDate)
  const { dates: weekDates } = getWeekBoundsIso(anchorDate);
  let thisWeekDone = 0;
  for (const wd of weekDates) {
    if (completedMap.get(wd)?.completed) thisWeekDone += 1;
  }
  const thisWeekTarget = habit.cadence === "daily" ? 7 : Math.max(1, habit.target_per_week);

  // 3) Streaks across 90-day lookback
  let currentStreak = 0;
  let bestStreak = 0;

  if (habit.cadence === "daily") {
    // Current streak: count consecutive days ending at anchorDate (or yesterday if today not tapped yet)
    const startOffset = completedOnAnchorDate ? 0 : 1;
    for (let offset = startOffset; offset < 90; offset++) {
      const d = addDaysToIsoDate(anchorDate, -offset);
      if (completedMap.get(d)?.completed) {
        currentStreak += 1;
      } else {
        break;
      }
    }

    let running = 0;
    for (let offset = 89; offset >= 0; offset--) {
      const d = addDaysToIsoDate(anchorDate, -offset);
      if (completedMap.get(d)?.completed) {
        running += 1;
        if (running > bestStreak) bestStreak = running;
      } else {
        running = 0;
      }
    }
  } else {
    // Weekly target cadence: consecutive completions allowing natural rest days between sessions
    const maxGapDays = Math.max(2, Math.ceil(7 / Math.max(1, habit.target_per_week)) + 1);
    const completedDatesDesc: string[] = [];
    for (let offset = 0; offset < 90; offset++) {
      const d = addDaysToIsoDate(anchorDate, -offset);
      if (completedMap.get(d)?.completed) completedDatesDesc.push(d);
    }

    if (completedDatesDesc.length > 0) {
      const daysSinceLatest = Math.round(
        (Date.parse(`${anchorDate}T00:00:00Z`) -
          Date.parse(`${completedDatesDesc[0]}T00:00:00Z`)) /
          86_400_000
      );
      if (daysSinceLatest <= maxGapDays) {
        currentStreak = 1;
        for (let i = 0; i < completedDatesDesc.length - 1; i++) {
          const gap = Math.round(
            (Date.parse(`${completedDatesDesc[i]}T00:00:00Z`) -
              Date.parse(`${completedDatesDesc[i + 1]}T00:00:00Z`)) /
              86_400_000
          );
          if (gap <= maxGapDays) currentStreak += 1;
          else break;
        }
      }

      const asc = [...completedDatesDesc].reverse();
      let running = 1;
      bestStreak = 1;
      for (let i = 1; i < asc.length; i++) {
        const gap = Math.round(
          (Date.parse(`${asc[i]}T00:00:00Z`) - Date.parse(`${asc[i - 1]}T00:00:00Z`)) /
            86_400_000
        );
        if (gap <= maxGapDays) {
          running += 1;
          if (running > bestStreak) bestStreak = running;
        } else {
          running = 1;
        }
      }
    }
  }

  if (currentStreak > bestStreak) bestStreak = currentStreak;

  // 4) 30-day adherence (normalized to active history span if < 30d old)
  const allLoggedDates = Array.from(completedMap.keys()).sort();
  const createdDateStr = habit.created_at ? habit.created_at.slice(0, 10) : anchorDate;
  const earliestActive =
    allLoggedDates.length > 0 && allLoggedDates[0] < createdDateStr
      ? allLoggedDates[0]
      : createdDateStr;
  const windowStart30 = addDaysToIsoDate(anchorDate, -29);
  const effectiveStart = earliestActive > windowStart30 ? earliestActive : windowStart30;
  const activeSpanDays = Math.max(
    1,
    Math.min(
      30,
      Math.round(
        (Date.parse(`${anchorDate}T00:00:00Z`) -
          Date.parse(`${effectiveStart}T00:00:00Z`)) /
          86_400_000
      ) + 1
    )
  );

  let doneIn30 = 0;
  for (let i = 0; i < activeSpanDays; i++) {
    const d = addDaysToIsoDate(anchorDate, -i);
    if (completedMap.get(d)?.completed) doneIn30 += 1;
  }

  const expectedInSpan =
    habit.cadence === "daily"
      ? activeSpanDays
      : Math.max(1, (activeSpanDays / 7) * habit.target_per_week);
  const adherence30dPct = clampPct((doneIn30 / expectedInSpan) * 100);

  return {
    completedOnAnchorDate,
    anchorDateNote,
    history,
    currentStreak,
    bestStreak,
    thisWeekDone,
    thisWeekTarget,
    adherence30dPct,
  };
}

export async function listHabitsWithStats(
  db: TypedSupabaseClient,
  anchorDate?: string,
  historyDays = 21,
  options: { includeArchived?: boolean; timeZone?: string } = {}
): Promise<HabitWithStats[]> {
  const tz = options.timeZone ?? "Europe/Moscow";
  const effectiveAnchor = anchorDate ?? formatIsoDate(new Date(), tz);
  const safeHistoryDays = Math.max(7, Math.min(90, historyDays));
  const lookbackStart = addDaysToIsoDate(effectiveAnchor, -Math.max(89, safeHistoryDays - 1));

  let habitQuery = db
    .from("habits")
    .select("*")
    .order("is_archived", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (!options.includeArchived) {
    habitQuery = habitQuery.eq("is_archived", false);
  }

  const [{ data: habits, error: hErr }, { data: logs, error: lErr }, { data: goals, error: gErr }] =
    await Promise.all([
      habitQuery,
      db
        .from("habit_logs")
        .select("*")
        .gte("logged_date", lookbackStart)
        .lte("logged_date", effectiveAnchor),
      db.from("goals").select("id, title"),
    ]);

  if (hErr) throw hErr;
  if (lErr) throw lErr;
  if (gErr) throw gErr;

  const goalTitleMap = new Map<number, string>(
    (goals ?? []).map((g) => [g.id, g.title])
  );

  const logsByHabit = new Map<
    number,
    Map<string, { completed: boolean; note: string | null }>
  >();
  for (const row of logs ?? []) {
    const map = logsByHabit.get(row.habit_id) ?? new Map();
    map.set(row.logged_date, { completed: row.completed, note: row.note });
    logsByHabit.set(row.habit_id, map);
  }

  return (habits ?? []).map((habit) => {
    const completedMap = logsByHabit.get(habit.id) ?? new Map();
    const stats = computeHabitStreaksAndAdherence({
      habit,
      completedMap,
      anchorDate: effectiveAnchor,
      historyDays: safeHistoryDays,
    });
    return {
      ...habit,
      ...stats,
      goalTitle: habit.goal_id ? goalTitleMap.get(habit.goal_id) ?? null : null,
    };
  });
}

export async function findHabitByQueryOrId(
  db: TypedSupabaseClient,
  queryOrId: string | number,
  includeArchived = true
): Promise<{
  habit: Habit | null;
  matches: FuzzyFinanceMatch<Habit>[];
}> {
  let q = db.from("habits").select("*").order("sort_order", { ascending: true });
  if (!includeArchived) q = q.eq("is_archived", false);
  const { data: habits, error } = await q;
  if (error) throw error;
  const rows = habits ?? [];

  if (typeof queryOrId === "number" || /^\d+$/.test(String(queryOrId).trim())) {
    const id = Number(queryOrId);
    const found = rows.find((h) => h.id === id) ?? null;
    return { habit: found, matches: found ? [{ item: found, score: 1 }] : [] };
  }

  const normQ = normalizeTaskTitleForDedup(String(queryOrId));
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<Habit>[] = [];

  for (const h of rows) {
    const normTitle = normalizeTaskTitleForDedup(h.title);
    const hay = `${normTitle} ${normalizeTaskTitleForDedup(h.description ?? "")}`;
    let score = 0;
    if (normTitle === normQ) score = 1.0;
    else if (normTitle.includes(normQ) || (normQ.length >= 3 && normQ.includes(normTitle))) {
      score = 0.92;
    } else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.84;
    }

    if (score >= 0.4) {
      const activeBoost = !h.is_archived ? 0.03 : 0;
      scored.push({
        item: h,
        score: Math.min(1, Number((score + activeBoost).toFixed(3))),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return { habit: scored[0]?.item ?? null, matches: scored };
}

export async function toggleHabitCheckin(
  db: TypedSupabaseClient,
  userId: string,
  params: {
    habitIdOrQuery: number | string;
    date?: string;
    completed?: boolean;
    note?: string | null;
    source?: RecordSource;
    timeZone?: string;
  }
): Promise<{ habit: HabitWithStats; log: HabitLog; completed: boolean }> {
  const tz = params.timeZone ?? "Europe/Moscow";
  const targetDate = params.date ?? formatIsoDate(new Date(), tz);
  const { habit } = await findHabitByQueryOrId(db, params.habitIdOrQuery, true);
  if (!habit) {
    throw new Error(`Привычка «${params.habitIdOrQuery}» не найдена`);
  }

  const { data: existing, error: selErr } = await db
    .from("habit_logs")
    .select("*")
    .eq("habit_id", habit.id)
    .eq("logged_date", targetDate)
    .maybeSingle();
  if (selErr) throw selErr;

  const nextCompleted =
    params.completed !== undefined ? params.completed : !(existing?.completed ?? false);

  const { data: savedLog, error: upErr } = await db
    .from("habit_logs")
    .upsert(
      {
        user_id: userId,
        habit_id: habit.id,
        logged_date: targetDate,
        completed: nextCompleted,
        note: params.note !== undefined ? params.note : (existing?.note ?? null),
        source: params.source ?? "web",
      },
      { onConflict: "habit_id,logged_date" }
    )
    .select("*")
    .single();
  if (upErr) throw upErr;

  const todayStr = formatIsoDate(new Date(), tz);
  if (targetDate === todayStr && habit.reminder_time) {
    await syncHabitReminderToQueue(db, habit, {
      timeZone: tz,
      completedToday: nextCompleted,
    });
  }

  const allStats = await listHabitsWithStats(db, targetDate, 21, {
    includeArchived: true,
    timeZone: tz,
  });
  const habitStats = allStats.find((h) => h.id === habit.id)!;

  return {
    habit: habitStats,
    log: savedLog,
    completed: nextCompleted,
  };
}

export interface UpsertHabitParams {
  id?: number;
  query?: string;
  goal_id?: number | null;
  title?: string;
  description?: string | null;
  icon_name?: string;
  color_token?: string;
  cadence?: HabitCadence;
  target_per_week?: number;
  preferred_slot?: HabitPreferredSlot;
  reminder_time?: string | null;
  sort_order?: number;
  is_archived?: boolean;
}

export async function upsertHabit(
  db: TypedSupabaseClient,
  userId: string,
  input: UpsertHabitParams
): Promise<HabitWithStats> {
  let targetId = input.id ?? null;
  if (!targetId && input.query) {
    const resolved = await findHabitByQueryOrId(db, input.query, true);
    targetId = resolved.habit?.id ?? null;
  }

  let savedHabit: Habit;
  if (targetId) {
    const patch: HabitUpdate = {};
    if (input.goal_id !== undefined) patch.goal_id = input.goal_id;
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.icon_name !== undefined) patch.icon_name = input.icon_name;
    if (input.color_token !== undefined) patch.color_token = input.color_token;
    if (input.cadence !== undefined) patch.cadence = input.cadence;
    if (input.target_per_week !== undefined) {
      patch.target_per_week = Math.max(1, Math.min(7, Math.round(input.target_per_week)));
    }
    if (input.preferred_slot !== undefined) patch.preferred_slot = input.preferred_slot;
    if (input.reminder_time !== undefined) patch.reminder_time = input.reminder_time;
    if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
    if (input.is_archived !== undefined) patch.is_archived = input.is_archived;

    const { data, error } = await db
      .from("habits")
      .update(patch)
      .eq("id", targetId)
      .select("*")
      .single();
    if (error) throw error;
    savedHabit = data;
  } else {
    if (!input.title || !input.title.trim()) {
      throw new Error("Укажите название привычки");
    }
    const cadence: HabitCadence = input.cadence ?? "daily";
    const targetPerWeek =
      input.target_per_week !== undefined
        ? Math.max(1, Math.min(7, Math.round(input.target_per_week)))
        : cadence === "daily"
          ? 7
          : 3;

    const insertPayload: HabitInsert = {
      user_id: userId,
      goal_id: input.goal_id ?? null,
      title: input.title.trim(),
      description: input.description ?? null,
      icon_name: input.icon_name || "check-circle-2",
      color_token: input.color_token || "domain-health",
      cadence,
      target_per_week: targetPerWeek,
      preferred_slot: input.preferred_slot ?? "any",
      reminder_time: input.reminder_time ?? null,
      sort_order: input.sort_order ?? 10,
      is_archived: Boolean(input.is_archived),
    };

    const { data, error } = await db
      .from("habits")
      .insert(insertPayload)
      .select("*")
      .single();
    if (error) throw error;
    savedHabit = data;
  }

  await syncHabitReminderToQueue(db, savedHabit);

  const allStats = await listHabitsWithStats(db, undefined, 21, { includeArchived: true });
  return allStats.find((h) => h.id === savedHabit.id)!;
}

export async function archiveHabit(
  db: TypedSupabaseClient,
  habitIdOrQuery: number | string,
  archived = true
): Promise<Habit> {
  const { habit } = await findHabitByQueryOrId(db, habitIdOrQuery, true);
  if (!habit) throw new Error(`Привычка «${habitIdOrQuery}» не найдена`);

  const { data, error } = await db
    .from("habits")
    .update({ is_archived: archived })
    .eq("id", habit.id)
    .select("*")
    .single();
  if (error) throw error;

  await syncHabitReminderToQueue(db, data);
  return data;
}

export async function deleteHabit(
  db: TypedSupabaseClient,
  habitIdOrQuery: number | string
): Promise<{ deletedHabit: Habit }> {
  const { habit } = await findHabitByQueryOrId(db, habitIdOrQuery, true);
  if (!habit) throw new Error(`Привычка «${habitIdOrQuery}» не найдена`);

  await cancelEntityRemindersInQueue(db, String(habit.id), ["habit_reminder"]);
  const { error } = await db.from("habits").delete().eq("id", habit.id);
  if (error) throw error;

  return { deletedHabit: habit };
}

// ============================================================================
// Compact Summary Builders for Home Bento `/` & Notifier Digests
// ============================================================================

export async function getTodayHabitsAndGoalsSummary(
  db: TypedSupabaseClient,
  todayDate?: string,
  timeZone = "Europe/Moscow"
): Promise<{ habitsSummary: TodayHabitsSummary; goalsSummary: TodayGoalsSummary }> {
  const effectiveDate = todayDate ?? formatIsoDate(new Date(), timeZone);
  const [habits, goals] = await Promise.all([
    listHabitsWithStats(db, effectiveDate, 14, { includeArchived: false, timeZone }),
    listGoalsWithDetails(db, { status: "all" }),
  ]);

  const doneCount = habits.filter((h) => h.completedOnAnchorDate).length;
  const totalCount = habits.length;
  const completionPct = totalCount > 0 ? clampPct((doneCount / totalCount) * 100) : 0;
  const topStreak = habits.reduce((mx, h) => Math.max(mx, h.currentStreak), 0);

  const activeGoals = goals.filter((g) => g.status === "active");
  const achievedGoals = goals.filter((g) => g.status === "achieved");
  const avgProgressPct =
    activeGoals.length > 0
      ? Math.round(
          activeGoals.reduce((sum, g) => sum + g.progress.progressPct, 0) /
            activeGoals.length
        )
      : 0;
  const stalledCount = activeGoals.filter((g) => g.progress.isStalled).length;

  return {
    habitsSummary: {
      date: effectiveDate,
      doneCount,
      totalCount,
      completionPct,
      topStreak,
      items: habits,
    },
    goalsSummary: {
      activeCount: activeGoals.length,
      achievedCount: achievedGoals.length,
      avgProgressPct,
      stalledCount,
      items: activeGoals,
    },
  };
}

// ============================================================================
// Cross-Life Analytics & Proactive Insights Engine
// ============================================================================

export async function getLifeAnalyticsSummary(
  db: TypedSupabaseClient,
  anchorDate?: string,
  windowDays = 14,
  timeZone = "Europe/Moscow"
): Promise<LifeAnalyticsSummary> {
  const effectiveAnchor = anchorDate ?? formatIsoDate(new Date(), timeZone);
  const days = Math.max(7, Math.min(90, windowDays));
  const startDate = addDaysToIsoDate(effectiveAnchor, -(days - 1));
  const startIsoUtc = localClockToUtcIso(startDate, "00:00", timeZone);
  const endNextIsoUtc = localClockToUtcIso(
    addDaysToIsoDate(effectiveAnchor, 1),
    "00:00",
    timeZone
  );
  const { weekStart, weekEnd } = getWeekBoundsIso(effectiveAnchor);

  const [
    allGoals,
    habitsMatrix21d,
    dayPlans,
    allNonCancelledTasksRes,
    checkinsRes,
    reviewsRes,
    workoutPrograms,
    weekWorkouts,
    nutritionStats14d,
  ] = await Promise.all([
    listGoalsWithDetails(db, { status: "all" }),
    listHabitsWithStats(db, effectiveAnchor, Math.max(21, days), {
      includeArchived: false,
      timeZone,
    }),
    getDayPlansInRange(db, startDate, effectiveAnchor),
    db.from("tasks").select("*").neq("status", "cancelled"),
    db
      .from("state_checkins")
      .select("*")
      .gte("logged_at", startIsoUtc)
      .lt("logged_at", endNextIsoUtc)
      .order("logged_at", { ascending: true }),
    db
      .from("daily_reviews")
      .select("*")
      .gte("review_date", addDaysToIsoDate(effectiveAnchor, -30))
      .lte("review_date", effectiveAnchor)
      .order("review_date", { ascending: true }),
    listWorkoutPrograms(db, false),
    listWorkoutSessions(db, { startDate: weekStart, endDate: weekEnd }),
    getNutritionAndWeightAnalytics(db, {
      days: 14,
      endDate: effectiveAnchor,
      timeZone,
    }),
  ]);

  if (allNonCancelledTasksRes.error) throw allNonCancelledTasksRes.error;
  if (checkinsRes.error) throw checkinsRes.error;
  if (reviewsRes.error) throw reviewsRes.error;

  const allTasks = allNonCancelledTasksRes.data ?? [];
  const checkins = checkinsRes.data ?? [];
  const allReviews = reviewsRes.data ?? [];
  const windowReviews = allReviews.filter((r) => r.review_date >= startDate);

  // 1) Tasks analytics
  const completedInWindow = allTasks.filter((t) => {
    if (t.status !== "done") return false;
    const compDate = t.completed_at
      ? formatIsoDate(new Date(t.completed_at), timeZone)
      : t.planned_date;
    return compDate ? compDate >= startDate && compDate <= effectiveAnchor : false;
  });

  const openTasks = allTasks.filter((t) => t.status !== "done");
  const openOverdueTasks = openTasks.filter((t) => {
    const dueOrPlan = t.due_date ?? t.planned_date;
    return Boolean(dueOrPlan && dueOrPlan < effectiveAnchor);
  });

  const plannedInWindow = allTasks.filter(
    (t) => t.planned_date && t.planned_date >= startDate && t.planned_date <= effectiveAnchor
  );
  const plannedDoneInWindow = plannedInWindow.filter((t) => t.status === "done");
  const focusCompletionRatePct =
    plannedInWindow.length > 0
      ? clampPct((plannedDoneInWindow.length / plannedInWindow.length) * 100)
      : completedInWindow.length > 0
        ? 100
        : 0;

  const avgPlannedMinutes =
    plannedInWindow.length > 0
      ? Math.round(
          plannedInWindow.reduce((s, t) => s + Number(t.estimated_minutes ?? 30), 0) /
            Math.max(1, days)
        )
      : 0;
  const avgBufferMinutes =
    dayPlans.length > 0
      ? Math.round(
          dayPlans.reduce((s, dp) => s + Number(dp.buffer_minutes ?? 90), 0) / dayPlans.length
        )
      : 90;

  const dailyCompletedSeries: Array<{ date: string; completed: number; planned: number }> = [];
  for (let i = 0; i < days; i++) {
    const d = addDaysToIsoDate(startDate, i);
    const compCnt = completedInWindow.filter((t) => {
      const compDate = t.completed_at
        ? formatIsoDate(new Date(t.completed_at), timeZone)
        : t.planned_date;
      return compDate === d;
    }).length;
    const planCnt = plannedInWindow.filter((t) => t.planned_date === d).length;
    dailyCompletedSeries.push({ date: d, completed: compCnt, planned: planCnt });
  }

  // 2) Habits analytics
  const todayTotalHabits = habitsMatrix21d.length;
  const todayDoneHabits = habitsMatrix21d.filter((h) => h.completedOnAnchorDate).length;

  const habitDailySeries: Array<{ date: string; done: number; total: number; pct: number }> = [];
  let totalDoneCells = 0;
  let totalExpectedCells = 0;

  for (let i = 0; i < days; i++) {
    const d = addDaysToIsoDate(startDate, i);
    let doneOnDay = 0;
    for (const h of habitsMatrix21d) {
      const cell = h.history.find((c) => c.date === d);
      if (cell?.completed) doneOnDay += 1;
    }
    totalDoneCells += doneOnDay;
    totalExpectedCells += todayTotalHabits;
    habitDailySeries.push({
      date: d,
      done: doneOnDay,
      total: todayTotalHabits,
      pct: todayTotalHabits > 0 ? clampPct((doneOnDay / todayTotalHabits) * 100) : 0,
    });
  }

  const adherenceWindowPct =
    totalExpectedCells > 0 ? clampPct((totalDoneCells / totalExpectedCells) * 100) : 0;

  const sortedByStreak = [...habitsMatrix21d].sort(
    (a, b) => b.currentStreak - a.currentStreak || b.bestStreak - a.bestStreak
  );
  const topStreakHabit =
    sortedByStreak[0] && sortedByStreak[0].currentStreak > 0
      ? {
          id: sortedByStreak[0].id,
          title: sortedByStreak[0].title,
          currentStreak: sortedByStreak[0].currentStreak,
          bestStreak: sortedByStreak[0].bestStreak,
        }
      : null;

  // Trim matrix history back to 21 cells for crisp 21-day UI heatmaps
  const trimmedMatrix21d: HabitWithStats[] = habitsMatrix21d.map((h) => ({
    ...h,
    history: h.history.slice(-21),
  }));

  // 3) Goals analytics
  const activeGoals = allGoals.filter((g) => g.status === "active");
  const achievedGoals = allGoals.filter((g) => g.status === "achieved");
  const pausedGoals = allGoals.filter((g) => g.status === "paused");
  const avgGoalProgressPct =
    activeGoals.length > 0
      ? Math.round(
          activeGoals.reduce((s, g) => s + g.progress.progressPct, 0) / activeGoals.length
        )
      : 0;
  const stalledGoals = activeGoals.filter((g) => g.progress.isStalled);

  // 4) Wellbeing (State Check-ins & Daily Reviews)
  const checkinsByDate = new Map<
    string,
    { energies: number[]; moods: number[]; tensions: number[] }
  >();
  for (const c of checkins) {
    const d = formatIsoDate(new Date(c.logged_at), timeZone);
    const entry = checkinsByDate.get(d) ?? { energies: [], moods: [], tensions: [] };
    entry.energies.push(Number(c.energy_score));
    entry.moods.push(Number(c.mood_score));
    if (c.tension_score !== null && c.tension_score !== undefined) {
      entry.tensions.push(Number(c.tension_score));
    }
    checkinsByDate.set(d, entry);
  }

  const reviewByDate = new Map<string, (typeof allReviews)[number]>();
  for (const r of allReviews) {
    reviewByDate.set(r.review_date, r);
  }

  let reviewStreak = 0;
  const reviewStartOffset = reviewByDate.has(effectiveAnchor) ? 0 : 1;
  for (let offset = reviewStartOffset; offset < 30; offset++) {
    const d = addDaysToIsoDate(effectiveAnchor, -offset);
    if (reviewByDate.has(d)) reviewStreak += 1;
    else break;
  }

  const avgNum = (arr: number[]): number | null =>
    arr.length > 0 ? round1(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  const avgEnergy = avgNum(checkins.map((c) => Number(c.energy_score)));
  const avgMood = avgNum(checkins.map((c) => Number(c.mood_score)));
  const avgTension = avgNum(
    checkins
      .filter((c) => c.tension_score !== null && c.tension_score !== undefined)
      .map((c) => Number(c.tension_score))
  );

  const avgTasksScore = avgNum(
    windowReviews
      .filter((r) => r.tasks_score !== null)
      .map((r) => Number(r.tasks_score))
  );
  const avgHabitsScore = avgNum(
    windowReviews
      .filter((r) => r.habits_score !== null)
      .map((r) => Number(r.habits_score))
  );
  const avgHealthScore = avgNum(
    windowReviews
      .filter((r) => r.health_score !== null)
      .map((r) => Number(r.health_score))
  );
  const avgNutritionScore = avgNum(
    windowReviews
      .filter((r) => r.nutrition_score !== null)
      .map((r) => Number(r.nutrition_score))
  );

  const wellbeingSeries: LifeAnalyticsSummary["wellbeing"]["dailySeries"] = [];
  for (let i = 0; i < days; i++) {
    const d = addDaysToIsoDate(startDate, i);
    const cEntry = checkinsByDate.get(d);
    const rev = reviewByDate.get(d);
    const revScores = rev
      ? [rev.tasks_score, rev.habits_score, rev.health_score, rev.nutrition_score].filter(
          (v): v is number => v !== null && v !== undefined
        )
      : [];
    wellbeingSeries.push({
      date: d,
      energy: cEntry ? avgNum(cEntry.energies) : null,
      mood: cEntry ? avgNum(cEntry.moods) : null,
      tension: cEntry ? avgNum(cEntry.tensions) : null,
      reviewAvgScore: avgNum(revScores),
    });
  }

  // 5) Health & Nutrition summary
  const activeProgram = workoutPrograms[0] ?? null;
  const workoutsTargetThisWeek = activeProgram
    ? Number(activeProgram.sessions_per_week || 3)
    : 3;
  const workoutsCompletedThisWeek = weekWorkouts.filter(
    (w) => w.status === "completed"
  ).length;
  const openWorkoutWindowsCount = weekWorkouts.filter(
    (w) => w.status === "planned" && w.window_end_date >= effectiveAnchor
  ).length;

  // 6) Proactive Insights Engine (calm, grounded in real user data)
  const proactiveInsights: ProactiveInsight[] = [];

  if (stalledGoals.length > 0) {
    const firstStalled = stalledGoals[0];
    proactiveInsights.push({
      id: `stalled-goal-${firstStalled.id}`,
      severity: "attention",
      domain: "goals",
      title: `Цель без следующего шага: «${firstStalled.title}»`,
      description:
        firstStalled.progress.stalledReason === "Нет активных следующих шагов или вех"
          ? "Добавьте хотя бы 1 конкретную задачу или веху на эту неделю, чтобы цель двигалась спокойно без рывков."
          : "По цели давно не было движения — стоит наметить один небольшой шаг на ближайший слот.",
      actionLabel: "Открыть цели",
      actionHref: "/goals",
    });
  }

  if (topStreakHabit && topStreakHabit.currentStreak >= 4) {
    proactiveInsights.push({
      id: `habit-streak-${topStreakHabit.id}`,
      severity: "positive",
      domain: "habits",
      title: `Отличная серия: «${topStreakHabit.title}» — ${topStreakHabit.currentStreak} дн. подряд`,
      description:
        "Устойчивый ритм работает лучше редких сверх-усилий. Продолжайте в том же спокойном темпе.",
      actionLabel: "К привычкам",
      actionHref: "/goals?tab=habits",
    });
  }

  const eveningHabits = trimmedMatrix21d.filter((h) => h.preferred_slot === "evening");
  const laggingEvening = eveningHabits.find((h) => h.adherence30dPct < 65);
  if (laggingEvening) {
    proactiveInsights.push({
      id: `evening-habit-${laggingEvening.id}`,
      severity: "info",
      domain: "habits",
      title: `Вечерняя привычка «${laggingEvening.title}» выполняется в ${laggingEvening.adherence30dPct}% дней`,
      description:
        "К вечеру ресурс внимания снижается — привяжите её к фиксированному якорю или чуть сдвиньте время напоминания.",
      actionLabel: "Настроить привычки",
      actionHref: "/goals?tab=habits",
    });
  }

  if (openOverdueTasks.length >= 3) {
    proactiveInsights.push({
      id: "overdue-tasks-buffer",
      severity: "attention",
      domain: "tasks",
      title: `Накопилось ${openOverdueTasks.length} задач с прошедшей датой`,
      description:
        "Чтобы не перегружать сегодняшний план, перенесите второстепенные задачи на свободные слоты недели с сохранением буфера.",
      actionLabel: "Разгрузить план",
      actionHref: "/tasks",
    });
  }

  if (avgEnergy !== null && avgEnergy <= 5.5) {
    proactiveInsights.push({
      id: "low-energy-trend",
      severity: "attention",
      domain: "energy",
      title: `Средняя энергия за период — ${avgEnergy}/10`,
      description:
        "Имеет смысл временно переключить план дня в щадящий режим (recovery) и увеличить буфер времени.",
      actionLabel: "План дня",
      actionHref: "/",
    });
  } else if (avgTension !== null && avgTension >= 7) {
    proactiveInsights.push({
      id: "high-tension-trend",
      severity: "attention",
      domain: "energy",
      title: `Повышенное напряжение (${avgTension}/10 по чекинам)`,
      description:
        "Проверьте количество параллельных фокус-задач и оставьте минимум 90 минут чистого буфера.",
      actionLabel: "Проверить нагрузку",
      actionHref: "/",
    });
  }

  if (
    workoutsCompletedThisWeek < workoutsTargetThisWeek &&
    openWorkoutWindowsCount > 0
  ) {
    proactiveInsights.push({
      id: "workout-window-open",
      severity: "info",
      domain: "health",
      title: `Тренировки на неделе: ${workoutsCompletedThisWeek} из ${workoutsTargetThisWeek} (открыто окно)`,
      description:
        "Плавающее окно позволяет провести тренировку без жёсткой привязки ко времени — выберите удобный вечерний слот.",
      actionLabel: "Здоровье и спорт",
      actionHref: "/health",
    });
  }

  return {
    anchorDate: effectiveAnchor,
    windowDays: days,
    startDate,
    endDate: effectiveAnchor,
    tasks: {
      completedCount: completedInWindow.length,
      openCount: openTasks.length,
      openOverdueCount: openOverdueTasks.length,
      focusCompletionRatePct,
      avgPlannedMinutes,
      avgBufferMinutes,
      dailyCompletedSeries,
    },
    habits: {
      todayDone: todayDoneHabits,
      todayTotal: todayTotalHabits,
      adherenceWindowPct,
      topStreakHabit,
      dailySeries: habitDailySeries,
      matrix21d: trimmedMatrix21d,
    },
    goals: {
      activeCount: activeGoals.length,
      achievedCount: achievedGoals.length,
      pausedCount: pausedGoals.length,
      avgProgressPct: avgGoalProgressPct,
      stalledGoals,
      activeGoals,
    },
    wellbeing: {
      avgEnergy,
      avgMood,
      avgTension,
      avgTasksScore,
      avgHabitsScore,
      avgHealthScore,
      avgNutritionScore,
      reviewStreak,
      dailySeries: wellbeingSeries,
    },
    healthAndNutrition: {
      workoutsCompletedThisWeek,
      workoutsTargetThisWeek,
      openWorkoutWindowsCount,
      latestWeightKg: nutritionStats14d.weight_summary.latest_weight_kg,
      weightDelta14dKg: nutritionStats14d.weight_summary.weight_delta_kg,
      avgDailyKcal: nutritionStats14d.averages.avg_kcal,
      kcalTarget: nutritionStats14d.targets.kcal_target,
    },
    proactiveInsights,
  };
}

// ============================================================================
// Composite Goals, Habits & Analytics Dashboard Loader (`/goals`)
// ============================================================================

export interface GoalsDashboardData {
  profile: UserProfile | null;
  todayDate: string;
  anchorDate: string;
  goals: GoalWithDetails[];
  habits: HabitWithStats[];
  analytics: LifeAnalyticsSummary;
}

export async function getGoalsDashboardData(
  db: TypedSupabaseClient,
  options: {
    anchorDate?: string;
    analyticsDays?: number;
    includeArchivedHabits?: boolean;
    timeZone?: string;
  } = {}
): Promise<GoalsDashboardData> {
  const tz = options.timeZone ?? "Europe/Moscow";
  const todayDate = formatIsoDate(new Date(), tz);
  const anchorDate = options.anchorDate ?? todayDate;
  const analyticsDays = options.analyticsDays ?? 14;

  const [profile, goals, habits, analytics] = await Promise.all([
    getOwnerProfile(db),
    listGoalsWithDetails(db, { status: "all" }),
    listHabitsWithStats(db, anchorDate, 21, {
      includeArchived: Boolean(options.includeArchivedHabits),
      timeZone: tz,
    }),
    getLifeAnalyticsSummary(db, anchorDate, analyticsDays, tz),
  ]);

  return {
    profile,
    todayDate,
    anchorDate,
    goals,
    habits,
    analytics,
  };
}
