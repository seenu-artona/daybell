"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS } from "./nav";

/**
 * Search, opened by the button or ⌘K / Ctrl+K (D129). Jumps between sections today; jobs, contacts and orders join
 * the results as those sections are built.
 */
export function CommandPalette() {
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
        className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-canvas px-3 text-muted hover:border-line-strong focus-visible:outline-2 focus-visible:outline-primary md:w-64"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="sr-only md:not-sr-only md:flex-1 md:text-left">{t("top.search")}</span>
        <kbd className="hidden rounded-sm border border-line px-1.5 text-caption md:inline">
          {t("top.searchShortcut")}
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
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, items.length - 1));
              if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
              if (e.key === "Enter" && items[active]) go(items[active].href);
            }}
            placeholder={t("top.searchPlaceholder")}
            aria-label={t("top.search")}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={items[active] ? `palette-${items[active].key}` : undefined}
            className="min-h-13 flex-1 bg-transparent text-body-lg outline-none"
          />
        </div>
        <ul
          id="palette-results"
          role="listbox"
          className="m-0 max-h-80 list-none overflow-y-auto p-2"
        >
          {items.length === 0 ? (
            <li className="px-3 py-2 text-muted">{t("top.searchEmpty")}</li>
          ) : null}
          {items.map((item, i) => (
            <li
              key={item.key}
              id={`palette-${item.key}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item.href)}
              onKeyDown={() => {}}
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
