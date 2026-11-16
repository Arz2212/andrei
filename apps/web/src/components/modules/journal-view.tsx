"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HeartPulseIcon,
  Loader2Icon,
  MoonStarIcon,
  PencilIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import {
  addDaysToIsoDate,
  type DailyReview,
  type EveningReviewCriterion,
  type StateCheckin,
} from "@life-os/db";
import {
  createStateCheckinAction,
  deleteDailyReviewAction,
  deleteEveningCriterionAction,
  deleteStateCheckinAction,
  fetchDailyReviewAction,
  saveDailyReviewAction,
  saveEveningCriterionAction,
  updateStateCheckinAction,
} from "@/app/actions";
import { formatDateLongRu, formatDateShortRu } from "@/lib/utils";
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
  const [activeTab, setActiveTab] = React.useState(
    todayReview ? "evening" : "pulse"
  );

  // Intraday pulse create form (1–10 scale matching OpenClaw MCP)
  const [energy, setEnergy] = React.useState("7");
  const [mood, setMood] = React.useState("7");
  const [tension, setTension] = React.useState("3");
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [pulseNote, setPulseNote] = React.useState("");

  // Intraday pulse edit modal
  const [editingCheckin, setEditingCheckin] =
    React.useState<StateCheckin | null>(null);
  const [editEnergy, setEditEnergy] = React.useState("4");
  const [editMood, setEditMood] = React.useState("4");
  const [editTension, setEditTension] = React.useState("2");
  const [editTags, setEditTags] = React.useState<string[]>([]);
  const [editNote, setEditNote] = React.useState("");

  // Evening split review date + hide/edit state
  const [reviewDate, setReviewDate] = React.useState(todayDate);
  const [fetchedReview, setFetchedReview] = React.useState<DailyReview | null>(
    null
  );
  const [reviewLoading, setReviewLoading] = React.useState(false);
  const [isEditingReview, setIsEditingReview] = React.useState(false);

  // Resolve active review for selected date (from server props or fetched)
  const activeDateReview = React.useMemo(() => {
    if (reviewDate === todayDate) return todayReview;
    const inRecent = recentReviews.find((r) => r.review_date === reviewDate);
    if (inRecent) return inRecent;
    return fetchedReview?.review_date === reviewDate ? fetchedReview : null;
  }, [reviewDate, todayDate, todayReview, recentReviews, fetchedReview]);

  // Evening review form fields
  const [tasksScore, setTasksScore] = React.useState("4");
  const [healthScore, setHealthScore] = React.useState("4");
  const [nutritionScore, setNutritionScore] = React.useState("4");
  const [habitsScore, setHabitsScore] = React.useState("4");
  const [highlight, setHighlight] = React.useState("");
  const [drained, setDrained] = React.useState("");
  const [tomorrowMain, setTomorrowMain] = React.useState("");

  const populateReviewForm = React.useCallback((rev: DailyReview | null) => {
    setTasksScore(String(rev?.tasks_score ?? 4));
    setHealthScore(String(rev?.health_score ?? 4));
    setNutritionScore(String(rev?.nutrition_score ?? 4));
    setHabitsScore(String(rev?.habits_score ?? 4));
    setHighlight(rev?.day_highlight ?? "");
    setDrained(rev?.what_drained_energy ?? "");
    setTomorrowMain(rev?.tomorrow_main_thing ?? "");
  }, []);

  React.useEffect(() => {
    populateReviewForm(activeDateReview);
  }, [activeDateReview, populateReviewForm]);

  const handleSelectReviewDate = React.useCallback(
    async (nextDateIso: string) => {
      setReviewDate(nextDateIso);
      setIsEditingReview(false);
      if (nextDateIso === todayDate) {
        setFetchedReview(null);
        return;
      }
      const inRecent = recentReviews.find((r) => r.review_date === nextDateIso);
      if (inRecent) {
        setFetchedReview(inRecent);
        return;
      }
      setReviewLoading(true);
      try {
        const loaded = await fetchDailyReviewAction(nextDateIso);
        setFetchedReview(loaded);
      } catch {
        toast.error("Не удалось загрузить оценку за выбранную дату");
      } finally {
        setReviewLoading(false);
      }
    },
    [todayDate, recentReviews]
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

  function toggleEditTag(tag: string) {
    setEditTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function openEditCheckinModal(item: StateCheckin) {
    setEditingCheckin(item);
    setEditEnergy(String(item.energy_score));
    setEditMood(String(item.mood_score));
    setEditTension(String(item.tension_score ?? 2));
    setEditTags(item.context_tags ?? []);
    setEditNote(item.note ?? "");
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

  function handleUpdateCheckin(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCheckin) return;
    startTransition(async () => {
      try {
        await updateStateCheckinAction(editingCheckin.id, {
          energy_score: Number(editEnergy) || 4,
          mood_score: Number(editMood) || 4,
          tension_score: Number(editTension) || 2,
          context_tags: editTags,
          note: editNote,
        });
        setEditingCheckin(null);
        toast.success("Отметка состояния обновлена");
      } catch {
        toast.error("Не удалось обновить отметку");
      }
    });
  }

  function handleDeleteCheckin(id: number) {
    startTransition(async () => {
      try {
        await deleteStateCheckinAction(id);
        toast.success("Отметка состояния удалена");
      } catch {
        toast.error("Не удалось удалить отметку");
      }
    });
  }

  function handleSaveEveningReview(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await saveDailyReviewAction({
          review_date: reviewDate,
          tasks_score: Number(tasksScore) || 4,
          health_score: Number(healthScore) || 4,
          nutrition_score: Number(nutritionScore) || 4,
          habits_score: Number(habitsScore) || 4,
          day_highlight: highlight,
          what_drained_energy: drained,
          tomorrow_main_thing: tomorrowMain,
        });
        if (reviewDate !== todayDate) {
          const refreshed = await fetchDailyReviewAction(reviewDate);
          setFetchedReview(refreshed);
        }
        setIsEditingReview(false);
        toast.success("Вечерняя оценка дня сохранена");
      } catch {
        toast.error("Не удалось сохранить оценку дня");
      }
    });
  }

  function handleDeleteEveningReview(targetDateOrId: string | number) {
    startTransition(async () => {
      try {
        await deleteDailyReviewAction(targetDateOrId);
        if (fetchedReview) setFetchedReview(null);
        setIsEditingReview(false);
        toast.success("Вечерняя оценка удалена");
      } catch {
        toast.error("Не удалось удалить оценку");
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

  const showEveningForm = !activeDateReview || isEditingReview;

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

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="pulse">
            <HeartPulseIcon className="mr-1.5 size-4" />
            Пульс в течение дня
          </TabsTrigger>
          <TabsTrigger value="evening">
            <MoonStarIcon className="mr-1.5 size-4" />
            Вечерняя оценка
          </TabsTrigger>
        </TabsList>

        {/* INTRADAY PULSE */}
        <TabsContent
          value="pulse"
          className="grid grid-cols-1 gap-4 lg:grid-cols-12"
        >
          <Card className="h-fit rounded-2xl shadow-none lg:col-span-5">
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
                    <FieldLabel>Энергия (1 — на нуле, 10 — пик)</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={energy}
                      onValueChange={(v) => v && setEnergy(v)}
                      variant="outline"
                      spacing={1}
                      className="grid w-full grid-cols-5 gap-1.5 sm:grid-cols-10"
                    >
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map(
                        (v) => (
                          <ToggleGroupItem
                            key={v}
                            value={v}
                            className="min-h-10 w-full rounded-lg num-tabular"
                          >
                            {v}
                          </ToggleGroupItem>
                        )
                      )}
                    </ToggleGroup>
                  </Field>

                  <Field>
                    <FieldLabel>Настроение (1–10)</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={mood}
                      onValueChange={(v) => v && setMood(v)}
                      variant="outline"
                      spacing={1}
                      className="grid w-full grid-cols-5 gap-1.5 sm:grid-cols-10"
                    >
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map(
                        (v) => (
                          <ToggleGroupItem
                            key={v}
                            value={v}
                            className="min-h-10 w-full rounded-lg num-tabular"
                          >
                            {v}
                          </ToggleGroupItem>
                        )
                      )}
                    </ToggleGroup>
                  </Field>

                  <Field>
                    <FieldLabel>
                      Напряжение / стресс (1 — спокойно, 10 — перегруз)
                    </FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={tension}
                      onValueChange={(v) => v && setTension(v)}
                      variant="outline"
                      spacing={1}
                      className="grid w-full grid-cols-5 gap-1.5 sm:grid-cols-10"
                    >
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map(
                        (v) => (
                          <ToggleGroupItem
                            key={v}
                            value={v}
                            className="min-h-10 w-full rounded-lg num-tabular"
                          >
                            {v}
                          </ToggleGroupItem>
                        )
                      )}
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
                    <FieldLabel htmlFor="pulse-note">
                      Заметка в две строки
                    </FieldLabel>
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
                      <Loader2Icon
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                      Сохраняем…
                    </>
                  ) : (
                    "Сохранить отметку"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-none lg:col-span-7">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Хроника состояния
              </CardTitle>
              <CardDescription>
                Последние записи из веб-приложения и Telegram (можно изменить или удалить)
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
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary" className="num-tabular">
                            Энергия {item.energy_score}/10
                          </Badge>
                          <Badge variant="secondary" className="num-tabular">
                            Настроение {item.mood_score}/10
                          </Badge>
                          {item.tension_score ? (
                            <Badge variant="outline" className="num-tabular">
                              Напряжение {item.tension_score}/10
                            </Badge>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-1">
                          <span className="mr-1 text-xs text-muted-foreground num-tabular">
                            {timeStr}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openEditCheckinModal(item)}
                            aria-label="Редактировать отметку"
                            title="Редактировать отметку"
                            className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                          >
                            <PencilIcon className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDeleteCheckin(item.id)}
                            aria-label="Удалить отметку"
                            title="Удалить отметку"
                            className="size-8 rounded-lg text-muted-foreground hover:text-destructive"
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        </div>
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
        <TabsContent
          value="evening"
          className="grid grid-cols-1 gap-4 lg:grid-cols-12"
        >
          <Card className="rounded-2xl shadow-none lg:col-span-7">
            <CardHeader className="flex flex-col gap-3 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base font-semibold">
                    Раздельная вечерняя оценка
                  </CardTitle>
                  <CardDescription>
                    Не смешивай сферы в одну оценку: просадка в делах не отменяет хороший день по здоровью
                  </CardDescription>
                </div>
              </div>

              {/* Date Switcher for Evening Review */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() =>
                      void handleSelectReviewDate(
                        addDaysToIsoDate(reviewDate, -1)
                      )
                    }
                    aria-label="Предыдущий день"
                    className="size-8 rounded-lg"
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <span className="px-2 text-sm font-semibold">
                    {reviewDate === todayDate
                      ? `Сегодня · ${formatDateShortRu(reviewDate)}`
                      : formatDateLongRu(reviewDate)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() =>
                      void handleSelectReviewDate(
                        addDaysToIsoDate(reviewDate, 1)
                      )
                    }
                    aria-label="Следующий день"
                    className="size-8 rounded-lg"
                  >
                    <ChevronRightIcon />
                  </Button>
                </div>

                {reviewDate !== todayDate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void handleSelectReviewDate(todayDate)}
                    className="rounded-lg"
                  >
                    Сегодня
                  </Button>
                ) : null}
              </div>
            </CardHeader>

            <CardContent>
              {reviewLoading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                  Загружаем оценку дня…
                </div>
              ) : !showEveningForm && activeDateReview ? (
                /* SAVED REVIEW SUMMARY CARD (Creation form hidden!) */
                <div className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-accent/35 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-foreground">
                        Оценка за {formatDateShortRu(activeDateReview.review_date)} сохранена
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Нажми «Редактировать», если хочешь обновить баллы или выводы дня
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          populateReviewForm(activeDateReview);
                          setIsEditingReview(true);
                        }}
                        className="min-h-9 rounded-xl"
                      >
                        <PencilIcon data-icon="inline-start" />
                        Редактировать
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleDeleteEveningReview(activeDateReview.id)
                        }
                        className="min-h-9 rounded-xl text-destructive hover:text-destructive"
                      >
                        <Trash2Icon data-icon="inline-start" />
                        Удалить
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {[
                      { label: "Задачи", score: activeDateReview.tasks_score },
                      { label: "Здоровье", score: activeDateReview.health_score },
                      {
                        label: "Питание",
                        score: activeDateReview.nutrition_score,
                      },
                      { label: "Привычки", score: activeDateReview.habits_score },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="flex flex-col gap-0.5 rounded-xl border border-border/70 bg-card p-3"
                      >
                        <span className="text-xs text-muted-foreground">
                          {s.label}
                        </span>
                        <span className="text-lg font-semibold num-tabular">
                          {s.score ?? "—"}/5
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-2.5 text-sm">
                    {activeDateReview.day_highlight ? (
                      <div className="rounded-xl bg-card/80 p-3">
                        <div className="text-xs text-muted-foreground">
                          Что получилось хорошо
                        </div>
                        <p className="mt-0.5 font-medium">
                          {activeDateReview.day_highlight}
                        </p>
                      </div>
                    ) : null}

                    {activeDateReview.what_drained_energy ? (
                      <div className="rounded-xl bg-card/80 p-3">
                        <div className="text-xs text-muted-foreground">
                          Что забрало лишнюю энергию
                        </div>
                        <p className="mt-0.5">
                          {activeDateReview.what_drained_energy}
                        </p>
                      </div>
                    ) : null}

                    {activeDateReview.tomorrow_main_thing ? (
                      <div className="rounded-xl bg-card/80 p-3">
                        <div className="text-xs text-muted-foreground">
                          Главный шаг на следующий день
                        </div>
                        <p className="mt-0.5 font-medium">
                          {activeDateReview.tomorrow_main_thing}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                /* CREATE / EDIT EVENING REVIEW FORM */
                <form
                  onSubmit={handleSaveEveningReview}
                  className="flex flex-col gap-4"
                >
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
                      <FieldLabel htmlFor="rev-win">
                        Что сегодня получилось хорошо
                      </FieldLabel>
                      <Input
                        id="rev-win"
                        value={highlight}
                        onChange={(e) => setHighlight(e.target.value)}
                        placeholder="Один главный итог или приятный момент"
                        className="min-h-11"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="rev-drain">
                        Что забрало лишнюю энергию
                      </FieldLabel>
                      <Input
                        id="rev-drain"
                        value={drained}
                        onChange={(e) => setDrained(e.target.value)}
                        placeholder="Где потеряли фокус или перегрузили план?"
                        className="min-h-11"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="rev-tomorrow">
                        Главный шаг на завтра
                      </FieldLabel>
                      <Input
                        id="rev-tomorrow"
                        value={tomorrowMain}
                        onChange={(e) => setTomorrowMain(e.target.value)}
                        placeholder="С чего начнём утро без раздумий"
                        className="min-h-11"
                      />
                    </Field>
                  </FieldGroup>

                  <div className="flex items-center justify-end gap-2">
                    {activeDateReview ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsEditingReview(false)}
                        className="min-h-11 rounded-xl"
                      >
                        Отмена
                      </Button>
                    ) : null}

                    <Button
                      type="submit"
                      disabled={pending}
                      className="min-h-11 flex-1 rounded-xl"
                    >
                      {activeDateReview
                        ? "Обновить оценку дня"
                        : "Сохранить итоги дня"}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit rounded-2xl shadow-none lg:col-span-5">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Архив вечерних итогов
              </CardTitle>
              <CardDescription>
                Нажми на запись, чтобы открыть или отредактировать её
              </CardDescription>
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
                    onClick={() => {
                      void handleSelectReviewDate(rev.review_date);
                    }}
                    className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border/80 p-3.5 transition-colors hover:bg-muted/35"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs font-medium">
                      <span>{formatDateShortRu(rev.review_date)}</span>
                      <div className="flex items-center gap-1 num-tabular">
                        <Badge variant="secondary">
                          Д {rev.tasks_score ?? "—"}/5
                        </Badge>
                        <Badge variant="secondary">
                          З {rev.health_score ?? "—"}/5
                        </Badge>
                        <Badge variant="secondary">
                          П {rev.nutrition_score ?? "—"}/5
                        </Badge>
                        <Badge variant="secondary">
                          Р {rev.habits_score ?? "—"}/5
                        </Badge>
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

      {/* Edit Existing State Check-in Modal (Vaul Drawer on iPhone) */}
      <ResponsiveModal
        open={Boolean(editingCheckin)}
        onOpenChange={(open) => {
          if (!open) setEditingCheckin(null);
        }}
        title="Редактировать отметку состояния"
        description="Исправь баллы энергии, настроения, контекст или заметку."
      >
        <form onSubmit={handleUpdateCheckin} className="flex flex-col gap-4">
          <FieldGroup className="gap-3.5">
            <Field>
              <FieldLabel>Энергия (1–10)</FieldLabel>
              <ToggleGroup
                type="single"
                value={editEnergy}
                onValueChange={(v) => v && setEditEnergy(v)}
                variant="outline"
                spacing={1}
                className="grid w-full grid-cols-5 gap-1.5 sm:grid-cols-10"
              >
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((v) => (
                  <ToggleGroupItem
                    key={v}
                    value={v}
                    className="min-h-10 w-full rounded-lg num-tabular"
                  >
                    {v}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>

            <Field>
              <FieldLabel>Настроение (1–10)</FieldLabel>
              <ToggleGroup
                type="single"
                value={editMood}
                onValueChange={(v) => v && setEditMood(v)}
                variant="outline"
                spacing={1}
                className="grid w-full grid-cols-5 gap-1.5 sm:grid-cols-10"
              >
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((v) => (
                  <ToggleGroupItem
                    key={v}
                    value={v}
                    className="min-h-10 w-full rounded-lg num-tabular"
                  >
                    {v}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>

            <Field>
              <FieldLabel>Напряжение (1–10)</FieldLabel>
              <ToggleGroup
                type="single"
                value={editTension}
                onValueChange={(v) => v && setEditTension(v)}
                variant="outline"
                spacing={1}
                className="grid w-full grid-cols-5 gap-1.5 sm:grid-cols-10"
              >
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((v) => (
                  <ToggleGroupItem
                    key={v}
                    value={v}
                    className="min-h-10 w-full rounded-lg num-tabular"
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
                  const active = editTags.includes(tag);
                  return (
                    <Button
                      key={tag}
                      type="button"
                      size="xs"
                      variant={active ? "default" : "outline"}
                      onClick={() => toggleEditTag(tag)}
                      className="min-h-8 rounded-full px-3"
                    >
                      {tag}
                    </Button>
                  );
                })}
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="edit-pulse-note">Заметка</FieldLabel>
              <Textarea
                id="edit-pulse-note"
                rows={2}
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
              />
            </Field>
          </FieldGroup>

          <Button type="submit" className="min-h-11 w-full rounded-xl">
            Сохранить изменения
          </Button>
        </form>
      </ResponsiveModal>

      {/* Configure Personal Evening Scoring Rules Modal */}
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
                      v as
                        | "tasks"
                        | "health"
                        | "nutrition"
                        | "habits"
                        | "custom"
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
                <FieldLabel htmlFor="crit-rule">
                  Правило оценки (что значит 4–5 баллов)
                </FieldLabel>
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
