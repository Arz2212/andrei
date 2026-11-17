import { getNutritionDashboardData } from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";
import { NutritionView } from "@/components/modules/nutrition-view";

export default async function NutritionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; date?: string }>;
}) {
  const [{ db }, params] = await Promise.all([
    requireOwnerSession(),
    searchParams,
  ]);

  const data = await getNutritionDashboardData(db, {
    anchorDate: params.date,
    timeZone: "Europe/Moscow",
  });

  return <NutritionView initialTab={params.tab} data={data} />;
}
