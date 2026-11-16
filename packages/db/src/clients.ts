import { createBrowserClient, createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { TypedSupabaseClient } from "./types";

export interface CookieItem {
  name: string;
  value: string;
  options?: CookieOptions;
}

export interface ServerCookieAdapter {
  getAll: () => { name: string; value: string }[] | Promise<{ name: string; value: string }[]>;
  setAll?: (cookiesToSet: CookieItem[]) => void | Promise<void>;
}

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  }
  return { url, key };
}

export function isAllowedOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.OWNER_EMAIL || "arz_22@mail.ru").trim().toLowerCase();
  return email.trim().toLowerCase() === allowed;
}

export function createBrowserDbClient(): TypedSupabaseClient {
  const { url, key } = getSupabaseEnv();
  return createBrowserClient<Database>(url, key);
}

export function createServerDbClient(cookies: ServerCookieAdapter): TypedSupabaseClient {
  const { url, key } = getSupabaseEnv();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (cookiesToSet) => {
        if (cookies.setAll) {
          return cookies.setAll(cookiesToSet);
        }
      },
    },
  });
}

let cachedBotClient: TypedSupabaseClient | null = null;
let cachedOwnerUserId: string | null = null;

/**
 * Authenticated Supabase client for the Telegram bot (`apps/bot`).
 * Signs in as the owner (`OWNER_EMAIL` + `OWNER_PASSWORD`) so all queries run
 * through real `authenticated` RLS policies without needing a `service_role` key.
 */
export async function getOwnerBotDbClient(): Promise<{
  db: TypedSupabaseClient;
  userId: string;
}> {
  const { url, key } = getSupabaseEnv();
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;

  if (!email || !password) {
    throw new Error("Missing OWNER_EMAIL or OWNER_PASSWORD in environment");
  }

  if (cachedBotClient && cachedOwnerUserId) {
    const { data } = await cachedBotClient.auth.getSession();
    if (data.session && data.session.expires_at && data.session.expires_at * 1000 > Date.now() + 60_000) {
      return { db: cachedBotClient, userId: cachedOwnerUserId };
    }
  }

  const client =
    cachedBotClient ??
    createClient<Database>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    throw new Error(`Owner bot auth failed: ${error?.message ?? "no user returned"}`);
  }

  cachedBotClient = client;
  cachedOwnerUserId = data.user.id;
  return { db: client, userId: data.user.id };
}
