import { shopCodeInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { parseBody } from "@/lib/api";
import { enterCode } from "@/lib/shop/codes";
import { admitShopRequest, setShopCookies, shopErrorResponse, shopHandle } from "@/lib/shop/http";
import { shopCookieSessions } from "@/lib/shop/session";
import { codeKeys } from "@/lib/shop/throttle";

export const runtime = "nodejs";
// Canadian studios' data is handled in Montréal (D113).
export const preferredRegion = "yul1";

/**
 * POST /api/v1/shop/access — a parent enters a child's access code (D24; answers 1–3; ADR 0022): it opens the child's
 * gallery, or adds the child to this device's gallery of the same studio (S5, S6). Counted against the network's
 * request budget before the body is read (L7). The code is in the body only and never logged. The lockout is checked
 * before the code is looked up; a wrong code, a blank card's code, another region's and anything not a code all get
 * the same 404. The session cookie keeps the device's galleries that still last; a new device cookie is set when the
 * database issued one, whatever the answer.
 */
export const POST = shopHandle(async (request: Request) => {
  const sessions = shopCookieSessions(request);
  await admitShopRequest(request, sessions);
  const { code } = await parseBody(request, shopCodeInput);
  const result = await enterCode(code, codeKeys(request), sessions);
  const res = result.ok
    ? NextResponse.json(
        { childId: result.childId, galleryId: result.galleryId },
        { status: result.added ? 201 : 200 },
      )
    : shopErrorResponse(result.error);
  const changed =
    result.sessions.length !== sessions.length ||
    result.sessions.some((s, i) => s.hash !== sessions[i]?.hash);
  return setShopCookies(request, res, {
    ...(changed ? { sessions: result.sessions } : {}),
    device: result.device,
  });
});
