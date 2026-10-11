import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import { cn } from "../lib/cn";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: ReactNode;
  help?: ReactNode;
  /** Plain message that says what went wrong and how to fix it. Setting it marks the input invalid. */
  error?: ReactNode;
  id?: string;
}

export function Field({ label, help, error, id, className, ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const note = error ?? help;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-label text-ink">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        className={cn(
          "min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink",
          "hover:border-muted focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-soft)] focus:outline-none",
          error && "border-danger bg-danger-soft",
        )}
        {...props}
      />
      {note ? (
        <span id={noteId} className={cn("text-caption", error ? "text-danger" : "text-muted")}>
          {note}
        </span>
      ) : null}
    </div>
  );
}
