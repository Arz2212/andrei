-- ============================================================================
-- Stage 3 Nutrition v2 Redesign:
--   1. Always-On КБЖУ & Barcode (enable_calories_off = true)
--   2. nutrition_targets (with is_configured = false for AI First-Entry Setup)
--   3. food_items_dictionary (~115 essential Russian & everyday foods + cache)
--   4. Enriched recipe_ingredients, recipes (auto-macros), and calorie_logs
--   5. body_weight_logs + Realtime + RLS
-- ============================================================================

-- 1. Permanently enable calories & barcode feature flag default
alter table public.user_profiles
  alter column feature_flags set default '{"enable_calories_off": true}'::jsonb;

-- 2. Personal Nutrition Targets (AI Onboarding + Manual Override)
create table if not exists public.nutrition_targets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_configured boolean not null default false,
  kcal_target integer not null default 2200 check (kcal_target between 800 and 10000),
  protein_target_g numeric(6, 1) not null default 150 check (protein_target_g >= 0),
  fat_target_g numeric(6, 1) not null default 73 check (fat_target_g >= 0),
  carbs_target_g numeric(6, 1) not null default 235 check (carbs_target_g >= 0),
  fiber_target_g numeric(6, 1) default 28,
  goal_mode text not null default 'maintain'
    check (goal_mode in ('lose', 'maintain', 'gain', 'recomp')),
  sex text check (sex is null or sex in ('male', 'female')),
  age smallint check (age is null or age between 12 and 110),
  height_cm numeric(5, 1),
  baseline_weight_kg numeric(5, 2),
  target_weight_kg numeric(5, 2),
  activity_level text,
  ai_explanation text,
  configured_via text default 'ai'
    check (configured_via is null or configured_via in ('ai', 'telegram_ai', 'manual')),
  updated_at timestamptz not null default now()
);

create or replace trigger nutrition_targets_set_updated_at
  before update on public.nutrition_targets
  for each row execute function public.set_updated_at();

alter table public.nutrition_targets enable row level security;

create policy "nutrition_targets_select_own" on public.nutrition_targets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "nutrition_targets_insert_own" on public.nutrition_targets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "nutrition_targets_update_own" on public.nutrition_targets
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "nutrition_targets_delete_own" on public.nutrition_targets
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 3. Open Food Reference Dictionary (Global curated + User cached items per 100g)
create table if not exists public.food_items_dictionary (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  normalized_name text not null,
  display_name text not null,
  brand text,
  barcode text,
  kcal_100g numeric(6, 1) not null check (kcal_100g >= 0),
  protein_100g numeric(6, 1) not null default 0 check (protein_100g >= 0),
  fat_100g numeric(6, 1) not null default 0 check (fat_100g >= 0),
  carbs_100g numeric(6, 1) not null default 0 check (carbs_100g >= 0),
  fiber_100g numeric(6, 1) default 0,
  default_portion_g numeric(7, 1) not null default 100 check (default_portion_g > 0),
  default_unit text not null default 'g',
  source text not null default 'open_reference'
    check (source in ('open_reference', 'openfoodfacts', 'ai_estimated', 'user')),
  created_at timestamptz not null default now()
);

create index if not exists food_items_dictionary_norm_name_idx
  on public.food_items_dictionary (normalized_name);
create index if not exists food_items_dictionary_barcode_idx
  on public.food_items_dictionary (barcode) where barcode is not null;
create index if not exists food_items_dictionary_user_id_idx
  on public.food_items_dictionary (user_id);

alter table public.food_items_dictionary enable row level security;

create policy "food_items_dictionary_select_visible" on public.food_items_dictionary
  for select to authenticated
  using (user_id is null or (select auth.uid()) = user_id);
create policy "food_items_dictionary_insert_own" on public.food_items_dictionary
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "food_items_dictionary_update_own" on public.food_items_dictionary
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "food_items_dictionary_delete_own" on public.food_items_dictionary
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 4. Enrich recipe_ingredients, recipes, and calorie_logs
alter table public.recipe_ingredients
  add column if not exists grams_equivalent numeric(8, 1),
  add column if not exists kcal_100g numeric(6, 1),
  add column if not exists protein_100g numeric(6, 1),
  add column if not exists fat_100g numeric(6, 1),
  add column if not exists carbs_100g numeric(6, 1);

alter table public.recipes
  add column if not exists total_weight_g numeric(8, 1),
  add column if not exists total_kcal integer,
  add column if not exists total_protein_g numeric(6, 1),
  add column if not exists total_fat_g numeric(6, 1),
  add column if not exists total_carbs_g numeric(6, 1),
  add column if not exists kcal_per_100g numeric(6, 1);

alter table public.calorie_logs
  add column if not exists recipe_id bigint references public.recipes(id) on delete set null,
  add column if not exists food_item_id bigint references public.food_items_dictionary(id) on delete set null,
  add column if not exists servings numeric(6, 2),
  add column if not exists fiber_g numeric(6, 1) default 0,
  add column if not exists source text not null default 'web'
    check (source in ('web', 'barcode', 'photo_ai', 'recipe', 'mcp', 'openclaw')),
  add column if not exists photo_note text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists calorie_logs_recipe_id_idx on public.calorie_logs (recipe_id);
create index if not exists calorie_logs_food_item_id_idx on public.calorie_logs (food_item_id);

create or replace trigger calorie_logs_set_updated_at
  before update on public.calorie_logs
  for each row execute function public.set_updated_at();

-- 5. Body Weight Logs
create table if not exists public.body_weight_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  logged_date date not null default current_date,
  logged_at timestamptz not null default now(),
  weight_kg numeric(5, 2) not null check (weight_kg between 20 and 350),
  body_fat_pct numeric(4, 1) check (body_fat_pct is null or body_fat_pct between 2 and 70),
  waist_cm numeric(5, 1),
  note text,
  source text not null default 'web'
    check (source in ('web', 'telegram', 'mcp', 'openclaw')),
  created_at timestamptz not null default now()
);

create index if not exists body_weight_logs_user_date_idx
  on public.body_weight_logs (user_id, logged_date desc);

alter table public.body_weight_logs enable row level security;

create policy "body_weight_logs_select_own" on public.body_weight_logs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "body_weight_logs_insert_own" on public.body_weight_logs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "body_weight_logs_update_own" on public.body_weight_logs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "body_weight_logs_delete_own" on public.body_weight_logs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 6. Add new tables to supabase_realtime idempotently
do $$
declare
  tbl text;
begin
  foreach tbl in array array['nutrition_targets', 'food_items_dictionary', 'body_weight_logs']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', tbl);
    end if;
  end loop;
end $$;
