"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2Icon, HeartPulseIcon, SparklesIcon, Loader2Icon } from "lucide-react";
import type { DaySlot } from "@life-os/db";
import {
  createAgreementAction,
  createStateCheckinAction,
  saveTaskAction,
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
  const [slot, setSlot] = React.useState<DaySlot>("any");
  const [minutes, setMinutes] = React.useState("30");
  const [isToday, setIsToday] = React.useState<"today" | "inbox">("today");

  // Pulse state
  const [energy, setEnergy] = React.useState("4");
  const [mood, setMood] = React.useState("4");
  const [stateNote, setStateNote] = React.useState("");

  // Rule state
  const [ruleText, setRuleText] = React.useState("");

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (mode === "task") {
          if (!taskTitle.trim()) return;
          await saveTaskAction({
            title: taskTitle,
            planned_date: isToday === "today" ? todayDate : null,
            day_slot: slot,
            estimated_minutes: Number(minutes) || null,
            status: isToday === "today" ? "todo" : "inbox",
            priority: 2,
          });
          setTaskTitle("");
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
      <DrawerContent className="mx-auto w-full max-w-lg rounded-t-2xl px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <DrawerHeader className="px-0 text-left">
          <DrawerTitle className="text-lg font-semibold tracking-tight">
            Быстрая запись
          </DrawerTitle>
          <DrawerDescription>
            Разгрузи голову — запись сразу синхронизируется с Telegram-ботом.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-4 pt-1 pb-2">
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
                    placeholder="Например: Проверить смету по запуску"
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
                        if (v === "today" || v === "inbox") setIsToday(v);
                      }}
                      variant="outline"
                      spacing={1}
                      className="w-full"
                    >
                      <ToggleGroupItem value="today" className="min-h-11 flex-1">
                        Сегодня
                      </ToggleGroupItem>
                      <ToggleGroupItem value="inbox" className="min-h-11 flex-1">
                        Входящие
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="qc-mins">Оценка (мин)</FieldLabel>
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

                {isToday === "today" ? (
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
