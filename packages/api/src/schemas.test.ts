import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCESS_CODE_ALPHABET,
  JOB_STATUSES,
  JOB_TYPES,
  PRICE_ITEM_KINDS,
  PRINT_SIZES,
  STARTER_PRICE_LIST,
} from "@daybell/core";
import { describe, expect, it } from "vitest";
import { fromDatabaseError } from "./errors";
import {
  activityQuery,
  childInput,
  childPatch,
  claimBlankCardInput,
  classInput,
  clientInput,
  clientPatch,
  confirmPhotosInput,
  fieldErrors,
  inviteInput,
  isPriceText,
  itemKindIssues,
  itemOrderInput,
  jobInput,
  jobPatch,
  listQuery,
  movePhotosInput,
  passwordUpdateInput,
  priceListInput,
  priceListItemInput,
  priceListItemPatch,
  priceListPatch,
  qrCardsInput,
  rosterImportInput,
  rosterQuery,
  rosterRow,
  searchInput,
  signUpInput,
  suggestSlug,
  taggingPhotosQuery,
  undoCardPhotosInput,
  uploadBatchInput,
  workerResultInput,
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
    expect(classInput.safeParse({ name: "x".repeat(61) }).success).toBe(false);
    expect(classInput.parse({ name: " Room   4B " }).name).toBe("Room 4B");
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
    expect(classInput.safeParse({ name: "Room\u00004B" }).success).toBe(false);
    expect(rosterRow.safeParse({ ...ok, class: "4B\uD83D" }).success).toBe(false);
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
      rosterRow.parse({ ...row, class: null, doNotPhotograph: null, doNotPublish: true }),
    ).toMatchObject({ class: null, doNotPhotograph: null, doNotPublish: true });
  });

  it("lists pages of up to 500, filtered by class or by no class", () => {
    expect(rosterQuery.parse({})).toEqual({ limit: 200 });
    expect(rosterQuery.safeParse({ limit: "501" }).success).toBe(false);
    expect(rosterQuery.parse({ classId: "none" }).classId).toBe("none");
    expect(rosterQuery.safeParse({ classId: "4B" }).success).toBe(false);
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
    expect(accepts(classInput, { name: "x".repeat(limits.name + 1) })).toBe(false);
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
    expect(qrCardsInput.parse({ classIds: [id, "none"], blankCards: 3 })).toEqual({
      classIds: [id, "none"],
      blankCards: 3,
    });
    expect(errors({ classIds: [] })?.classIds).toBe("validation.qrCardsClasses");
    expect(errors({ classIds: [id, id] })?.classIds).toBe("validation.class");
    expect(errors({ classIds: ["Room 4"] })).not.toBeNull();
  });

  it("allows 0 to 100 whole blank cards (Seenu, answer 3)", () => {
    expect(qrCardsInput.parse({ blankCards: 100 }).blankCards).toBe(100);
    for (const blankCards of [-1, 101, 1.5, "3"])
      expect(errors({ blankCards })?.blankCards).toBe("validation.blankCards");
  });

  it("prints one child's card alone: no classes and no blank cards with it", () => {
    expect(qrCardsInput.parse({ childId: id })).toEqual({ childId: id, blankCards: 0 });
    expect(errors({ childId: id, classIds: [other] })?.classIds).toBe("validation.invalid");
    expect(errors({ childId: id, blankCards: 2 })?.blankCards).toBe("validation.blankCards");
  });
});

describe("QR tagging and review (ADR 0018)", () => {
  const photo = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";
  const child = "2d8b9e3a-4c9f-4e77-9f2a-5b3c4d5e6f70";

  it("moves 1 to 500 distinct photos to a child, a class photo set or Leftovers", () => {
    expect(
      movePhotosInput.parse({ photoIds: [photo], target: { kind: "child", childId: child } }),
    ).toEqual({ photoIds: [photo], target: { kind: "child", childId: child } });
    expect(
      movePhotosInput.safeParse({ photoIds: [photo], target: { kind: "leftovers" } }).success,
    ).toBe(true);
    for (const bad of [
      { photoIds: [], target: { kind: "leftovers" } },
      { photoIds: [photo, photo], target: { kind: "leftovers" } },
      { photoIds: [photo], target: { kind: "card" } },
      { photoIds: [photo], target: { kind: "child" } },
      { photoIds: ["Maya Johnson.jpg"], target: { kind: "leftovers" } },
    ])
      expect(movePhotosInput.safeParse(bad).success).toBe(false);
  });

  it("undoes card photo marks for 1 to 500 distinct photos (answer 12)", () => {
    expect(undoCardPhotosInput.parse({ photoIds: [photo] })).toEqual({ photoIds: [photo] });
    expect(undoCardPhotosInput.safeParse({ photoIds: [] }).success).toBe(false);
    expect(undoCardPhotosInput.safeParse({ photoIds: [photo, photo] }).success).toBe(false);
    expect(undoCardPhotosInput.safeParse({ photoIds: ["not-a-uuid"] }).success).toBe(false);
  });

  it("confirms photos as they are by default, or as card photos", () => {
    expect(confirmPhotosInput.parse({ photoIds: [photo] })).toEqual({
      photoIds: [photo],
      asCard: false,
    });
    expect(confirmPhotosInput.parse({ photoIds: [photo], asCard: true }).asCard).toBe(true);
  });

  it("names a blank card's child with the roster's own name rules", () => {
    expect(claimBlankCardInput.parse({ firstName: " Zoe ", lastName: "New" })).toMatchObject({
      firstName: "Zoe",
      lastName: "New",
    });
    expect(claimBlankCardInput.safeParse({ firstName: "", lastName: "New" }).success).toBe(false);
  });

  it("lists photos by place, with an id only for a child or a blank card", () => {
    expect(taggingPhotosQuery.safeParse({ place: "leftovers" }).success).toBe(true);
    expect(taggingPhotosQuery.safeParse({ place: "child", id: child }).success).toBe(true);
    expect(taggingPhotosQuery.safeParse({ place: "child" }).success).toBe(false);
    expect(taggingPhotosQuery.safeParse({ place: "flagged", id: child }).success).toBe(false);
    expect(taggingPhotosQuery.safeParse({ place: "unlinkedCards" }).success).toBe(true);
    expect(taggingPhotosQuery.safeParse({ place: "unlinkedCards", id: child }).success).toBe(false);
    // Class photo sets are gone (D156): group photos are listed by group.
    expect(taggingPhotosQuery.safeParse({ place: "classSet", id: child }).success).toBe(false);
  });

  it("takes the worker's reading of a card: a code only for a card, never anything else", () => {
    const ready = { status: "ready", attempt: 1, width: 1, height: 1, capturedAt: null };
    // A ready result always says what was read (security review 2): an old worker's message is refused and retried.
    expect(workerResultInput.safeParse(ready).success).toBe(false);
    expect(workerResultInput.safeParse({ ...ready, qr: null }).success).toBe(false);
    expect(workerResultInput.safeParse({ ...ready, qr: { kind: "none" } }).success).toBe(true);
    expect(
      workerResultInput.safeParse({
        ...ready,
        qr: { kind: "card", cardCode: "0123456789ABCDEFGHJK" },
      }).success,
    ).toBe(true);
    expect(workerResultInput.safeParse({ ...ready, qr: { kind: "card" } }).success).toBe(false);
    expect(
      workerResultInput.safeParse({ ...ready, qr: { kind: "card", cardCode: "Maya Johnson" } })
        .success,
    ).toBe(false);
    expect(workerResultInput.safeParse({ ...ready, qr: { kind: "unreadable" } }).success).toBe(
      true,
    );
  });

  it("starts an individual upload (by default, optionally adding everyone to a group) or one group's photos", () => {
    expect(uploadBatchInput.parse({})).toEqual({ kind: "individual" });
    expect(uploadBatchInput.parse({ addToGroupId: child })).toEqual({
      kind: "individual",
      addToGroupId: child,
    });
    expect(uploadBatchInput.parse({ kind: "group", groupId: child })).toEqual({
      kind: "group",
      groupId: child,
    });
    // Group photos need their group; individual photos name none (an old class-photo body is refused).
    expect(uploadBatchInput.safeParse({ kind: "group" }).success).toBe(false);
    expect(uploadBatchInput.safeParse({ groupId: child }).success).toBe(false);
    expect(
      uploadBatchInput.safeParse({ kind: "group", groupId: child, addToGroupId: child }).success,
    ).toBe(false);
    expect(uploadBatchInput.safeParse({ kind: "group", groupId: "Choir" }).success).toBe(false);
  });

  it("moves photos to a person or Leftovers only, never a class photo set (C8)", () => {
    expect(
      movePhotosInput.safeParse({ photoIds: [child], target: { kind: "leftovers" } }).success,
    ).toBe(true);
    expect(
      movePhotosInput.safeParse({ photoIds: [child], target: { kind: "classSet", groupId: child } })
        .success,
    ).toBe(false);
  });
});

describe("price lists (ADR 0019)", () => {
  const ID = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
  const errors = (r: { success: boolean; error?: unknown }) =>
    r.success ? {} : fieldErrors(r.error as Parameters<typeof fieldErrors>[0]);

  it("names a new list, blank or copied, and never takes a currency", () => {
    expect(priceListInput.parse({ name: " Spring " })).toEqual({ name: "Spring" });
    expect(priceListInput.parse({ name: "Copy", copyFromId: ID }).copyFromId).toBe(ID);
    expect(errors(priceListInput.safeParse({ name: "" }))).toEqual({
      name: "validation.priceListName",
    });
    expect(priceListInput.safeParse({ name: "x".repeat(81) }).success).toBe(false);
    expect(priceListInput.safeParse({ name: "Spring", currency: "CAD" }).success).toBe(false);
    expect(errors(priceListInput.safeParse({ name: "S", copyFromId: "x" }))).toEqual({
      copyFromId: "validation.priceList",
    });
  });

  it("takes whole cents only: never 12.5, a string, a negative or too much (D96)", () => {
    expect(priceListPatch.parse({ homeShippingCents: 895 })).toEqual({ homeShippingCents: 895 });
    expect(priceListPatch.parse({ homeShippingCents: 0 })).toEqual({ homeShippingCents: 0 });
    for (const bad of [12.5, "1250", -1, 100001, Number.NaN, null])
      expect(errors(priceListPatch.safeParse({ homeShippingCents: bad })), String(bad)).toEqual({
        homeShippingCents: "validation.shipping",
      });
    const item = { kind: "print", name: "8×10", printSize: "8x10" } as const;
    expect(priceListItemInput.parse({ ...item, priceCents: 0 }).priceCents).toBe(0);
    expect(priceListItemInput.parse({ ...item, priceCents: 1_000_000 }).priceCents).toBe(1_000_000);
    for (const bad of [12.5, "2500", -1, 1_000_001])
      expect(
        errors(priceListItemInput.safeParse({ ...item, priceCents: bad })),
        String(bad),
      ).toEqual({
        priceCents: "validation.price",
      });
  });

  it("patches need a known field and never change the kind or the currency", () => {
    expect(priceListPatch.safeParse({}).success).toBe(false);
    expect(priceListPatch.safeParse({ currency: "USD" }).success).toBe(false);
    expect(priceListItemPatch.safeParse({}).success).toBe(false);
    expect(priceListItemPatch.safeParse({ kind: "package" }).success).toBe(false);
    expect(priceListItemPatch.parse({ name: " B ", priceCents: 1 })).toEqual({
      name: "B",
      priceCents: 1,
    });
    expect(priceListItemPatch.parse({ description: null })).toEqual({ description: null });
  });

  it("needs a size for a print and contents for a package, and neither on anything else", () => {
    const base = { name: "X", priceCents: 100 };
    expect(errors(priceListItemInput.safeParse({ ...base, kind: "print" }))).toEqual({
      printSize: "validation.printSize",
    });
    expect(
      errors(priceListItemInput.safeParse({ ...base, kind: "print", printSize: "9x12" })),
    ).toEqual({ printSize: "validation.printSize" });
    expect(errors(priceListItemInput.safeParse({ ...base, kind: "package" }))).toEqual({
      contents: "validation.packageEmpty",
    });
    expect(
      errors(priceListItemInput.safeParse({ ...base, kind: "digital_single", printSize: "4x6" })),
    ).toEqual({ printSize: "validation.printSize" });
    expect(
      errors(
        priceListItemInput.safeParse({
          ...base,
          kind: "digital_all",
          contents: [{ kind: "digital" }],
        }),
      ),
    ).toEqual({ contents: "validation.invalid" });
    expect(priceListItemInput.safeParse({ ...base, kind: "digital_all" }).success).toBe(true);
    // A patch is checked against the stored kind by the server.
    expect(itemKindIssues("print", { contents: [] }, false)).toEqual([
      { path: "contents", message: "validation.invalid" },
    ]);
    expect(itemKindIssues("print", {}, false)).toEqual([]);
    expect(itemKindIssues("package", { printSize: "4x6" }, false)).toEqual([
      { path: "printSize", message: "validation.printSize" },
    ]);
  });

  it("takes 1 to 20 package lines, with one digital at most and 1 to 99 prints a line (answer 3)", () => {
    const pkg = { kind: "package", name: "A", priceCents: 6400 } as const;
    const ok = priceListItemInput.parse({
      ...pkg,
      contents: [{ kind: "print", printSize: "8x10", quantity: 1 }, { kind: "digital" }],
    });
    expect(ok.contents).toHaveLength(2);
    expect(errors(priceListItemInput.safeParse({ ...pkg, contents: [] }))).toEqual({
      contents: "validation.packageEmpty",
    });
    expect(
      errors(
        priceListItemInput.safeParse({
          ...pkg,
          contents: [{ kind: "digital" }, { kind: "digital" }],
        }),
      ),
    ).toEqual({ contents: "validation.packageDigitals" });
    expect(
      priceListItemInput.safeParse({
        ...pkg,
        contents: Array.from({ length: 21 }, () => ({
          kind: "print",
          printSize: "4x6",
          quantity: 1,
        })),
      }).success,
    ).toBe(false);
    for (const quantity of [0, 100, 1.5])
      expect(
        errors(
          priceListItemInput.safeParse({
            ...pkg,
            contents: [{ kind: "print", printSize: "4x6", quantity }],
          }),
        ),
      ).toEqual({ "contents.0.quantity": "validation.quantity" });
    // A digital line has no quantity or size of its own.
    expect(
      priceListItemInput.safeParse({ ...pkg, contents: [{ kind: "digital", quantity: 2 }] })
        .success,
    ).toBe(false);
  });

  it("orders every item once", () => {
    expect(itemOrderInput.parse({ itemIds: [ID] })).toEqual({ itemIds: [ID] });
    expect(itemOrderInput.safeParse({ itemIds: [ID, ID] }).success).toBe(false);
    expect(itemOrderInput.safeParse({ itemIds: ["x"] }).success).toBe(false);
    // Unknown fields are refused, not silently dropped, like every other input.
    expect(errors(itemOrderInput.safeParse({ itemIds: [ID], position: 3 }))).toEqual({
      form: "validation.unknownField",
    });
  });

  it("refuses control characters and bidi overrides in names and descriptions (as the database does)", () => {
    for (const bad of ["Spring\u0007", "Spring\u0085", "Spring \u202Egnirps", "A\u2066B\u2069"]) {
      expect(errors(priceListInput.safeParse({ name: bad })), JSON.stringify(bad)).toEqual({
        name: "validation.priceListName",
      });
      expect(errors(priceListItemPatch.safeParse({ name: bad })), JSON.stringify(bad)).toEqual({
        name: "validation.itemName",
      });
      expect(
        errors(priceListItemPatch.safeParse({ description: bad })),
        JSON.stringify(bad),
      ).toEqual({ description: "validation.invalid" });
    }
    expect(isPriceText("8×10 print — café, 日本")).toBe(true);
    expect(priceListItemPatch.parse({ name: "Ünïcode ✓" })).toEqual({ name: "Ünïcode ✓" });
  });

  it("lets a job name its price list and school delivery", () => {
    const ok = { name: "Fall", type: "school", pictureDay: "2026-10-14" };
    expect(jobInput.parse({ ...ok, priceListId: ID, deliverToSchool: true })).toMatchObject({
      priceListId: ID,
      deliverToSchool: true,
    });
    expect(errors(jobPatch.safeParse({ priceListId: "nope" }))).toEqual({
      priceListId: "validation.priceList",
    });
    expect(jobPatch.safeParse({ priceListId: null }).success).toBe(false);
    expect(jobPatch.parse({ deliverToSchool: false })).toEqual({ deliverToSchool: false });
  });
});

describe("price lists match the database", () => {
  const sql = readFileSync(
    join(__dirname, "../../db/supabase/migrations/20261012200000_price_lists.sql"),
    "utf8",
  );
  const values = (name: string) =>
    [
      ...(sql.match(new RegExp(`${name} as enum \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'(\w+)'/g),
    ].map((m) => m[1]);

  it("has the same kinds and print sizes", () => {
    expect(values("price_item_kind")).toEqual([...PRICE_ITEM_KINDS]);
    expect(values("print_size")).toEqual([...PRINT_SIZES]);
  });

  it("has the same bounds", () => {
    expect(sql).toContain("price_cents between 0 and 1000000");
    expect(sql).toContain("home_shipping_cents between 0 and 100000");
    expect(sql).toContain("quantity between 1 and 99");
    expect(sql).toContain("char_length(name) between 1 and 80");
  });

  it("seeds the same starter list as core (Claude's call 9)", () => {
    const json = sql.match(/\$starter\$([\s\S]*?)\$starter\$/)?.[1];
    expect(json).toBeDefined();
    expect(JSON.parse(json as string)).toEqual(STARTER_PRICE_LIST);
  });
});
