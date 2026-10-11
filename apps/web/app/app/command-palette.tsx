"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { SECTIONS } from "./nav";

export interface PaletteHandle {
  open: () => void;
}

/**
 * Search (D129): one modal for the whole app, opened from the top bar, the phone's Search tab, or ⌘K / Ctrl+K.
 * Jumps between sections today; jobs, contacts and orders join the results as they are built. Combobox + listbox
 * pattern inside a native modal <dialog> (focus trap, Escape, focus return).
 */
export function CommandPalette({ ref }: { ref: Ref<PaletteHandle> }) {
  const t = useTranslations("app");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(
    () =>
      SECTIONS.map((s) => ({
        key: s.key,
        href: s.href,
        label: t(`nav.${s.key}`),
        Icon: s.icon,
      })).filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase())),
    [query, t],
  );

  const open = () => {
    setQuery("");
    setActive(0);
    dialog.current?.showModal();
  };
  useImperativeHandle(ref, () => ({ open }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuery("");
        setActive(0);
        dialog.current?.showModal();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function go(href: string) {
    dialog.current?.close();
    router.push(href);
  }

  return (
    <dialog
      ref={dialog}
      aria-label={t("top.search")}
      className="m-auto mt-[12vh] w-[min(600px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-0 shadow-lg backdrop:bg-ink/40"
    >
      <div className="flex items-center gap-2 border-b border-line px-4 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-primary">
        <Search className="size-5 text-muted" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && items[active]) {
              e.preventDefault();
              go(items[active].href);
            }
          }}
          placeholder={t("top.searchPlaceholder")}
          aria-label={t("top.search")}
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="palette-results"
          aria-autocomplete="list"
          aria-activedescendant={items[active] ? `palette-${items[active].key}` : undefined}
          className="min-h-14 flex-1 bg-transparent text-body-lg outline-none"
        />
      </div>
      <p role="status" className="sr-only">
        {t("top.searchResults", { count: items.length })}
      </p>
      {items.length === 0 ? (
        <p className="m-0 px-5 py-4 text-muted">{t("top.searchEmpty")}</p>
      ) : null}
      <ul
        id="palette-results"
        role="listbox"
        aria-label={t("top.search")}
        className="m-0 max-h-80 list-none overflow-y-auto p-2 empty:hidden"
      >
        {items.map((item, i) => (
          // Keyboard selection happens in the combobox above (aria-activedescendant); clicks are for pointers.
          <li
            key={item.key}
            id={`palette-${item.key}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => go(item.href)}
            className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-3 ${i === active ? "bg-primary-soft text-primary-hover" : ""}`}
          >
            <item.Icon className="size-5" aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>
    </dialog>
  );
}
