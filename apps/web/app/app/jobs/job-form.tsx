"use client";

import type { Client, ClientsResponse, Job } from "@daybell/api";
import { JOB_TYPES, type JobType } from "@daybell/core";
import { Banner, Button, Field } from "@daybell/ui";
import { ChevronDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { ClientForm } from "../contacts/client-form";
import { Dialog, SelectField } from "../dialog";

type ClientRef = NonNullable<Job["client"]>;

const OPTION = "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2";

/**
 * The client picker as one field (D133): an ARIA 1.2 combobox with a listbox. The list opens on focus or typing;
 * arrow keys move, Enter picks, Escape closes the list (and only the list). "Add new client" is always the last
 * option, so with no clients yet it is the only one.
 */
function ClientCombobox({
  value,
  onChange,
  onAddNew,
  error,
}: {
  value: ClientRef | null;
  onChange: (client: ClientRef | null) => void;
  onAddNew: (typed: string) => void;
  error?: string | undefined;
}) {
  const t = useTranslations("app.jobs.form");
  const ta = useTranslations("app");
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const [text, setText] = useState(value?.name ?? "");
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<Client[]>([]);
  // Only the newest search may fill the list; slower, older answers are dropped.
  const latest = useRef(0);

  // Show the chosen client's name when it changes from outside (e.g. a client just added).
  useEffect(() => {
    setText(value?.name ?? "");
  }, [value]);

  const query = typed ? text.trim() : "";
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      const seq = ++latest.current;
      const res = await api<ClientsResponse>(
        `/clients?limit=20${query ? `&q=${encodeURIComponent(query)}` : ""}`,
      );
      if (res.ok && seq === latest.current) {
        setResults(res.data.clients);
        setActive(0);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

  // The options: matching clients, then "Add new client" last.
  const count = results.length + 1;
  const addIndex = results.length;

  function close() {
    setOpen(false);
    setTyped(false);
    // Clearing the field removes the client; anything else half-typed goes back to the chosen name.
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
    const c = results[index];
    if (!c) return;
    onChange({ id: c.id, name: c.name, city: c.city });
    setText(c.name);
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
    } else if (e.key === "Enter" && open) {
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
        {ta("optionalLabel", { label: t("client") })}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          placeholder={t("clientPlaceholder")}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setTyped(true);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
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
        aria-label={t("client")}
        hidden={!open}
        className="absolute inset-x-0 top-full z-20 m-0 mt-1 max-h-64 list-none overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-md"
      >
        {results.map((c, i) => (
          // Keyboard focus stays in the combobox (aria-activedescendant); clicks are for pointers.
          <li
            key={c.id}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(i)}
            className={`${OPTION} ${i === active ? "bg-primary-soft text-primary-hover" : ""}`}
          >
            <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
            {c.city ? <span className="text-sm text-muted">{c.city}</span> : null}
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
          {t("addClient")}
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

/**
 * Create or edit a job in one form (D133 form rules): name; picture day | type; client; and under "More options" the
 * internal number (pre-filled with the next one) | subjects expected.
 */
export function JobForm({
  job,
  onCancel,
  onSaved,
}: {
  job: Job | null;
  onCancel: () => void;
  onSaved: (job: Job) => void;
}) {
  const t = useTranslations("app.jobs");
  const ta = useTranslations("app");
  const tc = useTranslations("app.contacts");
  const text = useApiText();
  const [name, setName] = useState(job?.name ?? "");
  const [pictureDay, setPictureDay] = useState(job?.pictureDay ?? "");
  const [client, setClient] = useState<ClientRef | null>(job?.client ?? null);
  const [internalNumber, setInternalNumber] = useState(job?.internalNumber ?? "");
  const [type, setType] = useState<JobType>(job?.type ?? "school");
  const [subjects, setSubjects] = useState(job?.subjectsExpected?.toString() ?? "");
  const [moreOpen, setMoreOpen] = useState(false);
  const [newClientName, setNewClientName] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The number the server suggested. Left unchanged, it isn't sent, so the server picks the next free one itself
  // (and retries if another job takes it at the same moment).
  const [suggested, setSuggested] = useState<string | null>(null);
  const isNew = job === null;

  const suggest = useCallback(async (replace: boolean) => {
    const res = await api<{ internalNumber: string }>("/jobs/next-number");
    if (!res.ok) return;
    setSuggested(res.data.internalNumber);
    setInternalNumber((current) => (replace || !current ? res.data.internalNumber : current));
  }, []);

  useEffect(() => {
    if (isNew) void suggest(false);
  }, [isNew, suggest]);

  function showErrors(fields: Record<string, string>) {
    setErrors(fields);
    // Errors inside "More options" must be seen.
    if (fields.internalNumber || fields.subjectsExpected) setMoreOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setProblem(null);
    const count = subjects.trim();
    if (count && !/^\d+$/.test(count)) {
      showErrors({ subjectsExpected: "validation.subjectsExpected" });
      return;
    }
    setBusy(true);
    const usesSuggestion = isNew && suggested !== null && internalNumber.trim() === suggested;
    const body = {
      name,
      pictureDay,
      clientId: client?.id ?? null,
      ...(usesSuggestion ? {} : { internalNumber }),
      type,
      subjectsExpected: count ? Number(count) : null,
    };
    const res = await api<{ job: Job }>(isNew ? "/jobs" : `/jobs/${job.id}`, {
      method: isNew ? "POST" : "PATCH",
      body,
    });
    setBusy(false);
    if (res.ok) return onSaved(res.data.job);
    if (usesSuggestion && res.fields.internalNumber === "validation.internalNumberTaken") {
      // Others took the suggested numbers first: offer a fresh one and let the person save again.
      const { internalNumber: _taken, ...rest } = res.fields;
      showErrors(rest);
      await suggest(true);
      if (Object.keys(rest).length === 0)
        setProblem(text.field("validation.internalNumberTaken") ?? "");
      return;
    }
    showErrors(res.fields);
    if (Object.keys(res.fields).length === 0) setProblem(text.error(res.code));
  }

  return (
    <>
      <form onSubmit={save} noValidate className="flex flex-col gap-5">
        {problem ? <Banner tone="danger" title={problem} /> : null}
        <Field
          label={t("form.name")}
          placeholder={t("form.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={text.field(errors.name)}
          required
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t("form.pictureDay")}
            type="date"
            value={pictureDay}
            onChange={(e) => setPictureDay(e.target.value)}
            error={text.field(errors.pictureDay)}
            required
          />
          <SelectField
            label={t("form.type")}
            value={type}
            onChange={(v) => setType(v as JobType)}
            options={JOB_TYPES.map((jt) => ({ value: jt, label: t(`types.${jt}`) }))}
            error={text.field(errors.type)}
            required
          />
        </div>
        <ClientCombobox
          value={client}
          onChange={setClient}
          onAddNew={(typed) => setNewClientName(typed)}
          error={text.field(errors.clientId)}
        />
        <details
          open={moreOpen}
          onToggle={(e) => setMoreOpen(e.currentTarget.open)}
          className="group"
        >
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md font-semibold text-primary focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
            {t("form.moreOptions")}
          </summary>
          <div className="grid gap-5 pt-3 sm:grid-cols-2">
            <Field
              label={t("form.internalNumber")}
              value={internalNumber}
              onChange={(e) => setInternalNumber(e.target.value)}
              error={text.field(errors.internalNumber)}
              maxLength={30}
              required
            />
            <Field
              label={ta("optionalLabel", { label: t("form.subjects") })}
              placeholder={t("form.subjectsPlaceholder")}
              type="number"
              inputMode="numeric"
              min={1}
              max={100000}
              step={1}
              value={subjects}
              onChange={(e) => setSubjects(e.target.value)}
              error={text.field(errors.subjectsExpected)}
            />
          </div>
        </details>
        <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("form.saving") : isNew ? t("form.create") : t("form.save")}
          </Button>
        </div>
      </form>

      {/* Opens on top of the job form; Escape closes only this one, and the new client is selected. */}
      <Dialog
        open={newClientName !== null}
        onClose={() => setNewClientName(null)}
        title={tc("form.addTitle")}
      >
        <ClientForm
          client={null}
          initialName={newClientName ?? ""}
          onCancel={() => setNewClientName(null)}
          onSaved={(c) => {
            setClient({ id: c.id, name: c.name, city: c.city });
            setNewClientName(null);
          }}
        />
      </Dialog>
    </>
  );
}
