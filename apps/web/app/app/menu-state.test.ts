import { describe, expect, it } from "vitest";
import {
  createFoldStore,
  MENU_FOLDED_KEY,
  parseFolded,
  readFolded,
  writeFolded,
} from "./menu-state";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const broken = {
  getItem: (): string | null => {
    throw new Error("SecurityError");
  },
  setItem: (): void => {
    throw new Error("QuotaExceededError");
  },
};

describe("menu fold state", () => {
  it("reads only '1' as folded", () => {
    expect(parseFolded("1")).toBe(true);
    for (const value of ["0", "", "true", null]) expect(parseFolded(value)).toBe(false);
  });

  it("saves and reads the choice under its key", () => {
    const storage = memoryStorage();
    expect(readFolded(storage)).toBe(false);
    expect(writeFolded(storage, true)).toBe(true);
    expect(storage.data.get(MENU_FOLDED_KEY)).toBe("1");
    expect(readFolded(storage)).toBe(true);
    writeFolded(storage, false);
    expect(storage.data.get(MENU_FOLDED_KEY)).toBe("0");
  });

  it("is open when storage can't be read, and never throws", () => {
    expect(readFolded(broken)).toBe(false);
    expect(readFolded(undefined)).toBe(false);
    expect(writeFolded(broken, true)).toBe(false);
    expect(writeFolded(undefined, true)).toBe(false);
  });

  it("keeps this page's choice when storage fails", () => {
    const store = createFoldStore(() => broken);
    let calls = 0;
    store.subscribe(() => calls++);
    expect(store.getSnapshot()).toBe(false);
    store.set(true);
    expect(store.getSnapshot()).toBe(true);
    expect(calls).toBe(1);
  });

  it("follows a change made in another tab", () => {
    const storage = memoryStorage();
    const store = createFoldStore(() => storage);
    store.set(true);
    storage.setItem(MENU_FOLDED_KEY, "0");
    expect(store.getSnapshot()).toBe(true);
    store.changedElsewhere();
    expect(store.getSnapshot()).toBe(false);
  });
});
