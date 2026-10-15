"use client";

import { cn } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type MouseEvent, useEffect, useId, useReducer, useRef, useState } from "react";

/**
 * Blackout mode (Seenu, Oct 14 2026; D158; ADR 0032): for computers without hardware DRM. The photo is shown normally
 * and turns to an ink panel with words at once on a sign of a screenshot, coming back when the sign ends:
 * - the window losing focus, or the page being hidden: until focus or visibility returns;
 * - Shift with Cmd, Ctrl or Win held (Cmd+Shift+3/4/5, Cmd+Ctrl+Shift+3/4, Win+Shift+S, Ctrl+Shift+…): while held, and
 *   for BRIEF_MS after they are let go, because the capture happens after the keys are released;
 * - Print Screen, Cmd/Ctrl+P or printing, the context menu: for BRIEF_MS.
 * After a keyboard screenshot sign (the Shift combinations on release, Print Screen) it also overwrites the clipboard
 * with an empty string, best effort (Seenu, Oct 14): see createClipboardClearer. Deterrent only: no browser can stop a
 * screenshot. Nothing is logged or sent, and the clipboard is never read.
 *
 * Phones and tablets (no hovering, fine pointer) don't use it: they get the shop's usual blur. Written for the parent
 * shop to reuse.
 */

/** How long the photo stays dark after a sign ends. */
export const BRIEF_MS = 1500;

export interface BlackoutState {
  /** The window has lost focus (until it gets it back). */
  blurred: boolean;
  /** The page is hidden (until it is visible again). */
  pageHidden: boolean;
  /** Shift with Cmd, Ctrl or Win is being held. */
  keysHeld: boolean;
  /** A short blackout after a sign ended (BRIEF_MS). */
  brief: boolean;
}

export type BlackoutEvent =
  | { type: "windowBlur" }
  | { type: "windowFocus" }
  | { type: "visibility"; hidden: boolean }
  | { type: "keys"; held: boolean }
  | { type: "brief"; on: boolean };

export function initialBlackout(): BlackoutState {
  return { blurred: false, pageHidden: false, keysHeld: false, brief: false };
}

export function isShown(s: BlackoutState): boolean {
  return !s.blurred && !s.pageHidden && !s.keysHeld && !s.brief;
}

export function blackoutReducer(s: BlackoutState, e: BlackoutEvent): BlackoutState {
  switch (e.type) {
    case "windowBlur":
      return { ...s, blurred: true };
    case "windowFocus":
      return { ...s, blurred: false };
    case "visibility":
      return { ...s, pageHidden: e.hidden };
    case "keys":
      return { ...s, keysHeld: e.held };
    case "brief":
      return { ...s, brief: e.on };
  }
}

type KeyLike = Pick<KeyboardEvent, "type" | "key" | "metaKey" | "shiftKey" | "ctrlKey">;

/**
 * What a key event means. `held`: Shift with Cmd/Win or Ctrl is down after this event (the key being released no
 * longer counts). `flash`: a one-off sign, Print Screen or Cmd/Ctrl+P. `screenshotKey`: Print Screen, which on Windows
 * copies the screen to the clipboard (and fires only on key-up).
 */
export function keyEvent(e: KeyLike): { held: boolean; flash: boolean; screenshotKey: boolean } {
  const down = e.type === "keydown";
  const released = (name: string) => !down && e.key === name;
  const meta = e.metaKey && !released("Meta");
  const ctrl = e.ctrlKey && !released("Control");
  const shift = e.shiftKey && !released("Shift");
  const printScreen = e.key === "PrintScreen";
  const print = down && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p";
  return { held: shift && (meta || ctrl), flash: printScreen || print, screenshotKey: printScreen };
}

/** The modifiers of any later event (a mouse move, a key) show whether the combination is still held. */
export function comboHeld(e: Pick<KeyboardEvent, "metaKey" | "shiftKey" | "ctrlKey">): boolean {
  return e.shiftKey && (e.metaKey || e.ctrlKey);
}

/**
 * Overwrites the clipboard with an empty string after a keyboard screenshot sign (Seenu, Oct 14 2026; ADR 0032), so a
 * screenshot copied to the clipboard (Cmd+Ctrl+Shift+3/4, Win+Shift+S, Print Screen) is less likely to be pasted
 * anywhere. Best effort: only while the page has focus (browsers refuse otherwise), else once when focus returns, and
 * one retry on the next focus if the browser refused; every failure is ignored, silently. It never reads the clipboard.
 */
export function createClipboardClearer(deps: {
  write: ((text: string) => Promise<void>) | undefined;
  hasFocus: () => boolean;
}) {
  let pending = false;
  let retryLeft = 0;
  const attempt = () => {
    if (!deps.write) return;
    deps.write("").then(
      () => {
        retryLeft = 0;
      },
      () => {
        if (retryLeft > 0) {
          retryLeft -= 1;
          pending = true;
        }
      },
    );
  };
  return {
    /** A keyboard screenshot sign has ended. */
    request() {
      if (!deps.write) return;
      retryLeft = 1;
      if (deps.hasFocus()) attempt();
      else pending = true;
    },
    /** The window has focus again: a waiting or refused clear gets its one more try. */
    onFocus() {
      if (!pending) return;
      pending = false;
      attempt();
    },
  };
}

function browserClipboard(): ((text: string) => Promise<void>) | undefined {
  if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function")
    return undefined;
  return (text) => navigator.clipboard.writeText(text);
}

/** True on a desktop: a pointer that can hover and point finely. False until mounted. */
export function useDesktopPointer(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

const MODIFIERS = new Set(["Shift", "Meta", "Control", "Alt", "AltGraph", "OS", "Hyper", "Super"]);

/** Typing in a field: key chords there are editing shortcuts, never screenshot signs (review #6b). */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

/**
 * Whether the photo is shown; listens to the window for screenshot signs while mounted. One set of listeners, however
 * many photos read it (the shop's ProtectionProvider, ADR 0034 C1), and re-made only when `mode` changes.
 *
 * - "blackout" (computers): the signs in this file's header, with two refinements (review #6): a Shift+Cmd/Ctrl chord
 *   is a screenshot sign only while no other key is pressed during it (macOS swallows its 3/4/5, so a pure modifier
 *   chord is the screenshot; Ctrl+Shift+V/Z/Home/Left are ordinary shortcuts and end the darkness at once, with no
 *   lingering blackout and no clipboard clear), and chords typed in a field never count. `clearClipboard` (default on)
 *   can be turned off without re-listening.
 * - "blur" (phones and tablets): exactly the shop's round-7 deterrent (ADR 0022 §5): hidden while the page is hidden
 *   or unfocused, a brief blur on Print Screen and on Shift with Cmd/Win, and when printing; no context-menu,
 *   Ctrl+Shift or Cmd/Ctrl+P signs, and the clipboard is never touched.
 */
export function useBlackout(
  options: {
    write?: ((text: string) => Promise<void>) | undefined;
    clearClipboard?: boolean;
    mode?: "blackout" | "blur";
  } = {},
): { shown: boolean } {
  const [state, dispatch] = useReducer(blackoutReducer, undefined, initialBlackout);
  const writeRef = useRef(options.write);
  writeRef.current = options.write;
  const clearRef = useRef(options.clearClipboard ?? true);
  clearRef.current = options.clearClipboard ?? true;
  const mode = options.mode ?? "blackout";

  useEffect(() => {
    let timer: number | undefined;
    const flash = () => {
      dispatch({ type: "brief", on: true });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => dispatch({ type: "brief", on: false }), BRIEF_MS);
    };
    const onBlur = () => dispatch({ type: "windowBlur" });
    const onVisibility = () =>
      dispatch({ type: "visibility", hidden: document.visibilityState === "hidden" });
    const listen = (
      target: Window | Document,
      type: string,
      fn: EventListener,
      capture = false,
    ) => {
      target.addEventListener(type, fn, capture);
      return () => target.removeEventListener(type, fn, capture);
    };

    if (mode === "blur") {
      // Round 7's phone deterrent, unchanged.
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "PrintScreen" || (e.shiftKey && (e.metaKey || e.key === "Meta"))) flash();
      };
      const onFocus = () => {
        dispatch({ type: "windowFocus" });
        dispatch({ type: "visibility", hidden: document.visibilityState === "hidden" });
      };
      const stops = [
        listen(document, "visibilitychange", onVisibility),
        listen(window, "blur", onBlur),
        listen(window, "focus", onFocus),
        listen(window, "keydown", onKey as EventListener),
        listen(window, "keyup", onKey as EventListener),
        listen(window, "beforeprint", flash),
      ];
      return () => {
        for (const stop of stops) stop();
        window.clearTimeout(timer);
        dispatch({ type: "keys", held: false });
      };
    }

    const clipboard = createClipboardClearer({
      write: (text) => {
        if (!clearRef.current) return Promise.resolve();
        const write = writeRef.current ?? browserClipboard();
        return write ? write(text) : Promise.resolve();
      },
      hasFocus: () => document.hasFocus(),
    });
    let held = false;
    // The current chord had another key in it: an ordinary shortcut, ignored until the chord ends.
    let shortcut = false;
    const setHeld = (next: boolean, quietly = false) => {
      if (next === held) return;
      held = next;
      dispatch({ type: "keys", held: next });
      if (!next && !quietly) {
        // A pure modifier chord was let go: the capture happens now. Stay dark a moment, then clear the clipboard.
        flash();
        clipboard.request();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const k = keyEvent(e);
      if (!k.held) shortcut = false;
      else if (isEditable(e.target)) shortcut = true;
      else if (e.type === "keydown" && !MODIFIERS.has(e.key)) shortcut = true;
      setHeld(k.held && !shortcut, shortcut);
      if (k.flash && !(shortcut && !k.screenshotKey)) flash();
      if (k.screenshotKey && e.type === "keyup") clipboard.request();
    };
    // macOS may swallow the key-up while its screenshot tool runs: any later event's modifiers settle it.
    const onMove = (e: globalThis.MouseEvent) => {
      if (held) setHeld(comboHeld(e));
    };
    const onFocus = () => {
      dispatch({ type: "windowFocus" });
      setHeld(false);
      shortcut = false;
      clipboard.onFocus();
    };
    const stops = [
      listen(window, "keydown", onKey as EventListener, true),
      listen(window, "keyup", onKey as EventListener, true),
      listen(window, "mousemove", onMove as EventListener, true),
      listen(window, "blur", onBlur),
      listen(window, "focus", onFocus),
      listen(document, "visibilitychange", onVisibility),
      listen(window, "beforeprint", flash),
      listen(window, "contextmenu", flash, true),
    ];
    return () => {
      for (const stop of stops) stop();
      window.clearTimeout(timer);
      dispatch({ type: "keys", held: false });
    };
  }, [mode]);

  return { shown: isShown(state) };
}

/**
 * A photo in blackout mode, shown normally until a screenshot sign. The ink panel's words are repeated in a status
 * region that is always rendered (only the panel is toggled), so going dark is announced and never shown by color
 * alone. The context menu is blocked on it; not draggable, not selectable, never printed. `write` replaces the
 * browser's clipboard (tests).
 */
export function BlackoutPhoto({
  src,
  alt,
  className,
  write,
}: {
  src: string;
  alt: string;
  className?: string;
  write?: (text: string) => Promise<void>;
}) {
  const t = useTranslations("photoBlackout");
  const { shown } = useBlackout({ write });
  const statusId = useId();
  return (
    <div
      aria-describedby={statusId}
      data-blackout={shown ? "shown" : "hidden"}
      className={cn(
        "relative block select-none overflow-hidden rounded-md bg-ink [-webkit-touch-callout:none] print:hidden",
        className,
      )}
      onDragStart={(e) => e.preventDefault()}
      onContextMenu={(e: MouseEvent) => e.preventDefault()}
    >
      {/* biome-ignore lint/performance/noImgElement: next/image would cache photos outside their region (D113). */}
      <img
        src={src}
        alt={shown ? alt : ""}
        draggable={false}
        decoding="async"
        className={cn("pointer-events-none block size-full object-contain", !shown && "invisible")}
      />
      <span aria-hidden="true" className="absolute inset-0" />
      {/* The ink panel's words are for sight; the status below says the same to screen readers. */}
      <div
        data-blackout-panel
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-ink p-6 text-center",
          shown && "hidden",
        )}
      >
        <p aria-hidden="true" className="m-0 text-body text-on-primary">
          {t("hidden")}
        </p>
      </div>
      {/* Always rendered, so the change to hidden is announced; empty while the photo shows. */}
      <p id={statusId} role="status" className="sr-only">
        {shown ? "" : t("hidden")}
      </p>
    </div>
  );
}
