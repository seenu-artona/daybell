"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Focus back on a row's name link once the list has unfolded (D153, D91: WCAG 2.4.3). Unfolding changes the address,
 * and the full table replaces the folded list only after the router has applied it, so focusing at once would land on
 * the folded list's link, which is about to go. `returnTo(id)` waits until no one is open (`openId` null), then
 * focuses the element `idFor(id)` on the next frame, after the table has rendered.
 */
export function useReturnFocus(
  openId: string | null,
  idFor: (id: string) => string,
): (id: string | null) => void {
  // A ref, so clearing it doesn't re-run the effect and cancel the frame it just asked for.
  const pending = useRef<string | null>(null);
  const [asked, setAsked] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `asked` only says returnTo was called.
  useEffect(() => {
    if (openId !== null || pending.current === null) return;
    const target = idFor(pending.current);
    pending.current = null;
    const frame = requestAnimationFrame(() => document.getElementById(target)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [openId, asked, idFor]);
  return useCallback((id: string | null) => {
    pending.current = id;
    setAsked((n) => n + 1);
  }, []);
}
