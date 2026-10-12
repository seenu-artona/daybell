import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { itemPayload, linesPayload, priceListError, toItem, toSummary } = await import(
  "./price-lists"
);

describe("price list mapping (ADR 0019)", () => {
  it("returns money as whole cents with the list's currency, even when Postgres sends bigint as text", () => {
    const item = toItem(
      {
        id: "i",
        price_list_id: "l",
        kind: "print",
        name: "8×10 print",
        description: null,
        print_size: "8x10",
        price_cents: "2700" as unknown as number,
        position: 3,
        lines: null,
      },
      "CAD",
    );
    expect(item.price).toEqual({ cents: 2700, currency: "CAD" });
    expect(item.contents).toEqual([]);
  });

  it("counts as numbers", () => {
    expect(
      toSummary({
        id: "l",
        name: "S",
        currency: "USD",
        is_default: true,
        packages: "3" as unknown as number,
        prints: 5,
        digitals: 2,
        jobs: "4" as unknown as number,
        selling_jobs: 1,
        updated_at: "t",
      }),
    ).toMatchObject({ counts: { packages: 3, prints: 5, digitals: 2 }, jobs: 4, sellingJobs: 1 });
  });

  it("sends database column names, only for the fields given", () => {
    expect(itemPayload({ priceCents: 0 })).toEqual({ price_cents: 0 });
    expect(itemPayload({ description: null, printSize: "4x6" })).toEqual({
      description: null,
      print_size: "4x6",
    });
    expect(linesPayload(undefined)).toBeNull();
    expect(
      linesPayload([{ kind: "print", printSize: "5x7", quantity: 2 }, { kind: "digital" }]),
    ).toEqual([
      { kind: "print", print_size: "5x7", quantity: 2 },
      { kind: "digital", print_size: null, quantity: 1 },
    ]);
  });

  it("names the database's errors without passing its text on", () => {
    const named = (code: string, message: string) => priceListError({ code, message });
    expect(named("P0001", "item_limit").fields).toEqual({ form: "priceLists.itemLimit" });
    expect(named("P0001", "price_list_limit").fields).toEqual({ form: "priceLists.limit" });
    expect(named("P0001", "job_closed").fields).toEqual({ form: "priceLists.jobClosed" });
    expect(named("P0001", "package_empty").fields).toEqual({ contents: "validation.packageEmpty" });
    expect(
      named(
        "23505",
        'duplicate key value violates unique constraint "price_list_items_one_digital_all"',
      ).fields,
    ).toEqual({ form: "priceLists.digitalTaken" });
    // A package's second digital line is not "the list already has that digital download".
    expect(
      named(
        "23505",
        'duplicate key value violates unique constraint "price_list_package_lines_one_digital"',
      ).fields?.form,
    ).not.toBe("priceLists.digitalTaken");
    expect(named("P0002", "not_found").code).toBe("not_found");
    const other = named("XX000", "secret internals");
    expect([other.code, other.message]).toEqual([
      "internal",
      "Something went wrong on our side. Please try again.",
    ]);
  });
});
