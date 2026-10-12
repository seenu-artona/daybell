import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { checklistFacts, checklistSummary, checklistToday, loadChecklistFacts } = await import(
  "./checklist-facts"
);

const NOW = new Date("2026-10-12T03:00:00Z");

describe("checklistToday", () => {
  it("uses the browser's day within a day of UTC, else the server's UTC day", () => {
    expect(checklistToday(undefined, NOW)).toBe("2026-10-12");
    expect(checklistToday("2026-10-11", NOW)).toBe("2026-10-11");
    expect(checklistToday("2026-10-13", NOW)).toBe("2026-10-13");
    expect(() => checklistToday("2026-10-14", NOW)).toThrow();
    expect(() => checklistToday("2026-10-10", NOW)).toThrow();
  });
});

describe("checklistFacts and checklistSummary", () => {
  const row = {
    job_id: "j",
    children: 3,
    qr_eligible: 3,
    qr_with_card: 1,
    has_ready_photo: false,
    failed_photos: 0,
    tagging_pending: true,
    leftovers: 4,
    flagged: 2,
    blank_cards_pending: 1,
    tagging_reviewed: false,
  };
  const job = { type: "school" as const, status: "draft" as const, pictureDay: "2027-01-01" };

  it("maps the database row to the core facts", () => {
    expect(checklistFacts(job, row, "2026-10-12")).toEqual({
      status: "draft",
      pictureDay: "2027-01-01",
      children: 3,
      qrCards: { eligible: 3, withCard: 1 },
      hasReadyPhoto: false,
      failedPhotos: 0,
      taggingPending: true,
      leftovers: 4,
      flagged: 2,
      blankCardsPending: 1,
      taggingReviewed: false,
      today: "2026-10-12",
    });
    expect(checklistFacts(job, undefined, "2026-10-12")).toMatchObject({
      children: 0,
      qrCards: null,
      leftovers: 0,
      taggingReviewed: false,
    });
  });

  it("summarises the checklist for the Jobs list", () => {
    expect(checklistSummary(job, row, "2026-10-12")).toEqual({
      milestone: "setUp",
      done: 2,
      total: 6,
      next: "printQrCards",
    });
    expect(checklistSummary({ ...job, status: "closed" }, row, "2026-10-12")).toEqual({
      milestone: null,
      done: 2,
      total: 6,
      next: null,
    });
  });
});

describe("loadChecklistFacts", () => {
  it("asks once for all the jobs, scoped to the studio, and not at all for none", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ job_id: "a" }], error: null });
    const supabase = { rpc } as unknown as Parameters<typeof loadChecklistFacts>[0];
    expect((await loadChecklistFacts(supabase, "s", [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    const facts = await loadChecklistFacts(supabase, "s", ["a", "b"]);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("job_checklist_facts", {
      p_studio_id: "s",
      p_job_ids: ["a", "b"],
    });
    expect([...facts.keys()]).toEqual(["a"]);
  });
});
