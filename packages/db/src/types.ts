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
  | "debt_due"
  | "medical_followup"
  | "medical_visit"
  | "workout_window"
  | "pantry_expiry";
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
  month: string;
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

// ============================================================================
// Stage 3 — Nutrition & Health Types
// ============================================================================

export type IngredientUnit = "g" | "kg" | "ml" | "l" | "pcs" | "tbsp" | "tsp" | "pack";
export type MealCategory = "breakfast" | "lunch" | "dinner" | "snack" | "batch_prep";
export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack" | "cook_ahead";
export type MealPlanStatus = "planned" | "cooked" | "eaten" | "skipped";
export type ShoppingAddedFrom = "meal_plan" | "manual" | "telegram" | "mcp" | "openclaw";

export type Recipe = Tables<"recipes">;
export type RecipeInsert = TablesInsert<"recipes">;
export type RecipeUpdate = TablesUpdate<"recipes">;

export type RecipeIngredient = Tables<"recipe_ingredients">;
export type RecipeIngredientInsert = TablesInsert<"recipe_ingredients">;
export type RecipeIngredientUpdate = TablesUpdate<"recipe_ingredients">;

export interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredient[];
}

export type MealPlanEntry = Tables<"meal_plan_entries">;
export type MealPlanEntryInsert = TablesInsert<"meal_plan_entries">;
export type MealPlanEntryUpdate = TablesUpdate<"meal_plan_entries">;

export interface MealPlanEntryWithRecipe extends MealPlanEntry {
  recipe: RecipeWithIngredients | null;
}

export type PantryItem = Tables<"pantry_items">;
export type PantryItemInsert = TablesInsert<"pantry_items">;
export type PantryItemUpdate = TablesUpdate<"pantry_items">;

export type ShoppingListItem = Tables<"shopping_list_items">;
export type ShoppingListItemInsert = TablesInsert<"shopping_list_items">;
export type ShoppingListItemUpdate = TablesUpdate<"shopping_list_items">;

export type MealPlanMissingIngredient =
  Database["public"]["Views"]["v_meal_plan_missing_ingredients"]["Row"];

export type OffProductEvaluation = Tables<"off_product_evaluations">;
export type OffProductEvaluationInsert = TablesInsert<"off_product_evaluations">;

export type CalorieLog = Tables<"calorie_logs">;
export type CalorieLogInsert = TablesInsert<"calorie_logs">;
export type CalorieLogUpdate = TablesUpdate<"calorie_logs">;

export interface OffParsedProduct {
  barcode: string;
  found: boolean;
  product_name: string | null;
  brands: string | null;
  quantity: string | null;
  has_complete_macros: boolean;
  kcal_100g: number | null;
  protein_100g: number | null;
  fat_100g: number | null;
  carbs_100g: number | null;
  raw: Record<string, unknown> | null;
}

export interface OffCompletenessStats {
  total_tested: number;
  found_count: number;
  complete_macros_count: number;
  found_rate_percent: number;
  complete_macros_rate_percent: number;
  recommendation: "recommended" | "partial" | "insufficient_data";
}

export type WorkoutPreferredSlot = "morning" | "afternoon" | "evening" | "flexible";
export type WorkoutSessionStatus = "planned" | "completed" | "skipped";

export interface WorkoutProgramDayTemplate {
  day_code: string;
  title: string;
  exercises: string[];
}

export type WorkoutProgram = Tables<"workout_programs">;
export type WorkoutProgramInsert = TablesInsert<"workout_programs">;
export type WorkoutProgramUpdate = TablesUpdate<"workout_programs">;

export type WorkoutSession = Tables<"workout_sessions">;
export type WorkoutSessionInsert = TablesInsert<"workout_sessions">;
export type WorkoutSessionUpdate = TablesUpdate<"workout_sessions">;

export type MedicalRecordKind = "visit" | "lab_panel" | "imaging" | "checkup" | "other";

export type MedicalDoctor = Tables<"medical_doctors">;
export type MedicalDoctorInsert = TablesInsert<"medical_doctors">;
export type MedicalDoctorUpdate = TablesUpdate<"medical_doctors">;

export type MedicalRecord = Tables<"medical_records">;
export type MedicalRecordInsert = TablesInsert<"medical_records">;
export type MedicalRecordUpdate = TablesUpdate<"medical_records">;

export type MedicalFollowUp = Tables<"medical_follow_ups">;
export type MedicalFollowUpInsert = TablesInsert<"medical_follow_ups">;
export type MedicalFollowUpUpdate = TablesUpdate<"medical_follow_ups">;

export type MedicalDocument = Tables<"medical_documents">;
export type MedicalDocumentInsert = TablesInsert<"medical_documents">;

export interface MedicalRecordFull extends MedicalRecord {
  doctor: MedicalDoctor | null;
  followUps: MedicalFollowUp[];
  documents: MedicalDocument[];
}

export type Habit = Tables<"habits">;
export type HabitLog = Tables<"habit_logs">;
