import { z } from "zod";

export const DaySlotSchema = z.enum(["morning", "afternoon", "evening", "any"]);
export const TaskStatusSchema = z.enum([
  "inbox",
  "todo",
  "in_progress",
  "waiting",
  "done",
  "cancelled",
]);
export const LifeAreaSchema = z.enum(["work", "study", "launch", "personal", "health"]);
export const RecordSourceSchema = z.enum(["web", "telegram", "mcp", "openclaw"]);

export const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);

export const SubtaskItemSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(400),
  done: z.boolean().default(false),
});

export const CreateTaskInputSchema = z.object({
  title: z.string().min(1).max(400),
  notes: z.string().max(4000).nullable().optional(),
  project_id: z.number().int().positive().nullable().optional(),
  goal_id: z.number().int().positive().nullable().optional(),
  status: TaskStatusSchema.default("todo"),
  priority: z.number().int().min(1).max(4).default(2),
  tags: z.array(z.string().min(1).max(60)).default([]),
  subtasks: z.array(SubtaskItemSchema).default([]),
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  day_slot: DaySlotSchema.default("any"),
  estimated_minutes: z.number().int().min(5).max(720).nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  scheduled_start_at: z.string().nullable().optional(),
  scheduled_end_at: z.string().nullable().optional(),
  scheduled_time: ClockTimeSchema.nullable().optional(),
  scheduled_end_time: ClockTimeSchema.nullable().optional(),
  is_meeting: z.boolean().default(false),
  remind_before_minutes: z.number().int().min(0).max(1440).nullable().optional(),
  remind_offsets_minutes: z.array(z.number().int().min(0).max(1440)).optional(),
  recurrence_rule: z.string().max(200).nullable().optional(),
  waiting_on_person: z.string().max(200).nullable().optional(),
  waiting_context: z.string().max(1000).nullable().optional(),
  waiting_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  follow_up_at: z.string().nullable().optional(),
  source: RecordSourceSchema.default("web"),
});

export const UpdateDayPlanInputSchema = z.object({
  available_minutes: z.number().int().min(0).max(1440).optional(),
  buffer_minutes: z.number().int().min(0).max(720).optional(),
  main_focus: z.string().max(500).nullable().optional(),
  energy_mode: z.enum(["low", "normal", "high", "recovery"]).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const StateCheckinInputSchema = z.object({
  mood_score: z.number().int().min(1).max(10),
  energy_score: z.number().int().min(1).max(10),
  tension_score: z.number().int().min(1).max(10).nullable().optional(),
  context_tags: z.array(z.string().max(50)).default([]),
  note: z.string().max(2000).nullable().optional(),
  source: RecordSourceSchema.default("web"),
});

export const DailyReviewInputSchema = z.object({
  review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tasks_score: z.number().int().min(1).max(10).nullable().optional(),
  health_score: z.number().int().min(1).max(10).nullable().optional(),
  nutrition_score: z.number().int().min(1).max(10).nullable().optional(),
  habits_score: z.number().int().min(1).max(10).nullable().optional(),
  custom_scores: z.record(z.string(), z.number()).optional(),
  day_highlight: z.string().max(2000).nullable().optional(),
  what_drained_energy: z.string().max(2000).nullable().optional(),
  tomorrow_main_thing: z.string().max(1000).nullable().optional(),
});

// ============================================================================
// Stage 2 — Finance Zod Schemas
// ============================================================================

export const BalanceViewModeSchema = z.enum(["total", "accounts", "safe_to_spend"]);
export const FinanceAccountTypeSchema = z.enum([
  "debit",
  "cash",
  "savings",
  "credit_card",
  "investment",
]);
export const FinanceTransactionKindSchema = z.enum([
  "expense",
  "income",
  "transfer",
  "reimbursement_in",
]);
export const SpendNatureSchema = z.enum([
  "personal",
  "work_reimbursable",
  "shared_reimbursable",
]);
export const ReimbursementStatusSchema = z.enum([
  "not_applicable",
  "pending",
  "partial",
  "settled",
]);
export const FinanceTransactionSourceSchema = z.enum([
  "web",
  "telegram_voice",
  "telegram_text",
  "telegram_photo",
  "mcp",
  "openclaw",
]);
export const BillingPeriodSchema = z.enum(["weekly", "monthly", "quarterly", "yearly"]);
export const FinanceObligationKindSchema = z.enum([
  "mandatory_bill",
  "subscription",
  "loan_installment",
]);
export const DebtDirectionSchema = z.enum(["i_owe", "owed_to_me"]);

export const CreateFinanceTransactionInputSchema = z.object({
  account_id: z.number().int().positive(),
  to_account_id: z.number().int().positive().nullable().optional(),
  category_id: z.number().int().positive().nullable().optional(),
  kind: FinanceTransactionKindSchema.default("expense"),
  amount: z.number().positive(),
  currency: z.string().length(3).default("RUB"),
  occurred_at: z.string().optional(),
  description: z.string().max(1000).nullable().optional(),
  raw_voice_phrase: z.string().max(1000).nullable().optional(),
  spend_nature: SpendNatureSchema.default("personal"),
  personal_share_amount: z.number().min(0).nullable().optional(),
  reimbursable_amount: z.number().min(0).optional(),
  reimbursement_counterparty: z.string().max(200).nullable().optional(),
  reimbursement_status: ReimbursementStatusSchema.optional(),
  linked_expense_id: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string().max(60)).default([]),
  source: FinanceTransactionSourceSchema.default("web"),
});

export const StagedExpenseItemSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default("RUB"),
  category_name: z.string().min(1),
  description: z.string().optional(),
  account_id: z.number().int().positive().optional(),
  spend_nature: SpendNatureSchema.default("personal"),
  reimbursable_amount: z.number().min(0).default(0),
});

// ============================================================================
// Stage 3 — Nutrition & Health Zod Schemas
// ============================================================================

export const IngredientUnitSchema = z.enum([
  "g",
  "kg",
  "ml",
  "l",
  "pcs",
  "tbsp",
  "tsp",
  "pack",
]);
export const MealCategorySchema = z.enum([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "batch_prep",
]);
export const MealSlotSchema = z.enum([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "cook_ahead",
]);
export const MealPlanStatusSchema = z.enum(["planned", "cooked", "eaten", "skipped"]);
export const ShoppingAddedFromSchema = z.enum([
  "meal_plan",
  "manual",
  "telegram",
  "mcp",
  "openclaw",
]);

export const RecipeIngredientInputSchema = z.object({
  display_name: z.string().min(1).max(200),
  ingredient_key: z.string().max(200).optional(),
  amount: z.number().positive(),
  unit: IngredientUnitSchema.default("g"),
  aisle_group: z.string().max(100).default("Прочее"),
  is_optional: z.boolean().default(false),
  grams_equivalent: z.number().positive().nullable().optional(),
  kcal_100g: z.number().min(0).max(1000).nullable().optional(),
  protein_100g: z.number().min(0).max(100).nullable().optional(),
  fat_100g: z.number().min(0).max(100).nullable().optional(),
  carbs_100g: z.number().min(0).max(100).nullable().optional(),
});

export const DiaryMealSlotSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export const CalorieLogSourceSchema = z.enum([
  "web",
  "barcode",
  "photo_ai",
  "recipe",
  "mcp",
  "openclaw",
]);
export const NutritionGoalModeSchema = z.enum(["lose", "maintain", "gain", "recomp"]);
export const FoodDictionarySourceSchema = z.enum([
  "open_reference",
  "openfoodfacts",
  "ai_estimated",
  "user",
]);

export const ConfigureNutritionTargetsInputSchema = z.object({
  kcal_target: z.number().int().min(800).max(10000),
  protein_target_g: z.number().min(20).max(600),
  fat_target_g: z.number().min(15).max(400),
  carbs_target_g: z.number().min(0).max(1200),
  fiber_target_g: z.number().min(0).max(150).nullable().optional(),
  goal_mode: NutritionGoalModeSchema.default("maintain"),
  sex: z.enum(["male", "female"]).nullable().optional(),
  age: z.number().int().min(12).max(110).nullable().optional(),
  height_cm: z.number().min(100).max(250).nullable().optional(),
  baseline_weight_kg: z.number().min(25).max(350).nullable().optional(),
  target_weight_kg: z.number().min(25).max(350).nullable().optional(),
  activity_level: z.string().max(200).nullable().optional(),
  ai_explanation: z.string().max(4000).nullable().optional(),
  configured_via: z.enum(["ai", "telegram_ai", "manual"]).default("ai"),
});

export const BodyWeightLogInputSchema = z.object({
  logged_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  weight_kg: z.number().min(20).max(350),
  body_fat_pct: z.number().min(2).max(70).nullable().optional(),
  waist_cm: z.number().min(30).max(250).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  source: z.string().max(50).default("web"),
});

export const LogFoodDiaryEntryInputSchema = z.object({
  logged_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  meal_slot: DiaryMealSlotSchema.default("snack"),
  title: z.string().min(1).max(300).optional(),
  grams: z.number().positive().max(10000).nullable().optional(),
  servings: z.number().positive().max(100).nullable().optional(),
  food_item_id: z.number().int().positive().nullable().optional(),
  recipe_id: z.number().int().positive().nullable().optional(),
  barcode: z.string().max(64).nullable().optional(),
  kcal: z.number().int().min(0).max(20000).optional(),
  protein_g: z.number().min(0).max(2000).nullable().optional(),
  fat_g: z.number().min(0).max(2000).nullable().optional(),
  carbs_g: z.number().min(0).max(2000).nullable().optional(),
  fiber_g: z.number().min(0).max(500).nullable().optional(),
  source: CalorieLogSourceSchema.default("web"),
  photo_note: z.string().max(1000).nullable().optional(),
});

export const WorkoutPreferredSlotSchema = z.enum([
  "morning",
  "afternoon",
  "evening",
  "flexible",
]);
export const WorkoutSessionStatusSchema = z.enum(["planned", "completed", "skipped"]);
export const MedicalRecordKindSchema = z.enum([
  "visit",
  "lab_panel",
  "imaging",
  "checkup",
  "other",
]);

// ============================================================================
// Stage 4 — Goals, Milestones & Habits Zod Schemas
// ============================================================================

export const GoalLifeAreaSchema = z.enum([
  "work",
  "study",
  "launch",
  "personal",
  "health",
  "finance",
]);
export const GoalProgressModeSchema = z.enum(["tasks_linked", "numeric", "milestones"]);
export const GoalStatusSchema = z.enum(["active", "paused", "achieved", "dropped"]);
export const HabitCadenceSchema = z.enum(["daily", "weekly_target"]);
export const HabitPreferredSlotSchema = z.enum([
  "morning",
  "afternoon",
  "evening",
  "any",
]);

export const GoalMilestoneDraftSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().min(1).max(300),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  is_completed: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(1000).optional(),
});

export const UpsertGoalInputSchema = z.object({
  id: z.number().int().positive().optional(),
  query: z.string().max(300).optional(),
  life_area: GoalLifeAreaSchema.default("personal"),
  title: z.string().min(1).max(300),
  motivation_note: z.string().max(2000).nullable().optional(),
  progress_mode: GoalProgressModeSchema.default("tasks_linked"),
  start_value: z.number().optional(),
  current_value: z.number().optional(),
  target_value: z.number().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  status: GoalStatusSchema.default("active"),
  milestones: z.array(GoalMilestoneDraftSchema).optional(),
});

export const UpsertHabitInputSchema = z.object({
  id: z.number().int().positive().optional(),
  query: z.string().max(300).optional(),
  goal_id: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  icon_name: z.string().max(60).default("check-circle-2"),
  color_token: z.string().max(60).default("domain-health"),
  cadence: HabitCadenceSchema.default("daily"),
  target_per_week: z.number().int().min(1).max(7).default(7),
  preferred_slot: HabitPreferredSlotSchema.default("any"),
  reminder_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/)
    .nullable()
    .optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
  is_archived: z.boolean().optional(),
});

export const ToggleHabitCheckinInputSchema = z.object({
  habitIdOrQuery: z.union([z.number().int().positive(), z.string().min(1)]),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  completed: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
  source: RecordSourceSchema.default("web"),
});
