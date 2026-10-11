"use client";

import type { Job, Organization, OrganizationsResponse } from "@daybell/api";
import { JOB_TYPES, type JobType, jobTypeRule, organizationRequired } from "@daybell/core";
import { Badge, Banner, Button, Card, Field } from "@daybell/ui";
import { ArrowLeft, CircleDashed, Images, Pencil, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog, SelectField } from "../../dialog";
import { useStudio } from "../../me-context";
import { StatusBadge, useFormatDay } from "../status-badge";

// D75: the steps every job moves through. Nothing has happened yet in step 1, so all are upcoming.
const STAGES = ["pictureDay", "tagged", "shopLive", "shipped"] as const;

function Soon({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const t = useTranslations("app.jobs.detail");
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center gap-3">
        <span
          className="grid size-10 place-items-center rounded-[10px] bg-subtle"
          aria-hidden="true"
        >
          {icon}
        </span>
        <h2 className="m-0 flex-1 text-h3">{title}</h2>
        <Badge tone="draft">{t("comingSoon")}</Badge>
      </div>
      <p className="m-0 text-muted">{children}</p>
    </section>
  );
}

/** One job (Phase 1 step 1): its details, the D75 progress steps, and the sections later steps fill in. */
export default function JobPage() {
  const t = useTranslations("app.jobs");
  const td = useTranslations("app.jobs.detail");
  const text = useApiText();
  const formatDay = useFormatDay();
  const { id } = useParams<{ id: string }>();
  const { me, changed } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const [job, setJob] = useState<Job | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<{ job: Job }>(`/jobs/${encodeURIComponent(id)}`).then((res) => {
      if (res.ok) setJob(res.data.job);
      else setProblem(res.code === "not_found" ? td("notFound") : text.error(res.code));
    });
  }, [id, td, text]);

  const back = (
    <Link
      href="/app/jobs"
      className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-primary no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {td("back")}
    </Link>
  );

  if (!job) {
    return (
      <>
        {back}
        {problem ? (
          <Banner tone="danger" title={problem} />
        ) : (
          <p className="m-0 text-muted">{td("loading")}</p>
        )}
      </>
    );
  }

  const facts = [
    {
      key: "organization",
      value: job.organization
        ? [job.organization.name, job.organization.city].filter(Boolean).join(" · ")
        : td("noOrganization"),
    },
    { key: "type", value: t(`types.${job.type}`) },
    { key: "pictureDay", value: job.pictureDay ? formatDay(job.pictureDay) : t("notSet") },
  ] as const;

  return (
    <>
      <div className="flex flex-col gap-2">
        {back}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-h1 break-words">{job.name}</h1>
          <StatusBadge status={job.status} />
          {canManage ? (
            <Button
              variant="secondary"
              className="sm:ml-auto"
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden="true" />
              {td("edit")}
            </Button>
          ) : null}
        </div>
        {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
        <p role="status" className="m-0 text-sm text-muted">
          {saved ? td("saved") : ""}
        </p>
      </div>

      <Card>
        <dl className="m-0 grid gap-4 sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.key}>
              <dt className="text-caption font-semibold text-muted">{td(f.key)}</dt>
              <dd className="m-0 font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <section
        aria-labelledby="job-progress"
        className="rounded-2xl border border-line bg-surface p-5"
      >
        <h2 id="job-progress" className="m-0 mb-4 text-h3">
          {td("progressLabel")}
        </h2>
        <ol className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
          {STAGES.map((stage, i) => (
            <li key={stage} className="flex flex-col gap-2">
              <span className="h-1.5 rounded-full bg-subtle" aria-hidden="true" />
              <span className="flex items-center gap-2">
                <CircleDashed className="size-5 shrink-0 text-muted" aria-hidden="true" />
                <span>
                  <span className="block font-semibold">
                    <span className="sr-only">{`${i + 1}. `}</span>
                    {td(`stages.${stage}`)}
                  </span>
                  <span className="block text-caption text-muted">{td("upcoming")}</span>
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Soon icon={<Users className="size-5" />} title={td("roster")}>
          {td("rosterBody", { group: jobTypeRule(job.type).group })}
        </Soon>
        <Soon icon={<Images className="size-5" />} title={td("photos")}>
          {td("photosBody")}
        </Soon>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} title={td("editTitle")}>
        <EditJob
          job={job}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            setJob(next);
            setEditing(false);
            setSaved(true);
            changed();
          }}
        />
      </Dialog>
    </>
  );
}

function EditJob({
  job,
  onCancel,
  onSaved,
}: {
  job: Job;
  onCancel: () => void;
  onSaved: (job: Job) => void;
}) {
  const t = useTranslations("app.jobs");
  const td = useTranslations("app.jobs.detail");
  const text = useApiText();
  const [name, setName] = useState(job.name);
  const [type, setType] = useState<JobType>(job.type);
  const [pictureDay, setPictureDay] = useState(job.pictureDay ?? "");
  const [organizationId, setOrganizationId] = useState(job.organization?.id ?? "");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<OrganizationsResponse>("/organizations?limit=100").then((res) => {
      if (res.ok) setOrganizations(res.data.organizations);
    });
  }, []);

  // Keep the current organization choosable even if it isn't in the first page.
  const options = [
    ...(organizationRequired(type) ? [] : [{ value: "", label: td("noOrganization") }]),
    ...(job.organization && !organizations.some((o) => o.id === job.organization?.id)
      ? [{ value: job.organization.id, label: job.organization.name }]
      : []),
    ...organizations.map((o) => ({
      value: o.id,
      label: o.city ? `${o.name} · ${o.city}` : o.name,
    })),
  ];
  // A type that needs an organization shows the first one chosen rather than none.
  const chosen = organizationId || (organizationRequired(type) ? (options[0]?.value ?? "") : "");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setProblem(null);
    const res = await api<{ job: Job }>(`/jobs/${job.id}`, {
      method: "PATCH",
      body: { name, type, pictureDay: pictureDay || null, organizationId: chosen || null },
    });
    setBusy(false);
    if (res.ok) return onSaved(res.data.job);
    setErrors(res.fields);
    if (Object.keys(res.fields).length === 0) setProblem(text.error(res.code));
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3">
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <Field
        label={t("wizard.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={text.field(errors.name)}
        required
      />
      <SelectField
        label={td("type")}
        value={type}
        onChange={(v) => setType(v as JobType)}
        options={JOB_TYPES.map((jt) => ({ value: jt, label: t(`types.${jt}`) }))}
        error={text.field(errors.type)}
      />
      {options.length > 0 ? (
        <SelectField
          label={td("organization")}
          value={chosen}
          onChange={setOrganizationId}
          options={options}
          error={text.field(errors.organizationId)}
        />
      ) : (
        // A type that needs an organization, and the studio has none yet: say where to add one.
        <p className="m-0 text-sm text-muted">
          {td("noOrganizationsYet")}{" "}
          <Link href="/app/contacts/organizations" className="font-semibold text-primary">
            {td("addOrganization")}
          </Link>
        </p>
      )}
      <Field
        label={t("wizard.pictureDay")}
        help={t("wizard.pictureDayHelp")}
        type="date"
        value={pictureDay}
        onChange={(e) => setPictureDay(e.target.value)}
        error={text.field(errors.pictureDay)}
      />
      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {td("cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? td("saving") : td("save")}
        </Button>
      </div>
    </form>
  );
}
