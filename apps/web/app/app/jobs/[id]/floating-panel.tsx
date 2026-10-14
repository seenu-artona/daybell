"use client";

import { IconButton } from "@daybell/ui";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * The D140 floating panel: the selected item, in a 400px white card that floats over the right side of the section's
 * table, as tall as its content (never taller than the window under the sticky tab row; it scrolls inside).
 * JobSection places it; it stays in view, under the job's sticky tab row (D144), while the table scrolls. Not
 * modal: a non-modal `aside` named by its heading, and the table stays usable.
 * When `focusKey` changes (the person opened a new item), focus moves to the heading; × or Escape (with focus inside
 * the panel) closes it, and the page returns focus to the opener.
 */
export function FloatingPanel({
  title,
  meta,
  lead,
  onClose,
  focusKey,
  children,
}: {
  title: ReactNode;
  /** A short line under the title. */
  meta?: ReactNode;
  /** Before the title, e.g. an initials avatar (decorative). */
  lead?: ReactNode;
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
      onKeyDown={(e) => {
        // An open menu inside the panel closes on Escape and stops the event, so it never reaches here.
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      className="pointer-events-auto sticky top-[calc(var(--sticky-header-height)+16px)] flex max-h-[calc(100dvh-var(--sticky-header-height)-32px)] w-full flex-col gap-4 overflow-y-auto rounded-xl bg-surface p-6 shadow-lg"
    >
      <div className="flex items-center gap-3">
        {lead}
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            ref={heading}
            tabIndex={-1}
            className="m-0 text-h3 font-bold break-words focus-visible:outline-2 focus-visible:outline-primary"
          >
            {title}
          </h2>
          {meta ? <p className="m-0 text-label text-muted">{meta}</p> : null}
        </div>
        <IconButton tone="canvas" label={t("closeDetails")} onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </div>
      {children}
    </aside>
  );
}
