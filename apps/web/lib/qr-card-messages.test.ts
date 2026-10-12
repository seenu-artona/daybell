import { describe, expect, it } from "vitest";
import { qrCardProblem } from "./qr-card-messages";

const failed = (code: string, form?: string, skipped?: string) => ({
  ok: false as const,
  status: 409,
  code,
  fields: form ? { form } : {},
  headers: new Headers(skipped ? { "Daybell-Cards-Skipped": skipped } : {}),
});

describe("qrCardProblem (ADR 0015)", () => {
  it("tells the three refusals apart", () => {
    expect(qrCardProblem(failed("conflict", "qrCards.nothingToPrint"))).toEqual({ key: "nothing" });
    expect(qrCardProblem(failed("conflict", "qrCards.doNotPhotograph"))).toEqual({
      key: "doNotPhotograph",
    });
    expect(qrCardProblem(failed("conflict", "qrCards.codesUnreadable", "3"))).toEqual({
      key: "skipped",
      count: 3,
    });
  });

  it("leaves other errors to the general messages", () => {
    expect(qrCardProblem(failed("forbidden"))).toBeNull();
  });
});
