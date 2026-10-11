"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * The D137 side panel (about 340px, white, border on the left): the selected item, or a section's own side content.
 * Closable with × to give the main area the full width. When `focusKey` changes (a new item was opened by the
 * person), focus moves to the panel's heading; the page returns focus to the opener when it closes.
 */
export function SidePanel({
  title,
  onClose,
  focusKey,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  /** Change it to move focus to the heading; null leaves focus where it is (e.g. on first load). */
  focusKey?: string | null;
  children: ReactNode;
}) {
  const t = useTranslations("app.job");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusKey) heading.current?.focus();
  }, [focusKey]);

  return (
    <aside
      aria-labelledby={headingId}
      className="sticky top-0 flex max-h-dvh w-[340px] shrink-0 flex-col self-start overflow-y-auto border-l border-line bg-surface"
    >
      <div className="flex items-start gap-2 px-5 pt-3">
        <h2
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="m-0 min-w-0 flex-1 pt-2.5 text-h3 break-words focus-visible:outline-2 focus-visible:outline-primary"
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("closeDetails")}
          className="grid size-11 shrink-0 place-items-center rounded-md text-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-5 px-5 pt-2 pb-6">{children}</div>
    </aside>
  );
}
