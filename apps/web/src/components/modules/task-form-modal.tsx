"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import type { DaySlot, Project, Task, TaskStatus } from "@life-os/db";
import { deleteTaskAction, saveTaskAction } from "@/app/actions";
import { ResponsiveModal } from "@/components/shell/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  const [daySlot, setDaySlot] = React.useState<DaySlot>("any");
  const [estimatedMinutes, setEstimatedMinutes] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [projectId, setProjectId] = React.useState("none");
  const [waitingPerson, setWaitingPerson] = React.useState("");
  const [waitingContext, setWaitingContext] = React.useState("");
  const [followUpDate, setFollowUpDate] = React.useState("");

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
      setWaitingPerson(task?.waiting_on_person ?? "");
      setWaitingContext(task?.waiting_context ?? "");
      setFollowUpDate(
        task?.follow_up_at ? task.follow_up_at.slice(0, 10) : ""
      );
    }
  }, [open, task, defaultPlannedDate, defaultStatus]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveTaskAction({
          id: task?.id,
          title,
          notes,
          status,
          priority: Number(priority) || 2,
          planned_date: plannedDate || null,
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
      description="Гибкое планирование по слотам Утро / День / Вечер с учётом буфера дня."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="task-title">Формулировка действия</FieldLabel>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="С глагола: подготовить, согласовать, позвонить…"
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
              <FieldLabel htmlFor="task-due">Жёсткий срок</FieldLabel>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
            <Field className="col-span-2 sm:col-span-1">
              <FieldLabel htmlFor="task-mins">Время (мин)</FieldLabel>
              <Input
                id="task-mins"
                type="number"
                min={5}
                max={600}
                step={5}
                placeholder="45"
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

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
            <FieldLabel htmlFor="task-notes">Заметки и детали</FieldLabel>
            <Textarea
              id="task-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ссылки, критерий готовности или контекст разговора…"
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
