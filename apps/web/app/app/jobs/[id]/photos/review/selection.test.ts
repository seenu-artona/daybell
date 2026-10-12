import type { TaggedPhoto } from "@daybell/api";
import { describe, expect, it } from "vitest";
import { reconcileChecked } from "./selection";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

function photo(id: string, over: Partial<TaggedPhoto> = {}): TaggedPhoto {
  return {
    id,
    status: "ready",
    place: "flagged",
    flag: "unreadableCard",
    childId: null,
    groupId: null,
    cardId: null,
    manual: false,
    cardRead: false,
    qrKind: "unreadable",
    actions: { move: false, confirm: true, markCard: true, undoCard: false },
    thumbUrl: null,
    ...over,
  } as TaggedPhoto;
}

function ticked(...photos: TaggedPhoto[]): ReadonlyMap<string, TaggedPhoto> {
  return new Map(photos.map((p) => [p.id, p]));
}

describe("reconcileChecked", () => {
  it("drops a ticked photo that left the section", () => {
    const a = photo(A);
    const b = photo(B);
    const next = reconcileChecked(ticked(a, b), [a, b], [b]);
    expect([...next.keys()]).toEqual([B]);
  });

  it("refreshes a ticked photo that is still there with the fresh data", () => {
    const stale = photo(A);
    const fresh = photo(A, {
      flag: null,
      place: "card",
      cardRead: true,
      actions: { move: false, confirm: false, markCard: false, undoCard: true },
    });
    const next = reconcileChecked(ticked(stale), [stale], [fresh]);
    expect(next.get(A)).toBe(fresh);
    expect(next.get(A)?.actions.confirm).toBe(false);
  });

  it("leaves ticked photos from other sections alone", () => {
    const a = photo(A);
    const other = photo(C, { place: "leftovers", flag: null });
    const checked = ticked(a, other);
    const next = reconcileChecked(checked, [a], []);
    expect([...next.keys()]).toEqual([C]);
    expect(next.get(C)).toBe(other);
  });

  it("on a first load (no earlier photos) drops nothing but still refreshes", () => {
    const stale = photo(A);
    const fresh = photo(A, { flag: null });
    const other = photo(C);
    const next = reconcileChecked(ticked(stale, other), null, [fresh]);
    expect(next.get(A)).toBe(fresh);
    expect(next.get(C)).toBe(other);
  });

  it("returns the same map when nothing changed", () => {
    const a = photo(A);
    const checked = ticked(a);
    expect(reconcileChecked(checked, [a], [a, photo(B)])).toBe(checked);
    const none: ReadonlyMap<string, TaggedPhoto> = new Map();
    expect(reconcileChecked(none, [a], [])).toBe(none);
  });

  it("never mutates the map it was given", () => {
    const a = photo(A);
    const b = photo(B);
    const checked = ticked(a, b);
    reconcileChecked(checked, [a, b], [photo(B, { flag: null })]);
    expect(checked.get(A)).toBe(a);
    expect(checked.get(B)).toBe(b);
  });
});
