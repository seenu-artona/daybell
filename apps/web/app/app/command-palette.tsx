"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS } from "./nav";

/**
 * Search, opened by the button or ⌘K / Ctrl+K (D129). Jumps between sections today; jobs, contacts and orders join
 * the results as those sections are built. Uses the combobox + listbox pattern inside a native modal <dialog>, which
 * traps focus, closes on Escape and returns focus to the button.
 */
export function CommandPalette() {
  const t = useTranslations("app");
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [isMac, setIsMac] = useState(true);

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

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
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

  function open() {
    setQuery("");
    setActive(0);
    dialog.current?.showModal();
  }

  function go(href: string) {
    dialog.current?.close();
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={t("top.search")}
        aria-keyshortcuts="Meta+K Control+K"
        className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-line bg-canvas px-3 text-muted hover:border-line-strong focus-visible:outline-2 focus-visible:outline-primary md:w-64 md:justify-start"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden md:inline md:flex-1 md:text-left" aria-hidden="true">
          {t("top.search")}
        </span>
        <kbd
          className="hidden rounded-sm border border-line px-1.5 text-caption md:inline"
          aria-hidden="true"
        >
          {isMac ? t("top.searchShortcutMac") : t("top.searchShortcutOther")}
        </kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label={t("top.search")}
        className="m-auto mt-[12vh] w-[min(560px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-0 shadow-lg backdrop:bg-ink/40"
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-muted" aria-hidden="true" />
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
            className="min-h-13 flex-1 bg-transparent text-body-lg outline-none"
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
            // Options are chosen with the keyboard from the combobox above; clicks are for pointer users.
            <li
              key={item.key}
              id={`palette-${item.key}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item.href)}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 ${i === active ? "bg-primary-soft text-primary-hover" : ""}`}
            >
              <item.Icon className="size-[18px]" aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
