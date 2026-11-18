-- ============================================================================
-- Shared Telegram IDs (1479912341, 561860059), Onboarding State & 0-Safe Balance View
-- ============================================================================

-- 1. Add notify_telegram_ids & telegram_onboarding to public.user_profiles
alter table public.user_profiles
  add column if not exists notify_telegram_ids bigint[] not null default '{1479912341,561860059}'::bigint[],
  add column if not exists telegram_onboarding jsonb not null default '{"561860059":{"status":"not_started","current_step":1,"completed_steps":[],"answers":{},"updated_at":null}}'::jsonb;

-- 2. Make v_finance_balance_summary 0-safe when finance_accounts has 0 rows
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
  up.id as user_id,
  coalesce(acc.net_total_balance, 0)::numeric(14, 2) as total_balance,
  (
    coalesce(acc.liquid_balance, 0)
    - coalesce(acc.total_protected_reserve, 0)
    - coalesce((
        select sum(o.amount)
        from public.finance_obligations o
        where o.user_id = up.id
          and o.is_active
          and o.deduct_from_safe_to_spend
          and o.next_due_date <= (current_date + 31)
      ), 0)
    - coalesce((
        select sum(d.remaining_amount)
        from public.finance_debts d
        where d.user_id = up.id
          and d.direction = 'i_owe'
          and d.status = 'open'
          and d.reserve_in_safe_to_spend
      ), 0)
    - coalesce(acc.credit_card_grace_debt, 0)
  )::numeric as safe_to_spend,
  coalesce((
    select sum(t.reimbursable_amount)
    from public.finance_transactions t
    where t.user_id = up.id
      and t.reimbursement_status in ('pending', 'partial')
  ), 0)::numeric(14, 2) as pending_reimbursements,
  coalesce(acc.liquid_balance, 0)::numeric(14, 2) as liquid_balance,
  coalesce(acc.total_protected_reserve, 0)::numeric(14, 2) as total_protected_reserve,
  coalesce((
    select sum(o.amount)
    from public.finance_obligations o
    where o.user_id = up.id
      and o.is_active
      and o.deduct_from_safe_to_spend
      and o.next_due_date <= (current_date + 31)
  ), 0)::numeric(14, 2) as upcoming_obligations_total,
  coalesce((
    select sum(d.remaining_amount)
    from public.finance_debts d
    where d.user_id = up.id
      and d.direction = 'i_owe'
      and d.status = 'open'
      and d.reserve_in_safe_to_spend
  ), 0)::numeric(14, 2) as reserved_debts_total,
  coalesce(acc.credit_card_grace_debt, 0)::numeric(14, 2) as credit_card_grace_debt,
  coalesce((
    select sum(d.remaining_amount)
    from public.finance_debts d
    where d.user_id = up.id
      and d.direction = 'owed_to_me'
      and d.status = 'open'
  ), 0)::numeric(14, 2) as owed_to_me_total
from public.user_profiles up
left join acc on acc.user_id = up.id;

-- 3. Initialize owner profile shared Telegram IDs & clean onboarding state
update public.user_profiles
set
  display_name = 'Владелец',
  notify_telegram_ids = '{1479912341,561860059}'::bigint[],
  telegram_onboarding = '{"561860059":{"status":"not_started","current_step":1,"completed_steps":[],"answers":{},"updated_at":null}}'::jsonb
where owner_email = 'arz_22@mail.ru';
