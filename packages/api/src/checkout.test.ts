import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DAYBELL_FEE_BPS,
  HEAD_OFFICE_PROVINCES,
  MAX_DAYBELL_FEE_BPS,
  MIN_CHARGE_CENTS,
  ORDER_STATUSES,
  PST_PROVINCES,
  TAX_REGISTRATION_KINDS,
} from "@daybell/core";
import { describe, expect, it } from "vitest";
import { buildOpenApi, ROUTES } from "./routes";
import { fieldErrors, orderListQuery, taxHeadOfficeInput, taxRegistrationInput } from "./schemas";
import { SHOP_CHECKOUT_NOT_CONFIGURED, SHOP_CONFLICTS, TAX_CONFLICTS } from "./types";

const sql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261013000000_checkout.sql"),
  "utf8",
);
const errors = (r: { success: boolean; error?: unknown }) =>
  r.success ? {} : fieldErrors(r.error as Parameters<typeof fieldErrors>[0]);
const enumValues = (name: string) =>
  [...(sql.match(new RegExp(`${name} as enum \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'(\w+)'/g)].map(
    (m) => m[1],
  );

describe("checkout matches the database (ADR 0023)", () => {
  it("names every refusal the functions raise", () => {
    const raised = new Set(
      [...sql.matchAll(/raise exception '([a-z_]+)' using errcode = 'P0001'/g)].map((m) => m[1]),
    );
    expect([...raised].sort()).toEqual(
      [
        "already_registered",
        "bag_empty",
        "below_minimum",
        "checkout_attached",
        "checkout_limit",
        "checkout_mismatch",
        "choose_delivery",
        "fee_currency",
        "head_office_required",
        "line_unavailable",
        "not_accepting",
        "not_paid",
        "shop_closed",
      ].sort(),
    );
    // Each refusal a parent can meet has words (checkout_attached, mismatch, fee_currency and not_paid are the
    // system's own; checkout_limit is a 429).
    for (const key of [
      "bagEmpty",
      "lineUnavailable",
      "chooseDelivery",
      "notAccepting",
      "belowMinimum",
    ])
      expect(Object.keys(SHOP_CONFLICTS)).toContain(key);
    expect(Object.values(TAX_CONFLICTS)).toEqual([
      "taxes.notConnected",
      "taxes.headOfficeRequired",
      "taxes.alreadyRegistered",
    ]);
    expect(SHOP_CHECKOUT_NOT_CONFIGURED).toBe("shop.checkoutNotConfigured");
  });

  it("has the same statuses, kinds, provinces, fee and minimum", () => {
    expect(enumValues("order_status")).toEqual([...ORDER_STATUSES]);
    expect(enumValues("tax_registration_kind")).toEqual([...TAX_REGISTRATION_KINDS]);
    expect(sql).toContain(`values (${DEFAULT_DAYBELL_FEE_BPS}, 'per_sale')`);
    expect(sql).toContain(`check (daybell_fee_bps between 0 and ${MAX_DAYBELL_FEE_BPS})`);
    expect(sql).toContain("select (p_products * p_bps + 5000) / 10000;");
    expect(sql).toContain(`select ${MIN_CHARGE_CENTS.CAD}::bigint;`);
    expect(MIN_CHARGE_CENTS.USD).toBe(MIN_CHARGE_CENTS.CAD);
    expect(sql).toContain(`province in (${PST_PROVINCES.map((p) => `'${p}'`).join(", ")})`);
    expect(sql).toContain(
      `head_office_province in (${HEAD_OFFICE_PROVINCES.map((p) => `'${p}'`).join(", ")})`,
    );
  });

  it("grants browsers only the studio's order reads under row-level security", () => {
    const toBrowsers = [...sql.matchAll(/grant ([^;]*) to (anon|authenticated)/g)].map((m) => m[1]);
    expect(toBrowsers.join(" ")).not.toMatch(
      /\b(insert|update|delete)\b|shop_\w+\(|complete_order|settle_order/,
    );
  });
});

describe("tax inputs (answer 2; call 3)", () => {
  it("normalizes a GST/HST number and refuses a wrong one", () => {
    expect(taxRegistrationInput.parse({ kind: "gst_hst", number: "123456789 rt 0001" })).toEqual({
      kind: "gst_hst",
      number: "123456789RT0001",
    });
    expect(errors(taxRegistrationInput.safeParse({ kind: "gst_hst", number: "12345" }))).toEqual({
      number: "validation.gstHstNumber",
    });
  });

  it("takes PST in BC, MB or SK only", () => {
    expect(
      taxRegistrationInput.parse({ kind: "pst", province: "BC", number: "pst-1234-5678" }),
    ).toEqual({ kind: "pst", province: "BC", number: "PST-1234-5678" });
    expect(
      errors(taxRegistrationInput.safeParse({ kind: "pst", province: "ON", number: "1" })),
    ).toEqual({ province: "validation.pstProvince" });
    expect(errors(taxRegistrationInput.safeParse({ kind: "vat", number: "1" }))).toEqual({
      kind: "validation.taxKind",
    });
  });

  it("takes a Canadian business address without Quebec, keeping a tidy postal code", () => {
    expect(
      taxHeadOfficeInput.parse({
        line1: " 12 Maple Lane ",
        line2: "",
        city: "Toronto",
        province: "ON",
        postalCode: "m5v2t6",
      }),
    ).toEqual({
      line1: "12 Maple Lane",
      line2: null,
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 2T6",
    });
    expect(
      errors(
        taxHeadOfficeInput.safeParse({
          line1: "",
          city: "Montréal",
          province: "QC",
          postalCode: "12345",
        }),
      ),
    ).toEqual({
      line1: "validation.addressLine",
      province: "validation.province",
      postalCode: "validation.postalCode",
    });
  });

  it("lists a job's orders by its id", () => {
    expect(orderListQuery.safeParse({ jobId: "nope" }).success).toBe(false);
    expect(orderListQuery.parse({ jobId: "a0000000-0000-4000-8000-000000000001" }).limit).toBe(50);
  });
});

describe("checkout, orders and taxes routes", () => {
  const doc = buildOpenApi("https://daybell.test");
  type Op = { "x-access": string; responses: Record<string, unknown> };
  const op = (path: string, method: string) =>
    (doc.paths[path] as Record<string, Op> | undefined)?.[method];

  it("are parents' for checkout, owners' and admins' for orders, the owner's for tax changes", () => {
    for (const [path, method, access] of [
      ["/shop/checkout", "post", "parent"],
      ["/shop/checkout/cancel", "post", "parent"],
      ["/shop/orders", "get", "parent"],
      ["/shop/orders/{orderId}", "get", "parent"],
      ["/shop/orders/{orderId}/downloads/{photoId}", "get", "parent"],
      ["/orders", "get", "owner-admin"],
      ["/orders/{id}", "get", "owner-admin"],
      ["/studio/taxes", "get", "owner-admin"],
      ["/studio/taxes/head-office", "put", "owner"],
      ["/studio/taxes/registrations", "post", "owner"],
      ["/studio/taxes/registrations/{id}", "delete", "owner"],
    ] as const)
      expect(op(path, method)?.["x-access"], `${method} ${path}`).toBe(access);
  });

  it("take no body for checkout: the server prices the bag (ADR 0019)", () => {
    const checkout = ROUTES.find((r) => r.path === "/shop/checkout");
    expect(checkout?.body).toBeUndefined();
  });

  it("describe orders without any parent's email or address, and parents' orders without amounts' secrets", () => {
    for (const name of ["Order", "OrderDetail", "ShopOrder", "ShopOrderSummary", "StudioTaxes"])
      expect(doc.components.schemas).toHaveProperty(name);
    // Property names, not the descriptions (which say what is never there).
    expect(JSON.stringify(doc.components.schemas.Order)).not.toMatch(
      /"(email|address|cardNumber)":/i,
    );
    expect(JSON.stringify(doc.components.schemas.ShopOrder)).not.toMatch(
      /"(email|lastName|shipTo|address)":/,
    );
    expect(doc.tags.map((t) => t.name)).toEqual(expect.arrayContaining(["Orders", "Taxes"]));
  });
});
