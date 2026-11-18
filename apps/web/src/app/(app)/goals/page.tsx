import {
  getGoalsDashboardData,
  getLifeAnalyticsSummary,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";
import { GoalsView } from "@/components/modules/goals/goals-view";

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; date?: string }>;
}) {
  const [{ db }, params] = await Promise.all([
    requireOwnerSession(),
    searchParams,
  ]);

  const timeZone = "Europe/Moscow";
  const [data, analytics7, analytics30] = await Promise.all([
    getGoalsDashboardData(db, {
      anchorDate: params.date,
      analyticsDays: 14,
      includeArchivedHabits: false,
      timeZone,
    }),
    getLifeAnalyticsSummary(db, params.date, 7, timeZone),
    getLifeAnalyticsSummary(db, params.date, 30, timeZone),
  ]);

  return (
    <GoalsView
      initialTab={params.tab}
      data={data}
      analyticsByWindow={{
        7: analytics7,
        14: data.analytics,
        30: analytics30,
      }}
    />
  );
}
