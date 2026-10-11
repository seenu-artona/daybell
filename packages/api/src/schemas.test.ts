import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JOB_STATUSES, JOB_TYPES } from "@daybell/core";
import { describe, expect, it } from "vitest";
import { fromDatabaseError } from "./errors";
import {
  clientInput,
  clientPatch,
  fieldErrors,
  inviteInput,
  jobInput,
  jobPatch,
  listQuery,
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

describe("clients", () => {
  const ok = { name: " Lincoln Elementary ", city: "Portland", region: "or", country: "US" };

  it("trims names and upper-cases region and postal codes", () => {
    expect(clientInput.parse({ ...ok, postalCode: "m5v 2t6" })).toMatchObject({
      name: "Lincoln Elementary",
      region: "OR",
      postalCode: "M5V 2T6",
    });
  });

  it("takes an optional contact person and checks the email", () => {
    expect(
      clientInput.parse({
        ...ok,
        contactFirstName: "Pat",
        contactLastName: "Rivera",
        contactPhone: "+1 503 555 0100",
        contactEmail: " Pat@Example.com ",
      }).contactEmail,
    ).toBe("pat@example.com");
    const bad = clientInput.safeParse({ ...ok, contactEmail: "pat at example" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(fieldErrors(bad.error).contactEmail).toBe("validation.email");
    expect(clientInput.safeParse({ ...ok, contactPhone: "1".repeat(31) }).success).toBe(false);
  });

  it("refuses Quebec with a message on the region field (D131)", () => {
    for (const input of [
      { ...ok, region: "qc", country: "CA" },
      { ...ok, region: "QC", country: null },
      { ...ok, region: "QC", country: "US" },
    ]) {
      const result = clientInput.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) expect(fieldErrors(result.error).region).toBe("validation.quebec");
    }
    expect(clientInput.safeParse({ ...ok, region: "ON", country: "CA" }).success).toBe(true);
  });

  it("refuses Quebec postal codes even without a province (D131)", () => {
    for (const postalCode of ["H2X 1Y4", "g1r 4p5", "J4K 2T1"]) {
      const result = clientInput.safeParse({ ...ok, region: null, country: "CA", postalCode });
      expect(result.success).toBe(false);
      if (!result.success) expect(fieldErrors(result.error).postalCode).toBe("validation.quebec");
    }
    expect(
      clientInput.safeParse({ ...ok, region: null, country: "CA", postalCode: "M5V 2T6" }).success,
    ).toBe(true);
  });

  it("needs a name and has no kind", () => {
    const result = clientInput.safeParse({ name: "  " });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).name).toBe("validation.clientName");
    expect(Object.keys(clientInput.parse({ name: "X", kind: "school" }))).not.toContain("kind");
  });

  it("patches need at least one known field", () => {
    expect(clientPatch.safeParse({}).success).toBe(false);
    expect(clientPatch.safeParse({ studioId: "x" }).success).toBe(false);
    expect(clientPatch.parse({ city: null })).toEqual({ city: null });
  });
});

describe("jobs", () => {
  const category = "3f6c1a52-8d3e-4b6a-9c1f-2e7d5a9b0c11";
  const ok = { name: "Fall", type: "school", pictureDay: "2026-10-14", categoryId: category };

  it("need a name, picture day, type and category; client and number are optional", () => {
    expect(jobInput.safeParse(ok).success).toBe(true);
    const result = jobInput.safeParse({ name: "", type: "school" });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(fieldErrors(result.error)).toMatchObject({
        name: "validation.jobName",
        pictureDay: "validation.pictureDay",
        categoryId: "validation.category",
      });
  });

  it("let every job type skip the client", () => {
    for (const type of ["school", "preschool", "sports", "dance", "seniors", "mini_session"])
      expect(jobInput.safeParse({ ...ok, type, clientId: null }).success).toBe(true);
  });

  it("check the picture day, number and subjects expected", () => {
    expect(jobInput.safeParse({ ...ok, pictureDay: "2026-02-30" }).success).toBe(false);
    expect(jobInput.parse({ ...ok, internalNumber: " JOB00002 " }).internalNumber).toBe("JOB00002");
    expect(jobInput.safeParse({ ...ok, internalNumber: "x".repeat(31) }).success).toBe(false);
    expect(jobInput.parse({ ...ok, subjectsExpected: 120 }).subjectsExpected).toBe(120);
    for (const n of [0, 100001, 1.5]) {
      const r = jobInput.safeParse({ ...ok, subjectsExpected: n });
      expect(r.success).toBe(false);
      if (!r.success)
        expect(fieldErrors(r.error).subjectsExpected).toBe("validation.subjectsExpected");
    }
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

describe("job lists match the database", () => {
  const dir = join(__dirname, "../../db/supabase/migrations");
  const sql = readFileSync(join(dir, "20261011040000_jobs_and_organizations.sql"), "utf8");
  const forward = readFileSync(join(dir, "20261011050000_jobs_and_clients.sql"), "utf8");
  const values = (name: string) =>
    [
      ...(sql.match(new RegExp(`${name} as enum \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'(\w+)'/g),
    ].map((m) => m[1]);

  it("has the same enums", () => {
    expect(values("job_type")).toEqual([...JOB_TYPES]);
    expect(values("job_status")).toEqual([...JOB_STATUSES]);
  });

  it("dropped the client kind and the client-required rule", () => {
    expect(forward).toContain("drop column kind");
    expect(forward).toContain("drop constraint jobs_organization_required");
  });
});
