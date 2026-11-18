"use client";

import * as React from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckCircle2Icon,
  CheckIcon,
  FlagIcon,
  ListTodoIcon,
  Loader2Icon,
  PauseCircleIcon,
  PencilIcon,
  PlayCircleIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  TrophyIcon,
  UnlinkIcon,
} from "lucide-react";
import type {
  DaySlot,
  GoalLifeArea,
  GoalMilestoneDraftInput,
  GoalProgressMode,
  GoalStatus,
  GoalWithDetails,
} from "@life-os/db";
import {
  createGoalStepTaskAction,
  deleteGoalAction,
  manageGoalMilestoneAction,
  saveGoalAction,
  setGoalStatusAction,
  toggleGoalLinkedTaskAction,
  unlinkTaskFromGoalAction,
  updateGoalNumericAction,
} from "@/app/(app)/goals/actions";
import { ResponsiveModal } from "@/components/shell/responsive-modal";
import { cn, formatDateShortRu } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LIFE_AREA_META: Record<
  GoalLifeArea,
  { label: string; badge: string; bar: string }
> = {
  work: {
    label: "Работа",
    badge: "bg-domain-work/12 text-domain-work border-domain-work/25",
    bar: "bg-domain-work",
  },
  study: {
    label: "Учёба",
    badge: "bg-domain-mind/12 text-domain-mind border-domain-mind/25",
    bar: "bg-domain-mind",
  },
  launch: {
    label: "Запуски",
    badge: "bg-primary/12 text-primary border-primary/25",
    bar: "bg-primary",
  },
  finance: {
    label: "Финансы",
    badge: "bg-domain-finance/12 text-domain-finance border-domain-finance/25",
    bar: "bg-domain-finance",
  },
  health: {
    label: "Здоровье",
    badge: "bg-domain-health/12 text-domain-health border-domain-health/25",
    bar: "bg-domain-health",
  },
  personal: {
    label: "Личное",
    badge: "bg-domain-nutrition/12 text-domain-nutrition border-domain-nutrition/25",
    bar: "bg-domain-nutrition",
  },
};

const AREA_FILTERS: Array<{ value: "all" | GoalLifeArea; label: string }> = [
  { value: "all", label: "Все" },
  { value: "work", label: "Работа" },
  { value: "study", label: "Учёба" },
  { value: "launch", label: "Запуски" },
  { value: "finance", label: "Финансы" },
  { value: "health", label: "Здоровье" },
  { value: "personal", label: "Личное" },
];

const STATUS_FILTERS: Array<{ value: GoalStatus; label: string }> = [
  { value: "active", label: "Активные" },
  { value: "achieved", label: "Достигнутые" },
  { value: "paused", label: "На паузе" },
];

const MODE_LABELS: Record<GoalProgressMode, string> = {
  tasks_linked: "По задачам",
  milestones: "По этапам",
  numeric: "Числовая цель",
};

function formatGoalNum(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return "0";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
    Number(val)
  );
}

function addDaysIso(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

interface GoalsTabProps {
  goals: GoalWithDetails[];
  todayDate: string;
}

export function GoalsTab({ goals, todayDate }: GoalsTabProps) {
  const [areaFilter, setAreaFilter] = React.useState<"all" | GoalLifeArea>("all");
  const [statusFilter, setStatusFilter] = React.useState<GoalStatus>("active");
  const [goalModalOpen, setGoalModalOpen] = React.useState(false);
  const [editingGoal, setEditingGoal] = React.useState<GoalWithDetails | null>(null);
  const [stepGoal, setStepGoal] = React.useState<GoalWithDetails | null>(null);

  const activeGoals = React.useMemo(
    () => goals.filter((g) => g.status === "active"),
    [goals]
  );
  const achievedCount = goals.filter((g) => g.status === "achieved").length;
  const avgProgress =
    activeGoals.length > 0
      ? Math.round(
          activeGoals.reduce((sum, g) => sum + g.progress.progressPct, 0) /
            activeGoals.length
        )
      : 0;

  const filteredGoals = React.useMemo(() => {
    return goals.filter((g) => {
      if (g.status !== statusFilter) return false;
      if (areaFilter !== "all" && g.life_area !== areaFilter) return false;
      return true;
    });
  }, [goals, statusFilter, areaFilter]);

  return (
    <div className="flex flex-col gap-4">
      {/* Vertical-stacked KPI Summary Tiles */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Card className="rounded-2xl border-border/70 py-3 shadow-none">
          <CardContent className="flex flex-col gap-1 px-3.5 py-0">
            <span className="truncate text-xs text-muted-foreground">Активные</span>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight num-tabular sm:text-xl">
              {activeGoals.length}
            </span>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 py-3 shadow-none">
          <CardContent className="flex flex-col gap-1 px-3.5 py-0">
            <span className="truncate text-xs text-muted-foreground">
              Средний прогресс
            </span>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight num-tabular sm:text-xl">
              {avgProgress}%
            </span>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 py-3 shadow-none">
          <CardContent className="flex flex-col gap-1 px-3.5 py-0">
            <span className="truncate text-xs text-muted-foreground">Достигнуто</span>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight num-tabular sm:text-xl">
              {achievedCount}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Sphere & Status Filters + New Goal CTA */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((st) => (
              <button
                key={st.value}
                type="button"
                onClick={() => setStatusFilter(st.value)}
                className={cn(
                  "min-h-9 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors touch-manipulation",
                  statusFilter === st.value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/70 bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {st.label}
              </button>
            ))}
          </div>

          <Button
            type="button"
            onClick={() => {
              setEditingGoal(null);
              setGoalModalOpen(true);
            }}
            className="min-h-11 rounded-xl px-4 touch-manipulation"
          >
            <PlusIcon className="mr-1.5 size-4" />
            Новая цель
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {AREA_FILTERS.map((af) => (
            <button
              key={af.value}
              type="button"
              onClick={() => setAreaFilter(af.value)}
              className={cn(
                "min-h-8 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors touch-manipulation",
                areaFilter === af.value
                  ? "border-primary bg-primary/12 text-primary"
                  : "border-border/60 bg-background text-muted-foreground hover:text-foreground"
              )}
            >
              {af.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action-Driven Goal Cards */}
      {filteredGoals.length === 0 ? (
        <Card className="rounded-2xl border-dashed py-8 text-center shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-0">
            <p className="text-sm font-medium">
              {goals.length === 0
                ? "Активных целей пока нет"
                : "Нет целей по выбранному фильтру"}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Создайте цель по конкретным задачам, этапам или числовой метрике — прогресс будет обновляться от реальных действий.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3.5">
          {filteredGoals.map((goal) => (
            <GoalActionCard
              key={goal.id}
              goal={goal}
              onEdit={() => {
                setEditingGoal(goal);
                setGoalModalOpen(true);
              }}
              onAddStep={() => setStepGoal(goal)}
            />
          ))}
        </div>
      )}

      <GoalFormModal
        open={goalModalOpen}
        onOpenChange={setGoalModalOpen}
        goal={editingGoal}
        todayDate={todayDate}
      />

      <GoalStepModal
        open={Boolean(stepGoal)}
        onOpenChange={(open) => {
          if (!open) setStepGoal(null);
        }}
        goal={stepGoal}
        todayDate={todayDate}
      />
    </div>
  );
}

function GoalActionCard({
  goal,
  onEdit,
  onAddStep,
}: {
  goal: GoalWithDetails;
  onEdit: () => void;
  onAddStep: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [numericDraft, setNumericDraft] = React.useState(
    String(goal.progress.currentValue)
  );
  const [addingMilestone, setAddingMilestone] = React.useState(false);
  const [newMilestoneTitle, setNewMilestoneTitle] = React.useState("");

  React.useEffect(() => {
    setNumericDraft(String(goal.progress.currentValue));
  }, [goal.progress.currentValue]);

  const area =
    LIFE_AREA_META[goal.life_area as GoalLifeArea] ?? LIFE_AREA_META.personal;
  const unitSuffix = goal.unit ? ` ${goal.unit}` : "";

  function handleNumericSave(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(numericDraft.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      toast.error("Введите корректное число");
      return;
    }
    startTransition(async () => {
      try {
        await updateGoalNumericAction({ goalId: goal.id, value: parsed });
        toast.success("Показатель цели обновлён");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка обновления");
      }
    });
  }

  function handleAddMilestone(e: React.FormEvent) {
    e.preventDefault();
    const clean = newMilestoneTitle.trim();
    if (!clean) return;
    startTransition(async () => {
      try {
        await manageGoalMilestoneAction({
          action: "add",
          goalId: goal.id,
          title: clean,
        });
        setNewMilestoneTitle("");
        setAddingMilestone(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось добавить этап");
      }
    });
  }

  function handleToggleMilestone(milestoneId: number, nextDone: boolean) {
    startTransition(async () => {
      try {
        await manageGoalMilestoneAction({
          action: "toggle",
          goalId: goal.id,
          milestoneId,
          isCompleted: nextDone,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка переключения этапа");
      }
    });
  }

  function handleDeleteMilestone(milestoneId: number) {
    startTransition(async () => {
      try {
        await manageGoalMilestoneAction({
          action: "delete",
          goalId: goal.id,
          milestoneId,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить этап");
      }
    });
  }

  function handleToggleTask(taskId: number, completed: boolean) {
    startTransition(async () => {
      try {
        await toggleGoalLinkedTaskAction({ taskId, completed });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка обновления задачи");
      }
    });
  }

  function handleUnlinkTask(taskId: number) {
    startTransition(async () => {
      try {
        await unlinkTaskFromGoalAction(taskId);
        toast.success("Задача отвязана от цели");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось отвязать задачу");
      }
    });
  }

  const nonCancelledTasks = goal.linkedTasks.filter((t) => t.status !== "cancelled");

  return (
    <Card className="rounded-2xl border-border/75 py-4 shadow-none">
      <CardContent className="flex flex-col gap-3.5 px-4 py-0 sm:px-5">
        {/* Header & Badges */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn("rounded-lg border px-2 py-0.5 text-xs", area.badge)}
              >
                {area.label}
              </Badge>
              <Badge variant="secondary" className="rounded-lg px-2 py-0.5 text-xs">
                {MODE_LABELS[goal.progress_mode as GoalProgressMode] ?? "По задачам"}
              </Badge>
              {goal.target_date ? (
                <Badge
                  variant="outline"
                  className="rounded-lg px-2 py-0.5 text-xs text-muted-foreground num-tabular"
                >
                  <CalendarIcon className="mr-1 size-3" />
                  до {formatDateShortRu(goal.target_date)}
                </Badge>
              ) : null}
              {goal.progress.isStalled ? (
                <Badge
                  variant="outline"
                  className="rounded-lg border-warning/40 bg-warning/15 px-2 py-0.5 text-xs font-medium text-foreground"
                >
                  <AlertTriangleIcon className="mr-1 size-3 text-warning" />
                  Нет открытого шага
                </Badge>
              ) : null}
            </div>

            <h3 className="text-base font-semibold leading-snug sm:text-lg">
              {goal.title}
            </h3>
            {goal.motivation_note ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {goal.motivation_note}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onEdit}
            aria-label={`Редактировать цель ${goal.title}`}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground touch-manipulation"
          >
            <PencilIcon className="size-4" />
          </button>
        </div>

        {/* Animated Motion Progress Bar */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground num-tabular">
              {goal.progress_mode === "numeric" && goal.progress.targetValue !== null ? (
                goal.progress.isDecreasingNumeric ? (
                  <>
                    Старт {formatGoalNum(goal.progress.startValue)} → сейчас{" "}
                    <strong className="font-semibold text-foreground">
                      {formatGoalNum(goal.progress.currentValue)}
                    </strong>{" "}
                    → цель {formatGoalNum(goal.progress.targetValue)}
                    {unitSuffix}
                  </>
                ) : (
                  <>
                    <strong className="font-semibold text-foreground">
                      {formatGoalNum(goal.progress.currentValue)}
                    </strong>{" "}
                    из {formatGoalNum(goal.progress.targetValue)}
                    {unitSuffix}
                  </>
                )
              ) : (
                <>
                  Выполнено шагов:{" "}
                  <strong className="font-semibold text-foreground">
                    {goal.progress.doneCount} из {goal.progress.totalCount}
                  </strong>
                </>
              )}
            </span>
            <span className="text-sm font-semibold num-tabular">
              {goal.progress.progressPct}%
            </span>
          </div>

          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${goal.progress.progressPct}%` }}
              transition={{ type: "spring", stiffness: 160, damping: 24 }}
              className={cn("h-full rounded-full", area.bar)}
            />
          </div>
        </div>

        {/* Inline Numeric Value Updater */}
        {goal.progress_mode === "numeric" && goal.status === "active" ? (
          <form
            onSubmit={handleNumericSave}
            className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/45 p-2.5"
          >
            <span className="text-xs font-medium text-muted-foreground">
              Текущий показатель{unitSuffix ? ` (${goal.unit})` : ""}:
            </span>
            <Input
              type="text"
              inputMode="decimal"
              value={numericDraft}
              onChange={(e) => setNumericDraft(e.target.value)}
              className="h-9 w-28 bg-background text-sm font-medium num-tabular"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={pending}
              className="min-h-9 rounded-lg px-3 text-xs touch-manipulation"
            >
              Обновить
            </Button>
          </form>
        ) : null}

        {/* Milestones Checklist + Inline Add */}
        {(goal.progress_mode === "milestones" || goal.milestones.length > 0) && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-muted/25 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <FlagIcon className="size-3.5" />
                Этапы ({goal.milestones.filter((m) => m.is_completed).length}/
                {goal.milestones.length})
              </span>
              <button
                type="button"
                onClick={() => setAddingMilestone((v) => !v)}
                className="text-xs font-medium text-primary hover:underline touch-manipulation"
              >
                + Добавить этап
              </button>
            </div>

            {goal.milestones.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-lg py-1"
              >
                <button
                  type="button"
                  onClick={() => handleToggleMilestone(m.id, !m.is_completed)}
                  className="flex min-h-9 flex-1 items-center gap-2.5 text-left text-sm touch-manipulation"
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                      m.is_completed
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background"
                    )}
                  >
                    {m.is_completed ? <CheckIcon className="size-3.5 stroke-[2.5]" /> : null}
                  </span>
                  <span
                    className={cn(
                      "leading-snug",
                      m.is_completed && "text-muted-foreground line-through"
                    )}
                  >
                    {m.title}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteMilestone(m.id)}
                  aria-label="Удалить этап"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-muted hover:text-destructive touch-manipulation"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </div>
            ))}

            {addingMilestone ? (
              <form onSubmit={handleAddMilestone} className="mt-1 flex items-center gap-2">
                <Input
                  value={newMilestoneTitle}
                  onChange={(e) => setNewMilestoneTitle(e.target.value)}
                  placeholder="Название этапа..."
                  className="h-9 flex-1 bg-background text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={pending}
                  className="min-h-9 rounded-lg touch-manipulation"
                >
                  Добавить
                </Button>
              </form>
            ) : null}
          </div>
        )}

        {/* Linked Concrete Tasks Checklist + "+ Добавить шаг в задачи" */}
        <div className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <ListTodoIcon className="size-3.5" />
              Конкретные шаги в задачах (
              <span className="num-tabular">
                {nonCancelledTasks.filter((t) => t.status === "done").length}/
                {nonCancelledTasks.length}
              </span>
              )
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAddStep}
              className="min-h-9 rounded-lg px-2.5 text-xs touch-manipulation"
            >
              <PlusIcon className="mr-1 size-3.5" />
              Добавить шаг в задачи
            </Button>
          </div>

          {nonCancelledTasks.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">
              Пока нет привязанных задач. Наметьте один конкретный шаг на ближайший день.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border/50">
              {nonCancelledTasks.map((task) => {
                const isDone = task.status === "done";
                return (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-2 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleTask(task.id, !isDone)}
                      className="flex min-h-9 flex-1 items-center gap-2.5 text-left text-sm touch-manipulation"
                    >
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                          isDone
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background"
                        )}
                      >
                        {isDone ? <CheckIcon className="size-3 stroke-[2.5]" /> : null}
                      </span>
                      <span
                        className={cn(
                          "flex-1 leading-snug",
                          isDone && "text-muted-foreground line-through"
                        )}
                      >
                        {task.title}
                      </span>
                    </button>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {task.planned_date ? (
                        <span className="text-[11px] text-muted-foreground num-tabular">
                          {formatDateShortRu(task.planned_date)}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        title="Отвязать задачу от цели"
                        onClick={() => handleUnlinkTask(task.id)}
                        className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-muted hover:text-foreground touch-manipulation"
                      >
                        <UnlinkIcon className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Linked Habits Footer */}
        {goal.linkedHabits.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <SparklesIcon className="size-3.5 text-primary" />
            <span>Поддерживающие привычки:</span>
            {goal.linkedHabits.map((h) => (
              <Badge key={h.id} variant="secondary" className="rounded-md text-xs">
                {h.title}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GoalStepModal({
  open,
  onOpenChange,
  goal,
  todayDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: GoalWithDetails | null;
  todayDate: string;
}) {
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState("");
  const [plannedDate, setPlannedDate] = React.useState(todayDate);
  const [daySlot, setDaySlot] = React.useState<DaySlot>("morning");
  const [priority, setPriority] = React.useState("2");

  React.useEffect(() => {
    if (!open) return;
    setTitle("");
    setPlannedDate(todayDate);
    setDaySlot("morning");
    setPriority("2");
  }, [open, todayDate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!goal) return;
    startTransition(async () => {
      try {
        await createGoalStepTaskAction({
          goalId: goal.id,
          title,
          planned_date: plannedDate || null,
          day_slot: daySlot,
          priority: Number(priority) || 2,
        });
        toast.success("Шаг добавлен в задачи и привязан к цели");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка создания шага");
      }
    });
  }

  const tomorrowDate = addDaysIso(todayDate, 1);

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Добавить шаг в задачи"
      description={goal ? `Цель: «${goal.title}»` : undefined}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel>Конкретное действие</FieldLabel>
            <Input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Что именно можно сделать за 30–60 минут?"
              className="min-h-11"
            />
          </Field>

          <Field>
            <FieldLabel>Дата планирования</FieldLabel>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setPlannedDate(todayDate)}
                className={cn(
                  "min-h-9 rounded-lg border px-3 text-xs font-medium touch-manipulation",
                  plannedDate === todayDate
                    ? "border-primary bg-primary/12 text-primary"
                    : "border-border text-muted-foreground"
                )}
              >
                Сегодня
              </button>
              <button
                type="button"
                onClick={() => setPlannedDate(tomorrowDate)}
                className={cn(
                  "min-h-9 rounded-lg border px-3 text-xs font-medium touch-manipulation",
                  plannedDate === tomorrowDate
                    ? "border-primary bg-primary/12 text-primary"
                    : "border-border text-muted-foreground"
                )}
              >
                Завтра
              </button>
              <button
                type="button"
                onClick={() => setPlannedDate("")}
                className={cn(
                  "min-h-9 rounded-lg border px-3 text-xs font-medium touch-manipulation",
                  plannedDate === ""
                    ? "border-primary bg-primary/12 text-primary"
                    : "border-border text-muted-foreground"
                )}
              >
                Без даты
              </button>
            </div>
            <Input
              type="date"
              value={plannedDate}
              onChange={(e) => setPlannedDate(e.target.value)}
              className="min-h-11 num-tabular"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>Слот дня</FieldLabel>
              <Select value={daySlot} onValueChange={(v) => setDaySlot(v as DaySlot)}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="morning">☀️ Утро</SelectItem>
                    <SelectItem value="afternoon">🌤 День</SelectItem>
                    <SelectItem value="evening">🌙 Вечер</SelectItem>
                    <SelectItem value="any">Гибко</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Приоритет</FieldLabel>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="1">P1 — Фокус</SelectItem>
                    <SelectItem value="2">P2 — Обычный</SelectItem>
                    <SelectItem value="3">P3 — Спокойный</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="min-h-11 rounded-xl touch-manipulation"
          >
            Отмена
          </Button>
          <Button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-xl px-5 touch-manipulation"
          >
            {pending ? <Loader2Icon className="mr-1.5 size-4 animate-spin" /> : null}
            Создать шаг
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

function GoalFormModal({
  open,
  onOpenChange,
  goal,
  todayDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: GoalWithDetails | null;
  todayDate: string;
}) {
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState("");
  const [lifeArea, setLifeArea] = React.useState<GoalLifeArea>("work");
  const [motivation, setMotivation] = React.useState("");
  const [mode, setMode] = React.useState<GoalProgressMode>("tasks_linked");
  const [startValue, setStartValue] = React.useState("0");
  const [currentValue, setCurrentValue] = React.useState("0");
  const [targetValue, setTargetValue] = React.useState("100");
  const [unit, setUnit] = React.useState("");
  const [targetDate, setTargetDate] = React.useState("");
  const [milestonesDraft, setMilestonesDraft] = React.useState<
    GoalMilestoneDraftInput[]
  >([]);

  React.useEffect(() => {
    if (!open) return;
    if (goal) {
      setTitle(goal.title);
      setLifeArea((goal.life_area as GoalLifeArea) || "personal");
      setMotivation(goal.motivation_note ?? "");
      setMode((goal.progress_mode as GoalProgressMode) || "tasks_linked");
      setStartValue(String(goal.start_value ?? 0));
      setCurrentValue(String(goal.current_value ?? 0));
      setTargetValue(goal.target_value !== null ? String(goal.target_value) : "");
      setUnit(goal.unit ?? "");
      setTargetDate(goal.target_date ?? "");
      setMilestonesDraft(
        goal.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          due_date: m.due_date,
          is_completed: m.is_completed,
          sort_order: m.sort_order,
        }))
      );
    } else {
      setTitle("");
      setLifeArea("work");
      setMotivation("");
      setMode("tasks_linked");
      setStartValue("0");
      setCurrentValue("0");
      setTargetValue("100");
      setUnit("");
      setTargetDate(addDaysIso(todayDate, 60));
      setMilestonesDraft([
        { title: "", is_completed: false },
        { title: "", is_completed: false },
      ]);
    }
  }, [open, goal, todayDate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const parseNum = (s: string) => Number(s.replace(",", "."));
        await saveGoalAction({
          id: goal?.id,
          title,
          life_area: lifeArea,
          motivation_note: motivation.trim() || null,
          progress_mode: mode,
          start_value: mode === "numeric" ? parseNum(startValue) || 0 : undefined,
          current_value: mode === "numeric" ? parseNum(currentValue) || 0 : undefined,
          target_value:
            mode === "numeric" && targetValue.trim() !== ""
              ? parseNum(targetValue)
              : undefined,
          unit: mode === "numeric" ? unit.trim() || null : null,
          target_date: targetDate || null,
          milestones:
            mode === "milestones"
              ? milestonesDraft.filter((m) => m.title.trim() !== "")
              : undefined,
        });
        toast.success(goal ? "Цель обновлена" : "Цель создана");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения цели");
      }
    });
  }

  function handleStatusChange(nextStatus: GoalStatus) {
    if (!goal) return;
    startTransition(async () => {
      try {
        await setGoalStatusAction({ goalId: goal.id, status: nextStatus });
        toast.success("Статус цели обновлён");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка смены статуса");
      }
    });
  }

  function handleDelete() {
    if (!goal) return;
    startTransition(async () => {
      try {
        await deleteGoalAction(goal.id);
        toast.success("Цель удалена");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить цель");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={goal ? "Редактировать цель" : "Новая цель"}
      description="Сфокусируйтесь на результате и выберите честный способ расчёта прогресса"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel>Формулировка цели</FieldLabel>
            <Input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Подушка безопасности 300 000 ₽ или Снизить вес до 79 кг"
              className="min-h-11"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Сфера жизни</FieldLabel>
              <Select
                value={lifeArea}
                onValueChange={(v) => setLifeArea(v as GoalLifeArea)}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="work">Работа</SelectItem>
                    <SelectItem value="study">Учёба</SelectItem>
                    <SelectItem value="launch">Запуски</SelectItem>
                    <SelectItem value="finance">Финансы</SelectItem>
                    <SelectItem value="health">Здоровье</SelectItem>
                    <SelectItem value="personal">Личное</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Ориентир по дате</FieldLabel>
              <Input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>Зачем это важно (опора / мотивация)</FieldLabel>
            <Textarea
              rows={2}
              value={motivation}
              onChange={(e) => setMotivation(e.target.value)}
              placeholder="Спокойный резерв на 3 месяца жизни без тревоги"
            />
          </Field>

          <Field>
            <FieldLabel>Как считать прогресс</FieldLabel>
            <div className="grid grid-cols-3 gap-1.5">
              {(["tasks_linked", "milestones", "numeric"] as GoalProgressMode[]).map(
                (m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "min-h-11 rounded-xl border px-2 text-xs font-medium touch-manipulation",
                      mode === m
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground"
                    )}
                  >
                    {MODE_LABELS[m]}
                  </button>
                )
              )}
            </div>
          </Field>

          {mode === "numeric" ? (
            <div className="grid grid-cols-2 gap-2.5 rounded-xl bg-muted/45 p-3 sm:grid-cols-4">
              <Field>
                <FieldLabel>Старт</FieldLabel>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={startValue}
                  onChange={(e) => setStartValue(e.target.value)}
                  placeholder="0 или 84"
                  className="min-h-11 bg-background num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel>Сейчас</FieldLabel>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={currentValue}
                  onChange={(e) => setCurrentValue(e.target.value)}
                  placeholder="0 или 81.6"
                  className="min-h-11 bg-background num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel>Цель</FieldLabel>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  placeholder="300000 или 79"
                  className="min-h-11 bg-background num-tabular"
                />
              </Field>
              <Field>
                <FieldLabel>Ед. изм.</FieldLabel>
                <Input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="₽, кг, книг"
                  className="min-h-11 bg-background"
                />
              </Field>
            </div>
          ) : null}

          {mode === "milestones" ? (
            <Field>
              <FieldLabel>Ключевые этапы</FieldLabel>
              <div className="flex flex-col gap-2">
                {milestonesDraft.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={m.title}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMilestonesDraft((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, title: val } : item
                          )
                        );
                      }}
                      placeholder={`Этап ${idx + 1}`}
                      className="min-h-10 flex-1"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setMilestonesDraft((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-destructive touch-manipulation"
                    >
                      <Trash2Icon className="size-4" />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setMilestonesDraft((prev) => [
                      ...prev,
                      { title: "", is_completed: false },
                    ])
                  }
                  className="min-h-10 self-start rounded-xl touch-manipulation"
                >
                  <PlusIcon className="mr-1 size-4" />
                  Ещё этап
                </Button>
              </div>
            </Field>
          ) : null}
        </FieldGroup>

        {goal ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
            {goal.status !== "achieved" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => handleStatusChange("achieved")}
                className="min-h-10 rounded-xl touch-manipulation"
              >
                <TrophyIcon className="mr-1.5 size-4 text-domain-finance" />
                Отметить достигнутой
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => handleStatusChange("active")}
                className="min-h-10 rounded-xl touch-manipulation"
              >
                <CheckCircle2Icon className="mr-1.5 size-4" />
                Вернуть в активные
              </Button>
            )}

            {goal.status === "active" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => handleStatusChange("paused")}
                className="min-h-10 rounded-xl touch-manipulation"
              >
                <PauseCircleIcon className="mr-1.5 size-4" />
                На паузу
              </Button>
            ) : goal.status === "paused" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => handleStatusChange("active")}
                className="min-h-10 rounded-xl touch-manipulation"
              >
                <PlayCircleIcon className="mr-1.5 size-4" />
                Возобновить
              </Button>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={handleDelete}
              className="ml-auto min-h-10 rounded-xl text-destructive hover:text-destructive touch-manipulation"
            >
              <Trash2Icon className="mr-1 size-4" />
              Удалить
            </Button>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="min-h-11 rounded-xl touch-manipulation"
          >
            Отмена
          </Button>
          <Button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-xl px-5 touch-manipulation"
          >
            {pending ? <Loader2Icon className="mr-1.5 size-4 animate-spin" /> : null}
            Сохранить
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}
