"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";

const WATCHED_TABLES = [
  "tasks",
  "projects",
  "day_plans",
  "reminders_queue",
  "pending_actions",
  "state_checkins",
  "daily_reviews",
  "dashboard_widgets",
  "assistant_settings",
  "assistant_agreements",
  "finance_transactions",
  "finance_accounts",
  "finance_categories",
  "finance_obligations",
  "finance_debts",
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
      }, 220);
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

    const handleFocus = () => triggerRefresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return connected;
}
