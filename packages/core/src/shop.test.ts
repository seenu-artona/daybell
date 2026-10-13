import { describe, expect, it } from "vitest";
import {
  availableShipping,
  type CartJobFacts,
  type CartLineFacts,
  cartLineProblem,
  cartTotals,
  effectiveShipping,
  formatShopCookie,
  hasQuantity,
  isLocked,
  type LockoutState,
  lockoutStep,
  mergeQuantity,
  parentDisplayName,
  parseShopCookie,
  pickCoverPhoto,
  retryAfterSeconds,
  SHOP_LOCK_TRIES,
  SHOP_NETWORK_LOCK_TRIES,
} from "./shop";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);

function fail(kind: "pair" | "ip", times: number, start: LockoutState | null = null, at = T0) {
  let state = start;
  for (let i = 0; i < times; i++) state = lockoutStep(kind, state, at);
  return state as LockoutState;
}

describe("lockout (answer 2, call 4)", () => {
  it("locks a network and device for 15 minutes on the 5th wrong code", () => {
    const four = fail("pair", SHOP_LOCK_TRIES - 1);
    expect(isLocked(four, T0)).toBe(false);
    const five = lockoutStep("pair", four, T0);
    expect(five).toEqual({ failures: 5, windowStart: T0, lockedUntil: T0 + 15 * MIN });
    expect(isLocked(five, T0 + 15 * MIN - 1)).toBe(true);
    expect(retryAfterSeconds(five, T0)).toBe(900);
    expect(retryAfterSeconds(five, T0 + 15 * MIN - 1)).toBe(1);
  });

  it("is over exactly at the 15 minutes, and then the count starts again", () => {
    const locked = fail("pair", 5);
    expect(isLocked(locked, T0 + 15 * MIN)).toBe(false);
    expect(retryAfterSeconds(locked, T0 + 15 * MIN)).toBe(0);
    expect(lockoutStep("pair", locked, T0 + 15 * MIN)).toEqual({
      failures: 1,
      windowStart: T0 + 15 * MIN,
      lockedUntil: null,
    });
  });

  it("counts a device's wrong codes for 24 hours", () => {
    const four = fail("pair", 4);
    expect(lockoutStep("pair", four, T0 + 24 * 60 * MIN - 1).lockedUntil).not.toBeNull();
    expect(lockoutStep("pair", four, T0 + 24 * 60 * MIN)).toMatchObject({
      failures: 1,
      lockedUntil: null,
    });
  });

  it("locks a network on its 30th wrong code in 15 minutes, from any device", () => {
    expect(isLocked(fail("ip", SHOP_NETWORK_LOCK_TRIES - 1), T0)).toBe(false);
    expect(isLocked(fail("ip", SHOP_NETWORK_LOCK_TRIES), T0)).toBe(true);
    const spread = fail("ip", 29);
    expect(lockoutStep("ip", spread, T0 + 15 * MIN).failures).toBe(1);
  });

  it("is not locked with no wrong codes", () => {
    expect(isLocked(null, T0)).toBe(false);
    expect(retryAfterSeconds(null, T0)).toBe(0);
  });
});

describe("parentDisplayName (call 2)", () => {
  it("is the first name and the last initial", () => {
    expect(parentDisplayName("Ava", "Patel")).toBe("Ava P.");
    expect(parentDisplayName("Ava", "P")).toBe("Ava P.");
    expect(parentDisplayName(" Zoë ", "élise")).toBe("Zoë É.");
    expect(parentDisplayName("Ava", "")).toBe("Ava");
  });
});

describe("pickCoverPhoto (call 3)", () => {
  it("is the first portrait in tagging order, or nothing", () => {
    expect(pickCoverPhoto([{ id: "a" }, { id: "b" }])).toEqual({ id: "a" });
    expect(pickCoverPhoto([])).toBeNull();
  });
});

describe("bag lines", () => {
  it("need a pose, except all digitals, which has none", () => {
    expect(cartLineProblem("package", true, 1)).toBeNull();
    expect(cartLineProblem("print", true, 3)).toBeNull();
    expect(cartLineProblem("digital_single", true, 1)).toBeNull();
    expect(cartLineProblem("digital_all", false, 1)).toBeNull();
    expect(cartLineProblem("package", false, 1)).toBe("needs_pose");
    expect(cartLineProblem("print", false, 1)).toBe("needs_pose");
    expect(cartLineProblem("digital_single", false, 1)).toBe("needs_pose");
    expect(cartLineProblem("digital_all", true, 1)).toBe("no_pose");
  });

  it("are bought 1 to 99 times; digital downloads once", () => {
    expect(cartLineProblem("print", true, 0)).toBe("quantity");
    expect(cartLineProblem("print", true, 100)).toBe("quantity");
    expect(cartLineProblem("print", true, 1.5)).toBe("quantity");
    expect(cartLineProblem("print", true, 99)).toBeNull();
    expect(cartLineProblem("digital_single", true, 2)).toBe("digital_once");
    expect(cartLineProblem("digital_all", false, 2)).toBe("digital_once");
    expect(hasQuantity("package")).toBe(true);
    expect(hasQuantity("digital_all")).toBe(false);
  });

  it("merge the same item and pose into one line, at most 99", () => {
    expect(mergeQuantity("print", 2, 3)).toBe(5);
    expect(mergeQuantity("package", 98, 5)).toBe(99);
    expect(mergeQuantity("digital_single", 1, 1)).toBe(1);
  });
});

const job = (jobId: string, homeShippingCents: number, deliverToSchool: boolean): CartJobFacts => ({
  jobId,
  homeShippingCents,
  deliverToSchool,
});
const line = (
  jobId: string,
  priceCents: number,
  quantity = 1,
  more: Partial<CartLineFacts> = {},
) => ({
  jobId,
  priceCents,
  quantity,
  available: true,
  physical: true,
  ...more,
});

describe("delivery (call 9)", () => {
  it("is one home fee per bag, the highest among the jobs with something to deliver", () => {
    const options = availableShipping(
      [line("a", 1000), line("b", 2000), line("c", 500, 1, { physical: false })],
      [job("a", 895, true), job("b", 1195, true), job("c", 5000, false)],
    );
    expect(options).toEqual({ needed: true, homeCents: 1195, school: true });
  });

  it("offers school only if every such job delivers there", () => {
    const options = availableShipping(
      [line("a", 1000), line("b", 2000)],
      [job("a", 895, true), job("b", 895, false)],
    );
    expect(options.school).toBe(false);
    expect(effectiveShipping("school", options)).toBe("home");
  });

  it("is nothing for a bag of downloads, or of lines no longer available", () => {
    expect(
      availableShipping([line("a", 2500, 1, { physical: false })], [job("a", 895, true)]),
    ).toEqual({ needed: false, homeCents: 0, school: false });
    expect(
      availableShipping([line("a", 2500, 1, { available: false })], [job("a", 895, true)]).needed,
    ).toBe(false);
  });

  it("is what the parent chose when both are offered, or still to choose", () => {
    const both = { needed: true, homeCents: 895, school: true };
    expect(effectiveShipping("school", both)).toBe("school");
    expect(effectiveShipping("home", both)).toBe("home");
    expect(effectiveShipping(null, both)).toBeNull();
    expect(effectiveShipping("home", { needed: false, homeCents: 0, school: false })).toBeNull();
  });
});

describe("cartTotals (whole cents, before tax)", () => {
  it("adds up available lines and the home fee", () => {
    const totals = cartTotals(
      [line("a", 6400, 2), line("a", 2500, 1, { physical: false })],
      [job("a", 895, false)],
      null,
    );
    expect(totals).toEqual({
      count: 3,
      subtotalCents: 15300,
      shipping: { needed: true, homeCents: 895, school: false, method: "home", cents: 895 },
      totalCents: 16195,
    });
  });

  it("charges nothing for school delivery or a bag of downloads", () => {
    expect(cartTotals([line("a", 6400)], [job("a", 895, true)], "school").totalCents).toBe(6400);
    expect(
      cartTotals([line("a", 5900, 1, { physical: false })], [job("a", 895, true)], "home"),
    ).toMatchObject({ totalCents: 5900, shipping: { needed: false, method: null, cents: 0 } });
  });

  it("leaves out lines that can't be bought any more", () => {
    const totals = cartTotals(
      [line("a", 6400), line("a", 9999, 3, { available: false })],
      [job("a", 0, false)],
      null,
    );
    expect(totals.subtotalCents).toBe(6400);
    expect(totals.count).toBe(1);
  });

  it("has no total until delivery is chosen when both are offered", () => {
    const totals = cartTotals([line("a", 6400)], [job("a", 895, true)], null);
    expect(totals.shipping.cents).toBeNull();
    expect(totals.totalCents).toBeNull();
  });
});

describe("the shop cookie", () => {
  const token = `${"A".repeat(42)}_`;
  it("names the region and the token", () => {
    expect(formatShopCookie("ca", token)).toBe(`ca.${token}`);
    expect(parseShopCookie(`ca.${token}`)).toEqual({ region: "ca", token });
    expect(parseShopCookie(`us.${token}`)).toEqual({ region: "us", token });
  });

  it("is no session for anything else", () => {
    for (const bad of [
      undefined,
      null,
      "",
      `eu.${token}`,
      `ca.${token}x`,
      `ca.${"A".repeat(42)}=`,
      token,
    ])
      expect(parseShopCookie(bad)).toBeNull();
    expect(() => formatShopCookie("ca", "short")).toThrow();
  });
});
