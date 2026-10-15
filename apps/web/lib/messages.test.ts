import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  JOB_CONFLICTS,
  JOB_SHOP_CONFLICTS,
  SHOP_CODE_NOT_FOUND,
  SHOP_CONFLICTS,
  SHOP_LOCKED,
} from "@daybell/api";
import { MILESTONES, ONBOARDING_TASKS, TASK_KEYS, UP_NEXT_REASONS } from "@daybell/core";
import { describe, expect, it } from "vitest";
import enCA from "../messages/en-CA.json";
import enUS from "../messages/en-US.json";

// Words live in the locale files (D96). English is the same in the US and Canada at launch, so both files must have
// the same keys, and every validation key the API can return must have words.
function keys(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("locale files", () => {
  it("en-US and en-CA have the same keys", () => {
    expect(keys(enCA).sort()).toEqual(keys(enUS).sort());
  });

  it("have words for every validation key the API uses", () => {
    const schemas = readFileSync(
      join(__dirname, "..", "..", "..", "packages", "api", "src", "schemas.ts"),
      "utf8",
    );
    const used = new Set([...schemas.matchAll(/"validation\.(\w+)"/g)].map((m) => m[1] as string));
    expect(used.size).toBeGreaterThan(10);
    for (const key of used) expect(Object.keys(enUS.validation), key).toContain(key);
  });

  it("hold whole phrases, not pieces joined in code (D96)", () => {
    for (const messages of [enUS, enCA]) {
      expect(messages.app.checklist.progress).toBe("{done} of {total} done");
      expect(messages.app.checklist.nextTask).toBe("Next: {task}");
      expect(messages.app.home.upNext.row).toBe("{task} · {job}");
    }
  });

  it("have words for every refusal of Start selling, Close shop and Reopen shop (ADR 0021)", () => {
    for (const messages of [enUS, enCA])
      expect(Object.keys(messages.app.job.conflicts).sort()).toEqual(
        Object.keys(JOB_CONFLICTS).sort(),
      );
    expect(enUS.app.job.conflicts.closesAtPassed).toBe(
      "The closing date has passed. Change or remove it first.",
    );
  });

  it("have words for every refusal of Job › Shop (ADR 0033)", () => {
    for (const messages of [enUS, enCA])
      expect(Object.keys(messages.app.job.shop.conflicts).sort()).toEqual(
        Object.keys(JOB_SHOP_CONFLICTS).sort(),
      );
  });

  it("have words for every refusal of the parent shop (ADR 0022)", () => {
    for (const messages of [enUS, enCA]) {
      const refusals = Object.keys(messages.shop.refusals);
      for (const key of [...Object.values(SHOP_CONFLICTS), SHOP_CODE_NOT_FOUND, SHOP_LOCKED])
        expect(refusals, key).toContain(key.slice("shop.".length));
    }
    expect(enUS.shop.refusals.galleryLimit).toBe(
      "This device already has galleries from 3 photographers. Forget one, then try again.",
    );
    expect(enUS.shop.yourChild).toBe("Your child");
    expect(enUS.shop.gallery.closed).toBe("This shop is closed. Contact {studio}.");
    expect(enUS.shop.entry.lostAnswer).toBe("Ask your photographer or school for a new card.");
  });

  it("name every milestone, task, onboarding task and Up next reason (D143)", () => {
    for (const messages of [enUS, enCA]) {
      expect(Object.keys(messages.app.checklist.milestones)).toEqual([...MILESTONES]);
      expect(Object.keys(messages.app.checklist.tasks)).toEqual([
        ...TASK_KEYS,
        "reviewFailedPhotos",
      ]);
      expect(Object.keys(messages.app.home.onboarding.tasks)).toEqual([...ONBOARDING_TASKS]);
      expect(Object.keys(messages.app.home.upNext.reasons)).toEqual([...UP_NEXT_REASONS]);
    }
  });
});

// D155 (ADR 0031): users see the name Silverback. Keys may keep internal names (e.g. daybellFee); the words may not.
function values(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([k, v]) => values(v, prefix ? `${prefix}.${k}` : k));
}

describe("the product's name (D155)", () => {
  it.each([
    ["en-US", enUS],
    ["en-CA", enCA],
  ])("no %s string says Daybell; the brand is Silverback", (_, messages) => {
    const all = values(messages);
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter(([, text]) => /daybell/i.test(text)).map(([key]) => key)).toEqual([]);
    expect(messages.meta.title).toBe("Silverback");
    expect(messages.auth.brand).toBe("Silverback");
    expect(messages.app.brand).toBe("Silverback");
  });
});
