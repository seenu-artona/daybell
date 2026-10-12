/**
 * Calls `restored` when the browser shows this page again from its back-forward cache (the owner pressed Back on
 * Stripe's pages): React state is restored as it was when they left, so anything that was "in progress" (e.g.
 * "Opening Stripe…") must be reset. Returns the clean-up for useEffect.
 */
export function onRestoredFromCache(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  restored: () => void,
): () => void {
  const listener = (event: Event) => {
    if ((event as Event & { persisted?: boolean }).persisted) restored();
  };
  target.addEventListener("pageshow", listener);
  return () => target.removeEventListener("pageshow", listener);
}
