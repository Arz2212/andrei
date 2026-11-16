"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  PlusIcon,
  FolderPlusIcon,
  ClockIcon,
  CalendarDaysIcon,
  HourglassIcon,
  SunIcon,
  SunsetIcon,
  MoonStarIcon,
  LayersIcon,
} from "lucide-react";
import type { DayPlan, DaySlot, LifeArea, Project, Task, TaskStatus } from "@life-os/db";
import { saveProjectAction, toggleTaskAction } from "@/app/actions";
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

const LIFE_AREA_LABELS: Record<LifeArea, string> = {
  work: "Работа",
  study: "Учёба",
  launch: "Запуск",
  personal: "Личное",
  health: "Здоровье",
};

const SLOT_META = {
  morning: { label: "Утро", icon: SunIcon },
  afternoon: { label: "День", icon: SunsetIcon },
  evening: { label: "Вечер", icon: MoonStarIcon },
  any: { label: "Гибко", icon: LayersIcon },
} as const;

function addDaysIso(baseIso: string, offset: number): string {
  const d = new Date(`${baseIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

interface TasksViewProps {
  todayDate: string;
  initialTab?: string;
  tasks: Task[];
  projects: Project[];
  dayPlan: DayPlan | null;
  defaultAvailableMinutes: number;
  defaultBufferMinutes: number;
}

export function TasksView({
  todayDate,
  initialTab = "today",
  tasks,
  projects,
  dayPlan,
  defaultAvailableMinutes,
  defaultBufferMinutes,
}: TasksViewProps) {
  const [, startTransition] = React.useTransition();

  const [optimisticTasks, applyOptimisticToggle] = React.useOptimistic(
    tasks,
    (current: Task[], update: { id: number; done: boolean }) =>
      current.map((t) =>
        t.id === update.id ? { ...t, status: update.done ? "done" : "todo" } : t
      )
  );

  // Task modal
  const [taskModalOpen, setTaskModalOpen] = React.useState(false);
  const [editingTask, setEditingTask] = React.useState<Task | null>(null);
  const [modalDefaultDate, setModalDefaultDate] = React.useState<string | null>(todayDate);
  const [modalDefaultStatus, setModalDefaultStatus] = React.useState<TaskStatus>("todo");

  // Project modal
  const [projectModalOpen, setProjectModalOpen] = React.useState(false);
  const [projTitle, setProjTitle] = React.useState("");
  const [projArea, setProjArea] = React.useState<LifeArea>("work");
  const [projDesc, setProjDesc] = React.useState("");
  const [projDue, setProjDue] = React.useState("");

  const projectMap = React.useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const weekDates = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysIso(todayDate, i)),
    [todayDate]
  );

  const todayTasks = optimisticTasks.filter(
    (t) => t.planned_date === todayDate && t.status !== "waiting"
  );
  const waitingTasks = optimisticTasks.filter((t) => t.status === "waiting");
  const inboxAndActiveTasks = optimisticTasks.filter((t) => t.status !== "cancelled");

  const availableMins = dayPlan?.available_minutes ?? defaultAvailableMinutes;
  const bufferMins = dayPlan?.buffer_minutes ?? defaultBufferMinutes;
  const scheduledTodayMins = todayTasks
    .filter((t) => t.status !== "done")
    .reduce((acc, t) => acc + (t.estimated_minutes ?? 30), 0);
  const freeBeforeBuffer = Math.max(availableMins - bufferMins, 0) - scheduledTodayMins;

  function handleToggle(task: Task, checked: boolean) {
    startTransition(async () => {
      applyOptimisticToggle({ id: task.id, done: checked });
      try {
        await toggleTaskAction(task.id, checked);
      } catch {
        toast.error("Не удалось обновить задачу");
      }
    });
  }

  function openNewTask(opts?: { date?: string | null; status?: TaskStatus }) {
    setEditingTask(null);
    setModalDefaultDate(opts?.date !== undefined ? opts.date : todayDate);
    setModalDefaultStatus(opts?.status ?? "todo");
    setTaskModalOpen(true);
  }

  function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveProjectAction({
          title: projTitle,
          life_area: projArea,
          description: projDesc,
          due_date: projDue || null,
        });
        setProjTitle("");
        setProjDesc("");
        setProjDue("");
        setProjectModalOpen(false);
        toast.success("Проект создан");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения проекта");
      }
    });
  }

  function renderTaskRow(task: Task, showDateBadge = false) {
    const isDone = task.status === "done";
    const project = task.project_id ? projectMap.get(task.project_id) : null;
    const slotInfo = SLOT_META[(task.day_slot as DaySlot) ?? "any"] ?? SLOT_META.any;

    return (
      <div
        key={task.id}
        className="flex min-h-12 items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/40"
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
            setTaskModalOpen(true);
          }}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
        >
          <div className="flex w-full items-center gap-2">
            {task.priority === 1 && !isDone ? (
              <span className="size-2 shrink-0 rounded-full bg-primary" title="Главный приоритет" />
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

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {project ? <span>{project.title}</span> : null}
            <span>· {slotInfo.label}</span>
            {task.due_date ? (
              <span className="num-tabular">· срок {formatDateShortRu(task.due_date)}</span>
            ) : null}
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {showDateBadge && task.planned_date ? (
            <Badge variant="outline" className="num-tabular">
              {formatDateShortRu(task.planned_date)}
            </Badge>
          ) : null}
          {task.estimated_minutes ? (
            <Badge variant="secondary" className="num-tabular">
              {task.estimated_minutes} м
            </Badge>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">Задачи и календарь</h1>
          <p className="text-sm text-muted-foreground">
            Слоты Утро / День / Вечер, защитный буфер времени и отдельный контур ожиданий
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setProjectModalOpen(true)}
            className="min-h-10 rounded-xl"
          >
            <FolderPlusIcon data-icon="inline-start" />
            Проект
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => openNewTask({ date: todayDate, status: "todo" })}
            className="min-h-10 rounded-xl"
          >
            <PlusIcon data-icon="inline-start" />
            Новая задача
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={initialTab} className="flex flex-col gap-4">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-11 w-full justify-start sm:w-auto rounded-xl">
            <TabsTrigger value="today" className="min-h-9 px-3.5">
              Сегодня
            </TabsTrigger>
            <TabsTrigger value="week" className="min-h-9 px-3.5">
              Неделя
            </TabsTrigger>
            <TabsTrigger value="waiting" className="min-h-9 px-3.5">
              Ожидание ({waitingTasks.length})
            </TabsTrigger>
            <TabsTrigger value="all" className="min-h-9 px-3.5">
              Все дела
            </TabsTrigger>
            <TabsTrigger value="projects" className="min-h-9 px-3.5">
              Проекты
            </TabsTrigger>
          </TabsList>
        </div>

        {/* TODAY TAB */}
        <TabsContent value="today" className="flex flex-col gap-4">
          <Card className="rounded-2xl shadow-none">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base font-semibold">
                    Баланс нагрузки на сегодня
                  </CardTitle>
                  <CardDescription>
                    {dayPlan?.main_focus || "План строится с запасом на непредвиденные дела"}
                  </CardDescription>
                </div>
                <Badge
                  variant={freeBeforeBuffer < 0 ? "destructive" : "secondary"}
                  className="num-tabular"
                >
                  {freeBeforeBuffer < 0
                    ? `Перегруз ${formatMinutesRu(Math.abs(freeBeforeBuffer))}`
                    : `До буфера свободно ${formatMinutesRu(freeBeforeBuffer)}`}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2.5 pt-0 text-xs sm:text-sm">
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-muted-foreground">В слотах</div>
                <div className="mt-0.5 font-semibold num-tabular">
                  {formatMinutesRu(scheduledTodayMins)}
                </div>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-muted-foreground">Буфер дня</div>
                <div className="mt-0.5 font-semibold num-tabular">
                  {formatMinutesRu(bufferMins)}
                </div>
              </div>
              <div className="rounded-xl bg-muted/50 p-3">
                <div className="text-muted-foreground">Всего окна</div>
                <div className="mt-0.5 font-semibold num-tabular">
                  {formatMinutesRu(availableMins)}
                </div>
              </div>
            </CardContent>
          </Card>

          {(["morning", "afternoon", "evening", "any"] as const).map((slotKey) => {
            const slotTasks = todayTasks.filter((t) => t.day_slot === slotKey);
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
                      slotTasks.reduce((s, i) => s + (i.estimated_minutes ?? 0), 0)
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
          })}
        </TabsContent>

        {/* WEEK TAB */}
        <TabsContent value="week" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {weekDates.map((isoDate, idx) => {
            const dayItems = optimisticTasks.filter(
              (t) => t.planned_date === isoDate && t.status !== "waiting"
            );
            const dayLoad = dayItems
              .filter((t) => t.status !== "done")
              .reduce((s, t) => s + (t.estimated_minutes ?? 30), 0);
            const maxSafe = Math.max(defaultAvailableMinutes - defaultBufferMinutes, 60);

            return (
              <Card key={isoDate} className="rounded-2xl shadow-none">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div className="flex flex-col gap-0.5">
                    <CardTitle className="text-base font-semibold">
                      {idx === 0 ? `Сегодня · ${formatDateShortRu(isoDate)}` : formatDateLongRu(isoDate)}
                    </CardTitle>
                    <CardDescription className="num-tabular">
                      Запланировано {formatMinutesRu(dayLoad)} (безопасный лимит{" "}
                      {formatMinutesRu(maxSafe)})
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openNewTask({ date: isoDate, status: "todo" })}
                    aria-label="Добавить в этот день"
                  >
                    <PlusIcon />
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  {dayItems.length === 0 ? (
                    <div className="border-t border-border/60 px-4 py-4 text-sm text-muted-foreground">
                      Окно свободно.
                    </div>
                  ) : (
                    <div className="divide-y divide-border/60 border-t border-border/60">
                      {dayItems.map((t) => renderTaskRow(t))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
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
                    <div className="flex items-start gap-3 min-w-0 flex-1">
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
                        <span className="truncate text-sm font-medium">{wt.title}</span>
                        <span className="text-xs text-muted-foreground">
                          От кого:{" "}
                          <strong className="font-medium text-foreground">
                            {wt.waiting_on_person || "Не указано"}
                          </strong>
                          {wt.waiting_context ? ` · ${wt.waiting_context}` : ""}
                        </span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {wt.follow_up_at ? (
                        <Badge variant="outline" className="num-tabular">
                          <ClockIcon className="mr-1 size-3" />
                          Напомнить {formatDateShortRu(wt.follow_up_at)}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Без даты</Badge>
                      )}
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

        {/* PROJECTS TAB */}
        <TabsContent value="projects" className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((proj) => {
            const pTasks = optimisticTasks.filter((t) => t.project_id === proj.id);
            const openCount = pTasks.filter((t) => t.status !== "done").length;
            const doneCount = pTasks.filter((t) => t.status === "done").length;

            return (
              <Card key={proj.id} className="flex flex-col justify-between rounded-2xl shadow-none">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">
                      {LIFE_AREA_LABELS[proj.life_area as LifeArea] ?? proj.life_area}
                    </Badge>
                    {proj.due_date ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground num-tabular">
                        <CalendarDaysIcon className="size-3.5" />
                        {formatDateShortRu(proj.due_date)}
                      </span>
                    ) : null}
                  </div>
                  <CardTitle className="pt-1 text-base font-semibold">
                    {proj.title}
                  </CardTitle>
                  {proj.description ? (
                    <CardDescription>{proj.description}</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <span className="num-tabular">Активных: {openCount}</span>
                  <span className="num-tabular">Завершено: {doneCount}</span>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      {/* Task Modal */}
      <TaskFormModal
        open={taskModalOpen}
        onOpenChange={setTaskModalOpen}
        task={editingTask}
        projects={projects}
        defaultPlannedDate={modalDefaultDate}
        defaultStatus={modalDefaultStatus}
      />

      {/* New Project Modal (Vaul Drawer on iPhone) */}
      <ResponsiveModal
        open={projectModalOpen}
        onOpenChange={setProjectModalOpen}
        title="Новый проект"
        description="Сгруппируй связанные задачи вокруг одного запуска, учёбы или сферы жизни."
      >
        <form onSubmit={handleCreateProject} className="flex flex-col gap-4">
          <FieldGroup className="gap-3.5">
            <Field>
              <FieldLabel htmlFor="proj-title">Название проекта</FieldLabel>
              <Input
                id="proj-title"
                value={projTitle}
                onChange={(e) => setProjTitle(e.target.value)}
                placeholder="Например: Осенний запуск продукта"
                required
                className="min-h-11"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel>Сфера жизни</FieldLabel>
                <Select
                  value={projArea}
                  onValueChange={(v) => setProjArea(v as LifeArea)}
                >
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="work">Работа</SelectItem>
                      <SelectItem value="launch">Запуск</SelectItem>
                      <SelectItem value="study">Учёба</SelectItem>
                      <SelectItem value="personal">Личное</SelectItem>
                      <SelectItem value="health">Здоровье</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

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
            </div>

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
            Создать проект
          </Button>
        </form>
      </ResponsiveModal>
    </div>
  );
}
