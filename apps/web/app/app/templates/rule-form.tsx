"use client";

import type { JobRules, RuleKey, RulesPatch } from "@daybell/core";
import { Button, Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useRef, useState } from "react";
import { type RuleChoice, ruleChoice, ruleLimits, rulePatchFor } from "./rules";

/**
 * One rule's small dialog (D154 on a template, D152 on a job's Progress): two choices, the second with its days, and a
 * note saying what the change reaches (this job only, or jobs made from now on). `onSave` resolves to a problem to
 * show, or null when it saved. Nothing is disabled while saving (D91); a second Save waits for the first.
 */
export function RuleForm({
  rule,
  rules,
  note,
  onCancel,
  onSave,
}: {
  rule: RuleKey;
  rules: JobRules;
  /** What the change reaches, e.g. "Changes this job only." */
  note: string;
  onCancel: () => void;
  onSave: (patch: RulesPatch) => Promise<string | null>;
}) {
  const t = useTranslations("app.rules.dialog");
  const id = useId();
  const start = ruleChoice(rule, rules);
  const [choice, setChoice] = useState<RuleChoice>(start.choice);
  const [days, setDays] = useState(start.days === null ? "" : String(start.days));
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState("");
  const saving = useRef(false);
  const limits = ruleLimits(rule);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    const patch = rulePatchFor(rule, choice, days);
    if (!patch) return setError(t("daysError", { min: limits.min, max: limits.max }));
    setError(undefined);
    setProblem("");
    saving.current = true;
    const failed = await onSave(patch);
    saving.current = false;
    if (failed) setProblem(failed);
  }

  const radio = (value: RuleChoice, label: string) => (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm text-ink">
      <input
        type="radio"
        name={`${id}-choice`}
        checked={choice === value}
        onChange={() => setChoice(value)}
        className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
      {label}
    </label>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className="mb-1 p-0 text-label text-ink">{t(`${rule}.legend`)}</legend>
        {radio("none", t(`${rule}.none`))}
        {radio("days", t(`${rule}.days`))}
      </fieldset>
      {choice === "days" ? (
        <Field
          label={t("daysLabel")}
          type="number"
          inputMode="numeric"
          min={limits.min}
          max={limits.max}
          step={1}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          error={error}
          placeholder={t("daysPlaceholder", { min: limits.min, max: limits.max })}
          className="max-w-60"
        />
      ) : null}
      <p className="m-0 text-sm text-muted">{note}</p>
      <p role="status" className="m-0 text-sm font-semibold text-ink empty:sr-only">
        {problem}
      </p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit">{t("save")}</Button>
      </div>
    </form>
  );
}
