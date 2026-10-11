import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { ensureStudio } = await import("./studio");

type RpcResult = { data: unknown; error: { code: string } | null };

function fakeSupabase(memberRows: unknown[], rpcResults: RpcResult[]) {
  const rpc = vi.fn(
    async (_fn: string, _args: Record<string, unknown>) =>
      rpcResults.shift() ?? { data: null, error: null },
  );
  const chain = { select: () => chain, eq: () => chain, limit: async () => ({ data: memberRows }) };
  return { supabase: { from: () => chain, rpc } as never, rpc };
}

const user = (meta: Record<string, unknown>) => ({ id: "u1", user_metadata: meta }) as never;

describe("ensureStudio", () => {
  it("creates the studio named at sign-up", async () => {
    const { supabase, rpc } = fakeSupabase([], [{ data: "s1", error: null }]);
    await ensureStudio(supabase, user({ studio_name: "North Peak", studio_slug: "north-peak" }));
    expect(rpc).toHaveBeenCalledWith("create_studio", {
      p_name: "North Peak",
      p_slug: "north-peak",
    });
  });

  it("adds a short suffix if the web address was taken meanwhile", async () => {
    const { supabase, rpc } = fakeSupabase(
      [],
      [
        { data: null, error: { code: "23505" } },
        { data: "s1", error: null },
      ],
    );
    await ensureStudio(supabase, user({ studio_name: "North Peak", studio_slug: "north-peak" }));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      p_slug: expect.stringMatching(/^north-peak-[0-9a-f]{4}$/),
    });
  });

  it("does nothing for people who already belong to a studio, or were invited", async () => {
    const member = fakeSupabase([{ studio_id: "s1" }], []);
    await ensureStudio(member.supabase, user({ studio_name: "X", studio_slug: "x-studio" }));
    expect(member.rpc).not.toHaveBeenCalled();
    const invited = fakeSupabase([], []);
    await ensureStudio(invited.supabase, user({}));
    expect(invited.rpc).not.toHaveBeenCalled();
  });
});
