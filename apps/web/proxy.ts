import { regionDatabase } from "@daybell/config";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { REGION_COOKIE, resolveRegion } from "./lib/region";
import { newNonce, shopContentSecurityPolicy } from "./lib/shop/csp";

/**
 * The parent shop's pages: straight through, never touching studio sign-in (ADR 0022: parents have no account, and
 * their requests shouldn't refresh or read a studio session that may share the browser), with a strict
 * Content-Security-Policy and a fresh nonce, which Next puts on its own scripts (security review L2).
 */
export function shopPage(request: NextRequest): NextResponse {
  const csp = shopContentSecurityPolicy(newNonce(), {
    dev: process.env.NODE_ENV === "development",
  });
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

/**
 * Runs before pages: keeps the Supabase session fresh and sends signed-out visitors away from the studio app.
 * API routes check the session themselves. The parent shop's pages get their own policy (shopPage).
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/shop" || path.startsWith("/shop/")) return shopPage(request);
  let response = NextResponse.next({ request });
  const region = resolveRegion(request.cookies.get(REGION_COOKIE)?.value);
  const db = region ? regionDatabase(region) : null;
  const isApp = request.nextUrl.pathname === "/app" || request.nextUrl.pathname.startsWith("/app/");

  if (!db) {
    return isApp ? NextResponse.redirect(new URL("/sign-in", request.url)) : response;
  }

  const supabase = createServerClient(db.url, db.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getUser();

  if (isApp && !data.user) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|api/|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp|woff2?)$).*)",
  ],
};
