import { describe, expect, it } from "vitest";
import { CURRENCIES } from "./money";
import {
  canEditPriceLists,
  isSingletonKind,
  MAX_ITEM_PRICE_CENTS,
  MAX_PACKAGE_LINES,
  MAX_SHIPPING_CENTS,
  moveItem,
  orderedItems,
  type PackageLine,
  PRICE_ITEM_KINDS,
  PRINT_SIZES,
  packageContentsProblem,
  priceItemGroup,
  STARTER_PRICE_LIST,
} from "./price-lists";

describe("the starter price list (answer 2; ADR 0019)", () => {
  const items = STARTER_PRICE_LIST.items;
  const ofKind = (kind: string) => items.filter((i) => i.kind === kind);

  it("has 3 packages, the 5 print sizes, a single digital and all digitals", () => {
    expect(ofKind("package").map((i) => i.name)).toEqual(["Package A", "Package B", "Package C"]);
    expect(ofKind("print").map((i) => i.printSize)).toEqual([...PRINT_SIZES]);
    expect(ofKind("digital_single")).toHaveLength(1);
    expect(ofKind("digital_all")).toHaveLength(1);
    expect(items).toHaveLength(10);
    expect(STARTER_PRICE_LIST.name).toBe("Starter price list");
  });

  it("prices everything in whole cents in both currencies, within the bounds", () => {
    for (const currency of CURRENCIES) {
      for (const item of items) {
        expect(Number.isSafeInteger(item.price[currency]), item.name).toBe(true);
        expect(item.price[currency]).toBeGreaterThanOrEqual(0);
        expect(item.price[currency]).toBeLessThanOrEqual(MAX_ITEM_PRICE_CENTS);
      }
      const shipping = STARTER_PRICE_LIST.homeShipping[currency];
      expect(Number.isSafeInteger(shipping) && shipping <= MAX_SHIPPING_CENTS).toBe(true);
    }
  });

  it("gives every package valid contents, and nothing else any contents", () => {
    for (const item of items) {
      if (item.kind === "package")
        expect(packageContentsProblem(item.contents), item.name).toBeNull();
      else expect(item.contents, item.name).toEqual([]);
      expect(item.printSize !== null, item.name).toBe(item.kind === "print");
    }
    // Packages A and B include the digital download of the chosen pose; C doesn't.
    expect(ofKind("package").map((p) => p.contents.some((l) => l.kind === "digital"))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("uses only known kinds and sizes", () => {
    for (const item of items) {
      expect(PRICE_ITEM_KINDS).toContain(item.kind);
      for (const line of item.contents)
        if (line.printSize) expect(PRINT_SIZES).toContain(line.printSize);
    }
  });
});

describe("package contents (answer 3)", () => {
  const p = (size: (typeof PRINT_SIZES)[number], quantity = 1): PackageLine => ({
    kind: "print",
    printSize: size,
    quantity,
  });
  const d: PackageLine = { kind: "digital", printSize: null, quantity: 1 };

  it("needs at least one line, at most 20, and at most one digital (one pose)", () => {
    expect(packageContentsProblem([])).toBe("empty");
    expect(packageContentsProblem([d])).toBeNull();
    expect(packageContentsProblem([p("5x7", 2), d])).toBeNull();
    expect(packageContentsProblem([d, p("4x6"), d])).toBe("twoDigitals");
    expect(packageContentsProblem(Array.from({ length: MAX_PACKAGE_LINES }, () => p("4x6")))).toBe(
      null,
    );
    expect(
      packageContentsProblem(Array.from({ length: MAX_PACKAGE_LINES + 1 }, () => p("4x6"))),
    ).toBe("tooMany");
  });
});

describe("who edits (answer 8)", () => {
  it("is owners and admins only", () => {
    expect(["owner", "admin", "photographer", "staff", ""].map(canEditPriceLists)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("groups and order", () => {
  const items = [
    { id: "d1", kind: "digital_all", position: 1 },
    { id: "p2", kind: "print", position: 5 },
    { id: "k1", kind: "package", position: 9 },
    { id: "p1", kind: "print", position: 2 },
    { id: "k2", kind: "package", position: 3 },
    { id: "d0", kind: "digital_single", position: 7 },
  ] as const;

  it("groups packages, prints and digitals, each in position order", () => {
    expect(priceItemGroup("package")).toBe("packages");
    expect(priceItemGroup("print")).toBe("prints");
    expect(priceItemGroup("digital_single")).toBe("digitals");
    expect(priceItemGroup("digital_all")).toBe("digitals");
    expect(orderedItems(items).map((i) => i.id)).toEqual(["k2", "k1", "p1", "p2", "d1", "d0"]);
    expect(isSingletonKind("digital_all") && isSingletonKind("digital_single")).toBe(true);
    expect(isSingletonKind("print") || isSingletonKind("package")).toBe(false);
  });

  it("moves an item within its group only (buttons, not drag: WCAG 2.5.7)", () => {
    expect(moveItem(items, "k1", -1)).toEqual(["k1", "k2", "p1", "p2", "d1", "d0"]);
    expect(moveItem(items, "p1", 1)).toEqual(["k2", "k1", "p2", "p1", "d1", "d0"]);
    // At a group's edge nothing moves, even when another group is next.
    expect(moveItem(items, "k1", 1)).toEqual(["k2", "k1", "p1", "p2", "d1", "d0"]);
    expect(moveItem(items, "p1", -1)).toEqual(["k2", "k1", "p1", "p2", "d1", "d0"]);
    expect(moveItem(items, "nope", 1)).toEqual(["k2", "k1", "p1", "p2", "d1", "d0"]);
    // The input is never changed.
    expect(items.map((i) => i.id)).toEqual(["d1", "p2", "k1", "p1", "k2", "d0"]);
  });
});
