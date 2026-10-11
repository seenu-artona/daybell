import { ApiError } from "@daybell/api";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every roster write checks who is asking, and their role, before it reads the body (S4). The scope is faked here;
// nothing reaches a database.
vi.mock("server-only", () => ({}));
const { scope, rpc } = vi.hoisted(() => ({ scope: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/supabase/service", () => ({ codeWriteRpc: rpc }));

const ID = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const ctx = { params: Promise.resolve({ id: ID }) };
const garbled = (method: string) =>
  new Request(`http://localhost/api/v1/x/${ID}`, {
    method,
    headers: { "content-type": "application/json" },
    body: "{ not json",
  });
const staff = { id: "s", name: "S", slug: "s", region: "ca", role: "staff" };

const routes = [
  [
    "POST /jobs/:id/children",
    async () => (await import("./jobs/[id]/children/route")).POST,
    "POST",
  ],
  [
    "POST /jobs/:id/children/import",
    async () => (await import("./jobs/[id]/children/import/route")).POST,
    "POST",
  ],
  ["PATCH /children/:id", async () => (await import("./children/[id]/route")).PATCH, "PATCH"],
  ["POST /jobs/:id/groups", async () => (await import("./jobs/[id]/groups/route")).POST, "POST"],
  ["PATCH /groups/:id", async () => (await import("./groups/[id]/route")).PATCH, "PATCH"],
] as const;

afterEach(() => {
  scope.mockReset();
  rpc.mockReset();
});

describe("roster writes check the person before the body", () => {
  for (const [name, load, method] of routes) {
    it(`${name}: signed-out people get not_signed_in, even with a broken body`, async () => {
      scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
      const res = await (await load())(garbled(method), ctx);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("not_signed_in");
    });

    it(`${name}: staff get forbidden, even with a broken body`, async () => {
      scope.mockResolvedValue({ supabase: {}, studio: staff, userId: "u" });
      const res = await (await load())(garbled(method), ctx);
      expect(res.status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    });
  }
});
