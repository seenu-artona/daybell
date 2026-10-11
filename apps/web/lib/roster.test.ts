import {
  encryptAccessCode,
  hashAccessCode,
  importAccessCodeKeys,
  planRosterImport,
} from "@daybell/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const roster = await import("./roster");
const { assertCanEditRoster } = await import("./studio");

const random32 = () => crypto.getRandomValues(new Uint8Array(32));
const keys = await importAccessCodeKeys({ hmacKey: random32(), encryptionKey: random32() });
const CHILD = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";

const row = async (over: Partial<import("./roster").ChildRow> = {}) => ({
  id: CHILD,
  job_id: "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f",
  group_id: null,
  first_name: "Maya",
  last_name: "Johnson",
  student_id: "S-1",
  grade: null,
  parent_email: null,
  do_not_photograph: false,
  do_not_publish: true,
  school_provided: true,
  access_code_ciphertext: await encryptAccessCode("K7QM4XPA", CHILD, keys.encryption),
  created_at: "2026-10-11T09:00:00Z",
  updated_at: "2026-10-11T09:00:00Z",
  ...over,
});

describe("toChild", () => {
  it("shows the decrypted code and never the hash or ciphertext", async () => {
    const child = await roster.toChild(
      { ...(await row()), access_code_hash: "f".repeat(64) } as never,
      keys,
    );
    expect(child.accessCode).toBe("K7QM-4XPA");
    expect(child).toMatchObject({ firstName: "Maya", doNotPublish: true, duplicate: false });
    const text = JSON.stringify(child);
    expect(text).not.toContain("f".repeat(64));
    expect(text).not.toContain("v1.");
    expect(Object.keys(child)).not.toContain("accessCodeHash");
  });

  it("refuses a code copied from another child's row", async () => {
    const other = await row({ id: "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f" });
    await expect(
      roster.toChild(
        { ...other, access_code_ciphertext: (await row()).access_code_ciphertext },
        keys,
      ),
    ).rejects.toThrow();
  });

  it("includes the class from list_children", async () => {
    const child = await roster.toChild(
      await row({
        group_id: "2d8b9e3a-4c9f-4e77-9f2a-5b3c4d5e6f7a",
        group_name: "4B",
        duplicate: true,
      }),
      keys,
    );
    expect(child.group).toEqual({ id: "2d8b9e3a-4c9f-4e77-9f2a-5b3c4d5e6f7a", name: "4B" });
    expect(child.duplicate).toBe(true);
  });
});

describe("database error matchers", () => {
  it("recognise a taken code, a taken class name and the import's named failures", () => {
    const taken = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "children_access_code_hash_key"',
    };
    expect(roster.isCodeTaken(taken)).toBe(true);
    expect(roster.isGroupNameTaken(taken)).toBe(false);
    expect(
      roster.isGroupNameTaken({ code: "23505", message: 'constraint "job_groups_job_name_key"' }),
    ).toBe(true);
    expect(
      roster.isRpcError(
        { code: "P0001", message: "access_code_collision" },
        "access_code_collision",
      ),
    ).toBe(true);
    expect(
      roster.isRpcError({ code: "P0001", message: "roster_changed" }, "access_code_collision"),
    ).toBe(false);
    expect(roster.isRpcError(null, "roster_changed")).toBe(false);
  });
});

describe("who may change the roster", () => {
  const studio = (role: "owner" | "admin" | "photographer" | "staff") => ({
    id: "s",
    name: "S",
    slug: "s",
    region: "ca" as const,
    role,
  });

  it("lets owners, admins and photographers edit, not staff", () => {
    for (const role of ["owner", "admin", "photographer"] as const)
      expect(() => assertCanEditRoster(studio(role))).not.toThrow();
    expect(() => assertCanEditRoster(studio("staff"))).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  it("removes children only while the job is a draft", () => {
    expect(() => roster.assertCanRemoveFrom({ id: "j", status: "draft" })).not.toThrow();
    for (const status of ["selling", "closed"] as const)
      expect(() => roster.assertCanRemoveFrom({ id: "j", status })).toThrow(
        expect.objectContaining({ code: "conflict" }),
      );
  });
});

describe("childColumns", () => {
  it("maps fields to columns; cleared opt-outs are false, cleared text is null", () => {
    expect(
      roster.childColumns(
        {
          firstName: "Maya",
          lastName: "Johnson",
          studentId: null,
          doNotPhotograph: undefined,
        } as never,
        ["firstName", "studentId", "doNotPhotograph"],
      ),
    ).toEqual({ first_name: "Maya", student_id: null, do_not_photograph: false });
  });
});

describe("import helpers", () => {
  const drafts = roster.rosterDrafts([
    { firstName: "Maya", lastName: "Johnson-Lee", studentId: "S-1" },
    { firstName: "Liam", lastName: "Chen", group: "4B", doNotPhotograph: true },
  ]);
  const plan = planRosterImport(
    [{ id: CHILD, studentId: "S-1", firstName: "Maya", lastName: "Johnson", groupName: null }],
    drafts,
  );

  it("fill blanks with null and keep unmapped opt-outs null", () => {
    expect(drafts[0]).toMatchObject({ group: null, grade: null, doNotPhotograph: null });
  });

  it("send updates without codes and adds with a fresh id, hash and encrypted copy", async () => {
    const rows = await roster.importRpcRows(drafts, plan, async (id) => ({
      hash: await hashAccessCode("K7QM4XPA", keys.hmac),
      ciphertext: await encryptAccessCode("K7QM4XPA", id, keys.encryption),
    }));
    expect(rows[0]).toEqual({
      action: "update",
      id: CHILD,
      first_name: "Maya",
      last_name: "Johnson-Lee",
      group_name: null,
      student_id: "S-1",
      grade: null,
      parent_email: null,
      do_not_photograph: null,
      do_not_publish: null,
    });
    expect(rows[1]).toMatchObject({
      action: "add",
      group_name: "4B",
      do_not_photograph: true,
      access_code_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      access_code_ciphertext: expect.stringMatching(/^v1\./),
    });
    expect(rows[1]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(rows)).not.toContain("K7QM4XPA");
  });

  it("summarise a plan row by row", () => {
    expect(roster.importSummary(plan, 1, true)).toEqual({
      dryRun: true,
      added: 1,
      updated: 1,
      groupsAdded: 1,
      duplicates: 0,
      rows: [
        { action: "update", duplicate: false },
        { action: "add", duplicate: false },
      ],
    });
  });

  it("flag a child that duplicates another in the job", () => {
    const children = [
      { id: "a", studentId: "S-1", firstName: "A", lastName: "B", groupName: null },
      { id: "b", studentId: "s- 1", firstName: "C", lastName: "D", groupName: null },
      { id: "c", studentId: null, firstName: "C", lastName: "D", groupName: null },
    ];
    expect(roster.isDuplicate(children, "b")).toBe(true);
    expect(roster.isDuplicate(children, "c")).toBe(false);
    expect(roster.isDuplicate(children, "missing")).toBe(false);
  });
});

describe("sortGroups", () => {
  it("puts Room 2 before Room 10", () => {
    expect(
      roster
        .sortGroups([{ name: "Room 10" }, { name: "room 2" }, { name: "4B" }])
        .map((g) => g.name),
    ).toEqual(["4B", "room 2", "Room 10"]);
  });
});
