// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import {
  BlackoutPhoto,
  BRIEF_MS,
  blackoutReducer,
  comboHeld,
  createClipboardClearer,
  initialBlackout,
  isShown,
  keyEvent,
} from "./blackout";

// Blackout mode (Seenu, Oct 14 2026; D158; ADR 0032): the photo is shown normally, goes dark at once on a screenshot
// sign and comes back when it ends (1.5 s after keys are let go); keyboard screenshot signs also empty the clipboard,
// best effort, never reading it. It says so in words and logs nothing.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("blackoutReducer", () => {
  it("shows the photo by default", () => {
    expect(isShown(initialBlackout())).toBe(true);
  });

  it.each([
    [{ type: "windowBlur" }, { type: "windowFocus" }],
    [
      { type: "visibility", hidden: true },
      { type: "visibility", hidden: false },
    ],
    [
      { type: "keys", held: true },
      { type: "keys", held: false },
    ],
    [
      { type: "brief", on: true },
      { type: "brief", on: false },
    ],
  ] as const)("goes dark on %o and comes back on %o", (on, off) => {
    const dark = blackoutReducer(initialBlackout(), on);
    expect(isShown(dark)).toBe(false);
    expect(isShown(blackoutReducer(dark, off))).toBe(true);
  });

  it("stays dark while any sign lasts", () => {
    let s = blackoutReducer(initialBlackout(), { type: "windowBlur" });
    s = blackoutReducer(s, { type: "brief", on: true });
    s = blackoutReducer(s, { type: "windowFocus" });
    expect(isShown(s)).toBe(false);
  });
});

describe("keyEvent", () => {
  const key = (type: string, key: string, mods: Partial<KeyboardEvent> = {}) =>
    keyEvent({ type, key, metaKey: false, shiftKey: false, ctrlKey: false, ...mods });

  it("counts Shift with Cmd/Win, Ctrl, or both as held, until one is let go", () => {
    expect(key("keydown", "Shift", { metaKey: true, shiftKey: true }).held).toBe(true);
    expect(key("keydown", "Shift", { ctrlKey: true, shiftKey: true }).held).toBe(true);
    expect(key("keydown", "4", { metaKey: true, ctrlKey: true, shiftKey: true }).held).toBe(true);
    expect(key("keyup", "Shift", { metaKey: true, shiftKey: true }).held).toBe(false);
    expect(key("keyup", "Meta", { metaKey: true, shiftKey: true }).held).toBe(false);
    expect(key("keyup", "Control", { ctrlKey: true, shiftKey: true }).held).toBe(false);
    expect(key("keyup", "Meta", { metaKey: true, ctrlKey: true, shiftKey: true }).held).toBe(true);
    expect(key("keydown", "Shift", { shiftKey: true }).held).toBe(false);
  });

  it("flashes on Print Screen (a screenshot key) and Cmd/Ctrl+P (not one)", () => {
    expect(key("keyup", "PrintScreen")).toEqual({ held: false, flash: true, screenshotKey: true });
    expect(key("keydown", "p", { metaKey: true })).toMatchObject({
      flash: true,
      screenshotKey: false,
    });
    expect(key("keydown", "P", { ctrlKey: true })).toMatchObject({ flash: true });
    expect(key("keydown", "p")).toMatchObject({ flash: false });
  });

  it("reads the combination from any event's modifiers", () => {
    expect(comboHeld({ shiftKey: true, metaKey: true, ctrlKey: false })).toBe(true);
    expect(comboHeld({ shiftKey: false, metaKey: true, ctrlKey: true })).toBe(false);
  });
});

describe("createClipboardClearer", () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("writes an empty string at once while the page has focus", async () => {
    const write = vi.fn(async (_text: string) => {});
    createClipboardClearer({ write, hasFocus: () => true }).request();
    await settle();
    expect(write).toHaveBeenCalledExactlyOnceWith("");
  });

  it("waits for focus to come back when the page has none", async () => {
    const write = vi.fn(async (_text: string) => {});
    const clearer = createClipboardClearer({ write, hasFocus: () => false });
    clearer.request();
    expect(write).not.toHaveBeenCalled();
    clearer.onFocus();
    await settle();
    expect(write).toHaveBeenCalledExactlyOnceWith("");
    clearer.onFocus();
    await settle();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("tries once more on the next focus when the browser refuses, then gives up silently", async () => {
    const write = vi.fn(async (_text: string) => {
      throw new DOMException("no gesture", "NotAllowedError");
    });
    const clearer = createClipboardClearer({ write, hasFocus: () => true });
    clearer.request();
    await settle();
    clearer.onFocus();
    await settle();
    clearer.onFocus();
    await settle();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a clipboard", () => {
    const clearer = createClipboardClearer({ write: undefined, hasFocus: () => true });
    expect(() => {
      clearer.request();
      clearer.onFocus();
    }).not.toThrow();
  });
});

describe("BlackoutPhoto", () => {
  let root: Root;
  let container: HTMLDivElement;
  let write: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  let focused: boolean;

  async function render(props: { write?: (text: string) => Promise<void> }) {
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <BlackoutPhoto src="/drm-test/fallback.jpg" alt="A chart" {...props} />
        </NextIntlClientProvider>,
      ),
    );
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    focused = true;
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    write = vi.fn(async (_text: string) => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await render({ write });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const region = () => container.querySelector("[data-blackout]") as HTMLElement;
  const shown = () => region().dataset.blackout === "shown";
  const status = () => (container.querySelector("[role=status]") as HTMLElement).textContent;
  const img = () => container.querySelector("img") as HTMLImageElement;
  const fire = (target: EventTarget, event: Event) =>
    act(async () => void target.dispatchEvent(event));
  const key = (type: "keydown" | "keyup", k: string, mods: KeyboardEventInit = {}) =>
    fire(window, new KeyboardEvent(type, { key: k, ...mods }));
  const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
  const flush = () =>
    act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

  it("shows the photo normally, with no instructions", () => {
    expect(shown()).toBe(true);
    expect(img().alt).toBe("A chart");
    expect(status()).toBe("");
    expect(region().hasAttribute("tabindex")).toBe(false);
  });

  it("goes dark while the window has lost focus, and comes back with it", async () => {
    await fire(window, new Event("blur"));
    expect(shown()).toBe(false);
    expect(img().alt).toBe("");
    expect(status()).toBe(messages.photoBlackout.hidden);
    await fire(window, new Event("focus"));
    expect(shown()).toBe(true);
  });

  it("goes dark while the page is hidden, and comes back when it is visible", async () => {
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await fire(document, new Event("visibilitychange"));
    expect(shown()).toBe(false);
    state.mockReturnValue("visible");
    await fire(document, new Event("visibilitychange"));
    expect(shown()).toBe(true);
  });

  it.each([
    ["Cmd+Shift", { metaKey: true, shiftKey: true }, "Shift"],
    ["Ctrl+Shift", { ctrlKey: true, shiftKey: true }, "Shift"],
    ["Win+Shift (S)", { metaKey: true, shiftKey: true }, "Meta"],
  ])(
    "goes dark while %s is held, comes back 1.5 s after release, and empties the clipboard",
    async (_name, mods, released) => {
      await key("keydown", "Shift", mods);
      expect(shown()).toBe(false);
      await wait(BRIEF_MS * 2);
      expect(shown()).toBe(false);
      await key("keyup", released, mods);
      expect(shown()).toBe(false);
      await flush();
      expect(write).toHaveBeenCalledExactlyOnceWith("");
      await wait(BRIEF_MS - 1);
      expect(shown()).toBe(false);
      await wait(1);
      expect(shown()).toBe(true);
    },
  );

  it("handles Cmd+Ctrl+Shift(+4, swallowed by macOS; to the clipboard) the same way", async () => {
    // macOS swallows the 4: the page sees the modifiers only (review #6a).
    await key("keydown", "Shift", { metaKey: true, ctrlKey: true, shiftKey: true });
    expect(shown()).toBe(false);
    await key("keyup", "Meta", { ctrlKey: true, shiftKey: true });
    expect(shown()).toBe(false);
    await key("keyup", "Control", { shiftKey: true });
    await flush();
    expect(write).toHaveBeenCalledExactlyOnceWith("");
    await wait(BRIEF_MS);
    expect(shown()).toBe(true);
  });

  it("goes dark briefly on Print Screen and empties the clipboard", async () => {
    await key("keyup", "PrintScreen");
    expect(shown()).toBe(false);
    await flush();
    expect(write).toHaveBeenCalledExactlyOnceWith("");
    await wait(BRIEF_MS);
    expect(shown()).toBe(true);
  });

  it.each([
    ["Ctrl+P", () => key("keydown", "p", { ctrlKey: true })],
    ["printing", () => fire(window, new Event("beforeprint"))],
    [
      "the context menu",
      () => fire(region(), new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    ],
  ])("goes dark briefly on %s, without touching the clipboard", async (_name, trigger) => {
    await trigger();
    expect(shown()).toBe(false);
    await wait(BRIEF_MS);
    expect(shown()).toBe(true);
    await flush();
    expect(write).not.toHaveBeenCalled();
  });

  it("leaves the clipboard alone when the window just loses focus", async () => {
    await fire(window, new Event("blur"));
    await fire(window, new Event("focus"));
    await flush();
    expect(write).not.toHaveBeenCalled();
  });

  it("isn't stuck when the key-up never arrives: focus coming back releases the keys", async () => {
    // macOS swallows the 4: the page sees the modifiers only (review #6a).
    await key("keydown", "Shift", { metaKey: true, ctrlKey: true, shiftKey: true });
    focused = false;
    await fire(window, new Event("blur"));
    focused = true;
    await fire(window, new Event("focus"));
    await flush();
    expect(write).toHaveBeenCalledExactlyOnceWith("");
    await wait(BRIEF_MS);
    expect(shown()).toBe(true);
  });

  it("isn't stuck either when a mouse move shows the keys are up", async () => {
    await key("keydown", "Shift", { metaKey: true, shiftKey: true });
    await fire(window, new MouseEvent("mousemove", { metaKey: true, shiftKey: true }));
    expect(shown()).toBe(false);
    await fire(window, new MouseEvent("mousemove"));
    await wait(BRIEF_MS);
    expect(shown()).toBe(true);
  });

  it("empties the clipboard once focus is back if the keys came up without it", async () => {
    focused = false;
    await key("keyup", "PrintScreen");
    await flush();
    expect(write).not.toHaveBeenCalled();
    focused = true;
    await fire(window, new Event("focus"));
    await flush();
    expect(write).toHaveBeenCalledExactlyOnceWith("");
  });

  it("uses the browser's clipboard, never reads it, and ignores a refusal silently", async () => {
    await act(async () => root.unmount());
    root = createRoot(container);
    const writeText = vi.fn(async (_text: string) => {
      throw new DOMException("no gesture", "NotAllowedError");
    });
    const readText = vi.fn(async () => "x");
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText, readText } });
    const log = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    await render({});
    await key("keyup", "PrintScreen");
    await flush();
    await fire(window, new Event("focus"));
    await flush();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenCalledWith("");
    expect(readText).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps one status region rendered in both states and toggles only the ink panel", async () => {
    const panel = () => container.querySelector("[data-blackout-panel]") as HTMLElement;
    const first = container.querySelector("[role=status]");
    expect(first?.className).toContain("sr-only");
    expect(panel().className).toContain("hidden");
    await fire(window, new Event("blur"));
    expect(container.querySelectorAll("[role=status]")).toHaveLength(1);
    expect(container.querySelector("[role=status]")).toBe(first);
    expect(panel().className).not.toContain("hidden");
    expect(panel().querySelector("p")?.getAttribute("aria-hidden")).toBe("true");
    expect(region().getAttribute("aria-describedby")).toBe(first?.id);
  });

  it("blocks the context menu and dragging on the photo", async () => {
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await fire(region(), menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(img().draggable).toBe(false);
  });

  it("logs nothing and sends nothing", async () => {
    const log = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    await key("keydown", "Shift", { metaKey: true, shiftKey: true });
    await key("keyup", "Shift", { metaKey: true });
    await key("keyup", "PrintScreen");
    await fire(window, new Event("blur"));
    await flush();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
