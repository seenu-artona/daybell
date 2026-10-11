import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the studio menu is folded to its icon rail (D137), remembered per browser. Storage can fail (private
 * windows, blocked storage, full quota): every read and write is wrapped, a failed read means "open", and a choice that
 * can't be saved still holds for this page.
 */
export const MENU_FOLDED_KEY = "daybell:menu-folded";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function parseFolded(value: string | null): boolean {
  return value === "1";
}

export function readFolded(storage: Storage | undefined): boolean {
  try {
    return parseFolded(storage?.getItem(MENU_FOLDED_KEY) ?? null);
  } catch {
    return false;
  }
}

/** Saves the choice; returns false if it couldn't be saved. */
export function writeFolded(storage: Storage | undefined, folded: boolean): boolean {
  try {
    if (!storage) return false;
    storage.setItem(MENU_FOLDED_KEY, folded ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}

/** A tiny external store for useSyncExternalStore. `storage` is looked up on each use, as it may throw. */
export function createFoldStore(storage: () => Storage | undefined) {
  const listeners = new Set<() => void>();
  // This page's own choice wins over storage until another tab changes it.
  let mine: boolean | null = null;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): boolean {
      return mine ?? readFolded(storage());
    },
    set(folded: boolean): void {
      mine = folded;
      writeFolded(storage(), folded);
      notify();
    },
    /** Another tab changed the choice. */
    changedElsewhere(): void {
      mine = null;
      notify();
    },
  };
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

const store = createFoldStore(browserStorage);

function subscribe(listener: () => void): () => void {
  const unsubscribe = store.subscribe(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === MENU_FOLDED_KEY) store.changedElsewhere();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * [folded, setFolded]. The server and the first frame render the open menu (no inline script), so a folded person
 * sees the open menu for one frame while the page loads.
 */
export function useMenuFolded(): [boolean, (folded: boolean) => void] {
  const folded = useSyncExternalStore(subscribe, store.getSnapshot, () => false);
  const setFolded = useCallback((next: boolean) => store.set(next), []);
  return [folded, setFolded];
}
