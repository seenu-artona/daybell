import { shopCodeInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { parseBody } from "@/lib/api";
import { newShopToken, shopCookieSession, shopCookieValue, tokenHash } from "@/lib/shop/session";
import {
  admitShopRequest,
  codeLookup,
  codeNotFound,
  type EnterOutcome,
  locked,
  setShopCookies,
  shop,
  shopErrorResponse,
  shopHandle,
} from "@/lib/shop/shop";
import { shopKeys } from "@/lib/shop/throttle";

export const runtime = "nodejs";
// Canadian studios' data is handled in Montréal (D113).
export const preferredRegion = "yul1";

/**
 * POST /api/v1/shop/access — a parent opens a child's gallery with the access code (D24; answers 1–3; ADR 0022). The
 * code is in the body only and never logged. The lockout is checked before the code is looked up; a wrong code, a
 * blank card's code, another region's and anything not a code all get the same 404. A right code sets the session
 * cookie (and forgets this device's earlier session); the device cookie is set the first time, whatever the answer.
 */
export const POST = shopHandle(async (request: Request) => {
  const { code } = await parseBody(request, shopCodeInput);
  const keys = shopKeys(request);
  const lookup = await codeLookup(code);
  await admitShopRequest(lookup.region, keys);
  const previous = shopCookieSession(request);
  const token = newShopToken();
  const result = await shop<EnterOutcome>(lookup.region, "shop_enter_code", {
    p_code_hash: lookup.hash,
    p_pair_key: keys.pair,
    p_ip_key: keys.ip,
    p_session_hash: previous?.region === lookup.region ? previous.hash : null,
    p_new_session_hash: tokenHash(token),
  });
  if (result.outcome === "opened") {
    const res = NextResponse.json({ childId: result.child_id }, { status: 201 });
    return setShopCookies(res, {
      session: { value: shopCookieValue(lookup.region, token) },
      device: keys.newDevice,
    });
  }
  const refusal = result.outcome === "locked" ? locked(result.retry_after) : codeNotFound();
  return setShopCookies(shopErrorResponse(refusal), { device: keys.newDevice });
});
