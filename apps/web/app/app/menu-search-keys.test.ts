import { describe, expect, it } from "vitest";
import { type SearchKeyState, searchKeyAction } from "./menu-search-keys";

const base: SearchKeyState = { options: 3, hasActive: true, loading: false, panelOpen: true };

describe("searchKeyAction (D137, D138)", () => {
  it("opens the highlighted result on Enter once the search has answered", () => {
    expect(searchKeyAction("Enter", base)).toBe("open");
  });

  it("ignores Enter while a newer search is pending, so a stale result is never opened", () => {
    expect(searchKeyAction("Enter", { ...base, loading: true })).toBeNull();
  });

  it("ignores Enter with nothing highlighted", () => {
    expect(searchKeyAction("Enter", { ...base, hasActive: false, options: 0 })).toBeNull();
  });

  it("moves with the arrow keys only when there are options", () => {
    expect(searchKeyAction("ArrowDown", base)).toBe("next");
    expect(searchKeyAction("ArrowUp", base)).toBe("previous");
    expect(searchKeyAction("ArrowDown", { ...base, options: 0 })).toBeNull();
    expect(searchKeyAction("ArrowUp", { ...base, options: 0 })).toBeNull();
  });

  it("closes the list on the first Escape and clears the text on the second", () => {
    expect(searchKeyAction("Escape", base)).toBe("close");
    expect(searchKeyAction("Escape", { ...base, panelOpen: false })).toBe("clear");
  });

  it("leaves other keys to the input", () => {
    expect(searchKeyAction("a", base)).toBeNull();
    expect(searchKeyAction("Tab", base)).toBeNull();
  });
});
