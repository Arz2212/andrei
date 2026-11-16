"use client";

import { createBrowserDbClient, type TypedSupabaseClient } from "@life-os/db";

let browserClient: TypedSupabaseClient | null = null;

export function getBrowserSupabase(): TypedSupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserDbClient();
  }
  return browserClient;
}
