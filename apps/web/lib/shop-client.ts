import type {
  ApiErrorBody,
  ShopCartLineInput,
  ShopCartResponse,
  ShopGalleryResponse,
  ShopOpenedResponse,
  ShopPriceListResponse,
  ShopSessionResponse,
} from "@daybell/api";
import type { ShopShippingMethod } from "@daybell/core";

/**
 * The parent shop's calls to /api/v1/shop (D92; ADR 0022), from the browser. The session lives in an httpOnly cookie
 * the browser sends by itself; access codes go in request bodies only, never in a URL.
 */
export type ShopResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      code: string;
      form: string | null;
      /** Retry-After, in seconds, when the server sent one. */
      retryAfter: number | null;
    };

async function call<T>(path: string, method = "GET", body?: unknown): Promise<ShopResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/shop${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, code: "network", form: null, retryAfter: null };
  }
  if (res.ok) return { ok: true, data: (res.status === 204 ? undefined : await res.json()) as T };
  const error = ((await res.json().catch(() => null)) as ApiErrorBody | null)?.error;
  const retry = Number(res.headers.get("retry-after"));
  return {
    ok: false,
    status: res.status,
    code: error?.code ?? "internal",
    form: error?.fields?.form ?? null,
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
  };
}

export const shopApi = {
  session: () => call<ShopSessionResponse>("/session"),
  open: (code: string) => call<ShopOpenedResponse>("/access", "POST", { code }),
  addChild: (code: string) => call<ShopOpenedResponse>("/children", "POST", { code }),
  forget: () => call<undefined>("/session", "DELETE"),
  gallery: (childId: string) => call<ShopGalleryResponse>(`/children/${childId}/gallery`),
  priceList: (childId: string) => call<ShopPriceListResponse>(`/children/${childId}/price-list`),
  cart: () => call<ShopCartResponse>("/cart"),
  addLine: (line: Partial<ShopCartLineInput> & Pick<ShopCartLineInput, "childId" | "itemId">) =>
    call<ShopCartResponse>("/cart/lines", "POST", line),
  setQuantity: (lineId: string, quantity: number) =>
    call<ShopCartResponse>(`/cart/lines/${lineId}`, "PATCH", { quantity }),
  removeLine: (lineId: string) => call<ShopCartResponse>(`/cart/lines/${lineId}`, "DELETE"),
  setShipping: (method: ShopShippingMethod) =>
    call<ShopCartResponse>("/cart/shipping", "PUT", { method }),
};

/** Things in a bag (quantities added, unavailable lines too), as the header's count shows them. */
export function bagCount(cart: ShopCartResponse): number {
  return cart.lines.reduce((n, l) => n + l.quantity, 0);
}
