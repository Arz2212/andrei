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
  TypedSupabaseClient,
  UserProfile,
  UserProfileUpdate,
  WidgetKey,
} from "./types";

export function formatIsoDate(date: Date = new Date(), timeZone = "Europe/Moscow"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
// Projects, Tasks & Day Plans
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

export async function createTask(db: TypedSupabaseClient, input: TaskInsert): Promise<Task> {
  const { data, error } = await db.from("tasks").insert(input).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateTask(
  db: TypedSupabaseClient,
  id: number,
  patch: TaskUpdate
): Promise<Task> {
  const { data, error } = await db
    .from("tasks")
    .update(patch)
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
  return updateTask(db, id, {
    status: done ? "done" : "todo",
    completed_at: done ? new Date().toISOString() : null,
  });
}

export async function deleteTask(db: TypedSupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("tasks").delete().eq("id", id);
  if (error) throw error;
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
 * and marks the pending_action row as `confirmed`.
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

  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const userId = action.user_id;
  let summary = "Изменения сохранены.";

  if (action.action_kind === "create_tasks") {
    const items = Array.isArray(payload.tasks) ? payload.tasks : [];
    let created = 0;
    for (const raw of items as Record<string, unknown>[]) {
      await createTask(db, {
        user_id: userId,
        title: String(raw.title ?? "Новая задача"),
        notes: raw.notes ? String(raw.notes) : null,
        status: (raw.status as TaskStatus) ?? "todo",
        priority: Number(raw.priority ?? 2),
        planned_date: raw.planned_date ? String(raw.planned_date) : null,
        day_slot: (raw.day_slot as DaySlot) ?? "any",
        estimated_minutes: raw.estimated_minutes ? Number(raw.estimated_minutes) : null,
        due_date: raw.due_date ? String(raw.due_date) : null,
        waiting_on_person: raw.waiting_on_person ? String(raw.waiting_on_person) : null,
        waiting_context: raw.waiting_context ? String(raw.waiting_context) : null,
        waiting_since:
          raw.status === "waiting" ? formatIsoDate() : null,
        follow_up_at: raw.follow_up_at ? String(raw.follow_up_at) : null,
        source: "telegram",
      });
      created += 1;
    }
    summary = `Добавлено задач: ${created}.`;
  } else if (action.action_kind === "reschedule_tasks") {
    const updates = Array.isArray(payload.updates) ? payload.updates : [];
    let count = 0;
    for (const u of updates as Record<string, unknown>[]) {
      if (!u.task_id) continue;
      const patch: TaskUpdate = {};
      if (u.planned_date !== undefined) patch.planned_date = u.planned_date ? String(u.planned_date) : null;
      if (u.day_slot !== undefined) patch.day_slot = String(u.day_slot) as DaySlot;
      if (u.status !== undefined) patch.status = String(u.status) as TaskStatus;
      if (u.priority !== undefined) patch.priority = Number(u.priority);
      if (u.waiting_on_person !== undefined) {
        patch.waiting_on_person = u.waiting_on_person ? String(u.waiting_on_person) : null;
      }
      if (u.follow_up_at !== undefined) {
        patch.follow_up_at = u.follow_up_at ? String(u.follow_up_at) : null;
      }
      await updateTask(db, Number(u.task_id), patch);
      count += 1;
    }
    summary = `Обновлено задач в плане: ${count}.`;
  } else if (action.action_kind === "update_day_plan") {
    const planDate = String(payload.plan_date ?? formatIsoDate());
    await upsertDayPlan(db, userId, planDate, {
      main_focus: payload.main_focus !== undefined ? (payload.main_focus ? String(payload.main_focus) : null) : undefined,
      buffer_minutes: payload.buffer_minutes !== undefined ? Number(payload.buffer_minutes) : undefined,
      available_minutes: payload.available_minutes !== undefined ? Number(payload.available_minutes) : undefined,
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
  const [settings, agreements, overview] = await Promise.all([
    getAssistantSettings(db),
    listAssistantAgreements(db, true),
    getTodayOverview(db, todayDate),
  ]);

  return {
    settings,
    agreements,
    overview,
  };
}

export type JsonPayload = Json;
