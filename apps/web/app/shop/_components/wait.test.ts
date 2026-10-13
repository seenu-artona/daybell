import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import enCA from "../../../messages/en-CA.json";
import enUS from "../../../messages/en-US.json";
import { lockedWait } from "./wait";

// A locked parent reads the wait in minutes up to an hour and in hours beyond it (D91, ADR 0022).
describe("lockedWait", () => {
  it("keeps minutes up to an hour, rounding up", () => {
    expect(lockedWait(840)).toEqual({ key: "locked", minutes: 14 });
    expect(lockedWait(1)).toEqual({ key: "locked", minutes: 1 });
    expect(lockedWait(0)).toEqual({ key: "locked", minutes: 1 });
    expect(lockedWait(3600)).toEqual({ key: "locked", minutes: 60 });
  });

  it("falls back to the code lockout's 15 minutes without a Retry-After", () => {
    expect(lockedWait(null)).toEqual({ key: "locked", minutes: 15 });
  });

  it("turns waits over an hour into rounded hours", () => {
    expect(lockedWait(3601)).toEqual({ key: "lockedHours", hours: 1 });
    expect(lockedWait(3 * 3600 - 120)).toEqual({ key: "lockedHours", hours: 3 });
    expect(lockedWait(86_400 - 500)).toEqual({ key: "lockedHours", hours: 24 });
    expect(lockedWait(86_400)).toEqual({ key: "lockedHours", hours: 24 });
  });

  for (const [locale, messages] of [
    ["en-US", enUS],
    ["en-CA", enCA],
  ] as const) {
    it(`reads as whole sentences with plurals in ${locale}`, () => {
      const t = createTranslator({ locale, messages, namespace: "shop.refusals" });
      const say = (seconds: number | null) => {
        const wait = lockedWait(seconds);
        return wait.key === "locked"
          ? t("locked", { minutes: wait.minutes })
          : t("lockedHours", { hours: wait.hours });
      };
      expect(say(30)).toBe("Too many tries. Wait 1 minute and try again.");
      expect(say(840)).toBe("Too many tries. Wait 14 minutes and try again.");
      expect(say(3700)).toBe("Too many tries. Try again in about 1 hour.");
      expect(say(10_700)).toBe("Too many tries. Try again in about 3 hours.");
      expect(say(86_000)).toBe("Too many tries. Try again in about 24 hours.");
    });
  }
});
