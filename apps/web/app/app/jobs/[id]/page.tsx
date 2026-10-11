"use client";

import type { Job } from "@daybell/api";
import { canEditRoster } from "@daybell/core";
import { Badge, Banner, Button, Card } from "@daybell/ui";
import { ArrowLeft, CircleDashed, Images, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../dialog";
import { useStudio } from "../../me-context";
import { JobForm } from "../job-form";
import { StatusBadge, useFormatDay } from "../status-badge";
import { RosterSection } from "./roster";

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

/** One job: its details, the D75 progress steps, the roster (step 2), and the sections later steps fill in. */
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
      key: "client",
      value: job.client
        ? [job.client.name, job.client.city].filter(Boolean).join(" · ")
        : td("noClient"),
    },
    { key: "number", value: job.internalNumber },
    { key: "type", value: t(`types.${job.type}`) },
    { key: "pictureDay", value: formatDay(job.pictureDay) },
    { key: "subjects", value: job.subjectsExpected?.toString() ?? td("notSet") },
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

      <RosterSection job={job} canEdit={canEditRoster(me.studio.role)} />

      <Soon icon={<Images className="size-5" />} title={td("photos")}>
        {td("photosBody")}
      </Soon>

      <Dialog open={editing} onClose={() => setEditing(false)} title={t("form.editTitle")}>
        <JobForm
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
