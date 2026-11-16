import { NextResponse, type NextRequest } from "next/server";
import { createServerDbClient, isAllowedOwnerEmail } from "@life-os/db";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerDbClient({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      supabaseResponse = NextResponse.next({
        request,
      });
      for (const { name, value, options } of cookiesToSet) {
        supabaseResponse.cookies.set(name, value, options);
      }
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicPath =
    pathname === "/login" ||
    pathname.startsWith("/auth/callback") ||
    pathname === "/manifest.webmanifest";

  const isAuthorizedOwner = Boolean(user && isAllowedOwnerEmail(user.email));

  if (!isAuthorizedOwner && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const redirectRes = NextResponse.redirect(loginUrl);
    redirectRes.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    return redirectRes;
  }

  if (isAuthorizedOwner && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    const redirectRes = NextResponse.redirect(homeUrl);
    redirectRes.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    return redirectRes;
  }

  supabaseResponse.headers.set(
    "X-Robots-Tag",
    "noindex, nofollow, noarchive, nosnippet"
  );
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
