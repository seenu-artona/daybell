"use client";

import type {
  Client,
  ClientsResponse,
  Job,
  JobCategoriesResponse,
  JobCategory,
} from "@daybell/api";
import { JOB_TYPES, type JobType } from "@daybell/core";
import { Banner, Button, Field } from "@daybell/ui";
import { Check, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { ClientForm } from "../contacts/client-form";
import { Dialog, SelectField } from "../dialog";

type ClientRef = NonNullable<Job["client"]>;

const OPTION =
  "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary";

/** Search the studio's clients and pick one, or none. Clients are optional for every job. */
function ClientPicker({
  value,
  onChange,
  onAddNew,
  error,
}: {
  value: ClientRef | null;
  onChange: (client: ClientRef | null) => void;
  onAddNew: () => void;
  error?: string | undefined;
}) {
  const t = useTranslations("app.jobs.form");
  const listId = useId();
  const [picking, setPicking] = useState(value === null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Client[] | null>(null);

  useEffect(() => {
    if (!picking) return;
    const timer = setTimeout(async () => {
      const q = query.trim();
      const res = await api<ClientsResponse>(
        `/clients?limit=20${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      );
      if (res.ok) setResults(res.data.clients);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, picking]);

  // A client chosen from outside (e.g. just added) closes the search.
  useEffect(() => {
    if (value) setPicking(false);
  }, [value]);

  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1.5 p-0 text-label text-ink">
        {t("client")} ({t("optional")})
      </legend>
      {value && !picking ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line-strong px-3 py-2">
          <Check className="size-4 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 font-semibold">
            <span className="sr-only">{t("clientSelected", { name: value.name })}</span>
            <span aria-hidden="true">
              {value.city ? `${value.name} · ${value.city}` : value.name}
            </span>
          </span>
          <Button variant="ghost" onClick={() => setPicking(true)}>
            {t("clientChange")}
          </Button>
          <Button variant="ghost" onClick={() => onChange(null)}>
            {t("clientRemove")}
          </Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-10 left-3 size-4 text-muted"
              aria-hidden="true"
            />
            <Field
              label={t("clientSearch")}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-controls={listId}
              className="[&_input]:pl-9"
            />
          </div>
          <div
            id={listId}
            className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-line p-1"
          >
            {results && results.length === 0 ? (
              <p className="m-0 px-3 py-2 text-muted">
                {query.trim() ? t("clientNoMatches") : t("clientEmpty")}
              </p>
            ) : null}
            {(results ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className={OPTION}
                aria-pressed={value?.id === c.id}
                onClick={() => {
                  onChange({ id: c.id, name: c.name, city: c.city });
                  setPicking(false);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.name}</span>
                  {c.city ? <span className="block text-sm text-muted">{c.city}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {error ? <span className="text-caption text-danger">{error}</span> : null}
      <Button variant="secondary" className="self-start" onClick={onAddNew}>
        <Plus aria-hidden="true" />
        {t("addClient")}
      </Button>
    </fieldset>
  );
}

/**
 * Create or edit a job in one form (GotPhoto "Create Photo Job", Seenu Oct 11 2026): name, picture day, client
 * (optional), internal number (pre-filled with the next one), type, category and subjects expected.
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
  const tc = useTranslations("app.contacts");
  const text = useApiText();
  const [name, setName] = useState(job?.name ?? "");
  const [pictureDay, setPictureDay] = useState(job?.pictureDay ?? "");
  const [client, setClient] = useState<ClientRef | null>(job?.client ?? null);
  const [internalNumber, setInternalNumber] = useState(job?.internalNumber ?? "");
  const [type, setType] = useState<JobType>(job?.type ?? "school");
  const [categoryId, setCategoryId] = useState(job?.category.id ?? "");
  const [subjects, setSubjects] = useState(job?.subjectsExpected?.toString() ?? "");
  const [categories, setCategories] = useState<JobCategory[] | null>(null);
  const [addingClient, setAddingClient] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = job === null;

  useEffect(() => {
    api<JobCategoriesResponse>("/job-categories").then((res) => {
      if (res.ok) setCategories(res.data.categories);
    });
    if (isNew)
      api<{ internalNumber: string }>("/jobs/next-number").then((res) => {
        if (res.ok) setInternalNumber((current) => current || res.data.internalNumber);
      });
  }, [isNew]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setProblem(null);
    const count = subjects.trim();
    if (count && !/^\d+$/.test(count)) {
      setErrors({ subjectsExpected: "validation.subjectsExpected" });
      return;
    }
    setBusy(true);
    const body = {
      name,
      pictureDay,
      clientId: client?.id ?? null,
      internalNumber,
      type,
      categoryId,
      subjectsExpected: count ? Number(count) : null,
    };
    const res = await api<{ job: Job }>(isNew ? "/jobs" : `/jobs/${job.id}`, {
      method: isNew ? "POST" : "PATCH",
      body,
    });
    setBusy(false);
    if (res.ok) return onSaved(res.data.job);
    setErrors(res.fields);
    if (Object.keys(res.fields).length === 0) setProblem(text.error(res.code));
  }

  if (!categories) return <p className="m-0 text-muted">{t("form.loading")}</p>;

  return (
    <>
      <form onSubmit={save} noValidate className="flex flex-col gap-4">
        {problem ? <Banner tone="danger" title={problem} /> : null}
        <Field
          label={t("form.name")}
          help={t("form.nameHelp")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={text.field(errors.name)}
          required
        />
        <Field
          label={t("form.pictureDay")}
          type="date"
          value={pictureDay}
          onChange={(e) => setPictureDay(e.target.value)}
          error={text.field(errors.pictureDay)}
          required
          className="sm:max-w-60"
        />
        <ClientPicker
          value={client}
          onChange={setClient}
          onAddNew={() => setAddingClient(true)}
          error={text.field(errors.clientId)}
        />
        <Field
          label={t("form.internalNumber")}
          help={t("form.internalNumberHelp")}
          value={internalNumber}
          onChange={(e) => setInternalNumber(e.target.value)}
          error={text.field(errors.internalNumber)}
          maxLength={30}
          required
          className="sm:max-w-60"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("form.type")}
            value={type}
            onChange={(v) => setType(v as JobType)}
            options={JOB_TYPES.map((jt) => ({ value: jt, label: t(`types.${jt}`) }))}
            error={text.field(errors.type)}
            required
          />
          <SelectField
            label={t("form.category")}
            value={categoryId}
            onChange={setCategoryId}
            options={[
              { value: "", label: t("form.categoryChoose"), disabled: true },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
            error={text.field(errors.categoryId)}
            required
          />
        </div>
        <Field
          label={`${t("form.subjects")} (${t("form.optional")})`}
          help={t("form.subjectsHelp")}
          type="number"
          inputMode="numeric"
          min={1}
          max={100000}
          step={1}
          value={subjects}
          onChange={(e) => setSubjects(e.target.value)}
          error={text.field(errors.subjectsExpected)}
          className="sm:max-w-60"
        />
        <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("form.saving") : t("form.save")}
          </Button>
        </div>
      </form>

      {/* Opens on top of the job form; Escape closes only this one, and the new client is selected. */}
      <Dialog
        open={addingClient}
        onClose={() => setAddingClient(false)}
        title={tc("form.addTitle")}
      >
        <ClientForm
          client={null}
          onCancel={() => setAddingClient(false)}
          onSaved={(c) => {
            setClient({ id: c.id, name: c.name, city: c.city });
            setAddingClient(false);
          }}
        />
      </Dialog>
    </>
  );
}
