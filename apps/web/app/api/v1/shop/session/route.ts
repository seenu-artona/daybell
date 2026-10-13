import { ApiError } from "@daybell/api";
import { NextResponse } from "next/server";
import { shopCookieSession } from "@/lib/shop/session";
import {
  admitShopRequest,
  requireShopSession,
  setShopCookies,
  shop,
  shopErrorResponse,
  shopHandle,
  toShopSession,
} from "@/lib/shop/shop";
import { shopKeys } from "@/lib/shop/throttle";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/** GET /api/v1/shop/session — the session's studio and children (ADR 0022). A dead cookie is cleared. */
export const GET = shopHandle(async (request: Request) => {
  const session = await requireShopSession(request);
  try {
    const row = await shop<Parameters<typeof toShopSession>[0]>(session.region, "shop_session", {
      p_session_hash: session.hash,
    });
    return NextResponse.json(toShopSession(row));
  } catch (err) {
    if (err instanceof ApiError && err.code === "shop_session_required")
      return setShopCookies(shopErrorResponse(err), { session: "clear" });
    throw err;
  }
});

/** DELETE /api/v1/shop/session — "Forget this device": the session, its children and its bag go (answer 3, call 11). */
export const DELETE = shopHandle(async (request: Request) => {
  const session = shopCookieSession(request);
  if (session) {
    await admitShopRequest(session.region, shopKeys(request));
    await shop<boolean>(session.region, "shop_forget", { p_session_hash: session.hash });
  }
  return setShopCookies(new NextResponse(null, { status: 204 }), { session: "clear" });
});
