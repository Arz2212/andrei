"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  HeartPulseIcon,
  Loader2Icon,
  SparklesIcon,
} from "lucide-react";
import type { DaySlot } from "@life-os/db";
import {
  checkTaskConflictAction,
  createAgreementAction,
  createStateCheckinAction,
  saveTaskAction,
  type ConflictPreviewItem,
} from "@/app/actions";
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

interface QuickCaptureDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  todayDate: string;
}

export function QuickCaptureDrawer({
  open,
  onOpenChange,
  todayDate,
}: QuickCaptureDrawerProps) {
  const [mode, setMode] = React.useState<"task" | "state" | "rule">("task");
  const [pending, startTransition] = React.useTransition();

  // Task state
  const [taskTitle, setTaskTitle] = React.useState("");
  const [plannedDate, setPlannedDate] = React.useState(todayDate);
  const [scheduledTime, setScheduledTime] = React.useState("");
  const [isMeeting, setIsMeeting] = React.useState(false);
  const [slot, setSlot] = React.useState<DaySlot>("any");
  const [minutes, setMinutes] = React.useState("30");
  const [isToday, setIsToday] = React.useState<"scheduled" | "inbox">("scheduled");
  const [conflicts, setConflicts] = React.useState<ConflictPreviewItem[]>([]);

  // Pulse state
  const [energy, setEnergy] = React.useState("4");
  const [mood, setMood] = React.useState("4");
  const [stateNote, setStateNote] = React.useState("");

  // Rule state
  const [ruleText, setRuleText] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setPlannedDate(todayDate);
      setConflicts([]);
    }
  }, [open, todayDate]);

  React.useEffect(() => {
    if (!open || mode !== "task" || isToday !== "scheduled" || !scheduledTime || !plannedDate) {
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
              useScheduled && scheduledTime ? (isMeeting ? 15 : 0) : null,
            day_slot: slot,
            estimated_minutes: Number(minutes) || null,
            status: useScheduled ? "todo" : "inbox",
            priority: 2,
          });
          setTaskTitle("");
          setScheduledTime("");
          setIsMeeting(false);
          toast.success("Задача добавлена");
        } else if (mode === "state") {
          await createStateCheckinAction({
            energy_score: Number(energy) || 4,
            mood_score: Number(mood) || 4,
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
      <DrawerContent className="mx-auto max-h-[90dvh] w-full max-w-lg rounded-t-2xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
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
              if (v === "task" || v === "state" || v === "rule") setMode(v);
            }}
            variant="outline"
            spacing={2}
            className="w-full"
          >
            <ToggleGroupItem value="task" className="min-h-11 flex-1 rounded-xl">
              <CheckCircle2Icon data-icon="inline-start" />
              Задача
            </ToggleGroupItem>
            <ToggleGroupItem value="state" className="min-h-11 flex-1 rounded-xl">
              <HeartPulseIcon data-icon="inline-start" />
              Пульс
            </ToggleGroupItem>
            <ToggleGroupItem value="rule" className="min-h-11 flex-1 rounded-xl">
              <SparklesIcon data-icon="inline-start" />
              Правило ИИ
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
                        <FieldLabel htmlFor="qc-time" className="flex items-center gap-1">
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
                          Встреча (напомнить за 15 мин в Telegram)
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

            {mode === "state" ? (
              <FieldGroup className="gap-3.5">
                <Field>
                  <FieldLabel>Энергия (1–5)</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={energy}
                    onValueChange={(v) => v && setEnergy(v)}
                    variant="outline"
                    spacing={2}
                    className="w-full"
                  >
                    {["1", "2", "3", "4", "5"].map((val) => (
                      <ToggleGroupItem
                        key={val}
                        value={val}
                        className="min-h-11 flex-1 rounded-xl num-tabular"
                      >
                        {val}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>

                <Field>
                  <FieldLabel>Настроение (1–5)</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={mood}
                    onValueChange={(v) => v && setMood(v)}
                    variant="outline"
                    spacing={2}
                    className="w-full"
                  >
                    {["1", "2", "3", "4", "5"].map((val) => (
                      <ToggleGroupItem
                        key={val}
                        value={val}
                        className="min-h-11 flex-1 rounded-xl num-tabular"
                      >
                        {val}
                      </ToggleGroupItem>
                    ))}
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
