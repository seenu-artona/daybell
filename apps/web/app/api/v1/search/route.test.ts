import { ApiError } from "@daybell/api";
import { afterEach, describe, expect, it, vi } from "vitest";

// The menu search (ADR 0013): who is asking comes before the body (S4), only the caller's studio is searched, and the
// typed text is never logged. The scope is faked; nothing reaches a database.
vi.mock("server-only", () => ({}));
const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));

const STUDIO = { id: "studio-a", name: "A", slug: "a", region: "ca", role: "staff" };
const post = (body: string) =>
  new Request("http://localhost/api/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
const search = async (body: string) => (await import("./route")).POST(post(body));

afterEach(() => {
  scope.mockReset();
  vi.restoreAllMocks();
});

describe("POST /search", () => {
  it("answers not_signed_in before reading the body", async () => {
    scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
    const res = await search("{ not json");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("not_signed_in");
  });

  it("searches only the caller's own studio, with the trimmed text, and answers in API shape", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        jobs: [
          {
            id: "j1",
            name: "Lincoln Fall",
            internal_number: "JOB00001",
            status: "draft",
            picture_day: "2026-10-14",
          },
        ],
        clients: [{ id: "c1", name: "Lincoln Elementary", city: null }],
      },
      error: null,
    });
    scope.mockResolvedValue({ supabase: { rpc }, studio: STUDIO, userId: "u" });
    const res = await search(JSON.stringify({ q: "  Lincoln " }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("search_studio", {
      p_studio_id: "studio-a",
      p_query: "Lincoln",
    });
    expect(await res.json()).toEqual({
      jobs: [
        {
          id: "j1",
          name: "Lincoln Fall",
          internalNumber: "JOB00001",
          status: "draft",
          pictureDay: "2026-10-14",
        },
      ],
      clients: [{ id: "c1", name: "Lincoln Elementary", city: null }],
    });
  });

  it("refuses fewer than 2 characters without searching", async () => {
    const rpc = vi.fn();
    scope.mockResolvedValue({ supabase: { rpc }, studio: STUDIO, userId: "u" });
    const res = await search(JSON.stringify({ q: " L " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.q).toBe("validation.searchShort");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never logs the text, even when the database fails", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    for (const failure of [
      vi.fn().mockRejectedValue(new Error("boom Zebulon Xylophone")),
      vi.fn().mockResolvedValue({ data: null, error: { code: "XX000", message: "Zebulon" } }),
    ]) {
      scope.mockResolvedValue({ supabase: { rpc: failure }, studio: STUDIO, userId: "u" });
      const res = await search(JSON.stringify({ q: "Zebulon Xylophone" }));
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("Zebulon");
    }
    for (const spy of spies)
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("Zebulon");
  });
});
