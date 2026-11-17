import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert, TablesUpdate } from "./database.types";

export type { Database, Tables, TablesInsert, TablesUpdate };
export type TypedSupabaseClient = SupabaseClient<Database>;

export type UserProfile = Tables<"user_profiles">;
export type UserProfileUpdate = TablesUpdate<"user_profiles">;
export type BalanceViewMode = "total" | "accounts" | "safe_to_spend";

export type DashboardWidget = Tables<"dashboard_widgets">;
export type DashboardWidgetInsert = TablesInsert<"dashboard_widgets">;
export type DashboardWidgetUpdate = TablesUpdate<"dashboard_widgets">;
export type WidgetKey =
  | "now_focus"
  | "day_timeline"
  | "day_slots_buffer"
  | "safe_to_spend"
  | "waiting_radar"
  | "state_pulse"
  | "habits_strip"
  | "workout_window"
  | "today_meals"
  | "goals_progress"
  | "pending_confirmations";

export interface DashboardWidgetLayoutItem {
  widget_key: WidgetKey;
  is_visible: boolean;
  desktop_order: number;
  mobile_order: number;
  desktop_col_span: number;
}

export type Goal = Tables<"goals">;
export type GoalInsert = TablesInsert<"goals">;
export type GoalUpdate = TablesUpdate<"goals">;

export type Project = Tables<"projects">;
export type ProjectInsert = TablesInsert<"projects">;
export type ProjectUpdate = TablesUpdate<"projects">;

export interface FuzzyProjectMatch {
  project: Project;
  score: number;
}

export interface SubtaskItem {
  id: string;
  title: string;
  done: boolean;
}

export type Task = Tables<"tasks">;
export type TaskInsert = TablesInsert<"tasks">;
export type TaskUpdate = TablesUpdate<"tasks">;
export type TaskStatus = "inbox" | "todo" | "in_progress" | "waiting" | "done" | "cancelled";
export type DaySlot = "morning" | "afternoon" | "evening" | "any";
export type LifeArea = "work" | "study" | "launch" | "personal" | "health";
export type RecordSource = "web" | "telegram" | "mcp" | "openclaw";

export interface TimeConflict {
  task: Task;
  startIso: string;
  endIso: string;
  timeRangeLabel: string;
  plannedDate: string | null;
}

export interface FuzzyTaskMatch {
  task: Task;
  score: number;
}

export type ReminderQueueItem = Tables<"reminders_queue">;
export type ReminderQueueInsert = TablesInsert<"reminders_queue">;
export type ReminderQueueUpdate = TablesUpdate<"reminders_queue">;
export type ReminderEntityType =
  | "task_start"
  | "waiting_followup"
  | "standalone_reminder"
  | "morning_digest"
  | "evening_review"
  | "finance_obligation"
  | "credit_grace"
  | "debt_due";
export type ReminderStatus = "pending" | "sent" | "cancelled" | "failed";

export type DayPlan = Tables<"day_plans">;
export type DayPlanInsert = TablesInsert<"day_plans">;
export type DayPlanUpdate = TablesUpdate<"day_plans">;

export type StateCheckin = Tables<"state_checkins">;
export type StateCheckinInsert = TablesInsert<"state_checkins">;
export type StateCheckinUpdate = TablesUpdate<"state_checkins">;

export type EveningReviewCriterion = Tables<"evening_review_criteria">;
export type EveningReviewCriterionInsert = TablesInsert<"evening_review_criteria">;
export type EveningReviewCriterionUpdate = TablesUpdate<"evening_review_criteria">;

export type DailyReview = Tables<"daily_reviews">;
export type DailyReviewInsert = TablesInsert<"daily_reviews">;
export type DailyReviewUpdate = TablesUpdate<"daily_reviews">;

export type AssistantSettings = Tables<"assistant_settings">;
export type AssistantSettingsUpdate = TablesUpdate<"assistant_settings">;

export type AssistantAgreement = Tables<"assistant_agreements">;
export type AssistantAgreementInsert = TablesInsert<"assistant_agreements">;
export type AssistantAgreementUpdate = TablesUpdate<"assistant_agreements">;

export type AssistantThread = Tables<"assistant_threads">;
export type AssistantMessage = Tables<"assistant_messages">;
export type AssistantMessageInsert = TablesInsert<"assistant_messages">;

export type PendingAction = Tables<"pending_actions">;
export type PendingActionInsert = TablesInsert<"pending_actions">;
export type PendingActionUpdate = TablesUpdate<"pending_actions">;
export type PendingActionKind =
  | "create_expenses"
  | "create_income"
  | "update_day_plan"
  | "create_tasks"
  | "reschedule_tasks"
  | "save_agreement"
  | "log_workout"
  | "update_shopping_list";

// ============================================================================
// Stage 2 — Finance Types
// ============================================================================

export type FinanceAccount = Tables<"finance_accounts">;
export type FinanceAccountInsert = TablesInsert<"finance_accounts">;
export type FinanceAccountUpdate = TablesUpdate<"finance_accounts">;
export type FinanceAccountType = "debit" | "cash" | "savings" | "credit_card" | "investment";

export type FinanceCategory = Tables<"finance_categories">;
export type FinanceCategoryInsert = TablesInsert<"finance_categories">;
export type FinanceCategoryUpdate = TablesUpdate<"finance_categories">;
export type FinanceCategoryKind = "expense" | "income";

export type FinanceTransaction = Tables<"finance_transactions">;
export type FinanceTransactionInsert = TablesInsert<"finance_transactions">;
export type FinanceTransactionUpdate = TablesUpdate<"finance_transactions">;
export type FinanceTransactionKind = "expense" | "income" | "transfer" | "reimbursement_in";
export type SpendNature = "personal" | "work_reimbursable" | "shared_reimbursable";
export type ReimbursementStatus = "not_applicable" | "pending" | "partial" | "settled";
export type FinanceTransactionSource =
  | "web"
  | "telegram_voice"
  | "telegram_text"
  | "telegram_photo"
  | "mcp"
  | "openclaw";

export type FinanceObligation = Tables<"finance_obligations">;
export type FinanceObligationInsert = TablesInsert<"finance_obligations">;
export type FinanceObligationUpdate = TablesUpdate<"finance_obligations">;
export type FinanceObligationKind = "mandatory_bill" | "subscription" | "loan_installment";
export type BillingPeriod = "weekly" | "monthly" | "quarterly" | "yearly";

export type FinanceDebt = Tables<"finance_debts">;
export type FinanceDebtInsert = TablesInsert<"finance_debts">;
export type FinanceDebtUpdate = TablesUpdate<"finance_debts">;
export type DebtDirection = "i_owe" | "owed_to_me";
export type DebtStatus = "open" | "closed";

export type FinanceBalanceSummary = Database["public"]["Views"]["v_finance_balance_summary"]["Row"];

export interface FuzzyFinanceMatch<T> {
  item: T;
  score: number;
}

export interface FinanceCategoryAnalyticsItem {
  category_id: number | null;
  category_name: string;
  icon_name: string;
  color_token: string;
  personal_spent: number;
  gross_spent: number;
  reimbursable_spent: number;
  monthly_limit: number | null;
  limit_usage_percent: number | null;
  transactions_count: number;
}

export interface FinanceMonthlyAnalytics {
  month: string; // YYYY-MM
  startDate: string;
  endDate: string;
  personal_expense_total: number;
  work_reimbursable_outlay_total: number;
  shared_reimbursable_outlay_total: number;
  gross_outflow_total: number;
  income_total: number;
  reimbursements_received_total: number;
  net_personal_cashflow: number;
  by_category: FinanceCategoryAnalyticsItem[];
}

export type WorkoutProgram = Tables<"workout_programs">;
export type WorkoutSession = Tables<"workout_sessions">;
export type MedicalDoctor = Tables<"medical_doctors">;
export type MedicalRecord = Tables<"medical_records">;

export type Recipe = Tables<"recipes">;
export type RecipeIngredient = Tables<"recipe_ingredients">;
export type MealPlanEntry = Tables<"meal_plan_entries">;
export type PantryItem = Tables<"pantry_items">;
export type ShoppingListItem = Tables<"shopping_list_items">;

export type Habit = Tables<"habits">;
export type HabitLog = Tables<"habit_logs">;
