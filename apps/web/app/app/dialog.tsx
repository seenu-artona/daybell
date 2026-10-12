"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, type TextareaHTMLAttributes, useEffect, useId, useRef } from "react";

/**
 * A modal dialog for short forms. Native <dialog>: focus stays inside, Escape closes only the top dialog, and focus
 * returns to the opener. Dialogs can open on top of each other (e.g. "Add new client" inside "Create photo job").
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const t = useTranslations("app.dialog");
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
      aria-labelledby={titleId}
      // A dialog opened inside this one closes on its own; React would bubble its close event up to this one.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto max-h-[90dvh] w-[min(560px,calc(100vw-24px))] overflow-y-auto rounded-lg border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/40"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-2">
        <h2 id={titleId} className="m-0 text-h3">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="grid size-11 place-items-center rounded-md hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="p-5">{open ? children : null}</div>
    </dialog>
  );
}

/** Native select styled like Field, with a visible label and a 44px target (D91). */
export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  error?: string | undefined;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-note` : undefined}
        className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={`${id}-note`} className="text-caption text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Multi-line text with a visible label and help, styled like Field. */
export function TextAreaField({
  label,
  help,
  error,
  className,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  help?: string | undefined;
  error?: string | undefined;
}) {
  const id = useId();
  const note = error ?? help;
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        className={`min-h-22 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink hover:border-muted focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-soft)] focus:outline-none ${error ? "border-danger bg-danger-soft" : ""}`}
        {...props}
      />
      {note ? (
        <span id={`${id}-note`} className={`text-caption ${error ? "text-danger" : "text-muted"}`}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** A native checkbox with its label as the 44px click target (D91). Under it: its error, or else its help. */
export function CheckboxField({
  label,
  checked,
  onChange,
  error,
  help,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | undefined;
  help?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const id = useId();
  const note = error ?? help;
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className={`flex min-h-11 items-center gap-3 self-start text-sm text-ink ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? `${id}-note` : undefined}
          className="size-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed"
        />
        {label}
      </label>
      {note ? (
        <span id={`${id}-note`} className={`text-caption ${error ? "text-danger" : "text-muted"}`}>
          {note}
        </span>
      ) : null}
    </div>
  );
}
