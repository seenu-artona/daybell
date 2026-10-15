import { afterEach, describe, expect, it, vi } from "vitest";

// Job templates (D154), a job's Progress, numbers and rule undo (D152), and a person's record and orders on Subjects
// (D153); ADR 0029. The person and their role are checked before anything is written; every query names the caller's
// studio; another studio's templates, jobs and people are simply not found (row-level security, faked here); the
// job's numbers are worked out in Montréal for Canadian studios and only for owners and admins.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEMPLATE = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const DEFAULT = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";
const JOB = "3e9caf4b-5d0a-4f88-8a3b-6c4d5e6f7081";
const CHILD = "4fa0b05c-6e1b-4a99-9b4c-7d5e6f708192";
const LIST = "5ab1c16d-7f2c-4baa-8c5d-8e6f708192a3";
const OWNER = "11111111-1111-4111-8111-111111111111";
const as = (role: string, region = "us") => ({
  id: STUDIO,
  name: "North Peak",
  slug: "np",
  region,
  role,
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

type Answer = {
  data?: unknown;
  error?: { code: string; message?: string } | null;
  count?: number;
};
type Call = { name: string; ops: [string, unknown[]][]; args?: unknown };

/** A stand-in for the Supabase client: each table or function answers with `answers[name]`; every call is recorded. */
function fakeDatabase(answers: Record<string, unknown | ((call: Call) => Answer)>) {
  const calls: Call[] = [];
  const respond = (call: Call) => {
    const a = answers[call.name];
    const out: Answer = typeof a === "function" ? (a as (c: Call) => Answer)(call) : { data: a };
    return { data: out.data ?? null, error: out.error ?? null, count: out.count ?? null };
  };
  const chain = (call: Call): object =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve(respond(call))
            : (...args: unknown[]) => {
                call.ops.push([prop, args]);
                return chain(call);
              },
      },
    );
  const from = (name: string) => {
    const call: Call = { name, ops: [] };
    calls.push(call);
    return chain(call);
  };
  const rpc = (name: string, args: unknown) => {
    const call: Call = { name, ops: [], args };
    calls.push(call);
    return chain(call);
  };
  return { supabase: { from, rpc }, calls };
}

const has = (call: Call | undefined, op: string, ...args: unknown[]) =>
  call?.ops.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args)) ?? false;
const isWrite = (c: Call) => c.ops.some(([op]) => ["insert", "update", "delete"].includes(op));
const writes = (calls: Call[]) => calls.filter(isWrite);

const TEMPLATE_ROW = {
  id: TEMPLATE,
  name: "School Fall",
  is_default: false,
  used_by: "3",
  qr_cards_days_before: 5,
  shop_opens: "photos_checked",
  shop_opens_days: null,
  shop_closes_days: 10,
  price_list_id: null,
  deliver_to_school: false,
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
};
const DEFAULT_ROW = {
  ...TEMPLATE_ROW,
  id: DEFAULT,
  name: "Standard",
  is_default: true,
  used_by: 12,
  qr_cards_days_before: null,
  shop_closes_days: null,
};
const RULES_GIVEN = {
  qr_cards_days_before: 5,
  shop_opens: "photos_checked",
  shop_opens_days: null,
  shop_closes_days: 10,
};
const JOB_ROW = {
  id: JOB,
  name: "Lincoln Fall",
  type: "school",
  status: "draft",
  picture_day: "2030-05-01",
  internal_number: "JOB00001",
  subjects_expected: null,
  price_list_id: LIST,
  deliver_to_school: false,
  closes_at: null,
  opened_at: null,
  ...RULES_GIVEN,
  shop_closes_days: 14,
  template_rules: RULES_GIVEN,
  template: { id: TEMPLATE, name: "School Fall" },
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  client: null,
};

const send = (method: string, body?: unknown) =>
  new Request("http://localhost/api/v1/x", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });

afterEach(() => {
  scope.mockReset();
  vi.unstubAllEnvs();
});

const list = await import("./job-templates/route");
const one = await import("./job-templates/[id]/route");
const makeDefault = await import("./job-templates/[id]/default/route");
const copy = await import("./job-templates/[id]/copy/route");
const progress = await import("./jobs/[id]/progress/route");
const sales = await import("./jobs/[id]/sales/route");
const reset = await import("./jobs/[id]/rules/reset/route");
const facts = await import("./children/[id]/facts/route");
const orders = await import("./orders/route");
const jobs = await import("./jobs/route");
const job = await import("./jobs/[id]/route");

describe("GET /job-templates (D154)", () => {
  it("lists the caller's studio's templates, everyone on the team", async () => {
    const db = fakeDatabase({ list_job_templates: [DEFAULT_ROW, TEMPLATE_ROW] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("staff"), userId: "u" });
    const res = await list.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates.map((t: { name: string }) => t.name)).toEqual([
      "Standard",
      "School Fall",
    ]);
    expect(body.templates[1]).toMatchObject({
      isDefault: false,
      usedBy: 3,
      rules: {
        qrCardsDaysBefore: 5,
        shopOpens: "photosChecked",
        shopOpensDays: null,
        shopClosesDays: 10,
      },
    });
    expect(db.calls[0]?.args).toEqual({ p_studio_id: STUDIO });
  });
});

describe("POST /job-templates", () => {
  it("refuses photographers and staff before anything is written", async () => {
    for (const role of ["photographer", "staff"]) {
      const db = fakeDatabase({});
      scope.mockResolvedValue({ supabase: db.supabase, studio: as(role), userId: "u" });
      expect((await list.POST(send("POST", { name: "A" }))).status).toBe(403);
      expect(writes(db.calls)).toEqual([]);
    }
  });

  it("adds one to the caller's studio, rules in the database's words", async () => {
    const db = fakeDatabase({
      job_templates: (c: Call) =>
        isWrite(c) ? { data: { id: TEMPLATE } } : { data: null, count: 1 },
      list_job_templates: [DEFAULT_ROW, TEMPLATE_ROW],
    });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("admin"), userId: "u" });
    const res = await list.POST(
      send("POST", {
        name: "School Fall",
        qrCardsDaysBefore: 5,
        shopOpens: "afterPictureDay",
        shopOpensDays: 7,
        shopClosesDays: 10,
      }),
    );
    expect(res.status).toBe(201);
    const insert = writes(db.calls)[0];
    expect(insert?.ops.find(([op]) => op === "insert")?.[1][0]).toEqual({
      studio_id: STUDIO,
      name: "School Fall",
      price_list_id: null,
      deliver_to_school: false,
      qr_cards_days_before: 5,
      shop_opens: "after_picture_day",
      shop_opens_days: 7,
      shop_closes_days: 10,
    });
    expect((await res.json()).template.id).toBe(TEMPLATE);
  });

  it("refuses another studio's price list as a field error, before writing", async () => {
    const db = fakeDatabase({ price_lists: [] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await list.POST(send("POST", { name: "A", priceListId: LIST }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ priceListId: "validation.priceList" });
    expect(has(db.calls[0], "eq", "studio_id", STUDIO)).toBe(true);
    expect(writes(db.calls)).toEqual([]);
  });

  it("stops at 50 templates", async () => {
    const db = fakeDatabase({ job_templates: () => ({ data: null, count: 50 }) });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await list.POST(send("POST", { name: "A" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields.form).toBe("templates.limit");
  });
});

describe("one template", () => {
  it("another studio's template is not found (not in the caller's studio's list)", async () => {
    const db = fakeDatabase({ list_job_templates: [DEFAULT_ROW] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    expect((await one.GET(send("GET"), ctx(TEMPLATE))).status).toBe(404);
    expect((await one.PATCH(send("PATCH", { name: "B" }), ctx(TEMPLATE))).status).toBe(404);
    expect((await one.DELETE(send("DELETE"), ctx(TEMPLATE))).status).toBe(404);
    expect((await makeDefault.POST(send("POST"), ctx(TEMPLATE))).status).toBe(404);
    expect((await copy.POST(send("POST", { name: "C" }), ctx(TEMPLATE))).status).toBe(404);
    expect(writes(db.calls)).toEqual([]);
    for (const c of db.calls) expect(c.args).toEqual({ p_studio_id: STUDIO });
  });

  it("a change is scoped to the studio, and its rules must make a whole", async () => {
    const db = fakeDatabase({
      list_job_templates: [DEFAULT_ROW, TEMPLATE_ROW],
      job_templates: [{ id: TEMPLATE }],
    });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const bad = await one.PATCH(send("PATCH", { shopOpensDays: 3 }), ctx(TEMPLATE));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.fields).toEqual({ shopOpensDays: "validation.shopOpensDays" });
    expect(writes(db.calls)).toEqual([]);
    const ok = await one.PATCH(
      send("PATCH", { shopClosesDays: null, name: "Fall" }),
      ctx(TEMPLATE),
    );
    expect(ok.status).toBe(200);
    const update = writes(db.calls)[0];
    expect(has(update, "eq", "studio_id", STUDIO)).toBe(true);
    expect(has(update, "eq", "id", TEMPLATE)).toBe(true);
    expect(update?.ops.find(([op]) => op === "update")?.[1][0]).toEqual({
      name: "Fall",
      shop_closes_days: null,
      shop_opens_days: null,
    });
  });

  it("the default can't be deleted; another can", async () => {
    const db = fakeDatabase({ list_job_templates: [DEFAULT_ROW, TEMPLATE_ROW], job_templates: [] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const refused = await one.DELETE(send("DELETE"), ctx(DEFAULT));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.fields.form).toBe("templates.isDefault");
    const db2 = fakeDatabase({
      list_job_templates: [DEFAULT_ROW, TEMPLATE_ROW],
      job_templates: [{ id: TEMPLATE }],
    });
    scope.mockResolvedValue({ supabase: db2.supabase, studio: as("owner"), userId: "u" });
    expect((await one.DELETE(send("DELETE"), ctx(TEMPLATE))).status).toBe(204);
    expect(has(writes(db2.calls)[0], "eq", "studio_id", STUDIO)).toBe(true);
  });

  it("making the default updates the caller's own studio only", async () => {
    const db = fakeDatabase({ list_job_templates: [DEFAULT_ROW, TEMPLATE_ROW], studios: [] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("admin"), userId: "u" });
    expect((await makeDefault.POST(send("POST"), ctx(TEMPLATE))).status).toBe(200);
    const update = writes(db.calls)[0];
    expect(update?.name).toBe("studios");
    expect(has(update, "eq", "id", STUDIO)).toBe(true);
    expect(update?.ops.find(([op]) => op === "update")?.[1][0]).toEqual({
      default_job_template_id: TEMPLATE,
    });
  });

  it("a copy takes the rules under the name sent", async () => {
    const db = fakeDatabase({
      list_job_templates: [DEFAULT_ROW, TEMPLATE_ROW],
      job_templates: (c: Call) => (isWrite(c) ? { data: { id: TEMPLATE } } : { count: 2 }),
    });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    expect(
      (await copy.POST(send("POST", { name: "School Fall copy" }), ctx(TEMPLATE))).status,
    ).toBe(201);
    expect(writes(db.calls)[0]?.ops.find(([op]) => op === "insert")?.[1][0]).toMatchObject({
      studio_id: STUDIO,
      name: "School Fall copy",
      shop_closes_days: 10,
      qr_cards_days_before: 5,
    });
  });
});

describe("jobs and their templates (D154)", () => {
  it("a new job may name one of the studio's templates; another studio's is a field error", async () => {
    const db = fakeDatabase({ job_templates: [] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await jobs.POST(
      send("POST", {
        name: "Fall",
        pictureDay: "2030-05-01",
        type: "school",
        templateId: TEMPLATE,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ templateId: "validation.template" });
    expect(has(db.calls[0], "eq", "studio_id", STUDIO)).toBe(true);
    expect(writes(db.calls)).toEqual([]);
  });

  it("a job carries its template, rules and what was changed for it", async () => {
    const db = fakeDatabase({ jobs: JOB_ROW, job_checklist_facts: [] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("staff"), userId: "u" });
    const body = await (await job.GET(send("GET"), ctx(JOB))).json();
    expect(body.job).toMatchObject({
      template: { id: TEMPLATE, name: "School Fall" },
      rules: { qrCardsDaysBefore: 5, shopClosesDays: 14 },
      changedRules: ["shopCloses"],
    });
  });

  it("a job's own rule change is checked whole and written with the job's details", async () => {
    const db = fakeDatabase({ jobs: JOB_ROW });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const bad = await job.PATCH(send("PATCH", { shopOpens: "afterPictureDay" }), ctx(JOB));
    expect(bad.status).toBe(400);
    expect(writes(db.calls)).toEqual([]);
    const ok = await job.PATCH(send("PATCH", { qrCardsDaysBefore: 3 }), ctx(JOB));
    expect(ok.status).toBe(200);
    const update = writes(db.calls)[0];
    expect(has(update, "eq", "studio_id", STUDIO)).toBe(true);
    expect(update?.ops.find(([op]) => op === "update")?.[1][0]).toEqual({
      qr_cards_days_before: 3,
      shop_opens_days: null,
    });
  });
});

describe("POST /jobs/:id/rules/reset (D152)", () => {
  it("puts the template's rule back, in the caller's studio", async () => {
    const db = fakeDatabase({ jobs: JOB_ROW });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await reset.POST(send("POST", { rule: "shopCloses" }), ctx(JOB));
    expect(res.status).toBe(200);
    const update = writes(db.calls)[0];
    expect(has(update, "eq", "studio_id", STUDIO)).toBe(true);
    expect(update?.ops.find(([op]) => op === "update")?.[1][0]).toEqual({ shop_closes_days: 10 });
  });

  it("while selling, the closing date goes back to the template rule's", async () => {
    const selling = {
      ...JOB_ROW,
      status: "selling",
      opened_at: "2099-01-01T00:00:00.000Z",
      closes_at: "2099-01-20T00:00:00.000Z",
    };
    const db = fakeDatabase({ jobs: selling });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("admin"), userId: "u" });
    expect((await reset.POST(send("POST", { rule: "shopCloses" }), ctx(JOB))).status).toBe(200);
    expect(writes(db.calls)[0]?.ops.find(([op]) => op === "update")?.[1][0]).toEqual({
      shop_closes_days: 10,
      closes_at: "2099-01-11T00:00:00.000Z",
    });
  });

  it("refuses roles, another studio's job, a job made before templates, and a date that has passed", async () => {
    const photographer = fakeDatabase({ jobs: JOB_ROW });
    scope.mockResolvedValue({
      supabase: photographer.supabase,
      studio: as("photographer"),
      userId: "u",
    });
    expect((await reset.POST(send("POST", { rule: "qrCards" }), ctx(JOB))).status).toBe(403);
    const elsewhere = fakeDatabase({ jobs: null });
    scope.mockResolvedValue({ supabase: elsewhere.supabase, studio: as("owner"), userId: "u" });
    expect((await reset.POST(send("POST", { rule: "qrCards" }), ctx(JOB))).status).toBe(404);
    expect(has(elsewhere.calls[0], "eq", "studio_id", STUDIO)).toBe(true);
    const old = fakeDatabase({ jobs: { ...JOB_ROW, template_rules: null } });
    scope.mockResolvedValue({ supabase: old.supabase, studio: as("owner"), userId: "u" });
    const none = await reset.POST(send("POST", { rule: "qrCards" }), ctx(JOB));
    expect(none.status).toBe(409);
    expect((await none.json()).error.fields.form).toBe("jobs.noTemplate");
    const passed = fakeDatabase({
      jobs: { ...JOB_ROW, status: "selling", opened_at: "2020-01-01T00:00:00Z" },
    });
    scope.mockResolvedValue({ supabase: passed.supabase, studio: as("owner"), userId: "u" });
    const late = await reset.POST(send("POST", { rule: "shopCloses" }), ctx(JOB));
    expect(late.status).toBe(400);
    expect((await late.json()).error.fields).toEqual({ closesAt: "validation.closesAt" });
    for (const db of [photographer, elsewhere, old, passed]) expect(writes(db.calls)).toEqual([]);
  });
});

describe("GET /jobs/:id/progress (D152)", () => {
  const facts = [
    { step: "createJob", happened_at: "2026-10-01T00:00:00Z", actor_id: OWNER },
    { step: "addRoster", happened_at: "2026-10-02T00:00:00Z", actor_id: OWNER },
  ];
  const checklist = [
    {
      job_id: JOB,
      children: 2,
      qr_eligible: 2,
      qr_with_card: 0,
      has_ready_photo: false,
      failed_photos: 0,
    },
  ];

  it("gives owners who did each step, by email", async () => {
    const db = fakeDatabase({
      jobs: JOB_ROW,
      job_checklist_facts: checklist,
      job_progress_facts: facts,
      studio_team: [{ user_id: OWNER, email: "owner@np.example", role: "owner" }],
    });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await progress.GET(
      new Request(`http://localhost/api/v1/jobs/${JOB}/progress`),
      ctx(JOB),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const steps = body.progress.stages.flatMap((s: { steps: unknown[] }) => s.steps);
    expect(steps.find((s: { key: string }) => s.key === "addRoster")).toMatchObject({
      state: "done",
      at: "2026-10-02T00:00:00Z",
      by: "owner@np.example",
    });
    expect(steps.find((s: { key: string }) => s.key === "printQrCards")).toMatchObject({
      state: "now",
      planned: "2030-04-26",
    });
    expect(body.progress.current).toBe("prepare");
    expect(db.calls.find((c) => c.name === "job_progress_facts")?.args).toEqual({
      p_studio_id: STUDIO,
      p_job_id: JOB,
    });
  });

  it("names nobody for photographers and staff, and never reads the team for them", async () => {
    const db = fakeDatabase({
      jobs: JOB_ROW,
      job_checklist_facts: checklist,
      job_progress_facts: facts,
    });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("photographer"), userId: "u" });
    const body = await (
      await progress.GET(new Request(`http://localhost/api/v1/jobs/${JOB}/progress`), ctx(JOB))
    ).json();
    const steps = body.progress.stages.flatMap((s: { steps: { by: unknown }[] }) => s.steps);
    expect(steps.every((s: { by: unknown }) => s.by === null)).toBe(true);
    expect(db.calls.some((c) => c.name === "studio_team")).toBe(false);
  });

  it("another studio's job is not found before any facts are read", async () => {
    const db = fakeDatabase({ jobs: null });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    const res = await progress.GET(
      new Request(`http://localhost/api/v1/jobs/${JOB}/progress`),
      ctx(JOB),
    );
    expect(res.status).toBe(404);
    expect(has(db.calls[0], "eq", "studio_id", STUDIO)).toBe(true);
    expect(db.calls.some((c) => c.name === "job_progress_facts")).toBe(false);
  });
});

describe("GET /jobs/:id/sales (D152)", () => {
  const numbers = {
    currency: "CAD",
    sales_cents: "286000",
    orders: 72,
    first_paid_at: "2026-10-05T14:00:00Z",
    subjects: 412,
    subjects_ordered: "169",
  };

  it("gives owners and admins the job's numbers, from the caller's studio", async () => {
    const db = fakeDatabase({ jobs: JOB_ROW, job_sales: numbers });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("admin", "ca"), userId: "u" });
    const res = await sales.GET(send("GET"), ctx(JOB));
    expect(res.status).toBe(200);
    expect((await res.json()).sales).toEqual({
      currency: "CAD",
      salesCents: 286000,
      orders: 72,
      firstPaidAt: "2026-10-05T14:00:00Z",
      subjects: 412,
      subjectsOrdered: 169,
    });
    expect(db.calls.find((c) => c.name === "job_sales")?.args).toEqual({
      p_studio_id: STUDIO,
      p_job_id: JOB,
    });
  });

  it("refuses photographers and staff, before reading anything", async () => {
    for (const role of ["photographer", "staff"]) {
      const db = fakeDatabase({});
      scope.mockResolvedValue({ supabase: db.supabase, studio: as(role), userId: "u" });
      expect((await sales.GET(send("GET"), ctx(JOB))).status).toBe(403);
      expect(db.calls).toEqual([]);
    }
  });

  it("refuses a Canadian studio's numbers outside Montréal, before reading anything (D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    const db = fakeDatabase({});
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner", "ca"), userId: "u" });
    expect((await sales.GET(send("GET"), ctx(JOB))).status).toBe(422);
    expect(db.calls).toEqual([]);
    expect(sales.preferredRegion).toBe("yul1");
  });

  it("another studio's job is not found", async () => {
    const db = fakeDatabase({ jobs: null });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("owner"), userId: "u" });
    expect((await sales.GET(send("GET"), ctx(JOB))).status).toBe(404);
    expect(db.calls.some((c) => c.name === "job_sales")).toBe(false);
  });
});

describe("a person on Subjects (D153)", () => {
  it("their card and photo dates come from the caller's studio only", async () => {
    const db = fakeDatabase({
      child_record_facts: [
        { card_printed_at: "2026-09-20T10:00:00Z", photographed_on: "2026-09-24" },
      ],
    });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("staff"), userId: "u" });
    const res = await facts.GET(send("GET"), ctx(CHILD));
    expect((await res.json()).facts).toEqual({
      cardPrintedAt: "2026-09-20T10:00:00Z",
      photographedOn: "2026-09-24",
    });
    expect(db.calls[0]?.args).toEqual({ p_studio_id: STUDIO, p_child_id: CHILD });
    const elsewhere = fakeDatabase({ child_record_facts: [] });
    scope.mockResolvedValue({ supabase: elsewhere.supabase, studio: as("owner"), userId: "u" });
    expect((await facts.GET(send("GET"), ctx(CHILD))).status).toBe(404);
  });

  it("their orders: one of the studio's people, by id, never another studio's", async () => {
    const db = fakeDatabase({ children: { id: CHILD }, studio_orders: [] });
    scope.mockResolvedValue({ supabase: db.supabase, studio: as("staff"), userId: "u" });
    const res = await orders.GET(new Request(`http://localhost/api/v1/orders?childId=${CHILD}`));
    expect(res.status).toBe(200);
    expect(has(db.calls[0], "eq", "studio_id", STUDIO)).toBe(true);
    expect(db.calls.find((c) => c.name === "studio_orders")?.args).toMatchObject({
      p_studio_id: STUDIO,
      p_child_id: CHILD,
    });
    const elsewhere = fakeDatabase({ children: null });
    scope.mockResolvedValue({ supabase: elsewhere.supabase, studio: as("owner"), userId: "u" });
    expect(
      (await orders.GET(new Request(`http://localhost/api/v1/orders?childId=${CHILD}`))).status,
    ).toBe(404);
    expect(elsewhere.calls.some((c) => c.name === "studio_orders")).toBe(false);
  });
});
