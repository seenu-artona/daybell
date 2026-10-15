// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { BlackoutPhoto, blackoutReducer, initialBlackout, isShown, keyEvent } from "./blackout";

// Blackout mode (Seenu, Oct 14 2026; D158; ADR 0032): the photo shows only with the page focused and the pointer or
// keyboard focus on it, goes dark at once on signs of a screenshot, says so in words, and logs nothing.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("blackoutReducer", () => {
  const over = () => blackoutReducer(initialBlackout(true), { type: "pointerEnter" });

  it("shows only with the window active and the pointer or focus on the photo", () => {
    expect(isShown(initialBlackout(true))).toBe(false);
    expect(isShown(over())).toBe(true);
    expect(isShown(blackoutReducer(initialBlackout(true), { type: "focusIn" }))).toBe(true);
    expect(isShown(blackoutReducer(initialBlackout(false), { type: "pointerEnter" }))).toBe(false);
  });

  it.each(["windowBlur", "hidden", "pointerLeave", "trip"] as const)("goes dark on %s", (type) => {
    expect(isShown(blackoutReducer(over(), { type }))).toBe(false);
  });

  it("stays dark after a shortcut until the pointer comes back onto the photo", () => {
    let s = blackoutReducer(over(), { type: "keys", held: true, trip: true });
    expect(isShown(s)).toBe(false);
    s = blackoutReducer(s, { type: "keys", held: false, trip: false });
    expect(isShown(s)).toBe(false);
    s = blackoutReducer(s, { type: "pointerLeave" });
    s = blackoutReducer(s, { type: "pointerEnter" });
    expect(isShown(s)).toBe(true);
  });

  it("comes back when the window gets focus again", () => {
    let s = blackoutReducer(over(), { type: "windowBlur" });
    s = blackoutReducer(s, { type: "windowFocus" });
    expect(isShown(s)).toBe(true);
  });

  it("remembers the photo has been seen, for the words", () => {
    expect(initialBlackout(true).seen).toBe(false);
    expect(blackoutReducer(over(), { type: "pointerLeave" }).seen).toBe(true);
  });
});

describe("keyEvent", () => {
  const key = (type: string, key: string, mods: Partial<KeyboardEvent> = {}) =>
    keyEvent({ type, key, metaKey: false, shiftKey: false, ctrlKey: false, ...mods });

  it("counts Cmd/Win+Shift as held, in either order, until one is let go", () => {
    expect(key("keydown", "Shift", { metaKey: true, shiftKey: true })).toEqual({
      held: true,
      trip: true,
    });
    expect(key("keydown", "Meta", { metaKey: true, shiftKey: true }).held).toBe(true);
    expect(key("keyup", "Shift", { metaKey: true, shiftKey: true }).held).toBe(false);
    expect(key("keyup", "Meta", { metaKey: true, shiftKey: true }).held).toBe(false);
    expect(key("keydown", "Shift", { shiftKey: true })).toEqual({ held: false, trip: false });
  });

  it("trips on Print Screen down or up, and on Cmd/Ctrl+P", () => {
    expect(key("keydown", "PrintScreen").trip).toBe(true);
    expect(key("keyup", "PrintScreen").trip).toBe(true);
    expect(key("keydown", "p", { metaKey: true }).trip).toBe(true);
    expect(key("keydown", "P", { ctrlKey: true, shiftKey: true }).trip).toBe(true);
    expect(key("keydown", "p").trip).toBe(false);
    expect(key("keydown", "a", { ctrlKey: true }).trip).toBe(false);
  });
});

describe("BlackoutPhoto", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages}>
          <BlackoutPhoto src="/drm-test/fallback.jpg" alt="A chart" label="Test photo" />
        </NextIntlClientProvider>,
      ),
    );
    await act(async () => window.dispatchEvent(new Event("focus")));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const region = () => container.querySelector("[data-blackout]") as HTMLElement;
  const status = () => (container.querySelector("[role=status]") as HTMLElement).textContent;
  const img = () => container.querySelector("img") as HTMLImageElement;
  const fire = (target: EventTarget, event: Event) =>
    act(async () => void target.dispatchEvent(event));
  const enter = () =>
    fire(region(), new MouseEvent("pointerover", { bubbles: true, relatedTarget: document.body }));
  const leave = () =>
    fire(region(), new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
  const keyDown = (key: string, mods: KeyboardEventInit = {}) =>
    fire(window, new KeyboardEvent("keydown", { key, ...mods }));

  it("starts dark, saying how to view it in words, as a focusable named group", () => {
    expect(region().dataset.blackout).toBe("hidden");
    expect(region().getAttribute("role")).toBe("group");
    expect(region().getAttribute("aria-label")).toBe("Test photo");
    expect(region().tabIndex).toBe(0);
    expect(status()).toBe(messages.photoBlackout.start);
    expect(img().alt).toBe("");
    expect(img().draggable).toBe(false);
  });

  it("shows on hover and goes dark when the pointer leaves, saying why", async () => {
    await enter();
    expect(region().dataset.blackout).toBe("shown");
    expect(img().alt).toBe("A chart");
    expect(status()).toBe("");
    await leave();
    expect(region().dataset.blackout).toBe("hidden");
    expect(status()).toBe(messages.photoBlackout.hidden);
  });

  it("lets keyboard users view it by focusing it", async () => {
    await act(async () => region().focus());
    expect(region().dataset.blackout).toBe("shown");
    await act(async () => region().blur());
    expect(region().dataset.blackout).toBe("hidden");
  });

  it.each([
    ["the window losing focus", () => fire(window, new Event("blur"))],
    ["Cmd+Shift", () => keyDown("Shift", { metaKey: true, shiftKey: true })],
    ["Print Screen", () => keyDown("PrintScreen")],
    ["Ctrl+P", () => keyDown("p", { ctrlKey: true })],
    ["printing", () => fire(window, new Event("beforeprint"))],
    [
      "the context menu",
      () => fire(region(), new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    ],
  ])("goes dark at once on %s", async (_name, trigger) => {
    await enter();
    expect(region().dataset.blackout).toBe("shown");
    await trigger();
    expect(region().dataset.blackout).toBe("hidden");
    expect(status()).toBe(messages.photoBlackout.hidden);
  });

  it("goes dark when the page is hidden", async () => {
    await enter();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await fire(document, new Event("visibilitychange"));
    expect(region().dataset.blackout).toBe("hidden");
  });

  it("blocks the context menu on the photo", async () => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await fire(region(), event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("after a shortcut, comes back only when the pointer returns", async () => {
    await enter();
    await keyDown("Shift", { metaKey: true, shiftKey: true });
    await fire(window, new KeyboardEvent("keyup", { key: "Shift", metaKey: true }));
    expect(region().dataset.blackout).toBe("hidden");
    await leave();
    await enter();
    expect(region().dataset.blackout).toBe("shown");
  });

  it("logs nothing and sends nothing", async () => {
    const log = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    await enter();
    await keyDown("PrintScreen");
    await fire(window, new Event("blur"));
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
