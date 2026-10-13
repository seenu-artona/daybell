/**
 * The shop's per-tab memory (sessionStorage, ADR 0022): today only whether a child's cover has been seen, so the cover
 * shows once per child per tab (D119). Every key starts with the shop prefix so "Forget this device" can clear it:
 * forgetting means nothing about that gallery remains in the browser (security review R7).
 */
const PREFIX = "daybell-shop-";
const coverKey = (childId: string) => `${PREFIX}cover:${childId}`;

/** sessionStorage, or null where the browser refuses it (private modes, storage disabled). */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function coverSeen(childId: string): boolean {
  return storage()?.getItem(coverKey(childId)) != null;
}

export function markCoverSeen(childId: string): void {
  try {
    storage()?.setItem(coverKey(childId), "1");
  } catch {
    // A full or refused storage only means the cover shows again; nothing to report.
  }
}

/**
 * Clears this tab's shop memory for the given children (one forgotten gallery), or, with null, every shop key (the
 * whole device forgotten).
 */
export function forgetTabState(childIds: readonly string[] | null): void {
  const store = storage();
  if (!store) return;
  if (childIds) {
    for (const id of childIds) store.removeItem(coverKey(id));
    return;
  }
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
}
