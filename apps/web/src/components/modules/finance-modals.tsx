"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import type {
  BillingPeriod,
  DebtDirection,
  FinanceAccount,
  FinanceAccountType,
  FinanceCategory,
  FinanceCategoryKind,
  FinanceDebt,
  FinanceObligation,
  FinanceObligationKind,
  FinanceTransaction,
  FinanceTransactionKind,
  SpendNature,
} from "@life-os/db";
import {
  deleteFinanceAccountAction,
  deleteFinanceCategoryAction,
  deleteFinanceDebtAction,
  deleteFinanceObligationAction,
  deleteFinanceTransactionAction,
  recordDebtPaymentAction,
  saveFinanceAccountAction,
  saveFinanceCategoryAction,
  saveFinanceDebtAction,
  saveFinanceObligationAction,
  saveFinanceTransactionAction,
  settleReimbursementAction,
} from "@/app/finance-actions";
import { formatRub } from "@/lib/utils";
import { ResponsiveModal } from "@/components/shell/responsive-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ============================================================================
// 1. Transaction Create / Edit Modal (Expense, Income, Transfer, Reimbursement)
// ============================================================================

interface TransactionFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: FinanceTransaction | null;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  defaultKind?: FinanceTransactionKind;
  defaultFromAccountId?: number | null;
  defaultToAccountId?: number | null;
}

export function TransactionFormModal({
  open,
  onOpenChange,
  transaction,
  accounts,
  categories,
  defaultKind = "expense",
  defaultFromAccountId,
  defaultToAccountId,
}: TransactionFormModalProps) {
  const [pending, startTransition] = React.useTransition();

  const [kind, setKind] = React.useState<FinanceTransactionKind>(defaultKind);
  const [amount, setAmount] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [toAccountId, setToAccountId] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("none");
  const [occurredDate, setOccurredDate] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [spendNature, setSpendNature] = React.useState<SpendNature>("personal");
  const [personalShare, setPersonalShare] = React.useState("");
  const [counterparty, setCounterparty] = React.useState("");
  const [tagsText, setTagsText] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    const primaryAcc =
      accounts.find((a) => a.account_type === "debit") ?? accounts[0];
    const fallbackAccId = defaultFromAccountId ?? primaryAcc?.id ?? null;

    if (transaction) {
      setKind(transaction.kind as FinanceTransactionKind);
      setAmount(String(transaction.amount));
      setAccountId(String(transaction.account_id));
      setToAccountId(
        transaction.to_account_id ? String(transaction.to_account_id) : ""
      );
      setCategoryId(
        transaction.category_id ? String(transaction.category_id) : "none"
      );
      setOccurredDate(transaction.occurred_at.slice(0, 10));
      setDescription(transaction.description ?? "");
      setSpendNature(
        (transaction.spend_nature as SpendNature) ?? "personal"
      );
      setPersonalShare(
        transaction.personal_share_amount !== null &&
          transaction.personal_share_amount !== undefined
          ? String(transaction.personal_share_amount)
          : ""
      );
      setCounterparty(transaction.reimbursement_counterparty ?? "");
      setTagsText(Array.isArray(transaction.tags) ? transaction.tags.join(", ") : "");
    } else {
      setKind(defaultKind);
      setAmount("");
      setAccountId(fallbackAccId ? String(fallbackAccId) : "");
      const secondAcc = accounts.find((a) => a.id !== fallbackAccId);
      setToAccountId(
        defaultToAccountId
          ? String(defaultToAccountId)
          : secondAcc
            ? String(secondAcc.id)
            : ""
      );
      setCategoryId("none");
      setOccurredDate(new Date().toISOString().slice(0, 10));
      setDescription("");
      setSpendNature("personal");
      setPersonalShare("");
      setCounterparty("");
      setTagsText("");
    }
  }, [
    open,
    transaction,
    accounts,
    defaultKind,
    defaultFromAccountId,
    defaultToAccountId,
  ]);

  const filteredCategories = React.useMemo(() => {
    const targetKind: FinanceCategoryKind =
      kind === "income" || kind === "reimbursement_in" ? "income" : "expense";
    return categories.filter((c) => c.kind === targetKind && !c.is_archived);
  }, [categories, kind]);

  const numericAmount = Number(amount) || 0;
  const computedReimbursable = React.useMemo(() => {
    if (kind !== "expense") return 0;
    if (spendNature === "work_reimbursable") return numericAmount;
    if (spendNature === "shared_reimbursable") {
      const own =
        personalShare.trim() !== ""
          ? Math.max(0, Math.min(numericAmount, Number(personalShare) || 0))
          : Math.round((numericAmount / 2) * 100) / 100;
      return Math.max(0, Math.round((numericAmount - own) * 100) / 100);
    }
    return 0;
  }, [kind, spendNature, numericAmount, personalShare]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveFinanceTransactionAction({
          id: transaction?.id,
          kind,
          amount: Number(amount),
          account_id: accountId ? Number(accountId) : null,
          to_account_id:
            kind === "transfer" && toAccountId ? Number(toAccountId) : null,
          category_id: categoryId !== "none" ? Number(categoryId) : null,
          occurred_at: occurredDate ? `${occurredDate}T12:00:00` : null,
          description,
          spend_nature: kind === "expense" ? spendNature : "personal",
          personal_share_amount:
            kind === "expense" && spendNature === "shared_reimbursable"
              ? personalShare.trim() !== ""
                ? Number(personalShare)
                : numericAmount / 2
              : undefined,
          reimbursable_amount:
            kind === "expense" && spendNature !== "personal"
              ? computedReimbursable
              : 0,
          reimbursement_counterparty: counterparty || null,
          tags: tagsText
            .split(/[,;]+/)
            .map((t) => t.trim())
            .filter(Boolean),
        });
        toast.success(
          transaction
            ? "Операция исправлена, балансы счетов пересчитаны"
            : "Операция записана"
        );
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  function handleDelete() {
    if (!transaction) return;
    startTransition(async () => {
      try {
        await deleteFinanceTransactionAction(transaction.id);
        toast.success("Операция удалена, баланс счёта восстановлен");
        onOpenChange(false);
      } catch {
        toast.error("Не удалось удалить операцию");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={transaction ? "Исправить операцию" : "Новая финансовая операция"}
      description="При исправлении или удалении баланс счетов пересчитывается автоматически без расхождений."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel>Тип операции</FieldLabel>
            <ToggleGroup
              type="single"
              value={kind}
              onValueChange={(v) => {
                if (v) setKind(v as FinanceTransactionKind);
              }}
              variant="outline"
              spacing={1}
              className="grid w-full grid-cols-3 gap-1"
            >
              <ToggleGroupItem value="expense" className="min-h-10 w-full">
                Расход
              </ToggleGroupItem>
              <ToggleGroupItem value="income" className="min-h-10 w-full">
                Доход
              </ToggleGroupItem>
              <ToggleGroupItem value="transfer" className="min-h-10 w-full">
                Перевод
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="tx-amount">Сумма (₽)</FieldLabel>
              <Input
                id="tx-amount"
                type="number"
                min={1}
                step="any"
                placeholder="1 250"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="min-h-11 text-base font-semibold num-tabular"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="tx-date">Дата операции</FieldLabel>
              <Input
                id="tx-date"
                type="date"
                value={occurredDate}
                onChange={(e) => setOccurredDate(e.target.value)}
                required
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>
                {kind === "transfer"
                  ? "Со счёта"
                  : kind === "income"
                    ? "Зачислить на счёт"
                    : "Списать со счёта"}
              </FieldLabel>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue placeholder="Выбери счёт" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={String(acc.id)}>
                        {acc.name} ({formatRub(acc.balance)})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            {kind === "transfer" ? (
              <Field>
                <FieldLabel>На счёт (или погашение кредитки)</FieldLabel>
                <Select value={toAccountId} onValueChange={setToAccountId}>
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue placeholder="Выбери счёт получателя" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {accounts
                        .filter((a) => String(a.id) !== accountId)
                        .map((acc) => (
                          <SelectItem key={acc.id} value={String(acc.id)}>
                            {acc.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <Field>
                <FieldLabel>Категория</FieldLabel>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue placeholder="Без категории" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">Без категории</SelectItem>
                      {filteredCategories.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>

          <Field>
            <FieldLabel htmlFor="tx-desc">Описание / место покупки</FieldLabel>
            <Input
              id="tx-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Например: Продукты во ВкусВилл или Такси в аэропорт"
              className="min-h-11"
            />
          </Field>

          {/* Reimbursement Isolation Controls for Expenses */}
          {kind === "expense" ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/30 p-3.5">
              <Field>
                <FieldLabel>Чья это покупка (защита личной аналитики)</FieldLabel>
                <ToggleGroup
                  type="single"
                  value={spendNature}
                  onValueChange={(v) => {
                    if (v) setSpendNature(v as SpendNature);
                  }}
                  variant="outline"
                  spacing={1}
                  className="grid w-full grid-cols-3 gap-1"
                >
                  <ToggleGroupItem value="personal" className="min-h-10 text-xs">
                    Личная
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="work_reimbursable"
                    className="min-h-10 text-xs"
                  >
                    Рабочая (возврат)
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="shared_reimbursable"
                    className="min-h-10 text-xs"
                  >
                    Общий счёт
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              {spendNature === "work_reimbursable" ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    В личную аналитику расходов попадёт{" "}
                    <strong className="text-foreground">0 ₽</strong>. Вся сумма{" "}
                    <strong className="text-foreground num-tabular">
                      {formatRub(numericAmount)}
                    </strong>{" "}
                    уйдёт в ожидание компенсации.
                  </p>
                  <Field>
                    <FieldLabel htmlFor="tx-cp">
                      Кто должен компенсировать
                    </FieldLabel>
                    <Input
                      id="tx-cp"
                      value={counterparty}
                      onChange={(e) => setCounterparty(e.target.value)}
                      placeholder="Компания, проект или заказчик"
                      className="min-h-10"
                    />
                  </Field>
                </>
              ) : null}

              {spendNature === "shared_reimbursable" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="tx-own-share">
                      Моя личная доля (₽)
                    </FieldLabel>
                    <Input
                      id="tx-own-share"
                      type="number"
                      min={0}
                      step="any"
                      placeholder={
                        numericAmount > 0 ? String(numericAmount / 2) : "600"
                      }
                      value={personalShare}
                      onChange={(e) => setPersonalShare(e.target.value)}
                      className="min-h-10 num-tabular"
                    />
                    <FieldDescription className="num-tabular">
                      К возврату: {formatRub(computedReimbursable)}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="tx-shared-cp">
                      С кем делили покупку
                    </FieldLabel>
                    <Input
                      id="tx-shared-cp"
                      value={counterparty}
                      onChange={(e) => setCounterparty(e.target.value)}
                      placeholder="Имя друга / коллеги"
                      className="min-h-10"
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}

          <Field>
            <FieldLabel htmlFor="tx-tags">Теги (через запятую)</FieldLabel>
            <Input
              id="tx-tags"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="командировка, дом, регулярное"
              className="min-h-10"
            />
          </Field>
        </FieldGroup>

        <div className="sticky bottom-0 z-10 -mx-1 mt-1 flex items-center justify-between gap-3 border-t border-border/70 bg-background/95 px-1 pt-3 pb-1 backdrop-blur-xs">
          {transaction ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={pending}
              className="min-h-11 rounded-xl text-destructive hover:text-destructive"
            >
              <Trash2Icon data-icon="inline-start" />
              Удалить
            </Button>
          ) : (
            <span />
          )}

          <Button
            type="submit"
            disabled={pending}
            className="min-h-11 flex-1 sm:min-w-[180px] sm:flex-initial rounded-xl"
          >
            {pending ? (
              <>
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
                Сохраняем…
              </>
            ) : transaction ? (
              "Сохранить исправление"
            ) : (
              "Записать операцию"
            )}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 2. Settle Reimbursement Modal ("Получил возврат")
// ============================================================================

interface SettleReimbursementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expenseTx: FinanceTransaction | null;
  accounts: FinanceAccount[];
}

export function SettleReimbursementModal({
  open,
  onOpenChange,
  expenseTx,
  accounts,
}: SettleReimbursementModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [targetAccountId, setTargetAccountId] = React.useState("");
  const [receivedAmount, setReceivedAmount] = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open && expenseTx) {
      const primary =
        accounts.find((a) => a.account_type === "debit") ?? accounts[0];
      setTargetAccountId(
        String(primary?.id ?? expenseTx.account_id)
      );
      setReceivedAmount(String(expenseTx.reimbursable_amount));
      setNote("");
    }
  }, [open, expenseTx, accounts]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!expenseTx) return;
    startTransition(async () => {
      try {
        await settleReimbursementAction({
          expenseTransactionId: expenseTx.id,
          targetAccountId: targetAccountId ? Number(targetAccountId) : null,
          receivedAmount: Number(receivedAmount),
          note,
        });
        toast.success("Возврат зачислен на счёт и закрыт в аналитике");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка проведения возврата");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Зачислить компенсацию"
      description={
        expenseTx
          ? `Возврат по операции «${expenseTx.description || "Покупка"}»`
          : undefined
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="reimb-amt">Сумма возврата (₽)</FieldLabel>
            <Input
              id="reimb-amt"
              type="number"
              min={1}
              step="any"
              value={receivedAmount}
              onChange={(e) => setReceivedAmount(e.target.value)}
              required
              className="min-h-11 font-semibold num-tabular"
            />
          </Field>

          <Field>
            <FieldLabel>На какой счёт пришли деньги</FieldLabel>
            <Select value={targetAccountId} onValueChange={setTargetAccountId}>
              <SelectTrigger className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={String(acc.id)}>
                      {acc.name} ({formatRub(acc.balance)})
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="reimb-note">Комментарий</FieldLabel>
            <Input
              id="reimb-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Перевод от бухгалтерии / друга"
              className="min-h-11"
            />
          </Field>
        </FieldGroup>

        <Button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full rounded-xl"
        >
          Подтвердить получение средств
        </Button>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 3. Account & Credit Card Modal
// ============================================================================

interface AccountFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: FinanceAccount | null;
}

export function AccountFormModal({
  open,
  onOpenChange,
  account,
}: AccountFormModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState("");
  const [accountType, setAccountType] =
    React.useState<FinanceAccountType>("debit");
  const [balance, setBalance] = React.useState("0");
  const [creditLimit, setCreditLimit] = React.useState("150000");
  const [statementDebt, setStatementDebt] = React.useState("0");
  const [graceDate, setGraceDate] = React.useState("");
  const [protectedReserve, setProtectedReserve] = React.useState("0");
  const [inSafeToSpend, setInSafeToSpend] = React.useState(true);
  const [inTotal, setInTotal] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    if (account) {
      setName(account.name);
      setAccountType(account.account_type as FinanceAccountType);
      setBalance(String(account.balance));
      setCreditLimit(String(account.credit_limit ?? 150000));
      setStatementDebt(String(account.statement_debt ?? 0));
      setGraceDate(account.grace_period_due_date ?? "");
      setProtectedReserve(String(account.protected_reserve ?? 0));
      setInSafeToSpend(account.include_in_safe_to_spend);
      setInTotal(account.include_in_total);
    } else {
      setName("");
      setAccountType("debit");
      setBalance("0");
      setCreditLimit("150000");
      setStatementDebt("0");
      setGraceDate("");
      setProtectedReserve("0");
      setInSafeToSpend(true);
      setInTotal(true);
    }
  }, [open, account]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveFinanceAccountAction({
          id: account?.id,
          name,
          account_type: accountType,
          balance: Number(balance) || 0,
          credit_limit:
            accountType === "credit_card" ? Number(creditLimit) || 0 : null,
          statement_debt:
            accountType === "credit_card" ? Number(statementDebt) || 0 : 0,
          grace_period_due_date:
            accountType === "credit_card" ? graceDate || null : null,
          protected_reserve: Number(protectedReserve) || 0,
          include_in_safe_to_spend: inSafeToSpend,
          include_in_total: inTotal,
        });
        toast.success(account ? "Счёт обновлён" : "Счёт создан");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения счёта");
      }
    });
  }

  function handleDelete() {
    if (!account) return;
    startTransition(async () => {
      try {
        const mode = await deleteFinanceAccountAction(account.id);
        toast.success(
          mode === "archived"
            ? "Счёт перенесён в архив (история операций сохранена)"
            : "Счёт удалён"
        );
        onOpenChange(false);
      } catch {
        toast.error("Не удалось удалить счёт");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={account ? "Настройки счёта" : "Новый счёт или карта"}
      description="Кредитный лимит никогда не завышает «Доступно для трат», а дата грейс-периода синхронизируется с напоминаниями."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="acc-name">Название счёта</FieldLabel>
              <Input
                id="acc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Т-Банк Black"
                required
                className="min-h-11"
              />
            </Field>

            <Field>
              <FieldLabel>Тип счёта</FieldLabel>
              <Select
                value={accountType}
                onValueChange={(v) => setAccountType(v as FinanceAccountType)}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="debit">Дебетовая карта / счёт</SelectItem>
                    <SelectItem value="savings">Накопительный счёт</SelectItem>
                    <SelectItem value="cash">Наличные</SelectItem>
                    <SelectItem value="credit_card">Кредитная карта</SelectItem>
                    <SelectItem value="investment">Инвестиции</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {accountType === "credit_card" ? (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/80 bg-muted/30 p-3.5 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="cc-limit">Кредитный лимит (₽)</FieldLabel>
                <Input
                  id="cc-limit"
                  type="number"
                  min={0}
                  step="any"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  className="min-h-10 num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="cc-debt">Текущий долг (₽)</FieldLabel>
                <Input
                  id="cc-debt"
                  type="number"
                  min={0}
                  step="any"
                  value={statementDebt}
                  onChange={(e) => setStatementDebt(e.target.value)}
                  className="min-h-10 num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="cc-grace">Конец грейс-периода</FieldLabel>
                <Input
                  id="cc-grace"
                  type="date"
                  value={graceDate}
                  onChange={(e) => setGraceDate(e.target.value)}
                  className="min-h-10 num-tabular"
                />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="acc-bal">Текущий остаток (₽)</FieldLabel>
                <Input
                  id="acc-bal"
                  type="number"
                  step="any"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                  className="min-h-11 num-tabular"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="acc-res">Неснижаемый резерв (₽)</FieldLabel>
                <Input
                  id="acc-res"
                  type="number"
                  min={0}
                  step="any"
                  value={protectedReserve}
                  onChange={(e) => setProtectedReserve(e.target.value)}
                  className="min-h-11 num-tabular"
                />
              </Field>
            </div>
          )}

          <div className="flex flex-col gap-2.5 rounded-xl border border-border/80 p-3.5">
            {accountType !== "credit_card" ? (
              <Field
                orientation="horizontal"
                className="items-center justify-between"
              >
                <FieldLabel htmlFor="acc-safe" className="font-normal">
                  Включать свободный остаток в «Доступно для трат (Safe-to-Spend)»
                </FieldLabel>
                <Switch
                  id="acc-safe"
                  checked={inSafeToSpend}
                  onCheckedChange={setInSafeToSpend}
                />
              </Field>
            ) : null}

            <Field
              orientation="horizontal"
              className="items-center justify-between"
            >
              <FieldLabel htmlFor="acc-tot" className="font-normal">
                Учитывать счёт в «Общей сумме»
              </FieldLabel>
              <Switch
                id="acc-tot"
                checked={inTotal}
                onCheckedChange={setInTotal}
              />
            </Field>
          </div>
        </FieldGroup>

        <div className="sticky bottom-0 z-10 -mx-1 mt-1 flex items-center justify-between gap-3 border-t border-border/70 bg-background/95 px-1 pt-3 pb-1">
          {account ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={pending}
              className="min-h-11 rounded-xl text-destructive hover:text-destructive"
            >
              <Trash2Icon data-icon="inline-start" />
              Удалить / в архив
            </Button>
          ) : (
            <span />
          )}

          <Button
            type="submit"
            disabled={pending}
            className="min-h-11 flex-1 sm:min-w-[180px] sm:flex-initial rounded-xl"
          >
            {account ? "Сохранить счёт" : "Добавить счёт"}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 4. Obligation / Subscription Modal
// ============================================================================

interface ObligationFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  obligation: FinanceObligation | null;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
}

export function ObligationFormModal({
  open,
  onOpenChange,
  obligation,
  accounts,
  categories,
}: ObligationFormModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState("");
  const [kind, setKind] =
    React.useState<FinanceObligationKind>("subscription");
  const [amount, setAmount] = React.useState("");
  const [period, setPeriod] = React.useState<BillingPeriod>("monthly");
  const [nextDueDate, setNextDueDate] = React.useState("");
  const [accountId, setAccountId] = React.useState("none");
  const [categoryId, setCategoryId] = React.useState("none");
  const [deductSafe, setDeductSafe] = React.useState(true);
  const [remindDays, setRemindDays] = React.useState("2");

  React.useEffect(() => {
    if (!open) return;
    if (obligation) {
      setTitle(obligation.title);
      setKind(obligation.obligation_kind as FinanceObligationKind);
      setAmount(String(obligation.amount));
      setPeriod(obligation.billing_period as BillingPeriod);
      setNextDueDate(obligation.next_due_date);
      setAccountId(
        obligation.account_id ? String(obligation.account_id) : "none"
      );
      setCategoryId(
        obligation.category_id ? String(obligation.category_id) : "none"
      );
      setDeductSafe(obligation.deduct_from_safe_to_spend);
      setRemindDays(String(obligation.remind_days_before ?? 2));
    } else {
      setTitle("");
      setKind("subscription");
      setAmount("");
      setPeriod("monthly");
      setNextDueDate(new Date().toISOString().slice(0, 10));
      setAccountId("none");
      setCategoryId("none");
      setDeductSafe(true);
      setRemindDays("2");
    }
  }, [open, obligation]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveFinanceObligationAction({
          id: obligation?.id,
          title,
          obligation_kind: kind,
          amount: Number(amount),
          billing_period: period,
          next_due_date: nextDueDate,
          account_id: accountId !== "none" ? Number(accountId) : null,
          category_id: categoryId !== "none" ? Number(categoryId) : null,
          deduct_from_safe_to_spend: deductSafe,
          remind_days_before: Number(remindDays) || 0,
        });
        toast.success(obligation ? "Платёж обновлён" : "Регулярный платёж добавлен");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  function handleDelete() {
    if (!obligation) return;
    startTransition(async () => {
      try {
        await deleteFinanceObligationAction(obligation.id);
        toast.success("Регулярный платёж удалён");
        onOpenChange(false);
      } catch {
        toast.error("Не удалось удалить платёж");
      }
    });
  }

  const expenseCategories = categories.filter(
    (c) => c.kind === "expense" && !c.is_archived
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={
        obligation
          ? "Редактировать подписку / платёж"
          : "Новая подписка или обязательный платёж"
      }
      description="Автоматически резервируется в Safe-to-Spend и напоминает в Telegram перед списанием."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="ob-title">Название сервиса / платежа</FieldLabel>
            <Input
              id="ob-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Аренда, Интернет, Яндекс Плюс, VPS"
              required
              className="min-h-11"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel>Вид</FieldLabel>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as FinanceObligationKind)}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="mandatory_bill">
                      Обязательный счёт
                    </SelectItem>
                    <SelectItem value="subscription">Подписка</SelectItem>
                    <SelectItem value="loan_installment">
                      Платёж по кредиту
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="ob-amt">Сумма (₽)</FieldLabel>
              <Input
                id="ob-amt"
                type="number"
                min={1}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="min-h-11 num-tabular"
              />
            </Field>

            <Field>
              <FieldLabel>Периодичность</FieldLabel>
              <Select
                value={period}
                onValueChange={(v) => setPeriod(v as BillingPeriod)}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="monthly">Ежемесячно</SelectItem>
                    <SelectItem value="weekly">Еженедельно</SelectItem>
                    <SelectItem value="quarterly">Раз в квартал</SelectItem>
                    <SelectItem value="yearly">Раз в год</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="ob-due">Следующая дата оплаты</FieldLabel>
              <Input
                id="ob-due"
                type="date"
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                required
                className="min-h-11 num-tabular"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="ob-rem">
                Напомнить в Telegram (за N дней)
              </FieldLabel>
              <Input
                id="ob-rem"
                type="number"
                min={0}
                max={30}
                value={remindDays}
                onChange={(e) => setRemindDays(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Счёт списания по умолчанию</FieldLabel>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Основной дебетовый</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Категория расхода</FieldLabel>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Авто-выбор</SelectItem>
                    {expenseCategories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            orientation="horizontal"
            className="items-center justify-between rounded-xl border border-border/80 p-3.5"
          >
            <FieldLabel htmlFor="ob-safe" className="font-normal">
              Заранее вычитать из «Доступно для трат (Safe-to-Spend)»
            </FieldLabel>
            <Switch
              id="ob-safe"
              checked={deductSafe}
              onCheckedChange={setDeductSafe}
            />
          </Field>
        </FieldGroup>

        <div className="sticky bottom-0 z-10 -mx-1 mt-1 flex items-center justify-between gap-3 border-t border-border/70 bg-background/95 px-1 pt-3 pb-1">
          {obligation ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={pending}
              className="min-h-11 rounded-xl text-destructive hover:text-destructive"
            >
              <Trash2Icon data-icon="inline-start" />
              Удалить
            </Button>
          ) : (
            <span />
          )}

          <Button
            type="submit"
            disabled={pending}
            className="min-h-11 flex-1 sm:min-w-[180px] sm:flex-initial rounded-xl"
          >
            {obligation ? "Сохранить изменения" : "Добавить платёж"}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 5. Debt Create/Edit & Debt Payment Modals
// ============================================================================

interface DebtFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  debt: FinanceDebt | null;
}

export function DebtFormModal({ open, onOpenChange, debt }: DebtFormModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [direction, setDirection] = React.useState<DebtDirection>("i_owe");
  const [counterparty, setCounterparty] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [initialAmount, setInitialAmount] = React.useState("");
  const [remainingAmount, setRemainingAmount] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [reserveSafe, setReserveSafe] = React.useState(true);
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    if (debt) {
      setDirection(debt.direction as DebtDirection);
      setCounterparty(debt.counterparty);
      setTitle(debt.title);
      setInitialAmount(String(debt.initial_amount));
      setRemainingAmount(String(debt.remaining_amount));
      setDueDate(debt.due_date ?? "");
      setReserveSafe(debt.reserve_in_safe_to_spend);
      setNotes(debt.notes ?? "");
    } else {
      setDirection("i_owe");
      setCounterparty("");
      setTitle("");
      setInitialAmount("");
      setRemainingAmount("");
      setDueDate("");
      setReserveSafe(true);
      setNotes("");
    }
  }, [open, debt]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const initAmt = Number(initialAmount);
        const remAmt =
          remainingAmount.trim() !== "" ? Number(remainingAmount) : initAmt;
        await saveFinanceDebtAction({
          id: debt?.id,
          direction,
          counterparty,
          title,
          initial_amount: initAmt,
          remaining_amount: remAmt,
          due_date: dueDate || null,
          reserve_in_safe_to_spend: reserveSafe,
          notes,
        });
        toast.success(debt ? "Запись о долге обновлена" : "Долг записан");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  function handleDelete() {
    if (!debt) return;
    startTransition(async () => {
      try {
        await deleteFinanceDebtAction(debt.id);
        toast.success("Запись о долге удалена");
        onOpenChange(false);
      } catch {
        toast.error("Не удалось удалить запись");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={debt ? "Редактировать долг" : "Записать долг или займ"}
      description="Контроль обязательств и денег, которые должны вернуть тебе."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel>Направление</FieldLabel>
            <ToggleGroup
              type="single"
              value={direction}
              onValueChange={(v) => v && setDirection(v as DebtDirection)}
              variant="outline"
              spacing={1}
              className="grid w-full grid-cols-2 gap-1"
            >
              <ToggleGroupItem value="i_owe" className="min-h-10">
                Я должен
              </ToggleGroupItem>
              <ToggleGroupItem value="owed_to_me" className="min-h-10">
                Мне должны
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="debt-cp">Контрагент / человек</FieldLabel>
              <Input
                id="debt-cp"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                placeholder="Имя или организация"
                required
                className="min-h-11"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="debt-title">Суть договорённости</FieldLabel>
              <Input
                id="debt-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Беспроцентный займ"
                required
                className="min-h-11"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="debt-init">Сумма изначально (₽)</FieldLabel>
              <Input
                id="debt-init"
                type="number"
                min={1}
                step="any"
                value={initialAmount}
                onChange={(e) => setInitialAmount(e.target.value)}
                required
                className="min-h-11 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="debt-rem">Остаток долга (₽)</FieldLabel>
              <Input
                id="debt-rem"
                type="number"
                min={0}
                step="any"
                placeholder={initialAmount || "0"}
                value={remainingAmount}
                onChange={(e) => setRemainingAmount(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="debt-due">Срок возврата</FieldLabel>
              <Input
                id="debt-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          {direction === "i_owe" ? (
            <Field
              orientation="horizontal"
              className="items-center justify-between rounded-xl border border-border/80 p-3.5"
            >
              <FieldLabel htmlFor="debt-safe" className="font-normal">
                Резервировать остаток в «Доступно для трат (Safe-to-Spend)»
              </FieldLabel>
              <Switch
                id="debt-safe"
                checked={reserveSafe}
                onCheckedChange={setReserveSafe}
              />
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="debt-notes">Заметки</FieldLabel>
            <Textarea
              id="debt-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </FieldGroup>

        <div className="sticky bottom-0 z-10 -mx-1 mt-1 flex items-center justify-between gap-3 border-t border-border/70 bg-background/95 px-1 pt-3 pb-1">
          {debt ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={pending}
              className="min-h-11 rounded-xl text-destructive hover:text-destructive"
            >
              <Trash2Icon data-icon="inline-start" />
              Удалить
            </Button>
          ) : (
            <span />
          )}

          <Button
            type="submit"
            disabled={pending}
            className="min-h-11 flex-1 sm:min-w-[180px] sm:flex-initial rounded-xl"
          >
            {debt ? "Сохранить" : "Записать долг"}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

interface DebtPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  debt: FinanceDebt | null;
  accounts: FinanceAccount[];
}

export function DebtPaymentModal({
  open,
  onOpenChange,
  debt,
  accounts,
}: DebtPaymentModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [amount, setAmount] = React.useState("");
  const [accountId, setAccountId] = React.useState("none");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open && debt) {
      setAmount(String(debt.remaining_amount));
      const primary =
        accounts.find((a) => a.account_type === "debit") ?? accounts[0];
      setAccountId(primary ? String(primary.id) : "none");
      setNote("");
    }
  }, [open, debt, accounts]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!debt) return;
    startTransition(async () => {
      try {
        await recordDebtPaymentAction({
          id: debt.id,
          amount: Number(amount),
          accountId: accountId !== "none" ? Number(accountId) : null,
          note,
        });
        toast.success("Платёж по долгу проведён");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка проведения платежа");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={
        debt?.direction === "owed_to_me"
          ? "Получить возврат долга"
          : "Погасить долг"
      }
      description={debt ? `${debt.counterparty} · ${debt.title}` : undefined}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="dp-pay-amt">Сумма платежа (₽)</FieldLabel>
            <Input
              id="dp-pay-amt"
              type="number"
              min={1}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="min-h-11 font-semibold num-tabular"
            />
          </Field>

          <Field>
            <FieldLabel>Провести по счёту</FieldLabel>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">
                    Не менять баланс счетов (только остаток долга)
                  </SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name} ({formatRub(a.balance)})
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="dp-pay-note">Заметка</FieldLabel>
            <Input
              id="dp-pay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Частичное или полное погашение"
              className="min-h-11"
            />
          </Field>
        </FieldGroup>

        <Button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full rounded-xl"
        >
          Провести платёж
        </Button>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 6. Categories & Voice Aliases Manage Modal
// ============================================================================

interface CategoriesManageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: FinanceCategory[];
}

export function CategoriesManageModal({
  open,
  onOpenChange,
  categories,
}: CategoriesManageModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [kind, setKind] = React.useState<FinanceCategoryKind>("expense");
  const [name, setName] = React.useState("");
  const [monthlyLimit, setMonthlyLimit] = React.useState("");
  const [aliasesText, setAliasesText] = React.useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveFinanceCategoryAction({
          kind,
          name,
          monthly_limit: monthlyLimit ? Number(monthlyLimit) : null,
          voice_aliases: aliasesText
            .split(/[,;]+/)
            .map((a) => a.trim())
            .filter(Boolean),
        });
        setName("");
        setMonthlyLimit("");
        setAliasesText("");
        toast.success("Категория сохранена");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  const visible = categories.filter((c) => c.kind === kind && !c.is_archived);

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Категории и голосовые синонимы"
      description="Голосовые синонимы помогают ассистенту в Telegram безошибочно распознавать категории из речи."
    >
      <div className="flex flex-col gap-4">
        <ToggleGroup
          type="single"
          value={kind}
          onValueChange={(v) => v && setKind(v as FinanceCategoryKind)}
          variant="outline"
          spacing={1}
          className="grid w-full grid-cols-2 gap-1"
        >
          <ToggleGroupItem value="expense" className="min-h-10">
            Расходы
          </ToggleGroupItem>
          <ToggleGroupItem value="income" className="min-h-10">
            Доходы
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="flex max-h-[240px] flex-col gap-2 overflow-y-auto pr-1">
          {visible.map((cat) => (
            <div
              key={cat.id}
              className="flex items-start justify-between gap-2 rounded-xl border border-border/80 p-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{cat.name}</span>
                  {cat.monthly_limit ? (
                    <Badge variant="secondary" className="num-tabular">
                      лимит {formatRub(cat.monthly_limit)}
                    </Badge>
                  ) : null}
                </div>
                {cat.voice_aliases && cat.voice_aliases.length > 0 ? (
                  <span className="truncate text-xs text-muted-foreground">
                    Синонимы: {cat.voice_aliases.join(", ")}
                  </span>
                ) : null}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  startTransition(async () => {
                    await deleteFinanceCategoryAction(cat.id);
                    toast("Категория удалена");
                  })
                }
                aria-label={`Удалить категорию ${cat.name}`}
              >
                <Trash2Icon className="size-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>

        <Separator />

        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="cat-name">Новая категория</FieldLabel>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: Образование"
                required
                className="min-h-10"
              />
            </Field>

            {kind === "expense" ? (
              <Field>
                <FieldLabel htmlFor="cat-lim">Лимит в месяц (₽)</FieldLabel>
                <Input
                  id="cat-lim"
                  type="number"
                  min={0}
                  step="any"
                  value={monthlyLimit}
                  onChange={(e) => setMonthlyLimit(e.target.value)}
                  placeholder="Опционально"
                  className="min-h-10 num-tabular"
                />
              </Field>
            ) : null}
          </div>

          <Field>
            <FieldLabel htmlFor="cat-aliases">
              Голосовые ключевые слова (через запятую)
            </FieldLabel>
            <Input
              id="cat-aliases"
              value={aliasesText}
              onChange={(e) => setAliasesText(e.target.value)}
              placeholder="курсы, книги, репетитор"
              className="min-h-10"
            />
          </Field>

          <Button
            type="submit"
            disabled={pending}
            className="min-h-11 w-full rounded-xl"
          >
            <PlusIcon data-icon="inline-start" />
            Добавить категорию
          </Button>
        </form>
      </div>
    </ResponsiveModal>
  );
}
