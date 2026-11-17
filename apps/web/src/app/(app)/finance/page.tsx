import { formatIsoDate, getFinanceDashboardData } from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";
import { FinanceView } from "@/components/modules/finance-view";

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string }>;
}) {
  const [{ db }, params] = await Promise.all([
    requireOwnerSession(),
    searchParams,
  ]);

  const data = await getFinanceDashboardData(db, {
    month: params.month,
    transactionsLimit: 150,
    timeZone: "Europe/Moscow",
  });

  const todayDate = formatIsoDate(
    new Date(),
    data.profile?.timezone ?? "Europe/Moscow"
  );

  return (
    <FinanceView
      todayDate={todayDate}
      initialTab={params.tab}
      data={data}
    />
  );
}
