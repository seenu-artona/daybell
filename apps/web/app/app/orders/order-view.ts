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

/**
 * A view's address: the page's path with ?status= and ?delivery= (enum words only, D113), or the bare path for All with
 * any delivery. Switching views keeps the delivery; the Delivery menu keeps the view.
 */
export function orderViewHref(
  pathname: string,
  status: OrderFulfilment | "",
  delivery: ShopShippingMethod | "" = "",
): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (delivery) params.set("delivery", delivery);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
