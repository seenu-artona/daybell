import { describe, expect, it } from "vitest";
import { AVATAR_TONES, avatarTone, childInitials } from "./avatar";

describe("childInitials", () => {
  it("takes the first letter of each name, upper case", () => {
    expect(childInitials("Maya", "Johnson")).toBe("MJ");
    expect(childInitials("liam", "chen")).toBe("LC");
    expect(childInitials("  Émile", "Ørsted")).toBe("ÉØ");
  });

  it("skips anything that isn't a letter or digit, and copes with an empty name", () => {
    expect(childInitials("'Ana", "-Lee")).toBe("AL");
    expect(childInitials("Zoe", "")).toBe("Z");
  });
});

describe("avatarTone", () => {
  it("is always one of the soft tones and stable for an id", () => {
    const id = "6f1c2b7e-1d1a-4c4e-9a63-0c0f1f6b9a10";
    expect(AVATAR_TONES).toContain(avatarTone(id));
    expect(avatarTone(id)).toBe(avatarTone(id));
  });

  it("spreads ids across the tones", () => {
    const tones = new Set(
      Array.from({ length: 40 }, (_, i) =>
        avatarTone(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      ),
    );
    expect(tones.size).toBeGreaterThan(1);
  });
});
