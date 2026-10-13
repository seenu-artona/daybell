import { ApiError } from "@daybell/api";
import { NextResponse } from "next/server";
import { type DbSession, toShopGallerySession } from "@/lib/shop/gallery";
import {
  admitShopRequest,
  callShopFunction,
  chosenSession,
  sessionRequired,
  setShopCookies,
  shopErrorResponse,
  shopHandle,
} from "@/lib/shop/http";
import { type ShopCookieSession, shopCookieSessions } from "@/lib/shop/session";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * GET /api/v1/shop/session — this device's galleries, one per studio (ADR 0022; S6). Galleries that no longer last are
 * dropped from the cookie; with none left, 401 and the cookie is cleared.
 */
export const GET = shopHandle(async (request: Request) => {
  const sessions = shopCookieSessions(request);
  await admitShopRequest(request, sessions);
  if (sessions.length === 0) throw sessionRequired();
  const rows = await Promise.all(
    sessions.map(async (session) => {
      try {
        const row = await callShopFunction<DbSession>(session.region, "shop_session", {
          p_session_hash: session.hash,
        });
        return { session, row };
      } catch (err) {
        if (err instanceof ApiError && err.code === "shop_session_required") return null;
        throw err;
      }
    }),
  );
  const live = rows.filter((r): r is { session: ShopCookieSession; row: DbSession } => r !== null);
  const kept = live.map((r) => r.session);
  if (live.length === 0)
    return setShopCookies(request, shopErrorResponse(sessionRequired()), { sessions: [] });
  const res = NextResponse.json({
    galleries: live.map(({ session, row }) => toShopGallerySession(session.galleryId, row)),
  });
  return kept.length === sessions.length ? res : setShopCookies(request, res, { sessions: kept });
});

/**
 * DELETE /api/v1/shop/session — "Forget this device" (answer 3, call 11; S6): with ?gallery=, that gallery (its
 * session, children and bag); without, every gallery on this device. The cookie keeps the rest, or is cleared.
 */
export const DELETE = shopHandle(async (request: Request) => {
  const sessions = shopCookieSessions(request);
  await admitShopRequest(request, sessions);
  const named = new URL(request.url).searchParams.has("gallery");
  const chosen = chosenSession(request, sessions);
  const forgotten = named ? (chosen ? [chosen] : []) : sessions;
  for (const session of forgotten)
    await callShopFunction<boolean>(session.region, "shop_forget", {
      p_session_hash: session.hash,
    });
  return setShopCookies(request, new NextResponse(null, { status: 204 }), {
    sessions: sessions.filter((s) => !forgotten.includes(s)),
  });
});
