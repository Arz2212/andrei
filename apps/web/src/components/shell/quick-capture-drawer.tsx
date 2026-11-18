"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  HeartPulseIcon,
  Loader2Icon,
  ShoppingCartIcon,
  SparklesIcon,
  TargetIcon,
  WalletIcon,
} from "lucide-react";
import {
  DEFAULT_REMINDER_LEAD_MINUTES,
  type DaySlot,
  type FinanceAccount,
  type FinanceCategory,
  type IngredientUnit,
  type SpendNature,
} from "@life-os/db";
import {
  checkTaskConflictAction,
  createAgreementAction,
  createStateCheckinAction,
  fetchActiveGoalsSelectAction,
  saveTaskAction,
  type ConflictPreviewItem,
  type GoalSelectOption,
} from "@/app/actions";
import { saveFinanceTransactionAction } from "@/app/finance-actions";
import { addShoppingItemAction } from "@/app/nutrition-actions";
import {
  AISLE_GROUPS,
  UNIT_LABELS_RU,
} from "@/components/modules/nutrition-modals";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QuickCaptureDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  todayDate: string;
  financeAccounts?: FinanceAccount[];
  financeCategories?: FinanceCategory[];
}

export function QuickCaptureDrawer({
  open,
  onOpenChange,
  todayDate,
  financeAccounts = [],
  financeCategories = [],
}: QuickCaptureDrawerProps) {
  const [mode, setMode] = React.useState<
    "task" | "finance" | "shopping" | "state" | "rule"
  >("task");
  const [pending, startTransition] = React.useTransition();

  // Task state
  const [taskTitle, setTaskTitle] = React.useState("");
  const [plannedDate, setPlannedDate] = React.useState(todayDate);
  const [scheduledTime, setScheduledTime] = React.useState("");
  const [isMeeting, setIsMeeting] = React.useState(false);
  const [slot, setSlot] = React.useState<DaySlot>("any");
  const [minutes, setMinutes] = React.useState("30");
  const [isToday, setIsToday] = React.useState<"scheduled" | "inbox">("scheduled");
  const [goalId, setGoalId] = React.useState("none");
  const [activeGoals, setActiveGoals] = React.useState<GoalSelectOption[]>([]);
  const [conflicts, setConflicts] = React.useState<ConflictPreviewItem[]>([]);

  // Finance quick capture state
  const [txKind, setTxKind] = React.useState<"expense" | "income">("expense");
  const [txAmount, setTxAmount] = React.useState("");
  const [txAccountId, setTxAccountId] = React.useState("");
  const [txNewAccountName, setTxNewAccountName] = React.useState("");
  const [txCategoryId, setTxCategoryId] = React.useState("none");
  const [txNewCategoryName, setTxNewCategoryName] = React.useState("");
  const [txDescription, setTxDescription] = React.useState("");
  const [txNature, setTxNature] = React.useState<SpendNature>("personal");

  // Shopping quick capture state
  const [shopName, setShopName] = React.useState("");
  const [shopQty, setShopQty] = React.useState("1");
  const [shopUnit, setShopUnit] = React.useState<IngredientUnit>("pcs");
  const [shopAisle, setShopAisle] = React.useState("Овощи и зелень");

  // Pulse state
  const [energy, setEnergy] = React.useState("7");
  const [mood, setMood] = React.useState("7");
  const [stateNote, setStateNote] = React.useState("");

  // Rule state
  const [ruleText, setRuleText] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setPlannedDate(todayDate);
      setConflicts([]);
      const defaultAcc =
        financeAccounts.find((a) => a.account_type === "debit") ??
        financeAccounts[0];
      if (defaultAcc && !txAccountId) {
        setTxAccountId(String(defaultAcc.id));
      }
      fetchActiveGoalsSelectAction()
        .then(setActiveGoals)
        .catch(() => {});
    }
  }, [open, todayDate, financeAccounts, txAccountId]);

  React.useEffect(() => {
    if (
      !open ||
      mode !== "task" ||
      isToday !== "scheduled" ||
      !scheduledTime ||
      !plannedDate
    ) {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await checkTaskConflictAction({
          plannedDate,
          startTime: scheduledTime,
          durationMinutes: Number(minutes) || (isMeeting ? 60 : 30),
          isMeeting,
        });
        if (!cancelled) setConflicts(res);
      } catch {
        if (!cancelled) setConflicts([]);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, mode, isToday, plannedDate, scheduledTime, minutes, isMeeting]);

  const filteredFinanceCategories = React.useMemo(
    () => financeCategories.filter((c) => c.kind === txKind && !c.is_archived),
    [financeCategories, txKind]
  );

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (mode === "task") {
          if (!taskTitle.trim()) return;
          const useScheduled = isToday === "scheduled";
          await saveTaskAction({
            title: taskTitle,
            planned_date: useScheduled ? plannedDate : null,
            scheduled_time: useScheduled && scheduledTime ? scheduledTime : null,
            is_meeting: useScheduled ? isMeeting : false,
            remind_before_minutes:
              useScheduled && scheduledTime
                ? DEFAULT_REMINDER_LEAD_MINUTES
                : null,
            day_slot: slot,
            estimated_minutes: Number(minutes) || null,
            goal_id: goalId !== "none" ? Number(goalId) : null,
            status: useScheduled ? "todo" : "inbox",
            priority: 2,
          });
          setTaskTitle("");
          setScheduledTime("");
          setIsMeeting(false);
          setGoalId("none");
          toast.success("Задача добавлена");
        } else if (mode === "finance") {
          const parsedAmount = Number(txAmount.replace(",", "."));
          if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            toast.error("Укажи сумму больше нуля");
            return;
          }
          const useInlineCat =
            (filteredFinanceCategories.length === 0 ||
              txCategoryId === "__new__") &&
            txNewCategoryName.trim().length > 0;
          await saveFinanceTransactionAction({
            kind: txKind,
            amount: parsedAmount,
            account_id: txAccountId ? Number(txAccountId) : null,
            new_account_name:
              financeAccounts.length === 0
                ? txNewAccountName.trim() || "Основной счёт"
                : null,
            category_id:
              txCategoryId &&
              txCategoryId !== "none" &&
              txCategoryId !== "__new__"
                ? Number(txCategoryId)
                : null,
            new_category_name: useInlineCat ? txNewCategoryName.trim() : null,
            description: txDescription.trim() || null,
            spend_nature: txKind === "expense" ? txNature : "personal",
          });
          setTxAmount("");
          setTxDescription("");
          setTxNewAccountName("");
          setTxNewCategoryName("");
          setTxCategoryId("none");
          setTxNature("personal");
          toast.success(
            txKind === "expense" ? "Расход записан" : "Доход записан"
          );
        } else if (mode === "shopping") {
          if (!shopName.trim()) return;
          await addShoppingItemAction({
            display_name: shopName,
            quantity_needed: Number(shopQty) || 1,
            unit: shopUnit,
            aisle_group: shopAisle,
          });
          setShopName("");
          setShopQty("1");
          toast.success("Добавлено в список покупок");
        } else if (mode === "state") {
          await createStateCheckinAction({
            energy_score: Number(energy) || 7,
            mood_score: Number(mood) || 7,
            note: stateNote,
          });
          setStateNote("");
          toast.success("Состояние отмечено");
        } else {
          if (!ruleText.trim()) return;
          await createAgreementAction({
            scope: "general",
            rule_text: ruleText,
          });
          setRuleText("");
          toast.success("Правило передано ассистенту");
        }
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить");
      }
    });
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[92dvh] w-full max-w-lg rounded-t-2xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <DrawerHeader className="px-0 text-left">
          <DrawerTitle className="text-lg font-semibold tracking-tight">
            Быстрая запись
          </DrawerTitle>
          <DrawerDescription>
            Разгрузи голову — запись сразу синхронизируется с Telegram-ботом.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-4 overflow-y-auto pt-1 pb-2">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => {
              if (
                v === "task" ||
                v === "finance" ||
                v === "shopping" ||
                v === "state" ||
                v === "rule"
              ) {
                setMode(v);
              }
            }}
            variant="outline"
            spacing={1}
            className="flex w-full flex-wrap justify-start gap-1.5"
          >
            <ToggleGroupItem
              value="task"
              className="min-h-10 flex-1 rounded-xl px-2.5 text-xs"
            >
              <CheckCircle2Icon data-icon="inline-start" />
              Задача
            </ToggleGroupItem>
            <ToggleGroupItem
              value="finance"
              className="min-h-10 flex-1 rounded-xl px-2.5 text-xs"
            >
              <WalletIcon data-icon="inline-start" />
              Деньги
            </ToggleGroupItem>
            <ToggleGroupItem
              value="shopping"
              className="min-h-10 flex-1 rounded-xl px-2.5 text-xs"
            >
              <ShoppingCartIcon data-icon="inline-start" />
              Покупка
            </ToggleGroupItem>
            <ToggleGroupItem
              value="state"
              className="min-h-10 flex-1 rounded-xl px-2.5 text-xs"
            >
              <HeartPulseIcon data-icon="inline-start" />
              Пульс
            </ToggleGroupItem>
            <ToggleGroupItem
              value="rule"
              className="min-h-10 flex-1 rounded-xl px-2.5 text-xs"
            >
              <SparklesIcon data-icon="inline-start" />
              Правило
            </ToggleGroupItem>
          </ToggleGroup>

          <form onSubmit={handleSave} className="flex flex-col gap-4">
            {mode === "task" ? (
              <FieldGroup className="gap-3.5">
                <Field>
                  <FieldLabel htmlFor="qc-task-title">Что нужно сделать</FieldLabel>
                  <Input
                    id="qc-task-title"
                    placeholder="Например: Встреча с научруком или Позвонить Даше"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    required
                    className="min-h-11"
                  />
                </Field>

                {activeGoals.length > 0 ? (
                  <Field>
                    <FieldLabel className="flex items-center gap-1.5">
                      <TargetIcon className="size-3.5 text-primary" />
                      Привязка к цели
                    </FieldLabel>
                    <Select value={goalId} onValueChange={setGoalId}>
                      <SelectTrigger className="min-h-11 w-full">
                        <SelectValue placeholder="Без привязки к цели" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="none">
                            Без привязки к цели
                          </SelectItem>
                          {activeGoals.map((g) => (
                            <SelectItem key={g.id} value={String(g.id)}>
                              {g.title}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel>Куда поставить</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={isToday}
                      onValueChange={(v) => {
                        if (v === "scheduled" || v === "inbox") setIsToday(v);
                      }}
                      variant="outline"
                      spacing={1}
                      className="w-full"
                    >
                      <ToggleGroupItem value="scheduled" className="min-h-11 flex-1">
                        В план
                      </ToggleGroupItem>
                      <ToggleGroupItem value="inbox" className="min-h-11 flex-1">
                        Входящие
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="qc-mins">Длительность (мин)</FieldLabel>
                    <Input
                      id="qc-mins"
                      type="number"
                      min={5}
                      max={480}
                      step={5}
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                      className="min-h-11 num-tabular"
                    />
                  </Field>
                </div>

                {isToday === "scheduled" ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field>
                        <FieldLabel htmlFor="qc-date">Дата</FieldLabel>
                        <Input
                          id="qc-date"
                          type="date"
                          value={plannedDate}
                          onChange={(e) => setPlannedDate(e.target.value)}
                          className="min-h-11 num-tabular"
                        />
                      </Field>

                      <Field>
                        <FieldLabel
                          htmlFor="qc-time"
                          className="flex items-center gap-1"
                        >
                          <ClockIcon className="size-3.5 text-muted-foreground" />
                          Точное время (МСК)
                        </FieldLabel>
                        <Input
                          id="qc-time"
                          type="time"
                          value={scheduledTime}
                          onChange={(e) => setScheduledTime(e.target.value)}
                          className="min-h-11 num-tabular"
                        />
                      </Field>
                    </div>

                    {scheduledTime ? (
                      <Field
                        orientation="horizontal"
                        className="items-center justify-between rounded-xl border border-border/80 px-3.5 py-2.5"
                      >
                        <FieldLabel htmlFor="qc-meeting" className="font-normal text-sm">
                          Встреча (уведомление за 30 мин в Telegram)
                        </FieldLabel>
                        <Switch
                          id="qc-meeting"
                          checked={isMeeting}
                          onCheckedChange={(checked) => {
                            setIsMeeting(checked);
                            if (checked && minutes === "30") setMinutes("60");
                          }}
                        />
                      </Field>
                    ) : (
                      <Field>
                        <FieldLabel>Слот дня</FieldLabel>
                        <ToggleGroup
                          type="single"
                          value={slot}
                          onValueChange={(v) => {
                            if (v) setSlot(v as DaySlot);
                          }}
                          variant="outline"
                          spacing={1}
                          className="w-full"
                        >
                          <ToggleGroupItem value="morning" className="min-h-11 flex-1">
                            Утро
                          </ToggleGroupItem>
                          <ToggleGroupItem value="afternoon" className="min-h-11 flex-1">
                            День
                          </ToggleGroupItem>
                          <ToggleGroupItem value="evening" className="min-h-11 flex-1">
                            Вечер
                          </ToggleGroupItem>
                          <ToggleGroupItem value="any" className="min-h-11 flex-1">
                            Гибко
                          </ToggleGroupItem>
                        </ToggleGroup>
                      </Field>
                    )}

                    {conflicts.length > 0 ? (
                      <Alert variant="destructive">
                        <AlertTriangleIcon className="size-4" />
                        <AlertDescription>
                          Пересекается с:{" "}
                          {conflicts
                            .map((c) => `«${c.title}» (${c.timeRangeLabel})`)
                            .join(", ")}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </>
                ) : null}
              </FieldGroup>
            ) : null}

            {mode === "finance" ? (
              <FieldGroup className="gap-3.5">
                <ToggleGroup
                  type="single"
                  value={txKind}
                  onValueChange={(v) => {
                    if (v === "expense" || v === "income") {
                      setTxKind(v);
                      setTxCategoryId("none");
                    }
                  }}
                  variant="outline"
                  spacing={1}
                  className="grid w-full grid-cols-2 gap-1.5"
                >
                  <ToggleGroupItem value="expense" className="min-h-11 rounded-xl">
                    Расход
                  </ToggleGroupItem>
                  <ToggleGroupItem value="income" className="min-h-11 rounded-xl">
                    Доход
                  </ToggleGroupItem>
                </ToggleGroup>

                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="qc-tx-amount">Сумма (₽)</FieldLabel>
                    <Input
                      id="qc-tx-amount"
                      type="number"
                      inputMode="decimal"
                      min={1}
                      step="any"
                      placeholder="1450"
                      value={txAmount}
                      onChange={(e) => setTxAmount(e.target.value)}
                      required
                      className="min-h-11 text-base font-medium num-tabular"
                    />
                  </Field>

                  <Field>
                    <div className="flex items-center justify-between gap-1">
                      <FieldLabel>
                        {financeAccounts.length === 0 ? "Новый счёт" : "Счёт"}
                      </FieldLabel>
                      {financeAccounts.length === 0 ? (
                        <Link
                          href="/finance?tab=accounts"
                          onClick={() => onOpenChange(false)}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          Счета →
                        </Link>
                      ) : null}
                    </div>
                    {financeAccounts.length === 0 ? (
                      <Input
                        value={txNewAccountName}
                        onChange={(e) => setTxNewAccountName(e.target.value)}
                        placeholder="Основной счёт"
                        className="min-h-11"
                      />
                    ) : (
                      <Select value={txAccountId} onValueChange={setTxAccountId}>
                        <SelectTrigger className="min-h-11 w-full">
                          <SelectValue placeholder="Основной счёт" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {financeAccounts.map((a) => (
                              <SelectItem key={a.id} value={String(a.id)}>
                                {a.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>
                      {filteredFinanceCategories.length === 0
                        ? "Категория (создастся сама)"
                        : "Категория"}
                    </FieldLabel>
                    {filteredFinanceCategories.length === 0 ? (
                      <Input
                        value={txNewCategoryName}
                        onChange={(e) => setTxNewCategoryName(e.target.value)}
                        placeholder={
                          txKind === "income"
                            ? "Например: Доход / Проект"
                            : "Например: Продукты / Кафе"
                        }
                        className="min-h-11"
                      />
                    ) : (
                      <div className="flex flex-col gap-2">
                        <Select
                          value={txCategoryId}
                          onValueChange={(val) => {
                            setTxCategoryId(val);
                            if (val !== "__new__") setTxNewCategoryName("");
                          }}
                        >
                          <SelectTrigger className="min-h-11 w-full">
                            <SelectValue placeholder="Без категории" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="none">Без категории</SelectItem>
                              <SelectItem value="__new__">
                                + Новая категория…
                              </SelectItem>
                              {filteredFinanceCategories.map((c) => (
                                <SelectItem key={c.id} value={String(c.id)}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {txCategoryId === "__new__" ? (
                          <Input
                            value={txNewCategoryName}
                            onChange={(e) => setTxNewCategoryName(e.target.value)}
                            placeholder="Название новой категории"
                            required
                            className="min-h-10"
                          />
                        ) : null}
                      </div>
                    )}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="qc-tx-desc">На что / от кого</FieldLabel>
                    <Input
                      id="qc-tx-desc"
                      placeholder="Например: Кофе и обед"
                      value={txDescription}
                      onChange={(e) => setTxDescription(e.target.value)}
                      className="min-h-11"
                    />
                  </Field>
                </div>

                {txKind === "expense" ? (
                  <Field>
                    <FieldLabel>Чья трата (для чистой аналитики)</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={txNature}
                      onValueChange={(v) => {
                        if (
                          v === "personal" ||
                          v === "work_reimbursable" ||
                          v === "shared_reimbursable"
                        ) {
                          setTxNature(v);
                        }
                      }}
                      variant="outline"
                      spacing={1}
                      className="grid w-full grid-cols-3 gap-1"
                    >
                      <ToggleGroupItem
                        value="personal"
                        className="min-h-10 px-2 text-xs"
                      >
                        Личная
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="work_reimbursable"
                        className="min-h-10 px-2 text-xs"
                      >
                        Рабочая
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="shared_reimbursable"
                        className="min-h-10 px-2 text-xs"
                      >
                        Пополам
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                ) : null}
              </FieldGroup>
            ) : null}

            {mode === "shopping" ? (
              <FieldGroup className="gap-3.5">
                <Field>
                  <FieldLabel htmlFor="qc-shop-name">
                    Продукт в список покупок
                  </FieldLabel>
                  <Input
                    id="qc-shop-name"
                    placeholder="Например: Авокадо, яйца С0 или оливковое масло"
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    required
                    className="min-h-11"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="qc-shop-qty">Количество</FieldLabel>
                    <Input
                      id="qc-shop-qty"
                      type="number"
                      min={0.1}
                      step="any"
                      value={shopQty}
                      onChange={(e) => setShopQty(e.target.value)}
                      className="min-h-11 num-tabular"
                    />
                  </Field>

                  <Field>
                    <FieldLabel>Единица</FieldLabel>
                    <Select
                      value={shopUnit}
                      onValueChange={(v) => setShopUnit(v as IngredientUnit)}
                    >
                      <SelectTrigger className="min-h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {Object.entries(UNIT_LABELS_RU).map(([k, lbl]) => (
                            <SelectItem key={k} value={k}>
                              {lbl}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field>
                  <FieldLabel>Отдел магазина</FieldLabel>
                  <Select value={shopAisle} onValueChange={setShopAisle}>
                    <SelectTrigger className="min-h-11 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {AISLE_GROUPS.map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            ) : null}

            {mode === "state" ? (
              <FieldGroup className="gap-3.5">
                <Field>
                  <FieldLabel>Энергия (1–10)</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={energy}
                    onValueChange={(v) => v && setEnergy(v)}
                    variant="outline"
                    spacing={1}
                    className="grid w-full grid-cols-5 gap-1.5"
                  >
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map(
                      (val) => (
                        <ToggleGroupItem
                          key={val}
                          value={val}
                          className="min-h-10 w-full rounded-xl num-tabular"
                        >
                          {val}
                        </ToggleGroupItem>
                      )
                    )}
                  </ToggleGroup>
                </Field>

                <Field>
                  <FieldLabel>Настроение (1–10)</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={mood}
                    onValueChange={(v) => v && setMood(v)}
                    variant="outline"
                    spacing={1}
                    className="grid w-full grid-cols-5 gap-1.5"
                  >
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map(
                      (val) => (
                        <ToggleGroupItem
                          key={val}
                          value={val}
                          className="min-h-10 w-full rounded-xl num-tabular"
                        >
                          {val}
                        </ToggleGroupItem>
                      )
                    )}
                  </ToggleGroup>
                </Field>

                <Field>
                  <FieldLabel htmlFor="qc-state-note">Короткая заметка</FieldLabel>
                  <Input
                    id="qc-state-note"
                    placeholder="Как самочувствие и голова прямо сейчас?"
                    value={stateNote}
                    onChange={(e) => setStateNote(e.target.value)}
                    className="min-h-11"
                  />
                </Field>
              </FieldGroup>
            ) : null}

            {mode === "rule" ? (
              <FieldGroup className="gap-3.5">
                <Field>
                  <FieldLabel htmlFor="qc-rule">
                    Договорённость для ИИ-ассистента
                  </FieldLabel>
                  <Textarea
                    id="qc-rule"
                    rows={3}
                    placeholder="Например: После 19:00 рабочие созвоны и тяжёлые задачи в план не ставить"
                    value={ruleText}
                    onChange={(e) => setRuleText(e.target.value)}
                    required
                  />
                </Field>
              </FieldGroup>
            ) : null}

            <Button
              type="submit"
              disabled={pending}
              className="min-h-12 w-full rounded-xl text-base"
            >
              {pending ? (
                <>
                  <Loader2Icon data-icon="inline-start" className="animate-spin" />
                  Сохраняем…
                </>
              ) : (
                "Сохранить"
              )}
            </Button>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
