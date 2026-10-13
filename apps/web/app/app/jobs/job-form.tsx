"use client";

import type { ClientsResponse, Job } from "@daybell/api";
import { JOB_TYPES, type JobType } from "@daybell/core";
import { Banner, Button, Field } from "@daybell/ui";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Combobox } from "../combobox";
import { ClientForm } from "../contacts/client-form";
import { Dialog, SelectField } from "../dialog";
import { ClosingDateField, closesAtFor, closingFieldValue } from "./closing-date";

type ClientRef = NonNullable<Job["client"]>;

/** The client picker (D133): the shared combobox, searching the studio's clients through the API. */
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
  const search = useCallback(async (query: string) => {
    const res = await api<ClientsResponse>(
      `/clients?limit=20${query ? `&q=${encodeURIComponent(query)}` : ""}`,
    );
    return res.ok
      ? res.data.clients.map((c) => ({ id: c.id, name: c.name, detail: c.city }))
      : null;
  }, []);
  return (
    <Combobox
      label={ta("optionalLabel", { label: t("client") })}
      placeholder={t("clientPlaceholder")}
      listLabel={t("clientOptions")}
      value={value}
      onChange={(c) => onChange(c ? { id: c.id, name: c.name, city: c.detail ?? null } : null)}
      search={search}
      addNewLabel={t("addClient")}
      onAddNew={onAddNew}
      error={error}
    />
  );
}

/**
 * Create or edit a job in one form (D133 form rules): name; picture day | type; client; and under "More options" the
 * internal number (pre-filled with the next one) | subjects expected, and for an existing draft or selling job its
 * closing date (ADR 0021).
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
  const tc2 = useTranslations("app.job.closing");
  const text = useApiText();
  const [name, setName] = useState(job?.name ?? "");
  const [pictureDay, setPictureDay] = useState(job?.pictureDay ?? "");
  const [client, setClient] = useState<ClientRef | null>(job?.client ?? null);
  const [internalNumber, setInternalNumber] = useState(job?.internalNumber ?? "");
  const [type, setType] = useState<JobType>(job?.type ?? "school");
  const [subjects, setSubjects] = useState(job?.subjectsExpected?.toString() ?? "");
  // The closing date (ADR 0021): only for existing draft and selling jobs; sent only when it changed.
  const initialClosing = closingFieldValue(job?.closesAt ?? null);
  const [closing, setClosing] = useState(initialClosing);
  const showClosing = job !== null && job.status !== "closed";
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
    if (fields.internalNumber || fields.subjectsExpected || fields.closesAt) setMoreOpen(true);
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
      ...(showClosing && closing !== initialClosing ? { closesAt: closesAtFor(closing) } : {}),
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
      // The number lives under "More options": open it so the fresh number is seen.
      setMoreOpen(true);
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
            {showClosing ? (
              <div className="sm:col-span-2">
                <ClosingDateField
                  label={ta("optionalLabel", { label: tc2("label") })}
                  value={closing}
                  onChange={setClosing}
                  error={text.field(errors.closesAt)}
                />
              </div>
            ) : null}
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
