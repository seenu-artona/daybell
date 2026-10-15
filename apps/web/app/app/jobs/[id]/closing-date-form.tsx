"use client";

import type { Job } from "@daybell/api";
import { Button } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { ClosingDateField, closesAtFor, closingFieldValue } from "../closing-date";
import { jobConflictKey } from "./going-live";

/**
 * The closing date, the last day to order, or remove it (ADR 0021): changed on the Overview's Shop closes step since
 * D152 ("a date is changed on its own step").
 */
export function ClosingDateForm({
  job,
  onCancel,
  onSaved,
}: {
  job: Job;
  onCancel: () => void;
  onSaved: (job: Job, removed: boolean) => void;
}) {
  const t = useTranslations("app.job");
  const text = useApiText();
  const [day, setDay] = useState(closingFieldValue(job.closesAt));
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState("");
  const saving = useRef(false);

  async function save(closesAt: string | null) {
    if (saving.current) return;
    saving.current = true;
    setError(undefined);
    setProblem("");
    const res = await api<{ job: Job }>(`/jobs/${job.id}`, { method: "PATCH", body: { closesAt } });
    saving.current = false;
    if (res.ok) return onSaved(res.data.job, closesAt === null);
    if (res.fields.closesAt) return setError(text.field(res.fields.closesAt));
    const conflict = jobConflictKey(res.fields.form);
    setProblem(conflict ? t(`conflicts.${conflict}`) : text.error(res.code));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!day) return setError(text.field("validation.closesAt"));
    void save(closesAtFor(day));
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <ClosingDateField value={day} onChange={setDay} error={error} />
      <p role="status" className="m-0 text-sm font-semibold text-ink empty:sr-only">
        {problem}
      </p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {job.closesAt ? (
          <Button variant="secondary" onClick={() => void save(null)}>
            {t("closing.remove")}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit">{t("closing.save")}</Button>
      </div>
    </form>
  );
}
