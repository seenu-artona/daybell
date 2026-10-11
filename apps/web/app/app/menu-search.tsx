"use client";

import type { SearchResponse } from "@daybell/api";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type Ref, useEffect, useId, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";

const MIN_CHARS = 2;
const WAIT_MS = 250;

type Option =
  | { kind: "job"; job: SearchResponse["jobs"][number] }
  | { kind: "client"; client: SearchResponse["clients"][number] };

/**
 * The menu's search box (D137, D138; ADR 0013): finds the studio's jobs and clients, never children. ARIA 1.2 combobox
 * with a listbox of two groups. From 2 characters it waits 250ms after typing, then asks POST /search once; only the
 * newest answer is shown. Arrow keys move, Enter opens, the first Escape closes the list and the second clears the
 * text. The text is never logged and never put in a URL.
 */
export function MenuSearch({ inputRef }: { inputRef: Ref<HTMLInputElement> }) {
  const t = useTranslations("app.search");
  const ts = useTranslations("app.jobs.statuses");
  const tt = useTranslations("app.top");
  const text = useApiText();
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const latest = useRef(0);

  const term = query.trim();
  const ready = term.length >= MIN_CHARS;

  useEffect(() => {
    const request = ++latest.current;
    if (!ready) {
      setResults(null);
      setLoading(false);
      setFailed(null);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const res = await api<SearchResponse>("/search", { method: "POST", body: { q: term } });
      // A newer search (more typing) wins.
      if (request !== latest.current) return;
      setLoading(false);
      if (res.ok) {
        setResults(res.data);
        setFailed(null);
        setActive(0);
      } else {
        setResults(null);
        setFailed(text.error(res.code));
      }
    }, WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [term, ready, text]);

  const options: Option[] = results
    ? [
        ...results.jobs.map((job) => ({ kind: "job" as const, job })),
        ...results.clients.map((client) => ({ kind: "client" as const, client })),
      ]
    : [];
  const optionId = (o: Option) => `${id}-${o.kind}-${o.kind === "job" ? o.job.id : o.client.id}`;
  const showPanel = open && ready;
  const showList = showPanel && options.length > 0;
  const activeOption = showList ? options[Math.min(active, options.length - 1)] : undefined;

  function go(option: Option) {
    setQuery("");
    setOpen(false);
    setResults(null);
    router.push(
      option.kind === "job"
        ? `/app/jobs/${option.job.id}`
        : `/app/contacts/clients?client=${option.client.id}`,
    );
  }

  const renderOption = (o: Option, i: number) => {
    const selected = activeOption === o;
    return (
      // Keyboard selection happens in the combobox (aria-activedescendant); clicks are for pointers.
      <div
        key={optionId(o)}
        id={optionId(o)}
        role="option"
        aria-selected={selected}
        tabIndex={-1}
        // Keep focus in the box, so blurring it doesn't close the list before the click lands.
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setActive(i)}
        onClick={() => go(o)}
        className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-1.5 ${selected ? "bg-primary-soft" : ""}`}
      >
        <span className="truncate font-semibold text-ink">
          {o.kind === "job" ? o.job.name : o.client.name}
        </span>
        <span className="truncate text-caption text-muted">
          {o.kind === "job"
            ? t("jobMeta", { number: o.job.internalNumber, status: ts(o.job.status) })
            : (o.client.city ?? "")}
        </span>
      </div>
    );
  };

  const jobs = options.filter((o) => o.kind === "job");
  const clients = options.filter((o) => o.kind === "client");

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor={`${id}-input`} className="sr-only">
        {t("label")}
      </label>
      <div className="flex min-h-11 items-center gap-2 rounded-md bg-white/8 px-3 text-white/60 focus-within:outline-2 focus-within:outline-lime">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
          aria-keyshortcuts="Meta+K Control+K"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && options.length > 0) {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === "ArrowUp" && options.length > 0) {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && activeOption) {
              e.preventDefault();
              go(activeOption);
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (showPanel) setOpen(false);
              else setQuery("");
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/60"
        />
      </div>

      {/* Always rendered, so the count is announced when it changes (WCAG 4.1.3). */}
      <p role="status" className="sr-only">
        {showPanel && results ? tt("searchResults", { count: options.length }) : ""}
      </p>

      {showPanel ? (
        <div className="absolute top-full left-0 z-40 mt-1 w-[360px] rounded-lg border border-line bg-surface p-2 text-sm text-ink shadow-lg">
          {showList ? (
            <div id={listId} role="listbox" aria-label={t("resultsLabel")}>
              {jobs.length > 0 ? (
                <div role="group" aria-labelledby={`${id}-jobs`}>
                  <div
                    id={`${id}-jobs`}
                    role="presentation"
                    className="px-3 pt-1 pb-1 text-caption font-semibold text-muted"
                  >
                    {t("jobs")}
                  </div>
                  {jobs.map((o) => renderOption(o, options.indexOf(o)))}
                </div>
              ) : null}
              {clients.length > 0 ? (
                <div role="group" aria-labelledby={`${id}-clients`}>
                  <div
                    id={`${id}-clients`}
                    role="presentation"
                    className="px-3 pt-2 pb-1 text-caption font-semibold text-muted"
                  >
                    {t("clients")}
                  </div>
                  {clients.map((o) => renderOption(o, options.indexOf(o)))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="m-0 px-3 py-2 text-muted">
              {failed ?? (loading || !results ? t("loading") : t("empty"))}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
