-- ============================================================================
-- Stage 4: Goals, Milestones, 1-Tap Habits, Streaks & Proactive Digests
-- ============================================================================

-- 1. Enrich public.goals with start_value (supports both increasing & decreasing numeric goals, e.g. 84 -> 79 kg)
alter table public.goals
  add column if not exists start_value numeric(12, 2) not null default 0;

create index if not exists goals_user_status_idx
  on public.goals (user_id, status);

-- 2. Create public.goal_milestones (powers progress_mode = 'milestones' on public.goals)
create table if not exists public.goal_milestones (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id bigint not null references public.goals(id) on delete cascade,
  title text not null,
  due_date date,
  is_completed boolean not null default false,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists goal_milestones_goal_sort_idx
  on public.goal_milestones (goal_id, sort_order);

create index if not exists goal_milestones_user_id_idx
  on public.goal_milestones (user_id);

create or replace trigger set_goal_milestones_updated_at
  before update on public.goal_milestones
  for each row execute function public.set_updated_at();

alter table public.goal_milestones enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'goal_milestones'
      and policyname = 'goal_milestones_owner_all'
  ) then
    create policy "goal_milestones_owner_all"
      on public.goal_milestones
      for all
      to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end $$;

-- 3. Non-breaking enrichments on public.habits & public.habit_logs
alter table public.habits
  add column if not exists description text,
  add column if not exists color_token text not null default 'domain-health',
  add column if not exists reminder_time time;

create index if not exists habits_user_archived_sort_idx
  on public.habits (user_id, is_archived, sort_order);

create index if not exists habits_goal_id_idx
  on public.habits (goal_id);

alter table public.habit_logs
  add column if not exists note text;

create index if not exists habit_logs_user_date_idx
  on public.habit_logs (user_id, logged_date desc);

alter table public.habit_logs
  drop constraint if exists habit_logs_source_check,
  add constraint habit_logs_source_check check (
    source in ('web', 'telegram', 'mcp', 'openclaw')
  );

-- 4. Widen public.reminders_queue entity_type check for weekly_digest & habit_reminder
alter table public.reminders_queue
  drop constraint if exists reminders_queue_entity_type_check,
  add constraint reminders_queue_entity_type_check check (
    entity_type in (
      'task_start',
      'task',
      'waiting_followup',
      'standalone_reminder',
      'custom',
      'morning_digest',
      'evening_review',
      'weekly_digest',
      'finance_obligation',
      'obligation_due',
      'credit_grace',
      'debt_due',
      'medical_followup',
      'medical_visit',
      'workout_window',
      'pantry_expiry',
      'habit_reminder',
      'goal_milestone'
    )
  );

-- 5. Ensure Goals & Habits tables are in supabase_realtime publication
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'goals',
    'goal_milestones',
    'habits',
    'habit_logs'
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

-- 6. Enable habits_strip & goals_progress widgets + idempotent Stage 4 seed for owner
do $$
declare
  v_owner_id uuid;
  v_goal_launch_id bigint;
  v_goal_study_id bigint;
  v_goal_finance_id bigint;
  v_goal_health_id bigint;
  v_habit_water_id bigint;
  v_habit_steps_id bigint;
  v_habit_reading_id bigint;
  v_habit_workout_id bigint;
  v_habit_review_id bigint;
  v_anchor_date date := (now() at time zone 'Europe/Moscow')::date;
  v_offset int;
  v_d date;
begin
  select id into v_owner_id
  from public.user_profiles
  where owner_email = 'arz_22@mail.ru'
  limit 1;

  if v_owner_id is null then
    return;
  end if;

  -- Ensure habits_strip & goals_progress are present and visible without overwriting existing orders
  insert into public.dashboard_widgets (
    user_id, widget_key, is_visible, desktop_col_span, desktop_order, mobile_order
  )
  values
    (v_owner_id, 'habits_strip', true, 6, 7, 7),
    (v_owner_id, 'goals_progress', true, 6, 10, 10)
  on conflict (user_id, widget_key) do update
    set is_visible = true;

  -- Seed 4 realistic active goals if owner currently has < 2 goals
  if (select count(*) from public.goals where user_id = v_owner_id) < 2 then
    insert into public.goals (
      user_id, life_area, title, motivation_note, progress_mode,
      start_value, current_value, target_value, unit, start_date, target_date, status
    )
    values (
      v_owner_id,
      'launch',
      'Запустить и обкатать Персональную Life OS 1.0',
      'Единая спокойная система задач, финансов, питания, здоровья и целей без перегруза и хаоса',
      'tasks_linked',
      0, 0, null, null,
      v_anchor_date - 10,
      '2026-12-15',
      'active'
    )
    returning id into v_goal_launch_id;

    insert into public.goals (
      user_id, life_area, title, motivation_note, progress_mode,
      start_value, current_value, target_value, unit, start_date, target_date, status
    )
    values (
      v_owner_id,
      'study',
      'Сдать научную работу и закрыть семестр без авралов',
      'Идти ровным темпом по вехам с научным руководителем без ночных марафонов',
      'milestones',
      0, 2, 4, 'этапа',
      v_anchor_date - 14,
      '2026-12-28',
      'active'
    )
    returning id into v_goal_study_id;

    insert into public.goal_milestones (
      user_id, goal_id, title, due_date, is_completed, completed_at, sort_order
    )
    values
      (v_owner_id, v_goal_study_id, 'Утвердить тему и план работы с научным руководителем', v_anchor_date - 7, true, now() - interval '7 days', 1),
      (v_owner_id, v_goal_study_id, 'Собрать литературный обзор и исходные данные', v_anchor_date - 2, true, now() - interval '2 days', 2),
      (v_owner_id, v_goal_study_id, 'Написать черновик аналитической главы и согласовать правки', v_anchor_date + 12, false, null, 3),
      (v_owner_id, v_goal_study_id, 'Оформить чистовик, презентацию и пройти предзащиту', '2026-12-24', false, null, 4);

    insert into public.goals (
      user_id, life_area, title, motivation_note, progress_mode,
      start_value, current_value, target_value, unit, start_date, target_date, status
    )
    values (
      v_owner_id,
      'finance',
      'Сформировать защитный резерв 300 000 ₽',
      'Неприкосновенная подушка безопасности минимум на 3 месяца обязательных расходов',
      'numeric',
      0, 135000, 300000, '₽',
      '2026-09-01',
      '2027-03-31',
      'active'
    )
    returning id into v_goal_finance_id;

    insert into public.goals (
      user_id, life_area, title, motivation_note, progress_mode,
      start_value, current_value, target_value, unit, start_date, target_date, status
    )
    values (
      v_owner_id,
      'health',
      'Стабильный вес 79 кг и 3 силовые в неделю',
      'Плавная рекомпозиция тела с сохранением высокой дневной энергии и силы',
      'numeric',
      84.0, 81.6, 79.0, 'кг',
      v_anchor_date - 21,
      '2027-02-15',
      'active'
    )
    returning id into v_goal_health_id;

    -- Link existing launch project & tasks to the launch/study/health goals
    update public.projects
      set goal_id = v_goal_launch_id
    where user_id = v_owner_id
      and life_area = 'launch'
      and goal_id is null;

    update public.tasks
      set goal_id = v_goal_launch_id
    where user_id = v_owner_id
      and goal_id is null
      and (
        title ilike '%Life OS%'
        or title ilike '%Этап%'
        or id in (4, 5, 6)
      );

    update public.tasks
      set goal_id = v_goal_study_id
    where user_id = v_owner_id
      and goal_id is null
      and (
        title ilike '%научн%'
        or title ilike '%диплом%'
        or title ilike '%Пара:%'
      );

    update public.tasks
      set goal_id = v_goal_health_id
    where user_id = v_owner_id
      and goal_id is null
      and title ilike '%спортзал%';
  else
    select id into v_goal_health_id
    from public.goals
    where user_id = v_owner_id and life_area = 'health'
    limit 1;
  end if;

  -- Seed 5 realistic habits + 18 days of habit_logs if owner currently has < 2 habits
  if (select count(*) from public.habits where user_id = v_owner_id) < 2 then
    insert into public.habits (
      user_id, goal_id, title, description, icon_name, color_token,
      cadence, target_per_week, preferred_slot, reminder_time, sort_order
    )
    values (
      v_owner_id,
      v_goal_health_id,
      'Вода 2 л',
      'Стакан тёплой воды утром и норма чистой воды в течение дня',
      'droplets',
      'domain-health',
      'daily',
      7,
      'morning',
      null,
      1
    )
    returning id into v_habit_water_id;

    insert into public.habits (
      user_id, goal_id, title, description, icon_name, color_token,
      cadence, target_per_week, preferred_slot, reminder_time, sort_order
    )
    values (
      v_owner_id,
      v_goal_health_id,
      '10 000 шагов / прогулка',
      'Минимум 40 минут быстрой ходьбы на воздухе для перезагрузки головы',
      'footprints',
      'domain-health',
      'daily',
      7,
      'afternoon',
      null,
      2
    )
    returning id into v_habit_steps_id;

    insert into public.habits (
      user_id, goal_id, title, description, icon_name, color_token,
      cadence, target_per_week, preferred_slot, reminder_time, sort_order
    )
    values (
      v_owner_id,
      null,
      'Чтение 20 минут',
      'Спокойное чтение книги или научной статьи без телефона',
      'book-open',
      'domain-tasks',
      'daily',
      7,
      'evening',
      null,
      3
    )
    returning id into v_habit_reading_id;

    insert into public.habits (
      user_id, goal_id, title, description, icon_name, color_token,
      cadence, target_per_week, preferred_slot, reminder_time, sort_order
    )
    values (
      v_owner_id,
      v_goal_health_id,
      'Силовая / разминка',
      '3 силовые тренировки в неделю по плавающему окну или суставная мобилизация',
      'dumbbell',
      'domain-health',
      'weekly_target',
      3,
      'evening',
      null,
      4
    )
    returning id into v_habit_workout_id;

    insert into public.habits (
      user_id, goal_id, title, description, icon_name, color_token,
      cadence, target_per_week, preferred_slot, reminder_time, sort_order
    )
    values (
      v_owner_id,
      null,
      'Вечерний разбор дня',
      'Чекин энергии, 3 плюса дня и фокус на завтра до 22:00',
      'moon',
      'accent-primary',
      'daily',
      7,
      'evening',
      '21:15'::time,
      5
    )
    returning id into v_habit_review_id;

    -- Populate 18 days of realistic habit_logs (offsets 17 down to 0, where 0 is today)
    for v_offset in reverse 17..0 loop
      v_d := v_anchor_date - v_offset;

      -- Water: strong 7-day active streak (offsets 0..6 all done) + realistic earlier days
      if v_offset <= 6 or (v_offset % 4 <> 0) then
        insert into public.habit_logs (user_id, habit_id, logged_date, completed, source)
        values (v_owner_id, v_habit_water_id, v_d, true, 'web')
        on conflict (habit_id, logged_date) do nothing;
      end if;

      -- 10k steps: 4-day streak up to yesterday (offsets 1..4 done, today still open for 1-tap demo!)
      if (v_offset between 1 and 4) or (v_offset > 5 and v_offset % 3 <> 0) then
        insert into public.habit_logs (user_id, habit_id, logged_date, completed, source)
        values (v_owner_id, v_habit_steps_id, v_d, true, 'web')
        on conflict (habit_id, logged_date) do nothing;
      end if;

      -- Reading 20m: done today + steady ~70% adherence
      if v_offset = 0 or v_offset in (1, 2, 4, 5, 7, 8, 9, 11, 13, 14, 16) then
        insert into public.habit_logs (user_id, habit_id, logged_date, completed, source)
        values (v_owner_id, v_habit_reading_id, v_d, true, 'web')
        on conflict (habit_id, logged_date) do nothing;
      end if;

      -- Workout (3x/week): ~every 2-3 days
      if v_offset in (1, 3, 6, 8, 10, 13, 15) then
        insert into public.habit_logs (user_id, habit_id, logged_date, completed, source, note)
        values (v_owner_id, v_habit_workout_id, v_d, true, 'web', 'По программе')
        on conflict (habit_id, logged_date) do nothing;
      end if;

      -- Evening review: occasional drop-off on busy evenings so analytics look real
      if v_offset in (1, 2, 5, 6, 8, 11, 12, 15, 16) then
        insert into public.habit_logs (user_id, habit_id, logged_date, completed, source)
        values (v_owner_id, v_habit_review_id, v_d, true, 'telegram')
        on conflict (habit_id, logged_date) do nothing;
      end if;
    end loop;
  end if;
end $$;
