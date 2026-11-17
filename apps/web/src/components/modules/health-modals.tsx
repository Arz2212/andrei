"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import type {
  MedicalDoctor,
  MedicalFollowUpDraft,
  MedicalRecordFull,
  MedicalRecordKind,
  WorkoutPreferredSlot,
  WorkoutProgram,
  WorkoutProgramDayTemplate,
  WorkoutSession,
} from "@life-os/db";
import {
  addMedicalFollowUpAction,
  completeWorkoutSessionAction,
  deleteMedicalDoctorAction,
  deleteMedicalRecordAction,
  deleteWorkoutProgramAction,
  deleteWorkoutSessionAction,
  saveMedicalDoctorAction,
  saveMedicalRecordAction,
  saveWorkoutProgramAction,
  saveWorkoutSessionAction,
} from "@/app/health-actions";
import { ResponsiveModal } from "@/components/shell/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
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

export const WORKOUT_SLOT_LABELS: Record<WorkoutPreferredSlot, string> = {
  morning: "Утро",
  afternoon: "День",
  evening: "Вечер",
  flexible: "Гибко",
};

export const MEDICAL_KIND_LABELS: Record<MedicalRecordKind, string> = {
  visit: "Визит к врачу",
  lab_panel: "Анализы",
  imaging: "Обследование / УЗИ / МРТ",
  checkup: "Чекап",
  other: "Другое",
};

// ============================================================================
// 1. Floating Workout Window Create / Edit Modal
// ============================================================================

interface WorkoutSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkoutSession | null;
  programs: WorkoutProgram[];
  defaultDate: string;
}

export function WorkoutSessionModal({
  open,
  onOpenChange,
  session,
  programs,
  defaultDate,
}: WorkoutSessionModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState("");
  const [programId, setProgramId] = React.useState("none");
  const [winStart, setWinStart] = React.useState(defaultDate);
  const [winEnd, setWinEnd] = React.useState(defaultDate);
  const [plannedDate, setPlannedDate] = React.useState(defaultDate);
  const [slot, setSlot] = React.useState<WorkoutPreferredSlot>("evening");
  const [duration, setDuration] = React.useState("60");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    if (session) {
      setTitle(session.title);
      setProgramId(session.program_id ? String(session.program_id) : "none");
      setWinStart(session.window_start_date);
      setWinEnd(session.window_end_date);
      setPlannedDate(session.planned_date ?? session.window_start_date);
      setSlot((session.preferred_slot as WorkoutPreferredSlot) ?? "evening");
      setDuration(session.duration_minutes ? String(session.duration_minutes) : "60");
      setNotes(session.notes ?? "");
    } else {
      const activeProg = programs.find((p) => p.is_active) ?? programs[0];
      const nextDay = new Date(`${defaultDate}T12:00:00Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const winEndDef = nextDay.toISOString().slice(0, 10);

      setTitle("");
      setProgramId(activeProg ? String(activeProg.id) : "none");
      setWinStart(defaultDate);
      setWinEnd(winEndDef);
      setPlannedDate(defaultDate);
      setSlot("evening");
      setDuration("60");
      setNotes("");
    }
  }, [open, session, programs, defaultDate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveWorkoutSessionAction({
          id: session?.id,
          program_id: programId !== "none" ? Number(programId) : null,
          title,
          window_start_date: winStart,
          window_end_date: winEnd >= winStart ? winEnd : winStart,
          planned_date: plannedDate || winStart,
          preferred_slot: slot,
          status: session?.status as "planned" | "completed" | "skipped" | undefined,
          duration_minutes: Number(duration) || 60,
          notes,
        });
        toast.success(
          session ? "Окно тренировки обновлено" : "Окно тренировки запланировано"
        );
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={session ? "Изменить окно тренировки" : "Запланировать тренировку"}
      description="Плавающее окно (например, вторник–четверг) удерживает ритм тренировок без срыва плана при переносе на соседний день."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="ws-title">Название тренировки</FieldLabel>
            <Input
              id="ws-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: День A · Тяга, спина и ноги"
              required
              className="min-h-11"
            />
          </Field>

          <Field>
            <FieldLabel>Программа</FieldLabel>
            <Select value={programId} onValueChange={setProgramId}>
              <SelectTrigger className="min-h-11 w-full">
                <SelectValue placeholder="Без программы" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">Вне программы (разовая)</SelectItem>
                  {programs.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="ws-start">Начало окна</FieldLabel>
              <Input
                id="ws-start"
                type="date"
                value={winStart}
                onChange={(e) => {
                  setWinStart(e.target.value);
                  if (winEnd < e.target.value) setWinEnd(e.target.value);
                }}
                required
                className="min-h-11 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ws-end">Конец окна</FieldLabel>
              <Input
                id="ws-end"
                type="date"
                value={winEnd}
                onChange={(e) => setWinEnd(e.target.value)}
                required
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="ws-plan">Ориентир дня</FieldLabel>
              <Input
                id="ws-plan"
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ws-dur">Длительность (мин)</FieldLabel>
              <Input
                id="ws-dur"
                type="number"
                min={10}
                max={300}
                step={5}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>Предпочтительное время дня</FieldLabel>
            <ToggleGroup
              type="single"
              value={slot}
              onValueChange={(v) => v && setSlot(v as WorkoutPreferredSlot)}
              variant="outline"
              spacing={1}
              className="grid w-full grid-cols-4 gap-1"
            >
              {Object.entries(WORKOUT_SLOT_LABELS).map(([k, lbl]) => (
                <ToggleGroupItem key={k} value={k} className="min-h-10 text-xs">
                  {lbl}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="ws-notes">Заметки / рабочие веса</FieldLabel>
            <Textarea
              id="ws-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Акцент тренировки или самочувствие…"
            />
          </Field>
        </FieldGroup>

        <div className="flex items-center justify-between gap-2 pt-2">
          {session ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteWorkoutSessionAction(session.id);
                  toast("Тренировка удалена");
                  onOpenChange(false);
                })
              }
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
            className="min-h-11 flex-1 rounded-xl sm:flex-initial sm:px-6"
          >
            Сохранить
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 2. Complete Workout Session Modal (Duration + RPE 1..10 + Notes)
// ============================================================================

interface CompleteWorkoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkoutSession | null;
}

export function CompleteWorkoutModal({
  open,
  onOpenChange,
  session,
}: CompleteWorkoutModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [duration, setDuration] = React.useState("60");
  const [rpe, setRpe] = React.useState("7");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (!open || !session) return;
    setDuration(String(session.duration_minutes ?? 60));
    setRpe(String(session.perceived_effort ?? 7));
    setNotes(session.notes ?? "");
  }, [open, session]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    startTransition(async () => {
      try {
        await completeWorkoutSessionAction({
          id: session.id,
          durationMinutes: Number(duration) || 60,
          perceivedEffort: Number(rpe) || 7,
          notes,
        });
        toast.success("Тренировка завершена!");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Завершить тренировку"
      description={session?.title ?? "Зафиксируй длительность, субъективную нагрузку и заметку."}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="cw-dur">Фактическая длительность (мин)</FieldLabel>
            <Input
              id="cw-dur"
              type="number"
              min={5}
              max={300}
              step={5}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="min-h-11 num-tabular"
            />
          </Field>

          <Field>
            <FieldLabel>Тяжесть нагрузки RPE (1–10)</FieldLabel>
            <ToggleGroup
              type="single"
              value={rpe}
              onValueChange={(v) => v && setRpe(v)}
              variant="outline"
              spacing={1}
              className="grid w-full grid-cols-5 gap-1.5"
            >
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((val) => (
                <ToggleGroupItem
                  key={val}
                  value={val}
                  className="min-h-10 w-full rounded-xl num-tabular"
                >
                  {val}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="cw-notes">Рабочие веса и самочувствие</FieldLabel>
            <Textarea
              id="cw-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Например: Жим гантелей 28 кг 3x10 уверенно, плечо не беспокоило"
            />
          </Field>
        </FieldGroup>

        <Button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full rounded-xl"
        >
          Отметить выполненной
        </Button>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 3. Workout Program Create / Edit Modal
// ============================================================================

interface WorkoutProgramModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  program: WorkoutProgram | null;
}

export function WorkoutProgramModal({
  open,
  onOpenChange,
  program,
}: WorkoutProgramModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [title, setTitle] = React.useState("");
  const [sessionsPerWeek, setSessionsPerWeek] = React.useState("3");
  const [isActive, setIsActive] = React.useState(true);
  const [days, setDays] = React.useState<
    { day_code: string; title: string; exercisesText: string }[]
  >([
    {
      day_code: "A",
      title: "Верх тела и спина",
      exercisesText: "Подтягивания 3x8\nЖим гантелей лёжа 3x10",
    },
  ]);

  React.useEffect(() => {
    if (!open) return;
    if (program) {
      setTitle(program.title);
      setSessionsPerWeek(String(program.sessions_per_week ?? 3));
      setIsActive(Boolean(program.is_active));
      const parsed = Array.isArray(program.program_structure)
        ? (program.program_structure as unknown as WorkoutProgramDayTemplate[])
        : [];
      setDays(
        parsed.length > 0
          ? parsed.map((d, i) => ({
              day_code: d.day_code || String.fromCharCode(65 + i),
              title: d.title || "",
              exercisesText: (d.exercises ?? []).join("\n"),
            }))
          : [{ day_code: "A", title: "Тренировка A", exercisesText: "" }]
      );
    } else {
      setTitle("");
      setSessionsPerWeek("3");
      setIsActive(true);
      setDays([
        {
          day_code: "A",
          title: "Тяга, спина и ноги",
          exercisesText: "Румынская тяга 3x10\nТяга верхнего блока 3x12",
        },
        {
          day_code: "B",
          title: "Жим, плечи и кор",
          exercisesText: "Жим гантелей на наклонной 3x10\nПланка 3x60 сек",
        },
      ]);
    }
  }, [open, program]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveWorkoutProgramAction({
          id: program?.id,
          title,
          sessions_per_week: Number(sessionsPerWeek) || 3,
          is_active: isActive,
          days: days.map((d) => ({
            day_code: d.day_code,
            title: d.title,
            exercises: d.exercisesText
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean),
          })),
        });
        toast.success(program ? "Программа обновлена" : "Программа создана");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={program ? "Редактировать программу" : "Новая программа тренировок"}
      description="Опиши дни сплита — одной кнопкой они разложатся плавающими окнами на неделю."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="wp-title">Название программы</FieldLabel>
              <Input
                id="wp-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Силовая + тонус · 3 раза в неделю"
                required
                className="min-h-11"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="wp-cnt">Тренировок в нед.</FieldLabel>
              <Input
                id="wp-cnt"
                type="number"
                min={1}
                max={7}
                value={sessionsPerWeek}
                onChange={(e) => setSessionsPerWeek(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <Field
            orientation="horizontal"
            className="items-center justify-between rounded-xl border border-border/80 px-3.5 py-2.5"
          >
            <FieldLabel htmlFor="wp-active" className="font-normal text-sm">
              Активная текущая программа
            </FieldLabel>
            <Switch
              id="wp-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </Field>

          <Separator />

          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Дни программы</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  setDays((prev) => [
                    ...prev,
                    {
                      day_code: String.fromCharCode(65 + prev.length),
                      title: "",
                      exercisesText: "",
                    },
                  ])
                }
                className="rounded-lg"
              >
                <PlusIcon data-icon="inline-start" />
                Добавить день
              </Button>
            </div>

            {days.map((d, idx) => (
              <div
                key={idx}
                className="flex flex-col gap-2 rounded-xl border border-border/80 bg-muted/25 p-3"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={d.day_code}
                    onChange={(e) =>
                      setDays((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, day_code: e.target.value } : row
                        )
                      )
                    }
                    className="min-h-9 w-16 text-center font-semibold"
                    placeholder="A"
                  />
                  <Input
                    value={d.title}
                    onChange={(e) =>
                      setDays((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, title: e.target.value } : row
                        )
                      )
                    }
                    placeholder="Фокус дня (например: Ноги и кор)"
                    className="min-h-9 flex-1"
                  />
                  {days.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setDays((prev) => prev.filter((_, i) => i !== idx))
                      }
                      aria-label="Удалить день"
                    >
                      <Trash2Icon className="size-3.5 text-muted-foreground" />
                    </Button>
                  ) : null}
                </div>
                <Textarea
                  rows={3}
                  value={d.exercisesText}
                  onChange={(e) =>
                    setDays((prev) =>
                      prev.map((row, i) =>
                        i === idx
                          ? { ...row, exercisesText: e.target.value }
                          : row
                      )
                    )
                  }
                  placeholder="По одному упражнению на строке…"
                />
              </div>
            ))}
          </div>
        </FieldGroup>

        <div className="flex items-center justify-between gap-2 pt-2">
          {program ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteWorkoutProgramAction(program.id);
                  toast("Программа удалена");
                  onOpenChange(false);
                })
              }
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
            className="min-h-11 flex-1 rounded-xl sm:flex-initial sm:px-6"
          >
            Сохранить программу
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 4. Medical Record Create / Edit Modal (Organizational Only!)
// ============================================================================

interface MedicalRecordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: MedicalRecordFull | null;
  doctors: MedicalDoctor[];
  defaultDate: string;
}

export function MedicalRecordModal({
  open,
  onOpenChange,
  record,
  doctors,
  defaultDate,
}: MedicalRecordModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [kind, setKind] = React.useState<MedicalRecordKind>("visit");
  const [recordDate, setRecordDate] = React.useState(defaultDate);
  const [doctorId, setDoctorId] = React.useState("none");
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [conclusion, setConclusion] = React.useState("");
  const [nextVisitDate, setNextVisitDate] = React.useState("");
  const [followUps, setFollowUps] = React.useState<MedicalFollowUpDraft[]>([]);

  React.useEffect(() => {
    if (!open) return;
    if (record) {
      setKind(record.record_kind as MedicalRecordKind);
      setRecordDate(record.record_date);
      setDoctorId(record.doctor_id ? String(record.doctor_id) : "none");
      setTitle(record.title);
      setSummary(record.summary ?? "");
      setConclusion(record.doctor_conclusion ?? "");
      setNextVisitDate(record.next_visit_date ?? "");
      setFollowUps([]);
    } else {
      setKind("visit");
      setRecordDate(defaultDate);
      setDoctorId(doctors[0] ? String(doctors[0].id) : "none");
      setTitle("");
      setSummary("");
      setConclusion("");
      setNextVisitDate("");
      setFollowUps([
        { action_title: "", due_date: "", create_linked_task: false },
      ]);
    }
  }, [open, record, doctors, defaultDate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveMedicalRecordAction({
          id: record?.id,
          record_kind: kind,
          record_date: recordDate,
          doctor_id: doctorId !== "none" ? Number(doctorId) : null,
          title,
          summary,
          doctor_conclusion: conclusion,
          next_visit_date: nextVisitDate || null,
          followUps: record
            ? undefined
            : followUps
                .filter((f) => f.action_title.trim())
                .map((f) => ({
                  action_title: f.action_title.trim(),
                  due_date: f.due_date || null,
                  create_linked_task: Boolean(f.create_linked_task),
                })),
        });
        toast.success(record ? "Запись медкарты обновлена" : "Запись добавлена в медкарту");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={record ? "Изменить запись медкарты" : "Новая медицинская запись"}
      description="Организационный учёт визитов и анализов. Назначения и терапию определяет исключительно врач."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Тип записи</FieldLabel>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as MedicalRecordKind)}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Object.entries(MEDICAL_KIND_LABELS).map(([k, lbl]) => (
                      <SelectItem key={k} value={k}>
                        {lbl}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="mr-date">Дата визита / сдачи</FieldLabel>
              <Input
                id="mr-date"
                type="date"
                value={recordDate}
                onChange={(e) => setRecordDate(e.target.value)}
                required
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="mr-title">Заголовок</FieldLabel>
            <Input
              id="mr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Плановый годовой чекап и биохимия крови"
              required
              className="min-h-11"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>Врач / специалист</FieldLabel>
              <Select value={doctorId} onValueChange={setDoctorId}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue placeholder="Не указан" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Без привязки к врачу</SelectItem>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.full_name} ({d.specialty})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="mr-next">Следующий контрольный визит</FieldLabel>
              <Input
                id="mr-next"
                type="date"
                value={nextVisitDate}
                onChange={(e) => setNextVisitDate(e.target.value)}
                className="min-h-11 num-tabular"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="mr-sum">Краткая суть / показатели</FieldLabel>
            <Textarea
              id="mr-sum"
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Основные наблюдения или ключевые цифры из бланка…"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="mr-conc">
              Заключение и рекомендации врача (дословно)
            </FieldLabel>
            <Textarea
              id="mr-conc"
              rows={3}
              value={conclusion}
              onChange={(e) => setConclusion(e.target.value)}
              placeholder="Запиши сюда точные слова и назначения со слов врача…"
            />
          </Field>

          {!record ? (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Дальнейшие шаги по итогам визита
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      setFollowUps((prev) => [
                        ...prev,
                        {
                          action_title: "",
                          due_date: "",
                          create_linked_task: false,
                        },
                      ])
                    }
                    className="rounded-lg"
                  >
                    <PlusIcon data-icon="inline-start" />
                    Шаг
                  </Button>
                </div>
                {followUps.map((fu, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col gap-2 rounded-xl border border-border/75 bg-muted/25 p-2.5"
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Input
                        value={fu.action_title}
                        onChange={(e) =>
                          setFollowUps((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? { ...r, action_title: e.target.value }
                                : r
                            )
                          )
                        }
                        placeholder="Например: Пересдать ферритин"
                        className="min-h-9 sm:col-span-2"
                      />
                      <Input
                        type="date"
                        value={fu.due_date ?? ""}
                        onChange={(e) =>
                          setFollowUps((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, due_date: e.target.value } : r
                            )
                          )
                        }
                        className="min-h-9 num-tabular"
                      />
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={Boolean(fu.create_linked_task)}
                        onCheckedChange={(c) =>
                          setFollowUps((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, create_linked_task: c } : r
                            )
                          )
                        }
                      />
                      <span>Продублировать в раздел «Задачи» с напоминанием</span>
                    </label>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </FieldGroup>

        <div className="flex items-center justify-between gap-2 pt-2">
          {record ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteMedicalRecordAction(record.id);
                  toast("Запись и прикреплённые файлы удалены");
                  onOpenChange(false);
                })
              }
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
            className="min-h-11 flex-1 rounded-xl sm:flex-initial sm:px-6"
          >
            {pending ? (
              <>
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
                Сохраняем…
              </>
            ) : (
              "Сохранить запись"
            )}
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 5. Add Follow-Up Step Modal
// ============================================================================

interface AddFollowUpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordId: number | null;
}

export function AddFollowUpModal({
  open,
  onOpenChange,
  recordId,
}: AddFollowUpModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [actionTitle, setActionTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [createTaskFlag, setCreateTaskFlag] = React.useState(true);

  React.useEffect(() => {
    if (open) {
      setActionTitle("");
      setDueDate("");
      setCreateTaskFlag(true);
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!recordId) return;
    startTransition(async () => {
      try {
        await addMedicalFollowUpAction({
          record_id: recordId,
          action_title: actionTitle,
          due_date: dueDate || null,
          createLinkedTask: createTaskFlag,
        });
        toast.success("Дальнейший шаг добавлен");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Новый шаг по медкарте"
      description="Запиши контрольное действие, назначенное врачом, с напоминанием."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="fu-title">Что нужно сделать</FieldLabel>
            <Input
              id="fu-title"
              value={actionTitle}
              onChange={(e) => setActionTitle(e.target.value)}
              placeholder="Например: Сдать контрольный витамин D и ОАК"
              required
              className="min-h-11"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="fu-due">Контрольная дата</FieldLabel>
            <Input
              id="fu-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="min-h-11 num-tabular"
            />
          </Field>

          <Field
            orientation="horizontal"
            className="items-center justify-between rounded-xl border border-border/80 px-3.5 py-2.5"
          >
            <FieldLabel htmlFor="fu-task" className="font-normal text-sm">
              Сразу создать связанную задачу в плане
            </FieldLabel>
            <Switch
              id="fu-task"
              checked={createTaskFlag}
              onCheckedChange={setCreateTaskFlag}
            />
          </Field>
        </FieldGroup>

        <Button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full rounded-xl"
        >
          Добавить шаг
        </Button>
      </form>
    </ResponsiveModal>
  );
}

// ============================================================================
// 6. Medical Doctor Create / Edit Modal
// ============================================================================

interface MedicalDoctorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctor: MedicalDoctor | null;
}

export function MedicalDoctorModal({
  open,
  onOpenChange,
  doctor,
}: MedicalDoctorModalProps) {
  const [pending, startTransition] = React.useTransition();
  const [fullName, setFullName] = React.useState("");
  const [specialty, setSpecialty] = React.useState("");
  const [clinicName, setClinicName] = React.useState("");
  const [contacts, setContacts] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    if (doctor) {
      setFullName(doctor.full_name);
      setSpecialty(doctor.specialty);
      setClinicName(doctor.clinic_name ?? "");
      setContacts(doctor.contacts ?? "");
      setNotes(doctor.notes ?? "");
    } else {
      setFullName("");
      setSpecialty("");
      setClinicName("");
      setContacts("");
      setNotes("");
    }
  }, [open, doctor]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveMedicalDoctorAction({
          id: doctor?.id,
          full_name: fullName,
          specialty,
          clinic_name: clinicName,
          contacts,
          notes,
        });
        toast.success(doctor ? "Карточка врача обновлена" : "Врач добавлен");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
      }
    });
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={doctor ? "Карточка врача" : "Добавить врача"}
      description="Контакты проверенных специалистов и клиник в одном месте."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FieldGroup className="gap-3.5">
          <Field>
            <FieldLabel htmlFor="doc-name">ФИО специалиста</FieldLabel>
            <Input
              id="doc-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Соколова Елена Викторовна"
              required
              className="min-h-11"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="doc-spec">Специализация</FieldLabel>
              <Input
                id="doc-spec"
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                placeholder="Терапевт / Эндокринолог"
                required
                className="min-h-11"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="doc-clinic">Клиника</FieldLabel>
              <Input
                id="doc-clinic"
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                placeholder="Клиника Рассвет / Чайка"
                className="min-h-11"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="doc-cont">Контакты / запись</FieldLabel>
            <Input
              id="doc-cont"
              value={contacts}
              onChange={(e) => setContacts(e.target.value)}
              placeholder="Телефон, сайт или Telegram регистратуры"
              className="min-h-11"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="doc-notes">Заметки</FieldLabel>
            <Textarea
              id="doc-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Удобные дни приёма или особенности…"
            />
          </Field>
        </FieldGroup>

        <div className="flex items-center justify-between gap-2 pt-2">
          {doctor ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteMedicalDoctorAction(doctor.id);
                  toast("Карточка врача удалена");
                  onOpenChange(false);
                })
              }
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
            className="min-h-11 flex-1 rounded-xl sm:flex-initial sm:px-6"
          >
            Сохранить
          </Button>
        </div>
      </form>
    </ResponsiveModal>
  );
}
