// @vitest-environment jsdom
import type { TaggedPhoto } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { PhotoStrip } from "./photo-strip";
import { ReviewContext, type ReviewContextValue } from "./review-context";
import { type ReviewState, SelectionBar } from "./review-state";

// A person's line and the selection bar (D156; ADR 0030): the first card photo leads with an outline, a QR icon and the
// words "QR card" (C15, never colour alone); a tile opens the photo with its alt text, never a filename; group photos
// are never given to a person (C8) and Leftovers are never "Looks right" (C9).
let root: Root;
let container: HTMLDivElement;
async function render(ui: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
        {ui}
      </NextIntlClientProvider>,
    );
  });
}
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const photo = (id: string, over: Partial<TaggedPhoto> = {}): TaggedPhoto => ({
  id,
  status: "ready",
  place: "child",
  flag: null,
  childId: "c",
  cardId: null,
  manual: false,
  cardRead: false,
  qrKind: "none",
  actions: { move: true, confirm: true, markCard: true, undoCard: false },
  thumbUrl: `https://s3.test/${id}.webp`,
  ...over,
});

function context(over: Partial<ReviewContextValue> = {}): ReviewContextValue {
  return {
    jobId: "j",
    canEdit: true,
    canUndoCard: false,
    version: 0,
    checked: new Map(),
    toggle: vi.fn(),
    move: vi.fn(),
    openGive: vi.fn(),
    openPhoto: vi.fn(),
    reconcile: vi.fn(),
    startLoad: () => () => {},
    ...over,
  };
}

describe("PhotoStrip", () => {
  it("leads a person's line with their QR card photo, outlined and said in words", async () => {
    const card = photo("p1", { place: "card", cardRead: true, qrKind: "card" });
    await render(
      <ReviewContext.Provider value={context()}>
        <PhotoStrip photos={[card, photo("p2")]} where="Maya Johnson" leadCard />
      </ReviewContext.Provider>,
    );
    const tiles = container.querySelectorAll("li");
    expect(tiles[0]?.textContent).toContain("QR card");
    expect(tiles[0]?.querySelector("svg")).not.toBeNull();
    expect(tiles[0]?.querySelector("button")?.className).toMatch(/outline-primary/);
    expect(tiles[1]?.textContent).not.toContain("QR card");
  });

  it("opens a photo with its place and number, never its file name", async () => {
    const openPhoto = vi.fn();
    await render(
      <ReviewContext.Provider value={context({ openPhoto })}>
        <PhotoStrip photos={[photo("p1"), photo("p2")]} where="Maya Johnson" />
      </ReviewContext.Provider>,
    );
    const second = container.querySelectorAll("li button")[1] as HTMLButtonElement;
    expect(second.getAttribute("aria-label")).toBe("Open Maya Johnson, photo 2");
    expect(second.querySelector("img")?.getAttribute("alt")).toBe("Maya Johnson, photo 2");
    await act(async () => second.click());
    expect(openPhoto).toHaveBeenCalledWith("p2", "Maya Johnson, photo 2");
  });

  it("gives staff no tick boxes", async () => {
    await render(
      <ReviewContext.Provider value={context({ canEdit: false })}>
        <PhotoStrip photos={[photo("p1")]} where="Leftovers" />
      </ReviewContext.Provider>,
    );
    expect(container.querySelector("input[type=checkbox]")).toBeNull();
  });
});

describe("SelectionBar", () => {
  const state = (selected: TaggedPhoto[]) =>
    ({
      context: context({ checked: new Map(selected.map((p) => [p.id, p])) }),
      checked: new Map(selected.map((p) => [p.id, p])),
      waiting: false,
      actions: { move: vi.fn(), confirm: vi.fn(), undoCard: vi.fn(), moveToBin: vi.fn() },
      setGiving: vi.fn(),
      clear: vi.fn(),
    }) as unknown as ReviewState;
  const names = () => [...container.querySelectorAll("button")].map((b) => b.textContent);

  it("offers Give to a person and Looks right for a person's photos", async () => {
    await render(<SelectionBar state={state([photo("p1")])} />);
    expect(names()).toEqual([
      "Give to a person",
      "Looks right",
      "It's a card photo",
      "Move to bin",
      "Clear",
    ]);
  });

  it("never gives a group photo to a person (C8), and Leftovers are given or binned (C9)", async () => {
    const group = photo("g", {
      place: "groupPhoto",
      actions: { move: false, confirm: true, markCard: true, undoCard: false },
    });
    await render(<SelectionBar state={state([group])} />);
    expect(names()).not.toContain("Give to a person");
    const leftover = photo("l", {
      place: "leftovers",
      actions: { move: true, confirm: false, markCard: true, undoCard: false },
    });
    await render(<SelectionBar state={state([leftover])} />);
    expect(names()).toContain("Give to a person");
    expect(names()).not.toContain("Looks right");
  });
});
