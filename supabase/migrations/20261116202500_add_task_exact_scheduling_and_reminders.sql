-- ============================================================================
-- Stage 1 Hotfix: Exact-Time Scheduling, Meetings, Conflict Index & Reminders
-- ============================================================================

alter table public.tasks
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists is_meeting boolean not null default false,
  add column if not exists remind_before_minutes integer,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists reminder_snoozed_until timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_remind_before_minutes_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_remind_before_minutes_check
      check (remind_before_minutes is null or remind_before_minutes between 0 and 1440);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_scheduled_range_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_scheduled_range_check
      check (
        scheduled_end_at is null
        or (scheduled_start_at is not null and scheduled_end_at >= scheduled_start_at)
      );
  end if;
end $$;

create or replace function public.tasks_sync_schedule_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.scheduled_start_at is null then
    new.scheduled_end_at := null;
    new.reminder_sent_at := null;
    new.reminder_snoozed_until := null;
  else
    if new.scheduled_end_at is null or new.scheduled_end_at < new.scheduled_start_at then
      new.scheduled_end_at := new.scheduled_start_at + make_interval(
        mins => coalesce(new.estimated_minutes, case when new.is_meeting then 60 else 30 end)
      );
    end if;

    if tg_op = 'UPDATE' then
      if (
        new.scheduled_start_at is distinct from old.scheduled_start_at
        or new.remind_before_minutes is distinct from old.remind_before_minutes
      ) and new.reminder_sent_at is not distinct from old.reminder_sent_at then
        new.reminder_sent_at := null;
        new.reminder_snoozed_until := null;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger tasks_sync_schedule_fields_trg
  before insert or update on public.tasks
  for each row execute function public.tasks_sync_schedule_fields();

create index if not exists tasks_upcoming_reminders_idx
  on public.tasks (user_id, scheduled_start_at)
  where status not in ('done', 'cancelled')
    and scheduled_start_at is not null
    and reminder_sent_at is null;

create index if not exists tasks_user_scheduled_range_idx
  on public.tasks (user_id, scheduled_start_at, scheduled_end_at)
  where status not in ('done', 'cancelled')
    and scheduled_start_at is not null;
