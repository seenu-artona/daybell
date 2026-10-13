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

/**
 * Screenshot and copy deterrents (D60). Deterrents only: no browser can stop a screenshot. Photos blur while the page
 * is hidden or not focused, on the Print Screen key and on Cmd/Win+Shift (the start of the screenshot shortcuts); they
 * are left out of printing; right-click, long-press and dragging are blocked, and the attempt says why in one quiet
 * line. The previews themselves are already low resolution and watermarked, made at upload (ADR 0016).
 */
interface Protection {
  blurred: boolean;
  /** A copy attempt (right-click, long-press, drag): say why it didn't work. */
  attempted: () => void;
}

const ProtectionContext = createContext<Protection>({ blurred: false, attempted: () => {} });

const BRIEF_MS = 1500;

export function ProtectionProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("shop.gallery");
  const [hidden, setHidden] = useState(false);
  const [brief, setBrief] = useState(false);
  const [notice, setNotice] = useState(false);
  const timers = useRef<{ brief?: number; notice?: number }>({});

  useEffect(() => {
    const flash = () => {
      setBrief(true);
      window.clearTimeout(timers.current.brief);
      timers.current.brief = window.setTimeout(() => setBrief(false), BRIEF_MS);
    };
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    const onBlur = () => setHidden(true);
    const onFocus = () => setHidden(document.visibilityState === "hidden");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen" || (e.shiftKey && (e.metaKey || e.key === "Meta"))) flash();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("beforeprint", flash);
    const current = timers.current;
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("beforeprint", flash);
      window.clearTimeout(current.brief);
      window.clearTimeout(current.notice);
    };
  }, []);

  const attempted = useCallback(() => {
    setNotice(true);
    window.clearTimeout(timers.current.notice);
    timers.current.notice = window.setTimeout(() => setNotice(false), 4000);
  }, []);

  const blurred = hidden || brief;
  const value = useMemo(() => ({ blurred, attempted }), [blurred, attempted]);
  return (
    <ProtectionContext.Provider value={value}>
      <div data-shop-protection={blurred ? "blurred" : "clear"} className="contents">
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
    </ProtectionContext.Provider>
  );
}

export function useProtection(): Protection {
  return useContext(ProtectionContext);
}
