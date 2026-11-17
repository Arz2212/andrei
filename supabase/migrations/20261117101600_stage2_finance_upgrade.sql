-- ============================================================================
-- Stage 2 Finance Upgrade: Schema, Realtime, Reminders & Safe-to-Spend View
-- ============================================================================

-- 1. Widen reminders_queue entity_type for Finance notifications
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
      'debt_due'
    )
  );

-- 2. Add Realtime publication for remaining Finance tables
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'finance_categories'
  ) then
    alter publication supabase_realtime add table public.finance_categories;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'finance_obligations'
  ) then
    alter publication supabase_realtime add table public.finance_obligations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'finance_debts'
  ) then
    alter publication supabase_realtime add table public.finance_debts;
  end if;
end $$;

-- 3. Enrich finance_categories & finance_transactions
alter table public.finance_categories
  add column if not exists color_token text not null default 'domain-finance';

alter table public.finance_transactions
  add column if not exists tags text[] not null default '{}',
  add column if not exists original_reimbursable_amount numeric(14, 2) not null default 0
    check (original_reimbursable_amount >= 0);

alter table public.finance_transactions
  drop constraint if exists finance_transactions_source_check,
  add constraint finance_transactions_source_check check (
    source in ('web', 'telegram_voice', 'telegram_text', 'telegram_photo', 'mcp', 'openclaw')
  );

-- 4. Upgrade v_finance_balance_summary (security_invoker = true) with full formula breakdown
create or replace view public.v_finance_balance_summary
with (security_invoker = true)
as
with acc as (
  select
    a.user_id,
    coalesce(sum(
      case
        when a.include_in_total and not a.is_archived then
          case
            when a.account_type = 'credit_card' then -coalesce(a.statement_debt, 0)
            else a.balance
          end
        else 0
      end
    ), 0)::numeric(14, 2) as net_total_balance,
    coalesce(sum(
      case
        when a.include_in_safe_to_spend and not a.is_archived and a.account_type in ('debit', 'cash', 'savings')
          then a.balance
        else 0
      end
    ), 0)::numeric(14, 2) as liquid_balance,
    coalesce(sum(
      case
        when a.include_in_safe_to_spend and not a.is_archived and a.account_type in ('debit', 'cash', 'savings')
          then a.protected_reserve
        else 0
      end
    ), 0)::numeric(14, 2) as total_protected_reserve,
    coalesce(sum(
      case
        when not a.is_archived
          and a.account_type = 'credit_card'
          and coalesce(a.statement_debt, 0) > 0
          and (a.grace_period_due_date is null or a.grace_period_due_date <= (current_date + 35))
          then coalesce(a.statement_debt, 0)
        else 0
      end
    ), 0)::numeric(14, 2) as credit_card_grace_debt
  from public.finance_accounts a
  group by a.user_id
)
select
  acc.user_id,
  acc.net_total_balance as total_balance,
  (
    acc.liquid_balance
    - acc.total_protected_reserve
    - coalesce((
        select sum(o.amount)
        from public.finance_obligations o
        where o.user_id = acc.user_id
          and o.is_active
          and o.deduct_from_safe_to_spend
          and o.next_due_date <= (current_date + 31)
      ), 0)
    - coalesce((
        select sum(d.remaining_amount)
        from public.finance_debts d
        where d.user_id = acc.user_id
          and d.direction = 'i_owe'
          and d.status = 'open'
          and d.reserve_in_safe_to_spend
      ), 0)
    - acc.credit_card_grace_debt
  )::numeric as safe_to_spend,
  coalesce((
    select sum(t.reimbursable_amount)
    from public.finance_transactions t
    where t.user_id = acc.user_id
      and t.reimbursement_status in ('pending', 'partial')
  ), 0)::numeric(14, 2) as pending_reimbursements,
  acc.liquid_balance,
  acc.total_protected_reserve,
  coalesce((
    select sum(o.amount)
    from public.finance_obligations o
    where o.user_id = acc.user_id
      and o.is_active
      and o.deduct_from_safe_to_spend
      and o.next_due_date <= (current_date + 31)
  ), 0)::numeric(14, 2) as upcoming_obligations_total,
  coalesce((
    select sum(d.remaining_amount)
    from public.finance_debts d
    where d.user_id = acc.user_id
      and d.direction = 'i_owe'
      and d.status = 'open'
      and d.reserve_in_safe_to_spend
  ), 0)::numeric(14, 2) as reserved_debts_total,
  acc.credit_card_grace_debt,
  coalesce((
    select sum(d.remaining_amount)
    from public.finance_debts d
    where d.user_id = acc.user_id
      and d.direction = 'owed_to_me'
      and d.status = 'open'
  ), 0)::numeric(14, 2) as owed_to_me_total
from acc;
