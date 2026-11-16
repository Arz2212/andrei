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

export const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/);

export const CreateTaskInputSchema = z.object({
  title: z.string().min(1).max(400),
  notes: z.string().max(4000).nullable().optional(),
  project_id: z.number().int().positive().nullable().optional(),
  goal_id: z.number().int().positive().nullable().optional(),
  status: TaskStatusSchema.default("todo"),
  priority: z.number().int().min(1).max(4).default(2),
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
  waiting_on_person: z.string().max(200).nullable().optional(),
  waiting_context: z.string().max(1000).nullable().optional(),
  waiting_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  follow_up_at: z.string().nullable().optional(),
  source: z.enum(["web", "telegram"]).default("web"),
});

export const UpdateDayPlanInputSchema = z.object({
  available_minutes: z.number().int().min(0).max(1440).optional(),
  buffer_minutes: z.number().int().min(0).max(720).optional(),
  main_focus: z.string().max(500).nullable().optional(),
  energy_mode: z.enum(["low", "normal", "high", "recovery"]).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const StateCheckinInputSchema = z.object({
  mood_score: z.number().int().min(1).max(5),
  energy_score: z.number().int().min(1).max(5),
  tension_score: z.number().int().min(1).max(5).nullable().optional(),
  context_tags: z.array(z.string().max(50)).default([]),
  note: z.string().max(2000).nullable().optional(),
  source: z.enum(["web", "telegram"]).default("web"),
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

export const StagedExpenseItemSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default("RUB"),
  category_name: z.string().min(1),
  description: z.string().optional(),
  account_id: z.number().int().positive().optional(),
  spend_nature: z.enum(["personal", "work_reimbursable", "shared_reimbursable"]).default("personal"),
  reimbursable_amount: z.number().min(0).default(0),
});
