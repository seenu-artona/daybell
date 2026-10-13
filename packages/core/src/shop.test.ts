import { describe, expect, it } from "vitest";
import {
  availableShipping,
  type CartJobFacts,
  type CartLineFacts,
  cartLineProblem,
  cartTotals,
  effectiveShipping,
  formatShopCookie,
  formatShopCookies,
  hasQuantity,
  isLocked,
  keepsOwnAllowance,
  type LockoutKind,
  type LockoutState,
  lockoutLimit,
  lockoutStep,
  mergeQuantity,
  parentDisplayName,
  parseShopCookie,
  parseShopCookies,
  pickCoverPhoto,
  retryAfterSeconds,
  SHOP_LOCK_TRIES,
  SHOP_NETWORK_LOCK_TRIES,
} from "./shop";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);

function fail(
  kind: LockoutKind,
  times: number,
  start: LockoutState | null = null,
  at = T0,
  tripped = false,
) {
  let state = start;
  for (let i = 0; i < times; i++) state = lockoutStep(kind, state, at, tripped);
  return state as LockoutState;
}

describe("lockout (answer 2, call 4)", () => {
  it("locks a network and device for 15 minutes on the 5th wrong code", () => {
    const four = fail("device", SHOP_LOCK_TRIES - 1);
    expect(isLocked(four, T0)).toBe(false);
    const five = lockoutStep("device", four, T0);
    expect(five).toEqual({
      failures: 5,
      windowStart: T0,
      lockedUntil: T0 + 15 * MIN,
      lastAt: T0,
      earlierAt: null,
    });
    expect(isLocked(five, T0 + 15 * MIN - 1)).toBe(true);
    expect(retryAfterSeconds(five, T0)).toBe(900);
    expect(retryAfterSeconds(five, T0 + 15 * MIN - 1)).toBe(1);
  });

  it("is over exactly at the 15 minutes, and then the count starts again", () => {
    const locked = fail("device", 5);
    expect(isLocked(locked, T0 + 15 * MIN)).toBe(false);
    expect(retryAfterSeconds(locked, T0 + 15 * MIN)).toBe(0);
    expect(lockoutStep("device", locked, T0 + 15 * MIN)).toEqual({
      failures: 1,
      windowStart: T0 + 15 * MIN,
      lockedUntil: null,
      lastAt: T0 + 15 * MIN,
      earlierAt: T0,
    });
  });

  it("counts a device's wrong codes for 24 hours", () => {
    const four = fail("device", 4);
    expect(lockoutStep("device", four, T0 + 24 * 60 * MIN - 1).lockedUntil).not.toBeNull();
    expect(lockoutStep("device", four, T0 + 24 * 60 * MIN)).toMatchObject({
      failures: 1,
      lockedUntil: null,
    });
  });

  it("locks a network on its 30th wrong code in 15 minutes, from any device", () => {
    expect(isLocked(fail("net", SHOP_NETWORK_LOCK_TRIES - 1), T0)).toBe(false);
    expect(isLocked(fail("net", SHOP_NETWORK_LOCK_TRIES), T0)).toBe(true);
    const spread = fail("net", 29);
    expect(lockoutStep("net", spread, T0 + 15 * MIN).failures).toBe(1);
  });

  it("counts a network's /24 or /56 to 100 and its /48 to 300, a third of that when tightened", () => {
    expect(lockoutLimit("wide")).toEqual({ tries: 100, windowMs: 15 * MIN });
    expect(lockoutLimit("wider").tries).toBe(300);
    expect([
      lockoutLimit("net", true),
      lockoutLimit("wide", true),
      lockoutLimit("wider", true),
    ]).toEqual([
      { tries: 10, windowMs: 15 * MIN },
      { tries: 30, windowMs: 15 * MIN },
      { tries: 100, windowMs: 15 * MIN },
    ]);
    expect(lockoutLimit("nodevice", true)).toEqual(lockoutLimit("device"));
  });

  it("while the breaker is tripped, tightens only a network that had a wrong code in the hour before its count (R2)", () => {
    // A network with no earlier wrong code keeps its 30, breaker or not.
    expect(isLocked(fail("net", 29, null, T0, true), T0)).toBe(false);
    expect(isLocked(fail("net", 30, null, T0, true), T0)).toBe(true);
    // One that guessed in an earlier window, 20 minutes ago: its new count locks at 10.
    const earlier = fail("net", 3, null, T0 - 20 * MIN);
    const back = fail("net", 9, earlier, T0, true);
    expect(back.earlierAt).toBe(T0 - 20 * MIN);
    expect(isLocked(back, T0)).toBe(false);
    expect(isLocked(lockoutStep("net", back, T0, true), T0)).toBe(true);
    // Not when the breaker isn't tripped, nor when the earlier wrong code is over an hour old.
    expect(isLocked(fail("net", 10, earlier, T0), T0)).toBe(false);
    const old = fail("net", 3, null, T0 - 61 * MIN);
    expect(isLocked(fail("net", 10, old, T0, true), T0)).toBe(false);
    // Devices are never tightened.
    expect(
      isLocked(fail("device", 4, fail("device", 1, null, T0 - 25 * 60 * MIN), T0, true), T0),
    ).toBe(false);
  });

  it("never extends or clears a running lock, even after its window", () => {
    const locked = fail("net", SHOP_NETWORK_LOCK_TRIES);
    const later = lockoutStep("net", locked, T0 + 14 * MIN);
    expect(later.lockedUntil).toBe(T0 + 15 * MIN);
    // A lock set at minute 14 of the window outlives the window: a miss at minute 16 doesn't clear it.
    const late = fail("net", SHOP_NETWORK_LOCK_TRIES - 1);
    const lockedLate = lockoutStep("net", late, T0 + 14 * MIN);
    expect(lockoutStep("net", lockedLate, T0 + 16 * MIN).lockedUntil).toBe(T0 + 29 * MIN);
  });

  it("lets a known device keep its own allowance on a locked network, unless it was locked lately (M3, R2)", () => {
    expect(keepsOwnAllowance({ known: true, lockedAt: null }, T0)).toBe(true);
    expect(keepsOwnAllowance({ known: true, lockedAt: T0 - 24 * 60 * MIN }, T0)).toBe(true);
    expect(keepsOwnAllowance({ known: true, lockedAt: T0 - 60 * MIN }, T0)).toBe(false);
    expect(keepsOwnAllowance({ known: false, lockedAt: null }, T0)).toBe(false);
    expect(keepsOwnAllowance(null, T0)).toBe(false);
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

  it("fails closed when a job with something to deliver is missing (N3)", () => {
    expect(() => availableShipping([line("a", 1000)], [])).toThrow();
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

  it("holds up to 3 sessions, one per studio (S6)", () => {
    const t = (c: string) => c.repeat(43);
    const value = formatShopCookies([
      { region: "ca", token: t("A") },
      { region: "ca", token: t("B") },
    ]);
    expect(value).toBe(`ca.${t("A")}~ca.${t("B")}`);
    expect(parseShopCookies(value)).toEqual([
      { region: "ca", token: t("A") },
      { region: "ca", token: t("B") },
    ]);
    expect(
      parseShopCookies(`ca.${t("A")}~junk~ca.${t("A")}~ca.${t("B")}~ca.${t("C")}~ca.${t("D")}`).map(
        (e) => e.token,
      ),
    ).toEqual([t("A"), t("B"), t("C")]);
    expect(parseShopCookies(undefined)).toEqual([]);
    expect(() =>
      formatShopCookies(["A", "B", "C", "D"].map((c) => ({ region: "ca" as const, token: t(c) }))),
    ).toThrow();
  });
});
