"use client";

import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useBlackout, useDesktopPointer } from "@/app/_components/blackout";

/**
 * Screenshot and copy deterrents (D60), and Blackout on computers (D158; ADR 0034, C1). Deterrents only: no browser can
 * stop a screenshot; DRM in the large view is what actually blacks out.
 *
 * One set of listeners for the whole shop (the spike's Blackout signs, ADR 0032): the window losing focus or the page
 * hidden, Shift with Cmd/Win or Ctrl held (and 1.5 s after), Print Screen, Cmd/Ctrl+P, printing and the context menu.
 * - On a computer (a pointer that hovers and points finely), every photo (grid, viewer fallback, pose picker, bag)
 *   turns to an ink panel saying why, and keyboard screenshot signs empty the clipboard, best effort (never the window
 *   losing focus: C14). The words are announced once, politely, for the whole page.
 * - On phones and tablets, photos blur as before, and the clipboard is left alone.
 * Photos are left out of printing; right-click, long-press and dragging are blocked, and the attempt says why in one
 * quiet line. The previews themselves are low resolution and watermarked, made at upload (ADR 0016).
 */
export type ProtectionMode = "blackout" | "blur";

interface Protection {
  /** A screenshot sign is on: photos are dark (blackout) or blurred (blur). */
  concealed: boolean;
  mode: ProtectionMode;
  /** A copy attempt (right-click, long-press, drag): say why it didn't work. */
  attempted: () => void;
}

const ProtectionContext = createContext<Protection>({
  concealed: false,
  mode: "blur",
  attempted: () => {},
});

export function ProtectionProvider({
  children,
  write,
}: {
  children: ReactNode;
  /** Replaces the browser's clipboard (tests). */
  write?: (text: string) => Promise<void>;
}) {
  const t = useTranslations("shop.gallery");
  const desktop = useDesktopPointer();
  const mode: ProtectionMode = desktop ? "blackout" : "blur";
  const { shown } = useBlackout({ clearClipboard: desktop, write });
  const [notice, setNotice] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const attempted = useCallback(() => {
    setNotice(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(false), 4000);
  }, []);

  const concealed = !shown;
  const value = useMemo(() => ({ concealed, mode, attempted }), [concealed, mode, attempted]);
  return (
    <ProtectionContext.Provider value={value}>
      <div
        data-shop-protection={concealed ? (mode === "blackout" ? "dark" : "blurred") : "clear"}
        className="contents"
      >
        {children}
      </div>
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto w-fit max-w-[calc(100%-24px)]"
      >
        {notice ? (
          <p className="m-0 rounded-md bg-ink px-4 py-2.5 text-caption text-on-primary shadow-md">
            {t("protected")}
          </p>
        ) : null}
      </div>
      {/* Always rendered, so going dark is announced once for the page; the panels' own words are aria-hidden. */}
      <p role="status" className="sr-only">
        {concealed && mode === "blackout" ? t("hiddenForScreenshot") : ""}
      </p>
    </ProtectionContext.Provider>
  );
}

export function useProtection(): Protection {
  return useContext(ProtectionContext);
}
