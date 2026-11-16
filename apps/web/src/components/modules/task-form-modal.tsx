"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  BellIcon,
  ClockIcon,
  Loader2Icon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  REMINDER_DISABLED_SENTINEL,
  extractLocalTimeParts,
  type DaySlot,
  type Project,
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

interface TaskFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  projects: Project[];
  defaultPlannedDate?: string | null;
  defaultStatus?: TaskStatus;
}

export function TaskFormModal({
  open,
  onOpenChange,
  task,
  projects,
  defaultPlannedDate,
  defaultStatus = "todo",
}: TaskFormModalProps) {
  const [pending, startTransition] = React.useTransition();

  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [status, setStatus] = React.useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = React.useState("2");
  const [plannedDate, setPlannedDate] = React.useState("");
  const [scheduledTime, setScheduledTime] = React.useState("");
  const [isMeeting, setIsMeeting] = React.useState(false);
  const [remindOption, setRemindOption] = React.useState("15");
  const [daySlot, setDaySlot] = React.useState<DaySlot>("any");
  const [estimatedMinutes, setEstimatedMinutes] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [projectId, setProjectId] = React.useState("none");
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
      setEstimatedMinutes(task?.estimated_minutes ? String(task.estimated_minutes) : "");
      setDueDate(task?.due_date ?? "");
      setProjectId(task?.project_id ? String(task.project_id) : "none");
      setIsMeeting(Boolean(task?.is_meeting));
      setWaitingPerson(task?.waiting_on_person ?? "");
      setWaitingContext(task?.waiting_context ?? "");
      setFollowUpDate(task?.follow_up_at ? task.follow_up_at.slice(0, 10) : "");
      setConflicts([]);

      if (task?.scheduled_start_at) {
        const parts = extractLocalTimeParts(task.scheduled_start_at, "Europe/Moscow");
        setScheduledTime(parts.timeStr);
        if (
          task.reminder_sent_at === REMINDER_DISABLED_SENTINEL ||
          task.remind_before_minutes === null
        ) {
          setRemindOption("none");
        } else {
          setRemindOption(String(task.remind_before_minutes ?? 15));
        }
      } else {
        setScheduledTime("");
        setRemindOption("15");
      }
    }
  }, [open, task, defaultPlannedDate, defaultStatus]);

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
          durationMinutes: estimatedMinutes ? Number(estimatedMinutes) : isMeeting ? 60 : 30,
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const remindBefore =
          !scheduledTime || remindOption === "none" ? null : Number(remindOption);

        await saveTaskAction({
          id: task?.id,
          title,
          notes,
          status,
          priority: Number(priority) || 2,
          planned_date: plannedDate || null,
          scheduled_time: scheduledTime || null,
          is_meeting: isMeeting,
          remind_before_minutes: remindBefore,
          day_slot: daySlot,
          estimated_minutes: estimatedMinutes ? Number(estimatedMinutes) : null,
          due_date: dueDate || null,
          project_id: projectId !== "none" ? Number(projectId) : null,
          waiting_on_person: waitingPerson || null,
          waiting_context: waitingContext || null,
          follow_up_at: followUpDate ? `${followUpDate}T10:00:00` : null,
        });
        toast.success(task ? "Задача обновлена" : "Задача создана");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения задачи");
      }
    });
  }

  function handleDelete() {
    if (!task) return;
    startTransition(async () => {
      try {
        await deleteTaskAction(task.id);
        toast.success("Задача удалена");
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
      description="Гибкие слоты или точное время встречи с проверкой пересечений и напоминанием в Telegram."
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

          {status === "waiting" ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3.5">
              <Field>
                <FieldLabel htmlFor="waiting-person">От кого ждём ответ</FieldLabel>
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
                  <FieldLabel htmlFor="waiting-followup">Когда напомнить</FieldLabel>
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
                <FieldLabel htmlFor="task-clock-time" className="flex items-center gap-1">
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
            <Field orientation="horizontal" className="items-center justify-between">
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
                      <SelectItem value="30">За 30 минут</SelectItem>
                      <SelectItem value="60">За 1 час</SelectItem>
                      <SelectItem value="none">Не напоминать</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <div className="flex items-center text-xs text-muted-foreground">
                Укажи точное время, чтобы бот прислал напоминание в Telegram.
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  1 · Главное
                </ToggleGroupItem>
                <ToggleGroupItem value="2" className="min-h-11 flex-1">
                  2 · Важно
                </ToggleGroupItem>
                <ToggleGroupItem value="3" className="min-h-11 flex-1">
                  3 · Обычное
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
          </div>

          <Field>
            <FieldLabel htmlFor="task-notes">Заметки и детали</FieldLabel>
            <Textarea
              id="task-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ссылки, вопросы к обсуждению или критерий готовности…"
            />
          </Field>
        </FieldGroup>

        <div className="flex items-center justify-between gap-3 pt-2">
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
            className="min-h-11 flex-1 sm:flex-initial sm:min-w-[180px] rounded-xl"
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
