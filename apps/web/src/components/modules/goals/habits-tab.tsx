"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  ArchiveIcon,
  BellIcon,
  BookOpenIcon,
  BrainIcon,
  CheckIcon,
  DropletsIcon,
  DumbbellIcon,
  FlameIcon,
  FootprintsIcon,
  HeartPulseIcon,
  Loader2Icon,
  MoonStarIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  TargetIcon,
  Trash2Icon,
} from "lucide-react";
import type {
  GoalWithDetails,
  HabitCadence,
  HabitPreferredSlot,
  HabitWithStats,
} from "@life-os/db";
import {
  archiveHabitAction,
  deleteHabitAction,
  saveHabitAction,
  toggleHabitCheckinAction,
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

export const HABIT_COLOR_STYLES: Record<
  string,
  {
    label: string;
    dot: string;
    activeBtn: string;
    softBg: string;
    cellDone: string;
    text: string;
  }
> = {
  "domain-health": {
    label: "Здоровье",
    dot: "bg-domain-health",
    activeBtn: "bg-domain-health text-white border-domain-health",
    softBg: "bg-domain-health/12 text-domain-health border-domain-health/25",
    cellDone: "bg-domain-health text-white",
    text: "text-domain-health",
  },
  "domain-work": {
    label: "Работа",
    dot: "bg-domain-work",
    activeBtn: "bg-domain-work text-white border-domain-work",
    softBg: "bg-domain-work/12 text-domain-work border-domain-work/25",
    cellDone: "bg-domain-work text-white",
    text: "text-domain-work",
  },
  "domain-mind": {
    label: "Фокус и ум",
    dot: "bg-domain-mind",
    activeBtn: "bg-domain-mind text-white border-domain-mind",
    softBg: "bg-domain-mind/12 text-domain-mind border-domain-mind/25",
    cellDone: "bg-domain-mind text-white",
    text: "text-domain-mind",
  },
  "domain-study": {
    label: "Учёба",
    dot: "bg-domain-mind",
    activeBtn: "bg-domain-mind text-white border-domain-mind",
    softBg: "bg-domain-mind/12 text-domain-mind border-domain-mind/25",
    cellDone: "bg-domain-mind text-white",
    text: "text-domain-mind",
  },
  "domain-finance": {
    label: "Финансы",
    dot: "bg-domain-finance",
    activeBtn: "bg-domain-finance text-white border-domain-finance",
    softBg: "bg-domain-finance/12 text-domain-finance border-domain-finance/25",
    cellDone: "bg-domain-finance text-white",
    text: "text-domain-finance",
  },
  "domain-nutrition": {
    label: "Питание и вода",
    dot: "bg-domain-nutrition",
    activeBtn: "bg-domain-nutrition text-white border-domain-nutrition",
    softBg: "bg-domain-nutrition/12 text-domain-nutrition border-domain-nutrition/25",
    cellDone: "bg-domain-nutrition text-white",
    text: "text-domain-nutrition",
  },
  primary: {
    label: "Базовый",
    dot: "bg-primary",
    activeBtn: "bg-primary text-primary-foreground border-primary",
    softBg: "bg-primary/12 text-primary border-primary/25",
    cellDone: "bg-primary text-primary-foreground",
    text: "text-primary",
  },
};

const HABIT_ICONS: Array<{
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "droplets", label: "Вода", Icon: DropletsIcon },
  { key: "footprints", label: "Шаги", Icon: FootprintsIcon },
  { key: "book-open", label: "Чтение", Icon: BookOpenIcon },
  { key: "dumbbell", label: "Спорт", Icon: DumbbellIcon },
  { key: "moon", label: "Вечер", Icon: MoonStarIcon },
  { key: "brain", label: "Фокус", Icon: BrainIcon },
  { key: "heart", label: "Ресурс", Icon: HeartPulseIcon },
  { key: "sparkles", label: "Ритуал", Icon: SparklesIcon },
];

const SLOT_FILTERS: Array<{ value: "all" | HabitPreferredSlot; label: string }> = [
  { value: "all", label: "Все" },
  { value: "morning", label: "☀️ Утро" },
  { value: "afternoon", label: "🌤 День" },
  { value: "evening", label: "🌙 Вечер" },
  { value: "any", label: "Гибко" },
];

const SLOT_BADGE_LABELS: Record<HabitPreferredSlot, string> = {
  morning: "☀️ Утро",
  afternoon: "🌤 День",
  evening: "🌙 Вечер",
  any: "Гибко",
};

function renderHabitIcon(iconName: string | null | undefined, className?: string) {
  const match = HABIT_ICONS.find((i) => i.key === iconName);
  const IconComp = match?.Icon ?? SparklesIcon;
  return <IconComp className={className} />;
}

type OptimisticTogglePayload = {
  habitId: number;
  date: string;
  completed: boolean;
};

function applyOptimisticHabitToggle(
  state: HabitWithStats[],
  action: OptimisticTogglePayload,
  anchorDate: string
): HabitWithStats[] {
  return state.map((habit) => {
    if (habit.id !== action.habitId) return habit;
    const prevCell = habit.history.find((c) => c.date === action.date);
    const wasDone = prevCell ? prevCell.completed : false;
    if (wasDone === action.completed) return habit;

    const delta = action.completed ? 1 : -1;
    const nextHistory = habit.history.map((c) =>
      c.date === action.date ? { ...c, completed: action.completed } : c
    );
    const isAnchor = action.date === anchorDate;
    const nextStreak = isAnchor
      ? Math.max(0, habit.currentStreak + delta)
      : habit.currentStreak;

    return {
      ...habit,
      completedOnAnchorDate: isAnchor ? action.completed : habit.completedOnAnchorDate,
      history: nextHistory,
      thisWeekDone: Math.max(0, habit.thisWeekDone + delta),
      currentStreak: nextStreak,
      bestStreak: Math.max(habit.bestStreak, nextStreak),
    };
  });
}

interface HabitsTabProps {
  habits: HabitWithStats[];
  goals: GoalWithDetails[];
  anchorDate: string;
}

export function HabitsTab({ habits, goals, anchorDate }: HabitsTabProps) {
  const [, startTransition] = React.useTransition();
  const [slotFilter, setSlotFilter] = React.useState<"all" | HabitPreferredSlot>("all");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingHabit, setEditingHabit] = React.useState<HabitWithStats | null>(null);

  const [optimisticHabits, addOptimisticToggle] = React.useOptimistic(
    habits,
    (current: HabitWithStats[], payload: OptimisticTogglePayload) =>
      applyOptimisticHabitToggle(current, payload, anchorDate)
  );

  const activeHabits = React.useMemo(
    () => optimisticHabits.filter((h) => !h.is_archived),
    [optimisticHabits]
  );

  const filteredHabits = React.useMemo(() => {
    if (slotFilter === "all") return activeHabits;
    return activeHabits.filter((h) => h.preferred_slot === slotFilter);
  }, [activeHabits, slotFilter]);

  const todayDone = activeHabits.filter((h) => h.completedOnAnchorDate).length;
  const todayTotal = activeHabits.length;
  const bestStreak = activeHabits.reduce(
    (mx, h) => Math.max(mx, h.currentStreak, h.bestStreak),
    0
  );
  const avgAdherence30d =
    activeHabits.length > 0
      ? Math.round(
          activeHabits.reduce((sum, h) => sum + h.adherence30dPct, 0) / activeHabits.length
        )
      : 0;

  function handleToggleCheckin(habitId: number, date: string, nextCompleted: boolean) {
    startTransition(async () => {
      addOptimisticToggle({ habitId, date, completed: nextCompleted });
      try {
        await toggleHabitCheckinAction({
          habitId,
          date,
          completed: nextCompleted,
        });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Не удалось сохранить отметку привычки"
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Vertical-stacked KPI Summary Tiles */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Card className="rounded-2xl border-border/70 py-3 shadow-none">
          <CardContent className="flex flex-col gap-1 px-3.5 py-0">
            <span className="truncate text-xs text-muted-foreground">Сегодня</span>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight num-tabular sm:text-xl">
              {todayDone} из {todayTotal}
            </span>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 py-3 shadow-none">
          <CardContent className="flex flex-col gap-1 px-3.5 py-0">
            <span className="truncate text-xs text-muted-foreground">Лучшая серия</span>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight num-tabular sm:text-xl">
              🔥 {bestStreak} дн.
            </span>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 py-3 shadow-none">
          <CardContent className="flex flex-col gap-1 px-3.5 py-0">
            <span className="truncate text-xs text-muted-foreground">
              Стабильность 30 дн.
            </span>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight num-tabular sm:text-xl">
              {avgAdherence30d}%
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Slot Filter + Create Button */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {SLOT_FILTERS.map((f) => {
            const active = slotFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setSlotFilter(f.value)}
                className={cn(
                  "min-h-9 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors touch-manipulation",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <Button
          type="button"
          onClick={() => {
            setEditingHabit(null);
            setModalOpen(true);
          }}
          className="min-h-11 rounded-xl px-4 touch-manipulation"
        >
          <PlusIcon className="mr-1.5 size-4" />
          Привычка
        </Button>
      </div>

      {/* 1-Tap Habit Cards */}
      {filteredHabits.length === 0 ? (
        <Card className="rounded-2xl border-dashed py-8 text-center shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-0">
            <p className="text-sm font-medium">
              {activeHabits.length === 0
                ? "Активных привычек пока нет"
                : "В этом слоте пока нет привычек"}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Добавьте короткий ежедневный ритуал или привычку с гибкой целью на неделю — отмечается в один тап.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filteredHabits.map((habit) => {
            const palette =
              HABIT_COLOR_STYLES[habit.color_token] ?? HABIT_COLOR_STYLES["domain-health"];
            const cells21 = habit.history.slice(-21);
            const reminderHhMm = habit.reminder_time
              ? habit.reminder_time.slice(0, 5)
              : null;

            return (
              <Card
                key={habit.id}
                className={cn(
                  "rounded-2xl border-border/75 py-4 shadow-none transition-colors",
                  habit.completedOnAnchorDate && "bg-accent/25"
                )}
              >
                <CardContent className="flex flex-col gap-3.5 px-4 py-0">
                  <div className="flex items-start gap-3">
                    {/* 44x44px+ Optimistic 1-Tap Check Button */}
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 450, damping: 24 }}
                      aria-label={
                        habit.completedOnAnchorDate
                          ? `Снять отметку: ${habit.title}`
                          : `Отметить выполнение: ${habit.title}`
                      }
                      onClick={() =>
                        handleToggleCheckin(
                          habit.id,
                          anchorDate,
                          !habit.completedOnAnchorDate
                        )
                      }
                      className={cn(
                        "flex size-12 shrink-0 items-center justify-center rounded-2xl border-2 transition-colors touch-manipulation",
                        habit.completedOnAnchorDate
                          ? palette.activeBtn
                          : "border-border bg-background text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        {habit.completedOnAnchorDate ? (
                          <motion.span
                            key="checked"
                            initial={{ scale: 0.4, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.4, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 520, damping: 24 }}
                          >
                            <CheckIcon className="size-5 stroke-[2.6]" />
                          </motion.span>
                        ) : (
                          <motion.span
                            key="icon"
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                          >
                            {renderHabitIcon(habit.icon_name, cn("size-5", palette.text))}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </motion.button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3
                            className={cn(
                              "text-base font-semibold leading-snug",
                              habit.completedOnAnchorDate && "text-foreground/85"
                            )}
                          >
                            {habit.title}
                          </h3>
                          {habit.description ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {habit.description}
                            </p>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingHabit(habit);
                            setModalOpen(true);
                          }}
                          aria-label={`Настроить привычку ${habit.title}`}
                          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground touch-manipulation"
                        >
                          <PencilIcon className="size-4" />
                        </button>
                      </div>

                      {/* Badges Row */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className="rounded-lg px-2 py-0.5 text-xs font-medium num-tabular"
                        >
                          <FlameIcon className="mr-1 size-3.5 text-domain-nutrition" />
                          {habit.currentStreak} дн.
                        </Badge>

                        <Badge
                          variant="outline"
                          className="rounded-lg px-2 py-0.5 text-xs font-medium num-tabular"
                        >
                          {habit.thisWeekDone}/{habit.thisWeekTarget} за нед.
                        </Badge>

                        <Badge
                          variant="outline"
                          className="rounded-lg px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {SLOT_BADGE_LABELS[habit.preferred_slot as HabitPreferredSlot] ??
                            "Гибко"}
                        </Badge>

                        {reminderHhMm ? (
                          <Badge
                            variant="outline"
                            className="rounded-lg px-2 py-0.5 text-xs num-tabular"
                          >
                            <BellIcon className="mr-1 size-3" />
                            {reminderHhMm}
                          </Badge>
                        ) : null}

                        {habit.goalTitle ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "max-w-[200px] truncate rounded-lg border px-2 py-0.5 text-xs",
                              palette.softBg
                            )}
                          >
                            <TargetIcon className="mr-1 size-3 shrink-0" />
                            <span className="truncate">{habit.goalTitle}</span>
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Interactive 21-Day Mini-Heatmap (Tapping any day toggles that date!) */}
                  <div className="rounded-xl bg-muted/45 p-2.5">
                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Последние 21 день (тапните день для отметки)</span>
                      <span className="font-medium num-tabular">
                        30 дн.: {habit.adherence30dPct}%
                      </span>
                    </div>
                    <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-21 sm:gap-1">
                      {cells21.map((cell) => {
                        const dayNum = cell.date.slice(8, 10).replace(/^0/, "");
                        const isToday = cell.date === anchorDate;
                        return (
                          <button
                            key={cell.date}
                            type="button"
                            title={`${formatDateShortRu(cell.date)}: ${
                              cell.completed ? "выполнено" : "не отмечено"
                            }`}
                            onClick={() =>
                              handleToggleCheckin(habit.id, cell.date, !cell.completed)
                            }
                            className={cn(
                              "flex h-7 items-center justify-center rounded-md text-[11px] font-medium transition-transform active:scale-95 touch-manipulation num-tabular",
                              cell.completed
                                ? palette.cellDone
                                : "bg-background/90 text-muted-foreground hover:bg-muted",
                              isToday && "ring-2 ring-foreground/40 ring-offset-1 ring-offset-background"
                            )}
                          >
                            {dayNum}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <HabitFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        habit={editingHabit}
        goals={goals}
      />
    </div>
  );
}

interface HabitFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habit: HabitWithStats | null;
  goals: GoalWithDetails[];
}

function HabitFormModal({ open, onOpenChange, habit, goals }: HabitFormModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [iconName, setIconName] = React.useState("droplets");
  const [colorToken, setColorToken] = React.useState("domain-health");
  const [goalId, setGoalId] = React.useState("none");
  const [cadence, setCadence] = React.useState<HabitCadence>("daily");
  const [targetPerWeek, setTargetPerWeek] = React.useState("3");
  const [slot, setSlot] = React.useState<HabitPreferredSlot>("morning");
  const [reminderTime, setReminderTime] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    if (habit) {
      setTitle(habit.title);
      setDescription(habit.description ?? "");
      setIconName(habit.icon_name || "droplets");
      setColorToken(habit.color_token || "domain-health");
      setGoalId(habit.goal_id ? String(habit.goal_id) : "none");
      setCadence((habit.cadence as HabitCadence) || "daily");
      setTargetPerWeek(String(habit.target_per_week || 3));
      setSlot((habit.preferred_slot as HabitPreferredSlot) || "any");
      setReminderTime(habit.reminder_time ? habit.reminder_time.slice(0, 5) : "");
    } else {
      setTitle("");
      setDescription("");
      setIconName("droplets");
      setColorToken("domain-health");
      setGoalId("none");
      setCadence("daily");
      setTargetPerWeek("3");
      setSlot("morning");
      setReminderTime("");
    }
  }, [open, habit]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveHabitAction({
          id: habit?.id,
          title,
          description: description.trim() || null,
          icon_name: iconName,
          color_token: colorToken,
          goal_id: goalId === "none" ? null : Number(goalId),
          cadence,
          target_per_week: cadence === "daily" ? 7 : Number(targetPerWeek) || 3,
          preferred_slot: slot,
          reminder_time: reminderTime.trim() || null,
        });
        toast.success(habit ? "Привычка обновлена" : "Привычка добавлена");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения привычки");
      }
    });
  }

  function handleArchive() {
    if (!habit) return;
    startTransition(async () => {
      try {
        await archiveHabitAction({ habitId: habit.id, archived: true });
        toast.success("Привычка перенесена в архив");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось архивировать");
      }
    });
  }

  function handleDelete() {
    if (!habit) return;
    startTransition(async () => {
      try {
        await deleteHabitAction(habit.id);
        toast.success("Привычка удалена");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить привычку");
      }
    });
  }

  const selectableColors = [
    "domain-health",
    "domain-nutrition",
    "domain-mind",
    "domain-work",
    "domain-finance",
    "primary",
  ];

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={habit ? "Настроить привычку" : "Новая привычка"}
      description="Спокойный трекер в один тап с гибким ритмом и привязкой к цели"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel>Название</FieldLabel>
            <Input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Чтение 20 минут или Вода 2 л"
              className="min-h-11"
            />
          </Field>

          <Field>
            <FieldLabel>Короткая подсказка / якорь (необязательно)</FieldLabel>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="После утреннего кофе или перед сном без экрана"
            />
          </Field>

          <Field>
            <FieldLabel>Иконка и цвет акцента</FieldLabel>
            <div className="grid grid-cols-4 gap-1.5">
              {HABIT_ICONS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIconName(key)}
                  className={cn(
                    "flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-medium touch-manipulation",
                    iconName === key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/70 bg-background text-muted-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectableColors.map((token) => {
                const style = HABIT_COLOR_STYLES[token];
                return (
                  <button
                    key={token}
                    type="button"
                    onClick={() => setColorToken(token)}
                    className={cn(
                      "flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium touch-manipulation",
                      colorToken === token
                        ? "border-foreground bg-muted font-semibold"
                        : "border-border/70 bg-background text-muted-foreground"
                    )}
                  >
                    <span className={cn("size-2.5 rounded-full", style.dot)} />
                    {style.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field>
            <FieldLabel>Ритм выполнения</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCadence("daily")}
                className={cn(
                  "min-h-11 rounded-xl border px-3 text-sm font-medium touch-manipulation",
                  cadence === "daily"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground"
                )}
              >
                Каждый день
              </button>
              <button
                type="button"
                onClick={() => setCadence("weekly_target")}
                className={cn(
                  "min-h-11 rounded-xl border px-3 text-sm font-medium touch-manipulation",
                  cadence === "weekly_target"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground"
                )}
              >
                X раз в неделю
              </button>
            </div>
            {cadence === "weekly_target" ? (
              <div className="mt-2 flex items-center gap-1.5">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTargetPerWeek(String(n))}
                    className={cn(
                      "min-h-11 flex-1 rounded-xl border text-sm font-semibold num-tabular touch-manipulation",
                      Number(targetPerWeek) === n
                        ? "border-primary bg-primary/12 text-primary"
                        : "border-border bg-background text-muted-foreground"
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            ) : null}
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Предпочтительный слот</FieldLabel>
              <Select
                value={slot}
                onValueChange={(v) => setSlot(v as HabitPreferredSlot)}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="morning">☀️ Утро</SelectItem>
                    <SelectItem value="afternoon">🌤 День</SelectItem>
                    <SelectItem value="evening">🌙 Вечер</SelectItem>
                    <SelectItem value="any">Гибко в течение дня</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Push-напоминание в Telegram</FieldLabel>
              <div className="flex items-center gap-1.5">
                <Input
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="min-h-11 flex-1 num-tabular"
                />
                {reminderTime ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReminderTime("")}
                    className="min-h-11 px-3 text-xs touch-manipulation"
                  >
                    Сброс
                  </Button>
                ) : null}
              </div>
            </Field>
          </div>

          <Field>
            <FieldLabel>Связать с целью (необязательно)</FieldLabel>
            <Select value={goalId} onValueChange={setGoalId}>
              <SelectTrigger className="min-h-11 w-full">
                <SelectValue placeholder="Без привязки к цели" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">Без привязки к цели</SelectItem>
                  {goals
                    .filter((g) => g.status === "active" || g.id === habit?.goal_id)
                    .map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>
                        🎯 {g.title}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          {habit ? (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={handleArchive}
                className="min-h-11 rounded-xl touch-manipulation"
              >
                <ArchiveIcon className="mr-1.5 size-4" />
                В архив
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={handleDelete}
                className="min-h-11 rounded-xl text-destructive hover:text-destructive touch-manipulation"
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
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
        </div>
      </form>
    </ResponsiveModal>
  );
}
