import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createFinanceAccount,
  createFinanceCategory,
  createFinanceDebt,
  createFinanceObligation,
  createFinanceTransaction,
  createFinanceTransactionsBatch,
  deleteFinanceCategory,
  deleteFinanceDebt,
  deleteFinanceObligation,
  deleteFinanceTransaction,
  deleteOrArchiveFinanceAccount,
  extractLocalTimeParts,
  findDebtsByFuzzyQuery,
  findObligationsByFuzzyQuery,
  findTransactionsByFuzzyQuery,
  formatIsoDate,
  getFinanceAccount,
  getFinanceBalanceSummary,
  getFinanceDashboardData,
  getOwnerBotDbClient,
  listFinanceAccounts,
  listFinanceCategories,
  listFinanceDebts,
  listFinanceObligations,
  listFinanceTransactions,
  localClockToUtcIso,
  markObligationPaid,
  recordDebtPayment,
  resolveAccountByFuzzyQuery,
  resolveCategoryByFuzzyQuery,
  resolveMonthBoundsIso,
  setBalanceViewMode,
  settleReimbursement,
  updateFinanceAccount,
  updateFinanceCategory,
  updateFinanceDebt,
  updateFinanceObligation,
  updateFinanceTransaction,
  upsertFinanceCategory,
  type BillingPeriod,
  type DebtDirection,
  type FinanceAccount,
  type FinanceAccountType,
  type FinanceCategory,
  type FinanceCategoryKind,
  type FinanceObligationKind,
  type FinanceTransaction,
  type FinanceTransactionInsert,
  type FinanceTransactionKind,
  type FinanceTransactionUpdate,
  type ReimbursementStatus,
  type SpendNature,
  type TypedSupabaseClient,
} from "@life-os/db";
import { DEFAULT_TIMEZONE, errResult, okResult, resolveDateInput } from "../helpers";

const SingleTransactionEntrySchema = z.object({
  amount: z.number().positive().describe("Сумма операции (> 0)"),
  kind: z
    .enum(["expense", "income", "transfer", "reimbursement_in"])
    .optional()
    .describe("Тип операции: expense (по умолчанию), income, transfer, reimbursement_in"),
  description: z
    .string()
    .max(500)
    .optional()
    .describe("Описание / назначение траты или поступления (например, 'Такси в офис', 'Кофе и круассан')"),
  category: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .describe("Название категории (подбирается по названию и голосовым синонимам) или ID"),
  account: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Счёт списания/зачисления по названию/типу ('Т-Банк', 'наличные', 'кредитка') или ID; по умолчанию основной дебетовый счёт"),
  to_account: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .describe("Целевой счёт (обязателен для kind='transfer', например перевод на накопительный или погашение кредитки)"),
  currency: z.string().length(3).optional().describe("Валюта ISO (по умолчанию валюта счёта / RUB)"),
  date: z
    .string()
    .optional()
    .describe("Дата операции YYYY-MM-DD или today/yesterday (по умолчанию сегодня по МСК)"),
  time_msk: z
    .string()
    .optional()
    .describe("Опциональное время операции ЧЧ:ММ по МСК"),
  occurred_at: z
    .string()
    .optional()
    .describe("Альтернативно: полный ISO-таймстемп операции"),
  spend_nature: z
    .enum(["personal", "work_reimbursable", "shared_reimbursable"])
    .optional()
    .describe("Характер расхода: personal (личный, по умолчанию), work_reimbursable (рабочий под возврат — 0 ₽ в личную аналитику!), shared_reimbursable (общая покупка пополам/в складчину)"),
  personal_share_amount: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe("Твоя личная доля в покупке (0 для 100% рабочей траты; половина суммы по умолчанию для shared_reimbursable)"),
  reimbursable_amount: z
    .number()
    .min(0)
    .optional()
    .describe("Сумма, которую должны компенсировать/вернуть"),
  reimbursement_counterparty: z
    .string()
    .max(200)
    .nullable()
    .optional()
    .describe("От кого ждём компенсацию (компания, клиент, друг, партнёр)"),
  linked_expense_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("ID исходной траты (если записывается kind='reimbursement_in')"),
  tags: z.array(z.string().min(1).max(60)).optional().describe("Теги операции"),
  raw_voice_phrase: z.string().max(1000).nullable().optional().describe("Исходная голосовая фраза пользователя"),
});

function resolveOccurredIso(params: {
  occurred_at?: string;
  date?: string;
  time_msk?: string;
}): string {
  if (params.occurred_at) {
    const parsed = Date.parse(params.occurred_at);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  if (params.date || params.time_msk) {
    const d = resolveDateInput(params.date) ?? formatIsoDate();
    const tMatch = params.time_msk ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(params.time_msk.trim()) : null;
    if (tMatch) {
      return localClockToUtcIso(d, `${tMatch[1].padStart(2, "0")}:${tMatch[2]}`, DEFAULT_TIMEZONE);
    }
    const nowMsk = extractLocalTimeParts(new Date().toISOString(), DEFAULT_TIMEZONE);
    return localClockToUtcIso(d, d === nowMsk.dateStr ? nowMsk.timeStr : "12:00", DEFAULT_TIMEZONE);
  }
  return new Date().toISOString();
}

function formatTransactionForMcp(
  tx: FinanceTransaction,
  accountMap: Map<number, FinanceAccount>,
  categoryMap: Map<number, FinanceCategory>
) {
  const msk = extractLocalTimeParts(tx.occurred_at, DEFAULT_TIMEZONE);
  return {
    id: tx.id,
    kind: tx.kind,
    amount: Number(tx.amount),
    currency: tx.currency,
    date_msk: msk.dateStr,
    time_msk: msk.timeStr,
    occurred_at: tx.occurred_at,
    description: tx.description,
    account_id: tx.account_id,
    account_name: accountMap.get(tx.account_id)?.name ?? null,
    to_account_id: tx.to_account_id,
    to_account_name: tx.to_account_id ? accountMap.get(tx.to_account_id)?.name ?? null : null,
    category_id: tx.category_id,
    category_name: tx.category_id ? categoryMap.get(tx.category_id)?.name ?? null : null,
    spend_nature: tx.spend_nature,
    personal_share_amount:
      tx.personal_share_amount !== null ? Number(tx.personal_share_amount) : null,
    reimbursable_amount: Number(tx.reimbursable_amount ?? 0),
    original_reimbursable_amount: Number(tx.original_reimbursable_amount ?? 0),
    reimbursement_counterparty: tx.reimbursement_counterparty,
    reimbursement_status: tx.reimbursement_status,
    linked_expense_id: tx.linked_expense_id,
    tags: tx.tags ?? [],
    is_edited: tx.is_edited,
  };
}

async function buildTransactionInsertFromEntry(
  db: TypedSupabaseClient,
  userId: string,
  entry: z.infer<typeof SingleTransactionEntrySchema>,
  defaults?: {
    defaultAccount?: string | number;
    defaultDate?: string;
    defaultVoicePhrase?: string;
  }
): Promise<FinanceTransactionInsert> {
  const kind: FinanceTransactionKind = entry.kind ?? "expense";
  const accountRef = entry.account ?? defaults?.defaultAccount;
  const { account: sourceAccount } = await resolveAccountByFuzzyQuery(db, accountRef);
  if (!sourceAccount) {
    throw new Error(
      accountRef
        ? `Счёт «${accountRef}» не найден. Вызови manage_finance_account(action='list') или создай счёт через manage_finance_account(action='create').`
        : "В базе пока нет ни одного финансового счёта (0 счетов). Сначала создай счёт через manage_finance_account(action='create', name='Основная карта', account_type='debit', balance=0)."
    );
  }

  let toAccountId: number | null = null;
  if (kind === "transfer") {
    if (!entry.to_account) {
      throw new Error("Для перевода (kind='transfer') укажи целевой счёт `to_account`.");
    }
    const { account: destAccount } = await resolveAccountByFuzzyQuery(db, entry.to_account);
    if (!destAccount) {
      throw new Error(`Целевой счёт «${entry.to_account}» не найден.`);
    }
    if (destAccount.id === sourceAccount.id) {
      throw new Error("Счёт списания и целевой счёт при переводе должны отличаться.");
    }
    toAccountId = destAccount.id;
  }

  let categoryId: number | null = null;
  let resolvedCategoryName: string | null = null;
  if (kind !== "transfer") {
    const catKind: FinanceCategoryKind = kind === "expense" ? "expense" : "income";
    if (entry.category !== null) {
      const catQuery = entry.category ?? entry.description ?? null;
      if (catQuery) {
        const { category } = await resolveCategoryByFuzzyQuery(db, catQuery, catKind);
        if (category) {
          categoryId = category.id;
          resolvedCategoryName = category.name;
        } else if (typeof entry.category === "string" && entry.category.trim().length > 0) {
          // Clean-slate auto-create: if user explicitly named a category on a 0-category DB, create it automatically
          const createdCat = await upsertFinanceCategory(db, userId, {
            name: entry.category.trim(),
            kind: catKind,
          });
          categoryId = createdCat.id;
          resolvedCategoryName = createdCat.name;
        }
      }
    }
  }

  const spendNature: SpendNature =
    kind === "expense" ? entry.spend_nature ?? "personal" : "personal";

  const description =
    entry.description?.trim() ||
    resolvedCategoryName ||
    (kind === "transfer" ? "Перевод между счетами" : "Операция");

  return {
    user_id: userId,
    account_id: sourceAccount.id,
    to_account_id: toAccountId,
    category_id: categoryId,
    kind,
    amount: entry.amount,
    currency: (entry.currency ?? sourceAccount.currency ?? "RUB").toUpperCase(),
    occurred_at: resolveOccurredIso({
      occurred_at: entry.occurred_at,
      date: entry.date ?? defaults?.defaultDate,
      time_msk: entry.time_msk,
    }),
    description,
    raw_voice_phrase: entry.raw_voice_phrase ?? defaults?.defaultVoicePhrase ?? null,
    spend_nature: spendNature,
    personal_share_amount:
      entry.personal_share_amount !== undefined ? entry.personal_share_amount : undefined,
    reimbursable_amount: entry.reimbursable_amount,
    reimbursement_counterparty: entry.reimbursement_counterparty?.trim() || null,
    linked_expense_id: entry.linked_expense_id ?? null,
    tags: entry.tags ?? [],
    source: entry.raw_voice_phrase || defaults?.defaultVoicePhrase ? "telegram_voice" : "mcp",
  };
}

async function resolveSingleTransactionTarget(
  db: TypedSupabaseClient,
  params: {
    transaction_id?: number;
    query?: string;
    amount?: number;
    date?: string;
    kind?: FinanceTransactionKind;
    reimbursementPendingOnly?: boolean;
  }
): Promise<{
  transaction?: FinanceTransaction;
  candidates?: Array<{
    id: number;
    date_msk: string;
    amount: number;
    kind: string;
    description: string | null;
    spend_nature: string;
    reimbursable_amount: number;
    score: number;
  }>;
  error?: string;
}> {
  if (params.transaction_id) {
    const { data, error } = await db
      .from("finance_transactions")
      .select("*")
      .eq("id", params.transaction_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: `Операция #${params.transaction_id} не найдена.` };
    return { transaction: data };
  }

  const resolvedDate = resolveDateInput(params.date);
  let matches = await findTransactionsByFuzzyQuery(db, {
    query: params.query,
    amount: params.amount,
    date: resolvedDate ?? undefined,
    kind: params.kind,
    reimbursementPendingOnly: params.reimbursementPendingOnly,
    limit: 6,
  });

  if (matches.length === 0 && resolvedDate) {
    matches = await findTransactionsByFuzzyQuery(db, {
      query: params.query,
      amount: params.amount,
      kind: params.kind,
      reimbursementPendingOnly: params.reimbursementPendingOnly,
      limit: 6,
    });
  }

  if (matches.length === 0) {
    return {
      error: "Подходящая финансовая операция не найдена. Вызови list_finance_transactions для уточнения.",
    };
  }

  if (matches.length === 1) {
    return { transaction: matches[0].item };
  }

  const top = matches[0];
  const second = matches[1];
  if (top.score >= 0.85 && top.score - second.score >= 0.12) {
    return { transaction: top.item };
  }

  return {
    candidates: matches.slice(0, 5).map((m) => ({
      id: m.item.id,
      date_msk: extractLocalTimeParts(m.item.occurred_at, DEFAULT_TIMEZONE).dateStr,
      amount: Number(m.item.amount),
      kind: m.item.kind,
      description: m.item.description,
      spend_nature: m.item.spend_nature,
      reimbursable_amount: Number(m.item.reimbursable_amount ?? 0),
      score: m.score,
    })),
  };
}

export function registerFinanceTools(server: McpServer): void {
  // ==========================================================================
  // 1. COMPREHENSIVE FINANCE OVERVIEW & ANALYTICS
  // ==========================================================================

  server.registerTool(
    "get_finance_overview",
    {
      title: "Полный обзор финансов, Safe-to-Spend и аналитики месяца",
      description:
        "Возвращает полную финансовую картину: формулу Доступно для трат (Safe-to-Spend), балансы счетов и статус грейс-периода кредитки, чистую личную аналитику по категориям (без искажения рабочими/общими покупками под компенсацию), ожидающие возврата траты, подписки/обязательные платежи и долги.",
      inputSchema: {
        month: z
          .string()
          .optional()
          .describe("Месяц аналитики YYYY-MM (по умолчанию текущий месяц по МСК)"),
        recent_limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Сколько последних операций вернуть (по умолчанию 20)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const dash = await getFinanceDashboardData(db, {
          month: args.month,
          transactionsLimit: args.recent_limit ?? 20,
        });

        const accountMap = new Map(dash.accounts.map((a) => [a.id, a]));
        const categoryMap = new Map(dash.categories.map((c) => [c.id, c]));

        return okResult({
          ok: true,
          balance_view_mode: dash.profile?.balance_view_mode ?? "safe_to_spend",
          balance_summary: dash.balanceSummary,
          accounts: dash.accounts.map((a) => ({
            ...a,
            balance: Number(a.balance),
            protected_reserve: Number(a.protected_reserve),
            credit_limit: a.credit_limit !== null ? Number(a.credit_limit) : null,
            statement_debt: a.statement_debt !== null ? Number(a.statement_debt) : 0,
            available_credit:
              a.account_type === "credit_card" && a.credit_limit !== null
                ? Math.max(0, Number(a.credit_limit) - Number(a.statement_debt ?? 0))
                : null,
          })),
          monthly_analytics: dash.analytics,
          pending_reimbursements: dash.pendingReimbursementTransactions.map((tx) =>
            formatTransactionForMcp(tx, accountMap, categoryMap)
          ),
          active_obligations: dash.obligations.filter((o) => o.is_active),
          open_debts: dash.debts.filter((d) => d.status === "open"),
          recent_transactions: dash.recentTransactions.map((tx) =>
            formatTransactionForMcp(tx, accountMap, categoryMap)
          ),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 2. SINGLE & MULTI-VOICE BATCH TRANSACTIONS + EDIT / DELETE / REIMBURSE
  // ==========================================================================

  server.registerTool(
    "record_finance_transaction",
    {
      title: "Записать расход, доход или перевод между счетами",
      description:
        "Записывает одну финансовую операцию, автоматически определяет счёт и категорию по названию/синонимам, пересчитывает баланс счёта и изолирует рабочие/общие покупки под возврат (work_reimbursable / shared_reimbursable) от личной аналитики.",
      inputSchema: SingleTransactionEntrySchema.shape,
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const insertPayload = await buildTransactionInsertFromEntry(db, userId, args);
        const created = await createFinanceTransaction(db, insertPayload);

        const [accounts, categories, summary] = await Promise.all([
          listFinanceAccounts(db, true),
          listFinanceCategories(db, undefined, true),
          getFinanceBalanceSummary(db),
        ]);
        const accountMap = new Map(accounts.map((a) => [a.id, a]));
        const categoryMap = new Map(categories.map((c) => [c.id, c]));

        return okResult({
          ok: true,
          transaction: formatTransactionForMcp(created, accountMap, categoryMap),
          updated_account_balance: accountMap.get(created.account_id)?.balance ?? null,
          safe_to_spend: summary?.safe_to_spend ?? null,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "record_finance_transactions_batch",
    {
      title: "Пакетная запись нескольких трат/доходов из одной голосовой фразы",
      description:
        "Идеально для голосовых сообщений с несколькими покупками сразу (например: «такси 680 по работе, обед 1200 пополам с другом и продукты 2450 с Т-Банка»). Записывает все операции за один вызов, подбирает категории по голосовым синонимам, обновляет балансы и возвращает сводку.",
      inputSchema: {
        items: z
          .array(SingleTransactionEntrySchema)
          .min(1)
          .max(30)
          .describe("Массив распознанных операций из речи или текста пользователя"),
        default_account: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Общий счёт по умолчанию для пачки, если у позиции не указан свой счёт"),
        default_date: z
          .string()
          .optional()
          .describe("Общая дата YYYY-MM-DD или today/yesterday для всей пачки"),
        raw_voice_phrase: z
          .string()
          .max(1500)
          .optional()
          .describe("Исходная расшифровка голосовой фразы целиком"),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const inserts: FinanceTransactionInsert[] = [];
        for (const item of args.items) {
          const built = await buildTransactionInsertFromEntry(db, userId, item, {
            defaultAccount: args.default_account,
            defaultDate: args.default_date,
            defaultVoicePhrase: args.raw_voice_phrase,
          });
          inserts.push(built);
        }

        const createdList = await createFinanceTransactionsBatch(db, inserts);
        const [accounts, categories, summary] = await Promise.all([
          listFinanceAccounts(db, false),
          listFinanceCategories(db, undefined, true),
          getFinanceBalanceSummary(db),
        ]);
        const accountMap = new Map(accounts.map((a) => [a.id, a]));
        const categoryMap = new Map(categories.map((c) => [c.id, c]));

        const totalGrossExpense = createdList
          .filter((t) => t.kind === "expense")
          .reduce((s, t) => s + Number(t.amount), 0);
        const totalPersonalExpense = createdList
          .filter((t) => t.kind === "expense")
          .reduce((s, t) => s + Number(t.personal_share_amount ?? t.amount), 0);
        const totalReimbursable = createdList
          .filter((t) => t.kind === "expense")
          .reduce((s, t) => s + Number(t.reimbursable_amount ?? 0), 0);

        return okResult({
          ok: true,
          recorded_count: createdList.length,
          totals: {
            gross_expense: Number(totalGrossExpense.toFixed(2)),
            personal_expense: Number(totalPersonalExpense.toFixed(2)),
            reimbursable_outlay: Number(totalReimbursable.toFixed(2)),
          },
          transactions: createdList.map((tx) =>
            formatTransactionForMcp(tx, accountMap, categoryMap)
          ),
          safe_to_spend: summary?.safe_to_spend ?? null,
          accounts_balances: accounts.map((a) => ({
            id: a.id,
            name: a.name,
            balance: Number(a.balance),
          })),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "list_finance_transactions",
    {
      title: "История и фильтрация финансовых операций",
      description:
        "Возвращает историю доходов, расходов, переводов и компенсаций с фильтрацией по дате, месяцу, счёту, категории, характеру траты (personal/work_reimbursable/shared_reimbursable), статусу возврата и тексту.",
      inputSchema: {
        date: z.string().optional().describe("Конкретный день YYYY-MM-DD или today/yesterday"),
        month: z.string().optional().describe("Весь месяц YYYY-MM (например, '2026-11')"),
        start_date: z.string().optional().describe("Начало периода YYYY-MM-DD"),
        end_date: z.string().optional().describe("Конец периода YYYY-MM-DD"),
        account: z.union([z.string(), z.number()]).optional().describe("Название или ID счёта"),
        category: z.union([z.string(), z.number()]).optional().describe("Название или ID категории"),
        kind: z
          .union([
            z.enum(["expense", "income", "transfer", "reimbursement_in"]),
            z.array(z.enum(["expense", "income", "transfer", "reimbursement_in"])),
          ])
          .optional(),
        spend_nature: z
          .union([
            z.enum(["personal", "work_reimbursable", "shared_reimbursable"]),
            z.array(z.enum(["personal", "work_reimbursable", "shared_reimbursable"])),
          ])
          .optional(),
        reimbursement_status: z
          .union([
            z.enum(["not_applicable", "pending", "partial", "settled"]),
            z.array(z.enum(["not_applicable", "pending", "partial", "settled"])),
          ])
          .optional(),
        search_query: z.string().optional().describe("Поиск по описанию, контрагенту, сумме или тегам"),
        limit: z.number().int().min(1).max(300).optional().describe("Лимит записей (по умолчанию 50)"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        let startDate = resolveDateInput(args.date) ?? resolveDateInput(args.start_date) ?? undefined;
        let endDate = resolveDateInput(args.date) ?? resolveDateInput(args.end_date) ?? undefined;

        if (args.month && !startDate && !endDate) {
          const mBounds = resolveMonthBoundsIso(args.month);
          startDate = mBounds.startDate;
          endDate = mBounds.endDate;
        }

        let accountId: number | undefined;
        if (args.account !== undefined) {
          const { account } = await resolveAccountByFuzzyQuery(db, args.account);
          if (!account) return errResult(`Счёт «${args.account}» не найден.`);
          accountId = account.id;
        }

        let categoryId: number | undefined;
        if (args.category !== undefined) {
          const { category } = await resolveCategoryByFuzzyQuery(db, args.category);
          if (!category) return errResult(`Категория «${args.category}» не найдена.`);
          categoryId = category.id;
        }

        const [txs, accounts, categories] = await Promise.all([
          listFinanceTransactions(db, {
            startDate,
            endDate,
            accountId,
            categoryId,
            kind: args.kind as FinanceTransactionKind | FinanceTransactionKind[] | undefined,
            spendNature: args.spend_nature as SpendNature | SpendNature[] | undefined,
            reimbursementStatus: args.reimbursement_status as
              | ReimbursementStatus
              | ReimbursementStatus[]
              | undefined,
            searchQuery: args.search_query,
            limit: args.limit ?? 50,
          }),
          listFinanceAccounts(db, true),
          listFinanceCategories(db, undefined, true),
        ]);

        const accountMap = new Map(accounts.map((a) => [a.id, a]));
        const categoryMap = new Map(categories.map((c) => [c.id, c]));

        return okResult({
          ok: true,
          count: txs.length,
          transactions: txs.map((tx) => formatTransactionForMcp(tx, accountMap, categoryMap)),
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "update_finance_transaction",
    {
      title: "Исправить / изменить финансовую операцию (с точным пересчётом баланса счетов)",
      description:
        "Находит операцию по текстовому запросу query, сумме target_amount или дате target_date (без знания ID!) и обновляет любые её поля, атомарно откатывая старую дельту баланса и применяя новую.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Текст поиска операции (например, 'такси', 'кофе', 'продукты')"),
        target_amount: z
          .number()
          .positive()
          .optional()
          .describe("Прежняя сумма операции для точного выбора"),
        target_date: z
          .string()
          .optional()
          .describe("Дата операции YYYY-MM-DD или today/yesterday"),
        transaction_id: z.number().int().positive().optional().describe("Точный ID операции, если известен"),
        amount: z.number().positive().optional().describe("Новая сумма операции"),
        kind: z.enum(["expense", "income", "transfer", "reimbursement_in"]).optional(),
        description: z.string().max(500).optional().describe("Новое описание"),
        category: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Новая категория по названию/ID (null чтобы убрать)"),
        account: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Новый счёт списания/зачисления по названию или ID"),
        to_account: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Новый целевой счёт для перевода"),
        date: z.string().optional().describe("Новая дата операции YYYY-MM-DD"),
        time_msk: z.string().optional().describe("Новое время операции ЧЧ:ММ по МСК"),
        spend_nature: z
          .enum(["personal", "work_reimbursable", "shared_reimbursable"])
          .optional(),
        personal_share_amount: z.number().min(0).nullable().optional(),
        reimbursable_amount: z.number().min(0).optional(),
        reimbursement_counterparty: z.string().max(200).nullable().optional(),
        tags: z.array(z.string().min(1).max(60)).optional(),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const resolved = await resolveSingleTransactionTarget(db, {
          transaction_id: args.transaction_id,
          query: args.query,
          amount: args.target_amount,
          date: args.target_date,
        });

        if (resolved.error) return errResult(resolved.error);
        if (resolved.candidates) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько похожих операций. Уточни сумму, дату или transaction_id.",
            candidates: resolved.candidates,
          });
        }

        const current = resolved.transaction!;
        const patch: FinanceTransactionUpdate = {};

        if (args.amount !== undefined) patch.amount = args.amount;
        if (args.kind !== undefined) patch.kind = args.kind;
        if (args.description !== undefined) patch.description = args.description.trim();
        if (args.spend_nature !== undefined) patch.spend_nature = args.spend_nature;
        if (args.personal_share_amount !== undefined) {
          patch.personal_share_amount = args.personal_share_amount;
        }
        if (args.reimbursable_amount !== undefined) {
          patch.reimbursable_amount = args.reimbursable_amount;
        }
        if (args.reimbursement_counterparty !== undefined) {
          patch.reimbursement_counterparty = args.reimbursement_counterparty?.trim() || null;
        }
        if (args.tags !== undefined) patch.tags = args.tags;

        if (args.account !== undefined) {
          const { account } = await resolveAccountByFuzzyQuery(db, args.account);
          if (!account) return errResult(`Счёт «${args.account}» не найден.`);
          patch.account_id = account.id;
        }

        if (args.to_account !== undefined) {
          if (args.to_account === null || args.to_account === "") {
            patch.to_account_id = null;
          } else {
            const { account: dest } = await resolveAccountByFuzzyQuery(db, args.to_account);
            if (!dest) return errResult(`Целевой счёт «${args.to_account}» не найден.`);
            patch.to_account_id = dest.id;
          }
        }

        if (args.category !== undefined) {
          if (args.category === null || args.category === "") {
            patch.category_id = null;
          } else {
            const effectiveKind = (args.kind ?? current.kind) === "income" ? "income" : "expense";
            const { category } = await resolveCategoryByFuzzyQuery(db, args.category, effectiveKind);
            if (category) {
              patch.category_id = category.id;
            } else if (typeof args.category === "string" && args.category.trim().length > 0) {
              const createdCat = await upsertFinanceCategory(db, current.user_id, {
                name: args.category.trim(),
                kind: effectiveKind,
              });
              patch.category_id = createdCat.id;
            } else {
              return errResult(`Категория «${args.category}» не найдена.`);
            }
          }
        }

        if (args.date !== undefined || args.time_msk !== undefined) {
          const curMsk = extractLocalTimeParts(current.occurred_at, DEFAULT_TIMEZONE);
          patch.occurred_at = resolveOccurredIso({
            date: args.date ?? curMsk.dateStr,
            time_msk: args.time_msk ?? curMsk.timeStr,
          });
        }

        const updated = await updateFinanceTransaction(db, current.id, patch);
        const [accounts, categories, summary] = await Promise.all([
          listFinanceAccounts(db, true),
          listFinanceCategories(db, undefined, true),
          getFinanceBalanceSummary(db),
        ]);
        const accountMap = new Map(accounts.map((a) => [a.id, a]));
        const categoryMap = new Map(categories.map((c) => [c.id, c]));

        return okResult({
          ok: true,
          transaction: formatTransactionForMcp(updated, accountMap, categoryMap),
          updated_account_balance: accountMap.get(updated.account_id)?.balance ?? null,
          safe_to_spend: summary?.safe_to_spend ?? null,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "delete_finance_transaction",
    {
      title: "Удалить финансовую операцию (с возвратом суммы на баланс счёта)",
      description:
        "Находит операцию по тексту/сумме/дате или ID, откатывает её влияние на баланс счёта (и статус связанной компенсации) и удаляет запись.",
      inputSchema: {
        query: z.string().optional().describe("Описание операции для поиска"),
        amount: z.number().positive().optional().describe("Сумма операции для точного совпадения"),
        date: z.string().optional().describe("Дата операции YYYY-MM-DD или today/yesterday"),
        transaction_id: z.number().int().positive().optional().describe("Опциональный ID операции"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const resolved = await resolveSingleTransactionTarget(db, {
          transaction_id: args.transaction_id,
          query: args.query,
          amount: args.amount,
          date: args.date,
        });

        if (resolved.error) return errResult(resolved.error);
        if (resolved.candidates) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько операций. Уточни сумму, дату или transaction_id перед удалением.",
            candidates: resolved.candidates,
          });
        }

        const victim = resolved.transaction!;
        await deleteFinanceTransaction(db, victim.id);
        const [acc, summary] = await Promise.all([
          getFinanceAccount(db, victim.account_id),
          getFinanceBalanceSummary(db),
        ]);

        return okResult({
          ok: true,
          deleted_transaction: {
            id: victim.id,
            amount: Number(victim.amount),
            kind: victim.kind,
            description: victim.description,
          },
          restored_account_balance: acc ? Number(acc.balance) : null,
          safe_to_spend: summary?.safe_to_spend ?? null,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "settle_reimbursement",
    {
      title: "Зафиксировать возврат / компенсацию за рабочую или общую покупку",
      description:
        "Отмечает получение компенсации (например: «пришла компенсация за такси на Т-Банк» или «друг скинул половину за обед»), пополняет выбранный счёт и обновляет статус исходной траты (partial / settled), не искажая доходы и личные траты.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Поиск ожидающей возврата покупки по описанию или имени человека/компании"),
        expense_transaction_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Опциональный ID исходной траты под возврат"),
        target_account: z
          .union([z.string(), z.number()])
          .optional()
          .describe("На какой счёт пришли деньги (по названию или ID; по умолчанию счёт исходной оплаты)"),
        received_amount: z
          .number()
          .positive()
          .optional()
          .describe("Фактически полученная сумма (по умолчанию вся оставшаяся сумма к возврату)"),
        date: z.string().optional().describe("Дата получения компенсации YYYY-MM-DD (по умолчанию сегодня)"),
        note: z.string().max(300).optional().describe("Комментарий к компенсации"),
      },
    },
    async (args) => {
      try {
        const { db } = await getOwnerBotDbClient();
        const resolved = await resolveSingleTransactionTarget(db, {
          transaction_id: args.expense_transaction_id,
          query: args.query,
          kind: "expense",
          reimbursementPendingOnly: true,
        });

        if (resolved.error) return errResult(resolved.error);
        if (resolved.candidates) {
          return okResult({
            ok: false,
            needs_clarification: true,
            message: "Найдено несколько ожидающих компенсации покупок. Уточни запрос или expense_transaction_id.",
            candidates: resolved.candidates,
          });
        }

        let targetAccountId: number | undefined;
        if (args.target_account !== undefined) {
          const { account } = await resolveAccountByFuzzyQuery(db, args.target_account);
          if (!account) return errResult(`Счёт «${args.target_account}» не найден.`);
          targetAccountId = account.id;
        }

        const result = await settleReimbursement(db, {
          expenseTransactionId: resolved.transaction!.id,
          targetAccountId,
          receivedAmount: args.received_amount,
          occurredAt: args.date ? resolveOccurredIso({ date: args.date }) : undefined,
          note: args.note,
          source: "mcp",
        });

        const summary = await getFinanceBalanceSummary(db);
        return okResult({
          ok: true,
          reimbursement_transaction: result.reimbursementTx,
          updated_expense: {
            id: result.updatedExpenseTx.id,
            description: result.updatedExpenseTx.description,
            remaining_reimbursable: Number(result.updatedExpenseTx.reimbursable_amount),
            reimbursement_status: result.updatedExpenseTx.reimbursement_status,
          },
          safe_to_spend: summary?.safe_to_spend ?? null,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 3. ACCOUNTS, CREDIT CARDS & BALANCE VIEW MODE
  // ==========================================================================

  server.registerTool(
    "set_balance_view_mode",
    {
      title: "Переключить режим отображения главного баланса",
      description:
        "Меняет режим отображения баланса на сайте: safe_to_spend («Доступно для трат»), accounts («Отдельные счета») или total («Общая сумма»).",
      inputSchema: {
        mode: z.enum(["safe_to_spend", "accounts", "total"]),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        const profile = await setBalanceViewMode(db, userId, args.mode);
        const summary = await getFinanceBalanceSummary(db);
        return okResult({
          ok: true,
          balance_view_mode: profile.balance_view_mode,
          balance_summary: summary,
        });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "manage_finance_account",
    {
      title: "Управление счетами и кредитными картами",
      description:
        "Просмотр, создание, редактирование (баланс, защищённый резерв, кредитный лимит, долг по выписке, дата грейс-периода с авто-напоминанием в Telegram) или архивация счетов.",
      inputSchema: {
        action: z.enum(["list", "create", "update", "archive"]),
        account: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Название или ID счёта (для update / archive)"),
        name: z.string().min(1).max(150).optional().describe("Название счёта (для create или переименования в update)"),
        account_type: z
          .enum(["debit", "cash", "savings", "credit_card", "investment"])
          .optional(),
        currency: z.string().length(3).optional().describe("Валюта ISO (по умолчанию RUB)"),
        balance: z.number().optional().describe("Текущий баланс счёта"),
        protected_reserve: z
          .number()
          .min(0)
          .optional()
          .describe("Неснижаемый резерв на счёте (вычитается из Safe-to-Spend)"),
        credit_limit: z.number().min(0).nullable().optional().describe("Кредитный лимит (для credit_card)"),
        statement_debt: z
          .number()
          .min(0)
          .nullable()
          .optional()
          .describe("Текущий долг по кредитке (для беспроцентного погашения)"),
        grace_period_due_date: z
          .string()
          .nullable()
          .optional()
          .describe("Крайняя дата беспроцентного грейс-периода YYYY-MM-DD (автоматически поставит напоминание в Telegram)"),
        include_in_total: z.boolean().optional().describe("Учитывать в «Общей сумме»"),
        include_in_safe_to_spend: z
          .boolean()
          .optional()
          .describe("Учитывать в ликвидном «Доступно для трат» (по умолчанию false для кредиток и вкладов)"),
        include_archived: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        if (args.action === "list") {
          const [accounts, summary] = await Promise.all([
            listFinanceAccounts(db, args.include_archived ?? false),
            getFinanceBalanceSummary(db),
          ]);
          return okResult({ ok: true, count: accounts.length, accounts, balance_summary: summary });
        }

        if (args.action === "create") {
          if (!args.name?.trim()) return errResult("Укажи название счёта `name`.");
          const accType: FinanceAccountType = args.account_type ?? "debit";
          const created = await createFinanceAccount(db, {
            user_id: userId,
            name: args.name.trim(),
            account_type: accType,
            currency: (args.currency ?? "RUB").toUpperCase(),
            balance: args.balance ?? 0,
            protected_reserve: args.protected_reserve ?? 0,
            credit_limit: args.credit_limit ?? null,
            statement_debt: args.statement_debt ?? 0,
            grace_period_due_date: resolveDateInput(args.grace_period_due_date),
            include_in_total: args.include_in_total ?? true,
            include_in_safe_to_spend:
              args.include_in_safe_to_spend ??
              (accType === "debit" || accType === "cash"),
          });
          return okResult({ ok: true, account: created });
        }

        if (!args.account) {
          return errResult("Укажи `account` (название или ID счёта).");
        }
        const { account: target } = await resolveAccountByFuzzyQuery(db, args.account);
        if (!target) {
          return errResult(`Счёт «${args.account}» не найден.`);
        }

        if (args.action === "archive") {
          const res = await deleteOrArchiveFinanceAccount(db, target.id);
          return okResult({ ok: true, ...res });
        }

        const updated = await updateFinanceAccount(db, target.id, {
          name: args.name?.trim(),
          account_type: args.account_type,
          currency: args.currency?.toUpperCase(),
          balance: args.balance,
          protected_reserve: args.protected_reserve,
          credit_limit: args.credit_limit,
          statement_debt: args.statement_debt,
          grace_period_due_date:
            args.grace_period_due_date !== undefined
              ? resolveDateInput(args.grace_period_due_date)
              : undefined,
          include_in_total: args.include_in_total,
          include_in_safe_to_spend: args.include_in_safe_to_spend,
        });
        return okResult({ ok: true, account: updated });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 4. OBLIGATIONS / SUBSCRIPTIONS & MANDATORY RECURRING BILLS
  // ==========================================================================

  server.registerTool(
    "manage_finance_obligation",
    {
      title: "Управление обязательными платежами и подписками",
      description:
        "Просмотр, добавление, изменение, проведение оплаты (action='pay' — списывает расход, сдвигает дату следующего списания и ставит следующее напоминание в reminders_queue) или удаление подписок и регулярных счетов.",
      inputSchema: {
        action: z.enum(["list", "create", "update", "pay", "delete"]),
        query: z.string().optional().describe("Название подписки/платежа для поиска (без ID)"),
        obligation_id: z.number().int().positive().optional(),
        title: z.string().min(1).max(200).optional().describe("Название платежа/подписки"),
        obligation_kind: z
          .enum(["mandatory_bill", "subscription", "loan_installment"])
          .optional()
          .describe("Тип: mandatory_bill (ЖКХ/аренда/связь), subscription (сервис), loan_installment (кредит)"),
        amount: z.number().positive().optional().describe("Сумма регулярного платежа"),
        billing_period: z
          .enum(["weekly", "monthly", "quarterly", "yearly"])
          .optional()
          .describe("Периодичность (по умолчанию monthly)"),
        next_due_date: z
          .string()
          .optional()
          .describe("Дата ближайшего списания YYYY-MM-DD или today/tomorrow"),
        account: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Счёт списания по названию или ID"),
        category: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .describe("Категория расхода по названию или ID"),
        deduct_from_safe_to_spend: z
          .boolean()
          .optional()
          .describe("Резервировать ли сумму из Safe-to-Spend (по умолчанию true)"),
        remind_days_before: z
          .number()
          .int()
          .min(0)
          .max(30)
          .optional()
          .describe("За сколько дней прислать напоминание в Telegram (по умолчанию 2)"),
        is_active: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        if (args.action === "list") {
          const obligations = await listFinanceObligations(db, true);
          return okResult({ ok: true, count: obligations.length, obligations });
        }

        if (args.action === "create") {
          if (!args.title?.trim() || !args.amount) {
            return errResult("Для создания платежа/подписки укажи `title` и `amount`.");
          }
          const dueDate = resolveDateInput(args.next_due_date) ?? formatIsoDate();
          const accRes = args.account ? await resolveAccountByFuzzyQuery(db, args.account) : null;
          const catRes = await resolveCategoryByFuzzyQuery(
            db,
            args.category ?? (args.obligation_kind === "subscription" ? "Подписки и сервисы" : "Жильё и связь"),
            "expense"
          );

          const created = await createFinanceObligation(db, {
            user_id: userId,
            title: args.title.trim(),
            obligation_kind: (args.obligation_kind ?? "subscription") as FinanceObligationKind,
            amount: args.amount,
            currency: "RUB",
            billing_period: (args.billing_period ?? "monthly") as BillingPeriod,
            next_due_date: dueDate,
            account_id: accRes?.account?.id ?? null,
            category_id: catRes.category?.id ?? null,
            deduct_from_safe_to_spend: args.deduct_from_safe_to_spend ?? true,
            remind_days_before: args.remind_days_before ?? 2,
            is_active: args.is_active ?? true,
          });
          return okResult({ ok: true, obligation: created });
        }

        let targetId = args.obligation_id;
        if (!targetId) {
          if (!args.query?.trim() && !args.title?.trim()) {
            return errResult("Укажи `query` (название платежа) или `obligation_id`.");
          }
          const matches = await findObligationsByFuzzyQuery(
            db,
            (args.query ?? args.title)!.trim(),
            true
          );
          if (matches.length === 0) {
            return errResult(`Платёж/подписка «${args.query ?? args.title}» не найдена.`);
          }
          targetId = matches[0].item.id;
        }

        if (args.action === "delete") {
          await deleteFinanceObligation(db, targetId);
          return okResult({ ok: true, deleted_id: targetId });
        }

        if (args.action === "pay") {
          let payAccountId: number | undefined;
          if (args.account) {
            const { account } = await resolveAccountByFuzzyQuery(db, args.account);
            if (!account) return errResult(`Счёт «${args.account}» не найден.`);
            payAccountId = account.id;
          }
          const paid = await markObligationPaid(db, targetId, {
            accountId: payAccountId,
            amountOverride: args.amount,
            source: "mcp",
          });
          return okResult({
            ok: true,
            obligation: paid.obligation,
            recorded_transaction: paid.transaction,
          });
        }

        let nextAccId: number | null | undefined;
        if (args.account !== undefined) {
          if (args.account === null || args.account === "") nextAccId = null;
          else {
            const { account } = await resolveAccountByFuzzyQuery(db, args.account);
            nextAccId = account?.id;
          }
        }

        const updated = await updateFinanceObligation(db, targetId, {
          title: args.title?.trim(),
          obligation_kind: args.obligation_kind,
          amount: args.amount,
          billing_period: args.billing_period,
          next_due_date: args.next_due_date ? resolveDateInput(args.next_due_date) ?? undefined : undefined,
          account_id: nextAccId,
          deduct_from_safe_to_spend: args.deduct_from_safe_to_spend,
          remind_days_before: args.remind_days_before,
          is_active: args.is_active,
        });
        return okResult({ ok: true, obligation: updated });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 5. DEBTS & RECEIVABLES (`finance_debts`)
  // ==========================================================================

  server.registerTool(
    "manage_finance_debt",
    {
      title: "Управление долгами и займами («Я должен» / «Мне должны»)",
      description:
        "Просмотр, добавление, изменение, внесение частичного/полного платежа (action='pay' — обновляет остаток долга, закрывает при 0 и опционально проводит операцию по счёту) или удаление долгов.",
      inputSchema: {
        action: z.enum(["list", "create", "update", "pay", "delete"]),
        query: z.string().optional().describe("Поиск долга по имени человека/контрагента или названию"),
        debt_id: z.number().int().positive().optional(),
        direction: z
          .enum(["i_owe", "owed_to_me"])
          .optional()
          .describe("i_owe — я должен; owed_to_me — мне должны"),
        counterparty: z.string().max(150).optional().describe("Имя человека / контрагента"),
        title: z.string().max(250).optional().describe("За что долг / комментарий"),
        initial_amount: z.number().positive().optional().describe("Исходная сумма долга (для create)"),
        remaining_amount: z.number().min(0).optional().describe("Текущий остаток долга"),
        payment_amount: z
          .number()
          .positive()
          .optional()
          .describe("Сумма вносимого/полученного платежа (для action='pay')"),
        account: z
          .union([z.string(), z.number()])
          .optional()
          .describe("Счёт для отражения платежа по долгу (для action='pay')"),
        due_date: z
          .string()
          .nullable()
          .optional()
          .describe("Плановая дата возврата YYYY-MM-DD (синхронизирует напоминание в Telegram)"),
        reserve_in_safe_to_spend: z
          .boolean()
          .optional()
          .describe("Резервировать ли долг из Safe-to-Spend (для i_owe)"),
        status: z.enum(["open", "closed", "all"]).optional(),
        notes: z.string().max(1000).nullable().optional(),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        if (args.action === "list") {
          const debts = await listFinanceDebts(db, args.status ?? "all");
          return okResult({ ok: true, count: debts.length, debts });
        }

        if (args.action === "create") {
          if (!args.counterparty?.trim() || !args.initial_amount) {
            return errResult("Для создания записи долга укажи `counterparty` и `initial_amount`.");
          }
          const dir: DebtDirection = args.direction ?? "i_owe";
          const created = await createFinanceDebt(db, {
            user_id: userId,
            direction: dir,
            counterparty: args.counterparty.trim(),
            title: args.title?.trim() || "Личный расчёт",
            initial_amount: args.initial_amount,
            remaining_amount: args.remaining_amount ?? args.initial_amount,
            currency: "RUB",
            due_date: resolveDateInput(args.due_date),
            reserve_in_safe_to_spend: args.reserve_in_safe_to_spend ?? (dir === "i_owe"),
            status: "open",
            notes: args.notes?.trim() || null,
          });
          return okResult({ ok: true, debt: created });
        }

        let targetId = args.debt_id;
        if (!targetId) {
          const searchStr = args.query ?? args.counterparty ?? args.title;
          if (!searchStr?.trim()) {
            return errResult("Укажи `query` (имя контрагента / название) или `debt_id`.");
          }
          const matches = await findDebtsByFuzzyQuery(db, searchStr.trim(), "all");
          if (matches.length === 0) {
            return errResult(`Долг по запросу «${searchStr}» не найден.`);
          }
          targetId = matches[0].item.id;
        }

        if (args.action === "delete") {
          await deleteFinanceDebt(db, targetId);
          return okResult({ ok: true, deleted_id: targetId });
        }

        if (args.action === "pay") {
          if (!args.payment_amount) {
            return errResult("Для проведения платежа по долгу укажи `payment_amount`.");
          }
          let payAccountId: number | null = null;
          if (args.account !== undefined) {
            const { account } = await resolveAccountByFuzzyQuery(db, args.account);
            if (!account) return errResult(`Счёт «${args.account}» не найден.`);
            payAccountId = account.id;
          }
          const paid = await recordDebtPayment(db, targetId, {
            amount: args.payment_amount,
            accountId: payAccountId,
            note: args.notes ?? undefined,
            source: "mcp",
          });
          return okResult({ ok: true, debt: paid.debt, transaction: paid.transaction });
        }

        const updated = await updateFinanceDebt(db, targetId, {
          direction: args.direction,
          counterparty: args.counterparty?.trim(),
          title: args.title?.trim(),
          initial_amount: args.initial_amount,
          remaining_amount: args.remaining_amount,
          due_date: args.due_date !== undefined ? resolveDateInput(args.due_date) : undefined,
          reserve_in_safe_to_spend: args.reserve_in_safe_to_spend,
          status: args.status === "open" || args.status === "closed" ? args.status : undefined,
          notes: args.notes !== undefined ? args.notes?.trim() || null : undefined,
        });
        return okResult({ ok: true, debt: updated });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // ==========================================================================
  // 6. CATEGORIES, BUDGET LIMITS & VOICE ALIASES
  // ==========================================================================

  server.registerTool(
    "manage_finance_category",
    {
      title: "Управление категориями трат/доходов (список, создание, пакетное создание при онбординге, лимиты и голосовые синонимы)",
      description:
        "Просмотр, создание с нуля (`create` или пакетное `bulk_create` сразу 4–8 категорий во время онбординга), редактирование (`update`: название, месячный лимит `monthly_limit` / `monthly_budget`, голосовые синонимы `voice_aliases`) и удаление (`delete`) категорий трат и доходов.",
      inputSchema: {
        action: z
          .enum(["list", "create", "bulk_create", "update", "delete"])
          .describe("Действие: list, create, bulk_create, update, delete"),
        query: z.string().optional().describe("Название категории для нечёткого поиска (при update / delete)"),
        category_id: z.number().int().positive().optional().describe("Точный ID категории, если известен"),
        kind: z.enum(["expense", "income"]).optional().describe("Тип категории: expense (по умолчанию) или income"),
        name: z.string().min(1).max(120).optional().describe("Название категории (для create / update)"),
        monthly_limit: z.number().min(0).nullable().optional().describe("Месячный лимит бюджета в рублях"),
        monthly_budget: z.number().min(0).nullable().optional().describe("Алиас для monthly_limit"),
        voice_aliases: z
          .array(z.string().min(1).max(60))
          .optional()
          .describe("Ключевые слова для голосового парсера (например, ['такси', 'яндекс го', 'метро'])"),
        color_token: z
          .enum(["domain-finance", "domain-work", "domain-nutrition", "domain-health", "domain-mind"])
          .optional(),
        icon_name: z.string().max(40).optional(),
        categories: z
          .array(
            z.union([
              z.string().min(1).max(120),
              z.object({
                name: z.string().min(1).max(120).describe("Название категории"),
                kind: z.enum(["expense", "income"]).optional().describe("expense (по умолчанию) или income"),
                monthly_limit: z.number().min(0).nullable().optional(),
                monthly_budget: z.number().min(0).nullable().optional(),
                voice_aliases: z.array(z.string().min(1).max(60)).optional(),
                color_token: z.string().max(40).optional(),
                icon_name: z.string().max(40).optional(),
              }),
            ])
          )
          .optional()
          .describe(
            "Массив категорий для action='bulk_create' (строки вида 'Еда и продукты' или объекты с лимитами и синонимами)"
          ),
      },
    },
    async (args) => {
      try {
        const { db, userId } = await getOwnerBotDbClient();
        if (args.action === "list") {
          const cats = await listFinanceCategories(db, args.kind, false);
          return okResult({ ok: true, count: cats.length, categories: cats });
        }

        if (args.action === "bulk_create" || (args.action === "create" && args.categories?.length)) {
          const items = args.categories ?? (args.name?.trim() ? [args.name.trim()] : []);
          if (items.length === 0) {
            return errResult("Передай массив `categories` для пакетного создания категорий.");
          }

          const createdList: FinanceCategory[] = [];
          for (let i = 0; i < items.length; i += 1) {
            const raw = items[i];
            if (typeof raw === "string") {
              const saved = await upsertFinanceCategory(db, userId, {
                name: raw.trim(),
                kind: args.kind ?? "expense",
                sort_order: (i + 1) * 10,
              });
              createdList.push(saved);
            } else {
              const saved = await upsertFinanceCategory(db, userId, {
                name: raw.name.trim(),
                kind: raw.kind ?? args.kind ?? "expense",
                monthly_limit:
                  raw.monthly_limit !== undefined ? raw.monthly_limit : raw.monthly_budget,
                voice_aliases: raw.voice_aliases,
                color_token: raw.color_token,
                icon_name: raw.icon_name,
                sort_order: (i + 1) * 10,
              });
              createdList.push(saved);
            }
          }

          return okResult({
            ok: true,
            created_count: createdList.length,
            categories: createdList,
          });
        }

        if (args.action === "create") {
          if (!args.name?.trim()) return errResult("Укажи название категории `name`.");
          const created = await upsertFinanceCategory(db, userId, {
            name: args.name.trim(),
            kind: args.kind ?? "expense",
            monthly_limit:
              args.monthly_limit !== undefined ? args.monthly_limit : args.monthly_budget ?? null,
            voice_aliases: args.voice_aliases,
            color_token: args.color_token,
            icon_name: args.icon_name,
          });
          return okResult({ ok: true, category: created });
        }

        if (args.action === "delete") {
          const ref = args.category_id ?? args.query ?? args.name;
          if (!ref) return errResult("Укажи `query` (название категории) или `category_id`.");
          await deleteFinanceCategory(db, ref);
          return okResult({ ok: true, deleted_ref: ref });
        }

        // action === "update"
        let targetId = args.category_id;
        let existingCat: FinanceCategory | null = null;
        if (!targetId) {
          const searchStr = args.query ?? args.name;
          if (!searchStr?.trim()) return errResult("Укажи `query` или `category_id`.");
          const { category } = await resolveCategoryByFuzzyQuery(db, searchStr.trim(), args.kind);
          if (!category) return errResult(`Категория «${searchStr}» не найдена.`);
          targetId = category.id;
          existingCat = category;
        } else {
          const allCats = await listFinanceCategories(db, undefined, true);
          existingCat = allCats.find((c) => c.id === targetId) ?? null;
        }

        const updated = await upsertFinanceCategory(db, userId, {
          id: targetId,
          name: args.name?.trim() || existingCat?.name || "Категория",
          kind: args.kind ?? (existingCat?.kind as FinanceCategoryKind | undefined),
          monthly_limit:
            args.monthly_limit !== undefined ? args.monthly_limit : args.monthly_budget,
          voice_aliases: args.voice_aliases,
          color_token: args.color_token,
          icon_name: args.icon_name,
        });
        return okResult({ ok: true, category: updated });
      } catch (err) {
        return errResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
