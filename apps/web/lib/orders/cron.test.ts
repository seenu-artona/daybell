import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The jobs cron's refund backstops (ADR 0024; Q1, Q2): refunds due are run again (a failure is noted, never thrown);
// each sale owed shortfalls is tried once; shortfalls past 180 days are absorbed; work stops when the region's share of
// time runs out; a database error is logged by name and the rest goes on.
vi.mock("server-only", () => ({}));
const { sysRpc, runRefund, noteRefundFailure, recoverShortfalls } = vi.hoisted(() => ({
  sysRpc: vi.fn(),
  runRefund: vi.fn(),
  noteRefundFailure: vi.fn(),
  recoverShortfalls: vi.fn(),
}));
vi.mock("../supabase/service", () => ({ orderSystemRpc: sysRpc }));
vi.mock("./refunds", () => ({ runRefund, noteRefundFailure, recoverShortfalls }));

const { runRefundBackstops } = await import("./cron");
const provider = {} as never;
const R1 = "aaaa0000-0000-4000-8000-000000000001";
const R2 = "aaaa0000-0000-4000-8000-000000000002";

let logs: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logs = vi.spyOn(console, "error").mockImplementation(() => {});
  sysRpc.mockImplementation(async (_region: string, fn: string) =>
    fn === "refunds_to_retry"
      ? { data: [{ refund_id: R1 }, { refund_id: R2 }], error: null }
      : fn === "refund_shortfalls_due"
        ? {
            data: [
              { refund_id: R1, order_id: "sale-1", transfer_id: "tr_1" },
              { refund_id: R2, order_id: "sale-1", transfer_id: "tr_1" },
              { refund_id: R2, order_id: "sale-2", transfer_id: "tr_2" },
            ],
            error: null,
          }
        : { data: 3, error: null },
  );
  runRefund.mockResolvedValue("succeeded");
  recoverShortfalls.mockResolvedValue(1);
});
afterEach(() => {
  logs.mockRestore();
  vi.clearAllMocks();
});

describe("runRefundBackstops", () => {
  it("runs refunds due, tries each owing sale once and absorbs old shortfalls", async () => {
    runRefund.mockRejectedValueOnce(new Error("stripe down"));
    const out = await runRefundBackstops("ca", provider, Date.now() + 60_000);
    expect(runRefund.mock.calls.map((c) => c[2])).toEqual([R1, R2]);
    expect(noteRefundFailure).toHaveBeenCalledWith("ca", R1, expect.any(Error));
    expect(recoverShortfalls.mock.calls.map((c) => c.slice(2))).toEqual([
      ["sale-1", "tr_1"],
      ["sale-2", "tr_2"],
    ]);
    expect(sysRpc).toHaveBeenCalledWith("ca", "absorb_refund_shortfalls", { p_limit: 50 });
    expect(out).toEqual({ retriedRefunds: 1, absorbedShortfalls: 3 });
  });

  it("stops when the region's time is up", async () => {
    const out = await runRefundBackstops("ca", provider, Date.now() - 1);
    expect(runRefund).not.toHaveBeenCalled();
    expect(recoverShortfalls).not.toHaveBeenCalled();
    expect(sysRpc.mock.calls.map((c) => c[1])).not.toContain("absorb_refund_shortfalls");
    expect(out).toEqual({ retriedRefunds: 0, absorbedShortfalls: 0 });
  });

  it("logs a database error by name and goes on", async () => {
    sysRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const out = await runRefundBackstops("ca", provider, Date.now() + 60_000);
    expect(out).toEqual({ retriedRefunds: 0, absorbedShortfalls: 0 });
    expect(logs.mock.calls).toEqual([
      ["refund_cron_failed", "refunds_to_retry"],
      ["refund_cron_failed", "refund_shortfalls_due"],
      ["refund_cron_failed", "absorb_refund_shortfalls"],
    ]);
  });
});
