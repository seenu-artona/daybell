/**
 * Products and price lists (Phase 1 step 6; D36, D59, D104, D96; Seenu's answers of Oct 12, 2026; ADR 0019). A studio
 * has many price lists; each job uses one, and new jobs get the studio's default (answer 1). A list holds packages,
 * single prints and digital downloads, priced in whole cents in the studio's currency (D96), before tax.
 *
 * The same lists live as enums and checks in the database (packages/db migration 20261012200000_price_lists.sql); a
 * test in packages/api keeps them in step.
 */
import type { Currency } from "./money";

/** What a price list item is. */
export const PRICE_ITEM_KINDS = ["package", "print", "digital_single", "digital_all"] as const;
export type PriceItemKind = (typeof PRICE_ITEM_KINDS)[number];

/** Print sizes are a fixed list in Phase 1 (Claude's call 8). A wallet sheet is 8 wallets on one print. */
export const PRINT_SIZES = ["4x6", "5x7", "8x10", "11x14", "wallets_8"] as const;
export type PrintSize = (typeof PRINT_SIZES)[number];

/** What a package line holds: prints of one size, or the digital download of the package's one pose (answer 3). */
export const PACKAGE_LINE_KINDS = ["print", "digital"] as const;
export type PackageLineKind = (typeof PACKAGE_LINE_KINDS)[number];

/** Bounds (Claude's call 8): $0 is allowed; at most $10,000 per item and $1,000 home shipping. */
export const MAX_ITEM_PRICE_CENTS = 1_000_000;
export const MAX_SHIPPING_CENTS = 100_000;
/** Limits that keep one studio from filling the database; the database checks them too. */
export const MAX_PRICE_LISTS = 50;
export const MAX_PRICE_LIST_ITEMS = 100;
export const MAX_PACKAGE_LINES = 20;
export const MAX_LINE_QUANTITY = 99;
export const PRICE_LIST_NAME_MAX = 80;
export const ITEM_NAME_MAX = 80;
export const ITEM_DESCRIPTION_MAX = 500;

/** Owners and admins edit price lists; photographers and staff only read them (answer 8). */
export function canEditPriceLists(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** The three groups a price list is shown in, in screen order. */
export const PRICE_ITEM_GROUPS = ["packages", "prints", "digitals"] as const;
export type PriceItemGroup = (typeof PRICE_ITEM_GROUPS)[number];

export function priceItemGroup(kind: PriceItemKind): PriceItemGroup {
  if (kind === "package") return "packages";
  if (kind === "print") return "prints";
  return "digitals";
}

/** A list holds at most one single digital and one "all digitals" (answer 7 defines exactly one of each). */
export function isSingletonKind(kind: PriceItemKind): boolean {
  return kind === "digital_single" || kind === "digital_all";
}

export interface PackageLine {
  kind: PackageLineKind;
  /** Prints only. */
  printSize: PrintSize | null;
  /** 1 to 99 prints; a digital line is always 1. */
  quantity: number;
}

/**
 * Why a package's contents can't be saved, or null if they can: a package holds at least one line, at most 20, and at
 * most one digital (one pose, so one download of it; answer 3). Never "all digitals".
 */
export function packageContentsProblem(
  lines: readonly PackageLine[],
): "empty" | "tooMany" | "twoDigitals" | null {
  if (lines.length === 0) return "empty";
  if (lines.length > MAX_PACKAGE_LINES) return "tooMany";
  if (lines.filter((l) => l.kind === "digital").length > 1) return "twoDigitals";
  return null;
}

/**
 * Items in screen order: each group (packages, prints, digitals) in its own position order. Moving an item up or down
 * moves it within its group; the whole list's order is then sent back as one list of ids.
 */
export function orderedItems<T extends { id: string; kind: PriceItemKind; position: number }>(
  items: readonly T[],
): T[] {
  return PRICE_ITEM_GROUPS.flatMap((group) =>
    items
      .filter((i) => priceItemGroup(i.kind) === group)
      .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

/** The ids of every item after moving one up (-1) or down (+1) within its group; unchanged at a group's edge. */
export function moveItem<T extends { id: string; kind: PriceItemKind; position: number }>(
  items: readonly T[],
  id: string,
  by: -1 | 1,
): string[] {
  const ordered = orderedItems(items);
  const at = ordered.findIndex((i) => i.id === id);
  const item = ordered[at];
  const other = ordered[at + by];
  if (!item || !other || priceItemGroup(other.kind) !== priceItemGroup(item.kind))
    return ordered.map((i) => i.id);
  ordered[at] = other;
  ordered[at + by] = item;
  return ordered.map((i) => i.id);
}

// ── The starter list (answer 2; Claude's call 9: the architect's placeholder prices, for Seenu to change) ───────────

export interface StarterItem {
  kind: PriceItemKind;
  name: string;
  description: string | null;
  printSize: PrintSize | null;
  price: Record<Currency, number>;
  contents: PackageLine[];
}

const print = (printSize: PrintSize, quantity: number): PackageLine => ({
  kind: "print",
  printSize,
  quantity,
});
const digital: PackageLine = { kind: "digital", printSize: null, quantity: 1 };

/**
 * Seeded for every studio when it is created (and backfilled for existing ones), in its region's currency. The
 * database writes the same list from the JSON in the migration; a test in packages/api keeps the two equal. The names
 * become the studio's own data, which it edits like any other.
 */
export const STARTER_PRICE_LIST: {
  name: string;
  homeShipping: Record<Currency, number>;
  items: StarterItem[];
} = {
  name: "Starter price list",
  homeShipping: { USD: 895, CAD: 1195 },
  items: [
    {
      kind: "package",
      name: "Package A",
      description: null,
      printSize: null,
      price: { USD: 6400, CAD: 8500 },
      contents: [print("8x10", 1), print("5x7", 2), print("wallets_8", 1), digital],
    },
    {
      kind: "package",
      name: "Package B",
      description: null,
      printSize: null,
      price: { USD: 4400, CAD: 5900 },
      contents: [print("5x7", 2), print("wallets_8", 1), digital],
    },
    {
      kind: "package",
      name: "Package C",
      description: null,
      printSize: null,
      price: { USD: 2900, CAD: 3900 },
      contents: [print("5x7", 1), print("wallets_8", 1)],
    },
    {
      kind: "print",
      name: "4×6 print",
      description: null,
      printSize: "4x6",
      price: { USD: 1000, CAD: 1300 },
      contents: [],
    },
    {
      kind: "print",
      name: "5×7 print",
      description: null,
      printSize: "5x7",
      price: { USD: 1400, CAD: 1900 },
      contents: [],
    },
    {
      kind: "print",
      name: "8×10 print",
      description: null,
      printSize: "8x10",
      price: { USD: 2000, CAD: 2700 },
      contents: [],
    },
    {
      kind: "print",
      name: "11×14 print",
      description: null,
      printSize: "11x14",
      price: { USD: 3200, CAD: 4300 },
      contents: [],
    },
    {
      kind: "print",
      name: "Wallets (sheet of 8)",
      description: null,
      printSize: "wallets_8",
      price: { USD: 1500, CAD: 2000 },
      contents: [],
    },
    {
      kind: "digital_single",
      name: "Digital download",
      description: "One photo, full resolution, no watermark.",
      printSize: null,
      price: { USD: 2500, CAD: 3300 },
      contents: [],
    },
    {
      kind: "digital_all",
      name: "All digitals",
      description: "Every photo of your child in this job, full resolution, no watermark.",
      printSize: null,
      price: { USD: 5900, CAD: 7900 },
      contents: [],
    },
  ],
};
