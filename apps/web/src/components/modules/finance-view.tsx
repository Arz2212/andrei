"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  BanknoteIcon,
  BriefcaseIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CreditCardIcon,
  HandCoinsIcon,
  LandmarkIcon,
  Loader2Icon,
  PencilIcon,
  PiggyBankIcon,
  PlusIcon,
  ReceiptTextIcon,
  SearchIcon,
  ShieldCheckIcon,
  TagsIcon,
  Trash2Icon,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import type {
  BalanceViewMode,
  BillingPeriod,
  FinanceAccount,
  FinanceAccountType,
  FinanceDashboardData,
  FinanceDebt,
  FinanceMonthlyAnalytics,
  FinanceObligation,
  FinanceTransaction,
  FinanceTransactionKind,
} from "@life-os/db";
import {
  deleteFinanceTransactionAction,
  fetchFinanceMonthAnalyticsAction,
  markObligationPaidAction,
  setBalanceViewModeAction,
} from "@/app/finance-actions";
import {
  cn,
  formatDateLongRu,
  formatDateShortRu,
  formatRub,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AccountFormModal,
  CategoriesManageModal,
  DebtFormModal,
  DebtPaymentModal,
  ObligationFormModal,
  SettleReimbursementModal,
  TransactionFormModal,
} from "@/components/modules/finance-modals";

const ACCOUNT_TYPE_LABELS: Record<FinanceAccountType, string> = {
  debit: "Дебетовый счёт",
  cash: "Наличные",
  savings: "Накопительный резерв",
  credit_card: "Кредитная карта",
  investment: "Инвестиции",
};

const PERIOD_LABELS: Record<BillingPeriod, string> = {
  weekly: "еженедельно",
  monthly: "ежемесячно",
  quarterly: "раз в квартал",
  yearly: "раз в год",
};

const SOURCE_LABELS: Record<string, string> = {
  telegram_voice: "голос TG",
  telegram_photo: "чек TG",
  telegram_text: "TG",
  mcp: "ИИ",
  openclaw: "ИИ",
};

function formatMonthTitleRu(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  if (!y || !m) return monthIso;
  const dt = new Date(Date.UTC(y, m - 1, 15, 12, 0, 0));
  const raw = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(dt);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function shiftMonthIso(monthIso: string, deltaMonths: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const total = y * 12 + (m - 1) + deltaMonths;
  const nextY = Math.floor(total / 12);
  const nextM = ((total % 12) + 12) % 12 + 1;
  return `${nextY}-${String(nextM).padStart(2, "0")}`;
}

function diffDaysFromToday(targetIsoDate: string, todayIsoDate: string): number {
  const t = Date.parse(`${targetIsoDate}T12:00:00Z`);
  const n = Date.parse(`${todayIsoDate}T12:00:00Z`);
  return Math.round((t - n) / (24 * 60 * 60 * 1000));
}

function formatDueRelativeRu(dueIso: string, todayIso: string): {
  label: string;
  urgent: boolean;
  overdue: boolean;
} {
  const days = diffDaysFromToday(dueIso, todayIso);
  if (days < 0) {
    return {
      label: `просрочено на ${Math.abs(days)} дн.`,
      urgent: true,
      overdue: true,
    };
  }
  if (days === 0) return { label: "сегодня", urgent: true, overdue: false };
  if (days === 1) return { label: "завтра", urgent: true, overdue: false };
  if (days <= 5) return { label: `через ${days} дн.`, urgent: true, overdue: false };
  return { label: formatDateShortRu(dueIso), urgent: false, overdue: false };
}

function AccountTypeIcon({
  type,
  className,
}: {
  type: FinanceAccountType;
  className?: string;
}) {
  switch (type) {
    case "credit_card":
      return <CreditCardIcon className={className} />;
    case "savings":
      return <PiggyBankIcon className={className} />;
    case "cash":
      return <BanknoteIcon className={className} />;
    case "investment":
      return <TrendingUpIcon className={className} />;
    default:
      return <LandmarkIcon className={className} />;
  }
}

interface FinanceViewProps {
  todayDate: string;
  initialTab?: string;
  data: FinanceDashboardData;
}

export function FinanceView({ todayDate, initialTab, data }: FinanceViewProps) {
  const [pending, startTransition] = React.useTransition();

  const validTabs = ["overview", "transactions", "accounts", "obligations", "debts"];
  const [activeTab, setActiveTab] = React.useState<string>(
    initialTab && validTabs.includes(initialTab) ? initialTab : "overview"
  );

  // 3-Mode Balance Switcher (Safe-to-Spend | Accounts | Total)
  const savedMode = (data.profile?.balance_view_mode as BalanceViewMode) ?? "safe_to_spend";
  const [balanceMode, setBalanceMode] = React.useState<BalanceViewMode>(savedMode);
  React.useEffect(() => {
    setBalanceMode(savedMode);
  }, [savedMode]);

  function handleChangeBalanceMode(nextMode: BalanceViewMode) {
    setBalanceMode(nextMode);
    startTransition(async () => {
      try {
        await setBalanceViewModeAction(nextMode);
      } catch {
        toast.error("Не удалось сохранить режим отображения баланса");
      }
    });
  }

  // Monthly Analytics state (defaults to server-loaded month, supports switching months)
  const currentMonthIso = todayDate.slice(0, 7);
  const [selectedMonth, setSelectedMonth] = React.useState<string>(data.analytics.month);
  const [monthAnalytics, setMonthAnalytics] = React.useState<FinanceMonthlyAnalytics>(
    data.analytics
  );
  const [monthLoading, setMonthLoading] = React.useState(false);

  React.useEffect(() => {
    if (selectedMonth === data.analytics.month) {
      setMonthAnalytics(data.analytics);
    }
  }, [data.analytics, selectedMonth]);

  async function handleSelectMonth(nextMonth: string) {
    setSelectedMonth(nextMonth);
    if (nextMonth === data.analytics.month) {
      setMonthAnalytics(data.analytics);
      return;
    }
    setMonthLoading(true);
    try {
      const res = await fetchFinanceMonthAnalyticsAction(nextMonth);
      setMonthAnalytics(res);
    } catch {
      toast.error("Не удалось загрузить аналитику за выбранный месяц");
    } finally {
      setMonthLoading(false);
    }
  }

  // Transaction History Filters
  const [txSearch, setTxSearch] = React.useState("");
  const [txKindFilter, setTxKindFilter] = React.useState<string>("all");
  const [txAccountFilter, setTxAccountFilter] = React.useState<string>("all");
  const [txNatureFilter, setTxNatureFilter] = React.useState<string>("all");

  // Modals State
  const [txModalOpen, setTxModalOpen] = React.useState(false);
  const [editingTx, setEditingTx] = React.useState<FinanceTransaction | null>(null);
  const [txDefaultKind, setTxDefaultKind] =
    React.useState<FinanceTransactionKind>("expense");
  const [txDefaultFromAcc, setTxDefaultFromAcc] = React.useState<number | null>(null);
  const [txDefaultToAcc, setTxDefaultToAcc] = React.useState<number | null>(null);

  const [settleTx, setSettleTx] = React.useState<FinanceTransaction | null>(null);
  const [settleOpen, setSettleOpen] = React.useState(false);

  const [accModalOpen, setAccModalOpen] = React.useState(false);
  const [editingAcc, setEditingAcc] = React.useState<FinanceAccount | null>(null);

  const [oblModalOpen, setOblModalOpen] = React.useState(false);
  const [editingObl, setEditingObl] = React.useState<FinanceObligation | null>(null);

  const [debtModalOpen, setDebtModalOpen] = React.useState(false);
  const [editingDebt, setEditingDebt] = React.useState<FinanceDebt | null>(null);

  const [payDebt, setPayDebt] = React.useState<FinanceDebt | null>(null);
  const [payDebtOpen, setPayDebtOpen] = React.useState(false);

  const [categoriesOpen, setCategoriesOpen] = React.useState(false);

  function openCreateTransaction(
    kind: FinanceTransactionKind = "expense",
    fromAccountId: number | null = null,
    toAccountId: number | null = null
  ) {
    setEditingTx(null);
    setTxDefaultKind(kind);
    setTxDefaultFromAcc(fromAccountId);
    setTxDefaultToAcc(toAccountId);
    setTxModalOpen(true);
  }

  // Lookup maps
  const accountMap = React.useMemo(
    () => new Map(data.accounts.map((a) => [a.id, a])),
    [data.accounts]
  );
  const categoryMap = React.useMemo(
    () => new Map(data.categories.map((c) => [c.id, c])),
    [data.categories]
  );

  // Summary Metrics
  const summary = data.balanceSummary;
  const safeToSpend = Number(summary?.safe_to_spend ?? 0);
  const totalBalance = Number(summary?.total_balance ?? 0);
  const liquidBalance = Number(summary?.liquid_balance ?? 0);
  const protectedReserve = Number(summary?.total_protected_reserve ?? 0);
  const upcomingObligationsTotal = Number(summary?.upcoming_obligations_total ?? 0);
  const reservedDebtsTotal = Number(summary?.reserved_debts_total ?? 0);
  const creditGraceDebt = Number(summary?.credit_card_grace_debt ?? 0);
  const pendingReimbursements = Number(summary?.pending_reimbursements ?? 0);
  const owedToMeTotal = Number(summary?.owed_to_me_total ?? 0);

  const openDebts = React.useMemo(
    () => data.debts.filter((d) => d.status === "open"),
    [data.debts]
  );
  const closedDebts = React.useMemo(
    () => data.debts.filter((d) => d.status === "closed"),
    [data.debts]
  );
  const iOweOpenTotal = React.useMemo(
    () =>
      openDebts
        .filter((d) => d.direction === "i_owe")
        .reduce((s, d) => s + Number(d.remaining_amount ?? 0), 0),
    [openDebts]
  );

  const activeObligations = React.useMemo(
    () =>
      data.obligations
        .filter((o) => o.is_active)
        .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date)),
    [data.obligations]
  );
  const pausedObligations = React.useMemo(
    () => data.obligations.filter((o) => !o.is_active),
    [data.obligations]
  );
  const monthlyObligationsBurn = React.useMemo(
    () =>
      activeObligations.reduce((sum, o) => {
        const amt = Number(o.amount ?? 0);
        if (o.billing_period === "weekly") return sum + amt * 4.33;
        if (o.billing_period === "quarterly") return sum + amt / 3;
        if (o.billing_period === "yearly") return sum + amt / 12;
        return sum + amt;
      }, 0),
    [activeObligations]
  );

  // Filtered transactions
  const filteredTransactions = React.useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    return data.recentTransactions.filter((tx) => {
      if (txKindFilter !== "all" && tx.kind !== txKindFilter) return false;
      if (txAccountFilter !== "all") {
        const accId = Number(txAccountFilter);
        if (tx.account_id !== accId && tx.to_account_id !== accId) return false;
      }
      if (txNatureFilter === "personal" && tx.spend_nature !== "personal") {
        return false;
      }
      if (txNatureFilter === "reimbursable" && tx.spend_nature === "personal") {
        return false;
      }
      if (q) {
        const catName = tx.category_id
          ? categoryMap.get(tx.category_id)?.name ?? ""
          : "";
        const accName = accountMap.get(tx.account_id)?.name ?? "";
        const hay = [
          tx.description ?? "",
          tx.reimbursement_counterparty ?? "",
          catName,
          accName,
          ...(tx.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    data.recentTransactions,
    txSearch,
    txKindFilter,
    txAccountFilter,
    txNatureFilter,
    categoryMap,
    accountMap,
  ]);

  const groupedTransactions = React.useMemo(() => {
    const groups = new Map<string, FinanceTransaction[]>();
    for (const tx of filteredTransactions) {
      const dateKey = tx.occurred_at.slice(0, 10);
      const list = groups.get(dateKey) ?? [];
      list.push(tx);
      groups.set(dateKey, list);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredTransactions]);

  function handleMarkObligationPaid(obl: FinanceObligation) {
    startTransition(async () => {
      try {
        await markObligationPaidAction({
          id: obl.id,
          accountId: obl.account_id ?? null,
        });
        toast.success(`«${obl.title}» отмечен оплаченным`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка проведения платежа");
      }
    });
  }

  function handleDeleteTx(tx: FinanceTransaction) {
    startTransition(async () => {
      try {
        await deleteFinanceTransactionAction(tx.id);
        toast("Операция удалена, баланс пересчитан");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить операцию");
      }
    });
  }

  const reimbOutlayMonth =
    monthAnalytics.work_reimbursable_outlay_total +
    monthAnalytics.shared_reimbursable_outlay_total;

  const creditCardsWithDebt = data.accounts.filter(
    (a) => a.account_type === "credit_card" && Number(a.statement_debt ?? 0) > 0
  );

  const openActionCount =
    data.pendingReimbursementTransactions.length + openDebts.length;

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Финансы</h1>
          <p className="text-sm text-muted-foreground">
            Честный Safe-to-Spend, раздельный учёт рабочих трат и контроль кредитного грейса
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCategoriesOpen(true)}
            className="min-h-10 rounded-xl"
          >
            <TagsIcon data-icon="inline-start" />
            Категории
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openCreateTransaction("transfer")}
            className="min-h-10 rounded-xl"
          >
            <ArrowLeftRightIcon data-icon="inline-start" />
            Перевод
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => openCreateTransaction("expense")}
            className="min-h-10 rounded-xl"
          >
            <PlusIcon data-icon="inline-start" />
            Операция
          </Button>
        </div>
      </div>

      {/* Hero 3-Mode Balance Card */}
      <Card className="rounded-2xl border-border/90 shadow-none">
        <CardHeader className="flex flex-col items-start gap-3 pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <WalletIcon className="size-4 text-domain-finance" />
              <CardTitle className="text-base font-semibold tracking-tight">
                {balanceMode === "safe_to_spend"
                  ? "Доступно для трат (Safe-to-Spend)"
                  : balanceMode === "accounts"
                    ? "Отдельные счета и кредитный лимит"
                    : "Общий собственный капитал"}
              </CardTitle>
            </div>
            <CardDescription>
              {balanceMode === "safe_to_spend"
                ? "Свободные деньги без риска залезть в резервы, обязательные счета или беспроцентный грейс"
                : balanceMode === "accounts"
                  ? "Собственные счета и заёмный лимит кредитных карт показаны строго раздельно"
                  : "Чистая сумма твоих собственных средств по всем активным счетам"}
            </CardDescription>
          </div>

          <ToggleGroup
            type="single"
            value={balanceMode}
            onValueChange={(v) => {
              if (v === "safe_to_spend" || v === "accounts" || v === "total") {
                handleChangeBalanceMode(v);
              }
            }}
            variant="outline"
            spacing={1}
            className="w-full sm:w-auto"
          >
            <ToggleGroupItem
              value="safe_to_spend"
              className="min-h-10 flex-1 px-3 text-xs sm:flex-initial"
            >
              Доступно
            </ToggleGroupItem>
            <ToggleGroupItem
              value="accounts"
              className="min-h-10 flex-1 px-3 text-xs sm:flex-initial"
            >
              По счетам
            </ToggleGroupItem>
            <ToggleGroupItem
              value="total"
              className="min-h-10 flex-1 px-3 text-xs sm:flex-initial"
            >
              Общая сумма
            </ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {balanceMode === "safe_to_spend" ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                <div
                  className={cn(
                    "text-3xl font-semibold tracking-tight sm:text-4xl num-tabular",
                    safeToSpend < 0 && "text-destructive"
                  )}
                >
                  {formatRub(safeToSpend)}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {pendingReimbursements > 0 ? (
                    <button
                      type="button"
                      onClick={() => setActiveTab("debts")}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-muted/50 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted num-tabular"
                    >
                      <BriefcaseIcon className="size-3.5 text-domain-work" />
                      Жду компенсаций: {formatRub(pendingReimbursements)}
                    </button>
                  ) : null}
                  {owedToMeTotal > 0 ? (
                    <button
                      type="button"
                      onClick={() => setActiveTab("debts")}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-muted/50 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted num-tabular"
                    >
                      <HandCoinsIcon className="size-3.5 text-domain-finance" />
                      Мне должны: {formatRub(owedToMeTotal)}
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Transparent Safe-to-Spend Formula Breakdown */}
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <div className="flex flex-col gap-0.5 rounded-xl bg-muted/55 p-3">
                  <span className="text-xs text-muted-foreground">
                    Ликвидные средства
                  </span>
                  <span className="text-sm font-semibold num-tabular">
                    {formatRub(liquidBalance)}
                  </span>
                </div>

                <div className="flex flex-col gap-0.5 rounded-xl bg-muted/55 p-3">
                  <span className="text-xs text-muted-foreground">
                    Защитный резерв
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground num-tabular">
                    − {formatRub(protectedReserve)}
                  </span>
                </div>

                <div className="flex flex-col gap-0.5 rounded-xl bg-muted/55 p-3">
                  <span className="text-xs text-muted-foreground">
                    Платежи и подписки (30 дн.)
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground num-tabular">
                    − {formatRub(upcomingObligationsTotal)}
                  </span>
                </div>

                <div className="flex flex-col gap-0.5 rounded-xl bg-muted/55 p-3">
                  <span className="text-xs text-muted-foreground">
                    Грейс кредитки и долги
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground num-tabular">
                    − {formatRub(creditGraceDebt + reservedDebtsTotal)}
                  </span>
                </div>
              </div>
            </>
          ) : null}

          {balanceMode === "accounts" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.accounts.map((acc) => {
                const isCredit = acc.account_type === "credit_card";
                const limit = Number(acc.credit_limit ?? 0);
                const debt = Number(acc.statement_debt ?? 0);
                const availCredit = Math.max(0, limit - debt);
                const reserve = Number(acc.protected_reserve ?? 0);

                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => {
                      setEditingAcc(acc);
                      setAccModalOpen(true);
                    }}
                    className="flex flex-col justify-between gap-2.5 rounded-xl border border-border/80 bg-background/60 p-3.5 text-left transition-colors hover:bg-muted/45"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <AccountTypeIcon
                          type={acc.account_type as FinanceAccountType}
                          className="size-4 shrink-0 text-domain-finance"
                        />
                        <span className="truncate text-sm font-medium">
                          {acc.name}
                        </span>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[11px]">
                        {isCredit
                          ? "Кредитка"
                          : ACCOUNT_TYPE_LABELS[acc.account_type as FinanceAccountType]}
                      </Badge>
                    </div>

                    {isCredit ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs text-muted-foreground">
                            Доступно из лимита
                          </span>
                          <span className="text-base font-semibold num-tabular">
                            {formatRub(availCredit)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground num-tabular">
                          <span>
                            Долг: {formatRub(debt)} из {formatRub(limit)}
                          </span>
                          {acc.grace_period_due_date && debt > 0 ? (
                            <span className="font-medium text-foreground">
                              грейс до {formatDateShortRu(acc.grace_period_due_date)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="text-lg font-semibold tracking-tight num-tabular">
                          {formatRub(acc.balance)}
                        </span>
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground num-tabular">
                          <span>
                            {reserve > 0
                              ? `Резерв: ${formatRub(reserve)}`
                              : acc.include_in_safe_to_spend
                                ? "Учитывается в Safe-to-Spend"
                                : "Отдельный целевой резерв"}
                          </span>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}

          {balanceMode === "total" ? (
            <div className="flex flex-col gap-3">
              <div className="text-3xl font-semibold tracking-tight sm:text-4xl num-tabular">
                {formatRub(totalBalance)}
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="flex flex-col gap-0.5 rounded-xl bg-muted/55 p-3">
                  <span className="text-xs text-muted-foreground">
                    Свободно для трат (Safe-to-Spend)
                  </span>
                  <span className="text-sm font-semibold num-tabular">
                    {formatRub(safeToSpend)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 rounded-xl bg-muted/55 p-3">
                  <span className="text-xs text-muted-foreground">
                    Жду компенсаций (работа и общие чеки)
                  </span>
                  <span className="text-sm font-semibold num-tabular">
                    {formatRub(pendingReimbursements)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 rounded-xl bg-muted/55 p-3">
                  <span className="text-xs text-muted-foreground">
                    Дебиторка (мне должны по займам)
                  </span>
                  <span className="text-sm font-semibold num-tabular">
                    {formatRub(owedToMeTotal)}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Main Module Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Обзор и аналитика</TabsTrigger>
          <TabsTrigger value="transactions" className="gap-1.5">
            Операции
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] num-tabular">
              {data.recentTransactions.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-1.5">
            Счета и кредитка
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] num-tabular">
              {data.accounts.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="obligations" className="gap-1.5">
            Подписки и платежи
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] num-tabular">
              {activeObligations.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="debts" className="gap-1.5">
            Долги и возвраты
            {openActionCount > 0 ? (
              <Badge className="px-1.5 py-0 text-[11px] num-tabular">
                {openActionCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* TAB 1: OVERVIEW & ANALYTICS                                      */}
        {/* ================================================================ */}
        <TabsContent value="overview" className="mt-4 flex flex-col gap-5">
          {/* Month Switcher Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/80 bg-card px-3.5 py-2.5">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleSelectMonth(shiftMonthIso(selectedMonth, -1))}
                aria-label="Предыдущий месяц"
                className="size-9 rounded-xl"
              >
                <ChevronLeftIcon />
              </Button>
              <span className="min-w-[140px] text-center text-sm font-semibold tracking-tight num-tabular">
                {formatMonthTitleRu(selectedMonth)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => handleSelectMonth(shiftMonthIso(selectedMonth, 1))}
                aria-label="Следующий месяц"
                className="size-9 rounded-xl"
              >
                <ChevronRightIcon />
              </Button>
              {monthLoading ? (
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {selectedMonth !== currentMonthIso ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleSelectMonth(currentMonthIso)}
                  className="rounded-xl text-xs"
                >
                  Текущий месяц
                </Button>
              ) : null}
              <span className="text-xs text-muted-foreground">
                Рабочие и чужие траты изолированы от личной статистики
              </span>
            </div>
          </div>

          {/* 4 Monthly KPI Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="rounded-2xl shadow-none">
              <CardHeader className="pb-2">
                <CardDescription>Личные расходы за месяц</CardDescription>
                <CardTitle className="text-2xl font-semibold tracking-tight num-tabular">
                  {formatRub(monthAnalytics.personal_expense_total)}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground num-tabular">
                Валовой отток по картам: {formatRub(monthAnalytics.gross_outflow_total)}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-none">
              <CardHeader className="pb-2">
                <CardDescription>Доходы за месяц</CardDescription>
                <CardTitle className="text-2xl font-semibold tracking-tight text-domain-finance num-tabular">
                  + {formatRub(monthAnalytics.income_total)}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground num-tabular">
                Получено компенсаций: {formatRub(monthAnalytics.reimbursements_received_total)}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-none">
              <CardHeader className="pb-2">
                <CardDescription>Чистый личный поток</CardDescription>
                <CardTitle
                  className={cn(
                    "text-2xl font-semibold tracking-tight num-tabular",
                    monthAnalytics.net_personal_cashflow >= 0
                      ? "text-domain-finance"
                      : "text-destructive"
                  )}
                >
                  {monthAnalytics.net_personal_cashflow >= 0 ? "+ " : "− "}
                  {formatRub(Math.abs(monthAnalytics.net_personal_cashflow))}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                Доходы минус только твоя доля расходов
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-none">
              <CardHeader className="pb-2">
                <CardDescription>Под возврат (вне аналитики)</CardDescription>
                <CardTitle className="text-2xl font-semibold tracking-tight num-tabular">
                  {formatRub(reimbOutlayMonth)}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground num-tabular">
                Работа: {formatRub(monthAnalytics.work_reimbursable_outlay_total)} · Общие:{" "}
                {formatRub(monthAnalytics.shared_reimbursable_outlay_total)}
              </CardContent>
            </Card>
          </div>

          {/* Category Breakdown + Upcoming Obligations & Reimbursements */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Left: Personal Category Breakdown */}
            <Card className="rounded-2xl shadow-none lg:col-span-7">
              <CardHeader className="flex flex-col items-start gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-0.5">
                  <CardTitle className="text-base font-semibold tracking-tight">
                    Структура личных расходов
                  </CardTitle>
                  <CardDescription>
                    Рабочие закупки (0 ₽ личной доли) не искажают бюджеты категорий
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openCreateTransaction("expense")}
                  className="rounded-xl"
                >
                  <PlusIcon data-icon="inline-start" />
                  Расход
                </Button>
              </CardHeader>

              <CardContent className="flex flex-col gap-3.5">
                {monthAnalytics.by_category.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    За {formatMonthTitleRu(selectedMonth).toLowerCase()} пока нет записанных расходов.
                  </div>
                ) : (
                  monthAnalytics.by_category.map((cat) => {
                    const shareOfMonth =
                      monthAnalytics.personal_expense_total > 0
                        ? Math.round(
                            (cat.personal_spent /
                              monthAnalytics.personal_expense_total) *
                              100
                          )
                        : 0;
                    const barWidth =
                      cat.limit_usage_percent !== null
                        ? Math.min(100, Math.max(2, cat.limit_usage_percent))
                        : Math.min(100, Math.max(4, shareOfMonth));
                    const isOverLimit =
                      cat.limit_usage_percent !== null &&
                      cat.limit_usage_percent > 100;
                    const isWarnLimit =
                      cat.limit_usage_percent !== null &&
                      cat.limit_usage_percent >= 80 &&
                      cat.limit_usage_percent <= 100;

                    return (
                      <div
                        key={String(cat.category_id ?? "uncat")}
                        className="flex flex-col gap-1.5 rounded-xl border border-border/75 bg-background/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {cat.category_name}
                              </span>
                              <span className="text-xs text-muted-foreground num-tabular">
                                {cat.transactions_count} оп.
                              </span>
                              {cat.reimbursable_spent > 0 ? (
                                <Badge variant="secondary" className="text-[11px] num-tabular">
                                  + {formatRub(cat.reimbursable_spent)} под возврат
                                </Badge>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-0.5 num-tabular">
                            <span className="text-sm font-semibold">
                              {formatRub(cat.personal_spent)}
                            </span>
                            {cat.monthly_limit ? (
                              <span
                                className={cn(
                                  "text-[11px]",
                                  isOverLimit
                                    ? "font-medium text-destructive"
                                    : "text-muted-foreground"
                                )}
                              >
                                из {formatRub(cat.monthly_limit)} ({cat.limit_usage_percent}%)
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">
                                {shareOfMonth}% личных трат
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              isOverLimit
                                ? "bg-destructive"
                                : isWarnLimit
                                  ? "bg-warning"
                                  : "bg-domain-finance"
                            )}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            {/* Right: Upcoming Bills, Credit Grace & Pending Reimbursements */}
            <div className="flex flex-col gap-4 lg:col-span-5">
              {/* Credit Card Grace & Upcoming Obligations */}
              <Card className="rounded-2xl shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base font-semibold tracking-tight">
                      Календарь платежей и грейса
                    </CardTitle>
                    <CalendarClockIcon className="size-4 text-primary" />
                  </div>
                  <CardDescription>
                    Напоминания приходят в Telegram заранее без срывов грейс-периода
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col gap-2.5">
                  {creditCardsWithDebt.map((cc) => (
                    <div
                      key={cc.id}
                      className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-accent/50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            <CreditCardIcon className="size-3.5 text-primary" />
                            {cc.name}
                          </span>
                          <span className="text-xs text-muted-foreground num-tabular">
                            {cc.grace_period_due_date
                              ? `Беспроцентный грейс до ${formatDateShortRu(cc.grace_period_due_date)}`
                              : "Грейс-дата не задана"}
                          </span>
                        </div>
                        <span className="shrink-0 text-sm font-semibold num-tabular">
                          {formatRub(cc.statement_debt)}
                        </span>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            openCreateTransaction("transfer", null, cc.id)
                          }
                          className="rounded-lg"
                        >
                          Погасить переводом
                        </Button>
                      </div>
                    </div>
                  ))}

                  {activeObligations.slice(0, 4).map((obl) => {
                    const rel = formatDueRelativeRu(obl.next_due_date, todayDate);
                    return (
                      <div
                        key={obl.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border/75 p-3"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">
                            {obl.title}
                          </span>
                          <span
                            className={cn(
                              "text-xs num-tabular",
                              rel.overdue
                                ? "font-medium text-destructive"
                                : rel.urgent
                                  ? "font-medium text-foreground"
                                  : "text-muted-foreground"
                            )}
                          >
                            {rel.label} · {PERIOD_LABELS[obl.billing_period as BillingPeriod]}
                          </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-sm font-semibold num-tabular">
                            {formatRub(obl.amount)}
                          </span>
                          <Button
                            type="button"
                            size="xs"
                            variant="secondary"
                            disabled={pending}
                            onClick={() => handleMarkObligationPaid(obl)}
                            className="min-h-8 rounded-lg"
                          >
                            Оплачено
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  {creditCardsWithDebt.length === 0 &&
                  activeObligations.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                      Активных регулярных счетов или долга по кредитке сейчас нет.
                    </div>
                  ) : null}
                </CardContent>

                <CardFooter className="justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <span className="num-tabular">
                    Нагрузка в месяц: ~{formatRub(monthlyObligationsBurn)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab("obligations")}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    Все платежи
                  </button>
                </CardFooter>
              </Card>

              {/* Quick Pending Reimbursements Card */}
              <Card className="rounded-2xl shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base font-semibold tracking-tight">
                      Ожидают возврата
                    </CardTitle>
                    <Badge variant="secondary" className="num-tabular">
                      {formatRub(pendingReimbursements)}
                    </Badge>
                  </div>
                  <CardDescription>
                    Рабочие расходы и общие счета с друзьями до получения перевода
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col gap-2">
                  {data.pendingReimbursementTransactions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                      Незакрытых компенсаций нет — все рабочие и общие чеки рассчитаны.
                    </div>
                  ) : (
                    data.pendingReimbursementTransactions.slice(0, 4).map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between gap-2.5 rounded-xl border border-border/75 p-3"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">
                            {tx.description || "Расход под возврат"}
                          </span>
                          <span className="truncate text-xs text-muted-foreground num-tabular">
                            {tx.reimbursement_counterparty
                              ? `${tx.reimbursement_counterparty} · `
                              : ""}
                            {formatDateShortRu(tx.occurred_at)}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-sm font-semibold num-tabular">
                            {formatRub(tx.reimbursable_amount)}
                          </span>
                          <Button
                            type="button"
                            size="xs"
                            onClick={() => {
                              setSettleTx(tx);
                              setSettleOpen(true);
                            }}
                            className="min-h-8 rounded-lg"
                          >
                            Вернули
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 2: TRANSACTIONS & EDITABLE LEDGER                            */}
        {/* ================================================================ */}
        <TabsContent value="transactions" className="mt-4 flex flex-col gap-4">
          {/* Filter Bar */}
          <Card className="rounded-2xl shadow-none">
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={txSearch}
                    onChange={(e) => setTxSearch(e.target.value)}
                    placeholder="Поиск по названию, контрагенту, категории или тегу…"
                    className="min-h-10 pl-9"
                  />
                </div>

                <ToggleGroup
                  type="single"
                  value={txKindFilter}
                  onValueChange={(v) => v && setTxKindFilter(v)}
                  variant="outline"
                  spacing={1}
                  className="flex flex-wrap justify-start"
                >
                  <ToggleGroupItem value="all" className="min-h-10 px-2.5 text-xs">
                    Все
                  </ToggleGroupItem>
                  <ToggleGroupItem value="expense" className="min-h-10 px-2.5 text-xs">
                    Расходы
                  </ToggleGroupItem>
                  <ToggleGroupItem value="income" className="min-h-10 px-2.5 text-xs">
                    Доходы
                  </ToggleGroupItem>
                  <ToggleGroupItem value="transfer" className="min-h-10 px-2.5 text-xs">
                    Переводы
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="reimbursement_in"
                    className="min-h-10 px-2.5 text-xs"
                  >
                    Возвраты
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Select value={txAccountFilter} onValueChange={setTxAccountFilter}>
                  <SelectTrigger className="min-h-10 w-full">
                    <SelectValue placeholder="Все счета" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">Все счета</SelectItem>
                      {data.accounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <Select value={txNatureFilter} onValueChange={setTxNatureFilter}>
                  <SelectTrigger className="min-h-10 w-full">
                    <SelectValue placeholder="Характер операций" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">Личные и под возврат</SelectItem>
                      <SelectItem value="personal">Только личные</SelectItem>
                      <SelectItem value="reimbursable">
                        Рабочие и общие (под возврат)
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Grouped Ledger */}
          {groupedTransactions.length === 0 ? (
            <Card className="rounded-2xl shadow-none">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <ReceiptTextIcon className="size-8 text-muted-foreground/60" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Операции не найдены</p>
                  <p className="text-xs text-muted-foreground">
                    Добавь операцию кнопкой выше или отправь голосовое / фото чека в Telegram.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openCreateTransaction("expense")}
                  className="rounded-xl"
                >
                  <PlusIcon data-icon="inline-start" />
                  Записать операцию
                </Button>
              </CardContent>
            </Card>
          ) : (
            groupedTransactions.map(([dateIso, items]) => {
              const dayHeader =
                dateIso === todayDate
                  ? "Сегодня"
                  : formatDateLongRu(dateIso);

              return (
                <div key={dateIso} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
                    <span>{dayHeader}</span>
                    <span className="num-tabular">{items.length} оп.</span>
                  </div>

                  <Card className="overflow-hidden rounded-2xl py-0 shadow-none">
                    <div className="divide-y divide-border/70">
                      {items.map((tx) => {
                        const fromAcc = accountMap.get(tx.account_id);
                        const toAcc = tx.to_account_id
                          ? accountMap.get(tx.to_account_id)
                          : null;
                        const cat = tx.category_id
                          ? categoryMap.get(tx.category_id)
                          : null;
                        const isIncome =
                          tx.kind === "income" || tx.kind === "reimbursement_in";
                        const isTransfer = tx.kind === "transfer";
                        const hasPendingReimb =
                          tx.kind === "expense" &&
                          (tx.reimbursement_status === "pending" ||
                            tx.reimbursement_status === "partial");
                        const srcBadge = SOURCE_LABELS[tx.source];

                        const titleText =
                          tx.description ||
                          (isTransfer
                            ? "Перевод между счетами"
                            : tx.kind === "reimbursement_in"
                              ? "Возврат расходов"
                              : cat?.name ?? "Операция");

                        return (
                          <div
                            key={tx.id}
                            className="flex flex-col gap-2.5 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-medium leading-snug">
                                  {titleText}
                                </span>

                                {cat && tx.description ? (
                                  <Badge variant="secondary" className="text-[11px]">
                                    {cat.name}
                                  </Badge>
                                ) : null}

                                {tx.spend_nature === "work_reimbursable" ? (
                                  <Badge variant="outline" className="gap-1 text-[11px]">
                                    <BriefcaseIcon className="size-3 text-domain-work" />
                                    Рабочий расход
                                  </Badge>
                                ) : null}

                                {tx.spend_nature === "shared_reimbursable" ? (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 text-[11px] num-tabular"
                                  >
                                    <UsersIcon className="size-3 text-primary" />
                                    Своя доля: {formatRub(tx.personal_share_amount)}
                                  </Badge>
                                ) : null}

                                {hasPendingReimb ? (
                                  <Badge className="text-[11px] num-tabular">
                                    Жду возврат {formatRub(tx.reimbursable_amount)}
                                  </Badge>
                                ) : tx.reimbursement_status === "settled" ? (
                                  <Badge variant="secondary" className="text-[11px]">
                                    Компенсировано
                                  </Badge>
                                ) : null}

                                {tx.is_edited ? (
                                  <span className="text-[11px] text-muted-foreground">
                                    испр.
                                  </span>
                                ) : null}

                                {srcBadge ? (
                                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {srcBadge}
                                  </span>
                                ) : null}
                              </div>

                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  {fromAcc?.name ?? "Счёт"}
                                  {toAcc ? (
                                    <>
                                      <ArrowRightIcon className="size-3" />
                                      {toAcc.name}
                                    </>
                                  ) : null}
                                </span>

                                {tx.reimbursement_counterparty ? (
                                  <span>· Контрагент: {tx.reimbursement_counterparty}</span>
                                ) : null}
                              </div>
                            </div>

                            {/* Amount + Actions */}
                            <div className="flex items-center justify-between gap-2 sm:justify-end">
                              <span
                                className={cn(
                                  "text-base font-semibold tracking-tight num-tabular",
                                  isIncome
                                    ? "text-domain-finance"
                                    : isTransfer
                                      ? "text-muted-foreground"
                                      : "text-foreground"
                                )}
                              >
                                {isIncome ? "+ " : isTransfer ? "⇄ " : "− "}
                                {formatRub(tx.amount)}
                              </span>

                              <div className="flex items-center gap-1">
                                {hasPendingReimb ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="secondary"
                                    onClick={() => {
                                      setSettleTx(tx);
                                      setSettleOpen(true);
                                    }}
                                    className="min-h-9 rounded-lg"
                                  >
                                    Вернули
                                  </Button>
                                ) : null}

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => {
                                    setEditingTx(tx);
                                    setTxModalOpen(true);
                                  }}
                                  aria-label="Редактировать операцию"
                                  className="size-10 rounded-xl sm:size-9"
                                >
                                  <PencilIcon className="size-3.5" />
                                </Button>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  disabled={pending}
                                  onClick={() => handleDeleteTx(tx)}
                                  aria-label="Удалить операцию"
                                  className="size-10 rounded-xl text-muted-foreground hover:text-destructive sm:size-9"
                                >
                                  <Trash2Icon className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </div>
              );
            })
          )}
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 3: ACCOUNTS & CREDIT CARDS                                   */}
        {/* ================================================================ */}
        <TabsContent value="accounts" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Настрой собственные счета, защитные резервы и беспроцентный период кредиток
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditingAcc(null);
                setAccModalOpen(true);
              }}
              className="min-h-10 self-start rounded-xl sm:self-auto"
            >
              <PlusIcon data-icon="inline-start" />
              Добавить счёт
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {data.accounts.map((acc) => {
              const isCredit = acc.account_type === "credit_card";
              const limit = Number(acc.credit_limit ?? 0);
              const debt = Number(acc.statement_debt ?? 0);
              const availCredit = Math.max(0, limit - debt);
              const usedPct =
                limit > 0 ? Math.min(100, Math.round((debt / limit) * 100)) : 0;
              const reserve = Number(acc.protected_reserve ?? 0);
              const freeOwn = Math.max(0, Number(acc.balance) - reserve);

              return (
                <Card
                  key={acc.id}
                  className="flex flex-col justify-between rounded-2xl shadow-none"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                          <AccountTypeIcon
                            type={acc.account_type as FinanceAccountType}
                            className="size-4"
                          />
                        </div>
                        <div className="flex flex-col">
                          <CardTitle className="text-base font-semibold tracking-tight">
                            {acc.name}
                          </CardTitle>
                          <CardDescription>
                            {ACCOUNT_TYPE_LABELS[acc.account_type as FinanceAccountType]}
                          </CardDescription>
                        </div>
                      </div>

                      {isCredit ? (
                        <Badge variant="outline">Лимит банка</Badge>
                      ) : acc.include_in_safe_to_spend ? (
                        <Badge variant="secondary">В Safe-to-Spend</Badge>
                      ) : (
                        <Badge variant="outline">Целевой резерв</Badge>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-col gap-3">
                    {isCredit ? (
                      <>
                        <div className="grid grid-cols-2 gap-2.5 rounded-xl bg-muted/55 p-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground">
                              Доступный лимит
                            </span>
                            <span className="text-lg font-semibold num-tabular">
                              {formatRub(availCredit)}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground">
                              Долг по выписке
                            </span>
                            <span
                              className={cn(
                                "text-lg font-semibold num-tabular",
                                debt > 0 ? "text-destructive" : "text-foreground"
                              )}
                            >
                              {formatRub(debt)}
                            </span>
                          </div>
                        </div>

                        {limit > 0 ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-xs text-muted-foreground num-tabular">
                              <span>Использовано {usedPct}%</span>
                              <span>Лимит {formatRub(limit)}</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${usedPct}%` }}
                              />
                            </div>
                          </div>
                        ) : null}

                        <div className="flex items-center justify-between text-xs text-muted-foreground num-tabular">
                          <span>Беспроцентный грейс-период:</span>
                          <span className="font-medium text-foreground">
                            {acc.grace_period_due_date
                              ? `до ${formatDateShortRu(acc.grace_period_due_date)}`
                              : "не указан"}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-2xl font-semibold tracking-tight num-tabular">
                          {formatRub(acc.balance)}
                        </div>

                        <div className="grid grid-cols-2 gap-2.5 rounded-xl bg-muted/55 p-3 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">
                              Неснижаемый резерв
                            </span>
                            <span className="text-sm font-medium num-tabular">
                              {formatRub(reserve)}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">
                              Свободный остаток
                            </span>
                            <span className="text-sm font-medium num-tabular">
                              {formatRub(freeOwn)}
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>

                  <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
                    {isCredit ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          openCreateTransaction("transfer", null, acc.id)
                        }
                        className="rounded-xl"
                      >
                        <ArrowLeftRightIcon data-icon="inline-start" />
                        Погасить с карты
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          openCreateTransaction("expense", acc.id, null)
                        }
                        className="rounded-xl"
                      >
                        <PlusIcon data-icon="inline-start" />
                        Операция по счёту
                      </Button>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingAcc(acc);
                        setAccModalOpen(true);
                      }}
                      className="rounded-xl"
                    >
                      <PencilIcon data-icon="inline-start" />
                      Настроить
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 4: OBLIGATIONS & SUBSCRIPTIONS                               */}
        {/* ================================================================ */}
        <TabsContent value="obligations" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">
                  Регулярная нагрузка в месяц
                </span>
                <span className="text-lg font-semibold num-tabular">
                  ~{formatRub(monthlyObligationsBurn)}
                </span>
              </div>
              <Separator orientation="vertical" className="hidden h-8 sm:block" />
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">
                  Вычтено из Safe-to-Spend (ближайшие 30 дн.)
                </span>
                <span className="text-lg font-semibold num-tabular">
                  {formatRub(upcomingObligationsTotal)}
                </span>
              </div>
            </div>

            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditingObl(null);
                setOblModalOpen(true);
              }}
              className="min-h-10 self-start rounded-xl sm:self-auto"
            >
              <PlusIcon data-icon="inline-start" />
              Добавить платёж
            </Button>
          </div>

          {activeObligations.length === 0 ? (
            <Card className="rounded-2xl shadow-none">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Регулярных платежей и подписок пока нет. Добавь аренду, связь или сервисы, чтобы Safe-to-Spend резервировал деньги заранее.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {activeObligations.map((obl) => {
                const rel = formatDueRelativeRu(obl.next_due_date, todayDate);
                const acc = obl.account_id ? accountMap.get(obl.account_id) : null;

                return (
                  <Card
                    key={obl.id}
                    className="flex flex-col justify-between rounded-2xl shadow-none"
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <CardTitle className="truncate text-base font-semibold">
                            {obl.title}
                          </CardTitle>
                          <CardDescription className="num-tabular">
                            Следующее списание: {formatDateShortRu(obl.next_due_date)} ({rel.label})
                          </CardDescription>
                        </div>
                        <span className="shrink-0 text-lg font-semibold num-tabular">
                          {formatRub(obl.amount)}
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="flex flex-wrap items-center gap-1.5 pt-1">
                      <Badge variant="secondary">
                        {PERIOD_LABELS[obl.billing_period as BillingPeriod]}
                      </Badge>
                      {obl.deduct_from_safe_to_spend ? (
                        <Badge variant="outline" className="gap-1">
                          <ShieldCheckIcon className="size-3 text-primary" />
                          Резерв в Safe-to-Spend
                        </Badge>
                      ) : null}
                      {acc ? (
                        <Badge variant="outline">{acc.name}</Badge>
                      ) : null}
                    </CardContent>

                    <CardFooter className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending}
                        onClick={() => handleMarkObligationPaid(obl)}
                        className="rounded-xl"
                      >
                        <CheckCircle2Icon data-icon="inline-start" />
                        Оплачено
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingObl(obl);
                          setOblModalOpen(true);
                        }}
                        className="rounded-xl"
                      >
                        <PencilIcon data-icon="inline-start" />
                        Изменить
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}

          {pausedObligations.length > 0 ? (
            <div className="flex flex-col gap-2 pt-2">
              <span className="px-1 text-xs font-medium text-muted-foreground">
                На паузе ({pausedObligations.length})
              </span>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {pausedObligations.map((obl) => (
                  <div
                    key={obl.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/35 p-3 opacity-80"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{obl.title}</span>
                      <span className="text-xs text-muted-foreground num-tabular">
                        На паузе · {formatRub(obl.amount)}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingObl(obl);
                        setOblModalOpen(true);
                      }}
                      className="rounded-xl"
                    >
                      Включить
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </TabsContent>

        {/* ================================================================ */}
        {/* TAB 5: DEBTS & REIMBURSEMENTS                                    */}
        {/* ================================================================ */}
        <TabsContent value="debts" className="mt-4 flex flex-col gap-6">
          {/* Section A: Pending Expense Reimbursements */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">
                  Жду компенсаций по расходам
                </h2>
                <Badge variant="secondary" className="num-tabular">
                  {formatRub(pendingReimbursements)}
                </Badge>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openCreateTransaction("expense")}
                className="self-start rounded-xl sm:self-auto"
              >
                <PlusIcon data-icon="inline-start" />
                Рабочий или общий чек
              </Button>
            </div>

            {data.pendingReimbursementTransactions.length === 0 ? (
              <Card className="rounded-2xl shadow-none">
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  Все рабочие траты и общие счета полностью компенсированы.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {data.pendingReimbursementTransactions.map((tx) => (
                  <Card
                    key={tx.id}
                    className="flex flex-col justify-between rounded-2xl shadow-none"
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <CardTitle className="truncate text-base font-semibold">
                            {tx.description || "Расход под возврат"}
                          </CardTitle>
                          <CardDescription className="num-tabular">
                            {tx.reimbursement_counterparty
                              ? `${tx.reimbursement_counterparty} · `
                              : ""}
                            {formatDateShortRu(tx.occurred_at)} · чек на{" "}
                            {formatRub(tx.amount)}
                          </CardDescription>
                        </div>
                        <span className="shrink-0 text-lg font-semibold text-domain-finance num-tabular">
                          {formatRub(tx.reimbursable_amount)}
                        </span>
                      </div>
                    </CardHeader>

                    <CardFooter className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setSettleTx(tx);
                          setSettleOpen(true);
                        }}
                        className="rounded-xl"
                      >
                        <CheckCircle2Icon data-icon="inline-start" />
                        Получил возврат
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingTx(tx);
                          setTxModalOpen(true);
                        }}
                        className="rounded-xl"
                      >
                        <PencilIcon data-icon="inline-start" />
                        Чек
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Section B: Debts & Receivables */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">
                  Займы и личные расчёты
                </h2>
                <Badge variant="secondary" className="num-tabular">
                  Мне должны: {formatRub(owedToMeTotal)}
                </Badge>
                <Badge variant="outline" className="num-tabular">
                  Я должен: {formatRub(iOweOpenTotal)}
                </Badge>
              </div>

              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setEditingDebt(null);
                  setDebtModalOpen(true);
                }}
                className="min-h-10 self-start rounded-xl sm:self-auto"
              >
                <PlusIcon data-icon="inline-start" />
                Записать долг
              </Button>
            </div>

            {openDebts.length === 0 ? (
              <Card className="rounded-2xl shadow-none">
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  Открытых долгов и займов сейчас нет.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {openDebts.map((debt) => {
                  const isOwedToMe = debt.direction === "owed_to_me";
                  return (
                    <Card
                      key={debt.id}
                      className="flex flex-col justify-between rounded-2xl shadow-none"
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={isOwedToMe ? "secondary" : "outline"}>
                                {isOwedToMe ? "Мне должны" : "Я должен"}
                              </Badge>
                              <span className="truncate text-base font-semibold">
                                {debt.counterparty}
                              </span>
                            </div>
                            <CardDescription className="pt-0.5">
                              {debt.title}
                              {debt.due_date
                                ? ` · срок до ${formatDateShortRu(debt.due_date)}`
                                : ""}
                            </CardDescription>
                          </div>

                          <div className="flex shrink-0 flex-col items-end num-tabular">
                            <span
                              className={cn(
                                "text-lg font-semibold",
                                isOwedToMe ? "text-domain-finance" : "text-foreground"
                              )}
                            >
                              {formatRub(debt.remaining_amount)}
                            </span>
                            {Number(debt.remaining_amount) <
                            Number(debt.initial_amount) ? (
                              <span className="text-[11px] text-muted-foreground">
                                из {formatRub(debt.initial_amount)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </CardHeader>

                      {debt.reserve_in_safe_to_spend && !isOwedToMe ? (
                        <CardContent className="pt-0 pb-2">
                          <Badge variant="outline" className="text-[11px]">
                            Зарезервировано в Safe-to-Spend
                          </Badge>
                        </CardContent>
                      ) : null}

                      <CardFooter className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setPayDebt(debt);
                            setPayDebtOpen(true);
                          }}
                          className="rounded-xl"
                        >
                          {isOwedToMe ? "Вернули долг" : "Внести платёж"}
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingDebt(debt);
                            setDebtModalOpen(true);
                          }}
                          className="rounded-xl"
                        >
                          <PencilIcon data-icon="inline-start" />
                          Изменить
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            )}

            {closedDebts.length > 0 ? (
              <div className="flex flex-col gap-2 pt-2">
                <span className="px-1 text-xs font-medium text-muted-foreground">
                  Закрытые расчёты ({closedDebts.length})
                </span>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {closedDebts.slice(0, 4).map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-border/65 bg-muted/35 px-3.5 py-2.5 text-xs text-muted-foreground"
                    >
                      <span className="truncate">
                        {d.counterparty} — {d.title}
                      </span>
                      <span className="shrink-0 num-tabular">
                        закрыт ({formatRub(d.initial_amount)})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>

      {/* Modals (Vaul Drawers on iPhone / Scrollable Dialogs on Desktop) */}
      <TransactionFormModal
        open={txModalOpen}
        onOpenChange={setTxModalOpen}
        transaction={editingTx}
        accounts={data.accounts}
        categories={data.categories}
        defaultKind={txDefaultKind}
        defaultFromAccountId={txDefaultFromAcc}
        defaultToAccountId={txDefaultToAcc}
      />

      <SettleReimbursementModal
        open={settleOpen}
        onOpenChange={setSettleOpen}
        expenseTx={settleTx}
        accounts={data.accounts}
      />

      <AccountFormModal
        open={accModalOpen}
        onOpenChange={setAccModalOpen}
        account={editingAcc}
      />

      <ObligationFormModal
        open={oblModalOpen}
        onOpenChange={setOblModalOpen}
        obligation={editingObl}
        accounts={data.accounts}
        categories={data.categories}
      />

      <DebtFormModal
        open={debtModalOpen}
        onOpenChange={setDebtModalOpen}
        debt={editingDebt}
      />

      <DebtPaymentModal
        open={payDebtOpen}
        onOpenChange={setPayDebtOpen}
        debt={payDebt}
        accounts={data.accounts}
      />

      <CategoriesManageModal
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        categories={data.categories}
      />
    </div>
  );
}
