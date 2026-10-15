import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JOB_ITEM_KINDS, MAX_JOB_ITEMS } from "@daybell/core";
import { describe, expect, it } from "vitest";
import { buildOpenApi, ROUTES } from "./routes";
import { jobItemInput, jobItemPatch, jobPriceInput } from "./schemas";
import { JOB_SHOP_CONFLICTS, jobShopResponse } from "./types";

const sql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261017000000_job_shop.sql"),
  "utf8",
);

describe("Job › Shop contracts (D157; ADR 0033)", () => {
  it("prices are whole cents, $0 to $10,000, never rounded (D96)", () => {
    expect(jobPriceInput.parse({ priceCents: 7000 })).toEqual({ priceCents: 7000 });
    expect(jobPriceInput.parse({ priceCents: 0 })).toEqual({ priceCents: 0 });
    expect(jobPriceInput.parse({ sold: false })).toEqual({ sold: false });
    for (const priceCents of [12.5, "1250", -1, 1_000_001])
      expect(jobPriceInput.safeParse({ priceCents }).error?.issues[0]?.message).toBe(
        "validation.price",
      );
    expect(jobPriceInput.safeParse({}).error?.issues[0]?.message).toBe(
      "validation.nothingToChange",
    );
    expect(jobPriceInput.safeParse({ priceCents: 100, currency: "CAD" }).success).toBe(false);
    expect(jobPriceInput.safeParse({ sold: "no" }).success).toBe(false);
  });

  it("a job adds packages and prints only (B2), with the price list's item rules", () => {
    expect(
      jobItemInput.safeParse({
        kind: "print",
        name: "Panorama",
        priceCents: 4500,
        printSize: "11x14",
      }).success,
    ).toBe(true);
    expect(
      jobItemInput.safeParse({
        kind: "package",
        name: "Sibling package",
        priceCents: 9900,
        contents: [{ kind: "print", printSize: "8x10", quantity: 1 }, { kind: "digital" }],
      }).success,
    ).toBe(true);
    for (const kind of ["digital_single", "digital_all"])
      expect(jobItemInput.safeParse({ kind, name: "Download", priceCents: 100 }).success).toBe(
        false,
      );
    expect(
      jobItemInput.safeParse({ kind: "print", name: "No size", priceCents: 100 }).success,
    ).toBe(false);
    expect(
      jobItemInput.safeParse({ kind: "package", name: "Empty", priceCents: 100 }).success,
    ).toBe(false);
    expect(
      jobItemInput.safeParse({
        kind: "print",
        name: "Ev\u202Eil",
        priceCents: 100,
        printSize: "5x7",
      }).error?.issues[0]?.message,
    ).toBe("validation.itemName");
    expect(
      jobItemInput.safeParse({ kind: "print", name: "Half", priceCents: 1.5, printSize: "5x7" })
        .error?.issues[0]?.message,
    ).toBe("validation.price");
  });

  it("a job's product changes field by field, or is switched off; never its kind", () => {
    expect(jobItemPatch.parse({ sold: false })).toEqual({ sold: false });
    expect(jobItemPatch.parse({ priceCents: 100 })).toEqual({ priceCents: 100 });
    expect(jobItemPatch.safeParse({ kind: "print" }).success).toBe(false);
    expect(jobItemPatch.safeParse({}).success).toBe(false);
  });

  it("the kinds and the limit are the migration's", () => {
    expect(sql).toContain(
      `kind public.price_item_kind not null check (kind in (${JOB_ITEM_KINDS.map((k) => `'${k}'`).join(", ")}))`,
    );
    expect(sql).toContain(`) >= ${MAX_JOB_ITEMS} then\n      raise exception 'item_limit'`);
  });

  it("names every refusal the database can give (job_closed, not_on_list, item_limit)", () => {
    expect(Object.values(JOB_SHOP_CONFLICTS)).toEqual([
      "jobShop.jobClosed",
      "jobShop.notOnList",
      "jobShop.itemLimit",
    ]);
    for (const name of ["job_closed", "not_on_list", "item_limit"])
      expect(sql).toContain(`'${name}'`);
  });

  it("describes the shop's routes: everyone reads, owners and admins change", () => {
    const shop = ROUTES.filter((r) => r.path.startsWith("/jobs/{id}/shop"));
    expect(shop.map((r) => `${r.method} ${r.path} ${r.access}`)).toEqual([
      "GET /jobs/{id}/shop signed-in",
      "PATCH /jobs/{id}/shop/prices/{itemId} owner-admin",
      "DELETE /jobs/{id}/shop/prices/{itemId} owner-admin",
      "POST /jobs/{id}/shop/items owner-admin",
      "PATCH /jobs/{id}/shop/items/{itemId} owner-admin",
      "DELETE /jobs/{id}/shop/items/{itemId} owner-admin",
    ]);
    const doc = buildOpenApi("https://example.test");
    expect(doc.components.schemas).toHaveProperty("JobShop");
    expect(doc.components.schemas).toHaveProperty("JobShopRow");
    expect(doc.paths["/jobs/{id}/shop/prices/{itemId}"]).toHaveProperty("patch");
  });

  it("money leaves as whole cents with its currency; a job's own product has no list price", () => {
    const row = {
      itemId: "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
      source: "job",
      kind: "print",
      name: "Panorama",
      description: null,
      printSize: "11x14",
      contents: [],
      listPrice: null,
      price: { cents: 4500, currency: "CAD" },
      sold: true,
      changed: true,
    };
    const shop = {
      jobId: "1b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
      priceList: {
        id: "2b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
        name: "Starter",
        homeShipping: { cents: 1195, currency: "CAD" },
      },
      rows: [row],
      changes: 1,
    };
    expect(jobShopResponse.safeParse({ shop }).success).toBe(true);
    expect(
      jobShopResponse.safeParse({
        shop: { ...shop, rows: [{ ...row, price: { cents: 45.5, currency: "CAD" } }] },
      }).success,
    ).toBe(false);
  });
});
