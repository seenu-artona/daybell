import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARRIER_TRACKING_URLS } from "@daybell/config";
import {
  CARRIERS,
  ORDER_FULFILMENTS,
  REFUND_KINDS,
  REFUND_REASONS,
  REFUND_STATUSES,
  STATUS_UNDO_REASONS,
} from "@daybell/core";
import { describe, expect, it } from "vitest";
import { buildOpenApi, ROUTES } from "./routes";
import {
  bulkOrderStatusInput,
  fieldErrors,
  orderListQuery,
  orderStatusInput,
  orderTrackingInput,
  orderUndoInput,
  refundInput,
  salesQuery,
} from "./schemas";
import {
  ACTIVITY_TYPES,
  ledgerTransaction,
  ORDER_CONFLICTS,
  ORDER_DB_REFUSALS,
  SHOP_CONFLICTS,
} from "./types";

const sql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261013100100_orders_and_refunds.sql"),
  "utf8",
);
const enumsSql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261013100000_orders_enums.sql"),
  "utf8",
);
const errors = (r: { success: boolean; error?: unknown }) =>
  r.success ? {} : fieldErrors(r.error as Parameters<typeof fieldErrors>[0]);
const enumValues = (name: string) =>
  [...(sql.match(new RegExp(`${name} as enum \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'(\w+)'/g)].map(
    (m) => m[1],
  );
const ID = "a0000000-0000-4000-8000-000000000001";

describe("orders and refunds match the database (ADR 0024)", () => {
  it("have the same statuses, carriers, refund kinds, statuses and reasons", () => {
    expect(enumValues("order_fulfilment")).toEqual([...ORDER_FULFILMENTS]);
    expect(enumValues("shipping_carrier")).toEqual([...CARRIERS]);
    expect(enumValues("refund_kind")).toEqual([...REFUND_KINDS]);
    expect(enumValues("refund_status")).toEqual([...REFUND_STATUSES]);
    expect(enumValues("refund_reason")).toEqual([...REFUND_REASONS]);
    expect(enumValues("status_undo_reason")).toEqual([...STATUS_UNDO_REASONS]);
    const ledgerKinds = [
      "order_paid",
      ...[...enumsSql.matchAll(/ledger_kind add value '(\w+)'/g)].map((m) => m[1]),
    ];
    expect(ledgerTransaction.shape.kind.options).toEqual(ledgerKinds);
  });

  it("names every refusal the functions raise, each with an API code", () => {
    const raised = new Set(
      [...sql.matchAll(/raise exception '([a-z_]+)' using errcode = 'P0001'/g)].map((m) => m[1]),
    );
    // The parent's (shop.*), the zips' (429), and the system's own (never a person's), with settle_order_fees's as
    // step 10 named them (checkout.test.ts).
    const parents = ["cannot_cancel", "cancel_limit", "zip_limit"];
    const system = [
      "refund_mismatch",
      "not_accepted",
      "not_failed",
      "not_paid",
      "fee_currency",
      "checkout_mismatch",
    ];
    expect([...raised].sort()).toEqual(
      [...Object.keys(ORDER_DB_REFUSALS), ...parents, ...system].sort(),
    );
    for (const key of Object.values(ORDER_DB_REFUSALS))
      expect(ORDER_CONFLICTS[key]).toMatch(/^orders\.[a-zA-Z]+$/);
    expect(Object.values(ORDER_CONFLICTS).every((c) => c.startsWith("orders."))).toBe(true);
    expect(SHOP_CONFLICTS.cannotCancel).toBe("shop.cannotCancel");
    expect(SHOP_CONFLICTS.cancelLimit).toBe("shop.cancelLimit");
  });

  it("grants browsers only the studio's reads under row-level security", () => {
    const toBrowsers = [...sql.matchAll(/grant ([^;]*) to (anon|authenticated)/g)].map((m) => m[1]);
    expect(toBrowsers.join(" ")).not.toMatch(
      /\b(insert|update|delete)\b|mark_order|begin_refund|refund_accepted|shop_\w+\(|purge_/,
    );
  });

  it("has a tracking page for every carrier but other", () => {
    expect(Object.keys(CARRIER_TRACKING_URLS).sort()).toEqual(
      CARRIERS.filter((c) => c !== "other").sort(),
    );
  });
});

describe("order inputs", () => {
  it("lists by job, status and the start of a reference, never a name", () => {
    expect(orderListQuery.parse({ q: " 7kq2-m9 " }).q).toBe("7KQ2M9");
    expect(errors(orderListQuery.safeParse({ q: "Ava Patel" }))).toEqual({
      q: "validation.reference",
    });
    expect(errors(orderListQuery.safeParse({ q: "7KQ2M9XAB" }))).toEqual({
      q: "validation.reference",
    });
    expect(orderListQuery.parse({ status: "printed", jobId: ID })).toMatchObject({
      status: "printed",
      jobId: ID,
    });
    expect(orderListQuery.safeParse({ status: "refunded" }).success).toBe(false);
  });

  it("marks printed and delivered without tracking, shipped with it", () => {
    expect(orderStatusInput.parse({ status: "printed" })).toEqual({ status: "printed" });
    expect(
      orderStatusInput.parse({ status: "shipped", carrier: "ups", trackingNumber: " 1z9 99 " }),
    ).toEqual({ status: "shipped", carrier: "ups", trackingNumber: "1Z9 99", trackingUrl: null });
    expect(errors(orderStatusInput.safeParse({ status: "shipped", carrier: "ups" }))).toEqual({
      trackingNumber: "validation.trackingNumber",
    });
    expect(
      errors(
        orderStatusInput.safeParse({
          status: "shipped",
          carrier: "ups",
          trackingNumber: "1Z999",
          trackingUrl: "https://ups.example/1Z999",
        }),
      ),
    ).toEqual({ trackingUrl: "validation.trackingUrlOther" });
    expect(
      errors(
        orderTrackingInput.safeParse({
          carrier: "other",
          trackingNumber: "TRK1",
          trackingUrl: "http://t.example/1",
        }),
      ),
    ).toEqual({ trackingUrl: "validation.trackingUrl" });
    expect(
      orderTrackingInput.parse({
        carrier: "other",
        trackingNumber: "TRK1",
        trackingUrl: "https://t.example/1",
      }).trackingUrl,
    ).toBe("https://t.example/1");
    expect(errors(orderStatusInput.safeParse({ status: "printed", note: "x" }))).toEqual({
      form: "validation.unknownField",
    });
  });

  it("takes back a step with a reason from the list only", () => {
    expect(orderUndoInput.parse({ reason: "reprint_needed" }).reason).toBe("reprint_needed");
    expect(errors(orderUndoInput.safeParse({ reason: "because" }))).toEqual({
      reason: "validation.undoReason",
    });
  });

  it("bulk-marks 1 to 100 different orders, printed or delivered", () => {
    expect(bulkOrderStatusInput.parse({ orderIds: [ID], status: "delivered" }).orderIds).toEqual([
      ID,
    ]);
    expect(bulkOrderStatusInput.safeParse({ orderIds: [ID, ID], status: "printed" }).success).toBe(
      false,
    );
    expect(bulkOrderStatusInput.safeParse({ orderIds: [ID], status: "shipped" }).success).toBe(
      false,
    );
  });

  it("refunds by line or a custom amount, with a request id, a listed reason and no free text", () => {
    const requestId = "b0000000-0000-4000-8000-000000000001";
    expect(
      refundInput.parse({ requestId, kind: "lines", lines: [{ lineId: ID, quantity: 1 }] }),
    ).toEqual({
      requestId,
      kind: "lines",
      lines: [{ lineId: ID, quantity: 1 }],
      shipping: false,
      reason: null,
    });
    expect(
      refundInput.parse({ requestId, kind: "custom", amountCents: 1000, reason: "quality" }),
    ).toMatchObject({ amountCents: 1000, reason: "quality" });
    expect(errors(refundInput.safeParse({ requestId, kind: "custom", amountCents: 10.5 }))).toEqual(
      { amountCents: "validation.refundAmount" },
    );
    expect(
      errors(
        refundInput.safeParse({
          requestId,
          kind: "lines",
          lines: [
            { lineId: ID, quantity: 1 },
            { lineId: ID, quantity: 1 },
          ],
        }),
      ),
    ).toEqual({ lines: "validation.refundLines" });
    expect(
      errors(refundInput.safeParse({ requestId, kind: "custom", amountCents: 1, note: "x" })),
    ).toEqual({ form: "validation.unknownField" });
    expect(errors(refundInput.safeParse({ requestId, kind: "cancel" }))).toEqual({
      kind: "validation.refundKind",
    });
  });

  it("counts Home's numbers in a real-looking time zone", () => {
    expect(salesQuery.parse({ tz: "America/Toronto" }).tz).toBe("America/Toronto");
    expect(salesQuery.parse({ tz: "UTC" }).tz).toBe("UTC");
    expect(salesQuery.safeParse({ tz: "'; drop table" }).success).toBe(false);
  });
});

describe("order routes", () => {
  const doc = buildOpenApi("https://daybell.test");
  type Op = { "x-access": string; responses: Record<string, { content?: object }> };
  const op = (path: string, method: string) =>
    (doc.paths[path] as Record<string, Op> | undefined)?.[method];

  it("are fulfilment's to fulfil, owners' and admins' to refund and undo, parents' to cancel and zip", () => {
    for (const [path, method, access] of [
      ["/orders", "get", "fulfilment"],
      ["/orders/{id}", "get", "fulfilment"],
      ["/orders/{id}/status", "post", "fulfilment"],
      ["/orders/{id}/tracking", "patch", "fulfilment"],
      ["/orders/status", "post", "fulfilment"],
      ["/orders/{id}/print-files", "get", "fulfilment"],
      ["/studio/sales", "get", "fulfilment"],
      ["/orders/{id}/status/undo", "post", "owner-admin"],
      ["/orders/{id}/refunds", "post", "owner-admin"],
      ["/shop/orders/{orderId}/cancel", "post", "parent"],
      ["/shop/orders/{orderId}/download-all", "get", "parent"],
    ] as const)
      expect(op(path, method)?.["x-access"], `${method} ${path}`).toBe(access);
  });

  it("describe zips as files and refunds without free text", () => {
    expect(op("/orders/{id}/print-files", "get")?.responses["200"]?.content).toHaveProperty(
      "application/zip",
    );
    expect(
      op("/shop/orders/{orderId}/download-all", "get")?.responses["200"]?.content,
    ).toHaveProperty("application/zip");
    expect(JSON.stringify(doc.components.schemas.Refund)).not.toMatch(/"(note|comment|text)":/);
    const refunds = ROUTES.find((r) => r.path === "/orders/{id}/refunds");
    expect(refunds?.description).toMatch(/feesPending/);
  });

  it("show orders in the activity log", () => {
    for (const type of [
      "order.paid",
      "order.printed",
      "order.shipped",
      "order.delivered",
      "order.refunded",
      "order.canceled",
    ])
      expect(ACTIVITY_TYPES).toContain(type);
  });
});
