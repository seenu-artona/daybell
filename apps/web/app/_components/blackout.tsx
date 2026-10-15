"use client";

import { cn } from "@daybell/ui";
import { useTranslations } from "next-intl";
import {
  type FocusEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useReducer,
  useState,
} from "react";

/**
 * Blackout mode (Seenu, Oct 14 2026; D158; ADR 0032): for desktops without hardware DRM. The photo shows only while the
 * page has focus and the pointer is over it (or, for keyboard users, while it has focus). It turns to an ink panel
 * with words at once on any sign of a screenshot: the window losing focus, the page being hidden, the pointer leaving,
 * Cmd/Win+Shift held, Print Screen, Cmd/Ctrl+P or printing, the context menu. After a shortcut, printing or the context
 * menu it stays dark until the pointer comes back onto the photo or the photo gets focus again, because the capture
 * itself happens after the keys are let go. Deterrent only: no browser can stop a screenshot. Nothing is logged or
 * sent anywhere.
 *
 * Phones and tablets (no hovering, fine pointer) don't use it: they get the shop's usual blur (no split reveal).
 * Written for the parent shop to reuse.
 */
export interface BlackoutState {
  /** The window has focus and the page is visible. */
  active: boolean;
  pointerInside: boolean;
  focusInside: boolean;
  /** Cmd/Win+Shift is being held. */
  keysHeld: boolean;
  /** A shortcut, print or the context menu happened; cleared when the pointer or focus comes back to the photo. */
  tripped: boolean;
  /** The photo has been shown at least once (only the words differ). */
  seen: boolean;
}

export type BlackoutEvent =
  | { type: "windowBlur" }
  | { type: "windowFocus" }
  | { type: "hidden" }
  | { type: "pointerEnter" }
  | { type: "pointerLeave" }
  | { type: "focusIn" }
  | { type: "focusOut" }
  | { type: "keys"; held: boolean; trip: boolean }
  | { type: "trip" };

export function initialBlackout(active: boolean): BlackoutState {
  return {
    active,
    pointerInside: false,
    focusInside: false,
    keysHeld: false,
    tripped: false,
    seen: false,
  };
}

export function isShown(s: BlackoutState): boolean {
  return s.active && (s.pointerInside || s.focusInside) && !s.keysHeld && !s.tripped;
}

export function blackoutReducer(s: BlackoutState, e: BlackoutEvent): BlackoutState {
  const next = ((): BlackoutState => {
    switch (e.type) {
      case "windowBlur":
      case "hidden":
        return { ...s, active: false };
      case "windowFocus":
        return { ...s, active: true };
      case "pointerEnter":
        return { ...s, pointerInside: true, tripped: false };
      case "pointerLeave":
        return { ...s, pointerInside: false };
      case "focusIn":
        return { ...s, focusInside: true, tripped: false };
      case "focusOut":
        return { ...s, focusInside: false };
      case "keys":
        return { ...s, keysHeld: e.held, tripped: s.tripped || e.trip };
      case "trip":
        return { ...s, tripped: true };
    }
  })();
  return isShown(next) && !next.seen ? { ...next, seen: true } : next;
}

/** What a key event means: Cmd/Win+Shift held (the start of macOS and Windows screenshot shortcuts), Print Screen,
 * or Cmd/Ctrl+P (print). The key being released no longer counts as held. */
export function keyEvent(
  e: Pick<KeyboardEvent, "type" | "key" | "metaKey" | "shiftKey" | "ctrlKey">,
): { held: boolean; trip: boolean } {
  const down = e.type === "keydown";
  const meta = e.metaKey && !(!down && e.key === "Meta");
  const shift = e.shiftKey && !(!down && e.key === "Shift");
  const held = meta && shift;
  const print = down && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p";
  return { held, trip: (down && held) || e.key === "PrintScreen" || print };
}

/** True on a desktop: a pointer that can hover and point finely. False until mounted (no reveal while rendering). */
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

/** The blackout's state and the handlers for the photo's region. */
export function useBlackout() {
  const [state, dispatch] = useReducer(blackoutReducer, undefined, () => initialBlackout(false));

  useEffect(() => {
    if (document.visibilityState === "visible" && document.hasFocus())
      dispatch({ type: "windowFocus" });
    const onBlur = () => dispatch({ type: "windowBlur" });
    const onFocus = () => dispatch({ type: "windowFocus" });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") dispatch({ type: "hidden" });
    };
    const onKey = (e: KeyboardEvent) => dispatch({ type: "keys", ...keyEvent(e) });
    const trip = () => dispatch({ type: "trip" });
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("beforeprint", trip);
    window.addEventListener("contextmenu", trip, true);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("beforeprint", trip);
      window.removeEventListener("contextmenu", trip, true);
    };
  }, []);

  const regionProps = {
    tabIndex: 0,
    onPointerEnter: useCallback(() => dispatch({ type: "pointerEnter" }), []),
    onPointerLeave: useCallback(() => dispatch({ type: "pointerLeave" }), []),
    onFocus: useCallback((e: FocusEvent) => {
      if (e.target === e.currentTarget) dispatch({ type: "focusIn" });
    }, []),
    onBlur: useCallback((e: FocusEvent) => {
      if (e.target === e.currentTarget) dispatch({ type: "focusOut" });
    }, []),
    onContextMenu: useCallback((e: MouseEvent) => e.preventDefault(), []),
  };
  return { shown: isShown(state), seen: state.seen, regionProps };
}

/**
 * A photo in blackout mode. `label` names the photo for screen readers; the words on the dark panel are announced
 * in a status region, so the hidden state is never colour only. Not draggable, not selectable, never printed.
 */
export function BlackoutPhoto({
  src,
  alt,
  label,
  className,
}: {
  src: string;
  alt: string;
  label: string;
  className?: string;
}) {
  const t = useTranslations("photoBlackout");
  const { shown, seen, regionProps } = useBlackout();
  const statusId = useId();
  const words = seen ? t("hidden") : t("start");
  return (
    // A focusable group: keyboard users view the photo by focusing it.
    <div
      role="group"
      aria-label={label}
      aria-describedby={statusId}
      data-blackout={shown ? "shown" : "hidden"}
      className={cn(
        "relative block select-none overflow-hidden rounded-md bg-ink [-webkit-touch-callout:none] print:hidden",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
      onDragStart={(e) => e.preventDefault()}
      {...regionProps}
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
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-ink p-6 text-center",
          shown && "hidden",
        )}
      >
        <p id={statusId} role="status" className="m-0 text-body text-on-primary">
          {shown ? "" : words}
        </p>
      </div>
    </div>
  );
}
