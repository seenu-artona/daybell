import "server-only";

/**
 * How many DRM test tokens one person may get a minute (spike; D158; ADR 0032). A page load asks for one, plus one per
 * license request, so 30 leaves room for many retries and stops a script minting tokens.
 */
export const DRM_TOKENS_PER_MINUTE = 30;

/** Past this many people, finished windows are dropped so the map can't grow without bound. */
const PRUNE_AT = 1000;

export type Take = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * A fixed one-minute window per person, the shape of the payout routes' take_stripe_call (ADR 0020), kept in the
 * function instance's memory: best effort, since each Vercel instance counts on its own. Enough for an owners-and-
 * admins test page behind a flag; the parent shop would need the database's count (ADR 0032, calls). Keyed by the
 * verified user id only; nothing else is stored.
 */
export function createTokenBudget(limit: number = DRM_TOKENS_PER_MINUTE) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(userId: string, now: number = Date.now()): Take {
      const start = Math.floor(now / 60_000) * 60_000;
      if (windows.size >= PRUNE_AT)
        for (const [id, w] of windows) if (w.start !== start) windows.delete(id);
      const current = windows.get(userId);
      const count = current?.start === start ? current.count + 1 : 1;
      windows.set(userId, { start, count });
      if (count <= limit) return { ok: true };
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((start + 60_000 - now) / 1000)),
      };
    },
    size: () => windows.size,
  };
}

export const drmTokenBudget = createTokenBudget();
