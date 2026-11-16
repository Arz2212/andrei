"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarClockIcon,
  CheckIcon,
  ClockIcon,
  HourglassIcon,
  LayersIcon,
  MoonStarIcon,
  PencilIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SunIcon,
  SunsetIcon,
  WalletIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import {
  formatTaskTimeRange,
  type DashboardWidget,
  type DashboardWidgetLayoutItem,
  type DayPlan,
  type FinanceBalanceSummary,
  type PendingAction,
  type Project,
  type StateCheckin,
  type Task,
  type UserProfile,
  type WidgetKey,
} from "@life-os/db";
import {
  cancelPendingActionWeb,
  confirmPendingActionWeb,
  createStateCheckinAction,
  fetchDayScheduleAction,
  saveDashboardWidgetsAction,
  saveDayPlanAction,
  toggleTaskAction,
  updateStateCheckinAction,
} from "@/app/actions";
import { cn, formatDateShortRu, formatMinutesRu, formatRub } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ResponsiveModal } from "@/components/shell/responsive-modal";
import { TaskFormModal } from "@/components/modules/task-form-modal";
import { DayTimeline } from "@/components/modules/day-timeline";

const WIDGET_LABELS: Record<WidgetKey, string> = {
  now_focus: "Главный фокус дня",
  day_timeline: "Шкала дня (по часам)",
  day_slots_buffer: "Слоты дня (Утро · День · Вечер)",
  safe_to_spend: "Доступно для трат (Safe-to-Spend)",
  state_pulse: "Пульс энергии и настроения",
  waiting_radar: "Радар ожиданий",
  pending_confirmations: "Подтверждения из Telegram",
  habits_strip: "Ритм привычек",
  workout_window: "Окно тренировки",
  today_meals: "Меню и покупки",
  goals_progress: "Фокус целей",
};

const STAGE1_WIDGET_KEYS: WidgetKey[] = [
  "now_focus",
  "state_pulse",
  "day_timeline",
  "waiting_radar",
  "day_slots_buffer",
  "safe_to_spend",
  "pending_confirmations",
];

// Sensible allowed desktop column spans per widget (on 12-col grid)
const ALLOWED_SPANS_BY_WIDGET: Record<WidgetKey, number[]> = {
  now_focus: [6, 8, 12],
  day_timeline: [6, 8, 12],
  day_slots_buffer: [6, 8, 12],
  state_pulse: [4, 6, 8],
  waiting_radar: [4, 6, 8],
  safe_to_spend: [4, 6, 8],
  pending_confirmations: [4, 6, 8],
  habits_strip: [4, 6, 8],
  workout_window: [4, 6, 8],
  today_meals: [4, 6, 8],
  goals_progress: [4, 6, 8],
};

const SPAN_SHORT_LABELS: Record<number, string> = {
  4: "4 · Узкий",
  6: "6 · Половина",
  8: "8 · Широкий",
  12: "12 · Полный",
};

const COL_SPAN_CLASS: Record<number, string> = {
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  12: "lg:col-span-12",
};

function normalizeAllowedSpan(key: WidgetKey, rawSpan: number): number {
  const allowed = ALLOWED_SPANS_BY_WIDGET[key] ?? [4, 6, 8];
  if (allowed.includes(rawSpan)) return rawSpan;
  return allowed.reduce((prev, curr) =>
    Math.abs(curr - rawSpan) < Math.abs(prev - rawSpan) ? curr : prev
  );
}

interface DashboardViewProps {
  todayDate: string;
  profile: UserProfile | null;
  widgets: DashboardWidget[];
  dayPlan: DayPlan | null;
  todayTasks: Task[];
  waitingTasks: Task[];
  projects: Project[];
  latestCheckin: StateCheckin | null;
  pendingActions: PendingAction[];
  financeSummary: FinanceBalanceSummary | null;
}

export function DashboardView({
  todayDate,
  profile,
  widgets,
  dayPlan,
  todayTasks,
  waitingTasks,
  projects,
  latestCheckin,
  pendingActions,
  financeSummary,
}: DashboardViewProps) {
  const [, startTransition] = React.useTransition();

  // Optimistic tasks for today
  const [optimisticTasks, applyOptimisticToggle] = React.useOptimistic(
    todayTasks,
    (current: Task[], update: { id: number; done: boolean }) =>
      current.map((t) =>
        t.id === update.id ? { ...t, status: update.done ? "done" : "todo" } : t
      )
  );

  // Day Timeline date navigation (defaults to todayDate, fetches past/future days on demand)
  const [timelineDate, setTimelineDate] = React.useState(todayDate);
  const [otherDayTasks, setOtherDayTasks] = React.useState<Task[]>([]);
  const [otherDayBuffer, setOtherDayBuffer] = React.useState<number | null>(null);
  const [timelineLoading, setTimelineLoading] = React.useState(false);

  const loadTimelineDate = React.useCallback(
    async (targetDate: string) => {
      setTimelineDate(targetDate);
      if (targetDate === todayDate) {
        setOtherDayTasks([]);
        setOtherDayBuffer(null);
        return;
      }
      setTimelineLoading(true);
      try {
        const res = await fetchDayScheduleAction(targetDate);
        setOtherDayTasks(res.tasks);
        setOtherDayBuffer(res.dayPlan?.buffer_minutes ?? null);
      } catch {
        toast.error("Не удалось загрузить расписание дня");
      } finally {
        setTimelineLoading(false);
      }
    },
    [todayDate]
  );

  // Modals
  const [customizeOpen, setCustomizeOpen] = React.useState(false);
  const [focusEditOpen, setFocusEditOpen] = React.useState(false);
  const [taskModalOpen, setTaskModalOpen] = React.useState(false);
  const [editingTask, setEditingTask] = React.useState<Task | null>(null);
  const [modalPlannedDate, setModalPlannedDate] =
    React.useState<string | null>(todayDate);
  const [modalScheduledTime, setModalScheduledTime] =
    React.useState<string | null>(null);

  // Edit latest pulse modal
  const [pulseEditOpen, setPulseEditOpen] = React.useState(false);
  const [editPulseEnergy, setEditPulseEnergy] = React.useState("4");
  const [editPulseMood, setEditPulseMood] = React.useState("4");
  const [editPulseNote, setEditPulseNote] = React.useState("");

  // Day plan edit state
  const availableMins =
    dayPlan?.available_minutes ?? profile?.default_available_minutes ?? 480;
  const bufferMins =
    dayPlan?.buffer_minutes ?? profile?.daily_buffer_minutes ?? 90;
  const [focusDraft, setFocusDraft] = React.useState(dayPlan?.main_focus ?? "");
  const [availDraft, setAvailDraft] = React.useState(String(availableMins));
  const [bufferDraft, setBufferDraft] = React.useState(String(bufferMins));

  React.useEffect(() => {
    setFocusDraft(dayPlan?.main_focus ?? "");
    setAvailDraft(String(availableMins));
    setBufferDraft(String(bufferMins));
  }, [dayPlan?.main_focus, availableMins, bufferMins]);

  // Quick pulse state
  const [pulseEnergy, setPulseEnergy] = React.useState(
    String(latestCheckin?.energy_score ?? 4)
  );
  const [pulseMood, setPulseMood] = React.useState(
    String(latestCheckin?.mood_score ?? 4)
  );

  // Normalize customizable widgets list
  const initialOrderedWidgets = React.useMemo<DashboardWidgetLayoutItem[]>(() => {
    const byKey = new Map(widgets.map((w) => [w.widget_key as WidgetKey, w]));
    const defaults: DashboardWidgetLayoutItem[] = [
      { widget_key: "now_focus", is_visible: true, desktop_order: 1, mobile_order: 1, desktop_col_span: 8 },
      { widget_key: "state_pulse", is_visible: true, desktop_order: 2, mobile_order: 2, desktop_col_span: 4 },
      { widget_key: "day_timeline", is_visible: true, desktop_order: 3, mobile_order: 3, desktop_col_span: 8 },
      { widget_key: "waiting_radar", is_visible: true, desktop_order: 4, mobile_order: 4, desktop_col_span: 4 },
      { widget_key: "day_slots_buffer", is_visible: true, desktop_order: 5, mobile_order: 5, desktop_col_span: 6 },
      { widget_key: "safe_to_spend", is_visible: true, desktop_order: 6, mobile_order: 6, desktop_col_span: 6 },
      { widget_key: "pending_confirmations", is_visible: true, desktop_order: 7, mobile_order: 7, desktop_col_span: 6 },
    ];

    return defaults
      .map((def) => {
        const saved = byKey.get(def.widget_key);
        return saved
          ? {
              widget_key: def.widget_key,
              is_visible: saved.is_visible,
              desktop_order: saved.desktop_order,
              mobile_order: saved.mobile_order,
              desktop_col_span: normalizeAllowedSpan(
                def.widget_key,
                saved.desktop_col_span
              ),
            }
          : def;
      })
      .filter((w) => STAGE1_WIDGET_KEYS.includes(w.widget_key))
      .sort((a, b) => a.desktop_order - b.desktop_order);
  }, [widgets]);

  const [widgetDraft, setWidgetDraft] = React.useState(initialOrderedWidgets);
  React.useEffect(() => {
    setWidgetDraft(initialOrderedWidgets);
  }, [initialOrderedWidgets]);

  // Compact time metrics (no progress bar!)
  const activeTodayTasks = optimisticTasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled"
  );
  const doneTodayCount = optimisticTasks.filter((t) => t.status === "done").length;
  const scheduledMinutes = activeTodayTasks.reduce(
    (sum, t) => sum + (t.estimated_minutes ?? 30),
    0
  );
  const netCapacityMinutes = Math.max(availableMins - bufferMins, 0);
  const freeMinutesLeft = netCapacityMinutes - scheduledMinutes;
  const isOverloaded = freeMinutesLeft < 0;

  function handleToggleTask(task: Task, checked: boolean) {
    if (timelineDate !== todayDate) {
      setOtherDayTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: checked ? "done" : "todo" } : t
        )
      );
    }
    startTransition(async () => {
      if (timelineDate === todayDate) {
        applyOptimisticToggle({ id: task.id, done: checked });
      }
      try {
        await toggleTaskAction(task.id, checked);
      } catch {
        toast.error("Не удалось обновить статус задачи");
      }
    });
  }

  function handleSaveFocus(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveDayPlanAction({
          plan_date: todayDate,
          main_focus: focusDraft,
          available_minutes: Number(availDraft) || 480,
          buffer_minutes: Number(bufferDraft) || 90,
        });
        toast.success("Фокус и буфер дня обновлены");
        setFocusEditOpen(false);
      } catch {
        toast.error("Не удалось сохранить план дня");
      }
    });
  }

  function handleQuickPulseSave() {
    startTransition(async () => {
      try {
        await createStateCheckinAction({
          energy_score: Number(pulseEnergy) || 4,
          mood_score: Number(pulseMood) || 4,
        });
        toast.success("Пульс дня сохранён");
      } catch {
        toast.error("Не удалось записать отметку");
      }
    });
  }

  function handleUpdateLatestPulse(e: React.FormEvent) {
    e.preventDefault();
    if (!latestCheckin) return;
    startTransition(async () => {
      try {
        await updateStateCheckinAction(latestCheckin.id, {
          energy_score: Number(editPulseEnergy) || 4,
          mood_score: Number(editPulseMood) || 4,
          tension_score: latestCheckin.tension_score,
          context_tags: latestCheckin.context_tags ?? [],
          note: editPulseNote,
        });
        toast.success("Отметка состояния обновлена");
        setPulseEditOpen(false);
      } catch {
        toast.error("Не удалось обновить отметку");
      }
    });
  }

  function moveWidget(idx: number, dir: -1 | 1) {
    setWidgetDraft((prev) => {
      const next = [...prev];
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      const tmp = next[idx];
      next[idx] = next[swapIdx];
      next[swapIdx] = tmp;
      return next.map((item, i) => ({
        ...item,
        desktop_order: i + 1,
        mobile_order: i + 1,
      }));
    });
  }

  function handleSaveWidgets() {
    startTransition(async () => {
      try {
        await saveDashboardWidgetsAction(widgetDraft);
        toast.success("Раскладка и размеры виджетов сохранены");
        setCustomizeOpen(false);
      } catch {
        toast.error("Не удалось сохранить настройки сетки");
      }
    });
  }

  function handleConfirmPending(id: number) {
    startTransition(async () => {
      try {
        const msg = await confirmPendingActionWeb(id);
        toast.success(msg);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка подтверждения");
      }
    });
  }

  function handleCancelPending(id: number) {
    startTransition(async () => {
      try {
        await cancelPendingActionWeb(id);
        toast("Карточка отменена");
      } catch {
        toast.error("Не удалось отменить");
      }
    });
  }

  const projectMap = React.useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const visibleWidgets = initialOrderedWidgets.filter((w) => w.is_visible);

  function renderWidget(wKey: WidgetKey) {
    switch (wKey) {
      case "now_focus": {
        const topTask =
          activeTodayTasks.find((t) => t.priority === 1) ?? activeTodayTasks[0];
        const topTimeRange = topTask
          ? formatTaskTimeRange(topTask, "Europe/Moscow")
          : null;

        return (
          <Card className="flex h-full flex-col justify-between rounded-2xl shadow-none">
            <CardHeader className="flex flex-col items-start gap-2.5 pb-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle className="text-lg font-semibold tracking-tight">
                  Фокус прямо сейчас
                </CardTitle>
                <CardDescription>
                  {dayPlan?.main_focus ||
                    "Задай главную опору дня, чтобы не распыляться на мелочи."}
                </CardDescription>
              </div>

              {/* Understated Corner Text Time Summary (no progress bar!) */}
              <button
                type="button"
                onClick={() => setFocusEditOpen(true)}
                className={cn(
                  "shrink-0 rounded-xl border border-border/80 bg-muted/40 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted sm:text-right num-tabular",
                  isOverloaded ? "text-destructive" : "text-muted-foreground"
                )}
                title="Настроить фокус и резерв дня"
              >
                {isOverloaded
                  ? `Перегруз +${formatMinutesRu(Math.abs(freeMinutesLeft))}`
                  : `${formatMinutesRu(scheduledMinutes)} в плане · резерв ${formatMinutesRu(bufferMins)}`}
              </button>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              {topTask ? (
                <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-accent/55 p-3.5">
                  <div className="flex size-11 -m-2 shrink-0 items-center justify-center">
                    <Checkbox
                      checked={topTask.status === "done"}
                      onCheckedChange={(v) => handleToggleTask(topTask, Boolean(v))}
                      aria-label={`Отметить «${topTask.title}»`}
                    />
                  </div>
                  <div
                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1"
                    onClick={() => {
                      setEditingTask(topTask);
                      setModalPlannedDate(todayDate);
                      setModalScheduledTime(null);
                      setTaskModalOpen(true);
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>Главный шаг</Badge>
                      {topTimeRange ? (
                        <Badge variant="outline" className="gap-1 num-tabular">
                          <ClockIcon className="size-3 text-primary" />
                          {topTimeRange}
                        </Badge>
                      ) : null}
                      {topTask.estimated_minutes ? (
                        <span className="text-xs text-muted-foreground num-tabular">
                          {formatMinutesRu(topTask.estimated_minutes)}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-base font-medium leading-snug">
                      {topTask.title}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Все ключевые задачи на сегодня закрыты. Можно отдохнуть или взять дело из входящих.
                </div>
              )}
            </CardContent>

            <CardFooter className="justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span className="num-tabular">
                Закрыто сегодня: {doneTodayCount} из {optimisticTasks.length}
              </span>
              <Link
                href="/tasks"
                className="font-medium text-foreground hover:text-primary"
              >
                Открыть весь план
              </Link>
            </CardFooter>
          </Card>
        );
      }

      case "day_timeline": {
        const displayTasks =
          timelineDate === todayDate ? optimisticTasks : otherDayTasks;
        const displayBuf =
          timelineDate === todayDate
            ? bufferMins
            : otherDayBuffer ?? profile?.daily_buffer_minutes ?? 90;

        return (
          <Card className="flex h-full flex-col justify-between rounded-2xl shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <CalendarClockIcon className="size-4 text-primary" />
                  <CardTitle className="text-base font-semibold tracking-tight">
                    Шкала дня
                  </CardTitle>
                </div>
                <CardDescription>
                  Нажми на любой час, чтобы поставить встречу или задачу ко времени
                </CardDescription>
              </div>
              <Link
                href="/tasks?tab=week"
                className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Неделя
              </Link>
            </CardHeader>

            <CardContent>
              <DayTimeline
                todayDate={todayDate}
                selectedDate={timelineDate}
                onSelectDate={loadTimelineDate}
                tasks={displayTasks}
                projects={projects}
                bufferMinutes={displayBuf}
                loading={timelineLoading}
                onToggleTask={handleToggleTask}
                onEditTask={(t) => {
                  setEditingTask(t);
                  setModalPlannedDate(t.planned_date ?? timelineDate);
                  setModalScheduledTime(null);
                  setTaskModalOpen(true);
                }}
                onCreateAtTime={(dateIso, timeStr) => {
                  setEditingTask(null);
                  setModalPlannedDate(dateIso);
                  setModalScheduledTime(timeStr ?? null);
                  setTaskModalOpen(true);
                }}
              />
            </CardContent>
          </Card>
        );
      }

      case "safe_to_spend": {
        const safe = Number(financeSummary?.safe_to_spend ?? 0);
        const total = Number(financeSummary?.total_balance ?? 0);
        const reimb = Number(financeSummary?.pending_reimbursements ?? 0);

        return (
          <Card className="flex h-full flex-col justify-between rounded-2xl shadow-none">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold tracking-tight">
                  Доступно для трат
                </CardTitle>
                <WalletIcon className="size-4 text-domain-finance" />
              </div>
              <CardDescription>
                Safe-to-Spend за вычетом обязательных платежей и резервов
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              <div className="text-3xl font-semibold tracking-tight num-tabular">
                {formatRub(safe)}
              </div>

              <div className="grid grid-cols-2 gap-2.5 rounded-xl bg-muted/55 p-3 text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Общий баланс</span>
                  <span className="text-sm font-medium num-tabular">
                    {formatRub(total)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">Жду компенсаций</span>
                  <span className="text-sm font-medium num-tabular">
                    {formatRub(reimb)}
                  </span>
                </div>
              </div>
            </CardContent>

            <CardFooter className="justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span>Траты голосом — через Telegram</span>
              <Link
                href="/finance"
                className="font-medium text-foreground hover:text-primary"
              >
                Подробнее
              </Link>
            </CardFooter>
          </Card>
        );
      }

      case "day_slots_buffer": {
        const groups = [
          { key: "morning", label: "Утро", icon: SunIcon },
          { key: "afternoon", label: "День", icon: SunsetIcon },
          { key: "evening", label: "Вечер", icon: MoonStarIcon },
          { key: "any", label: "Гибкое окно", icon: LayersIcon },
        ] as const;

        return (
          <Card className="flex h-full flex-col justify-between rounded-2xl shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <div>
                <CardTitle className="text-base font-semibold tracking-tight">
                  Слоты сегодняшнего дня
                </CardTitle>
                <CardDescription>
                  Гибкие окна Утро · День · Вечер
                </CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingTask(null);
                  setModalPlannedDate(todayDate);
                  setModalScheduledTime(null);
                  setTaskModalOpen(true);
                }}
                className="min-h-9 rounded-xl"
              >
                <PlusIcon data-icon="inline-start" />
                Задача
              </Button>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {optimisticTasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  На сегодня задач пока нет. Нажми «Задача» или надиктуй план голосом в Telegram.
                </div>
              ) : (
                groups.map((grp) => {
                  const items = optimisticTasks
                    .filter((t) => t.day_slot === grp.key)
                    .sort((a, b) => {
                      if (a.scheduled_start_at && b.scheduled_start_at) {
                        return (
                          Date.parse(a.scheduled_start_at) -
                          Date.parse(b.scheduled_start_at)
                        );
                      }
                      if (a.scheduled_start_at) return -1;
                      if (b.scheduled_start_at) return 1;
                      return a.priority - b.priority;
                    });

                  if (items.length === 0) return null;
                  const SlotIcon = grp.icon;
                  return (
                    <div key={grp.key} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <SlotIcon className="size-3.5" />
                          {grp.label}
                        </span>
                        <span className="num-tabular">
                          {formatMinutesRu(
                            items.reduce(
                              (s, i) => s + (i.estimated_minutes ?? 0),
                              0
                            )
                          )}
                        </span>
                      </div>

                      <div className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/80 bg-background/50">
                        {items.map((task) => {
                          const isDone = task.status === "done";
                          const proj = task.project_id
                            ? projectMap.get(task.project_id)
                            : null;
                          const timeRange = formatTaskTimeRange(
                            task,
                            "Europe/Moscow"
                          );

                          return (
                            <div
                              key={task.id}
                              className="flex min-h-12 items-center gap-3 px-3 py-2"
                            >
                              <div className="flex size-11 -m-2 shrink-0 items-center justify-center">
                                <Checkbox
                                  checked={isDone}
                                  onCheckedChange={(v) =>
                                    handleToggleTask(task, Boolean(v))
                                  }
                                  aria-label={`Выполнить «${task.title}»`}
                                />
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTask(task);
                                  setModalPlannedDate(
                                    task.planned_date ?? todayDate
                                  );
                                  setModalScheduledTime(null);
                                  setTaskModalOpen(true);
                                }}
                                className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                              >
                                <div className="flex w-full flex-wrap items-center gap-1.5">
                                  {timeRange ? (
                                    <Badge
                                      variant="outline"
                                      className="gap-1 border-primary/35 bg-accent/55 text-foreground num-tabular"
                                    >
                                      <ClockIcon className="size-3 text-primary" />
                                      {timeRange}
                                    </Badge>
                                  ) : null}
                                  <span
                                    className={cn(
                                      "truncate text-sm font-medium",
                                      isDone &&
                                        "line-through text-muted-foreground"
                                    )}
                                  >
                                    {task.title}
                                  </span>
                                </div>
                                {proj ? (
                                  <span className="text-xs text-muted-foreground">
                                    {proj.title}
                                  </span>
                                ) : null}
                              </button>

                              {task.estimated_minutes ? (
                                <Badge
                                  variant="secondary"
                                  className="shrink-0 num-tabular"
                                >
                                  {task.estimated_minutes} м
                                </Badge>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        );
      }

      case "state_pulse": {
        return (
          <Card className="flex h-full flex-col justify-between rounded-2xl shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold tracking-tight">
                  Состояние и энергия
                </CardTitle>
                <div className="flex items-center gap-1">
                  {latestCheckin ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditPulseEnergy(String(latestCheckin.energy_score));
                        setEditPulseMood(String(latestCheckin.mood_score));
                        setEditPulseNote(latestCheckin.note ?? "");
                        setPulseEditOpen(true);
                      }}
                      title="Редактировать последнюю отметку"
                      aria-label="Редактировать последнюю отметку"
                      className="size-7 rounded-lg"
                    >
                      <PencilIcon className="size-3.5 text-muted-foreground" />
                    </Button>
                  ) : null}
                  <ZapIcon className="size-4 text-domain-mind" />
                </div>
              </div>
              <CardDescription>
                {latestCheckin
                  ? `Последняя отметка: энергия ${latestCheckin.energy_score}/10, настроение ${latestCheckin.mood_score}/10`
                  : "Отметь текущий ресурс (шкала 1–10)"}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Энергия (1–10)</span>
                <ToggleGroup
                  type="single"
                  value={pulseEnergy}
                  onValueChange={(v) => v && setPulseEnergy(v)}
                  variant="outline"
                  spacing={1}
                  className="grid w-full grid-cols-5 gap-1"
                >
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map(
                    (n) => (
                      <ToggleGroupItem
                        key={n}
                        value={n}
                        className="min-h-9 w-full rounded-lg num-tabular"
                      >
                        {n}
                      </ToggleGroupItem>
                    )
                  )}
                </ToggleGroup>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">
                  Настроение (1–10)
                </span>
                <ToggleGroup
                  type="single"
                  value={pulseMood}
                  onValueChange={(v) => v && setPulseMood(v)}
                  variant="outline"
                  spacing={1}
                  className="grid w-full grid-cols-5 gap-1"
                >
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map(
                    (n) => (
                      <ToggleGroupItem
                        key={n}
                        value={n}
                        className="min-h-9 w-full rounded-lg num-tabular"
                      >
                        {n}
                      </ToggleGroupItem>
                    )
                  )}
                </ToggleGroup>
              </div>

              <Button
                type="button"
                variant="secondary"
                onClick={handleQuickPulseSave}
                className="min-h-11 w-full rounded-xl"
              >
                Новая отметка пульса
              </Button>
            </CardContent>

            <CardFooter className="justify-between gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">
                {latestCheckin?.note || "Вечером — раздельная оценка дня"}
              </span>
              <Link
                href="/journal"
                className="shrink-0 font-medium text-foreground hover:text-primary"
              >
                Дневник
              </Link>
            </CardFooter>
          </Card>
        );
      }

      case "waiting_radar": {
        return (
          <Card className="flex h-full flex-col justify-between rounded-2xl shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold tracking-tight">
                  Ожидание ответа
                </CardTitle>
                <Badge variant="secondary" className="num-tabular">
                  {waitingTasks.length}
                </Badge>
              </div>
              <CardDescription>
                Дела на стороне других людей — чтобы вовремя напомнить
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-2.5">
              {waitingTasks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Сейчас зависших ожиданий нет.
                </p>
              ) : (
                waitingTasks.slice(0, 4).map((wt) => (
                  <button
                    key={wt.id}
                    type="button"
                    onClick={() => {
                      setEditingTask(wt);
                      setModalPlannedDate(wt.planned_date);
                      setModalScheduledTime(null);
                      setTaskModalOpen(true);
                    }}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border/80 bg-background/50 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {wt.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        Ждём: {wt.waiting_on_person || "контрагента"}
                        {wt.waiting_context ? ` · ${wt.waiting_context}` : ""}
                      </span>
                    </div>
                    {wt.follow_up_at ? (
                      <Badge variant="outline" className="shrink-0 num-tabular">
                        <ClockIcon className="mr-1 size-3" />
                        {formatDateShortRu(wt.follow_up_at)}
                      </Badge>
                    ) : (
                      <HourglassIcon className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </CardContent>

            <CardFooter className="justify-end border-t border-border/60 pt-3 text-xs">
              <Link
                href="/tasks?tab=waiting"
                className="font-medium text-foreground hover:text-primary"
              >
                Все ожидания
              </Link>
            </CardFooter>
          </Card>
        );
      }

      case "pending_confirmations": {
        return (
          <Card className="flex h-full flex-col justify-between rounded-2xl shadow-none">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold tracking-tight">
                  Предложения ИИ-ассистента
                </CardTitle>
                <SparklesIcon className="size-4 text-primary" />
              </div>
              <CardDescription>
                Черновики изменений плана и трат, ожидающие твоего подтверждения
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              {pendingActions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Новых карточек на подтверждение нет. Когда надиктуешь задачи или траты в Telegram, превью появится и там, и здесь.
                </div>
              ) : (
                pendingActions.map((pa) => (
                  <div
                    key={pa.id}
                    className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-accent/40 p-3.5"
                  >
                    <p className="whitespace-pre-line text-sm leading-relaxed">
                      {pa.preview_markdown}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleConfirmPending(pa.id)}
                        className="min-h-10 flex-1 rounded-xl"
                      >
                        <CheckIcon data-icon="inline-start" />
                        Подтвердить
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleCancelPending(pa.id)}
                        className="min-h-10 rounded-xl"
                      >
                        <XIcon data-icon="inline-start" />
                        Отмена
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>

            <CardFooter className="justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span>Human-in-the-loop защита активна</span>
              <Link
                href="/settings"
                className="font-medium text-foreground hover:text-primary"
              >
                Настроить характер ИИ
              </Link>
            </CardFooter>
          </Card>
        );
      }

      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Top Page Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">Картина дня</h1>
          <p className="text-sm text-muted-foreground">
            Наглядная шкала часов, приоритеты и живая синхронизация с Telegram
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCustomizeOpen(true)}
          className="min-h-10 rounded-xl"
        >
          <SlidersHorizontalIcon data-icon="inline-start" />
          Настроить виджеты
        </Button>
      </div>

      {/* Responsive 12-Col Bento Grid (Desktop) / Stacked Feed (iPhone) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {visibleWidgets.map((w) => (
          <div
            key={w.widget_key}
            className={cn(
              "col-span-1",
              COL_SPAN_CLASS[w.desktop_col_span] ?? "lg:col-span-6"
            )}
          >
            {renderWidget(w.widget_key)}
          </div>
        ))}
      </div>

      {/* Customize & Resize Widgets Modal (Vaul Drawer on iPhone) */}
      <ResponsiveModal
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        title="Настройка и размер виджетов"
        description="Включай нужные блоки, меняй их порядок и выбирай ширину на экране компьютера (12 колонок)."
      >
        <div className="flex flex-col gap-3">
          {widgetDraft.map((item, idx) => {
            const allowedSpans =
              ALLOWED_SPANS_BY_WIDGET[item.widget_key] ?? [4, 6, 8];
            return (
              <div
                key={item.widget_key}
                className="flex flex-col gap-2.5 rounded-xl border border-border px-3.5 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Switch
                      checked={item.is_visible}
                      onCheckedChange={(checked) =>
                        setWidgetDraft((prev) =>
                          prev.map((w, i) =>
                            i === idx ? { ...w, is_visible: checked } : w
                          )
                        )
                      }
                      aria-label={WIDGET_LABELS[item.widget_key]}
                    />
                    <span className="truncate text-sm font-medium">
                      {WIDGET_LABELS[item.widget_key]}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={idx === 0}
                      onClick={() => moveWidget(idx, -1)}
                      aria-label="Поднять выше"
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={idx === widgetDraft.length - 1}
                      onClick={() => moveWidget(idx, 1)}
                      aria-label="Опустить ниже"
                    >
                      <ArrowDownIcon />
                    </Button>
                  </div>
                </div>

                {item.is_visible ? (
                  <div className="flex flex-col gap-1 pt-0.5">
                    <span className="text-[11px] text-muted-foreground">
                      Ширина блока на ПК:
                    </span>
                    <ToggleGroup
                      type="single"
                      value={String(item.desktop_col_span)}
                      onValueChange={(val) => {
                        if (!val) return;
                        const num = Number(val);
                        setWidgetDraft((prev) =>
                          prev.map((w, i) =>
                            i === idx ? { ...w, desktop_col_span: num } : w
                          )
                        );
                      }}
                      variant="outline"
                      spacing={1}
                      className="w-full"
                    >
                      {allowedSpans.map((sp) => (
                        <ToggleGroupItem
                          key={sp}
                          value={String(sp)}
                          className="min-h-8 flex-1 text-xs num-tabular"
                        >
                          {SPAN_SHORT_LABELS[sp] ?? `${sp} кол.`}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                ) : null}
              </div>
            );
          })}

          <Separator className="my-1" />

          <Button
            type="button"
            onClick={handleSaveWidgets}
            className="min-h-11 w-full rounded-xl"
          >
            Сохранить раскладку
          </Button>
        </div>
      </ResponsiveModal>

      {/* Edit Day Focus & Buffer Modal */}
      <ResponsiveModal
        open={focusEditOpen}
        onOpenChange={setFocusEditOpen}
        title="Фокус и резерв времени на сегодня"
        description="Буфер защищает план от рассыпания при внезапных созвонах и переносах."
      >
        <form onSubmit={handleSaveFocus} className="flex flex-col gap-4">
          <FieldGroup className="gap-3.5">
            <Field>
              <FieldLabel htmlFor="dp-focus">Главная цель дня</FieldLabel>
              <Input
                id="dp-focus"
                value={focusDraft}
                onChange={(e) => setFocusDraft(e.target.value)}
                placeholder="Какой один результат сделает этот день успешным?"
                className="min-h-11"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="dp-avail">Всего ресурса (мин)</FieldLabel>
                <Input
                  id="dp-avail"
                  type="number"
                  min={60}
                  max={960}
                  step={30}
                  value={availDraft}
                  onChange={(e) => setAvailDraft(e.target.value)}
                  className="min-h-11 num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="dp-buf">Защитный буфер (мин)</FieldLabel>
                <Input
                  id="dp-buf"
                  type="number"
                  min={0}
                  max={360}
                  step={15}
                  value={bufferDraft}
                  onChange={(e) => setBufferDraft(e.target.value)}
                  className="min-h-11 num-tabular"
                />
              </Field>
            </div>
          </FieldGroup>

          <Button type="submit" className="min-h-11 w-full rounded-xl">
            Обновить план дня
          </Button>
        </form>
      </ResponsiveModal>

      {/* Edit Latest State Pulse Modal */}
      <ResponsiveModal
        open={pulseEditOpen}
        onOpenChange={setPulseEditOpen}
        title="Исправить последнюю отметку состояния"
        description="Скорректируй оценку энергии, настроения или заметку."
      >
        <form onSubmit={handleUpdateLatestPulse} className="flex flex-col gap-4">
          <FieldGroup className="gap-3.5">
            <Field>
              <FieldLabel>Энергия (1–10)</FieldLabel>
              <ToggleGroup
                type="single"
                value={editPulseEnergy}
                onValueChange={(v) => v && setEditPulseEnergy(v)}
                variant="outline"
                spacing={1}
                className="grid w-full grid-cols-5 gap-1.5 sm:grid-cols-10"
              >
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((n) => (
                  <ToggleGroupItem
                    key={n}
                    value={n}
                    className="min-h-10 w-full rounded-lg num-tabular"
                  >
                    {n}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel>Настроение (1–10)</FieldLabel>
              <ToggleGroup
                type="single"
                value={editPulseMood}
                onValueChange={(v) => v && setEditPulseMood(v)}
                variant="outline"
                spacing={1}
                className="grid w-full grid-cols-5 gap-1.5 sm:grid-cols-10"
              >
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((n) => (
                  <ToggleGroupItem
                    key={n}
                    value={n}
                    className="min-h-10 w-full rounded-lg num-tabular"
                  >
                    {n}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="dash-edit-pulse-note">Заметка</FieldLabel>
              <Textarea
                id="dash-edit-pulse-note"
                rows={2}
                value={editPulseNote}
                onChange={(e) => setEditPulseNote(e.target.value)}
              />
            </Field>
          </FieldGroup>
          <Button type="submit" className="min-h-11 w-full rounded-xl">
            Сохранить изменения
          </Button>
        </form>
      </ResponsiveModal>

      {/* Create / Edit Task Modal */}
      <TaskFormModal
        open={taskModalOpen}
        onOpenChange={setTaskModalOpen}
        task={editingTask}
        projects={projects}
        defaultPlannedDate={modalPlannedDate}
        defaultScheduledTime={modalScheduledTime}
        onSaved={() => {
          if (timelineDate !== todayDate) {
            void loadTimelineDate(timelineDate);
          }
        }}
      />
    </div>
  );
}
