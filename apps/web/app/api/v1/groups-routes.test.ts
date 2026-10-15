import { ApiError } from "@daybell/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Photos' People and Groups routes (D156; ADR 0030): the person, their role (owners, admins and photographers change
// groups; staff read only, C11) and the region (D113) are checked before the body; another studio's job or group is
// simply not found (row-level security, faked here) and nothing is written or signed; a group of another job is not
// found either; refusals are named for the screen; names never reach a log.
vi.mock("server-only", () => ({}));
const { scope, groupRpc, writeRpc, systemRpc, storage } = vi.hoisted(() => ({
  scope: vi.fn(),
  groupRpc: vi.fn(),
  writeRpc: vi.fn(),
  systemRpc: vi.fn(),
  storage: { presignGet: vi.fn() },
}));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/supabase/service", () => ({
  groupWriteRpc: groupRpc,
  photoWriteRpc: writeRpc,
  photoSystemRpc: systemRpc,
}));
vi.mock("@daybell/config", async (original) => ({
  ...(await original<typeof import("@daybell/config")>()),
  regionDatabase: (region: string) =>
    region === "ca" ? { region, url: "http://127.0.0.1:54321", publishableKey: "pk" } : null,
}));
vi.mock("@/lib/photo-storage", () => ({
  photoStorage: () => storage,
  isLocalDriver: () => false,
  queuePhotoForProcessing: vi.fn(),
}));

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const OTHER_JOB = "5b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const GROUP = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";
const TARGET = "2d8b9e3a-4c9f-4e77-9f2a-5b3c4d5e6f70";
const PHOTO = "3e9c0f4b-5d0a-4f88-8a3b-6c4d5e6f7081";
const CHILD = "4fad1a5c-6e1b-4a99-9b4c-7d5e6f708192";
const owner = { id: STUDIO, name: "North Peak", slug: "np", region: "ca", role: "owner" };
const photographer = { ...owner, role: "photographer" };
const staff = { ...owner, role: "staff" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** A stand-in for the Supabase client that answers each table (and rpc) with `rows[name]`. */
function fakeDatabase(rows: Record<string, unknown>) {
  const answer = (name: string) => {
    const chain: object = new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve({ data: rows[name] ?? null, error: null })
            : () => chain,
      },
    );
    return chain;
  };
  return { from: answer, rpc: vi.fn((name: string) => answer(name)) };
}

const garbled = (method: string) =>
  new Request("http://localhost/api/v1/x", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" || method === "DELETE" ? null : "{ not json",
  });
const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/api/v1/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (query = "") => new Request(`http://localhost/api/v1/x${query}`);

type Route = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const load = (path: string, method: string) => async () =>
  (await import(`./${path}/route`))[method] as Route;

/** Every write, with the path id it takes and a valid body. */
const WRITES: [string, () => Promise<Route>, string, string, unknown][] = [
  ["POST /jobs/:id/groups", load("jobs/[id]/groups", "POST"), "POST", JOB, { name: "Choir" }],
  [
    "POST /jobs/:id/groups/from-column",
    load("jobs/[id]/groups/from-column", "POST"),
    "POST",
    JOB,
    { column: "class" },
  ],
  [
    "POST /jobs/:id/groups/none/photos/move",
    load("jobs/[id]/groups/none/photos/move", "POST"),
    "POST",
    JOB,
    { photoIds: [PHOTO], toGroupId: TARGET },
  ],
  [
    "POST /jobs/:id/photos/also-show",
    load("jobs/[id]/photos/also-show", "POST"),
    "POST",
    JOB,
    { photoIds: [PHOTO], groupIds: [TARGET] },
  ],
  ["PATCH /groups/:id", load("groups/[id]", "PATCH"), "PATCH", GROUP, { name: "Band" }],
  ["DELETE /groups/:id", load("groups/[id]", "DELETE"), "DELETE", GROUP, null],
  [
    "POST /groups/:id/members",
    load("groups/[id]/members", "POST"),
    "POST",
    GROUP,
    { add: [CHILD], remove: [] },
  ],
  [
    "POST /groups/:id/photos/move",
    load("groups/[id]/photos/move", "POST"),
    "POST",
    GROUP,
    { photoIds: [PHOTO], toGroupId: TARGET },
  ],
];
const READS: [string, () => Promise<Route>, string][] = [
  ["GET /jobs/:id/photos/people", load("jobs/[id]/photos/people", "GET"), JOB],
  ["GET /jobs/:id/groups", load("jobs/[id]/groups", "GET"), JOB],
  ["GET /jobs/:id/groups/none/photos", load("jobs/[id]/groups/none/photos", "GET"), JOB],
  ["GET /groups/:id", load("groups/[id]", "GET"), GROUP],
  ["GET /groups/:id/members", load("groups/[id]/members", "GET"), GROUP],
  ["GET /groups/:id/photos", load("groups/[id]/photos", "GET"), GROUP],
];
const request = (method: string, body: unknown) =>
  method === "DELETE"
    ? new Request("http://localhost/x?photosTo=bin", { method })
    : json(body, method);

let logged: unknown[][] = [];
beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  storage.presignGet.mockImplementation(async (key: string) => `https://s3.test/${key}?sig`);
});
afterEach(() => {
  // Ids only, ever: no name of a person or a group (D96).
  expect(JSON.stringify(logged)).not.toMatch(/Maya|Johnson|Choir|Band/);
  scope.mockReset();
  groupRpc.mockReset();
  writeRpc.mockReset();
  systemRpc.mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("group writes check the person, their role and the region before the body (S4, C11, D113)", () => {
  for (const [name, route, method, id] of WRITES) {
    it(`${name}: signed-out people get not_signed_in, even with a broken body`, async () => {
      scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
      expect((await (await route())(garbled(method), ctx(id))).status).toBe(401);
    });

    it(`${name}: staff get forbidden, even with a broken body`, async () => {
      scope.mockResolvedValue({ supabase: fakeDatabase({}), studio: staff, userId: "u" });
      expect((await (await route())(garbled(method), ctx(id))).status).toBe(403);
      expect(groupRpc).not.toHaveBeenCalled();
    });

    it(`${name}: a Canadian studio outside Montréal is refused before the body`, async () => {
      vi.stubEnv("VERCEL_REGION", "iad1");
      scope.mockResolvedValue({ supabase: fakeDatabase({}), studio: owner, userId: "u" });
      expect((await (await route())(garbled(method), ctx(id))).status).toBe(422);
      expect(groupRpc).not.toHaveBeenCalled();
    });
  }

  for (const [name, route, id] of READS)
    it(`${name}: a Canadian studio outside Montréal is refused`, async () => {
      vi.stubEnv("VERCEL_REGION", "iad1");
      scope.mockResolvedValue({ supabase: fakeDatabase({}), studio: staff, userId: "u" });
      expect((await (await route())(get(), ctx(id))).status).toBe(422);
    });

  it("every group route file runs in Montréal (preferredRegion yul1)", async () => {
    for (const path of [
      "jobs/[id]/photos/people",
      "jobs/[id]/photos/also-show",
      "jobs/[id]/groups",
      "jobs/[id]/groups/from-column",
      "jobs/[id]/groups/none/photos",
      "jobs/[id]/groups/none/photos/move",
      "groups/[id]",
      "groups/[id]/members",
      "groups/[id]/photos",
      "groups/[id]/photos/move",
    ]) {
      const mod = await import(`./${path}/route`);
      expect(mod.preferredRegion, path).toBe("yul1");
      expect(mod.runtime, path).toBe("nodejs");
    }
  });
});

describe("another studio's job or group is not found, and nothing is written or signed (leak, D96)", () => {
  beforeEach(() =>
    scope.mockResolvedValue({
      supabase: fakeDatabase({}),
      studio: { ...owner, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      userId: "b",
    }),
  );

  for (const [name, route, method, id, body] of WRITES)
    it(`${name}`, async () => {
      expect((await (await route())(request(method, body), ctx(id))).status).toBe(404);
      expect(groupRpc).not.toHaveBeenCalled();
    });

  for (const [name, route, id] of READS)
    it(`${name}`, async () => {
      expect((await (await route())(get(), ctx(id))).status).toBe(404);
      expect(storage.presignGet).not.toHaveBeenCalled();
    });

  it("ids that aren't ids are not found", async () => {
    for (const [, route, method, , body] of WRITES)
      expect((await (await route())(request(method, body), ctx("../x"))).status).toBe(404);
    expect(groupRpc).not.toHaveBeenCalled();
  });
});

describe("People (C15)", () => {
  const person = {
    id: CHILD,
    first_name: "Maya",
    last_name: "Johnson",
    photos: 2,
    card_photos: 1,
    strip: [
      {
        id: PHOTO,
        status: "ready",
        place: "card",
        flag: null,
        source: "auto",
        qr_kind: "card",
        qr_card: true,
      },
    ],
  };

  it("pages 50 people with their strips signed, asking for one more and a strip of 12", async () => {
    const supabase = fakeDatabase({
      jobs: { id: JOB, status: "draft" },
      photo_people: { total: 51, people: [...Array(50).fill(person), { ...person, id: TARGET }] },
    });
    scope.mockResolvedValue({ supabase, studio: staff, userId: "u" });
    const res = await (await load("jobs/[id]/photos/people", "GET")())(get(), ctx(JOB));
    const body = await res.json();
    expect(body.people).toHaveLength(50);
    expect(body.nextCursor).toBe(CHILD);
    expect(body.total).toBe(51);
    expect(body.people[0]).toMatchObject({ firstName: "Maya", photos: 2, cardPhotos: 1 });
    expect(body.people[0].strip[0].thumbUrl).toContain(`/${PHOTO}/thumb.webp`);
    expect(supabase.rpc).toHaveBeenCalledWith("photo_people", {
      p_job_id: JOB,
      p_group_id: null,
      p_after: null,
      p_limit: 51,
      p_strip: 12,
    });
  });

  it("filters by a group of this job only: another job's group is not found", async () => {
    const supabase = fakeDatabase({
      jobs: { id: JOB, status: "draft" },
      photo_groups: { id: GROUP, job_id: OTHER_JOB, name: "Choir" },
    });
    scope.mockResolvedValue({ supabase, studio: owner, userId: "u" });
    const res = await (await load("jobs/[id]/photos/people", "GET")())(
      get(`?groupId=${GROUP}`),
      ctx(JOB),
    );
    expect(res.status).toBe(404);
    expect(supabase.rpc).not.toHaveBeenCalledWith("photo_people", expect.anything());
  });
});

describe("groups", () => {
  const listed = {
    groups: [
      { id: GROUP, name: "Room 10", members: 3, photos: 2, ordered: null },
      { id: TARGET, name: "Room 2", members: 0, photos: 0, ordered: null },
    ],
    not_in_group: 4,
  };
  const db = (extra: Record<string, unknown> = {}) =>
    fakeDatabase({
      jobs: { id: JOB, status: "draft" },
      photo_groups: { id: GROUP, job_id: JOB, name: "Room 10" },
      list_photo_groups: listed,
      ...extra,
    });

  it("lists groups by name in natural order, with Not in a group, and Ordered as the database says (C16)", async () => {
    scope.mockResolvedValue({ supabase: db(), studio: photographer, userId: "u" });
    const body = await (await (await load("jobs/[id]/groups", "GET")())(get(), ctx(JOB))).json();
    expect(body.groups.map((g: { name: string }) => g.name)).toEqual(["Room 2", "Room 10"]);
    expect(body.groups[1]).toEqual({
      id: GROUP,
      name: "Room 10",
      members: 3,
      photos: 2,
      ordered: null,
    });
    expect(body.notInGroup).toBe(4);
  });

  it("makes a group for the person, with a cleaned name", async () => {
    groupRpc.mockResolvedValue({ data: GROUP, error: null });
    scope.mockResolvedValue({ supabase: db(), studio: photographer, userId: "u" });
    const res = await (await load("jobs/[id]/groups", "POST")())(
      json({ name: "  Room   10 " }),
      ctx(JOB),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).group.id).toBe(GROUP);
    expect(groupRpc).toHaveBeenCalledWith("ca", "create_photo_group", "u", {
      p_job_id: JOB,
      p_name: "Room 10",
    });
  });

  it("names the database's refusals for the screen", async () => {
    scope.mockResolvedValue({ supabase: db(), studio: owner, userId: "u" });
    const create = await load("jobs/[id]/groups", "POST")();
    for (const [message, form] of [
      ["group_name_taken", "groups.nameTaken"],
      ["group_limit", "groups.limit"],
      ["job_closed", "groups.jobClosed"],
      ["group_not_in_job", "groups.notInJob"],
      ["not_group_photo", "groups.notInJob"],
      ["group_has_photos", "groups.hasPhotos"],
      ["photo_sold", "groups.photoSold"],
    ]) {
      groupRpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message } });
      const res = await create(json({ name: "Choir" }), ctx(JOB));
      expect([res.status, (await res.json()).error.fields]).toEqual([409, { form }]);
    }
  });

  it("deletes to another group or the bin, passing only ids", async () => {
    scope.mockResolvedValue({ supabase: db(), studio: owner, userId: "u" });
    const remove = await load("groups/[id]", "DELETE")();
    groupRpc.mockResolvedValue({ data: { moved: 2, binned: 0 }, error: null });
    const res = await remove(
      new Request(`http://localhost/x?photosTo=group&targetId=${TARGET}`, { method: "DELETE" }),
      ctx(GROUP),
    );
    expect(await res.json()).toEqual({ moved: 2, binned: 0 });
    expect(groupRpc).toHaveBeenLastCalledWith("ca", "delete_photo_group", "u", {
      p_group_id: GROUP,
      p_photos_to: "group",
      p_target: TARGET,
    });
    const empty = await remove(new Request("http://localhost/x", { method: "DELETE" }), ctx(GROUP));
    expect(empty.status).toBe(200);
    expect(groupRpc).toHaveBeenLastCalledWith("ca", "delete_photo_group", "u", {
      p_group_id: GROUP,
      p_photos_to: null,
      p_target: null,
    });
    groupRpc.mockClear();
    const bad = await remove(
      new Request("http://localhost/x?photosTo=group", { method: "DELETE" }),
      ctx(GROUP),
    );
    expect(bad.status).toBe(400);
    expect(groupRpc).not.toHaveBeenCalled();
  });

  it("changes members and moves photos from the group, or from no group", async () => {
    scope.mockResolvedValue({ supabase: db(), studio: photographer, userId: "u" });
    groupRpc.mockResolvedValueOnce({ data: { added: 1, removed: 0, count: 4 }, error: null });
    const members = await (await load("groups/[id]/members", "POST")())(
      json({ add: [CHILD] }),
      ctx(GROUP),
    );
    expect(await members.json()).toEqual({ added: 1, removed: 0, members: 4 });
    expect(groupRpc).toHaveBeenLastCalledWith("ca", "set_photo_group_members", "u", {
      p_group_id: GROUP,
      p_add: [CHILD],
      p_remove: [],
    });
    groupRpc.mockResolvedValue({ data: 1, error: null });
    await (await load("groups/[id]/photos/move", "POST")())(
      json({ photoIds: [PHOTO], toGroupId: TARGET }),
      ctx(GROUP),
    );
    expect(groupRpc).toHaveBeenLastCalledWith("ca", "move_group_photos", "u", {
      p_job_id: JOB,
      p_from: GROUP,
      p_to: TARGET,
      p_photo_ids: [PHOTO],
    });
    await (await load("jobs/[id]/groups/none/photos/move", "POST")())(
      json({ photoIds: [PHOTO], toGroupId: TARGET }),
      ctx(JOB),
    );
    expect(groupRpc).toHaveBeenLastCalledWith("ca", "move_group_photos", "u", {
      p_job_id: JOB,
      p_from: null,
      p_to: TARGET,
      p_photo_ids: [PHOTO],
    });
  });

  it("refuses bodies that aren't the contract: 501 people, someone added and removed at once", async () => {
    scope.mockResolvedValue({ supabase: db(), studio: owner, userId: "u" });
    const members = await load("groups/[id]/members", "POST")();
    const many = Array.from(
      { length: 501 },
      (_, i) => `4fad1a5c-6e1b-4a99-9b4c-${String(i).padStart(12, "0")}`,
    );
    expect((await members(json({ add: many }), ctx(GROUP))).status).toBe(400);
    expect((await members(json({ add: [CHILD], remove: [CHILD] }), ctx(GROUP))).status).toBe(400);
    expect(groupRpc).not.toHaveBeenCalled();
  });
});

describe("the photo panel's tagging (C13)", () => {
  it("says what review allows: a group photo is never given to a person (C8)", async () => {
    const supabase = fakeDatabase({
      photos: {
        id: PHOTO,
        job_id: JOB,
        batch_id: TARGET,
        status: "ready",
        original_filename: "Maya Johnson.jpg",
        byte_size: 10,
        width: 1,
        height: 1,
        captured_at: null,
        failure_reason: null,
        binned_at: null,
        created_at: "2026-10-12T10:00:00Z",
        updated_at: "2026-10-12T10:00:00Z",
        qr_kind: "none",
        qr_card_id: null,
      },
      photo_tags: { place: "group_photo", flag: null, source: "auto" },
    });
    scope.mockResolvedValue({ supabase, studio: owner, userId: "u" });
    const res = await (await import("./photos/[id]/route")).GET(get(), ctx(PHOTO));
    const { photo } = await res.json();
    expect(photo.tagging).toEqual({
      place: "groupPhoto",
      flag: null,
      actions: { move: false, confirm: true, markCard: true, undoCard: false },
    });
  });
});
