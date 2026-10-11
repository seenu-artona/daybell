"use client";

import {
  fieldErrors,
  type Job,
  type Organization,
  type OrganizationsResponse,
  organizationInput,
} from "@daybell/api";
import { JOB_TYPES, type JobType, jobTypeRule, organizationRequired } from "@daybell/core";
import { Banner, Button, Card, Field } from "@daybell/ui";
import {
  ArrowLeft,
  Baby,
  Check,
  GraduationCap,
  Music,
  School,
  Search,
  Sparkles,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import {
  emptyOrganization,
  OrganizationFields,
  organizationBody,
} from "../../contacts/organization-fields";
import { useStudio } from "../../me-context";

const TYPE_ICON: Record<JobType, typeof School> = {
  school: School,
  preschool: Baby,
  sports: Trophy,
  dance: Music,
  seniors: GraduationCap,
  mini_session: Sparkles,
};
const STEPS = ["type", "organization", "details"] as const;
const CHOICE =
  "group flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border border-line-strong bg-surface p-3.5 has-checked:border-primary has-checked:bg-primary-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary";

/**
 * New job wizard (Phase 1 step 1): 1 type, 2 organization (pick or add; skippable for seniors and mini sessions),
 * 3 name and picture day. A new organization is created first, then the job (two calls, ADR 0008).
 */
export default function NewJobPage() {
  const t = useTranslations("app.jobs");
  const tw = useTranslations("app.jobs.wizard");
  const tc = useTranslations("app.contacts");
  const text = useApiText();
  const router = useRouter();
  const { me, changed } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const heading = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState(0);
  const [type, setType] = useState<JobType | null>(null);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [skipped, setSkipped] = useState(false);
  const [query, setQuery] = useState("");
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [selected, setSelected] = useState<Organization | null>(null);
  const [draft, setDraft] = useState(() => emptyOrganization("school", me.studio.region));
  const [orgErrors, setOrgErrors] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [pictureDay, setPictureDay] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Search the studio's organizations as the person types (short pause first).
  useEffect(() => {
    if (step !== 1) return;
    const timer = setTimeout(async () => {
      const q = query.trim();
      const res = await api<OrganizationsResponse>(
        `/organizations?limit=100${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      );
      if (res.ok) {
        setOrganizations(res.data.organizations);
        if (!q && res.data.organizations.length === 0) setMode("new");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, step]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: move focus to the new step's heading.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  if (!canManage) {
    return <Banner tone="info" title={t("emptyReadOnly")} />;
  }

  const required = type ? organizationRequired(type) : true;

  function chooseType(next: JobType) {
    setType(next);
    if (!draft.name) setDraft((d) => ({ ...d, kind: jobTypeRule(next).organizationKind }));
  }

  function next(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    if (step === 0) {
      if (!type) return setProblem(tw("chooseType"));
      return setStep(1);
    }
    if (step === 1) {
      if (mode === "existing") {
        if (!selected) return setProblem(tw("chooseOrganization"));
      } else {
        const check = organizationInput.safeParse(organizationBody(draft));
        if (!check.success) return setOrgErrors(fieldErrors(check.error));
      }
      setOrgErrors({});
      setSkipped(false);
      if (!name) setName(mode === "existing" ? (selected?.name ?? "") : draft.name.trim());
      return setStep(2);
    }
    void create();
  }

  function skip() {
    setProblem(null);
    setSkipped(true);
    setStep(2);
  }

  async function create() {
    if (!type) return;
    setBusy(true);
    setErrors({});
    let organizationId: string | null = null;
    if (!skipped && mode === "existing") organizationId = selected?.id ?? null;
    if (!skipped && mode === "new") {
      const res = await api<{ organization: Organization }>("/organizations", {
        body: organizationBody(draft),
      });
      if (!res.ok) {
        setBusy(false);
        setOrgErrors(res.fields);
        setStep(1);
        if (Object.keys(res.fields).length === 0) setProblem(text.error(res.code));
        return;
      }
      // If the job then fails, a retry uses this organization instead of adding it twice.
      organizationId = res.data.organization.id;
      setSelected(res.data.organization);
      setMode("existing");
      setDraft(emptyOrganization(jobTypeRule(type).organizationKind, me.studio.region));
    }
    const res = await api<{ job: Job }>("/jobs", {
      body: { name, type, organizationId, pictureDay: pictureDay || null },
    });
    setBusy(false);
    if (res.ok) {
      changed();
      router.push(`/app/jobs/${res.data.job.id}`);
      return;
    }
    setErrors(res.fields);
    if (Object.keys(res.fields).length === 0) setProblem(text.error(res.code));
  }

  const stepKey = STEPS[step] ?? "type";

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link
          href="/app/jobs"
          className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-primary no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("detail.back")}
        </Link>
        <h1 className="m-0 text-h1">{tw("title")}</h1>
      </div>

      <Card className="flex flex-col gap-5">
        <div>
          <p className="m-0 text-caption font-semibold text-muted">
            {tw("stepOf", { step: step + 1, total: STEPS.length })}
          </p>
          <h2 ref={heading} tabIndex={-1} id="wizard-step" className="m-0 text-h2 outline-none">
            {tw(`steps.${stepKey}`)}
          </h2>
        </div>

        {problem ? <Banner tone="danger" title={problem} /> : null}

        <form onSubmit={next} noValidate className="flex flex-col gap-5">
          {step === 0 ? (
            <fieldset aria-labelledby="wizard-step" className="m-0 border-0 p-0">
              <div className="grid gap-3 sm:grid-cols-2">
                {JOB_TYPES.map((jt) => {
                  const Icon = TYPE_ICON[jt];
                  return (
                    <label key={jt} className={CHOICE}>
                      <input
                        type="radio"
                        name="type"
                        value={jt}
                        checked={type === jt}
                        onChange={() => chooseType(jt)}
                        className="sr-only"
                      />
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-subtle"
                        aria-hidden="true"
                      >
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{t(`types.${jt}`)}</span>
                        <span className="block text-sm text-muted">{t(`typeHelp.${jt}`)}</span>
                      </span>
                      <Check
                        className="hidden size-5 shrink-0 text-primary group-has-checked:block"
                        aria-hidden="true"
                      />
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-4">
              {!required ? <p className="m-0 text-muted">{tw("optional")}</p> : null}
              {mode === "existing" ? (
                <>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-10 left-3 size-4 text-muted"
                      aria-hidden="true"
                    />
                    <Field
                      label={tw("search")}
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="[&_input]:pl-9"
                    />
                  </div>
                  {organizations && organizations.length === 0 ? (
                    <p className="m-0 text-muted">
                      {query.trim() ? tw("noMatches") : tw("noOrganizations")}
                    </p>
                  ) : null}
                  {organizations && organizations.length > 0 ? (
                    <fieldset aria-labelledby="wizard-step" className="m-0 border-0 p-0">
                      <div className="flex max-h-90 flex-col gap-2 overflow-y-auto p-1">
                        {organizations.map((o) => (
                          <label key={o.id} className={CHOICE}>
                            <input
                              type="radio"
                              name="organization"
                              value={o.id}
                              checked={selected?.id === o.id}
                              onChange={() => setSelected(o)}
                              className="sr-only"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">{o.name}</span>
                              <span className="block text-sm text-muted">
                                {[o.city, o.region].filter(Boolean).join(", ") ||
                                  tc(`kinds.${o.kind}`)}
                              </span>
                            </span>
                            <Check
                              className="hidden size-5 shrink-0 text-primary group-has-checked:block"
                              aria-hidden="true"
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}
                  <Button variant="secondary" className="self-start" onClick={() => setMode("new")}>
                    {tw("addNew")}
                  </Button>
                </>
              ) : (
                <>
                  <OrganizationFields
                    value={draft}
                    onChange={setDraft}
                    errors={orgErrors}
                    showNotes={false}
                  />
                  {organizations && (organizations.length > 0 || query.trim()) ? (
                    <Button
                      variant="secondary"
                      className="self-start"
                      onClick={() => setMode("existing")}
                    >
                      {tw("useExisting")}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-3">
              {!skipped ? (
                <p className="m-0 text-muted">
                  {mode === "existing" && selected
                    ? tw("summaryOrganization", { name: selected.name })
                    : tw("summaryNew", { name: draft.name.trim() })}
                </p>
              ) : null}
              <Field
                label={tw("name")}
                help={tw("nameHelp")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={text.field(errors.name)}
                required
              />
              <Field
                label={tw("pictureDay")}
                help={tw("pictureDayHelp")}
                type="date"
                value={pictureDay}
                onChange={(e) => setPictureDay(e.target.value)}
                error={text.field(errors.pictureDay)}
                className="sm:max-w-60"
              />
              {errors.organizationId ? (
                <Banner tone="danger" title={text.field(errors.organizationId)} />
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
            {step > 0 ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setProblem(null);
                  setStep(step - 1);
                }}
              >
                {tw("back")}
              </Button>
            ) : null}
            {step === 1 && !required ? (
              <Button variant="ghost" onClick={skip}>
                {tw("skip")}
              </Button>
            ) : null}
            <Button type="submit" className="sm:ml-auto" disabled={busy}>
              {step < 2 ? tw("next") : busy ? tw("creating") : tw("create")}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
