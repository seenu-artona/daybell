import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCESS_CODE_ALPHABET, JOB_STATUSES, JOB_TYPES } from "@daybell/core";
import { describe, expect, it } from "vitest";
import { fromDatabaseError } from "./errors";
import {
  activityQuery,
  childInput,
  childPatch,
  clientInput,
  clientPatch,
  fieldErrors,
  groupInput,
  inviteInput,
  jobInput,
  jobPatch,
  listQuery,
  passwordUpdateInput,
  qrCardsInput,
  rosterImportInput,
  rosterQuery,
  rosterRow,
  searchInput,
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
  const ok = { name: "Fall", type: "school", pictureDay: "2026-10-14" };

  it("need a name, picture day and type; client and number are optional", () => {
    expect(jobInput.safeParse(ok).success).toBe(true);
    const result = jobInput.safeParse({ name: "", type: "school" });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(fieldErrors(result.error)).toMatchObject({
        name: "validation.jobName",
        pictureDay: "validation.pictureDay",
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

describe("children", () => {
  const ok = { firstName: "  Maya  Rose ", lastName: " Johnson " };

  it("trim names and collapse inner spaces; first and last name are required", () => {
    expect(childInput.parse(ok)).toMatchObject({ firstName: "Maya Rose", lastName: "Johnson" });
    const result = childInput.safeParse({ firstName: "  ", lastName: "" });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(fieldErrors(result.error)).toMatchObject({
        firstName: "validation.firstName",
        lastName: "validation.lastName",
      });
  });

  it("lower-case and check the parent email", () => {
    expect(childInput.parse({ ...ok, parentEmail: " Pat@Example.COM " }).parentEmail).toBe(
      "pat@example.com",
    );
    const bad = childInput.safeParse({ ...ok, parentEmail: "pat at example" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(fieldErrors(bad.error).parentEmail).toBe("validation.email");
  });

  it("limit names to 60, student IDs to 40 and grades to 20 characters", () => {
    expect(childInput.safeParse({ ...ok, firstName: "x".repeat(60) }).success).toBe(true);
    expect(childInput.safeParse({ ...ok, firstName: "x".repeat(61) }).success).toBe(false);
    expect(childInput.safeParse({ ...ok, lastName: "x".repeat(61) }).success).toBe(false);
    expect(childInput.safeParse({ ...ok, studentId: "x".repeat(40) }).success).toBe(true);
    const id = childInput.safeParse({ ...ok, studentId: "x".repeat(41) });
    expect(id.success).toBe(false);
    if (!id.success) expect(fieldErrors(id.error).studentId).toBe("validation.studentId");
    const grade = childInput.safeParse({ ...ok, grade: "x".repeat(21) });
    expect(grade.success).toBe(false);
    if (!grade.success) expect(fieldErrors(grade.error).grade).toBe("validation.grade");
    expect(groupInput.safeParse({ name: "x".repeat(61) }).success).toBe(false);
    expect(groupInput.parse({ name: " Room   4B " }).name).toBe("Room 4B");
  });

  it("refuse control characters and lone surrogates; tabs and line breaks in names become spaces", () => {
    expect(childInput.parse({ ...ok, firstName: "Maya\tRose\r\nAnn" }).firstName).toBe(
      "Maya Rose Ann",
    );
    expect(childInput.parse({ ...ok, lastName: "Zoë 😀" }).lastName).toBe("Zoë 😀");
    const bad: [string, Record<string, unknown>][] = [
      ["firstName", { firstName: "Ma\u0000ya" }],
      ["lastName", { lastName: "John\u0007son" }],
      ["lastName", { lastName: "John\u007Fson" }],
      ["firstName", { firstName: "Maya\uD800" }],
      ["firstName", { firstName: "\uDC00Maya" }],
      ["studentId", { studentId: "S-\u001B1" }],
      ["studentId", { studentId: "S-1\t2" }],
      ["grade", { grade: "4\uDBFF" }],
    ];
    for (const [field, patch] of bad) {
      const result = childInput.safeParse({ ...ok, ...patch });
      expect(result.success, JSON.stringify(patch)).toBe(false);
      if (!result.success) expect(Object.keys(fieldErrors(result.error))).toEqual([field]);
    }
    expect(groupInput.safeParse({ name: "Room\u00004B" }).success).toBe(false);
    expect(rosterRow.safeParse({ ...ok, group: "4B\uD83D" }).success).toBe(false);
  });

  it("patches need a known field and can never touch codes or the school tag", () => {
    expect(childPatch.safeParse({}).success).toBe(false);
    expect(childPatch.safeParse({ accessCode: "K7QM4XPA" }).success).toBe(false);
    expect(childPatch.safeParse({ schoolProvided: false }).success).toBe(false);
    expect(childPatch.safeParse({ jobId: "x" }).success).toBe(false);
    expect(childPatch.parse({ grade: null })).toEqual({ grade: null });
  });
});

describe("roster import", () => {
  const row = { firstName: "Maya", lastName: "Johnson" };

  it("takes 1 to 5,000 rows", () => {
    const none = rosterImportInput.safeParse({ rows: [] });
    expect(none.success).toBe(false);
    if (!none.success) expect(fieldErrors(none.error).rows).toBe("validation.rosterEmpty");
    const many = rosterImportInput.safeParse({ rows: Array(5001).fill(row) });
    expect(many.success).toBe(false);
    if (!many.success) expect(fieldErrors(many.error).rows).toBe("validation.rosterTooLarge");
    expect(rosterImportInput.parse({ rows: Array(5000).fill(row) }).dryRun).toBe(false);
  });

  it("names the bad row and field", () => {
    const rows = [row, row, row, { ...row, parentEmail: "nope" }];
    const result = rosterImportInput.safeParse({ rows, dryRun: true });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(fieldErrors(result.error)["rows.3.parentEmail"]).toBe("validation.email");
  });

  it("allows unmapped opt-outs (null) and blank classes", () => {
    expect(
      rosterRow.parse({ ...row, group: null, doNotPhotograph: null, doNotPublish: true }),
    ).toMatchObject({ group: null, doNotPhotograph: null, doNotPublish: true });
  });

  it("lists pages of up to 500, filtered by class or by no class", () => {
    expect(rosterQuery.parse({})).toEqual({ limit: 200 });
    expect(rosterQuery.safeParse({ limit: "501" }).success).toBe(false);
    expect(rosterQuery.parse({ groupId: "none" }).groupId).toBe("none");
    expect(rosterQuery.safeParse({ groupId: "4B" }).success).toBe(false);
  });
});

describe("roster limits match the database", () => {
  const sql = readFileSync(
    join(__dirname, "../../db/supabase/migrations/20261011070000_roster.sql"),
    "utf8",
  );
  const bound = (column: string) =>
    Number(sql.match(new RegExp(`char_length\\(${column}\\) between 1 and (\\d+)`))?.[1]);
  const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
    schema.safeParse(value).success;
  const base = { firstName: "A", lastName: "B" };

  it("has the same length limits as the check constraints", () => {
    const limits = {
      first_name: bound("first_name"),
      last_name: bound("last_name"),
      student_id: bound("student_id"),
      grade: bound("grade"),
      name: bound("name"),
    };
    expect(limits).toEqual({ first_name: 60, last_name: 60, student_id: 40, grade: 20, name: 60 });
    expect(accepts(childInput, { ...base, firstName: "x".repeat(limits.first_name + 1) })).toBe(
      false,
    );
    expect(accepts(childInput, { ...base, lastName: "x".repeat(limits.last_name + 1) })).toBe(
      false,
    );
    expect(accepts(childInput, { ...base, studentId: "x".repeat(limits.student_id + 1) })).toBe(
      false,
    );
    expect(accepts(childInput, { ...base, grade: "x".repeat(limits.grade + 1) })).toBe(false);
    expect(accepts(groupInput, { name: "x".repeat(limits.name + 1) })).toBe(false);
  });

  it("uses the same duplicate rule and a global code index", () => {
    expect(sql).toContain("regexp_replace(student_id, '\\s', '', 'g')");
    expect(sql).toContain("constraint children_access_code_hash_key unique (access_code_hash)");
  });

  it("stores hashes and encrypted copies, never codes from the alphabet", () => {
    expect(sql).toContain("access_code_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("access_code_ciphertext ~ '^v1\\.[A-Za-z0-9_-]{48}$'");
    expect(sql).not.toContain(ACCESS_CODE_ALPHABET);
  });
});

describe("menu search (ADR 0013)", () => {
  it("trims the text and needs 2 to 100 characters", () => {
    expect(searchInput.parse({ q: "  Lincoln  " })).toEqual({ q: "Lincoln" });
    expect(searchInput.parse({ q: "ab" })).toEqual({ q: "ab" });
    for (const q of ["a", " a ", "", "  "]) {
      const result = searchInput.safeParse({ q });
      expect(result.success).toBe(false);
      if (!result.success) expect(fieldErrors(result.error).q).toBe("validation.searchShort");
    }
    expect(searchInput.safeParse({ q: "x".repeat(100) }).success).toBe(true);
    const long = searchInput.safeParse({ q: "x".repeat(101) });
    expect(long.success).toBe(false);
    expect(searchInput.safeParse({}).success).toBe(false);
  });

  it("filters activity by a job id only", () => {
    expect(activityQuery.parse({})).toEqual({});
    const id = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
    expect(activityQuery.parse({ jobId: id })).toEqual({ jobId: id });
    expect(activityQuery.safeParse({ jobId: "Lincoln" }).success).toBe(false);
  });
});

describe("QR cards (ADR 0015)", () => {
  const id = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
  const other = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";
  const errors = (value: unknown) => {
    const result = qrCardsInput.safeParse(value);
    return result.success ? null : fieldErrors(result.error);
  };

  it("prints the whole job by default, with no blank cards", () => {
    expect(qrCardsInput.parse({})).toEqual({ blankCards: 0 });
  });

  it('takes chosen classes (and "none" for no class), once each', () => {
    expect(qrCardsInput.parse({ groupIds: [id, "none"], blankCards: 3 })).toEqual({
      groupIds: [id, "none"],
      blankCards: 3,
    });
    expect(errors({ groupIds: [] })?.groupIds).toBe("validation.qrCardsGroups");
    expect(errors({ groupIds: [id, id] })?.groupIds).toBe("validation.group");
    expect(errors({ groupIds: ["Room 4"] })).not.toBeNull();
  });

  it("allows 0 to 100 whole blank cards (Seenu, answer 3)", () => {
    expect(qrCardsInput.parse({ blankCards: 100 }).blankCards).toBe(100);
    for (const blankCards of [-1, 101, 1.5, "3"])
      expect(errors({ blankCards })?.blankCards).toBe("validation.blankCards");
  });

  it("prints one child's card alone: no classes and no blank cards with it", () => {
    expect(qrCardsInput.parse({ childId: id })).toEqual({ childId: id, blankCards: 0 });
    expect(errors({ childId: id, groupIds: [other] })?.groupIds).toBe("validation.invalid");
    expect(errors({ childId: id, blankCards: 2 })?.blankCards).toBe("validation.blankCards");
  });
});
