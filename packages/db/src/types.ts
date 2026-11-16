import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert, TablesUpdate } from "./database.types";

export type { Database, Tables, TablesInsert, TablesUpdate };
export type TypedSupabaseClient = SupabaseClient<Database>;

export type UserProfile = Tables<"user_profiles">;
export type UserProfileUpdate = TablesUpdate<"user_profiles">;

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
export type Project = Tables<"projects">;
export type ProjectInsert = TablesInsert<"projects">;
export type ProjectUpdate = TablesUpdate<"projects">;

export type Task = Tables<"tasks">;
export type TaskInsert = TablesInsert<"tasks">;
export type TaskUpdate = TablesUpdate<"tasks">;
export type TaskStatus = "inbox" | "todo" | "in_progress" | "waiting" | "done" | "cancelled";
export type DaySlot = "morning" | "afternoon" | "evening" | "any";
export type LifeArea = "work" | "study" | "launch" | "personal" | "health";

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

export type FinanceAccount = Tables<"finance_accounts">;
export type FinanceCategory = Tables<"finance_categories">;
export type FinanceTransaction = Tables<"finance_transactions">;
export type FinanceBalanceSummary = Database["public"]["Views"]["v_finance_balance_summary"]["Row"];
export type Habit = Tables<"habits">;
export type HabitLog = Tables<"habit_logs">;
