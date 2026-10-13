import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SHOP_BAG_LINES,
  SHOP_BREAKER_PER_MINUTE,
  SHOP_BREAKER_SHARDS,
  SHOP_CHILD_SESSIONS_PER_DAY,
  SHOP_DEVICE_DAYS,
  SHOP_DEVICE_WINDOW_HOURS,
  SHOP_GALLERY_LIMIT,
  SHOP_KNOWN_DEVICE_COOLDOWN_HOURS,
  SHOP_KNOWN_DEVICES_PER_CHILD_PER_DAY,
  SHOP_LOCK_MINUTES,
  SHOP_LOCK_TRIES,
  SHOP_MAX_QUANTITY,
  SHOP_NETWORK_LOCK_TRIES,
  SHOP_NETWORK_WINDOW_MINUTES,
  SHOP_NEW_DEVICES_PER_DAY,
  SHOP_SESSION_DAYS,
  SHOP_SESSIONS_PER_CHILD,
  SHOP_SHIPPING_METHODS,
  SHOP_SIBLING_LIMIT,
  SHOP_TRIPPED_LOOKBACK_HOURS,
  SHOP_TRIPPED_TRIES,
  SHOP_WIDE_LOCK_TRIES,
  SHOP_WIDER_LOCK_TRIES,
} from "@daybell/core";
import { describe, expect, it } from "vitest";
import { STATUS_FOR } from "./errors";
import { ROUTES } from "./routes";
import {
  fieldErrors,
  shopCartLineInput,
  shopCodeInput,
  shopGalleryQuery,
  shopQuantityInput,
  shopShippingInput,
} from "./schemas";
import { SHOP_CODE_NOT_FOUND, SHOP_CONFLICTS, SHOP_LOCKED } from "./types";

const sql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261012700000_parent_shop.sql"),
  "utf8",
);
const errors = (r: { success: boolean; error?: unknown }) =>
  r.success ? {} : fieldErrors(r.error as Parameters<typeof fieldErrors>[0]);

describe("the parent shop matches the database (ADR 0022)", () => {
  it("names every refusal the functions raise", () => {
    const raised = new Set(
      [...sql.matchAll(/raise exception '([a-z_]+)' using errcode = 'P0001'/g)].map((m) => m[1]),
    );
    expect([...raised].sort()).toEqual(
      [
        "bag_full",
        "item_unavailable",
        "photo_unavailable",
        "school_delivery_off",
        "session_required",
        "shop_closed",
        "sibling_limit",
      ].sort(),
    );
    expect(Object.values(SHOP_CONFLICTS).every((key) => key.startsWith("shop."))).toBe(true);
    expect(Object.keys(SHOP_CONFLICTS).sort()).toEqual(
      [
        "bagFull",
        "closed",
        "galleryLimit",
        "itemUnavailable",
        "photoUnavailable",
        "schoolDeliveryOff",
        "siblingLimit",
        // Checkout (ADR 0023; checkout.test.ts checks them against its migration).
        "alreadyPaid",
        "bagEmpty",
        "belowMinimum",
        "chooseDelivery",
        "downloadPreparing",
        "lineUnavailable",
        "notAccepting",
      ].sort(),
    );
    expect([SHOP_CODE_NOT_FOUND, SHOP_LOCKED]).toEqual(["shop.codeNotFound", "shop.locked"]);
  });

  it("has the same limits and delivery methods", () => {
    expect(sql).toContain(`>= ${SHOP_SIBLING_LIMIT} then`);
    expect(sql).toContain(`now() + interval '${SHOP_SESSION_DAYS} days'`);
    expect(sql).toContain(
      `app.shop_code_failed(v_own_kind, v_own_key, ${SHOP_LOCK_TRIES}, interval '${SHOP_DEVICE_WINDOW_HOURS} hours')`,
    );
    const network = (kind: string, key: string, tripped: number, normal: number) =>
      `app.shop_code_failed('${kind}', ${key}, ${normal}, interval '${SHOP_NETWORK_WINDOW_MINUTES} minutes', case when v_tripped then ${tripped} end)`;
    expect(sql).toContain(
      network("net", "p_net_key", SHOP_TRIPPED_TRIES.net, SHOP_NETWORK_LOCK_TRIES),
    );
    expect(sql).toContain(
      network("wide", "p_wide_key", SHOP_TRIPPED_TRIES.wide, SHOP_WIDE_LOCK_TRIES),
    );
    expect(sql).toContain(
      network("wider", "p_wider_key", SHOP_TRIPPED_TRIES.wider, SHOP_WIDER_LOCK_TRIES),
    );
    expect(sql).toContain(`if v_total < ${SHOP_BREAKER_PER_MINUTE} then`);
    expect(sql).toContain(`lpad(to_hex(p_shard & ${SHOP_BREAKER_SHARDS - 1}), 64, '0')`);
    expect(sql).toContain(`(hashtextextended(p_net_key, 1) & ${SHOP_BREAKER_SHARDS - 1})::integer`);
    expect(sql).toContain(`v.earlier_at > now() - interval '${SHOP_TRIPPED_LOOKBACK_HOURS} hour'`);
    const { ipv4, ipv6 } = SHOP_NEW_DEVICES_PER_DAY;
    expect(sql).toContain(
      `case a.kind when 'issue_net' then case when v_ipv4 then ${ipv4.net} else ${ipv6.net} end`,
    );
    expect(sql).toContain(
      `when 'issue_wide' then case when v_ipv4 then ${ipv4.wide} else ${ipv6.wide} end`,
    );
    expect(sql).toContain(`else ${ipv6.wider} end) then`);
    expect(sql).toContain(
      `a.window_start > now() - interval '24 hours' and a.hits >= ${SHOP_KNOWN_DEVICES_PER_CHILD_PER_DAY}) then`,
    );
    expect(sql).toContain(
      `a.window_start > now() - interval '24 hours' and a.hits >= ${SHOP_CHILD_SESSIONS_PER_DAY};`,
    );
    expect(sql).toContain(
      `a.locked_at <= now() - interval '${SHOP_KNOWN_DEVICE_COOLDOWN_HOURS} hours'`,
    );
    expect(sql).toContain(`x.updated_at < now() - interval '${SHOP_DEVICE_DAYS} days'`);
    expect(sql).toContain(`cardinality(v_live) >= ${SHOP_GALLERY_LIMIT} then`);
    expect(sql).toContain(`cardinality(v_hashes) > ${SHOP_GALLERY_LIMIT}`);
    expect(sql).toContain(
      `limit greatest((select count(*) from others) - (${SHOP_SESSIONS_PER_CHILD} - 1), 0)`,
    );
    expect(sql).toContain(`now() + interval '${SHOP_LOCK_MINUTES} minutes'`);
    expect(sql).toContain(`>= ${SHOP_BAG_LINES}`);
    expect(sql).toContain(`quantity between 1 and ${SHOP_MAX_QUANTITY}`);
    const methods = [
      ...(sql.match(/shop_shipping_method as enum \(([^)]*)\)/)?.[1] ?? "").matchAll(/'(\w+)'/g),
    ].map((m) => m[1]);
    expect(methods).toEqual([...SHOP_SHIPPING_METHODS]);
  });

  it("never grants the shop's functions or tables to browsers", () => {
    expect(sql).not.toMatch(/grant [^;]* to (anon|authenticated)/);
  });
});

describe("shop schemas", () => {
  it("takes a code as typed, trimmed, from the body only", () => {
    expect(shopCodeInput.parse({ code: "  k7qm 4xpa " })).toEqual({ code: "k7qm 4xpa" });
    expect(errors(shopCodeInput.safeParse({ code: " " }))).toEqual({
      code: "validation.accessCode",
    });
    expect(errors(shopCodeInput.safeParse({ code: "x".repeat(41) }))).toEqual({
      code: "validation.accessCode",
    });
    expect(errors(shopCodeInput.safeParse({ code: "K7QM4XPA", studio: "x" }))).toEqual({
      form: "validation.unknownField",
    });
  });

  it("adds a line with a pose and a quantity of 1 by default", () => {
    const ids = {
      childId: "c0000000-0000-4000-8000-000000000001",
      itemId: "e0000000-0000-4000-8000-000000000001",
    };
    expect(shopCartLineInput.parse(ids)).toEqual({ ...ids, photoId: null, quantity: 1 });
    expect(errors(shopCartLineInput.safeParse({ ...ids, quantity: 100 }))).toEqual({
      quantity: "validation.quantity",
    });
    expect(errors(shopQuantityInput.safeParse({ quantity: 0 }))).toEqual({
      quantity: "validation.quantity",
    });
    expect(errors(shopQuantityInput.safeParse({ quantity: 1.5 }))).toEqual({
      quantity: "validation.quantity",
    });
  });

  it("chooses home or school delivery", () => {
    expect(shopShippingInput.parse({ method: "school" })).toEqual({ method: "school" });
    expect(errors(shopShippingInput.safeParse({ method: "drone" }))).toEqual({
      method: "validation.invalid",
    });
  });
});

describe("shop routes", () => {
  const shop = ROUTES.filter((r) => r.group === "Shop");

  it("are all under /shop, for a parent's session (or anyone, to open one)", () => {
    expect(shop.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /shop/access",
      "GET /shop/session",
      "DELETE /shop/session",
      "GET /shop/children/{childId}/gallery",
      "GET /shop/children/{childId}/price-list",
      "GET /shop/cart",
      "POST /shop/cart/lines",
      "PATCH /shop/cart/lines/{id}",
      "DELETE /shop/cart/lines/{id}",
      "PUT /shop/cart/shipping",
      "POST /shop/checkout",
      "POST /shop/checkout/cancel",
      "GET /shop/orders",
      "GET /shop/orders/{orderId}",
      "GET /shop/orders/{orderId}/downloads/{photoId}",
    ]);
    for (const r of shop)
      expect(r.access, r.path).toBe(r.path === "/shop/access" ? "public" : "parent");
  });

  it("all say they are rate limited and may find no region (N11), and the session error is a 401", () => {
    for (const r of shop) {
      expect(r.errors, r.path).toContain("rate_limited");
      expect(r.errors, r.path).toContain("region_unavailable");
    }
    expect(STATUS_FOR.shop_session_required).toBe(401);
  });

  it("name a gallery of the device for everything but opening and listing them (S6)", () => {
    for (const r of shop.filter(
      (r) => r.path !== "/shop/access" && !(r.method === "GET" && r.path === "/shop/session"),
    ))
      expect(r.query, `${r.method} ${r.path}`).toBe(shopGalleryQuery);
    expect(shopGalleryQuery.parse({ gallery: "0123456789abcdef0123456789abcdef" })).toEqual({
      gallery: "0123456789abcdef0123456789abcdef",
    });
    expect(shopGalleryQuery.safeParse({ gallery: "../cart" }).success).toBe(false);
  });
});
