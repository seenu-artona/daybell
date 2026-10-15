import { describe, expect, it } from "vitest";
import { neighbour } from "./people-list";

describe("moving through the folded list with ↑ and ↓ (D153)", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("moves to the person below or above, in the list as shown", () => {
    expect(neighbour(rows, "b", "ArrowDown")).toBe("c");
    expect(neighbour(rows, "b", "ArrowUp")).toBe("a");
  });
  it("stops at either end, and for someone filtered out of the list", () => {
    expect(neighbour(rows, "c", "ArrowDown")).toBeNull();
    expect(neighbour(rows, "a", "ArrowUp")).toBeNull();
    expect(neighbour(rows, "z", "ArrowDown")).toBeNull();
  });
});
