"use client";

import { Banner, Card } from "@daybell/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useStudio } from "../../me-context";
import { PageFrame } from "../../page-frame";
import { JobForm } from "../job-form";

/** The job form as a page, for direct links and small screens. Jobs › "New job" opens the same form in a dialog. */
export default function NewJobPage() {
  const t = useTranslations("app.jobs");
  const router = useRouter();
  const { me, changed } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";

  return (
    <PageFrame>
      <div className="flex flex-col gap-2">
        <Link
          href="/app/jobs"
          className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-primary no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("detail.back")}
        </Link>
        <h1 className="m-0 text-h1">{t("form.createTitle")}</h1>
      </div>
      {canManage ? (
        <Card>
          <JobForm
            job={null}
            onCancel={() => router.push("/app/jobs")}
            onSaved={(job) => {
              changed();
              router.push(`/app/jobs/${job.id}`);
            }}
          />
        </Card>
      ) : (
        <Banner tone="info" title={t("emptyReadOnly")} />
      )}
    </PageFrame>
  );
}
