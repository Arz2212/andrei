"use client";

import * as React from "react";
import { BarChart3Icon, CheckCircle2Icon, TargetIcon } from "lucide-react";
import type { GoalsDashboardData, LifeAnalyticsSummary } from "@life-os/db";
import { HabitsTab } from "@/components/modules/goals/habits-tab";
import { GoalsTab } from "@/components/modules/goals/goals-tab";
import {
  AnalyticsTab,
  type AnalyticsWindowDays,
} from "@/components/modules/goals/analytics-tab";
import { formatDateLongRu } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type GoalsModuleTab = "habits" | "goals" | "analytics";

const VALID_TABS: GoalsModuleTab[] = ["habits", "goals", "analytics"];

interface GoalsViewProps {
  initialTab?: string;
  data: GoalsDashboardData;
  analyticsByWindow: Record<AnalyticsWindowDays, LifeAnalyticsSummary>;
}

export function GoalsView({
  initialTab,
  data,
  analyticsByWindow,
}: GoalsViewProps) {
  const resolveTab = (raw?: string): GoalsModuleTab =>
    raw && VALID_TABS.includes(raw as GoalsModuleTab)
      ? (raw as GoalsModuleTab)
      : "habits";

  const [activeTab, setActiveTab] = React.useState<GoalsModuleTab>(() =>
    resolveTab(initialTab)
  );

  React.useEffect(() => {
    if (initialTab && VALID_TABS.includes(initialTab as GoalsModuleTab)) {
      setActiveTab(initialTab as GoalsModuleTab);
    }
  }, [initialTab]);

  function handleTabChange(next: string) {
    const valid = resolveTab(next);
    setActiveTab(valid);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", valid);
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }

  const activeHabits = data.habits.filter((h) => !h.is_archived);
  const doneHabitsToday = activeHabits.filter(
    (h) => h.completedOnAnchorDate
  ).length;
  const activeGoalsCount = data.goals.filter((g) => g.status === "active").length;
  const insightsCount = analyticsByWindow[14]?.proactiveInsights.length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Цели и привычки
          </h1>
          <p className="text-sm text-muted-foreground">
            Движение к целям через конкретные шаги, трекер привычек в 1 тап и спокойная аналитика ритма
          </p>
        </div>

        <Badge
          variant="secondary"
          className="self-start rounded-xl px-3 py-1 text-xs font-medium sm:self-auto"
        >
          {formatDateLongRu(data.anchorDate)}
        </Badge>
      </div>

      {/* Synced Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-4">
        <TabsList className="grid h-11 w-full grid-cols-3 rounded-2xl p-1 sm:w-auto sm:inline-flex">
          <TabsTrigger
            value="habits"
            className="gap-1.5 rounded-xl px-3 text-xs font-medium sm:text-sm touch-manipulation"
          >
            <CheckCircle2Icon className="size-4 shrink-0" />
            <span>Привычки</span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground num-tabular">
              {doneHabitsToday}/{activeHabits.length}
            </span>
          </TabsTrigger>

          <TabsTrigger
            value="goals"
            className="gap-1.5 rounded-xl px-3 text-xs font-medium sm:text-sm touch-manipulation"
          >
            <TargetIcon className="size-4 shrink-0" />
            <span>Цели</span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground num-tabular">
              {activeGoalsCount}
            </span>
          </TabsTrigger>

          <TabsTrigger
            value="analytics"
            className="gap-1.5 rounded-xl px-3 text-xs font-medium sm:text-sm touch-manipulation"
          >
            <BarChart3Icon className="size-4 shrink-0" />
            <span>Аналитика</span>
            {insightsCount > 0 ? (
              <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary num-tabular">
                {insightsCount}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="habits" className="mt-0">
          <HabitsTab
            habits={data.habits}
            goals={data.goals}
            anchorDate={data.anchorDate}
          />
        </TabsContent>

        <TabsContent value="goals" className="mt-0">
          <GoalsTab goals={data.goals} todayDate={data.todayDate} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-0">
          <AnalyticsTab
            analyticsByWindow={analyticsByWindow}
            onNavigateTab={(tab) => handleTabChange(tab)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
