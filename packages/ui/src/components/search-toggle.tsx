"use client";

import { Search } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { iconButtonVariants } from "./icon-button";

export interface SearchToggleProps {
  /** The accessible name of both the button and the search box, e.g. "Search children". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter. When given, the box is a search form; otherwise it filters as people type. */
  onSubmit?: (value: string) => void;
  /** Extra help read with the box (e.g. "For example 7KQ2-M9XA"). */
  description?: string;
  maxLength?: number;
  className?: string;
}

/**
 * A search that stays a 44px icon button until it is needed (D144). Opening it shows a search box with the same name
 * and moves focus into it. Escape on an empty box closes it and puts focus back on the button; leaving an empty box
 * closes it too. With text in it, it stays open so the filter stays visible.
 */
export function SearchToggle({
  label,
  value,
  onChange,
  onSubmit,
  description,
  maxLength,
  className,
}: SearchToggleProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const helpId = `${id}-help`;
  const [opened, setOpened] = useState(value !== "");
  const open = opened || value !== "";
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const focusOnClose = useRef(false);

  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      input.current?.focus();
    }
    if (!open && focusOnClose.current) {
      focusOnClose.current = false;
      button.current?.focus();
    }
  }, [open]);

  if (!open) {
    return (
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={false}
        aria-controls={inputId}
        onClick={() => {
          focusOnOpen.current = true;
          setOpened(true);
        }}
        className={cn(iconButtonVariants({ tone: "quiet" }), className)}
      >
        <Search aria-hidden="true" />
      </button>
    );
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && value === "") {
      event.preventDefault();
      event.stopPropagation();
      focusOnClose.current = true;
      setOpened(false);
    }
  }

  const box = (
    <label
      className={cn(
        "flex h-11 w-64 items-center gap-2 rounded-full bg-surface px-4 text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary",
        className,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <input
        ref={input}
        id={inputId}
        type="search"
        aria-label={label}
        aria-describedby={description ? helpId : undefined}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keyDown}
        onBlur={() => {
          if (value === "") setOpened(false);
        }}
        placeholder={label}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-muted"
      />
      {description ? (
        <span id={helpId} className="sr-only">
          {description}
        </span>
      ) : null}
    </label>
  );

  if (!onSubmit) return box;
  return (
    <form
      role="search"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      {box}
    </form>
  );
}
