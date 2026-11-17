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
