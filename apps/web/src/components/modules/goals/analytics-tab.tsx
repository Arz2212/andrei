"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  DumbbellIcon,
  FlameIcon,
  InfoIcon,
  ListChecksIcon,
  SparklesIcon,
} from "lucide-react";
import type {
  LifeAnalyticsSummary,
  ProactiveInsight,
  ProactiveInsightSeverity,
} from "@life-os/db";
import { HABIT_COLOR_STYLES } from "@/components/modules/goals/habits-tab";
import { cn, formatDateShortRu } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type AnalyticsWindowDays = 7 | 14 | 30;

const WINDOW_OPTIONS: Array<{ days: AnalyticsWindowDays; label: string }> = [
  { days: 7, label: "7 дней" },
  { days: 14, label: "14 дней" },
  { days: 30, label: "30 дней" },
];

const SEVERITY_STYLES: Record<
  ProactiveInsightSeverity,
  {
    card: string;
    iconClass: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  attention: {
    card: "border-warning/40 bg-warning/8",
    iconClass: "text-warning",
    Icon: AlertCircleIcon,
  },
  positive: {
    card: "border-domain-finance/30 bg-domain-finance/8",
    iconClass: "text-domain-finance",
    Icon: CheckCircle2Icon,
  },
  info: {
    card: "border-domain-work/30 bg-domain-work/8",
    iconClass: "text-domain-work",
    Icon: InfoIcon,
  },
};

function buildSvgPolyline(
  points: Array<number | null>,
  width: number,
  height: number,
  padX: number,
  padY: number,
  maxVal = 10
): { path: string; coords: Array<{ x: number; y: number; val: number }> } {
  const usableW = width - padX * 2;
  const usableH = height - padY * 2;
  const count = Math.max(1, points.length - 1);
  const coords: Array<{ x: number; y: number; val: number }> = [];

  points.forEach((v, idx) => {
    if (v === null || v === undefined || Number.isNaN(v)) return;
    const x = padX + (idx / count) * usableW;
    const clamped = Math.max(0, Math.min(maxVal, v));
    const y = padY + usableH - (clamped / maxVal) * usableH;
    coords.push({ x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), val: v });
  });

  const path = coords
    .map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x} ${pt.y}`)
    .join(" ");
  return { path, coords };
}

interface AnalyticsTabProps {
  analyticsByWindow: Record<AnalyticsWindowDays, LifeAnalyticsSummary>;
  onNavigateTab?: (tab: "habits" | "goals" | "analytics") => void;
}

export function AnalyticsTab({
  analyticsByWindow,
  onNavigateTab,
}: AnalyticsTabProps) {
  const [windowDays, setWindowDays] = React.useState<AnalyticsWindowDays>(14);
  const summary = analyticsByWindow[windowDays] ?? analyticsByWindow[14];

  function renderInsightAction(insight: ProactiveInsight) {
    if (onNavigateTab && insight.actionHref === "/goals") {
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onNavigateTab("goals")}
          className="min-h-9 shrink-0 rounded-xl text-xs touch-manipulation"
        >
          {insight.actionLabel}
          <ArrowRightIcon className="ml-1 size-3.5" />
        </Button>
      );
    }
    if (onNavigateTab && insight.actionHref === "/goals?tab=habits") {
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onNavigateTab("habits")}
          className="min-h-9 shrink-0 rounded-xl text-xs touch-manipulation"
        >
          {insight.actionLabel}
          <ArrowRightIcon className="ml-1 size-3.5" />
        </Button>
      );
    }
    return (
      <Button
        asChild
        variant="outline"
        size="sm"
        className="min-h-9 shrink-0 rounded-xl text-xs touch-manipulation"
      >
        <Link href={insight.actionHref}>
          {insight.actionLabel}
          <ArrowRightIcon className="ml-1 size-3.5" />
        </Link>
      </Button>
    );
  }

  // Wellbeing SVG coordinates (0..10 scale)
  const svgW = 560;
  const svgH = 160;
  const padX = 18;
  const padY = 18;
  const energyLine = buildSvgPolyline(
    summary.wellbeing.dailySeries.map((d) => d.energy),
    svgW,
    svgH,
    padX,
    padY,
    10
  );
  const moodLine = buildSvgPolyline(
    summary.wellbeing.dailySeries.map((d) => d.mood),
    svgW,
    svgH,
    padX,
    padY,
    10
  );
  const tensionLine = buildSvgPolyline(
    summary.wellbeing.dailySeries.map((d) => d.tension),
    svgW,
    svgH,
    padX,
    padY,
    10
  );
  const reviewLine = buildSvgPolyline(
    summary.wellbeing.dailySeries.map((d) =>
      d.reviewAvgScore !== null ? d.reviewAvgScore * 2 : null
    ),
    svgW,
    svgH,
    padX,
    padY,
    10
  );

  const habitSeries = summary.habits.dailySeries;
  const barGap = habitSeries.length > 16 ? 4 : 8;
  const totalBarAreaW = svgW - padX * 2;
  const barW = Math.max(
    6,
    (totalBarAreaW - barGap * Math.max(0, habitSeries.length - 1)) /
      Math.max(1, habitSeries.length)
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Window Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground num-tabular">
          Окно анализа: {formatDateShortRu(summary.startDate)} —{" "}
          {formatDateShortRu(summary.endDate)}
        </div>
        <div className="inline-flex rounded-xl border border-border/75 bg-card p-1">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => setWindowDays(opt.days)}
              className={cn(
                "min-h-9 rounded-lg px-3 text-xs font-medium transition-colors num-tabular touch-manipulation",
                windowDays === opt.days
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Vertical-stacked 2x2 / 4-col KPI Summary Tiles */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        <Card className="rounded-2xl border-border/70 py-3 shadow-none">
          <CardContent className="flex flex-col gap-1 px-3.5 py-0">
            <span className="truncate text-xs text-muted-foreground">
              Ритм привычек
            </span>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight num-tabular sm:text-xl">
              {summary.habits.adherenceWindowPct}%
            </span>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 py-3 shadow-none">
          <CardContent className="flex flex-col gap-1 px-3.5 py-0">
            <span className="truncate text-xs text-muted-foreground">Фокус задач</span>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight num-tabular sm:text-xl">
              {summary.tasks.focusCompletionRatePct}%
            </span>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 py-3 shadow-none">
          <CardContent className="flex flex-col gap-1 px-3.5 py-0">
            <span className="truncate text-xs text-muted-foreground">
              Энергия / настрой
            </span>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight num-tabular sm:text-xl">
              {summary.wellbeing.avgEnergy ?? "—"} / {summary.wellbeing.avgMood ?? "—"}
            </span>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 py-3 shadow-none">
          <CardContent className="flex flex-col gap-1 px-3.5 py-0">
            <span className="truncate text-xs text-muted-foreground">
              Тренировки нед.
            </span>
            <span className="whitespace-nowrap text-lg font-semibold tracking-tight num-tabular sm:text-xl">
              {summary.healthAndNutrition.workoutsCompletedThisWeek} из{" "}
              {summary.healthAndNutrition.workoutsTargetThisWeek}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Proactive Insights ("Напарник подсвечивает") */}
      <Card className="rounded-2xl border-border/75 py-4 shadow-none">
        <CardHeader className="px-4 pb-2 pt-0 sm:px-5">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-primary" />
            <CardTitle className="text-base font-semibold">
              Напарник подсвечивает
            </CardTitle>
          </div>
          <CardDescription className="text-xs">
            Спокойные наблюдения по связкам целей, привычек, нагрузки и энергии
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5 px-4 py-0 sm:px-5">
          {summary.proactiveInsights.length === 0 ? (
            <div className="rounded-xl border border-domain-finance/25 bg-domain-finance/8 p-3 text-xs text-foreground">
              Ритм устойчивый: активные цели обеспечены конкретными шагами, а нагрузка укладывается в буфер дня.
            </div>
          ) : (
            summary.proactiveInsights.map((insight) => {
              const sev =
                SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.info;
              const SevIcon = sev.Icon;
              return (
                <div
                  key={insight.id}
                  className={cn(
                    "flex flex-col justify-between gap-3 rounded-xl border p-3 sm:flex-row sm:items-center",
                    sev.card
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <SevIcon
                      className={cn("mt-0.5 size-4 shrink-0", sev.iconClass)}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug">
                        {insight.title}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {insight.description}
                      </p>
                    </div>
                  </div>
                  {renderInsightAction(insight)}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* 21-Day Habit Stability Matrix */}
      <Card className="rounded-2xl border-border/75 py-4 shadow-none">
        <CardHeader className="px-4 pb-2.5 pt-0 sm:px-5">
          <CardTitle className="text-base font-semibold">
            Матрица стабильности привычек (21 день)
          </CardTitle>
          <CardDescription className="text-xs">
            Срез регулярности по всем активным привычкам и 30-дневный индекс устойчивости
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-4 py-0 sm:px-5">
          {summary.habits.matrix21d.length === 0 ? (
            <p className="text-xs text-muted-foreground">Нет активных привычек.</p>
          ) : (
            summary.habits.matrix21d.map((habit) => {
              const palette =
                HABIT_COLOR_STYLES[habit.color_token] ??
                HABIT_COLOR_STYLES["domain-health"];
              return (
                <div key={habit.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{habit.title}</span>
                    <div className="flex shrink-0 items-center gap-2 text-muted-foreground num-tabular">
                      <span className="inline-flex items-center gap-0.5">
                        <FlameIcon className="size-3 text-domain-nutrition" />
                        {habit.currentStreak} дн.
                      </span>
                      <Badge
                        variant="secondary"
                        className="rounded-md px-1.5 py-0 text-[11px] num-tabular"
                      >
                        30 дн.: {habit.adherence30dPct}%
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-21 gap-1">
                    {habit.history.slice(-21).map((cell) => (
                      <div
                        key={cell.date}
                        title={`${formatDateShortRu(cell.date)} — ${
                          cell.completed ? "выполнено" : "пропуск"
                        }`}
                        className={cn(
                          "h-3.5 rounded-[4px] transition-colors",
                          cell.completed ? palette.dot : "bg-muted"
                        )}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Cross-Domain SVG Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Daily Habit Completion % Bar Chart */}
        <Card className="rounded-2xl border-border/75 py-4 shadow-none">
          <CardHeader className="px-4 pb-2 pt-0 sm:px-5">
            <CardTitle className="text-base font-semibold">
              Ежедневное выполнение привычек (%)
            </CardTitle>
            <CardDescription className="text-xs num-tabular">
              Средняя стабильность за {summary.windowDays} дн. —{" "}
              {summary.habits.adherenceWindowPct}%
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 py-0 sm:px-5">
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="h-40 w-full overflow-visible"
              role="img"
              aria-label="График выполнения привычек по дням"
            >
              {/* 80% calm rhythm reference line */}
              <line
                x1={padX}
                x2={svgW - padX}
                y1={padY + (svgH - padY * 2) * 0.2}
                y2={padY + (svgH - padY * 2) * 0.2}
                stroke="var(--border)"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              {habitSeries.map((pt, idx) => {
                const usableH = svgH - padY * 2;
                const h = Math.max(3, (pt.pct / 100) * usableH);
                const x = padX + idx * (barW + barGap);
                const y = padY + usableH - h;
                return (
                  <rect
                    key={pt.date}
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    rx={Math.min(5, barW / 2)}
                    fill={
                      pt.pct >= 75
                        ? "var(--primary)"
                        : pt.pct >= 40
                          ? "var(--domain-nutrition)"
                          : "var(--muted-foreground)"
                    }
                    fillOpacity={pt.pct === 0 ? 0.22 : 0.88}
                  >
                    <title>
                      {formatDateShortRu(pt.date)}: {pt.done}/{pt.total} ({pt.pct}%)
                    </title>
                  </rect>
                );
              })}
            </svg>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground num-tabular">
              <span>{formatDateShortRu(summary.startDate)}</span>
              <span>Ориентир устойчивости 80%</span>
              <span>{formatDateShortRu(summary.endDate)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Wellbeing & Evening Review Trend Chart */}
        <Card className="rounded-2xl border-border/75 py-4 shadow-none">
          <CardHeader className="px-4 pb-2 pt-0 sm:px-5">
            <CardTitle className="text-base font-semibold">
              Энергия, настроение и вечерний разбор
            </CardTitle>
            <CardDescription className="text-xs num-tabular">
              Серия вечерних разборов: {summary.wellbeing.reviewStreak} дн.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 py-0 sm:px-5">
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="h-40 w-full overflow-visible"
              role="img"
              aria-label="Тренд энергии, настроения и напряжения"
            >
              {[0.25, 0.5, 0.75].map((ratio) => (
                <line
                  key={ratio}
                  x1={padX}
                  x2={svgW - padX}
                  y1={padY + (svgH - padY * 2) * ratio}
                  y2={padY + (svgH - padY * 2) * ratio}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
              ))}
              {energyLine.path ? (
                <path
                  d={energyLine.path}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {moodLine.path ? (
                <path
                  d={moodLine.path}
                  fill="none"
                  stroke="var(--domain-work)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {tensionLine.path ? (
                <path
                  d={tensionLine.path}
                  fill="none"
                  stroke="var(--domain-health)"
                  strokeWidth="1.75"
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                />
              ) : null}
              {reviewLine.path ? (
                <path
                  d={reviewLine.path}
                  fill="none"
                  stroke="var(--domain-mind)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : null}
              {energyLine.coords.map((pt, i) => (
                <circle
                  key={i}
                  cx={pt.x}
                  cy={pt.y}
                  r="3"
                  fill="var(--primary)"
                />
              ))}
            </svg>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground num-tabular">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-primary" />
                Энергия ({summary.wellbeing.avgEnergy ?? "—"})
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-domain-work" />
                Настрой ({summary.wellbeing.avgMood ?? "—"})
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-domain-health" />
                Напряжение ({summary.wellbeing.avgTension ?? "—"})
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full bg-domain-mind" />
                Разбор дня
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cross-Domain Summary Cards: Tasks Focus & Workouts/Health */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="rounded-2xl border-border/75 py-4 shadow-none">
          <CardContent className="flex flex-col gap-2 px-4 py-0 sm:px-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ListChecksIcon className="size-4 text-domain-work" />
              Нагрузка и фокус в задачах
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">Закрыто</span>
                <span className="whitespace-nowrap text-base font-semibold num-tabular">
                  {summary.tasks.completedCount}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">План/день</span>
                <span className="whitespace-nowrap text-base font-semibold num-tabular">
                  {summary.tasks.avgPlannedMinutes} мин
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">Буфер</span>
                <span className="whitespace-nowrap text-base font-semibold num-tabular">
                  {summary.tasks.avgBufferMinutes} мин
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/75 py-4 shadow-none">
          <CardContent className="flex flex-col gap-2 px-4 py-0 sm:px-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <DumbbellIcon className="size-4 text-domain-health" />
              Спорт, вес и питание
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">Окна нед.</span>
                <span className="whitespace-nowrap text-base font-semibold num-tabular">
                  {summary.healthAndNutrition.workoutsCompletedThisWeek}/
                  {summary.healthAndNutrition.workoutsTargetThisWeek}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">Текущий вес</span>
                <span className="whitespace-nowrap text-base font-semibold num-tabular">
                  {summary.healthAndNutrition.latestWeightKg
                    ? `${summary.healthAndNutrition.latestWeightKg} кг`
                    : "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">Ккал / день</span>
                <span className="whitespace-nowrap text-base font-semibold num-tabular">
                  {summary.healthAndNutrition.avgDailyKcal > 0
                    ? `${Math.round(summary.healthAndNutrition.avgDailyKcal)}`
                    : "—"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
