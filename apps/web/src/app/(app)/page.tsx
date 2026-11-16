import { formatIsoDate, getOwnerProfile, getTodayOverview } from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";
import { DashboardView } from "@/components/modules/dashboard-view";

export default async function HomePage() {
  const { db } = await requireOwnerSession();
  const profile = await getOwnerProfile(db);
  const todayDate = formatIsoDate(new Date(), profile?.timezone ?? "Europe/Moscow");
  const overview = await getTodayOverview(db, todayDate);

  return (
    <DashboardView
      todayDate={overview.todayDate}
      profile={overview.profile}
      widgets={overview.widgets}
      dayPlan={overview.dayPlan}
      todayTasks={overview.todayTasks}
      waitingTasks={overview.waitingTasks}
      projects={overview.projects}
      latestCheckin={overview.latestCheckin}
      pendingActions={overview.pendingActions}
      financeSummary={overview.financeSummary}
    />
  );
}
