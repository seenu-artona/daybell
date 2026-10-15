import { describe, expect, it } from "vitest";
import { photoChipFrom, photoChipFromSaved, photosHref, samePhotoChip } from "./photo-chips";

const GROUP = "0B6F7C1E-2A7D-4C55-9D0E-3F1A2B3C4D5E";
const from = (query: string) => photoChipFrom(new URLSearchParams(query));

describe("Photos' chips in the address (D156, D113)", () => {
  it("reads All, To review and a group by id", () => {
    expect(from("")).toEqual({ chip: { kind: "all" }, clean: false });
    expect(from("show=review")).toEqual({ chip: { kind: "review" }, clean: false });
    expect(from(`group=${GROUP}`)).toEqual({
      chip: { kind: "group", id: GROUP.toLowerCase() },
      clean: false,
    });
  });

  it("keeps the open photo and the bin beside the chip", () => {
    expect(from("show=review&photo=x")).toEqual({ chip: { kind: "review" }, clean: false });
    expect(from("bin=1")).toEqual({ chip: { kind: "all" }, clean: false });
  });

  it("turns anything else into All and asks for a clean address", () => {
    for (const query of [
      "show=all",
      "group=Choir",
      `show=review&group=${GROUP}`,
      "class=x",
      "q=Maya",
    ])
      expect(from(query), query).toEqual({ chip: { kind: "all" }, clean: true });
  });

  it("writes addresses with ids and enum words only", () => {
    const base = "/app/jobs/j/photos";
    expect(photosHref(base, { kind: "all" })).toBe(base);
    expect(photosHref(base, { kind: "review" })).toBe(`${base}?show=review`);
    expect(photosHref(base, { kind: "group", id: "g" }, { photoId: "p" })).toBe(
      `${base}?group=g&photo=p`,
    );
    expect(photosHref(base, { kind: "review" }, { bin: true })).toBe(`${base}?bin=1`);
  });

  it("compares chips and reads saved Group chips only", () => {
    expect(samePhotoChip({ kind: "group", id: "a" }, { kind: "group", id: "a" })).toBe(true);
    expect(samePhotoChip({ kind: "all" }, { kind: "review" })).toBe(false);
    expect(photoChipFromSaved({ key: "group", value: "a" })).toEqual({ kind: "group", id: "a" });
    expect(photoChipFromSaved({ key: "group", value: null })).toBeNull();
    expect(photoChipFromSaved({ key: "class", value: "a" })).toBeNull();
  });
});
