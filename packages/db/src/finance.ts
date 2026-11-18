import type { Json } from "./database.types";
import {
  cancelEntityRemindersInQueue,
  escapeTelegramHtml,
  resolveDefaultTelegramChatId,
} from "./reminders";
import {
  addDaysToIsoDate,
  formatIsoDate,
  getFinanceBalanceSummary,
  getOwnerProfile,
  localClockToUtcIso,
  normalizeTaskTitleForDedup,
  updateOwnerProfile,
} from "./repositories";
import type {
  BalanceViewMode,
  BillingPeriod,
  DebtStatus,
  FinanceAccount,
  FinanceAccountInsert,
  FinanceAccountType,
  FinanceAccountUpdate,
  FinanceBalanceSummary,
  FinanceCategory,
  FinanceCategoryAnalyticsItem,
  FinanceCategoryInsert,
  FinanceCategoryKind,
  FinanceCategoryUpdate,
  FinanceDebt,
  FinanceDebtInsert,
  FinanceDebtUpdate,
  FinanceMonthlyAnalytics,
  FinanceObligation,
  FinanceObligationInsert,
  FinanceObligationUpdate,
  FinanceTransaction,
  FinanceTransactionInsert,
  FinanceTransactionKind,
  FinanceTransactionSource,
  FinanceTransactionUpdate,
  FuzzyFinanceMatch,
  ReimbursementStatus,
  SpendNature,
  TypedSupabaseClient,
  UserProfile,
} from "./types";

function roundMoney(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function formatMoneyRu(amount: number, currency = "RUB"): string {
  const formatted = roundMoney(amount).toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(roundMoney(amount)) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const sym = currency === "RUB" ? "₽" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency;
  return `${formatted} ${sym}`;
}

export function advanceBillingDateIso(currentDueDate: string, period: BillingPeriod): string {
  const [y, m, d] = currentDueDate.split("-").map(Number);
  if (period === "weekly") {
    return addDaysToIsoDate(currentDueDate, 7);
  }
  const addMonths = period === "monthly" ? 1 : period === "quarterly" ? 3 : 12;
  const targetMonthIndex = m - 1 + addMonths;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const maxDayInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, maxDayInTargetMonth);
  const dt = new Date(Date.UTC(targetYear, targetMonth, clampedDay, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

// ============================================================================
// Finance Queue Reminder Sync Helpers (Obligations, Credit Card Grace, Debts)
// ============================================================================

export async function syncCreditCardGraceReminderToQueue(
  db: TypedSupabaseClient,
  account: FinanceAccount,
  timeZone = "Europe/Moscow"
): Promise<void> {
  const entityId = String(account.id);
  await cancelEntityRemindersInQueue(db, entityId, ["credit_grace"]);

  const debt = Number(account.statement_debt ?? 0);
  if (
    account.is_archived ||
    account.account_type !== "credit_card" ||
    !account.grace_period_due_date ||
    debt <= 0
  ) {
    return;
  }

  const warnDate = addDaysToIsoDate(account.grace_period_due_date, -3);
  const todayStr = formatIsoDate(new Date(), timeZone);
  const triggerDate = warnDate >= todayStr ? warnDate : account.grace_period_due_date;
  const triggerAt = localClockToUtcIso(triggerDate, "10:00", timeZone);

  if (Date.parse(account.grace_period_due_date + "T23:59:59Z") < Date.now() - 24 * 60 * 60_000) {
    return;
  }

  const msg =
    `💳 <b>Грейс-период по кредитке до ${escapeTelegramHtml(account.grace_period_due_date)}</b>\n\n` +
    `📌 <b>${escapeTelegramHtml(account.name)}</b>\n` +
    `К погашению без процентов: <b>${escapeTelegramHtml(formatMoneyRu(debt, account.currency))}</b>`;

  const { error } = await db.from("reminders_queue").insert({
    user_id: account.user_id,
    entity_type: "credit_grace",
    entity_id: entityId,
    trigger_at: triggerAt,
    message_text: msg,
    status: "pending",
    telegram_chat_id: resolveDefaultTelegramChatId(),
    metadata: {
      account_id: account.id,
      grace_period_due_date: account.grace_period_due_date,
      statement_debt: debt,
    } as Json,
  });
  if (error) throw error;
}

export async function syncObligationReminderToQueue(
  db: TypedSupabaseClient,
  obligation: FinanceObligation,
  timeZone = "Europe/Moscow"
): Promise<void> {
  const entityId = String(obligation.id);
  await cancelEntityRemindersInQueue(db, entityId, ["finance_obligation"]);

  if (!obligation.is_active || !obligation.next_due_date) {
    return;
  }

  const leadDays = Math.max(0, Number(obligation.remind_days_before ?? 2));
  const targetDate = addDaysToIsoDate(obligation.next_due_date, -leadDays);
  const todayStr = formatIsoDate(new Date(), timeZone);
  const effectiveDate =
    targetDate >= todayStr
      ? targetDate
      : obligation.next_due_date >= todayStr
        ? obligation.next_due_date
        : null;

  if (!effectiveDate) return;

  const triggerAt = localClockToUtcIso(effectiveDate, "10:00", timeZone);
  const kindLabel =
    obligation.obligation_kind === "subscription"
      ? "Подписка"
      : obligation.obligation_kind === "loan_installment"
        ? "Платёж по кредиту"
        : "Обязательный платёж";

  const msg =
    `📅 <b>${kindLabel} (${escapeTelegramHtml(obligation.next_due_date)})</b>\n\n` +
    `📌 <b>${escapeTelegramHtml(obligation.title)}</b> — <b>${escapeTelegramHtml(
      formatMoneyRu(Number(obligation.amount), obligation.currency)
    )}</b>`;

  const { error } = await db.from("reminders_queue").insert({
    user_id: obligation.user_id,
    entity_type: "finance_obligation",
    entity_id: entityId,
    trigger_at: triggerAt,
    message_text: msg,
    status: "pending",
    telegram_chat_id: resolveDefaultTelegramChatId(),
    metadata: {
      obligation_id: obligation.id,
      next_due_date: obligation.next_due_date,
      amount: Number(obligation.amount),
    } as Json,
  });
  if (error) throw error;
}

export async function syncDebtReminderToQueue(
  db: TypedSupabaseClient,
  debt: FinanceDebt,
  timeZone = "Europe/Moscow"
): Promise<void> {
  const entityId = String(debt.id);
  await cancelEntityRemindersInQueue(db, entityId, ["debt_due"]);

  const rem = Number(debt.remaining_amount ?? 0);
  if (debt.status !== "open" || !debt.due_date || rem <= 0) {
    return;
  }

  const warnDate = addDaysToIsoDate(debt.due_date, -1);
  const todayStr = formatIsoDate(new Date(), timeZone);
  const effectiveDate =
    warnDate >= todayStr ? warnDate : debt.due_date >= todayStr ? debt.due_date : null;
  if (!effectiveDate) return;

  const triggerAt = localClockToUtcIso(effectiveDate, "10:00", timeZone);
  const dirLabel =
    debt.direction === "i_owe"
      ? `Срок возврата долга (${escapeTelegramHtml(debt.counterparty)})`
      : `Ожидается возврат долга от ${escapeTelegramHtml(debt.counterparty)}`;

  const msg =
    `🤝 <b>${dirLabel} · ${escapeTelegramHtml(debt.due_date)}</b>\n\n` +
    `📌 <b>${escapeTelegramHtml(debt.title)}</b> — остаток <b>${escapeTelegramHtml(
      formatMoneyRu(rem, debt.currency)
    )}</b>`;

  const { error } = await db.from("reminders_queue").insert({
    user_id: debt.user_id,
    entity_type: "debt_due",
    entity_id: entityId,
    trigger_at: triggerAt,
    message_text: msg,
    status: "pending",
    telegram_chat_id: resolveDefaultTelegramChatId(),
    metadata: {
      debt_id: debt.id,
      direction: debt.direction,
      due_date: debt.due_date,
      remaining_amount: rem,
    } as Json,
  });
  if (error) throw error;
}

// ============================================================================
// Accounts & Balance View Mode
// ============================================================================

export async function setBalanceViewMode(
  db: TypedSupabaseClient,
  userId: string,
  mode: BalanceViewMode
): Promise<UserProfile> {
  return updateOwnerProfile(db, userId, { balance_view_mode: mode });
}

export async function listFinanceAccounts(
  db: TypedSupabaseClient,
  includeArchived = false
): Promise<FinanceAccount[]> {
  let query = db
    .from("finance_accounts")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (!includeArchived) {
    query = query.eq("is_archived", false);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getFinanceAccount(
  db: TypedSupabaseClient,
  id: number
): Promise<FinanceAccount | null> {
  const { data, error } = await db
    .from("finance_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getPrimaryFinanceAccount(
  db: TypedSupabaseClient
): Promise<FinanceAccount | null> {
  const accounts = await listFinanceAccounts(db, false);
  if (accounts.length === 0) return null;
  return (
    accounts.find((a) => a.account_type === "debit" && a.include_in_safe_to_spend) ??
    accounts.find((a) => a.account_type === "debit") ??
    accounts.find((a) => a.account_type !== "credit_card") ??
    accounts[0]
  );
}

export async function createFinanceAccount(
  db: TypedSupabaseClient,
  input: FinanceAccountInsert
): Promise<FinanceAccount> {
  const prepared: FinanceAccountInsert = { ...input };
  if (prepared.account_type === "credit_card") {
    const debt = roundMoney(Math.max(0, Number(prepared.statement_debt ?? 0)));
    prepared.statement_debt = debt;
    if (prepared.balance === undefined || prepared.balance === 0) {
      prepared.balance = debt > 0 ? -debt : 0;
    }
    if (prepared.include_in_safe_to_spend === undefined) {
      prepared.include_in_safe_to_spend = false;
    }
  }

  const { data, error } = await db
    .from("finance_accounts")
    .insert(prepared)
    .select("*")
    .single();
  if (error) throw error;
  await syncCreditCardGraceReminderToQueue(db, data);
  return data;
}

export async function updateFinanceAccount(
  db: TypedSupabaseClient,
  id: number,
  patch: FinanceAccountUpdate
): Promise<FinanceAccount> {
  const existing = await getFinanceAccount(db, id);
  if (!existing) throw new Error("Счёт не найден");

  const nextType = (patch.account_type ?? existing.account_type) as FinanceAccountType;
  const prepared: FinanceAccountUpdate = { ...patch };

  if (nextType === "credit_card") {
    if (prepared.statement_debt !== undefined && prepared.balance === undefined) {
      const debt = roundMoney(Math.max(0, Number(prepared.statement_debt ?? 0)));
      prepared.statement_debt = debt;
      prepared.balance = debt > 0 ? -debt : 0;
    } else if (prepared.balance !== undefined && prepared.statement_debt === undefined) {
      const bal = roundMoney(Number(prepared.balance));
      prepared.statement_debt = bal < 0 ? roundMoney(-bal) : 0;
    }
  }

  const { data, error } = await db
    .from("finance_accounts")
    .update(prepared)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  await syncCreditCardGraceReminderToQueue(db, data);
  return data;
}

export async function deleteOrArchiveFinanceAccount(
  db: TypedSupabaseClient,
  id: number
): Promise<{ mode: "deleted" | "archived"; account?: FinanceAccount }> {
  await cancelEntityRemindersInQueue(db, String(id), ["credit_grace"]);

  const { count: txCount, error: countErr } = await db
    .from("finance_transactions")
    .select("id", { count: "exact", head: true })
    .or(`account_id.eq.${id},to_account_id.eq.${id}`);
  if (countErr) throw countErr;

  if ((txCount ?? 0) > 0) {
    const archived = await updateFinanceAccount(db, id, { is_archived: true });
    return { mode: "archived", account: archived };
  }

  const { error } = await db.from("finance_accounts").delete().eq("id", id);
  if (error) throw error;
  return { mode: "deleted" };
}

const ACCOUNT_TYPE_SYNONYMS: Record<FinanceAccountType, string[]> = {
  debit: ["дебет", "дебетовая", "карта", "основная", "т банк", "тинькофф", "сбер", "альфа"],
  cash: ["наличные", "кэш", "наличка", "кошелек"],
  savings: ["накопительный", "вклад", "резерв", "подушка", "сейф", "копилка"],
  credit_card: ["кредитка", "кредитная", "грейс"],
  investment: ["инвестиции", "брокер", "акции"],
};

export async function resolveAccountByFuzzyQuery(
  db: TypedSupabaseClient,
  query?: string | number | null
): Promise<{ account: FinanceAccount | null; matches: FuzzyFinanceMatch<FinanceAccount>[] }> {
  const accounts = await listFinanceAccounts(db, false);
  if (accounts.length === 0) return { account: null, matches: [] };

  if (query === undefined || query === null || String(query).trim() === "") {
    const primary = await getPrimaryFinanceAccount(db);
    return { account: primary, matches: primary ? [{ item: primary, score: 1 }] : [] };
  }

  if (typeof query === "number" || /^\d+$/.test(String(query).trim())) {
    const id = Number(query);
    const found = accounts.find((a) => a.id === id) ?? null;
    return { account: found, matches: found ? [{ item: found, score: 1 }] : [] };
  }

  const normQ = normalizeTaskTitleForDedup(String(query));
  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<FinanceAccount>[] = [];

  for (const acc of accounts) {
    const normName = normalizeTaskTitleForDedup(acc.name);
    let score = 0;
    if (normName === normQ) {
      score = 1.0;
    } else if (normName.includes(normQ) || (normQ.length >= 3 && normQ.includes(normName))) {
      score = 0.9;
    } else {
      const typeHints = ACCOUNT_TYPE_SYNONYMS[acc.account_type as FinanceAccountType] ?? [];
      const hay = `${normName} ${typeHints.join(" ")}`;
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      if (qWords.length > 0) score = (hits / qWords.length) * 0.82;
    }
    if (score >= 0.4) {
      scored.push({ item: acc, score: Number(score.toFixed(3)) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    account: scored[0]?.item ?? null,
    matches: scored,
  };
}

// ============================================================================
// Categories & Voice Alias Resolution
// ============================================================================

export async function listFinanceCategories(
  db: TypedSupabaseClient,
  kind?: FinanceCategoryKind,
  includeArchived = false
): Promise<FinanceCategory[]> {
  let query = db
    .from("finance_categories")
    .select("*")
    .order("kind", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (kind) query = query.eq("kind", kind);
  if (!includeArchived) query = query.eq("is_archived", false);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createFinanceCategory(
  db: TypedSupabaseClient,
  input: FinanceCategoryInsert
): Promise<FinanceCategory> {
  const { data, error } = await db
    .from("finance_categories")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateFinanceCategory(
  db: TypedSupabaseClient,
  id: number,
  patch: FinanceCategoryUpdate
): Promise<FinanceCategory> {
  const { data, error } = await db
    .from("finance_categories")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFinanceCategory(
  db: TypedSupabaseClient,
  queryOrId: number | string
): Promise<void> {
  let targetId: number | null = null;
  if (typeof queryOrId === "number" || /^\d+$/.test(String(queryOrId).trim())) {
    targetId = Number(queryOrId);
  } else {
    const resolved = await resolveCategoryByFuzzyQuery(db, String(queryOrId));
    targetId = resolved.category?.id ?? null;
    if (!targetId) {
      const archivedAll = await listFinanceCategories(db, undefined, true);
      const normQ = normalizeTaskTitleForDedup(String(queryOrId));
      const match = archivedAll.find((c) => normalizeTaskTitleForDedup(c.name) === normQ);
      targetId = match?.id ?? null;
    }
  }

  if (!targetId) {
    throw new Error(`Категория «${queryOrId}» не найдена`);
  }

  const { error } = await db.from("finance_categories").delete().eq("id", targetId);
  if (error) throw error;
}

export interface UpsertFinanceCategoryInput {
  id?: number;
  query?: string;
  name: string;
  kind?: FinanceCategoryKind;
  icon?: string;
  icon_name?: string;
  color_token?: string;
  monthly_budget?: number | null;
  monthly_limit?: number | null;
  voice_aliases?: string[];
  sort_order?: number;
  is_archived?: boolean;
}

export async function upsertFinanceCategory(
  db: TypedSupabaseClient,
  userId: string,
  input: UpsertFinanceCategoryInput
): Promise<FinanceCategory> {
  const cleanName = input.name?.trim();
  if (!cleanName) {
    throw new Error("Укажите название финансовой категории");
  }

  const kind: FinanceCategoryKind = input.kind ?? "expense";
  const resolvedLimit =
    input.monthly_limit !== undefined
      ? input.monthly_limit
      : input.monthly_budget !== undefined
        ? input.monthly_budget
        : undefined;
  const resolvedIcon = input.icon_name ?? input.icon;

  let targetId = input.id ?? null;
  if (!targetId && input.query) {
    const resolved = await resolveCategoryByFuzzyQuery(db, input.query, kind);
    targetId = resolved.category?.id ?? null;
  }

  // Deduplicate exact (name + kind) if creating without an explicit id
  if (!targetId) {
    const existingAll = await listFinanceCategories(db, kind, true);
    const normNew = normalizeTaskTitleForDedup(cleanName);
    const exact = existingAll.find((c) => normalizeTaskTitleForDedup(c.name) === normNew);
    if (exact) {
      targetId = exact.id;
    }
  }

  if (targetId) {
    const patch: FinanceCategoryUpdate = {
      name: cleanName,
      is_archived: input.is_archived ?? false,
    };
    if (input.kind !== undefined) patch.kind = input.kind;
    if (resolvedIcon !== undefined && resolvedIcon.trim()) {
      patch.icon_name = resolvedIcon.trim();
    }
    if (input.color_token !== undefined && input.color_token.trim()) {
      patch.color_token = input.color_token.trim();
    }
    if (resolvedLimit !== undefined) {
      patch.monthly_limit =
        resolvedLimit !== null && Number(resolvedLimit) > 0
          ? roundMoney(Number(resolvedLimit))
          : null;
    }
    if (input.voice_aliases !== undefined) patch.voice_aliases = input.voice_aliases;
    if (input.sort_order !== undefined) patch.sort_order = input.sort_order;

    return updateFinanceCategory(db, targetId, patch);
  }

  return createFinanceCategory(db, {
    user_id: userId,
    name: cleanName,
    kind,
    icon_name: resolvedIcon?.trim() || (kind === "income" ? "wallet" : "tag"),
    color_token: input.color_token?.trim() || "domain-finance",
    monthly_limit:
      resolvedLimit !== undefined && resolvedLimit !== null && Number(resolvedLimit) > 0
        ? roundMoney(Number(resolvedLimit))
        : null,
    voice_aliases: input.voice_aliases ?? [cleanName.toLowerCase()],
    sort_order: input.sort_order ?? 10,
    is_archived: Boolean(input.is_archived),
  });
}

export async function resolveCategoryByFuzzyQuery(
  db: TypedSupabaseClient,
  query?: string | number | null,
  kind?: FinanceCategoryKind
): Promise<{ category: FinanceCategory | null; matches: FuzzyFinanceMatch<FinanceCategory>[] }> {
  const categories = await listFinanceCategories(db, kind, false);
  if (categories.length === 0 || query === undefined || query === null || String(query).trim() === "") {
    return { category: null, matches: [] };
  }

  if (typeof query === "number" || /^\d+$/.test(String(query).trim())) {
    const id = Number(query);
    const found = categories.find((c) => c.id === id) ?? null;
    return { category: found, matches: found ? [{ item: found, score: 1 }] : [] };
  }

  const normQ = normalizeTaskTitleForDedup(String(query));
  const qWords = normQ.split(" ").filter((w) => w.length >= 3);
  const scored: FuzzyFinanceMatch<FinanceCategory>[] = [];

  for (const cat of categories) {
    const normName = normalizeTaskTitleForDedup(cat.name);
    const aliases = (cat.voice_aliases ?? []).map(normalizeTaskTitleForDedup);
    let score = 0;

    if (normName === normQ || aliases.includes(normQ)) {
      score = 1.0;
    } else if (
      normName.includes(normQ) ||
      (normQ.length >= 4 && normQ.includes(normName)) ||
      aliases.some((a) => a.length >= 3 && (normQ.includes(a) || a.includes(normQ)))
    ) {
      score = 0.92;
    } else if (qWords.length > 0) {
      const hay = `${normName} ${aliases.join(" ")}`;
      let hits = 0;
      for (const w of qWords) {
        const stem = w.slice(0, Math.min(w.length, 4));
        if (hay.includes(stem)) hits += 1;
      }
      score = (hits / qWords.length) * 0.8;
    }

    if (score >= 0.4) {
      scored.push({ item: cat, score: Number(score.toFixed(3)) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    category: scored[0]?.item ?? null,
    matches: scored,
  };
}

// ============================================================================
// Balance-Safe Transaction Engine (Create, Batch, Edit, Delete, Reimbursements)
// ============================================================================

async function adjustAccountCashDelta(
  db: TypedSupabaseClient,
  accountId: number,
  cashDelta: number
): Promise<FinanceAccount> {
  if (Math.abs(cashDelta) < 0.0001) {
    const existing = await getFinanceAccount(db, accountId);
    if (!existing) throw new Error(`Счёт #${accountId} не найден`);
    return existing;
  }

  const acc = await getFinanceAccount(db, accountId);
  if (!acc) throw new Error(`Счёт #${accountId} не найден`);

  const nextBalance = roundMoney(Number(acc.balance) + cashDelta);
  const patch: FinanceAccountUpdate = { balance: nextBalance };

  if (acc.account_type === "credit_card") {
    patch.statement_debt = nextBalance < 0 ? roundMoney(-nextBalance) : 0;
  }

  const { data, error } = await db
    .from("finance_accounts")
    .update(patch)
    .eq("id", accountId)
    .select("*")
    .single();
  if (error) throw error;

  if (data.account_type === "credit_card") {
    await syncCreditCardGraceReminderToQueue(db, data);
  }
  return data;
}

async function applyTransactionBalanceEffect(
  db: TypedSupabaseClient,
  tx: Pick<FinanceTransaction, "kind" | "account_id" | "to_account_id" | "amount">,
  sign: 1 | -1
): Promise<void> {
  const amt = roundMoney(Number(tx.amount));
  if (amt <= 0) return;

  if (tx.kind === "expense") {
    await adjustAccountCashDelta(db, tx.account_id, sign * -amt);
  } else if (tx.kind === "income" || tx.kind === "reimbursement_in") {
    await adjustAccountCashDelta(db, tx.account_id, sign * amt);
  } else if (tx.kind === "transfer") {
    if (!tx.to_account_id) {
      throw new Error("Для перевода между счетами необходимо указать счёт зачисления (to_account_id)");
    }
    if (tx.to_account_id === tx.account_id) {
      return;
    }
    await adjustAccountCashDelta(db, tx.account_id, sign * -amt);
    await adjustAccountCashDelta(db, tx.to_account_id, sign * amt);
  }
}

function normalizeTransactionReimbursementFields<T extends FinanceTransactionInsert | FinanceTransactionUpdate>(
  raw: T,
  fallbackAmount?: number
): T {
  const next = { ...raw };
  const kind = (next.kind ?? "expense") as FinanceTransactionKind;
  const amount = roundMoney(Number(next.amount ?? fallbackAmount ?? 0));

  if (kind !== "expense") {
    next.spend_nature = "personal";
    next.personal_share_amount = null;
    next.reimbursable_amount = 0;
    next.original_reimbursable_amount = 0;
    if (!next.reimbursement_status || next.reimbursement_status === "pending") {
      next.reimbursement_status = "not_applicable";
    }
    return next;
  }

  const nature = (next.spend_nature ?? "personal") as SpendNature;
  next.spend_nature = nature;

  if (nature === "personal") {
    next.personal_share_amount = amount;
    next.reimbursable_amount = 0;
    next.original_reimbursable_amount = 0;
    next.reimbursement_status = "not_applicable";
  } else if (nature === "work_reimbursable") {
    const reimb =
      next.reimbursable_amount !== undefined && next.reimbursable_amount !== null
        ? roundMoney(Math.min(amount, Math.max(0, Number(next.reimbursable_amount))))
        : next.personal_share_amount !== undefined && next.personal_share_amount !== null
          ? roundMoney(Math.max(0, amount - Number(next.personal_share_amount)))
          : amount;
    next.reimbursable_amount = reimb;
    next.original_reimbursable_amount =
      next.original_reimbursable_amount !== undefined && Number(next.original_reimbursable_amount) > 0
        ? roundMoney(Number(next.original_reimbursable_amount))
        : reimb;
    next.personal_share_amount = roundMoney(Math.max(0, amount - reimb));
    if (!next.reimbursement_status || next.reimbursement_status === "not_applicable") {
      next.reimbursement_status = reimb > 0 ? "pending" : "not_applicable";
    }
  } else if (nature === "shared_reimbursable") {
    let reimb: number;
    if (next.reimbursable_amount !== undefined && next.reimbursable_amount !== null && Number(next.reimbursable_amount) > 0) {
      reimb = roundMoney(Math.min(amount, Math.max(0, Number(next.reimbursable_amount))));
    } else if (next.personal_share_amount !== undefined && next.personal_share_amount !== null) {
      reimb = roundMoney(Math.max(0, amount - Number(next.personal_share_amount)));
    } else {
      reimb = roundMoney(amount / 2);
    }
    next.reimbursable_amount = reimb;
    next.original_reimbursable_amount =
      next.original_reimbursable_amount !== undefined && Number(next.original_reimbursable_amount) > 0
        ? roundMoney(Number(next.original_reimbursable_amount))
        : reimb;
    next.personal_share_amount = roundMoney(Math.max(0, amount - reimb));
    if (!next.reimbursement_status || next.reimbursement_status === "not_applicable") {
      next.reimbursement_status = reimb > 0 ? "pending" : "not_applicable";
    }
  }

  return next;
}

async function applyLinkedReimbursementDelta(
  db: TypedSupabaseClient,
  linkedExpenseId: number,
  receivedDelta: number
): Promise<FinanceTransaction | null> {
  const { data: exp, error } = await db
    .from("finance_transactions")
    .select("*")
    .eq("id", linkedExpenseId)
    .maybeSingle();
  if (error) throw error;
  if (!exp) return null;

  const origReimb =
    Number(exp.original_reimbursable_amount ?? 0) > 0
      ? Number(exp.original_reimbursable_amount)
      : Number(exp.reimbursable_amount ?? exp.amount);

  const nextRemaining = roundMoney(
    Math.min(origReimb, Math.max(0, Number(exp.reimbursable_amount ?? 0) - receivedDelta))
  );
  const nextStatus: ReimbursementStatus =
    nextRemaining <= 0.009
      ? "settled"
      : nextRemaining < origReimb - 0.009
        ? "partial"
        : "pending";

  const { data: updated, error: updErr } = await db
    .from("finance_transactions")
    .update({
      original_reimbursable_amount: origReimb,
      reimbursable_amount: nextRemaining,
      reimbursement_status: nextStatus,
    })
    .eq("id", linkedExpenseId)
    .select("*")
    .single();
  if (updErr) throw updErr;
  return updated;
}

export async function getFinanceTransaction(
  db: TypedSupabaseClient,
  id: number
): Promise<FinanceTransaction | null> {
  const { data, error } = await db
    .from("finance_transactions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createFinanceTransaction(
  db: TypedSupabaseClient,
  input: FinanceTransactionInsert
): Promise<FinanceTransaction> {
  const prepared = normalizeTransactionReimbursementFields(input);

  const { data, error } = await db
    .from("finance_transactions")
    .insert(prepared)
    .select("*")
    .single();
  if (error) throw error;

  await applyTransactionBalanceEffect(db, data, 1);

  if (data.kind === "reimbursement_in" && data.linked_expense_id) {
    await applyLinkedReimbursementDelta(db, data.linked_expense_id, Number(data.amount));
  }

  return data;
}

export async function createFinanceTransactionsBatch(
  db: TypedSupabaseClient,
  inputs: FinanceTransactionInsert[]
): Promise<FinanceTransaction[]> {
  const created: FinanceTransaction[] = [];
  for (const item of inputs) {
    const tx = await createFinanceTransaction(db, item);
    created.push(tx);
  }
  return created;
}

export async function updateFinanceTransaction(
  db: TypedSupabaseClient,
  id: number,
  patch: FinanceTransactionUpdate
): Promise<FinanceTransaction> {
  const oldTx = await getFinanceTransaction(db, id);
  if (!oldTx) throw new Error(`Операция #${id} не найдена`);

  // 1) Reverse previous balance effect & linked reimbursement effect
  await applyTransactionBalanceEffect(db, oldTx, -1);
  if (oldTx.kind === "reimbursement_in" && oldTx.linked_expense_id) {
    await applyLinkedReimbursementDelta(db, oldTx.linked_expense_id, -Number(oldTx.amount));
  }

  // 2) Merge & normalize reimbursement/share fields
  const merged: FinanceTransactionUpdate = normalizeTransactionReimbursementFields(
    {
      kind: patch.kind ?? oldTx.kind,
      amount: patch.amount ?? Number(oldTx.amount),
      spend_nature: patch.spend_nature ?? oldTx.spend_nature,
      personal_share_amount:
        patch.personal_share_amount !== undefined
          ? patch.personal_share_amount
          : patch.amount !== undefined || patch.spend_nature !== undefined
            ? undefined
            : oldTx.personal_share_amount,
      reimbursable_amount:
        patch.reimbursable_amount !== undefined
          ? patch.reimbursable_amount
          : patch.amount !== undefined || patch.spend_nature !== undefined
            ? undefined
            : Number(oldTx.reimbursable_amount),
      original_reimbursable_amount:
        patch.original_reimbursable_amount !== undefined
          ? patch.original_reimbursable_amount
          : patch.amount !== undefined || patch.spend_nature !== undefined
            ? undefined
            : Number(oldTx.original_reimbursable_amount),
      reimbursement_status: patch.reimbursement_status,
      ...patch,
      is_edited: true,
    },
    Number(patch.amount ?? oldTx.amount)
  );

  const { data: updatedTx, error } = await db
    .from("finance_transactions")
    .update(merged)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  // 3) Apply new balance effect & linked reimbursement effect
  await applyTransactionBalanceEffect(db, updatedTx, 1);
  if (updatedTx.kind === "reimbursement_in" && updatedTx.linked_expense_id) {
    await applyLinkedReimbursementDelta(
      db,
      updatedTx.linked_expense_id,
      Number(updatedTx.amount)
    );
  }

  return updatedTx;
}

export async function deleteFinanceTransaction(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  const oldTx = await getFinanceTransaction(db, id);
  if (!oldTx) return;

  await applyTransactionBalanceEffect(db, oldTx, -1);
  if (oldTx.kind === "reimbursement_in" && oldTx.linked_expense_id) {
    await applyLinkedReimbursementDelta(db, oldTx.linked_expense_id, -Number(oldTx.amount));
  }

  const { error } = await db.from("finance_transactions").delete().eq("id", id);
  if (error) throw error;
}

export async function settleReimbursement(
  db: TypedSupabaseClient,
  params: {
    expenseTransactionId: number;
    targetAccountId?: number;
    receivedAmount?: number;
    occurredAt?: string;
    note?: string;
    source?: FinanceTransactionSource;
  }
): Promise<{
  reimbursementTx: FinanceTransaction;
  updatedExpenseTx: FinanceTransaction;
}> {
  const exp = await getFinanceTransaction(db, params.expenseTransactionId);
  if (!exp) throw new Error("Исходная покупка под компенсацию не найдена");

  const outstanding = roundMoney(Number(exp.reimbursable_amount ?? 0));
  const received = roundMoney(Number(params.receivedAmount ?? outstanding));
  if (received <= 0) {
    throw new Error("Сумма компенсации должна быть больше нуля");
  }

  const targetAccountId = params.targetAccountId ?? exp.account_id;
  const returnCats = await resolveCategoryByFuzzyQuery(db, "Возвраты и кэшбэк", "income");

  const reimbursementTx = await createFinanceTransaction(db, {
    user_id: exp.user_id,
    account_id: targetAccountId,
    category_id: returnCats.category?.id ?? null,
    kind: "reimbursement_in",
    amount: received,
    currency: exp.currency,
    occurred_at: params.occurredAt ?? new Date().toISOString(),
    description:
      params.note ??
      `Компенсация: ${exp.description || "рабочая/общая покупка"}`,
    reimbursement_counterparty: exp.reimbursement_counterparty,
    linked_expense_id: exp.id,
    source: params.source ?? "web",
  });

  const updatedExpenseTx = (await getFinanceTransaction(db, exp.id)) ?? exp;
  return { reimbursementTx, updatedExpenseTx };
}

export interface ListFinanceTransactionsFilter {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  accountId?: number;
  categoryId?: number;
  kind?: FinanceTransactionKind | FinanceTransactionKind[];
  spendNature?: SpendNature | SpendNature[];
  reimbursementStatus?: ReimbursementStatus | ReimbursementStatus[];
  searchQuery?: string;
  limit?: number;
  timeZone?: string;
}

export async function listFinanceTransactions(
  db: TypedSupabaseClient,
  filter: ListFinanceTransactionsFilter = {}
): Promise<FinanceTransaction[]> {
  const tz = filter.timeZone ?? "Europe/Moscow";
  let query = db
    .from("finance_transactions")
    .select("*")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(filter.limit ?? 150);

  if (filter.startDate) {
    query = query.gte("occurred_at", localClockToUtcIso(filter.startDate, "00:00", tz));
  }
  if (filter.endDate) {
    const nextDay = addDaysToIsoDate(filter.endDate, 1);
    query = query.lt("occurred_at", localClockToUtcIso(nextDay, "00:00", tz));
  }
  if (filter.accountId) {
    query = query.or(`account_id.eq.${filter.accountId},to_account_id.eq.${filter.accountId}`);
  }
  if (filter.categoryId) {
    query = query.eq("category_id", filter.categoryId);
  }
  if (filter.kind) {
    if (Array.isArray(filter.kind)) query = query.in("kind", filter.kind);
    else query = query.eq("kind", filter.kind);
  }
  if (filter.spendNature) {
    if (Array.isArray(filter.spendNature)) query = query.in("spend_nature", filter.spendNature);
    else query = query.eq("spend_nature", filter.spendNature);
  }
  if (filter.reimbursementStatus) {
    if (Array.isArray(filter.reimbursementStatus)) {
      query = query.in("reimbursement_status", filter.reimbursementStatus);
    } else {
      query = query.eq("reimbursement_status", filter.reimbursementStatus);
    }
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = data ?? [];
  if (filter.searchQuery && filter.searchQuery.trim()) {
    const normQ = normalizeTaskTitleForDedup(filter.searchQuery);
    rows = rows.filter((tx) => {
      const hay = normalizeTaskTitleForDedup(
        `${tx.description ?? ""} ${tx.reimbursement_counterparty ?? ""} ${(tx.tags ?? []).join(" ")} ${tx.amount}`
      );
      return hay.includes(normQ);
    });
  }

  return rows;
}

export async function findTransactionsByFuzzyQuery(
  db: TypedSupabaseClient,
  params: {
    query?: string;
    amount?: number;
    date?: string;
    kind?: FinanceTransactionKind;
    reimbursementPendingOnly?: boolean;
    limit?: number;
  }
): Promise<FuzzyFinanceMatch<FinanceTransaction>[]> {
  const categories = await listFinanceCategories(db, undefined, true);
  const catNameById = new Map<number, string>(categories.map((c) => [c.id, c.name]));

  const txs = await listFinanceTransactions(db, {
    startDate: params.date,
    endDate: params.date,
    kind: params.kind,
    reimbursementStatus: params.reimbursementPendingOnly ? ["pending", "partial"] : undefined,
    limit: 200,
  });

  const normQ = params.query ? normalizeTaskTitleForDedup(params.query) : "";
  const qWords = normQ ? normQ.split(" ").filter((w) => w.length >= 2) : [];

  const scored: FuzzyFinanceMatch<FinanceTransaction>[] = [];
  for (const tx of txs) {
    let score = 0;
    const catName = tx.category_id ? catNameById.get(tx.category_id) ?? "" : "";
    const hay = normalizeTaskTitleForDedup(
      `${tx.description ?? ""} ${catName} ${tx.reimbursement_counterparty ?? ""} ${(tx.tags ?? []).join(" ")}`
    );

    if (normQ) {
      if (hay === normQ) {
        score = 0.95;
      } else if (hay.includes(normQ)) {
        score = 0.88;
      } else if (qWords.length > 0) {
        let hits = 0;
        for (const w of qWords) {
          if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
        }
        score = (hits / qWords.length) * 0.78;
      }
    } else {
      score = 0.5;
    }

    if (params.amount !== undefined) {
      const diff = Math.abs(Number(tx.amount) - params.amount);
      if (diff < 0.01) {
        score = Math.min(1, score + 0.35);
      } else if (diff / Math.max(1, params.amount) <= 0.05) {
        score = Math.min(1, score + 0.15);
      } else if (!normQ) {
        score = 0;
      }
    }

    if (score >= 0.4) {
      scored.push({ item: tx, score: Number(score.toFixed(3)) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, params.limit ?? 10);
}

// ============================================================================
// Obligations / Subscriptions & Mandatory Bills
// ============================================================================

export async function listFinanceObligations(
  db: TypedSupabaseClient,
  includeInactive = false
): Promise<FinanceObligation[]> {
  let query = db
    .from("finance_obligations")
    .select("*")
    .order("next_due_date", { ascending: true })
    .order("id", { ascending: true });
  if (!includeInactive) {
    query = query.eq("is_active", true);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createFinanceObligation(
  db: TypedSupabaseClient,
  input: FinanceObligationInsert
): Promise<FinanceObligation> {
  const { data, error } = await db
    .from("finance_obligations")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  await syncObligationReminderToQueue(db, data);
  return data;
}

export async function updateFinanceObligation(
  db: TypedSupabaseClient,
  id: number,
  patch: FinanceObligationUpdate
): Promise<FinanceObligation> {
  const { data, error } = await db
    .from("finance_obligations")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  await syncObligationReminderToQueue(db, data);
  return data;
}

export async function deleteFinanceObligation(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  await cancelEntityRemindersInQueue(db, String(id), ["finance_obligation"]);
  const { error } = await db.from("finance_obligations").delete().eq("id", id);
  if (error) throw error;
}

export async function markObligationPaid(
  db: TypedSupabaseClient,
  id: number,
  options: {
    accountId?: number;
    paidAt?: string;
    amountOverride?: number;
    source?: FinanceTransactionSource;
  } = {}
): Promise<{ obligation: FinanceObligation; transaction: FinanceTransaction }> {
  const { data: ob, error } = await db
    .from("finance_obligations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!ob) throw new Error("Регулярный платёж / подписка не найдены");

  const primaryAcc = await getPrimaryFinanceAccount(db);
  const targetAccountId = options.accountId ?? ob.account_id ?? primaryAcc?.id;
  if (!targetAccountId) {
    throw new Error("Не найден счёт для списания обязательного платежа");
  }

  const paidAmount = roundMoney(Number(options.amountOverride ?? ob.amount));
  const transaction = await createFinanceTransaction(db, {
    user_id: ob.user_id,
    account_id: targetAccountId,
    category_id: ob.category_id,
    kind: "expense",
    amount: paidAmount,
    currency: ob.currency,
    occurred_at: options.paidAt ?? new Date().toISOString(),
    description: ob.title,
    spend_nature: "personal",
    tags: [ob.obligation_kind === "subscription" ? "подписка" : "обязательный платёж"],
    source: options.source ?? "web",
  });

  const nextDue = advanceBillingDateIso(
    ob.next_due_date,
    ob.billing_period as BillingPeriod
  );
  const updatedOb = await updateFinanceObligation(db, ob.id, {
    next_due_date: nextDue,
    account_id: targetAccountId,
  });

  return { obligation: updatedOb, transaction };
}

export async function findObligationsByFuzzyQuery(
  db: TypedSupabaseClient,
  queryText: string,
  includeInactive = false
): Promise<FuzzyFinanceMatch<FinanceObligation>[]> {
  const obligations = await listFinanceObligations(db, includeInactive);
  const normQ = normalizeTaskTitleForDedup(queryText);
  if (!normQ) return [];

  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<FinanceObligation>[] = [];

  for (const ob of obligations) {
    const normTitle = normalizeTaskTitleForDedup(ob.title);
    let score = 0;
    if (normTitle === normQ) score = 1.0;
    else if (normTitle.includes(normQ) || (normQ.length >= 4 && normQ.includes(normTitle))) {
      score = 0.9;
    } else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (normTitle.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.8;
    }
    if (score >= 0.4) scored.push({ item: ob, score: Number(score.toFixed(3)) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ============================================================================
// Debts & Receivables
// ============================================================================

export async function listFinanceDebts(
  db: TypedSupabaseClient,
  status: DebtStatus | "all" = "all"
): Promise<FinanceDebt[]> {
  let query = db
    .from("finance_debts")
    .select("*")
    .order("status", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("id", { ascending: false });
  if (status !== "all") {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createFinanceDebt(
  db: TypedSupabaseClient,
  input: FinanceDebtInsert
): Promise<FinanceDebt> {
  const prepared: FinanceDebtInsert = {
    ...input,
    remaining_amount:
      input.remaining_amount !== undefined ? input.remaining_amount : input.initial_amount,
  };
  const { data, error } = await db
    .from("finance_debts")
    .insert(prepared)
    .select("*")
    .single();
  if (error) throw error;
  await syncDebtReminderToQueue(db, data);
  return data;
}

export async function updateFinanceDebt(
  db: TypedSupabaseClient,
  id: number,
  patch: FinanceDebtUpdate
): Promise<FinanceDebt> {
  const { data, error } = await db
    .from("finance_debts")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  await syncDebtReminderToQueue(db, data);
  return data;
}

export async function recordDebtPayment(
  db: TypedSupabaseClient,
  id: number,
  options: {
    amount: number;
    accountId?: number | null;
    note?: string;
    occurredAt?: string;
    source?: FinanceTransactionSource;
  }
): Promise<{ debt: FinanceDebt; transaction: FinanceTransaction | null }> {
  const { data: debt, error } = await db
    .from("finance_debts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!debt) throw new Error("Запись долга не найдена");

  const payAmt = roundMoney(Math.max(0, Number(options.amount)));
  if (payAmt <= 0) throw new Error("Сумма платежа должна быть больше нуля");

  const nextRemaining = roundMoney(Math.max(0, Number(debt.remaining_amount) - payAmt));
  const nextStatus: DebtStatus = nextRemaining <= 0.009 ? "closed" : "open";

  const updatedDebt = await updateFinanceDebt(db, debt.id, {
    remaining_amount: nextRemaining,
    status: nextStatus,
  });

  let transaction: FinanceTransaction | null = null;
  if (options.accountId) {
    transaction = await createFinanceTransaction(db, {
      user_id: debt.user_id,
      account_id: options.accountId,
      kind: debt.direction === "i_owe" ? "expense" : "income",
      amount: payAmt,
      currency: debt.currency,
      occurred_at: options.occurredAt ?? new Date().toISOString(),
      description:
        options.note ??
        (debt.direction === "i_owe"
          ? `Погашение долга: ${debt.counterparty} (${debt.title})`
          : `Возврат долга от ${debt.counterparty} (${debt.title})`),
      spend_nature: "personal",
      tags: ["долг"],
      source: options.source ?? "web",
    });
  }

  return { debt: updatedDebt, transaction };
}

export async function deleteFinanceDebt(
  db: TypedSupabaseClient,
  id: number
): Promise<void> {
  await cancelEntityRemindersInQueue(db, String(id), ["debt_due"]);
  const { error } = await db.from("finance_debts").delete().eq("id", id);
  if (error) throw error;
}

export async function findDebtsByFuzzyQuery(
  db: TypedSupabaseClient,
  queryText: string,
  status: DebtStatus | "all" = "open"
): Promise<FuzzyFinanceMatch<FinanceDebt>[]> {
  const debts = await listFinanceDebts(db, status);
  const normQ = normalizeTaskTitleForDedup(queryText);
  if (!normQ) return [];

  const qWords = normQ.split(" ").filter((w) => w.length >= 2);
  const scored: FuzzyFinanceMatch<FinanceDebt>[] = [];

  for (const d of debts) {
    const hay = normalizeTaskTitleForDedup(`${d.counterparty} ${d.title} ${d.notes ?? ""}`);
    let score = 0;
    if (hay === normQ) score = 1.0;
    else if (hay.includes(normQ)) score = 0.9;
    else if (qWords.length > 0) {
      let hits = 0;
      for (const w of qWords) {
        if (hay.includes(w.slice(0, Math.min(w.length, 4)))) hits += 1;
      }
      score = (hits / qWords.length) * 0.82;
    }
    if (score >= 0.4) scored.push({ item: d, score: Number(score.toFixed(3)) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ============================================================================
// Analytics (Strict Personal vs Work/Shared Isolation) & Full Dashboard Loader
// ============================================================================

export function resolveMonthBoundsIso(
  monthStr?: string,
  timeZone = "Europe/Moscow"
): { month: string; startDate: string; endDate: string } {
  const fallbackMonth = formatIsoDate(new Date(), timeZone).slice(0, 7);
  const month =
    monthStr && /^\d{4}-\d{2}$/.test(monthStr.trim()) ? monthStr.trim() : fallbackMonth;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    month,
    startDate: `${month}-01`,
    endDate: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export async function getFinanceAnalytics(
  db: TypedSupabaseClient,
  monthStr?: string,
  timeZone = "Europe/Moscow"
): Promise<FinanceMonthlyAnalytics> {
  const { month, startDate, endDate } = resolveMonthBoundsIso(monthStr, timeZone);

  const [categories, monthTxs] = await Promise.all([
    listFinanceCategories(db, undefined, true),
    listFinanceTransactions(db, {
      startDate,
      endDate,
      limit: 1000,
      timeZone,
    }),
  ]);

  const catMap = new Map<number, FinanceCategory>(categories.map((c) => [c.id, c]));
  const bucketMap = new Map<string, FinanceCategoryAnalyticsItem>();

  let personalExpenseTotal = 0;
  let workReimbursableOutlayTotal = 0;
  let sharedReimbursableOutlayTotal = 0;
  let grossOutflowTotal = 0;
  let incomeTotal = 0;
  let reimbursementsReceivedTotal = 0;

  for (const tx of monthTxs) {
    const amt = roundMoney(Number(tx.amount));
    if (tx.kind === "income") {
      incomeTotal = roundMoney(incomeTotal + amt);
      continue;
    }
    if (tx.kind === "reimbursement_in") {
      reimbursementsReceivedTotal = roundMoney(reimbursementsReceivedTotal + amt);
      continue;
    }
    if (tx.kind === "transfer") {
      continue;
    }

    // Expense accounting: strictly separate personal share from reimbursable outlay!
    grossOutflowTotal = roundMoney(grossOutflowTotal + amt);

    const origReimb =
      Number(tx.original_reimbursable_amount ?? 0) > 0
        ? Number(tx.original_reimbursable_amount)
        : tx.spend_nature === "work_reimbursable" && tx.personal_share_amount === 0
          ? amt
          : Number(tx.reimbursable_amount ?? 0);

    const personalShare =
      tx.personal_share_amount !== null && tx.personal_share_amount !== undefined
        ? roundMoney(Number(tx.personal_share_amount))
        : tx.spend_nature === "work_reimbursable"
          ? roundMoney(Math.max(0, amt - origReimb))
          : amt;

    const reimbShare = roundMoney(Math.max(0, amt - personalShare));

    personalExpenseTotal = roundMoney(personalExpenseTotal + personalShare);
    if (tx.spend_nature === "work_reimbursable") {
      workReimbursableOutlayTotal = roundMoney(workReimbursableOutlayTotal + reimbShare);
    } else if (tx.spend_nature === "shared_reimbursable") {
      sharedReimbursableOutlayTotal = roundMoney(sharedReimbursableOutlayTotal + reimbShare);
    }

    const cat = tx.category_id ? catMap.get(tx.category_id) : undefined;
    const key = cat ? String(cat.id) : "uncategorized";
    const existing = bucketMap.get(key) ?? {
      category_id: cat?.id ?? null,
      category_name: cat?.name ?? "Без категории",
      icon_name: cat?.icon_name ?? "receipt",
      color_token: cat?.color_token ?? "domain-finance",
      personal_spent: 0,
      gross_spent: 0,
      reimbursable_spent: 0,
      monthly_limit: cat?.monthly_limit !== null && cat?.monthly_limit !== undefined ? Number(cat.monthly_limit) : null,
      limit_usage_percent: null,
      transactions_count: 0,
    };

    existing.personal_spent = roundMoney(existing.personal_spent + personalShare);
    existing.gross_spent = roundMoney(existing.gross_spent + amt);
    existing.reimbursable_spent = roundMoney(existing.reimbursable_spent + reimbShare);
    existing.transactions_count += 1;
    if (existing.monthly_limit && existing.monthly_limit > 0) {
      existing.limit_usage_percent = Math.round(
        (existing.personal_spent / existing.monthly_limit) * 100
      );
    }
    bucketMap.set(key, existing);
  }

  const byCategory = Array.from(bucketMap.values()).sort(
    (a, b) => b.personal_spent - a.personal_spent || b.gross_spent - a.gross_spent
  );

  return {
    month,
    startDate,
    endDate,
    personal_expense_total: personalExpenseTotal,
    work_reimbursable_outlay_total: workReimbursableOutlayTotal,
    shared_reimbursable_outlay_total: sharedReimbursableOutlayTotal,
    gross_outflow_total: grossOutflowTotal,
    income_total: incomeTotal,
    reimbursements_received_total: reimbursementsReceivedTotal,
    net_personal_cashflow: roundMoney(incomeTotal - personalExpenseTotal),
    by_category: byCategory,
  };
}

export interface FinanceDashboardData {
  profile: UserProfile | null;
  balanceSummary: FinanceBalanceSummary | null;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  recentTransactions: FinanceTransaction[];
  obligations: FinanceObligation[];
  debts: FinanceDebt[];
  pendingReimbursementTransactions: FinanceTransaction[];
  analytics: FinanceMonthlyAnalytics;
}

export async function getFinanceDashboardData(
  db: TypedSupabaseClient,
  options: { month?: string; transactionsLimit?: number; timeZone?: string } = {}
): Promise<FinanceDashboardData> {
  const tz = options.timeZone ?? "Europe/Moscow";
  const [
    profile,
    balanceSummary,
    accounts,
    categories,
    recentTransactions,
    obligations,
    debts,
    pendingReimbursementTransactions,
    analytics,
  ] = await Promise.all([
    getOwnerProfile(db),
    getFinanceBalanceSummary(db),
    listFinanceAccounts(db, false),
    listFinanceCategories(db, undefined, false),
    listFinanceTransactions(db, { limit: options.transactionsLimit ?? 100, timeZone: tz }),
    listFinanceObligations(db, true),
    listFinanceDebts(db, "all"),
    listFinanceTransactions(db, {
      reimbursementStatus: ["pending", "partial"],
      limit: 100,
      timeZone: tz,
    }),
    getFinanceAnalytics(db, options.month, tz),
  ]);

  return {
    profile,
    balanceSummary,
    accounts,
    categories,
    recentTransactions,
    obligations,
    debts,
    pendingReimbursementTransactions,
    analytics,
  };
}

export const getFinanceOverview = getFinanceDashboardData;
