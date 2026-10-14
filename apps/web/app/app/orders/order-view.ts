import {
  ORDER_FULFILMENTS,
  type OrderFulfilment,
  SHOP_SHIPPING_METHODS,
  type ShopShippingMethod,
} from "@daybell/core";

/**
 * The Orders list's view and delivery from the address (D144): only known values (enum words, never search text,
 * D113). Home's To do links here with ?status=paid, or printed and a delivery; anything else is ignored.
 */
export function statusFrom(value: string | null): OrderFulfilment | "" {
  return (ORDER_FULFILMENTS as readonly string[]).includes(value ?? "")
    ? (value as OrderFulfilment)
    : "";
}

export function deliveryFrom(value: string | null): ShopShippingMethod | "" {
  return (SHOP_SHIPPING_METHODS as readonly string[]).includes(value ?? "")
    ? (value as ShopShippingMethod)
    : "";
}

/** A view's address: the page's path with ?status=, or the bare path for All. */
export function orderViewHref(pathname: string, status: OrderFulfilment | ""): string {
  return status ? `${pathname}?status=${status}` : pathname;
}
