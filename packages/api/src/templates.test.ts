import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RULE_LIMITS } from "@daybell/core";
import { describe, expect, it } from "vitest";
import { buildOpenApi, ROUTES } from "./routes";
import {
  jobInput,
  jobPatch,
  jobRuleResetInput,
  jobTemplateCopyInput,
  jobTemplateInput,
  jobTemplatePatch,
  LIST_FILTER_KEYS,
  orderListQuery,
  splitJobPatch,
} from "./schemas";
import { job, jobProgressResponse } from "./types";

// Job templates, a job's own rules and its Progress (D152, D153, D154; ADR 0029).
const sql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261015000000_job_templates.sql"),
  "utf8",
);
const ID = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";

describe("job template input (D154)", () => {
  it("a name alone starts from today's defaults", () => {
    expect(jobTemplateInput.parse({ name: " School Fall " })).toEqual({
      name: "School Fall",
      qrCardsDaysBefore: null,
      shopOpens: "photosChecked",
      shopOpensDays: null,
      shopClosesDays: null,
      priceListId: null,
      deliverToSchool: false,
      classLabel: "Class",
    });
  });

  it("names the class field in free text: trimmed, 1 to 30 characters (ADR 0030, call 29)", () => {
    expect(jobTemplateInput.parse({ name: "Sports", classLabel: "  Team " }).classLabel).toBe(
      "Team",
    );
    expect(jobTemplatePatch.parse({ classLabel: "Homeroom" })).toEqual({ classLabel: "Homeroom" });
    for (const bad of ["", "   ", "x".repeat(31), "Room\u0007", 4])
      expect(
        jobTemplateInput.safeParse({ name: "A", classLabel: bad }).error?.issues[0]?.message,
      ).toBe("validation.classLabel");
  });

  it("days after picture day go with afterPictureDay, and only with it", () => {
    const bad = jobTemplateInput.safeParse({ name: "A", shopOpens: "afterPictureDay" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]).toMatchObject({
      path: ["shopOpensDays"],
      message: "validation.shopOpensDays",
    });
    expect(jobTemplateInput.safeParse({ name: "A", shopOpensDays: 3 }).success).toBe(false);
    expect(
      jobTemplateInput.safeParse({ name: "A", shopOpens: "afterPictureDay", shopOpensDays: 3 })
        .success,
    ).toBe(true);
  });

  it("keeps the database's limits, whole days only", () => {
    const at = (field: string, value: unknown) =>
      jobTemplateInput.safeParse({ name: "A", [field]: value }).success;
    expect(at("qrCardsDaysBefore", RULE_LIMITS.qrCardsDaysBefore.max)).toBe(true);
    expect(at("qrCardsDaysBefore", RULE_LIMITS.qrCardsDaysBefore.max + 1)).toBe(false);
    expect(at("qrCardsDaysBefore", 2.5)).toBe(false);
    expect(at("shopClosesDays", 0)).toBe(false);
    expect(at("shopClosesDays", 365)).toBe(true);
    expect(at("name", "x".repeat(81))).toBe(false);
    expect(at("name", "   ")).toBe(false);
    expect(at("isDefault", true)).toBe(false);
    // The same limits as the database's checks.
    expect(sql).toContain(
      "qr_cards_days_before smallint check (qr_cards_days_before between 0 and 60)",
    );
    expect(sql).toContain("shop_opens_days smallint check (shop_opens_days between 0 and 180)");
    expect(sql).toContain("shop_closes_days smallint check (shop_closes_days between 1 and 365)");
    expect(sql).toContain(
      "create type public.shop_opens_rule as enum ('photos_checked', 'after_picture_day')",
    );
  });

  it("a change must change something; a copy needs a name", () => {
    expect(jobTemplatePatch.safeParse({}).success).toBe(false);
    expect(jobTemplatePatch.safeParse({ shopClosesDays: null }).success).toBe(true);
    expect(jobTemplateCopyInput.safeParse({}).success).toBe(false);
    expect(jobTemplateCopyInput.parse({ name: "School Fall copy" }).name).toBe("School Fall copy");
  });
});

describe("a job's template and rules (D152)", () => {
  it("a new job may name its template; a change may not", () => {
    const base = { name: "Fall", pictureDay: "2026-10-01", type: "school" };
    expect(jobInput.parse({ ...base, templateId: ID }).templateId).toBe(ID);
    expect(jobPatch.safeParse({ templateId: ID }).success).toBe(false);
  });

  it("a change splits into the job's details and its own rules", () => {
    const patch = jobPatch.parse({ name: "Fall", shopClosesDays: 14, qrCardsDaysBefore: null });
    expect(splitJobPatch(patch)).toEqual({
      details: { name: "Fall" },
      rules: { shopClosesDays: 14, qrCardsDaysBefore: null },
    });
  });

  it("undo names one rule", () => {
    expect(jobRuleResetInput.safeParse({ rule: "shopCloses" }).success).toBe(true);
    expect(jobRuleResetInput.safeParse({ rule: "pictureDay" }).success).toBe(false);
  });

  it("the Job carries its template, rules and changes", () => {
    const shape = job.shape;
    expect(Object.keys(shape)).toEqual(
      expect.arrayContaining(["template", "rules", "changedRules", "openedAt"]),
    );
    expect(jobProgressResponse.shape.progress).toBeDefined();
  });
});

describe("Subjects (D153)", () => {
  it("orders can be listed for one person, by id", () => {
    expect(orderListQuery.parse({ childId: ID }).childId).toBe(ID);
    expect(orderListQuery.safeParse({ childId: "Ava" }).success).toBe(false);
  });

  it("Possible duplicates and No photos are chips people save, as the database takes them", () => {
    expect(LIST_FILTER_KEYS.job_subjects).toMatchObject({ duplicates: false, noPhotos: false });
    expect(sql).toContain(
      "('job_subjects', 'duplicates', false), ('job_subjects', 'noPhotos', false)",
    );
  });
});

describe("the API description", () => {
  const doc = buildOpenApi("https://example.test");
  it("documents the new routes", () => {
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
    for (const key of [
      "GET /job-templates",
      "POST /job-templates",
      "GET /job-templates/{id}",
      "PATCH /job-templates/{id}",
      "DELETE /job-templates/{id}",
      "POST /job-templates/{id}/default",
      "POST /job-templates/{id}/copy",
      "GET /jobs/{id}/progress",
      "GET /jobs/{id}/sales",
      "POST /jobs/{id}/rules/reset",
      "GET /children/{id}/facts",
    ])
      expect(keys).toContain(key);
    for (const name of ["JobTemplate", "JobRules", "JobProgress", "ProgressStep", "JobSales"])
      expect(doc.components.schemas).toHaveProperty(name);
  });
});
