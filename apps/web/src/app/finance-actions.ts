"use server";

import { revalidatePath } from "next/cache";
import {
  createFinanceAccount,
  createFinanceCategory,
  createFinanceDebt,
  createFinanceObligation,
  createFinanceTransaction,
  deleteFinanceCategory,
  deleteFinanceDebt,
  deleteFinanceObligation,
  deleteFinanceTransaction,
  deleteOrArchiveFinanceAccount,
  getFinanceAnalytics,
  getPrimaryFinanceAccount,
  listFinanceCategories,
  markObligationPaid,
  recordDebtPayment,
  setBalanceViewMode,
  settleReimbursement,
  updateFinanceAccount,
  updateFinanceCategory,
  updateFinanceDebt,
  updateFinanceObligation,
  updateFinanceTransaction,
  type BalanceViewMode,
  type BillingPeriod,
  type DebtDirection,
  type FinanceAccountType,
  type FinanceCategoryKind,
  type FinanceMonthlyAnalytics,
  type FinanceObligationKind,
  type FinanceTransactionKind,
  type SpendNature,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";

function revalidateFinanceAndHome() {
  revalidatePath("/", "layout");
}

// ============================================================================
// Balance Mode & Monthly Analytics Fetcher
// ============================================================================

export async function setBalanceViewModeAction(mode: BalanceViewMode) {
  const { db, userId } = await requireOwnerSession();
  await setBalanceViewMode(db, userId, mode);
  revalidateFinanceAndHome();
}

export async function fetchFinanceMonthAnalyticsAction(
  monthStr: string
): Promise<FinanceMonthlyAnalytics> {
  const { db } = await requireOwnerSession();
  return getFinanceAnalytics(db, monthStr, "Europe/Moscow");
}

// ============================================================================
// Transactions & Reimbursements
// ============================================================================

export interface SaveFinanceTransactionPayload {
  id?: number;
  account_id?: number | null;
  new_account_name?: string | null;
  to_account_id?: number | null;
  category_id?: number | null;
  new_category_name?: string | null;
  kind: FinanceTransactionKind;
  amount: number;
  occurred_at?: string | null;
  description?: string | null;
  spend_nature?: SpendNature;
  personal_share_amount?: number | null;
  reimbursable_amount?: number | null;
  reimbursement_counterparty?: string | null;
  tags?: string[];
}

export async function saveFinanceTransactionAction(
  payload: SaveFinanceTransactionPayload
) {
  const { db, userId } = await requireOwnerSession();
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Укажи сумму больше нуля");
  }

  let accountId = payload.account_id ?? null;
  if (!accountId) {
    const requestedAccName = payload.new_account_name?.trim();
    const primary = await getPrimaryFinanceAccount(db);
    if (primary && !requestedAccName) {
      accountId = primary.id;
    } else {
      const createdAcc = await createFinanceAccount(db, {
        user_id: userId,
        name: requestedAccName || "Основной счёт",
        account_type: "debit",
        balance: 0,
        currency: "RUB",
        credit_limit: null,
        statement_debt: 0,
        grace_period_due_date: null,
        protected_reserve: 0,
        include_in_total: true,
        include_in_safe_to_spend: true,
      });
      accountId = createdAcc.id;
    }
  }

  if (payload.kind === "transfer") {
    if (!payload.to_account_id || payload.to_account_id === accountId) {
      throw new Error("Выбери другой счёт получателя для перевода");
    }
  }

  let resolvedCategoryId: number | null =
    payload.kind === "transfer" ? null : payload.category_id ?? null;
  const inlineCategoryName = payload.new_category_name?.trim();

  if (payload.kind !== "transfer" && !resolvedCategoryId && inlineCategoryName) {
    const targetCatKind: FinanceCategoryKind =
      payload.kind === "income" || payload.kind === "reimbursement_in"
        ? "income"
        : "expense";
    const existingCats = await listFinanceCategories(db, targetCatKind, true);
    const matched = existingCats.find(
      (c) => c.name.trim().toLowerCase() === inlineCategoryName.toLowerCase()
    );
    if (matched) {
      if (matched.is_archived) {
        await updateFinanceCategory(db, matched.id, { is_archived: false });
      }
      resolvedCategoryId = matched.id;
    } else {
      const createdCat = await createFinanceCategory(db, {
        user_id: userId,
        kind: targetCatKind,
        name: inlineCategoryName,
        icon_name: "receipt",
        color_token: "domain-finance",
        monthly_limit: null,
        voice_aliases: [],
      });
      resolvedCategoryId = createdCat.id;
    }
  }

  const spendNature: SpendNature =
    payload.kind === "expense" ? payload.spend_nature ?? "personal" : "personal";

  let personalShare: number | null = amount;
  let reimbursableAmount = 0;

  if (payload.kind === "expense") {
    if (spendNature === "work_reimbursable") {
      personalShare = 0;
      reimbursableAmount = amount;
    } else if (spendNature === "shared_reimbursable") {
      const explicitPersonal =
        payload.personal_share_amount !== undefined &&
        payload.personal_share_amount !== null
          ? Math.max(0, Math.min(amount, Number(payload.personal_share_amount)))
          : Math.round((amount / 2) * 100) / 100;
      personalShare = explicitPersonal;
      reimbursableAmount =
        payload.reimbursable_amount !== undefined &&
        payload.reimbursable_amount !== null
          ? Math.max(0, Math.min(amount, Number(payload.reimbursable_amount)))
          : Math.max(0, Math.round((amount - explicitPersonal) * 100) / 100);
    }
  } else {
    personalShare = null;
    reimbursableAmount = 0;
  }

  const cleanTags = (payload.tags ?? [])
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);

  const occurredIso = payload.occurred_at
    ? new Date(payload.occurred_at).toISOString()
    : new Date().toISOString();

  const common = {
    account_id: accountId,
    to_account_id:
      payload.kind === "transfer" ? payload.to_account_id ?? null : null,
    category_id: resolvedCategoryId,
    kind: payload.kind,
    amount,
    occurred_at: occurredIso,
    description: payload.description?.trim() || null,
    spend_nature: spendNature,
    personal_share_amount: personalShare,
    reimbursable_amount: reimbursableAmount,
    reimbursement_counterparty:
      spendNature !== "personal"
        ? payload.reimbursement_counterparty?.trim() || null
        : null,
    tags: cleanTags,
  };

  if (payload.id) {
    await updateFinanceTransaction(db, payload.id, common);
  } else {
    await createFinanceTransaction(db, {
      user_id: userId,
      ...common,
      currency: "RUB",
      source: "web",
    });
  }

  revalidateFinanceAndHome();
}

export async function deleteFinanceTransactionAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteFinanceTransaction(db, id);
  revalidateFinanceAndHome();
}

export async function settleReimbursementAction(payload: {
  expenseTransactionId: number;
  targetAccountId?: number | null;
  receivedAmount?: number | null;
  note?: string | null;
}) {
  const { db } = await requireOwnerSession();
  await settleReimbursement(db, {
    expenseTransactionId: payload.expenseTransactionId,
    targetAccountId: payload.targetAccountId ?? undefined,
    receivedAmount: payload.receivedAmount ?? undefined,
    note: payload.note?.trim() || undefined,
    source: "web",
  });
  revalidateFinanceAndHome();
}

// ============================================================================
// Accounts & Credit Cards
// ============================================================================

export async function saveFinanceAccountAction(payload: {
  id?: number;
  name: string;
  account_type: FinanceAccountType;
  balance?: number;
  credit_limit?: number | null;
  statement_debt?: number | null;
  grace_period_due_date?: string | null;
  protected_reserve?: number;
  include_in_total?: boolean;
  include_in_safe_to_spend?: boolean;
}) {
  const { db, userId } = await requireOwnerSession();
  const name = payload.name.trim();
  if (!name) throw new Error("Укажи название счёта");

  const isCredit = payload.account_type === "credit_card";
  const debt = isCredit ? Math.max(0, Number(payload.statement_debt ?? 0)) : 0;
  const balance = isCredit ? -debt : Number(payload.balance ?? 0);

  const common = {
    name,
    account_type: payload.account_type,
    balance,
    credit_limit: isCredit ? Number(payload.credit_limit ?? 0) : null,
    statement_debt: isCredit ? debt : 0,
    grace_period_due_date:
      isCredit && payload.grace_period_due_date
        ? payload.grace_period_due_date
        : null,
    protected_reserve: isCredit
      ? 0
      : Math.max(0, Number(payload.protected_reserve ?? 0)),
    include_in_total: payload.include_in_total ?? true,
    include_in_safe_to_spend: isCredit
      ? false
      : payload.include_in_safe_to_spend ?? true,
  };

  if (payload.id) {
    await updateFinanceAccount(db, payload.id, common);
  } else {
    await createFinanceAccount(db, {
      user_id: userId,
      currency: "RUB",
      ...common,
    });
  }

  revalidateFinanceAndHome();
}

export async function deleteFinanceAccountAction(id: number) {
  const { db } = await requireOwnerSession();
  const res = await deleteOrArchiveFinanceAccount(db, id);
  revalidateFinanceAndHome();
  return res.mode;
}

// ============================================================================
// Obligations & Subscriptions
// ============================================================================

export async function saveFinanceObligationAction(payload: {
  id?: number;
  title: string;
  obligation_kind: FinanceObligationKind;
  amount: number;
  billing_period: BillingPeriod;
  next_due_date: string;
  account_id?: number | null;
  category_id?: number | null;
  deduct_from_safe_to_spend?: boolean;
  remind_days_before?: number;
  is_active?: boolean;
}) {
  const { db, userId } = await requireOwnerSession();
  const title = payload.title.trim();
  if (!title) throw new Error("Укажи название платежа или подписки");
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Укажи сумму платежа больше нуля");
  }

  const common = {
    title,
    obligation_kind: payload.obligation_kind,
    amount,
    billing_period: payload.billing_period,
    next_due_date: payload.next_due_date,
    account_id: payload.account_id || null,
    category_id: payload.category_id || null,
    deduct_from_safe_to_spend: payload.deduct_from_safe_to_spend ?? true,
    remind_days_before: Math.max(
      0,
      Math.min(30, Number(payload.remind_days_before ?? 2))
    ),
    is_active: payload.is_active ?? true,
  };

  if (payload.id) {
    await updateFinanceObligation(db, payload.id, common);
  } else {
    await createFinanceObligation(db, {
      user_id: userId,
      currency: "RUB",
      ...common,
    });
  }

  revalidateFinanceAndHome();
}

export async function markObligationPaidAction(payload: {
  id: number;
  accountId?: number | null;
}) {
  const { db } = await requireOwnerSession();
  await markObligationPaid(db, payload.id, {
    accountId: payload.accountId ?? undefined,
    source: "web",
  });
  revalidateFinanceAndHome();
}

export async function deleteFinanceObligationAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteFinanceObligation(db, id);
  revalidateFinanceAndHome();
}

// ============================================================================
// Debts & Receivables
// ============================================================================

export async function saveFinanceDebtAction(payload: {
  id?: number;
  direction: DebtDirection;
  counterparty: string;
  title: string;
  initial_amount: number;
  remaining_amount?: number;
  due_date?: string | null;
  reserve_in_safe_to_spend?: boolean;
  notes?: string | null;
}) {
  const { db, userId } = await requireOwnerSession();
  const counterparty = payload.counterparty.trim();
  const title = payload.title.trim();
  if (!counterparty || !title) {
    throw new Error("Укажи контрагента и суть долга");
  }
  const initialAmount = Number(payload.initial_amount);
  if (!Number.isFinite(initialAmount) || initialAmount <= 0) {
    throw new Error("Укажи сумму больше нуля");
  }
  const remainingAmount =
    payload.remaining_amount !== undefined
      ? Math.max(0, Number(payload.remaining_amount))
      : initialAmount;

  const common = {
    direction: payload.direction,
    counterparty,
    title,
    initial_amount: initialAmount,
    remaining_amount: remainingAmount,
    due_date: payload.due_date || null,
    reserve_in_safe_to_spend:
      payload.direction === "i_owe"
        ? Boolean(payload.reserve_in_safe_to_spend)
        : false,
    status: (remainingAmount <= 0 ? "closed" : "open") as "open" | "closed",
    notes: payload.notes?.trim() || null,
  };

  if (payload.id) {
    await updateFinanceDebt(db, payload.id, common);
  } else {
    await createFinanceDebt(db, {
      user_id: userId,
      currency: "RUB",
      ...common,
    });
  }

  revalidateFinanceAndHome();
}

export async function recordDebtPaymentAction(payload: {
  id: number;
  amount: number;
  accountId?: number | null;
  note?: string | null;
}) {
  const { db } = await requireOwnerSession();
  await recordDebtPayment(db, payload.id, {
    amount: Number(payload.amount),
    accountId: payload.accountId ?? undefined,
    note: payload.note?.trim() || undefined,
    source: "web",
  });
  revalidateFinanceAndHome();
}

export async function deleteFinanceDebtAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteFinanceDebt(db, id);
  revalidateFinanceAndHome();
}

// ============================================================================
// Categories & Voice Aliases
// ============================================================================

export async function saveFinanceCategoryAction(payload: {
  id?: number;
  kind: FinanceCategoryKind;
  name: string;
  color_token?: string;
  monthly_limit?: number | null;
  voice_aliases?: string[];
}) {
  const { db, userId } = await requireOwnerSession();
  const name = payload.name.trim();
  if (!name) throw new Error("Укажи название категории");

  const cleanAliases = (payload.voice_aliases ?? [])
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

  const common = {
    kind: payload.kind,
    name,
    color_token: payload.color_token || "domain-finance",
    monthly_limit:
      payload.monthly_limit && Number(payload.monthly_limit) > 0
        ? Number(payload.monthly_limit)
        : null,
    voice_aliases: cleanAliases,
  };

  if (payload.id) {
    await updateFinanceCategory(db, payload.id, common);
  } else {
    await createFinanceCategory(db, {
      user_id: userId,
      icon_name: "receipt",
      ...common,
    });
  }

  revalidateFinanceAndHome();
}

export async function deleteFinanceCategoryAction(id: number) {
  const { db } = await requireOwnerSession();
  await deleteFinanceCategory(db, id);
  revalidateFinanceAndHome();
}
