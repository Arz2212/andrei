-- ============================================================================
-- Life OS — Initial Schema Migration (All 33 Tables, Views, Indexes, RLS, Storage, Realtime)
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================================
-- 1. CORE, OWNER PROFILE, DASHBOARD WIDGETS & AI ASSISTANT
-- ============================================================================

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  owner_email text not null unique,
  display_name text not null default 'Владелец',
  timezone text not null default 'Europe/Moscow',
  base_currency text not null default 'RUB' check (char_length(base_currency) = 3),
  daily_buffer_minutes integer not null default 90 check (daily_buffer_minutes between 0 and 480),
  default_available_minutes integer not null default 480 check (default_available_minutes between 60 and 960),
  balance_view_mode text not null default 'safe_to_spend'
    check (balance_view_mode in ('total', 'accounts', 'safe_to_spend')),
  telegram_user_id bigint unique,
  telegram_forum_chat_id bigint,
  telegram_topic_map jsonb not null default '{}'::jsonb,
  feature_flags jsonb not null default '{"enable_calories_off": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dashboard_widgets (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  widget_key text not null check (widget_key in (
    'now_focus', 'day_slots_buffer', 'safe_to_spend', 'waiting_radar',
    'state_pulse', 'habits_strip', 'workout_window', 'today_meals', 'goals_progress', 'pending_confirmations'
  )),
  title_override text,
  is_visible boolean not null default true,
  desktop_col_span smallint not null default 4 check (desktop_col_span in (3, 4, 5, 6, 7, 8, 12)),
  desktop_order smallint not null default 0,
  mobile_order smallint not null default 0,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, widget_key)
);

create table public.assistant_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  persona_name text not null default 'Напарник',
  system_prompt text not null,
  tone_guidelines text not null default 'На «ты», живо, поддерживающе, иногда требовательно и с уместными подколами — без канцелярита и стёба. Фокус на действиях.',
  model_id text not null default 'deepseek-chat',
  morning_digest_time time not null default '08:30',
  evening_review_time time not null default '21:30',
  weekly_review_day smallint not null default 7 check (weekly_review_day between 1 and 7),
  proactive_reminders_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.assistant_agreements (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null default 'general'
    check (scope in ('general', 'planning', 'finance', 'health', 'nutrition', 'communication')),
  rule_text text not null,
  is_active boolean not null default true,
  source text not null default 'web' check (source in ('web', 'telegram_confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assistant_threads (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_chat_id bigint not null,
  message_thread_id bigint not null default 0,
  topic_domain text not null default 'assistant'
    check (topic_domain in ('assistant', 'finance', 'nutrition', 'health', 'journal')),
  rolling_summary text,
  updated_at timestamptz not null default now(),
  unique (user_id, telegram_chat_id, message_thread_id)
);

create table public.assistant_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id bigint not null references public.assistant_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  modality text not null default 'text' check (modality in ('text', 'voice', 'photo', 'callback')),
  content text not null,
  voice_transcript text,
  intent_kind text check (intent_kind in ('conversation', 'reflection', 'overload_triage', 'action_proposal', 'query')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.pending_actions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id bigint references public.assistant_threads(id) on delete set null,
  action_kind text not null check (action_kind in (
    'create_expenses', 'create_income', 'update_day_plan', 'create_tasks',
    'reschedule_tasks', 'save_agreement', 'log_workout', 'update_shopping_list'
  )),
  preview_markdown text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'editing', 'confirmed', 'cancelled', 'expired')),
  telegram_chat_id bigint,
  telegram_message_id bigint,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 2. GOALS, PROJECTS, TASKS, FLEXIBLE SLOTS WITH BUFFER & WAITING-FOR
-- ============================================================================

create table public.goals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  life_area text not null check (life_area in ('work', 'study', 'launch', 'personal', 'health', 'finance')),
  title text not null,
  motivation_note text,
  progress_mode text not null default 'tasks_linked'
    check (progress_mode in ('tasks_linked', 'numeric', 'milestones')),
  current_value numeric(12, 2) not null default 0,
  target_value numeric(12, 2),
  unit text,
  start_date date not null default current_date,
  target_date date,
  status text not null default 'active' check (status in ('active', 'paused', 'achieved', 'dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id bigint references public.goals(id) on delete set null,
  life_area text not null check (life_area in ('work', 'study', 'launch', 'personal', 'health')),
  title text not null,
  description text,
  accent_token text not null default 'domain-work',
  due_date date,
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'archived')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id bigint references public.projects(id) on delete set null,
  goal_id bigint references public.goals(id) on delete set null,
  parent_task_id bigint references public.tasks(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'todo'
    check (status in ('inbox', 'todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  priority smallint not null default 2 check (priority between 1 and 4),
  planned_date date,
  day_slot text not null default 'any' check (day_slot in ('morning', 'afternoon', 'evening', 'any')),
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  due_date date,
  waiting_on_person text,
  waiting_context text,
  waiting_since date,
  follow_up_at timestamptz,
  source text not null default 'web' check (source in ('web', 'telegram')),
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.day_plans (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  available_minutes integer not null default 480 check (available_minutes between 0 and 1440),
  buffer_minutes integer not null default 90 check (buffer_minutes between 0 and 720),
  main_focus text,
  energy_mode text not null default 'normal' check (energy_mode in ('low', 'normal', 'high', 'recovery')),
  notes text,
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

-- ============================================================================
-- 3. FINANCE: ACCOUNTS, SAFE-TO-SPEND, REIMBURSEMENTS, OBLIGATIONS, DEBTS
-- ============================================================================

create table public.finance_accounts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_type text not null check (account_type in ('debit', 'cash', 'savings', 'credit_card', 'investment')),
  currency text not null default 'RUB' check (char_length(currency) = 3),
  balance numeric(14, 2) not null default 0,
  credit_limit numeric(14, 2),
  statement_debt numeric(14, 2) default 0,
  grace_period_due_date date,
  include_in_total boolean not null default true,
  include_in_safe_to_spend boolean not null default true,
  protected_reserve numeric(14, 2) not null default 0 check (protected_reserve >= 0),
  is_archived boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.finance_categories (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  name text not null,
  icon_name text not null default 'receipt',
  voice_aliases text[] not null default '{}',
  monthly_limit numeric(14, 2),
  is_archived boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

create table public.finance_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id bigint not null references public.finance_accounts(id) on delete restrict,
  to_account_id bigint references public.finance_accounts(id) on delete restrict,
  category_id bigint references public.finance_categories(id) on delete set null,
  kind text not null check (kind in ('expense', 'income', 'transfer', 'reimbursement_in')),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'RUB' check (char_length(currency) = 3),
  occurred_at timestamptz not null default now(),
  description text,
  raw_voice_phrase text,
  spend_nature text not null default 'personal'
    check (spend_nature in ('personal', 'work_reimbursable', 'shared_reimbursable')),
  personal_share_amount numeric(14, 2),
  reimbursable_amount numeric(14, 2) not null default 0 check (reimbursable_amount >= 0),
  reimbursement_counterparty text,
  reimbursement_status text not null default 'not_applicable'
    check (reimbursement_status in ('not_applicable', 'pending', 'partial', 'settled')),
  linked_expense_id bigint references public.finance_transactions(id) on delete set null,
  receipt_storage_path text,
  source text not null default 'web' check (source in ('web', 'telegram_voice', 'telegram_text', 'telegram_photo')),
  is_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.finance_obligations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id bigint references public.finance_accounts(id) on delete set null,
  category_id bigint references public.finance_categories(id) on delete set null,
  obligation_kind text not null check (obligation_kind in ('mandatory_bill', 'subscription', 'loan_installment')),
  title text not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'RUB' check (char_length(currency) = 3),
  billing_period text not null default 'monthly' check (billing_period in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due_date date not null,
  deduct_from_safe_to_spend boolean not null default true,
  remind_days_before smallint not null default 2,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.finance_debts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('i_owe', 'owed_to_me')),
  counterparty text not null,
  title text not null,
  initial_amount numeric(14, 2) not null check (initial_amount > 0),
  remaining_amount numeric(14, 2) not null check (remaining_amount >= 0),
  currency text not null default 'RUB' check (char_length(currency) = 3),
  due_date date,
  reserve_in_safe_to_spend boolean not null default false,
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 4. HEALTH: WORKOUTS WITH FLOATING WINDOWS & MEDICAL DOCUMENT ORGANIZER
-- ============================================================================

create table public.workout_programs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  sessions_per_week smallint not null default 3 check (sessions_per_week between 1 and 14),
  program_structure jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workout_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id bigint references public.workout_programs(id) on delete set null,
  title text not null,
  window_start_date date not null,
  window_end_date date not null,
  planned_date date,
  preferred_slot text not null default 'flexible'
    check (preferred_slot in ('morning', 'afternoon', 'evening', 'flexible')),
  status text not null default 'planned' check (status in ('planned', 'completed', 'skipped')),
  duration_minutes integer,
  perceived_effort smallint check (perceived_effort between 1 and 10),
  session_log jsonb not null default '{}'::jsonb,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end_date >= window_start_date)
);

create table public.medical_doctors (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  specialty text not null,
  clinic_name text,
  contacts text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medical_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  doctor_id bigint references public.medical_doctors(id) on delete set null,
  record_kind text not null check (record_kind in ('visit', 'lab_panel', 'imaging', 'checkup', 'other')),
  record_date date not null,
  title text not null,
  summary text,
  doctor_conclusion text,
  next_visit_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medical_follow_ups (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id bigint not null references public.medical_records(id) on delete cascade,
  linked_task_id bigint references public.tasks(id) on delete set null,
  action_title text not null,
  due_date date,
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.medical_documents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id bigint not null references public.medical_records(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 5. NUTRITION: RECIPES, MEAL PLAN, PANTRY, SHOPPING LIST & OPEN FOOD FACTS
-- ============================================================================

create table public.recipes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  meal_category text not null default 'dinner'
    check (meal_category in ('breakfast', 'lunch', 'dinner', 'snack', 'batch_prep')),
  default_servings smallint not null default 2 check (default_servings > 0),
  cook_time_minutes integer,
  steps_markdown text,
  tags text[] not null default '{}',
  kcal_per_serving integer,
  protein_g numeric(6, 1),
  fat_g numeric(6, 1),
  carbs_g numeric(6, 1),
  photo_storage_path text,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recipe_ingredients (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id bigint not null references public.recipes(id) on delete cascade,
  ingredient_key text not null,
  display_name text not null,
  amount numeric(10, 2) not null check (amount > 0),
  unit text not null default 'g' check (unit in ('g', 'ml', 'pcs', 'tbsp', 'tsp', 'pack')),
  aisle_group text not null default 'Прочее',
  is_optional boolean not null default false
);

create table public.meal_plan_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  meal_slot text not null check (meal_slot in ('breakfast', 'lunch', 'dinner', 'snack', 'cook_ahead')),
  recipe_id bigint references public.recipes(id) on delete set null,
  custom_meal_title text,
  planned_servings numeric(5, 2) not null default 1 check (planned_servings > 0),
  status text not null default 'planned' check (status in ('planned', 'cooked', 'eaten', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pantry_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ingredient_key text not null,
  display_name text not null,
  quantity_on_hand numeric(10, 2) not null default 0 check (quantity_on_hand >= 0),
  unit text not null default 'g' check (unit in ('g', 'ml', 'pcs', 'tbsp', 'tsp', 'pack')),
  low_stock_threshold numeric(10, 2),
  expires_on date,
  updated_at timestamptz not null default now(),
  unique (user_id, ingredient_key, unit)
);

create table public.shopping_list_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ingredient_key text,
  display_name text not null,
  quantity_needed numeric(10, 2) not null default 1 check (quantity_needed > 0),
  unit text not null default 'pcs',
  aisle_group text not null default 'Прочее',
  is_checked boolean not null default false,
  added_from text not null default 'meal_plan' check (added_from in ('meal_plan', 'manual', 'telegram')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.off_product_evaluations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  barcode text not null,
  query_note text,
  found_in_off boolean not null default false,
  product_name text,
  brands text,
  has_complete_macros boolean not null default false,
  kcal_100g numeric(6, 1),
  protein_100g numeric(6, 1),
  fat_100g numeric(6, 1),
  carbs_100g numeric(6, 1),
  raw_off_response jsonb,
  tested_at timestamptz not null default now(),
  unique (user_id, barcode)
);

create table public.calorie_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  logged_date date not null default current_date,
  meal_slot text not null default 'snack' check (meal_slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  title text not null,
  barcode text,
  grams numeric(8, 1),
  kcal integer not null check (kcal >= 0),
  protein_g numeric(6, 1),
  fat_g numeric(6, 1),
  carbs_g numeric(6, 1),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 6. ONE-TAP HABITS
-- ============================================================================

create table public.habits (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id bigint references public.goals(id) on delete set null,
  title text not null,
  icon_name text not null default 'check-circle-2',
  cadence text not null default 'daily' check (cadence in ('daily', 'weekly_target')),
  target_per_week smallint not null default 7 check (target_per_week between 1 and 7),
  preferred_slot text not null default 'any' check (preferred_slot in ('morning', 'afternoon', 'evening', 'any')),
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.habit_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id bigint not null references public.habits(id) on delete cascade,
  logged_date date not null default current_date,
  completed boolean not null default true,
  source text not null default 'web' check (source in ('web', 'telegram')),
  created_at timestamptz not null default now(),
  unique (habit_id, logged_date)
);

-- ============================================================================
-- 7. STATE CHECK-INS & EVENING SPLIT REVIEW
-- ============================================================================

create table public.state_checkins (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  logged_at timestamptz not null default now(),
  mood_score smallint not null check (mood_score between 1 and 5),
  energy_score smallint not null check (energy_score between 1 and 5),
  tension_score smallint check (tension_score between 1 and 5),
  context_tags text[] not null default '{}',
  note text,
  source text not null default 'web' check (source in ('web', 'telegram')),
  created_at timestamptz not null default now()
);

create table public.evening_review_criteria (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  domain_key text not null check (domain_key in ('tasks', 'health', 'nutrition', 'habits', 'custom')),
  criterion_slug text not null,
  label text not null,
  scoring_rule_hint text not null,
  max_score smallint not null default 5 check (max_score in (3, 5, 10)),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, criterion_slug)
);

create table public.daily_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  review_date date not null,
  tasks_score smallint check (tasks_score between 1 and 10),
  health_score smallint check (health_score between 1 and 10),
  nutrition_score smallint check (nutrition_score between 1 and 10),
  habits_score smallint check (habits_score between 1 and 10),
  custom_scores jsonb not null default '{}'::jsonb,
  day_highlight text,
  what_drained_energy text,
  tomorrow_main_thing text,
  assistant_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, review_date)
);

-- ============================================================================
-- 8. UPDATED_AT TRIGGERS
-- ============================================================================

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'user_profiles', 'dashboard_widgets', 'assistant_settings', 'assistant_agreements',
    'assistant_threads', 'pending_actions', 'goals', 'projects', 'tasks', 'day_plans',
    'finance_accounts', 'finance_transactions', 'finance_obligations', 'finance_debts',
    'workout_programs', 'workout_sessions', 'medical_doctors', 'medical_records',
    'recipes', 'meal_plan_entries', 'pantry_items', 'shopping_list_items',
    'habits', 'evening_review_criteria', 'daily_reviews'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at();',
      tbl || '_set_updated_at', tbl
    );
  end loop;
end $$;

-- ============================================================================
-- 9. SECURITY INVOKER VIEWS
-- ============================================================================

create or replace view public.v_finance_balance_summary
with (security_invoker = true)
as
select
  a.user_id,
  coalesce(sum(case when a.include_in_total and not a.is_archived then a.balance else 0 end), 0)::numeric(14,2)
    as total_balance,
  coalesce(sum(case when a.include_in_safe_to_spend and not a.is_archived then (a.balance - a.protected_reserve) else 0 end), 0)::numeric(14,2)
    - coalesce((
        select sum(o.amount)
        from public.finance_obligations o
        where o.user_id = a.user_id
          and o.is_active
          and o.deduct_from_safe_to_spend
          and o.next_due_date <= (date_trunc('month', current_date) + interval '1 month - 1 day')::date
      ), 0)::numeric(14,2)
    - coalesce((
        select sum(d.remaining_amount)
        from public.finance_debts d
        where d.user_id = a.user_id
          and d.direction = 'i_owe'
          and d.status = 'open'
          and d.reserve_in_safe_to_spend
      ), 0)::numeric(14,2)
    as safe_to_spend,
  coalesce((
    select sum(t.reimbursable_amount)
    from public.finance_transactions t
    where t.user_id = a.user_id
      and t.reimbursement_status in ('pending', 'partial')
  ), 0)::numeric(14,2) as pending_reimbursements
from public.finance_accounts a
group by a.user_id;

create or replace view public.v_meal_plan_missing_ingredients
with (security_invoker = true)
as
with required as (
  select
    mp.user_id,
    ri.ingredient_key,
    max(ri.display_name) as display_name,
    ri.unit,
    max(ri.aisle_group) as aisle_group,
    sum(ri.amount * (mp.planned_servings / greatest(r.default_servings, 1))) as total_needed
  from public.meal_plan_entries mp
  join public.recipes r on r.id = mp.recipe_id
  join public.recipe_ingredients ri on ri.recipe_id = r.id
  where mp.status = 'planned'
    and mp.plan_date >= current_date
    and not ri.is_optional
  group by mp.user_id, ri.ingredient_key, ri.unit
)
select
  req.user_id,
  req.ingredient_key,
  req.display_name,
  req.unit,
  req.aisle_group,
  req.total_needed::numeric(10,2),
  coalesce(p.quantity_on_hand, 0)::numeric(10,2) as on_hand,
  greatest(req.total_needed - coalesce(p.quantity_on_hand, 0), 0)::numeric(10,2) as to_buy
from required req
left join public.pantry_items p
  on p.user_id = req.user_id
  and p.ingredient_key = req.ingredient_key
  and p.unit = req.unit
where req.total_needed > coalesce(p.quantity_on_hand, 0);

-- ============================================================================
-- 10. INDEXES ON ALL FOREIGN KEYS & HOT FILTERS
-- ============================================================================

create index tasks_user_status_date_idx on public.tasks (user_id, status, planned_date);
create index tasks_project_id_idx on public.tasks (project_id);
create index tasks_goal_id_idx on public.tasks (goal_id);
create index tasks_parent_task_id_idx on public.tasks (parent_task_id);
create index tasks_waiting_idx on public.tasks (user_id, follow_up_at) where status = 'waiting';

create index projects_user_status_idx on public.projects (user_id, status);
create index projects_goal_id_idx on public.projects (goal_id);
create index goals_user_status_idx on public.goals (user_id, status);

create index assistant_agreements_user_idx on public.assistant_agreements (user_id, is_active);
create index assistant_messages_thread_created_idx on public.assistant_messages (thread_id, created_at desc);
create index assistant_messages_user_id_idx on public.assistant_messages (user_id);
create index pending_actions_user_status_idx on public.pending_actions (user_id, status);
create index pending_actions_thread_id_idx on public.pending_actions (thread_id);

create index finance_accounts_user_idx on public.finance_accounts (user_id);
create index finance_transactions_user_occurred_idx on public.finance_transactions (user_id, occurred_at desc);
create index finance_transactions_account_id_idx on public.finance_transactions (account_id);
create index finance_transactions_to_account_id_idx on public.finance_transactions (to_account_id);
create index finance_transactions_category_id_idx on public.finance_transactions (category_id);
create index finance_transactions_linked_expense_idx on public.finance_transactions (linked_expense_id);
create index finance_obligations_user_due_idx on public.finance_obligations (user_id, next_due_date);
create index finance_obligations_account_idx on public.finance_obligations (account_id);
create index finance_obligations_category_idx on public.finance_obligations (category_id);
create index finance_debts_user_status_idx on public.finance_debts (user_id, status);

create index workout_programs_user_idx on public.workout_programs (user_id);
create index workout_sessions_user_window_idx on public.workout_sessions (user_id, window_start_date, window_end_date);
create index workout_sessions_program_idx on public.workout_sessions (program_id);
create index medical_doctors_user_idx on public.medical_doctors (user_id);
create index medical_records_user_date_idx on public.medical_records (user_id, record_date desc);
create index medical_records_doctor_idx on public.medical_records (doctor_id);
create index medical_follow_ups_record_idx on public.medical_follow_ups (record_id);
create index medical_follow_ups_task_idx on public.medical_follow_ups (linked_task_id);
create index medical_follow_ups_user_idx on public.medical_follow_ups (user_id);
create index medical_documents_record_idx on public.medical_documents (record_id);
create index medical_documents_user_idx on public.medical_documents (user_id);

create index recipes_user_category_idx on public.recipes (user_id, meal_category);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_user_idx on public.recipe_ingredients (user_id);
create index meal_plan_entries_user_date_idx on public.meal_plan_entries (user_id, plan_date);
create index meal_plan_entries_recipe_idx on public.meal_plan_entries (recipe_id);
create index shopping_list_items_user_checked_idx on public.shopping_list_items (user_id, is_checked);
create index calorie_logs_user_date_idx on public.calorie_logs (user_id, logged_date desc);

create index habits_user_archived_idx on public.habits (user_id, is_archived);
create index habits_goal_id_idx on public.habits (goal_id);
create index habit_logs_user_date_idx on public.habit_logs (user_id, logged_date desc);
create index state_checkins_user_logged_idx on public.state_checkins (user_id, logged_at desc);

-- ============================================================================
-- 11. STRICT ROW LEVEL SECURITY (RLS) ON ALL 33 TABLES
-- ============================================================================

alter table public.user_profiles enable row level security;
create policy "user_profiles_select_own" on public.user_profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "user_profiles_insert_own" on public.user_profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "user_profiles_update_own" on public.user_profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'dashboard_widgets', 'assistant_settings', 'assistant_agreements',
    'assistant_threads', 'assistant_messages', 'pending_actions',
    'goals', 'projects', 'tasks', 'day_plans',
    'finance_accounts', 'finance_categories', 'finance_transactions',
    'finance_obligations', 'finance_debts',
    'workout_programs', 'workout_sessions', 'medical_doctors',
    'medical_records', 'medical_follow_ups', 'medical_documents',
    'recipes', 'recipe_ingredients', 'meal_plan_entries',
    'pantry_items', 'shopping_list_items', 'off_product_evaluations', 'calorie_logs',
    'habits', 'habit_logs', 'state_checkins', 'evening_review_criteria', 'daily_reviews'
  ]
  loop
    execute format('alter table public.%I enable row level security;', tbl);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id);',
      tbl || '_select_own', tbl
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id);',
      tbl || '_insert_own', tbl
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);',
      tbl || '_update_own', tbl
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id);',
      tbl || '_delete_own', tbl
    );
  end loop;
end $$;

-- ============================================================================
-- 12. PRIVATE STORAGE BUCKETS & REALTIME PUBLICATION
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('medical-docs', 'medical-docs', false, 26214400),
  ('finance-receipts', 'finance-receipts', false, 10485760),
  ('meal-photos', 'meal-photos', false, 10485760)
on conflict (id) do nothing;

create policy "owner_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id in ('medical-docs', 'finance-receipts', 'meal-photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "owner_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('medical-docs', 'finance-receipts', 'meal-photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "owner_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id in ('medical-docs', 'finance-receipts', 'meal-photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('medical-docs', 'finance-receipts', 'meal-photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "owner_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('medical-docs', 'finance-receipts', 'meal-photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text);

alter publication supabase_realtime add table
  public.tasks,
  public.day_plans,
  public.pending_actions,
  public.finance_accounts,
  public.finance_transactions,
  public.shopping_list_items,
  public.habit_logs,
  public.state_checkins,
  public.dashboard_widgets;
