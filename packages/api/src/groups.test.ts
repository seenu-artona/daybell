import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenApi, ROUTES } from "./routes";
import {
  alsoShowPhotosInput,
  deleteGroupQuery,
  groupMembersInput,
  groupPageQuery,
  groupsFromColumnInput,
  LIST_FILTER_KEYS,
  listFiltersInput,
  moveGroupPhotosInput,
  photoGroupInput,
  photoPeopleQuery,
  rosterQuery,
  taggingPhotosQuery,
} from "./schemas";
import { childResponse, GROUP_CONFLICTS, rosterChild, TAGGING_CONFLICTS } from "./types";

const ID = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const OTHER = "1b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `0b6f7c1e-2a7d-4c55-9d0e-${String(i).padStart(12, "0")}`);
const sql = readFileSync(
  join(__dirname, "../../db/supabase/migrations/20261016000000_photo_groups.sql"),
  "utf8",
);

describe("groups (D156, ADR 0030)", () => {
  it("names are cleaned and 1 to 60 characters (C10)", () => {
    expect(photoGroupInput.parse({ name: "  Jazz   band " }).name).toBe("Jazz band");
    expect(photoGroupInput.safeParse({ name: "   " }).success).toBe(false);
    expect(photoGroupInput.safeParse({ name: "x".repeat(60) }).success).toBe(true);
    expect(photoGroupInput.safeParse({ name: "x".repeat(61) }).success).toBe(false);
    // The same clean-text rule as price list names: no control, C1 or bidi characters (the database refuses them too).
    for (const name of ["Ev\u202Eil", "Iso\u2066late", "C1\u0085", "Bell\u0007"])
      expect(photoGroupInput.safeParse({ name }).error?.issues[0]?.message).toBe(
        "validation.groupName",
      );
  });

  it("changed queries are strict: an old ?groupId= is refused, never ignored", () => {
    expect(rosterQuery.safeParse({ groupId: ID }).error?.issues[0]?.message).toBe(
      "validation.unknownField",
    );
    expect(rosterQuery.parse({ classId: ID }).classId).toBe(ID);
    expect(photoPeopleQuery.safeParse({ groupId: ID, classId: ID }).success).toBe(false);
    expect(taggingPhotosQuery.safeParse({ place: "leftovers", groupId: ID }).success).toBe(false);
    expect(groupPageQuery.safeParse({ limit: "10", order: "name" }).success).toBe(false);
    expect(deleteGroupQuery.safeParse({ photosTo: "bin", force: "1" }).success).toBe(false);
  });

  it("are made from Class or Grade only (C3 as Seenu narrowed it)", () => {
    expect(groupsFromColumnInput.parse({ column: "class" }).column).toBe("class");
    expect(groupsFromColumnInput.parse({ column: "grade" }).column).toBe("grade");
    // Never a name or ID (kept in a group name after erasure), the parent's email or a flag; no Teacher field.
    for (const column of [
      "firstName",
      "lastName",
      "studentId",
      "teacher",
      "parentEmail",
      "doNotPhotograph",
      "doNotPublish",
    ])
      expect(groupsFromColumnInput.safeParse({ column }).success).toBe(false);
  });

  it("change members 500 at a time, nobody added and removed at once", () => {
    expect(groupMembersInput.parse({ add: [ID] })).toEqual({ add: [ID], remove: [] });
    expect(groupMembersInput.safeParse({}).success).toBe(false);
    expect(groupMembersInput.safeParse({ add: [ID], remove: [ID] }).success).toBe(false);
    expect(groupMembersInput.safeParse({ add: ids(500) }).success).toBe(true);
    expect(groupMembersInput.safeParse({ add: ids(501) }).success).toBe(false);
    expect(groupMembersInput.safeParse({ add: ["Maya Johnson"] }).success).toBe(false);
  });

  it("move and show 1 to 500 photos", () => {
    expect(moveGroupPhotosInput.safeParse({ photoIds: [ID], toGroupId: OTHER }).success).toBe(true);
    expect(moveGroupPhotosInput.safeParse({ photoIds: [], toGroupId: OTHER }).success).toBe(false);
    expect(moveGroupPhotosInput.safeParse({ photoIds: ids(501), toGroupId: OTHER }).success).toBe(
      false,
    );
    expect(alsoShowPhotosInput.safeParse({ photoIds: [ID], groupIds: [OTHER] }).success).toBe(true);
    expect(alsoShowPhotosInput.safeParse({ photoIds: [ID], groupIds: [] }).success).toBe(false);
    expect(alsoShowPhotosInput.safeParse({ photoIds: [ID, ID], groupIds: [OTHER] }).success).toBe(
      false,
    );
  });

  it("send a deleted group's photos to another group (with its id) or the bin (C4)", () => {
    expect(deleteGroupQuery.parse({})).toEqual({});
    expect(deleteGroupQuery.parse({ photosTo: "bin" })).toEqual({ photosTo: "bin" });
    expect(deleteGroupQuery.parse({ photosTo: "group", targetId: ID }).targetId).toBe(ID);
    expect(deleteGroupQuery.safeParse({ photosTo: "group" }).success).toBe(false);
    expect(deleteGroupQuery.safeParse({ photosTo: "bin", targetId: ID }).success).toBe(false);
    expect(deleteGroupQuery.safeParse({ photosTo: "trash" }).success).toBe(false);
  });

  it("People pages are 50 people at most", () => {
    expect(photoPeopleQuery.parse({}).limit).toBe(50);
    expect(photoPeopleQuery.safeParse({ limit: "51" }).success).toBe(false);
    expect(photoPeopleQuery.safeParse({ groupId: "Choir" }).success).toBe(false);
  });

  it("a Group chip is saved on Photos and Subjects, as the database takes it", () => {
    expect(LIST_FILTER_KEYS.job_photos).toEqual({ group: true });
    expect(LIST_FILTER_KEYS.job_subjects).toMatchObject({ group: true, class: true });
    expect(sql).toContain("('job_subjects', 'group', true), ('job_photos', 'group', true)");
    expect(
      listFiltersInput.safeParse({
        page: "job_photos",
        jobId: ID,
        chips: [{ key: "group", value: OTHER }],
      }).success,
    ).toBe(true);
    expect(
      listFiltersInput.safeParse({ page: "job_photos", jobId: ID, chips: [{ key: "group" }] })
        .success,
    ).toBe(false);
  });

  it("conflicts are named (ADR 0030)", () => {
    expect(Object.values(GROUP_CONFLICTS)).toEqual([
      "groups.nameTaken",
      "groups.limit",
      "groups.photoSold",
      "groups.jobClosed",
      "groups.notInJob",
      "groups.hasPhotos",
    ]);
    expect(TAGGING_CONFLICTS.groupPhoto).toBe("tagging.groupPhoto");
  });

  it("a child has a class (C6) and the roster list their groups", () => {
    expect(Object.keys(childResponse.shape.child.shape)).toContain("class");
    expect(Object.keys(childResponse.shape.child.shape)).not.toContain("group");
    expect(Object.keys(rosterChild.shape)).toContain("groups");
  });
});

describe("the API description (ADR 0030)", () => {
  const keys = ROUTES.map((r) => `${r.method} ${r.path}`);

  it("names classes as classes and groups as photo groups (C6)", () => {
    for (const key of [
      "GET /jobs/{id}/classes",
      "POST /jobs/{id}/classes",
      "PATCH /classes/{id}",
      "GET /jobs/{id}/photos/people",
      "GET /jobs/{id}/groups",
      "POST /jobs/{id}/groups",
      "POST /jobs/{id}/groups/from-column",
      "GET /jobs/{id}/groups/none/photos",
      "POST /jobs/{id}/groups/none/photos/move",
      "GET /groups/{id}",
      "PATCH /groups/{id}",
      "DELETE /groups/{id}",
      "GET /groups/{id}/members",
      "POST /groups/{id}/members",
      "GET /groups/{id}/photos",
      "POST /groups/{id}/photos/move",
      "POST /jobs/{id}/photos/also-show",
    ])
      expect(keys).toContain(key);
    expect(keys).not.toContain("GET /jobs/{id}/tagging/children");
    expect(keys).not.toContain("GET /jobs/{id}/tagging/no-photos");
  });

  it("lets uploaders (owners, admins, photographers) change groups, never staff (C11)", () => {
    const writes = ROUTES.filter(
      (r) => r.method !== "GET" && (r.path.includes("/groups") || r.path.endsWith("/also-show")),
    );
    expect(writes.length).toBe(8);
    for (const route of writes) expect(route.access, route.path).toBe("uploader");
  });

  it("builds a description whose references all resolve", () => {
    const text = JSON.stringify(buildOpenApi("https://example.test"));
    for (const ref of text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g))
      expect(text).toContain(`"${ref[1]}":`);
  });
});
