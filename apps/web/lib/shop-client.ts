import type {
  ApiErrorBody,
  CheckoutStartResponse,
  DownloadLinkResponse,
  ShopCartLineInput,
  ShopCartResponse,
  ShopDrmConfigResponse,
  ShopDrmTokenResponse,
  ShopGalleryResponse,
  ShopOpenedResponse,
  ShopOrderResponse,
  ShopOrdersResponse,
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
      /** The refusal's other fields (e.g. shop.alreadyPaid's orderId). */
      fields: Record<string, string>;
    };

async function call<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<ShopResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/shop${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
  } catch {
    const code = signal?.aborted ? "aborted" : "network";
    return { ok: false, status: 0, code, form: null, retryAfter: null, fields: {} };
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
    fields: error?.fields ?? {},
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GALLERY = /^[0-9a-f]{32}$/;

/** Whether an id from the page's address is a well-formed id (security review L3): nothing else goes into a path. */
export const isShopId = (id: string | undefined | null): id is string => UUID.test(id ?? "");
export const isGalleryId = (id: string | undefined | null): id is string => GALLERY.test(id ?? "");

const path = (id: string) => encodeURIComponent(id);

/** The large view's calls give up with the viewer (its signal) and never wait longer than its whole budget. */
const DRM_FETCH_TIMEOUT_MS = 8000;
const drmSignal = (signal?: AbortSignal) =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(DRM_FETCH_TIMEOUT_MS)])
    : AbortSignal.timeout(DRM_FETCH_TIMEOUT_MS);
const inGallery = (gallery: string) => `?gallery=${encodeURIComponent(gallery)}`;

/** The shop's calls. Everything after opening a code names the gallery (the studio's) it is for (S6). */
export const shopApi = {
  session: () => call<ShopSessionResponse>("/session"),
  open: (code: string) => call<ShopOpenedResponse>("/access", "POST", { code }),
  forget: (gallery: string | null) =>
    call<undefined>(`/session${gallery ? inGallery(gallery) : ""}`, "DELETE"),
  gallery: (gallery: string, childId: string) =>
    call<ShopGalleryResponse>(`/children/${path(childId)}/gallery${inGallery(gallery)}`),
  // The large view's DRM (ADR 0034): whether it is on, and a token per license request.
  drm: (gallery: string, signal?: AbortSignal) =>
    call<ShopDrmConfigResponse>(`/drm${inGallery(gallery)}`, "GET", undefined, drmSignal(signal)),
  drmToken: (gallery: string, childId: string, photoId: string, signal?: AbortSignal) =>
    call<ShopDrmTokenResponse>(
      `/children/${path(childId)}/photos/${path(photoId)}/drm-token${inGallery(gallery)}`,
      "POST",
      undefined,
      drmSignal(signal),
    ),
  priceList: (gallery: string, childId: string) =>
    call<ShopPriceListResponse>(`/children/${path(childId)}/price-list${inGallery(gallery)}`),
  cart: (gallery: string) => call<ShopCartResponse>(`/cart${inGallery(gallery)}`),
  addLine: (
    gallery: string,
    line: Partial<ShopCartLineInput> & Pick<ShopCartLineInput, "childId" | "itemId">,
  ) => call<ShopCartResponse>(`/cart/lines${inGallery(gallery)}`, "POST", line),
  setQuantity: (gallery: string, lineId: string, quantity: number) =>
    call<ShopCartResponse>(`/cart/lines/${path(lineId)}${inGallery(gallery)}`, "PATCH", {
      quantity,
    }),
  removeLine: (gallery: string, lineId: string) =>
    call<ShopCartResponse>(`/cart/lines/${path(lineId)}${inGallery(gallery)}`, "DELETE"),
  setShipping: (gallery: string, method: ShopShippingMethod) =>
    call<ShopCartResponse>(`/cart/shipping${inGallery(gallery)}`, "PUT", { method }),
  // Checkout (ADR 0023): no body; the server prices the bag.
  checkout: (gallery: string) =>
    call<CheckoutStartResponse>(`/checkout${inGallery(gallery)}`, "POST"),
  cancelCheckout: (gallery: string) =>
    call<undefined>(`/checkout/cancel${inGallery(gallery)}`, "POST"),
  orders: (gallery: string) => call<ShopOrdersResponse>(`/orders${inGallery(gallery)}`),
  order: (gallery: string, orderId: string) =>
    call<ShopOrderResponse>(`/orders/${path(orderId)}${inGallery(gallery)}`),
  download: (gallery: string, orderId: string, photoId: string) =>
    call<DownloadLinkResponse>(
      `/orders/${path(orderId)}/downloads/${path(photoId)}${inGallery(gallery)}`,
    ),
  // Orders (ADR 0024): the payer's cancel; no body.
  cancelOrder: (gallery: string, orderId: string) =>
    call<ShopOrderResponse>(`/orders/${path(orderId)}/cancel${inGallery(gallery)}`, "POST"),
  downloadAll: (gallery: string, orderId: string) =>
    saveZip(`/orders/${path(orderId)}/download-all${inGallery(gallery)}`),
};

/**
 * "Download all" (ADR 0024): the zip the server streams, saved through a short-lived object URL under the name the
 * server gave it (the order's reference, never a child's name). A refusal (being prepared, too many) comes back like any
 * other call's.
 */
async function saveZip(url: string): Promise<ShopResult<undefined>> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/shop${url}`, { credentials: "same-origin", cache: "no-store" });
  } catch {
    return { ok: false, status: 0, code: "network", form: null, retryAfter: null, fields: {} };
  }
  if (!res.ok) {
    const error = ((await res.json().catch(() => null)) as ApiErrorBody | null)?.error;
    const retry = Number(res.headers.get("retry-after"));
    return {
      ok: false,
      status: res.status,
      code: error?.code ?? "internal",
      form: error?.fields?.form ?? null,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
      fields: error?.fields ?? {},
    };
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  const objectUrl = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name ?? "silverback.zip";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  return { ok: true, data: undefined };
}

/** Things in a bag (quantities added, unavailable lines too), as the header's count shows them. */
export function bagCount(cart: ShopCartResponse): number {
  return cart.lines.reduce((n, l) => n + l.quantity, 0);
}
