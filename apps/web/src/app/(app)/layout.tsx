import * as React from "react";
import {
  formatIsoDate,
  getOwnerProfile,
  getWaitingTasks,
  listPendingActions,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function ProtectedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db } = await requireOwnerSession();
  const [profile, waitingTasks, pendingActions] = await Promise.all([
    getOwnerProfile(db),
    getWaitingTasks(db),
    listPendingActions(db, ["pending", "editing"]),
  ]);

  const todayDate = formatIsoDate(new Date(), profile?.timezone ?? "Europe/Moscow");

  return (
    <AppShell
      todayDate={todayDate}
      displayName={profile?.display_name ?? "Андрей"}
      waitingCount={waitingTasks.length}
      pendingActionsCount={pendingActions.length}
    >
      {children}
    </AppShell>
  );
}
