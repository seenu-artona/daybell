import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JOB_STATUSES, JOB_TYPES, ORGANIZATION_KINDS, organizationRequired } from "@daybell/core";
import { describe, expect, it } from "vitest";
import { fromDatabaseError } from "./errors";
import {
  fieldErrors,
  inviteInput,
  jobInput,
  jobPatch,
  listQuery,
  organizationInput,
  organizationPatch,
  passwordUpdateInput,
  signUpInput,
  suggestSlug,
} from "./schemas";

describe("sign-up input", () => {
  const ok = {
    studioName: " North Peak Photo ",
    studioSlug: "North-Peak",
    region: "ca",
    email: " Owner@Example.com ",
  };

  it("normalises email, slug and name", () => {
    expect(signUpInput.parse(ok)).toMatchObject({
      studioName: "North Peak Photo",
      studioSlug: "north-peak",
      email: "owner@example.com",
    });
  });

  it("explains problems field by field, as translatable keys", () => {
    const result = signUpInput.safeParse({ ...ok, email: "nope", studioSlug: "-x", region: "qc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(errors.email).toBe("validation.email");
      expect(Object.keys(errors)).toEqual(
        expect.arrayContaining(["email", "studioSlug", "region"]),
      );
    }
  });

  it("never takes a password at sign-up (no pre-hijacking)", () => {
    expect(Object.keys(signUpInput.shape)).not.toContain("password");
  });
});

describe("passwords", () => {
  it("need 12+ characters", () => {
    expect(passwordUpdateInput.safeParse({ password: "short" }).success).toBe(false);
    expect(passwordUpdateInput.safeParse({ password: "correct horse battery" }).success).toBe(true);
  });
});

describe("invites", () => {
  it("never allows inviting an owner", () => {
    expect(inviteInput.safeParse({ email: "a@b.co", role: "owner" }).success).toBe(false);
    expect(inviteInput.parse({ email: "A@B.co", role: "photographer" }).email).toBe("a@b.co");
  });
});

describe("helpers", () => {
  it("suggests a web address from a studio name", () => {
    expect(suggestSlug("Léa's Photo Co.")).toBe("lea-s-photo-co");
  });

  it("maps database errors to fixed messages, never raw database text", () => {
    expect(
      fromDatabaseError({ code: "42501", message: "Only owners can invite people" }).code,
    ).toBe("forbidden");
    expect(
      fromDatabaseError({ code: "23505", message: 'duplicate key "studios_slug_key"' }).message,
    ).not.toContain("studios_slug_key");
    const unknown = fromDatabaseError({
      code: "XX000",
      message: "relation secret_table does not exist",
    });
    expect(unknown.code).toBe("internal");
    expect(unknown.message).not.toContain("secret_table");
  });
});

describe("organizations", () => {
  const ok = {
    name: " Lincoln Elementary ",
    kind: "school",
    city: "Portland",
    region: "or",
    country: "US",
  };

  it("trims names and upper-cases region codes", () => {
    expect(organizationInput.parse(ok)).toMatchObject({ name: "Lincoln Elementary", region: "OR" });
  });

  it("refuses Quebec with a message on the region field (D131)", () => {
    for (const input of [
      { ...ok, region: "qc", country: "CA" },
      { ...ok, region: "QC", country: null },
      { ...ok, region: "QC", country: "US" },
    ]) {
      const result = organizationInput.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) expect(fieldErrors(result.error).region).toBe("validation.quebec");
    }
    expect(organizationInput.safeParse({ ...ok, region: "ON", country: "CA" }).success).toBe(true);
  });

  it("refuses Quebec postal codes even without a province (D131)", () => {
    for (const postalCode of ["H2X 1Y4", "g1r 4p5", "J4K 2T1"]) {
      const result = organizationInput.safeParse({
        ...ok,
        region: null,
        country: "CA",
        postalCode,
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(fieldErrors(result.error).postalCode).toBe("validation.quebec");
    }
    expect(
      organizationInput.safeParse({ ...ok, region: null, country: "CA", postalCode: "M5V 2T6" })
        .success,
    ).toBe(true);
  });

  it("needs a name and a known kind", () => {
    const result = organizationInput.safeParse({ name: "  ", kind: "church" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error)).toMatchObject({ name: "validation.organizationName" });
      expect(Object.keys(fieldErrors(result.error))).toContain("kind");
    }
  });

  it("patches need at least one known field", () => {
    expect(organizationPatch.safeParse({}).success).toBe(false);
    expect(organizationPatch.safeParse({ studioId: "x" }).success).toBe(false);
    expect(organizationPatch.parse({ city: null })).toEqual({ city: null });
  });
});

describe("jobs", () => {
  const org = "3f6c1a52-8d3e-4b6a-9c1f-2e7d5a9b0c11";

  it("need an organization for school, preschool, sports and dance", () => {
    for (const type of ["school", "preschool", "sports", "dance"]) {
      const result = jobInput.safeParse({ name: "Fall", type });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(fieldErrors(result.error).organizationId).toBe("validation.organizationRequired");
      expect(jobInput.safeParse({ name: "Fall", type, organizationId: org }).success).toBe(true);
    }
  });

  it("let seniors and mini sessions skip the organization", () => {
    expect(jobInput.safeParse({ name: "Minis", type: "mini_session" }).success).toBe(true);
    expect(
      jobInput.safeParse({ name: "Class of 27", type: "seniors", organizationId: null }).success,
    ).toBe(true);
  });

  it("take an optional picture day as a calendar date", () => {
    expect(
      jobInput.parse({ name: "Minis", type: "seniors", pictureDay: "2026-10-14" }).pictureDay,
    ).toBe("2026-10-14");
    expect(
      jobInput.safeParse({ name: "Minis", type: "seniors", pictureDay: "2026-02-30" }).success,
    ).toBe(false);
  });

  it("never change status through a patch", () => {
    expect(jobPatch.safeParse({ status: "selling" }).success).toBe(false);
    expect(jobPatch.safeParse({}).success).toBe(false);
    expect(jobPatch.parse({ name: " New name " })).toEqual({ name: "New name" });
  });

  it("list pages default to 50 and stop at 100", () => {
    expect(listQuery.parse({})).toEqual({ limit: 50 });
    expect(listQuery.parse({ limit: "20" }).limit).toBe(20);
    expect(listQuery.safeParse({ limit: "101" }).success).toBe(false);
    expect(listQuery.safeParse({ cursor: "abc" }).success).toBe(false);
  });
});

describe("job and organization lists match the database", () => {
  const sql = readFileSync(
    join(__dirname, "../../db/supabase/migrations/20261011040000_jobs_and_organizations.sql"),
    "utf8",
  );
  const values = (name: string) =>
    [
      ...(sql.match(new RegExp(`${name} as enum \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'(\w+)'/g),
    ].map((m) => m[1]);

  it("has the same enums", () => {
    expect(values("job_type")).toEqual([...JOB_TYPES]);
    expect(values("job_status")).toEqual([...JOB_STATUSES]);
    expect(values("organization_kind")).toEqual([...ORGANIZATION_KINDS]);
  });

  it("has the same organization rule", () => {
    const optional = JOB_TYPES.filter((t) => !organizationRequired(t)).map((t) => `'${t}'`);
    expect(sql).toContain(`type in (${optional.join(", ")})`);
  });
});
