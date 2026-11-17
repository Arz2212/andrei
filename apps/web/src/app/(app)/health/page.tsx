import { getHealthDashboardData } from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";
import { HealthView } from "@/components/modules/health-view";

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; date?: string }>;
}) {
  const [{ db }, params] = await Promise.all([
    requireOwnerSession(),
    searchParams,
  ]);

  const data = await getHealthDashboardData(db, {
    anchorDate: params.date,
    timeZone: "Europe/Moscow",
  });

  return <HealthView initialTab={params.tab} data={data} />;
}
