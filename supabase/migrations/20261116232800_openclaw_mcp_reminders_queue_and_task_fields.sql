-- ============================================================================
-- OpenClaw MCP + Notifier Migration: reminders_queue + full Task & Pulse parity
-- ============================================================================

create table if not exists public.reminders_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (
    entity_type in (
      'task_start',
      'waiting_followup',
      'standalone_reminder',
      'morning_digest',
      'evening_review'
    )
  ),
  entity_id text,
  trigger_at timestamptz not null,
  message_text text not null,
  status text not null default 'pending' check (
    status in ('pending', 'sent', 'cancelled', 'failed')
  ),
  telegram_chat_id bigint not null default 1479912341,
  sent_at timestamptz,
  error_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger reminders_queue_set_updated_at
  before update on public.reminders_queue
  for each row execute function public.set_updated_at();

create index if not exists reminders_queue_user_status_trigger_idx
  on public.reminders_queue (user_id, status, trigger_at);

create index if not exists reminders_queue_pending_trigger_idx
  on public.reminders_queue (trigger_at)
  where status = 'pending';

create index if not exists reminders_queue_pending_entity_idx
  on public.reminders_queue (user_id, entity_type, entity_id)
  where status = 'pending';

alter table public.reminders_queue enable row level security;

create policy "reminders_queue_select_own" on public.reminders_queue
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "reminders_queue_insert_own" on public.reminders_queue
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "reminders_queue_update_own" on public.reminders_queue
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "reminders_queue_delete_own" on public.reminders_queue
  for delete to authenticated
  using ((select auth.uid()) = user_id);

alter publication supabase_realtime add table public.reminders_queue;

-- Enrich public.tasks for 100% Web + OpenClaw MCP parity
alter table public.tasks
  add column if not exists tags text[] not null default '{}',
  add column if not exists subtasks jsonb not null default '[]'::jsonb,
  add column if not exists remind_offsets_minutes integer[] not null default '{}',
  add column if not exists recurrence_rule text;

alter table public.tasks
  drop constraint if exists tasks_source_check,
  add constraint tasks_source_check check (
    source in ('web', 'telegram', 'mcp', 'openclaw')
  );

-- Widen public.state_checkins scores to 1..10 (preserving existing 1..5 rows)
alter table public.state_checkins
  drop constraint if exists state_checkins_mood_score_check,
  add constraint state_checkins_mood_score_check check (mood_score between 1 and 10),
  drop constraint if exists state_checkins_energy_score_check,
  add constraint state_checkins_energy_score_check check (energy_score between 1 and 10),
  drop constraint if exists state_checkins_tension_score_check,
  add constraint state_checkins_tension_score_check check (
    tension_score is null or tension_score between 1 and 10
  ),
  drop constraint if exists state_checkins_source_check,
  add constraint state_checkins_source_check check (
    source in ('web', 'telegram', 'mcp', 'openclaw')
  );
