"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";

const WATCHED_TABLES = [
  "tasks",
  "day_plans",
  "pending_actions",
  "state_checkins",
  "dashboard_widgets",
  "finance_transactions",
  "finance_accounts",
] as const;

export function useRealtimeRefresh() {
  const router = useRouter();
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    const supabase = getBrowserSupabase();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const triggerRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        router.refresh();
      }, 250);
    };

    let channel = supabase.channel("life-os-live-sync");
    for (const table of WATCHED_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        triggerRefresh
      );
    }

    channel.subscribe((status) => {
      setConnected(status === "SUBSCRIBED");
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return connected;
}
