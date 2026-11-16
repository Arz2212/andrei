"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  HeartPulseIcon,
  MoonStarIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  Loader2Icon,
} from "lucide-react";
import type {
  DailyReview,
  EveningReviewCriterion,
  StateCheckin,
} from "@life-os/db";
import {
  createStateCheckinAction,
  deleteEveningCriterionAction,
  saveDailyReviewAction,
  saveEveningCriterionAction,
} from "@/app/actions";
import { formatDateShortRu } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ResponsiveModal } from "@/components/shell/responsive-modal";

const CONTEXT_TAGS = [
  "глубокий фокус",
  "после тренировки",
  "выспался",
  "перегруз созвонами",
  "прогулка",
  "недосып",
];

interface JournalViewProps {
  todayDate: string;
  checkins: StateCheckin[];
  criteria: EveningReviewCriterion[];
  todayReview: DailyReview | null;
  recentReviews: DailyReview[];
}

export function JournalView({
  todayDate,
  checkins,
  criteria,
  todayReview,
  recentReviews,
}: JournalViewProps) {
  const [pending, startTransition] = React.useTransition();

  // Intraday pulse form
  const [energy, setEnergy] = React.useState("4");
  const [mood, setMood] = React.useState("4");
  const [tension, setTension] = React.useState("2");
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [pulseNote, setPulseNote] = React.useState("");

  // Evening split review form
  const [tasksScore, setTasksScore] = React.useState(
    String(todayReview?.tasks_score ?? 4)
  );
  const [healthScore, setHealthScore] = React.useState(
    String(todayReview?.health_score ?? 4)
  );
  const [nutritionScore, setNutritionScore] = React.useState(
    String(todayReview?.nutrition_score ?? 4)
  );
  const [habitsScore, setHabitsScore] = React.useState(
    String(todayReview?.habits_score ?? 4)
  );
  const [highlight, setHighlight] = React.useState(
    todayReview?.day_highlight ?? ""
  );
  const [drained, setDrained] = React.useState(
    todayReview?.what_drained_energy ?? ""
  );
  const [tomorrowMain, setTomorrowMain] = React.useState(
    todayReview?.tomorrow_main_thing ?? ""
  );

  // Criteria configurator modal
  const [criteriaModalOpen, setCriteriaModalOpen] = React.useState(false);
  const [critDomain, setCritDomain] = React.useState<
    "tasks" | "health" | "nutrition" | "habits" | "custom"
  >("tasks");
  const [critLabel, setCritLabel] = React.useState("");
  const [critRule, setCritRule] = React.useState("");

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function handleSaveCheckin(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createStateCheckinAction({
          energy_score: Number(energy) || 4,
          mood_score: Number(mood) || 4,
          tension_score: Number(tension) || 2,
          context_tags: selectedTags,
          note: pulseNote,
        });
        setPulseNote("");
        setSelectedTags([]);
        toast.success("Отметка состояния записана");
      } catch {
        toast.error("Не удалось сохранить отметку");
      }
    });
  }

  function handleSaveEveningReview(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveDailyReviewAction({
          review_date: todayDate,
          tasks_score: Number(tasksScore) || 4,
          health_score: Number(healthScore) || 4,
          nutrition_score: Number(nutritionScore) || 4,
          habits_score: Number(habitsScore) || 4,
          day_highlight: highlight,
          what_drained_energy: drained,
          tomorrow_main_thing: tomorrowMain,
        });
        toast.success("Вечерняя оценка дня сохранена");
      } catch {
        toast.error("Не удалось сохранить оценку дня");
      }
    });
  }

  function handleSaveCriterion(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const slug = `${critDomain}_${Date.now().toString(36)}`;
        await saveEveningCriterionAction({
          criterion_slug: slug,
          domain_key: critDomain,
          label: critLabel,
          scoring_rule_hint: critRule,
          max_score: 5,
        });
        setCritLabel("");
        setCritRule("");
        toast.success("Правило оценки добавлено");
      } catch {
        toast.error("Не удалось сохранить правило");
      }
    });
  }

  function getHintForDomain(domainKey: string, fallback: string) {
    const match = criteria.find(
      (c) => c.domain_key === domainKey && c.is_active
    );
    return match ? match.scoring_rule_hint : fallback;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Состояние и мини-дневник
          </h1>
          <p className="text-sm text-muted-foreground">
            Короткий пульс энергии днём и честная раздельная оценка вечером
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCriteriaModalOpen(true)}
          className="min-h-10 rounded-xl"
        >
          <SlidersHorizontalIcon data-icon="inline-start" />
          Правила оценки дня
        </Button>
      </div>

      <Tabs defaultValue="pulse" className="flex flex-col gap-4">
        <TabsList className="h-11 w-full justify-start sm:w-auto rounded-xl">
          <TabsTrigger value="pulse" className="min-h-9 px-4">
            <HeartPulseIcon className="mr-1.5 size-4" />
            Пульс в течение дня
          </TabsTrigger>
          <TabsTrigger value="evening" className="min-h-9 px-4">
            <MoonStarIcon className="mr-1.5 size-4" />
            Вечерняя оценка
          </TabsTrigger>
        </TabsList>

        {/* INTRADAY PULSE */}
        <TabsContent value="pulse" className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-5 rounded-2xl shadow-none h-fit">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Отметить текущее состояние
              </CardTitle>
              <CardDescription>
                Помогает ассистенту учитывать реальный ресурс при переносе задач
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveCheckin} className="flex flex-col gap-4">
                <FieldGroup className="gap-3.5">
                  <Field>
                    <FieldLabel>Энергия (1 — на нуле, 5 — пик)</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={energy}
                      onValueChange={(v) => v && setEnergy(v)}
                      variant="outline"
                      spacing={1}
                      className="w-full"
                    >
                      {["1", "2", "3", "4", "5"].map((v) => (
                        <ToggleGroupItem
                          key={v}
                          value={v}
                          className="min-h-11 flex-1 num-tabular"
                        >
                          {v}
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
                      spacing={1}
                      className="w-full"
                    >
                      {["1", "2", "3", "4", "5"].map((v) => (
                        <ToggleGroupItem
                          key={v}
                          value={v}
                          className="min-h-11 flex-1 num-tabular"
                        >
                          {v}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Field>

                  <Field>
                    <FieldLabel>Напряжение / стресс (1 — спокойно, 5 — перегруз)</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={tension}
                      onValueChange={(v) => v && setTension(v)}
                      variant="outline"
                      spacing={1}
                      className="w-full"
                    >
                      {["1", "2", "3", "4", "5"].map((v) => (
                        <ToggleGroupItem
                          key={v}
                          value={v}
                          className="min-h-11 flex-1 num-tabular"
                        >
                          {v}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </Field>

                  <Field>
                    <FieldLabel>Контекст</FieldLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {CONTEXT_TAGS.map((tag) => {
                        const active = selectedTags.includes(tag);
                        return (
                          <Button
                            key={tag}
                            type="button"
                            size="xs"
                            variant={active ? "default" : "outline"}
                            onClick={() => toggleTag(tag)}
                            className="min-h-8 rounded-full px-3"
                          >
                            {tag}
                          </Button>
                        );
                      })}
                    </div>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="pulse-note">Заметка в две строки</FieldLabel>
                    <Textarea
                      id="pulse-note"
                      rows={2}
                      value={pulseNote}
                      onChange={(e) => setPulseNote(e.target.value)}
                      placeholder="Что влияет на состояние прямо сейчас?"
                    />
                  </Field>
                </FieldGroup>

                <Button
                  type="submit"
                  disabled={pending}
                  className="min-h-11 w-full rounded-xl"
                >
                  {pending ? (
                    <>
                      <Loader2Icon data-icon="inline-start" className="animate-spin" />
                      Сохраняем…
                    </>
                  ) : (
                    "Сохранить отметку"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-7 rounded-2xl shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Хроника состояния
              </CardTitle>
              <CardDescription>
                Последние записи из веб-приложения и Telegram
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {checkins.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Пока нет отметок состояния.
                </p>
              ) : (
                checkins.map((item) => {
                  const dt = new Date(item.logged_at);
                  const timeStr = new Intl.DateTimeFormat("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(dt);

                  return (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 rounded-xl border border-border/80 p-3.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="num-tabular">
                            Энергия {item.energy_score}/5
                          </Badge>
                          <Badge variant="secondary" className="num-tabular">
                            Настроение {item.mood_score}/5
                          </Badge>
                          {item.tension_score ? (
                            <Badge variant="outline" className="num-tabular">
                              Напряжение {item.tension_score}/5
                            </Badge>
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground num-tabular">
                          {timeStr}
                        </span>
                      </div>

                      {item.note ? (
                        <p className="text-sm leading-relaxed">{item.note}</p>
                      ) : null}

                      {item.context_tags && item.context_tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {item.context_tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* EVENING SPLIT REVIEW */}
        <TabsContent value="evening" className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-7 rounded-2xl shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Раздельная вечерняя оценка ({formatDateShortRu(todayDate)})
              </CardTitle>
              <CardDescription>
                Не смешивай сферы в одну оценку: просадка в делах не отменяет хороший день по здоровью
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveEveningReview} className="flex flex-col gap-4">
                <FieldGroup className="gap-4">
                  {[
                    {
                      key: "tasks",
                      label: "Задачи и фокус",
                      value: tasksScore,
                      setValue: setTasksScore,
                      fallback: "Закрыт ли главный шаг дня без срыва буфера",
                    },
                    {
                      key: "health",
                      label: "Здоровье и движение",
                      value: healthScore,
                      setValue: setHealthScore,
                      fallback: "Сон, тренировка или прогулка, самочувствие",
                    },
                    {
                      key: "nutrition",
                      label: "Питание",
                      value: nutritionScore,
                      setValue: setNutritionScore,
                      fallback: "Нормальные приёмы пищи без хаотичных перекусов",
                    },
                    {
                      key: "habits",
                      label: "Привычки и режим",
                      value: habitsScore,
                      setValue: setHabitsScore,
                      fallback: "Выполнение базовых опор дня",
                    },
                  ].map((item) => (
                    <Field key={item.key}>
                      <div className="flex flex-col gap-0.5">
                        <FieldLabel>{item.label}</FieldLabel>
                        <span className="text-xs text-muted-foreground">
                          {getHintForDomain(item.key, item.fallback)}
                        </span>
                      </div>
                      <ToggleGroup
                        type="single"
                        value={item.value}
                        onValueChange={(v) => v && item.setValue(v)}
                        variant="outline"
                        spacing={1}
                        className="w-full"
                      >
                        {["1", "2", "3", "4", "5"].map((n) => (
                          <ToggleGroupItem
                            key={n}
                            value={n}
                            className="min-h-11 flex-1 num-tabular"
                          >
                            {n}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Field>
                  ))}

                  <Separator />

                  <Field>
                    <FieldLabel htmlFor="rev-win">Что сегодня получилось хорошо</FieldLabel>
                    <Input
                      id="rev-win"
                      value={highlight}
                      onChange={(e) => setHighlight(e.target.value)}
                      placeholder="Один главный итог или приятный момент"
                      className="min-h-11"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="rev-drain">Что забрало лишнюю энергию</FieldLabel>
                    <Input
                      id="rev-drain"
                      value={drained}
                      onChange={(e) => setDrained(e.target.value)}
                      placeholder="Где потеряли фокус или перегрузили план?"
                      className="min-h-11"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="rev-tomorrow">Главный шаг на завтра</FieldLabel>
                    <Input
                      id="rev-tomorrow"
                      value={tomorrowMain}
                      onChange={(e) => setTomorrowMain(e.target.value)}
                      placeholder="С чего начнём утро без раздумий"
                      className="min-h-11"
                    />
                  </Field>
                </FieldGroup>

                <Button
                  type="submit"
                  disabled={pending}
                  className="min-h-11 w-full rounded-xl"
                >
                  Сохранить итоги дня
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-5 rounded-2xl shadow-none h-fit">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Архив вечерних итогов
              </CardTitle>
              <CardDescription>Динамика по четырём контурам жизни</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {recentReviews.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  Заполни первую вечернюю оценку, чтобы видеть динамику недели.
                </p>
              ) : (
                recentReviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="flex flex-col gap-2 rounded-xl border border-border/80 p-3.5"
                  >
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span>{formatDateShortRu(rev.review_date)}</span>
                      <div className="flex items-center gap-1.5 num-tabular">
                        <Badge variant="secondary">Д {rev.tasks_score ?? "—"}/5</Badge>
                        <Badge variant="secondary">З {rev.health_score ?? "—"}/5</Badge>
                        <Badge variant="secondary">П {rev.nutrition_score ?? "—"}/5</Badge>
                        <Badge variant="secondary">Р {rev.habits_score ?? "—"}/5</Badge>
                      </div>
                    </div>
                    {rev.day_highlight ? (
                      <p className="text-sm">{rev.day_highlight}</p>
                    ) : null}
                    {rev.tomorrow_main_thing ? (
                      <p className="text-xs text-muted-foreground">
                        Фокус на следующий день: {rev.tomorrow_main_thing}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Configure Personal Evening Scoring Rules Modal (Vaul Drawer on iPhone) */}
      <ResponsiveModal
        open={criteriaModalOpen}
        onOpenChange={setCriteriaModalOpen}
        title="Личные правила вечерней оценки"
        description="Настрой собственные ориентиры того, что значит «хороший день» в каждой сфере."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {criteria.map((c) => (
              <div
                key={c.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border p-3"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{c.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.scoring_rule_hint}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    startTransition(async () => {
                      await deleteEveningCriterionAction(c.id);
                      toast("Правило удалено");
                    })
                  }
                  aria-label="Удалить правило"
                >
                  <Trash2Icon className="text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>

          <Separator />

          <form onSubmit={handleSaveCriterion} className="flex flex-col gap-3.5">
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel>Сфера оценки</FieldLabel>
                <Select
                  value={critDomain}
                  onValueChange={(v) =>
                    setCritDomain(
                      v as "tasks" | "health" | "nutrition" | "habits" | "custom"
                    )
                  }
                >
                  <SelectTrigger className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="tasks">Задачи и фокус</SelectItem>
                      <SelectItem value="health">Здоровье</SelectItem>
                      <SelectItem value="nutrition">Питание</SelectItem>
                      <SelectItem value="habits">Привычки</SelectItem>
                      <SelectItem value="custom">Свой показатель</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="crit-label">Название показателя</FieldLabel>
                <Input
                  id="crit-label"
                  value={critLabel}
                  onChange={(e) => setCritLabel(e.target.value)}
                  placeholder="Например: Спокойный рабочий ритм"
                  required
                  className="min-h-11"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="crit-rule">Правило оценки (что значит 4–5 баллов)</FieldLabel>
                <Input
                  id="crit-rule"
                  value={critRule}
                  onChange={(e) => setCritRule(e.target.value)}
                  placeholder="Например: Закрыл главное дело до обеда и не работал после 20:00"
                  required
                  className="min-h-11"
                />
              </Field>
            </FieldGroup>

            <Button type="submit" className="min-h-11 w-full rounded-xl">
              Добавить правило
            </Button>
          </form>
        </div>
      </ResponsiveModal>
    </div>
  );
}
