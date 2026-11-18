"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  BellIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FolderPlusIcon,
  HourglassIcon,
  LayersIcon,
  MoonStarIcon,
  PencilIcon,
  PlusIcon,
  SunIcon,
  SunsetIcon,
  TargetIcon,
  Trash2Icon,
} from "lucide-react";
import {
  REMINDER_DISABLED_SENTINEL,
  addDaysToIsoDate,
  extractLocalTimeParts,
  formatTaskTimeRange,
  getWeekBoundsIso,
  type DayPlan,
  type DaySlot,
  type GoalWithDetails,
  type LifeArea,
  type Project,
  type Task,
  type TaskStatus,
} from "@life-os/db";
import {
  deleteProjectAction,
  deleteTaskAction,
  fetchWeekScheduleAction,
  saveProjectAction,
  toggleTaskAction,
} from "@/app/actions";
import {
  cn,
  formatDateLongRu,
  formatDateShortRu,
  formatMinutesRu,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResponsiveModal } from "@/components/shell/responsive-modal";
import { TaskFormModal } from "@/components/modules/task-form-modal";
import { WeekCalendarGrid } from "@/components/modules/week-calendar-grid";

const LIFE_AREA_LABELS: Record<LifeArea, string> = {
  work: "Работа",
  study: "Учёба",
  launch: "Запуск",
  personal: "Личное",
  health: "Здоровье",
};

const PROJECT_STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  on_hold: "На паузе",
  completed: "Завершён",
  archived: "В архиве",
};

const SLOT_META = {
  morning: { label: "Утро", icon: SunIcon },
  afternoon: { label: "День", icon: SunsetIcon },
  evening: { label: "Вечер", icon: MoonStarIcon },
  any: { label: "Гибко", icon: LayersIcon },
} as const;

function sortTasksChronologically(items: Task[]): Task[] {
  return [...items].sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;

    if (a.scheduled_start_at && b.scheduled_start_at) {
      const diff =
        Date.parse(a.scheduled_start_at) - Date.parse(b.scheduled_start_at);
      if (diff !== 0) return diff;
    } else if (a.scheduled_start_at && !b.scheduled_start_at) {
      return -1;
    } else if (!a.scheduled_start_at && b.scheduled_start_at) {
      return 1;
    }

    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.sort_order - b.sort_order;
  });
}

function getEffectiveTaskDate(task: Task): string | null {
  return task.scheduled_start_at
    ? extractLocalTimeParts(task.scheduled_start_at, "Europe/Moscow").dateStr
    : task.planned_date;
}

function taskBelongsToDate(task: Task, dateIso: string): boolean {
  return getEffectiveTaskDate(task) === dateIso;
}

interface TasksViewProps {
  todayDate: string;
  initialTab?: string;
  tasks: Task[];
  projects: Project[];
  goals?: GoalWithDetails[];
  dayPlan: DayPlan | null;
  defaultAvailableMinutes: number;
  defaultBufferMinutes: number;
}

export function TasksView({
  todayDate,
  initialTab = "today",
  tasks,
  projects,
  goals = [],
  dayPlan,
  defaultBufferMinutes,
}: TasksViewProps) {
  const [, startTransition] = React.useTransition();
  const [activeTab, setActiveTab] = React.useState(initialTab);

  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const [optimisticTasks, applyOptimisticMutation] = React.useOptimistic(
    tasks,
    (
      current: Task[],
      action:
        | { kind: "toggle"; id: number; done: boolean }
        | { kind: "delete"; id: number }
    ) => {
      if (action.kind === "delete") {
        return current.filter((t) => t.id !== action.id);
      }
      return current.map((t) =>
        t.id === action.id ? { ...t, status: action.done ? "done" : "todo" } : t
      );
    }
  );

  // Selected Day for "Сегодня / День" tab (allows inspecting past & future single days)
  const [selectedDayIso, setSelectedDayIso] = React.useState(todayDate);

  // Week Calendar anchor date & fetched historical/future week tasks
  const [weekAnchorIso, setWeekAnchorIso] = React.useState(todayDate);
  const [fetchedWeekTasks, setFetchedWeekTasks] = React.useState<Task[] | null>(
    null
  );
  const [weekLoading, setWeekLoading] = React.useState(false);

  const currentWeekBounds = React.useMemo(
    () => getWeekBoundsIso(todayDate),
    [todayDate]
  );

  const handleChangeWeekAnchor = React.useCallback(
    async (nextAnchorIso: string) => {
      setWeekAnchorIso(nextAnchorIso);
      const nextBounds = getWeekBoundsIso(nextAnchorIso);
      if (nextBounds.weekStart === currentWeekBounds.weekStart) {
        setFetchedWeekTasks(null);
        return;
      }
      setWeekLoading(true);
      try {
        const res = await fetchWeekScheduleAction(nextAnchorIso);
        setFetchedWeekTasks(res.tasks);
      } catch {
        toast.error("Не удалось загрузить календарь недели");
      } finally {
        setWeekLoading(false);
      }
    },
    [currentWeekBounds.weekStart]
  );

  // Selected project detail view inside "Проекты" tab
  const [selectedProjectId, setSelectedProjectId] = React.useState<
    number | null
  >(null);

  // Task modal
  const [taskModalOpen, setTaskModalOpen] = React.useState(false);
  const [editingTask, setEditingTask] = React.useState<Task | null>(null);
  const [modalDefaultDate, setModalDefaultDate] =
    React.useState<string | null>(todayDate);
  const [modalDefaultTime, setModalDefaultTime] =
    React.useState<string | null>(null);
  const [modalDefaultProjectId, setModalDefaultProjectId] =
    React.useState<number | null>(null);
  const [modalDefaultStatus, setModalDefaultStatus] =
    React.useState<TaskStatus>("todo");

  // Project Create / Edit modal
  const [projectModalOpen, setProjectModalOpen] = React.useState(false);
  const [editingProject, setEditingProject] = React.useState<Project | null>(
    null
  );
  const [projTitle, setProjTitle] = React.useState("");
  const [projArea, setProjArea] = React.useState<LifeArea>("work");
  const [projStatus, setProjStatus] = React.useState<
    "active" | "on_hold" | "completed" | "archived"
  >("active");
  const [projDesc, setProjDesc] = React.useState("");
  const [projDue, setProjDue] = React.useState("");
  const [deletingProjectConfirm, setDeletingProjectConfirm] =
    React.useState<Project | null>(null);

  const projectMap = React.useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const goalMap = React.useMemo(
    () => new Map(goals.map((g) => [g.id, g])),
    [goals]
  );

  const dayViewTasks = React.useMemo(
    () =>
      sortTasksChronologically(
        optimisticTasks.filter(
          (t) =>
            taskBelongsToDate(t, selectedDayIso) &&
            t.status !== "waiting" &&
            t.status !== "cancelled"
        )
      ),
    [optimisticTasks, selectedDayIso]
  );

  const waitingTasks = optimisticTasks.filter((t) => t.status === "waiting");
  const inboxAndActiveTasks = React.useMemo(
    () =>
      sortTasksChronologically(
        optimisticTasks.filter((t) => t.status !== "cancelled")
      ),
    [optimisticTasks]
  );

  const bufferMins =
    selectedDayIso === todayDate
      ? dayPlan?.buffer_minutes ?? defaultBufferMinutes
      : defaultBufferMinutes;
  const scheduledDayMins = dayViewTasks
    .filter((t) => t.status !== "done")
    .reduce((acc, t) => acc + (t.estimated_minutes ?? 30), 0);

  function handleToggle(task: Task, checked: boolean) {
    if (fetchedWeekTasks) {
      setFetchedWeekTasks((prev) =>
        prev
          ? prev.map((t) =>
              t.id === task.id
                ? { ...t, status: checked ? "done" : "todo" }
                : t
            )
          : null
      );
    }
    startTransition(async () => {
      applyOptimisticMutation({ kind: "toggle", id: task.id, done: checked });
      try {
        await toggleTaskAction(task.id, checked);
      } catch {
        toast.error("Не удалось обновить задачу");
      }
    });
  }

  function handleQuickDelete(task: Task) {
    if (fetchedWeekTasks) {
      setFetchedWeekTasks((prev) =>
        prev ? prev.filter((t) => t.id !== task.id) : null
      );
    }
    startTransition(async () => {
      applyOptimisticMutation({ kind: "delete", id: task.id });
      try {
        await deleteTaskAction(task.id);
        toast.success("Задача удалена");
      } catch {
        toast.error("Не удалось удалить задачу");
      }
    });
  }

  function openNewTask(opts?: {
    date?: string | null;
    time?: string | null;
    projectId?: number | null;
    status?: TaskStatus;
  }) {
    setEditingTask(null);
    setModalDefaultDate(opts?.date !== undefined ? opts.date : selectedDayIso);
    setModalDefaultTime(opts?.time ?? null);
    setModalDefaultProjectId(opts?.projectId ?? null);
    setModalDefaultStatus(opts?.status ?? "todo");
    setTaskModalOpen(true);
  }

  function openProjectModal(proj: Project | null) {
    setEditingProject(proj);
    setProjTitle(proj?.title ?? "");
    setProjArea((proj?.life_area as LifeArea) ?? "work");
    setProjStatus(
      (proj?.status as "active" | "on_hold" | "completed" | "archived") ??
        "active"
    );
    setProjDesc(proj?.description ?? "");
    setProjDue(proj?.due_date ?? "");
    setProjectModalOpen(true);
  }

  function handleSaveProject(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveProjectAction({
          id: editingProject?.id,
          title: projTitle,
          life_area: projArea,
          status: projStatus,
          description: projDesc,
          due_date: projDue || null,
        });
        setProjectModalOpen(false);
        toast.success(editingProject ? "Проект обновлён" : "Проект создан");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Ошибка сохранения проекта"
        );
      }
    });
  }

  function handleConfirmDeleteProject() {
    if (!deletingProjectConfirm) return;
    const targetId = deletingProjectConfirm.id;
    startTransition(async () => {
      try {
        await deleteProjectAction(targetId);
        if (selectedProjectId === targetId) {
          setSelectedProjectId(null);
        }
        setDeletingProjectConfirm(null);
        toast.success("Проект удалён (задачи сохранены без проекта)");
      } catch {
        toast.error("Не удалось удалить проект");
      }
    });
  }

  function renderTaskRow(task: Task, showDateBadge = false) {
    const isDone = task.status === "done";
    const project = task.project_id ? projectMap.get(task.project_id) : null;
    const linkedGoal = task.goal_id ? goalMap.get(task.goal_id) : null;
    const effectiveDate = getEffectiveTaskDate(task);
    const slotInfo =
      SLOT_META[(task.day_slot as DaySlot) ?? "any"] ?? SLOT_META.any;
    const timeRange = formatTaskTimeRange(task, "Europe/Moscow");
    const hasReminder =
      Boolean(task.scheduled_start_at) &&
      task.remind_before_minutes !== null &&
      task.reminder_sent_at !== REMINDER_DISABLED_SENTINEL;

    const subtaskList = Array.isArray(task.subtasks)
      ? (task.subtasks as { done?: boolean }[])
      : [];
    const doneSubtasks = subtaskList.filter((s) => Boolean(s?.done)).length;

    const metaParts = [
      project?.title ?? null,
      slotInfo.label,
      subtaskList.length > 0
        ? `шаги ${doneSubtasks}/${subtaskList.length}`
        : null,
      task.recurrence_rule ? `↻ ${task.recurrence_rule}` : null,
      task.due_date ? `срок ${formatDateShortRu(task.due_date)}` : null,
    ].filter(Boolean);

    return (
      <div
        key={task.id}
        className="flex min-h-13 items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-muted/40"
      >
        <div className="flex size-11 -m-2 shrink-0 items-center justify-center">
          <Checkbox
            checked={isDone}
            onCheckedChange={(v) => handleToggle(task, Boolean(v))}
            aria-label={`Выполнить «${task.title}»`}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingTask(task);
            setModalDefaultDate(effectiveDate);
            setModalDefaultTime(null);
            setModalDefaultProjectId(task.project_id);
            setTaskModalOpen(true);
          }}
          className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
        >
          <div className="flex w-full flex-wrap items-center gap-1.5">
            {task.priority === 1 && !isDone ? (
              <span
                className="size-2 shrink-0 rounded-full bg-primary"
                title="Главный приоритет"
              />
            ) : null}

            {timeRange ? (
              <Badge
                variant="outline"
                className={cn(
                  "shrink-0 gap-1 border-primary/35 bg-accent/55 text-foreground num-tabular",
                  isDone && "opacity-60"
                )}
              >
                <ClockIcon className="size-3 text-primary" />
                {timeRange}
                {hasReminder && !isDone ? (
                  <BellIcon className="size-2.5 text-primary" />
                ) : null}
              </Badge>
            ) : null}

            <span
              className={cn(
                "truncate text-sm font-medium",
                isDone && "line-through text-muted-foreground"
              )}
            >
              {task.title}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{metaParts.join(" · ")}</span>
            {linkedGoal ? (
              <Badge
                variant="outline"
                className="gap-1 border-primary/25 bg-accent/35 px-1.5 py-0 text-[11px] font-normal text-foreground"
              >
                <TargetIcon className="size-2.5 shrink-0 text-primary" />
                <span className="max-w-[160px] truncate">{linkedGoal.title}</span>
              </Badge>
            ) : null}
            {Array.isArray(task.tags) && task.tags.length > 0
              ? task.tags.slice(0, 3).map((tg) => (
                  <span
                    key={tg}
                    className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    #{tg}
                  </span>
                ))
              : null}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {showDateBadge && effectiveDate ? (
            <Badge
              variant="outline"
              className="hidden sm:inline-flex num-tabular"
            >
              {formatDateShortRu(effectiveDate)}
            </Badge>
          ) : null}
          {task.estimated_minutes ? (
            <Badge variant="secondary" className="num-tabular">
              {task.estimated_minutes} м
            </Badge>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              setEditingTask(task);
              setModalDefaultDate(effectiveDate);
              setModalDefaultTime(null);
              setModalDefaultProjectId(task.project_id);
              setTaskModalOpen(true);
            }}
            aria-label={`Редактировать «${task.title}»`}
            title="Редактировать"
            className="size-9 rounded-lg text-muted-foreground hover:text-foreground"
          >
            <PencilIcon className="size-3.5" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => handleQuickDelete(task)}
            aria-label={`Удалить «${task.title}»`}
            title="Удалить"
            className="size-9 rounded-lg text-muted-foreground hover:text-destructive"
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  const selectedProject = selectedProjectId
    ? projectMap.get(selectedProjectId) ?? null
    : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Задачи и календарь
          </h1>
          <p className="text-sm text-muted-foreground">
            Слоты дня, недельная сетка часов с историей и управление проектами
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openProjectModal(null)}
            className="min-h-10 rounded-xl"
          >
            <FolderPlusIcon data-icon="inline-start" />
            Проект
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => openNewTask({ date: selectedDayIso, status: "todo" })}
            className="min-h-10 rounded-xl"
          >
            <PlusIcon data-icon="inline-start" />
            Новая задача
          </Button>
        </div>
      </div>

      {/* Tabs (flush left, smooth horizontal touch scroll on iPhone) */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="today">День</TabsTrigger>
          <TabsTrigger value="week">Неделя</TabsTrigger>
          <TabsTrigger value="waiting">
            Ожидание ({waitingTasks.length})
          </TabsTrigger>
          <TabsTrigger value="all">Все дела</TabsTrigger>
          <TabsTrigger value="projects">
            Проекты ({projects.length})
          </TabsTrigger>
        </TabsList>

        {/* SINGLE DAY TAB (with past/future date switcher + compact corner summary) */}
        <TabsContent value="today" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3">
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() =>
                  setSelectedDayIso(addDaysToIsoDate(selectedDayIso, -1))
                }
                aria-label="Предыдущий день"
                className="size-8 rounded-lg"
              >
                <ChevronLeftIcon />
              </Button>
              <span className="px-2 text-sm font-semibold">
                {selectedDayIso === todayDate
                  ? `Сегодня · ${formatDateShortRu(selectedDayIso)}`
                  : formatDateLongRu(selectedDayIso)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() =>
                  setSelectedDayIso(addDaysToIsoDate(selectedDayIso, 1))
                }
                aria-label="Следующий день"
                className="size-8 rounded-lg"
              >
                <ChevronRightIcon />
              </Button>
              {selectedDayIso !== todayDate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setSelectedDayIso(todayDate)}
                  className="ml-1 rounded-lg"
                >
                  Сегодня
                </Button>
              ) : null}
            </div>

            <span className="text-xs text-muted-foreground num-tabular">
              {formatMinutesRu(scheduledDayMins)} в плане · резерв{" "}
              {formatMinutesRu(bufferMins)}
            </span>
          </div>

          {(["morning", "afternoon", "evening", "any"] as const).map(
            (slotKey) => {
              const slotTasks = dayViewTasks.filter(
                (t) => t.day_slot === slotKey
              );
              const SlotIcon = SLOT_META[slotKey].icon;
              return (
                <Card key={slotKey} className="rounded-2xl shadow-none">
                  <CardHeader className="flex flex-row items-center justify-between py-3.5">
                    <div className="flex items-center gap-2">
                      <SlotIcon className="size-4 text-primary" />
                      <CardTitle className="text-base font-semibold">
                        {SLOT_META[slotKey].label}
                      </CardTitle>
                      <Badge variant="secondary" className="num-tabular">
                        {slotTasks.length}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground num-tabular">
                      {formatMinutesRu(
                        slotTasks.reduce(
                          (s, i) => s + (i.estimated_minutes ?? 0),
                          0
                        )
                      )}
                    </span>
                  </CardHeader>
                  <CardContent className="p-0">
                    {slotTasks.length === 0 ? (
                      <div className="border-t border-border/60 px-4 py-4 text-sm text-muted-foreground">
                        Свободный слот — оставлен под маневр или фокус.
                      </div>
                    ) : (
                      <div className="divide-y divide-border/60 border-t border-border/60">
                        {slotTasks.map((t) => renderTaskRow(t))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            }
          )}
        </TabsContent>

        {/* WEEKLY TIME-BLOCK CALENDAR TAB */}
        <TabsContent value="week">
          <WeekCalendarGrid
            todayDate={todayDate}
            anchorDate={weekAnchorIso}
            onChangeAnchorDate={handleChangeWeekAnchor}
            tasks={fetchedWeekTasks ?? optimisticTasks}
            projects={projects}
            loading={weekLoading}
            onToggleTask={handleToggle}
            onEditTask={(t) => {
              setEditingTask(t);
              setModalDefaultDate(getEffectiveTaskDate(t));
              setModalDefaultTime(null);
              setModalDefaultProjectId(t.project_id);
              setTaskModalOpen(true);
            }}
            onCreateAtCell={(dateIso, timeStr) =>
              openNewTask({ date: dateIso, time: timeStr ?? null, status: "todo" })
            }
          />
        </TabsContent>

        {/* WAITING TAB */}
        <TabsContent value="waiting" className="flex flex-col gap-4">
          <Card className="rounded-2xl shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  Контур «Ожидание»
                </CardTitle>
                <CardDescription>
                  Отделяет твою активную работу от шагов, где мяч на чужой стороне
                </CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openNewTask({ date: null, status: "waiting" })}
                className="min-h-10 rounded-xl"
              >
                <HourglassIcon data-icon="inline-start" />
                Добавить ожидание
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {waitingTasks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  Зависших ответов нет.
                </p>
              ) : (
                waitingTasks.map((wt) => (
                  <div
                    key={wt.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 p-3.5"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="flex size-11 -m-2 shrink-0 items-center justify-center">
                        <Checkbox
                          checked={false}
                          onCheckedChange={(v) => handleToggle(wt, Boolean(v))}
                          aria-label={`Закрыть ожидание «${wt.title}»`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTask(wt);
                          setTaskModalOpen(true);
                        }}
                        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                      >
                        <div className="flex w-full flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium">
                            {wt.title}
                          </span>
                          {wt.goal_id && goalMap.get(wt.goal_id) ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-primary/25 bg-accent/35 px-1.5 py-0 text-[11px] font-normal text-foreground"
                            >
                              <TargetIcon className="size-2.5 shrink-0 text-primary" />
                              <span className="max-w-[150px] truncate">
                                {goalMap.get(wt.goal_id)?.title}
                              </span>
                            </Badge>
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          От кого:{" "}
                          <strong className="font-medium text-foreground">
                            {wt.waiting_on_person || "Не указано"}
                          </strong>
                          {wt.waiting_context ? ` · ${wt.waiting_context}` : ""}
                        </span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {wt.follow_up_at ? (
                        <Badge variant="outline" className="num-tabular">
                          <ClockIcon className="mr-1 size-3" />
                          Напомнить {formatDateShortRu(wt.follow_up_at)}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Без даты</Badge>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setEditingTask(wt);
                          setTaskModalOpen(true);
                        }}
                        aria-label="Редактировать"
                        className="size-9 rounded-lg text-muted-foreground hover:text-foreground"
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleQuickDelete(wt)}
                        aria-label="Удалить"
                        className="size-9 rounded-lg text-muted-foreground hover:text-destructive"
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ALL TASKS TAB */}
        <TabsContent value="all" className="flex flex-col gap-4">
          <Card className="rounded-2xl shadow-none">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  Все дела и входящие
                </CardTitle>
                <CardDescription>
                  Единый список задач из веб-интерфейса и голосовых сообщений Telegram
                </CardDescription>
              </div>
              <Badge variant="secondary" className="num-tabular">
                {inboxAndActiveTasks.length}
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              {inboxAndActiveTasks.length === 0 ? (
                <div className="border-t border-border/60 p-6 text-center text-sm text-muted-foreground">
                  Список пуст.
                </div>
              ) : (
                <div className="divide-y divide-border/60 border-t border-border/60">
                  {inboxAndActiveTasks.map((t) => renderTaskRow(t, true))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* CLICKABLE PROJECTS TAB WITH FULL EDIT & DELETE */}
        <TabsContent value="projects" className="flex flex-col gap-4">
          {selectedProject ? (
            <Card className="rounded-2xl shadow-none">
              <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedProjectId(null)}
                      className="-ml-2 h-8 rounded-lg px-2 text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeftIcon data-icon="inline-start" />
                      Все проекты
                    </Button>
                    <Badge variant="secondary">
                      {LIFE_AREA_LABELS[
                        selectedProject.life_area as LifeArea
                      ] ?? selectedProject.life_area}
                    </Badge>
                    <Badge variant="outline">
                      {PROJECT_STATUS_LABELS[selectedProject.status] ??
                        selectedProject.status}
                    </Badge>
                  </div>
                  <CardTitle className="text-lg font-semibold">
                    {selectedProject.title}
                  </CardTitle>
                  {selectedProject.description ? (
                    <CardDescription>
                      {selectedProject.description}
                    </CardDescription>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openProjectModal(selectedProject)}
                    className="min-h-9 rounded-xl"
                  >
                    <PencilIcon data-icon="inline-start" />
                    Изменить проект
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      openNewTask({
                        date: todayDate,
                        projectId: selectedProject.id,
                        status: "todo",
                      })
                    }
                    className="min-h-9 rounded-xl"
                  >
                    <PlusIcon data-icon="inline-start" />
                    Задача в проект
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {(() => {
                  const pTasks = sortTasksChronologically(
                    optimisticTasks.filter(
                      (t) =>
                        t.project_id === selectedProject.id &&
                        t.status !== "cancelled"
                    )
                  );
                  if (pTasks.length === 0) {
                    return (
                      <div className="border-t border-border/60 p-6 text-center text-sm text-muted-foreground">
                        В этом проекте пока нет задач. Нажми «Задача в проект», чтобы добавить первый шаг.
                      </div>
                    );
                  }
                  return (
                    <div className="divide-y divide-border/60 border-t border-border/60">
                      {pTasks.map((t) => renderTaskRow(t, true))}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          ) : projects.length === 0 ? (
            <Card className="rounded-2xl shadow-none">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <FolderPlusIcon className="size-8 text-muted-foreground/60" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Проектов пока нет</p>
                  <p className="max-w-md text-xs text-muted-foreground">
                    Создай проект под рабочий запуск, учёбу или важную личную сферу, чтобы сгруппировать связанные задачи.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openProjectModal(null)}
                  className="min-h-10 rounded-xl"
                >
                  <PlusIcon data-icon="inline-start" />
                  Создать первый проект
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((proj) => {
                const pTasks = optimisticTasks.filter(
                  (t) => t.project_id === proj.id && t.status !== "cancelled"
                );
                const openCount = pTasks.filter(
                  (t) => t.status !== "done"
                ).length;
                const doneCount = pTasks.filter(
                  (t) => t.status === "done"
                ).length;

                return (
                  <Card
                    key={proj.id}
                    onClick={() => setSelectedProjectId(proj.id)}
                    className="group flex cursor-pointer flex-col justify-between rounded-2xl shadow-none transition-colors hover:border-primary/40 hover:bg-muted/25"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary">
                            {LIFE_AREA_LABELS[proj.life_area as LifeArea] ??
                              proj.life_area}
                          </Badge>
                          {proj.status !== "active" ? (
                            <Badge variant="outline">
                              {PROJECT_STATUS_LABELS[proj.status] ??
                                proj.status}
                            </Badge>
                          ) : null}
                        </div>

                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-0.5"
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openProjectModal(proj)}
                            aria-label={`Редактировать проект «${proj.title}»`}
                            title="Редактировать проект"
                            className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                          >
                            <PencilIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeletingProjectConfirm(proj)}
                            aria-label={`Удалить проект «${proj.title}»`}
                            title="Удалить проект"
                            className="size-8 rounded-lg text-muted-foreground hover:text-destructive"
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        </div>
                      </div>

                      <CardTitle className="pt-1 text-base font-semibold group-hover:text-primary">
                        {proj.title}
                      </CardTitle>
                      {proj.description ? (
                        <CardDescription>{proj.description}</CardDescription>
                      ) : null}
                    </CardHeader>

                    <CardContent className="flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-3 num-tabular">
                        <span>Активных: {openCount}</span>
                        <span>Готово: {doneCount}</span>
                      </div>
                      {proj.due_date ? (
                        <span className="flex items-center gap-1 num-tabular">
                          <CalendarDaysIcon className="size-3.5" />
                          {formatDateShortRu(proj.due_date)}
                        </span>
                      ) : (
                        <span className="font-medium text-foreground">
                          Открыть
                        </span>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Task Modal */}
      <TaskFormModal
        open={taskModalOpen}
        onOpenChange={setTaskModalOpen}
        task={editingTask}
        projects={projects}
        goals={goals}
        defaultPlannedDate={modalDefaultDate}
        defaultScheduledTime={modalDefaultTime}
        defaultProjectId={modalDefaultProjectId}
        defaultStatus={modalDefaultStatus}
        onSaved={() => {
          if (fetchedWeekTasks) {
            void handleChangeWeekAnchor(weekAnchorIso);
          }
        }}
      />

      {/* Create / Edit Project Modal */}
      <ResponsiveModal
        open={projectModalOpen}
        onOpenChange={setProjectModalOpen}
        title={editingProject ? "Редактировать проект" : "Новый проект"}
        description="Сгруппируй связанные задачи вокруг одного запуска, учёбы или сферы жизни."
      >
        <form onSubmit={handleSaveProject} className="flex flex-col gap-4">
          <FieldGroup className="gap-3.5">
            <Field>
              <FieldLabel htmlFor="proj-title">Название проекта</FieldLabel>
              <Input
                id="proj-title"
                value={projTitle}
                onChange={(e) => setProjTitle(e.target.value)}
                placeholder="Например: Диплом или Осенний запуск продукта"
                required
                className="min-h-11"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel>Сфера жизни (цвет в календаре)</FieldLabel>
                <Select
                  value={projArea}
                  onValueChange={(v) => setProjArea(v as LifeArea)}
                >
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="work">Работа (кобальт)</SelectItem>
                      <SelectItem value="launch">Запуск (изумруд)</SelectItem>
                      <SelectItem value="study">Учёба (ирис)</SelectItem>
                      <SelectItem value="personal">Личное (охра)</SelectItem>
                      <SelectItem value="health">Здоровье (терракота)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Статус проекта</FieldLabel>
                <Select
                  value={projStatus}
                  onValueChange={(v) =>
                    setProjStatus(
                      v as "active" | "on_hold" | "completed" | "archived"
                    )
                  }
                >
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="active">Активен</SelectItem>
                      <SelectItem value="on_hold">На паузе</SelectItem>
                      <SelectItem value="completed">Завершён</SelectItem>
                      <SelectItem value="archived">В архив</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="proj-due">Целевой срок</FieldLabel>
              <Input
                id="proj-due"
                type="date"
                value={projDue}
                onChange={(e) => setProjDue(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="proj-desc">Критерий результата</FieldLabel>
              <Textarea
                id="proj-desc"
                rows={2}
                value={projDesc}
                onChange={(e) => setProjDesc(e.target.value)}
                placeholder="Что будем считать успешным завершением проекта?"
              />
            </Field>
          </FieldGroup>

          <Button type="submit" className="min-h-11 w-full rounded-xl">
            {editingProject ? "Сохранить изменения" : "Создать проект"}
          </Button>
        </form>
      </ResponsiveModal>

      {/* Delete Project Confirmation Modal */}
      <ResponsiveModal
        open={Boolean(deletingProjectConfirm)}
        onOpenChange={(open) => {
          if (!open) setDeletingProjectConfirm(null);
        }}
        title="Удалить проект?"
        description={
          deletingProjectConfirm
            ? `Проект «${deletingProjectConfirm.title}» будет удалён. Все задачи внутри него останутся в списке дел без привязки к проекту.`
            : undefined
        }
      >
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeletingProjectConfirm(null)}
            className="min-h-11 rounded-xl"
          >
            Отмена
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirmDeleteProject}
            className="min-h-11 rounded-xl"
          >
            Удалить проект
          </Button>
        </div>
      </ResponsiveModal>
    </div>
  );
}
