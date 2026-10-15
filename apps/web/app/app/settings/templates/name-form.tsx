"use client";

import { Button, Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useRef, useState } from "react";

/** A template's name, for New template and Duplicate. */
export function NameForm({
  initial = "",
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial?: string;
  submitLabel: string;
  onCancel: () => void;
  /** Resolves to a problem for the field or the form, or null when done. */
  onSubmit: (name: string) => Promise<{ field?: string; form?: string } | null>;
}) {
  const t = useTranslations("app.templates");
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState("");
  const busy = useRef(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    if (!name.trim()) return setError(t("nameRequired"));
    setError(undefined);
    setProblem("");
    busy.current = true;
    const failed = await onSubmit(name.trim());
    busy.current = false;
    if (failed?.field) setError(failed.field);
    if (failed?.form) setProblem(failed.form);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field
        label={t("name")}
        placeholder={t("namePlaceholder")}
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        error={error}
        required
      />
      <p role="status" className="m-0 text-sm font-semibold text-ink empty:sr-only">
        {problem}
      </p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}
