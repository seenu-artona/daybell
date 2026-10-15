// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEF_MS } from "@/app/_components/blackout";
import messages from "@/messages/en-US.json";
import { ProtectedImage } from "./protected-image";
import { ProtectionProvider } from "./protection";

// Blackout across the shop on computers, the blur on phones (D158; ADR 0034, C1, C14): one set of window listeners
// for every photo; on a computer a screenshot sign turns each photo into an ink panel, said once in words, and keyboard
// signs (never the window losing focus) empty the clipboard; on a phone photos blur and the clipboard is left alone.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HIDDEN = "Photo hidden while a screenshot may be taken. It comes back in a moment.";
let root: Root;
let host: HTMLDivElement;
let write: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

function pointer(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query === "(hover: hover) and (pointer: fine)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

async function render() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages}>
        <ProtectionProvider write={write}>
          {[1, 2, 3].map((n) => (
            <ProtectedImage
              key={n}
              src={`https://photos.example.test/${n}.webp`}
              alt={`Ava, photo ${n} of 3`}
            />
          ))}
        </ProtectionProvider>
      </NextIntlClientProvider>,
    ),
  );
}

const key = (type: "keydown" | "keyup", k: string, mods: KeyboardEventInit = {}) =>
  act(async () => void window.dispatchEvent(new KeyboardEvent(type, { key: k, ...mods })));
const panels = () => host.querySelectorAll("[data-blackout-panel]");
const statusWords = () =>
  [...host.querySelectorAll('[role="status"]')].map((s) => s.textContent).join("|");
const imgs = () => [...host.querySelectorAll("img")];

beforeEach(() => {
  vi.useFakeTimers();
  write = vi.fn(async () => {});
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("on a computer: Blackout (C1)", () => {
  beforeEach(() => pointer(true));

  it("listens once for the whole shop, however many photos", async () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    await render();
    // The set is re-made once the pointer is known (phone first, then computer); one is listening at a time.
    const count = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === "keydown").length;
    expect(count(added) - count(removed)).toBe(1);
  });

  it("turns every photo dark on Cmd+Shift, says so once, and clears the clipboard after the keys are let go", async () => {
    await render();
    expect(panels()).toHaveLength(0);
    expect(host.querySelector("[data-shop-protection]")?.getAttribute("data-shop-protection")).toBe(
      "clear",
    );
    await key("keydown", "Shift", { metaKey: true, shiftKey: true });
    expect(panels()).toHaveLength(3);
    for (const panel of panels()) {
      expect(panel.getAttribute("aria-hidden")).toBe("true");
      expect(panel.textContent).toBe(HIDDEN);
    }
    expect(imgs().every((img) => img.alt === "" && img.className.includes("invisible"))).toBe(true);
    expect(statusWords().split(HIDDEN)).toHaveLength(2);
    expect(host.querySelector("[data-shop-protection]")?.getAttribute("data-shop-protection")).toBe(
      "dark",
    );
    await key("keyup", "Shift", { metaKey: true });
    expect(write).toHaveBeenCalledWith("");
    expect(panels()).toHaveLength(3);
    await act(async () => void vi.advanceTimersByTime(BRIEF_MS));
    expect(panels()).toHaveLength(0);
    expect(imgs().map((img) => img.alt)).toEqual([
      "Ava, photo 1 of 3",
      "Ava, photo 2 of 3",
      "Ava, photo 3 of 3",
    ]);
    expect(statusWords()).not.toContain(HIDDEN);
  });

  it("goes dark while the window has no focus, without touching the clipboard (C14)", async () => {
    await render();
    await act(async () => void window.dispatchEvent(new Event("blur")));
    expect(panels()).toHaveLength(3);
    await act(async () => void window.dispatchEvent(new Event("focus")));
    expect(panels()).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("goes dark on Print Screen and clears the clipboard; a pure Ctrl+Shift counts too (Windows)", async () => {
    await render();
    await key("keyup", "PrintScreen");
    expect(panels()).toHaveLength(3);
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(BRIEF_MS));
    await key("keydown", "Shift", { ctrlKey: true, shiftKey: true });
    expect(panels()).toHaveLength(3);
  });
});

describe("on a computer: what counts as a sign (review #6)", () => {
  beforeEach(() => pointer(true));

  it("a chord with another key in it (Ctrl+Shift+V) is a shortcut: no lingering dark, no clipboard clear", async () => {
    await render();
    await key("keydown", "Shift", { ctrlKey: true, shiftKey: true });
    expect(panels()).toHaveLength(3);
    await key("keydown", "V", { ctrlKey: true, shiftKey: true });
    expect(panels()).toHaveLength(0);
    await key("keyup", "V", { ctrlKey: true, shiftKey: true });
    expect(panels()).toHaveLength(0);
    await key("keyup", "Shift", { ctrlKey: true });
    await key("keyup", "Control");
    expect(panels()).toHaveLength(0);
    await act(async () => void vi.advanceTimersByTime(BRIEF_MS));
    expect(write).not.toHaveBeenCalled();
    // The next chord, a pure one, counts again.
    await key("keydown", "Shift", { metaKey: true, shiftKey: true });
    expect(panels()).toHaveLength(3);
  });

  it.each(["Home", "ArrowLeft", "z"])("Ctrl+Shift+%s is a shortcut too", async (k) => {
    await render();
    await key("keydown", "Shift", { ctrlKey: true, shiftKey: true });
    await key("keydown", k, { ctrlKey: true, shiftKey: true });
    await key("keyup", "Shift", { ctrlKey: true });
    await act(async () => void vi.advanceTimersByTime(10));
    expect(panels()).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it("chords typed in a field never count", async () => {
    await render();
    const field = document.createElement("input");
    document.body.append(field);
    const typed = (type: string, k: string, mods: KeyboardEventInit = {}) =>
      act(
        async () =>
          void field.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, ...mods })),
      );
    await typed("keydown", "Shift", { metaKey: true, shiftKey: true });
    expect(panels()).toHaveLength(0);
    await typed("keyup", "Shift", { metaKey: true });
    await act(async () => void vi.advanceTimersByTime(10));
    expect(panels()).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
    field.remove();
  });

  it("small thumbnails show an icon only; the words are for sight on larger photos and the status (#18)", async () => {
    await render();
    await act(async () => void window.dispatchEvent(new Event("blur")));
    const panel = panels()[0] as HTMLElement;
    expect(panel.className).toContain("@container");
    expect(panel.querySelector("[data-blackout-icon]")?.getAttribute("class")).toContain(
      "@[120px]:hidden",
    );
    expect(panel.querySelector("[data-blackout-words]")?.className).toContain(
      "hidden @[120px]:inline",
    );
    expect(statusWords()).toContain(HIDDEN);
  });

  it("stays on whatever the DRM switch says (#6d): it doesn't read it", async () => {
    // ProtectionProvider has no DRM input at all; rendered here without any DrmProvider.
    await render();
    await act(async () => void window.dispatchEvent(new Event("blur")));
    expect(panels()).toHaveLength(3);
  });
});

describe("on a phone: the blur, as before (C1)", () => {
  beforeEach(() => pointer(false));

  it("blurs every photo while the page has no focus, with no panels and no words", async () => {
    await render();
    await act(async () => void window.dispatchEvent(new Event("blur")));
    expect(host.querySelector("[data-shop-protection]")?.getAttribute("data-shop-protection")).toBe(
      "blurred",
    );
    expect(imgs().every((img) => img.className.includes("blur-2xl"))).toBe(true);
    expect(imgs().every((img) => img.alt.startsWith("Ava"))).toBe(true);
    expect(panels()).toHaveLength(0);
    expect(statusWords()).not.toContain(HIDDEN);
  });

  it("is exactly round 7: no blur for the context menu, Ctrl+Shift or Cmd/Ctrl+P; a brief one for Cmd+Shift (#6c)", async () => {
    await render();
    const blurred = () => imgs().every((img) => img.className.includes("blur-2xl"));
    await act(
      async () => void window.dispatchEvent(new MouseEvent("contextmenu", { cancelable: true })),
    );
    expect(blurred()).toBe(false);
    await key("keydown", "Shift", { ctrlKey: true, shiftKey: true });
    expect(blurred()).toBe(false);
    await key("keydown", "p", { metaKey: true });
    await key("keydown", "p", { ctrlKey: true });
    expect(blurred()).toBe(false);
    await key("keydown", "Shift", { metaKey: true, shiftKey: true });
    expect(blurred()).toBe(true);
    await act(async () => void vi.advanceTimersByTime(BRIEF_MS));
    expect(blurred()).toBe(false);
    await key("keyup", "PrintScreen");
    expect(blurred()).toBe(true);
  });

  it("never clears the clipboard", async () => {
    await render();
    await key("keydown", "Shift", { metaKey: true, shiftKey: true });
    await key("keyup", "Shift", { metaKey: true });
    await key("keyup", "PrintScreen");
    await act(async () => void vi.advanceTimersByTime(BRIEF_MS));
    expect(write).not.toHaveBeenCalled();
  });

  it("says why a long-press or right-click did nothing", async () => {
    await render();
    const image = host.querySelector("img")?.parentElement as HTMLElement;
    await act(
      async () =>
        void image.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        ),
    );
    expect(statusWords()).toContain(
      "Photos are protected and shown at low resolution with a watermark.",
    );
  });
});
