import { ApiError, SHOP_CONFLICTS, shopCodeInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { parseBody } from "@/lib/api";
import { shopCookieSession } from "@/lib/shop/session";
import {
  admitShopRequest,
  codeLookup,
  codeNotFound,
  type EnterOutcome,
  locked,
  sessionRequired,
  setShopCookies,
  shop,
  shopErrorResponse,
  shopHandle,
} from "@/lib/shop/shop";
import { shopKeys } from "@/lib/shop/throttle";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/shop/children — adds a brother or sister by their code (call 1; ADR 0022), through the same lockout as
 * opening a gallery. Up to 5 children of the session's studio. A code of another region can't be this studio's: it is
 * looked up as nothing (a wrong code). Doesn't extend the session.
 */
export const POST = shopHandle(async (request: Request) => {
  const { code } = await parseBody(request, shopCodeInput);
  const keys = shopKeys(request);
  const session = shopCookieSession(request);
  const lookup = await codeLookup(code);
  const region = session?.region ?? lookup.region;
  await admitShopRequest(region, keys);
  if (!session) throw sessionRequired();
  const result = await shop<EnterOutcome>(region, "shop_enter_code", {
    p_code_hash: lookup.region === region ? lookup.hash : null,
    p_pair_key: keys.pair,
    p_ip_key: keys.ip,
    p_session_hash: session.hash,
    p_new_session_hash: null,
  });
  let res: NextResponse;
  switch (result.outcome) {
    case "added":
    case "already":
      res = NextResponse.json(
        { childId: result.child_id },
        { status: result.outcome === "added" ? 201 : 200 },
      );
      break;
    case "limit":
      res = shopErrorResponse(
        new ApiError("conflict", "You can add up to 5 children.", {
          form: SHOP_CONFLICTS.siblingLimit,
        }),
      );
      break;
    case "other_studio":
      res = shopErrorResponse(
        new ApiError("conflict", "This code is from a different photographer.", {
          form: SHOP_CONFLICTS.otherStudio,
        }),
      );
      break;
    case "locked":
      res = shopErrorResponse(locked(result.retry_after));
      break;
    default:
      res = shopErrorResponse(codeNotFound());
  }
  return setShopCookies(res, { device: keys.newDevice });
});
