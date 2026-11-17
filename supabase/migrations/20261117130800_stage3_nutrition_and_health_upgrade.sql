-- ============================================================================
-- Stage 3 Nutrition & Health Upgrade: Reminders, Realtime & Flexible Units
-- ============================================================================

-- 1. Widen reminders_queue entity_type for Stage 3 Health & Nutrition
alter table public.reminders_queue
  drop constraint if exists reminders_queue_entity_type_check,
  add constraint reminders_queue_entity_type_check check (
    entity_type in (
      'task_start',
      'waiting_followup',
      'standalone_reminder',
      'morning_digest',
      'evening_review',
      'finance_obligation',
      'credit_grace',
      'debt_due',
      'medical_followup',
      'medical_visit',
      'workout_window',
      'pantry_expiry'
    )
  );

-- 2. Enrich pantry_items & widen unit / source constraints
alter table public.pantry_items
  add column if not exists aisle_group text not null default 'Прочее';

alter table public.pantry_items
  drop constraint if exists pantry_items_unit_check,
  add constraint pantry_items_unit_check check (
    unit in ('g', 'kg', 'ml', 'l', 'pcs', 'tbsp', 'tsp', 'pack')
  );

alter table public.recipe_ingredients
  drop constraint if exists recipe_ingredients_unit_check,
  add constraint recipe_ingredients_unit_check check (
    unit in ('g', 'kg', 'ml', 'l', 'pcs', 'tbsp', 'tsp', 'pack')
  );

alter table public.shopping_list_items
  drop constraint if exists shopping_list_items_added_from_check,
  add constraint shopping_list_items_added_from_check check (
    added_from in ('meal_plan', 'manual', 'telegram', 'mcp', 'openclaw')
  );

alter table public.meal_plan_entries
  add column if not exists notes text;

-- 3. Add Stage 3 tables to supabase_realtime publication idempotently
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'recipes',
    'recipe_ingredients',
    'meal_plan_entries',
    'pantry_items',
    'off_product_evaluations',
    'calorie_logs',
    'workout_programs',
    'workout_sessions',
    'medical_doctors',
    'medical_records',
    'medical_follow_ups',
    'medical_documents'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', tbl);
    end if;
  end loop;
end $$;
