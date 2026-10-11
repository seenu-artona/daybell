"use client";

import { ChevronDown, Plus } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

export interface ComboboxOption {
  id: string;
  name: string;
  /** Shown muted after the name, e.g. a client's city. */
  detail?: string | null;
}

const OPTION = "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2";

/**
 * A picker as one field (D133, ADR 0010): an ARIA 1.2 combobox with a listbox. The list opens on click, typing or
 * ArrowDown, not on focus alone, so it stays shut when focus returns from a dialog. Arrow keys move, Enter picks the
 * active option, Escape closes the list (and only the list). Nothing is active until the arrow keys or pointer choose,
 * so Enter alone submits the form. "+ Add new …" is always the last option, so with nothing to pick it is the only one.
 * `search` may call the API (clients) or filter a list already loaded (classes); only its newest answer is used.
 */
export function Combobox<T extends ComboboxOption>({
  label,
  placeholder,
  listLabel,
  value,
  onChange,
  search,
  addNewLabel,
  onAddNew,
  error,
}: {
  label: string;
  placeholder: string;
  listLabel: string;
  value: { id: string; name: string } | null;
  onChange: (option: T | null) => void;
  search: (query: string) => Promise<T[] | null>;
  addNewLabel: string;
  onAddNew: (typed: string) => void;
  error?: string | undefined;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const [text, setText] = useState(value?.name ?? "");
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  // -1: no option is active, so Enter submits the form instead of picking something nobody chose.
  const [active, setActive] = useState(-1);
  const [results, setResults] = useState<T[]>([]);
  // Only the newest search may fill the list; slower, older answers are dropped.
  const latest = useRef(0);
  const searchRef = useRef(search);
  searchRef.current = search;

  // Show the chosen option's name when it changes from outside (e.g. one just added).
  useEffect(() => {
    setText(value?.name ?? "");
  }, [value]);

  const query = typed ? text.trim() : "";
  // A new query makes the old results stale: drop them, so Enter can't pick one during the pause before searching.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the query changes.
  useEffect(() => {
    setResults([]);
    setActive(-1);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      const seq = ++latest.current;
      const found = await searchRef.current(query);
      if (found && seq === latest.current) {
        setResults(found);
        setActive(-1);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

  // The options: matches, then "Add new …" last.
  const count = results.length + 1;
  const addIndex = results.length;

  // Keep the active option in sight as the arrow keys move through a long list.
  useEffect(() => {
    if (active >= 0)
      document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);

  function close() {
    setOpen(false);
    setTyped(false);
    setActive(-1);
    // Clearing the field removes the choice; anything else half-typed goes back to the chosen name.
    if (!text.trim()) onChange(null);
    else setText(value?.name ?? "");
  }

  function pick(index: number) {
    if (index === addIndex) {
      setOpen(false);
      setTyped(false);
      setText(value?.name ?? "");
      onAddNew(typed ? text.trim() : "");
      return;
    }
    const option = results[index];
    if (!option) return;
    onChange(option);
    setText(option.name);
    setTyped(false);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape" && open) {
      // Close the list only; the dialog stays open.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setTyped(true);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            if (open) close();
          }}
          onKeyDown={onKeyDown}
          className={`min-h-11 w-full rounded-md border border-line-strong bg-surface pr-10 pl-3 text-sm text-ink hover:border-muted focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-soft)] focus:outline-none ${error ? "border-danger bg-danger-soft" : ""}`}
        />
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label={listLabel}
        hidden={!open}
        className="absolute inset-x-0 top-full z-20 m-0 mt-1 max-h-64 list-none overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-md"
      >
        {results.map((option, i) => (
          // Keyboard focus stays in the combobox (aria-activedescendant); clicks are for pointers.
          <li
            key={option.id}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(i)}
            className={`${OPTION} ${i === active ? "bg-primary-soft text-primary-hover" : ""}`}
          >
            <span className="min-w-0 flex-1 truncate font-semibold">{option.name}</span>
            {option.detail ? <span className="text-sm text-muted">{option.detail}</span> : null}
          </li>
        ))}
        <li
          id={`${id}-opt-${addIndex}`}
          role="option"
          aria-selected={active === addIndex}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setActive(addIndex)}
          onClick={() => pick(addIndex)}
          className={`${OPTION} font-semibold text-primary ${active === addIndex ? "bg-primary-soft" : ""}`}
        >
          <Plus className="size-4" aria-hidden="true" />
          {addNewLabel}
        </li>
      </ul>
      {error ? (
        <span id={errorId} className="text-caption text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
