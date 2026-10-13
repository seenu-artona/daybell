"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * A modal dialog for the shop: native <dialog>, so focus stays inside, Escape closes it and focus returns to what
 * opened it.
 */
export function ShopDialog({
  open,
  onClose,
  title,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  /** An element inside that names the dialog, instead of a title. */
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy ?? titleId}
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={
        className ??
        "m-auto w-[min(420px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-5 text-ink shadow-lg backdrop:bg-ink/50"
      }
    >
      {title ? (
        <h2 id={titleId} className="m-0 text-h3">
          {title}
        </h2>
      ) : null}
      {open ? children : null}
    </dialog>
  );
}
