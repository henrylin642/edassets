/**
 * Proxy — Next 16's renamed Middleware (`middleware.ts` → `proxy.ts`).
 *
 * This is the FIRST line of defence only: an optimistic redirect that keeps
 * signed-out browsers out of the admin UI. It verifies the session cookie's
 * HMAC signature and expiry, which is enough to reject a forged cookie without
 * touching the database.
 *
 * It is NOT the whole authorization story. Per the Next.js docs, Server
 * Functions are POSTs to the route they live on, so a matcher change or moving
 * an action can silently drop coverage — every Server Action therefore calls
 * requireUser() itself (lib/auth.ts), and that check also re-validates the
 * token version against the DB.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Paths reachable without a session.
 *
 * - the auth pages themselves (else infinite redirect)
 * - /api/feed        the public catalog the Unity / AR client reads
 * - /api/migrate     must stay reachable to bootstrap the DB — the app_user
 *                    table itself is created by a migration, so requiring login
 *                    here would be a deadlock. It has its own MIGRATE_SECRET.
 * - /api/env-check   booleans only, no values; the diagnostic you need most
 *                    precisely when you cannot log in.
 */
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/api/feed",
  "/api/migrate",
  "/api/env-check",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  let session = null;
  try {
    session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  } catch {
    // AUTH_SECRET missing/short → verifySession throws. Fail CLOSED: treat the
    // request as signed out rather than letting it through.
    session = null;
  }
  if (session) return NextResponse.next();

  const login = new URL("/login", request.url);
  // Remember where they were headed so login can send them back.
  const target = pathname + search;
  if (target && target !== "/") login.searchParams.set("next", target);
  return NextResponse.redirect(login);
}

export const config = {
  /**
   * Run on everything except Next internals and static assets. Without this,
   * Proxy also runs for /_next/static and public/ files and would redirect the
   * CSS and JS of the login page itself.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
