import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createServerDbClient,
  isAllowedOwnerEmail,
  type TypedSupabaseClient,
} from "@life-os/db";

export async function getServerSupabase(): Promise<TypedSupabaseClient> {
  const cookieStore = await cookies();
  return createServerDbClient({
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // Ignored when called from a Server Component render; proxy refreshes cookies.
      }
    },
  });
}

export async function requireOwnerSession(): Promise<{
  db: TypedSupabaseClient;
  userId: string;
  email: string;
}> {
  const db = await getServerSupabase();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user || !isAllowedOwnerEmail(user.email)) {
    redirect("/login");
  }

  return {
    db,
    userId: user.id,
    email: user.email!,
  };
}
