"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  BellIcon,
  ClockIcon,
  ListChecksIcon,
  Loader2Icon,
  PlusIcon,
  RepeatIcon,
  TagIcon,
  TargetIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  DEFAULT_REMINDER_LEAD_MINUTES,
  REMINDER_DISABLED_SENTINEL,
  extractLocalTimeParts,
  type DaySlot,
  type Goal,
  type Project,
  type SubtaskItem,
  type Task,
  type TaskStatus,
} from "@life-os/db";
import {
  checkTaskConflictAction,
  deleteTaskAction,
  saveTaskAction,
  type ConflictPreviewItem,
} from "@/app/actions";
import { ResponsiveModal } from "@/components/shell/responsive-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

function parseSubtasksFromTask(task: Task | null): SubtaskItem[] {
  if (!task || !Array.isArray(task.subtasks)) return [];
  const items: SubtaskItem[] = [];
  for (const raw of task.subtasks) {
    if (raw && typeof raw === "object" && "title" in raw) {
      const obj = raw as Record<string, unknown>;
      items.push({
        id: String(obj.id || `sub_${Math.random().toString(36).slice(2, 8)}`),
        title: String(obj.title || ""),
        done: Boolean(obj.done),
      });
    }
  }
  return items;
}

interface TaskFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  projects: Project[];
  goals?: Array<Pick<Goal, "id" | "title" | "life_area" | "status">>;
  defaultPlannedDate?: string | null;
  defaultScheduledTime?: string | null;
  defaultProjectId?: number | null;
  defaultGoalId?: number | null;
  defaultStatus?: TaskStatus;
  onSaved?: () => void;
}

export function TaskFormModal({
  open,
  onOpenChange,
  task,
  projects,
  goals = [],
  defaultPlannedDate,
  defaultScheduledTime,
  defaultProjectId,
  defaultGoalId,
  defaultStatus = "todo",
  onSaved,
}: TaskFormModalProps) {
  const [pending, startTransition] = React.useTransition();

  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [status, setStatus] = React.useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = React.useState("2");
  const [plannedDate, setPlannedDate] = React.useState("");
  const [scheduledTime, setScheduledTime] = React.useState("");
  const [isMeeting, setIsMeeting] = React.useState(false);
  const [remindOption, setRemindOption] = React.useState(
    String(DEFAULT_REMINDER_LEAD_MINUTES)
  );
  const [recurrenceRule, setRecurrenceRule] = React.useState("none");
  const [tags, setTags] = React.useState<string[]>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [subtasks, setSubtasks] = React.useState<SubtaskItem[]>([]);
  const [subtaskDraft, setSubtaskDraft] = React.useState("");

  const [daySlot, setDaySlot] = React.useState<DaySlot>("any");
  const [estimatedMinutes, setEstimatedMinutes] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [projectId, setProjectId] = React.useState("none");
  const [goalId, setGoalId] = React.useState("none");
  const [waitingPerson, setWaitingPerson] = React.useState("");
  const [waitingContext, setWaitingContext] = React.useState("");
  const [followUpDate, setFollowUpDate] = React.useState("");
  const [conflicts, setConflicts] = React.useState<ConflictPreviewItem[]>([]);

  React.useEffect(() => {
    if (open) {
      setTitle(task?.title ?? "");
      setNotes(task?.notes ?? "");
      setStatus((task?.status as TaskStatus) ?? defaultStatus);
      setPriority(String(task?.priority ?? 2));
      setPlannedDate(task?.planned_date ?? defaultPlannedDate ?? "");
      setDaySlot((task?.day_slot as DaySlot) ?? "any");
      setEstimatedMinutes(
        task?.estimated_minutes
          ? String(task.estimated_minutes)
          : defaultScheduledTime
            ? "60"
            : ""
      );
      setDueDate(task?.due_date ?? "");
      setProjectId(
        task?.project_id
          ? String(task.project_id)
          : defaultProjectId
            ? String(defaultProjectId)
            : "none"
      );
      setGoalId(
        task?.goal_id
          ? String(task.goal_id)
          : defaultGoalId
            ? String(defaultGoalId)
            : "none"
      );
      setIsMeeting(Boolean(task?.is_meeting));
      setRecurrenceRule(task?.recurrence_rule || "none");
      setTags(Array.isArray(task?.tags) ? task.tags : []);
      setTagDraft("");
      setSubtasks(parseSubtasksFromTask(task));
      setSubtaskDraft("");
      setWaitingPerson(task?.waiting_on_person ?? "");
      setWaitingContext(task?.waiting_context ?? "");
      setFollowUpDate(task?.follow_up_at ? task.follow_up_at.slice(0, 10) : "");
      setConflicts([]);

      if (task?.scheduled_start_at) {
        const parts = extractLocalTimeParts(
          task.scheduled_start_at,
          "Europe/Moscow"
        );
        setScheduledTime(parts.timeStr);
        if (
          task.reminder_sent_at === REMINDER_DISABLED_SENTINEL ||
          task.remind_before_minutes === null
        ) {
          setRemindOption("none");
        } else {
          setRemindOption(
            String(task.remind_before_minutes ?? DEFAULT_REMINDER_LEAD_MINUTES)
          );
        }
      } else {
        setScheduledTime(defaultScheduledTime ?? "");
        setRemindOption(String(DEFAULT_REMINDER_LEAD_MINUTES));
      }
    }
  }, [
    open,
    task,
    defaultPlannedDate,
    defaultScheduledTime,
    defaultProjectId,
    defaultGoalId,
    defaultStatus,
  ]);

  // Live time conflict check whenever date + clock time change
  React.useEffect(() => {
    if (!open || !scheduledTime || !plannedDate) {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await checkTaskConflictAction({
          plannedDate,
          startTime: scheduledTime,
          durationMinutes: estimatedMinutes
            ? Number(estimatedMinutes)
            : isMeeting
              ? 60
              : 30,
          isMeeting,
          excludeTaskId: task?.id,
        });
        if (!cancelled) setConflicts(found);
      } catch {
        if (!cancelled) setConflicts([]);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, plannedDate, scheduledTime, estimatedMinutes, isMeeting, task?.id]);

  function handleToggleMeeting(checked: boolean) {
    setIsMeeting(checked);
    if (checked && !estimatedMinutes) {
      setEstimatedMinutes("60");
    }
  }

  function addDraftTags(raw: string) {
    const split = raw
      .split(/[,;]+/)
      .map((s) => s.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (split.length === 0) return;
    setTags((prev) => Array.from(new Set([...prev, ...split])));
    setTagDraft("");
  }

  function addSubtaskItem() {
    const clean = subtaskDraft.trim();
    if (!clean) return;
    setSubtasks((prev) => [
      ...prev,
      {
        id: `sub_${Date.now().toString(36)}_${prev.length}`,
        title: clean,
        done: false,
      },
    ]);
    setSubtaskDraft("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const remindBefore =
          !scheduledTime || remindOption === "none" ? null : Number(remindOption);

        const finalTags = tagDraft.trim()
          ? Array.from(
              new Set([
                ...tags,
                ...tagDraft
                  .split(/[,;]+/)
                  .map((s) => s.trim().replace(/^#/, ""))
                  .filter(Boolean),
              ])
            )
          : tags;

        const finalSubtasks = subtaskDraft.trim()
          ? [
              ...subtasks,
              {
                id: `sub_${Date.now().toString(36)}`,
                title: subtaskDraft.trim(),
                done: false,
              },
            ]
          : subtasks;

        await saveTaskAction({
          id: task?.id,
          title,
          notes,
          status,
          priority: Number(priority) || 2,
          tags: finalTags,
          subtasks: finalSubtasks,
          recurrence_rule: recurrenceRule === "none" ? null : recurrenceRule,
          planned_date: plannedDate || null,
          scheduled_time: scheduledTime || null,
          is_meeting: isMeeting,
          remind_before_minutes: remindBefore,
          day_slot: daySlot,
          estimated_minutes: estimatedMinutes ? Number(estimatedMinutes) : null,
          due_date: dueDate || null,
          project_id: projectId !== "none" ? Number(projectId) : null,
          goal_id: goalId !== "none" ? Number(goalId) : null,
          waiting_on_person: waitingPerson || null,
          waiting_context: waitingContext || null,
          follow_up_at: followUpDate ? `${followUpDate}T10:00:00` : null,
        });
        toast.success(task ? "Задача обновлена" : "Задача создана");
        onSaved?.();
        onOpenChange(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Ошибка сохранения задачи"
        );
      }
    });
  }

  function handleDelete() {
    if (!task) return;
    startTransition(async () => {
      try {
        await deleteTaskAction(task.id);
        toast.success("Задача удалена");
        onSaved?.();
        onOpenChange(false);
      } catch {
        toast.error("Не удалось удалить задачу");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={task ? "Редактировать задачу" : "Новая задача"}
      description="Полная синхронизация полей с календарём, очередью уведомлений и OpenClaw MCP."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="task-title">Формулировка действия</FieldLabel>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Встреча с научным руководителем или Позвонить Даше"
              required
              className="min-h-11"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Статус</FieldLabel>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as TaskStatus)}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue placeholder="Выбери статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="todo">К выполнению</SelectItem>
                    <SelectItem value="in_progress">В работе</SelectItem>
                    <SelectItem value="waiting">Ожидание ответа</SelectItem>
                    <SelectItem value="inbox">Входящие (без даты)</SelectItem>
                    <SelectItem value="done">Выполнено</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Проект / сфера</FieldLabel>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue placeholder="Без проекта" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Без проекта</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

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
                  <SelectItem value="none">Без привязки к цели</SelectItem>
                  {goals
                    .filter(
                      (g) => g.status === "active" || String(g.id) === goalId
                    )
                    .map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>
                        {g.title}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {status === "waiting" ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3.5">
              <Field>
                <FieldLabel htmlFor="waiting-person">
                  От кого ждём ответ
                </FieldLabel>
                <Input
                  id="waiting-person"
                  value={waitingPerson}
                  onChange={(e) => setWaitingPerson(e.target.value)}
                  placeholder="Имя коллеги, подрядчика или клиента"
                  className="min-h-11"
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="waiting-ctx">Что именно ждём</FieldLabel>
                  <Input
                    id="waiting-ctx"
                    value={waitingContext}
                    onChange={(e) => setWaitingContext(e.target.value)}
                    placeholder="Смета, правки, оплата…"
                    className="min-h-11"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="waiting-followup">
                    Когда напомнить
                  </FieldLabel>
                  <Input
                    id="waiting-followup"
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="min-h-11 num-tabular"
                  />
                </Field>
              </div>
            </div>
          ) : null}

          {/* Date + Exact Time + Duration */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="task-planned">Дата в плане</FieldLabel>
              <Input
                id="task-planned"
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>

            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel
                  htmlFor="task-clock-time"
                  className="flex items-center gap-1"
                >
                  <ClockIcon className="size-3.5 text-muted-foreground" />
                  Время (МСК)
                </FieldLabel>
                {scheduledTime ? (
                  <button
                    type="button"
                    onClick={() => setScheduledTime("")}
                    className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-3" />
                    Сброс
                  </button>
                ) : null}
              </div>
              <Input
                id="task-clock-time"
                type="time"
                value={scheduledTime}
                onChange={(e) => {
                  const val = e.target.value;
                  setScheduledTime(val);
                  if (val && !plannedDate) {
                    setPlannedDate(
                      defaultPlannedDate ?? new Date().toISOString().slice(0, 10)
                    );
                  }
                }}
                className="min-h-11 num-tabular"
              />
            </Field>

            <Field className="col-span-2 sm:col-span-1">
              <FieldLabel htmlFor="task-mins">Длительность (мин)</FieldLabel>
              <Input
                id="task-mins"
                type="number"
                min={5}
                max={600}
                step={5}
                placeholder={isMeeting ? "60" : "30"}
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          {/* Meeting toggle + Telegram reminder lead time */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/80 bg-muted/30 p-3 sm:grid-cols-2">
            <Field
              orientation="horizontal"
              className="items-center justify-between"
            >
              <FieldLabel htmlFor="task-is-meeting" className="font-normal">
                Встреча / созвон ко времени
              </FieldLabel>
              <Switch
                id="task-is-meeting"
                checked={isMeeting}
                onCheckedChange={handleToggleMeeting}
              />
            </Field>

            {scheduledTime ? (
              <Field>
                <FieldLabel className="flex items-center gap-1 text-xs">
                  <BellIcon className="size-3.5 text-primary" />
                  Напомнить в Telegram
                </FieldLabel>
                <Select value={remindOption} onValueChange={setRemindOption}>
                  <SelectTrigger className="min-h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="0">Ровно в момент начала</SelectItem>
                      <SelectItem value="10">За 10 минут</SelectItem>
                      <SelectItem value="15">За 15 минут</SelectItem>
                      <SelectItem value="30">
                        За 30 минут (по умолчанию)
                      </SelectItem>
                      <SelectItem value="60">За 1 час</SelectItem>
                      <SelectItem value="120">За 2 часа</SelectItem>
                      <SelectItem value="none">Не напоминать</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <div className="flex items-center text-xs text-muted-foreground">
                Укажи точное время — за 30 мин придёт уведомление в Telegram.
              </div>
            )}
          </div>

          {/* Live Conflict Warning */}
          {conflicts.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangleIcon className="size-4" />
              <AlertTitle>Конфликт в расписании</AlertTitle>
              <AlertDescription>
                Это время пересекается с:{" "}
                {conflicts
                  .map((c) => `«${c.title}» (${c.timeRangeLabel})`)
                  .join(", ")}
                . Подвинь время или сохрани осознанно.
              </AlertDescription>
            </Alert>
          ) : null}

          {/* Day slot (auto-derived if exact time is set, otherwise manual) */}
          {!scheduledTime ? (
            <Field>
              <FieldLabel>Слот дня</FieldLabel>
              <ToggleGroup
                type="single"
                value={daySlot}
                onValueChange={(v) => v && setDaySlot(v as DaySlot)}
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
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel>Приоритет</FieldLabel>
              <ToggleGroup
                type="single"
                value={priority}
                onValueChange={(v) => v && setPriority(v)}
                variant="outline"
                spacing={1}
                className="w-full"
              >
                <ToggleGroupItem value="1" className="min-h-11 flex-1">
                  1
                </ToggleGroupItem>
                <ToggleGroupItem value="2" className="min-h-11 flex-1">
                  2
                </ToggleGroupItem>
                <ToggleGroupItem value="3" className="min-h-11 flex-1">
                  3
                </ToggleGroupItem>
                <ToggleGroupItem value="4" className="min-h-11 flex-1">
                  4
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field>
              <FieldLabel htmlFor="task-due">Жёсткий дедлайн</FieldLabel>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>

            <Field>
              <FieldLabel className="flex items-center gap-1">
                <RepeatIcon className="size-3.5 text-muted-foreground" />
                Повтор
              </FieldLabel>
              <Select value={recurrenceRule} onValueChange={setRecurrenceRule}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Без повтора</SelectItem>
                    <SelectItem value="daily">Ежедневно</SelectItem>
                    <SelectItem value="weekdays">По будням</SelectItem>
                    <SelectItem value="weekly">Еженедельно</SelectItem>
                    <SelectItem value="monthly">Ежемесячно</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Subtasks / Checklist */}
          <Field>
            <FieldLabel className="flex items-center gap-1.5">
              <ListChecksIcon className="size-3.5 text-muted-foreground" />
              Подзадачи / чеклист
            </FieldLabel>
            {subtasks.length > 0 ? (
              <div className="flex flex-col gap-1.5 rounded-xl border border-border/80 bg-muted/25 p-2.5">
                {subtasks.map((st, idx) => (
                  <div
                    key={st.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Checkbox
                        checked={st.done}
                        onCheckedChange={(v) =>
                          setSubtasks((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, done: Boolean(v) } : item
                            )
                          )
                        }
                      />
                      <span
                        className={
                          st.done
                            ? "truncate line-through text-muted-foreground"
                            : "truncate"
                        }
                      >
                        {st.title}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() =>
                        setSubtasks((prev) => prev.filter((_, i) => i !== idx))
                      }
                      aria-label="Удалить шаг"
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <Input
                value={subtaskDraft}
                onChange={(e) => setSubtaskDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSubtaskItem();
                  }
                }}
                placeholder="Добавить шаг чеклиста и нажать +"
                className="min-h-10"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addSubtaskItem}
                aria-label="Добавить подзадачу"
                className="size-10 shrink-0 rounded-xl"
              >
                <PlusIcon />
              </Button>
            </div>
          </Field>

          {/* Tags */}
          <Field>
            <FieldLabel
              htmlFor="task-tags"
              className="flex items-center gap-1.5"
            >
              <TagIcon className="size-3.5 text-muted-foreground" />
              Теги
            </FieldLabel>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tg) => (
                  <Badge key={tg} variant="secondary" className="gap-1">
                    #{tg}
                    <button
                      type="button"
                      onClick={() =>
                        setTags((prev) => prev.filter((x) => x !== tg))
                      }
                      aria-label={`Удалить тег ${tg}`}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : null}
            <Input
              id="task-tags"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addDraftTags(tagDraft);
                }
              }}
              onBlur={() => {
                if (tagDraft.trim()) addDraftTags(tagDraft);
              }}
              placeholder="Через запятую: диплом, звонок, фокус"
              className="min-h-10"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="task-notes">Описание / заметки</FieldLabel>
            <Textarea
              id="task-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ссылки, вопросы к обсуждению или критерий готовности…"
            />
          </Field>
        </FieldGroup>

        {/* Sticky Footer inside scrollable modal body */}
        <div className="sticky bottom-0 z-10 -mx-1 mt-1 flex items-center justify-between gap-3 border-t border-border/70 bg-background/95 px-1 pt-3 pb-1 backdrop-blur-xs">
          {task ? (
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
            ) : task ? (
              "Сохранить изменения"
            ) : (
              "Добавить задачу"
            )}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}
