"use client";

import type { JobTemplate, JobTemplateResponse, JobTemplatesResponse } from "@daybell/api";
import { Banner } from "@daybell/ui";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, Suspense, useEffect, useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../dialog";
import { useStudio } from "../../me-context";
import { SETTINGS_HREF } from "../sections";
import { NameForm } from "./name-form";

export default function TemplatesPageRoute() {
  return (
    <Suspense>
      <TemplatesPage />
    </Suspense>
  );
}

/** A group of white cards under a small heading (D154: Jobs, Messages, Print). */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="m-0 mt-2 text-title-sm text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Settings › Templates (D154; ADR 0029): Jobs, Messages and Print. This round builds job templates: each a white card
 * linking to its page, with "Default" and how many jobs use it. Messages and Print show a Soon line. The green "New
 * template" in the title row (owners and admins) arrives as ?new=1 and opens the name dialog here.
 */
function TemplatesPage() {
  const t = useTranslations("app.templates");
  const text = useApiText();
  const router = useRouter();
  const { me } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const [templates, setTemplates] = useState<JobTemplate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const creating = useSearchParams().get("new") === "1" && canManage;

  useEffect(() => {
    void api<JobTemplatesResponse>("/job-templates").then((res) => {
      if (res.ok) setTemplates(res.data.templates);
      else setFailed(true);
    });
  }, []);

  const close = () => router.replace(SETTINGS_HREF.templates, { scroll: false });

  return (
    <>
      <Group title={t("groups.jobs")}>
        {failed ? <Banner tone="danger" title={t("loadFailed")} /> : null}
        {!templates && !failed ? <p className="m-0 text-muted">{t("loading")}</p> : null}
        {templates?.map((template) => (
          <Link
            key={template.id}
            href={`${SETTINGS_HREF.templates}/${template.id}`}
            className="group flex items-center gap-4 rounded-lg bg-surface px-6 py-5 text-ink no-underline shadow-sm hover:shadow-card focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-h3 font-bold">{template.name}</span>
              <span className="text-body text-muted">
                {template.isDefault ? (
                  <>
                    {t("default")}
                    <span aria-hidden="true" className="mx-2.5 text-line-strong">
                      |
                    </span>
                    <span className="sr-only">, </span>
                  </>
                ) : null}
                {t("usedBy", { count: template.usedBy })}
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-5 text-line-strong group-hover:text-muted"
            />
          </Link>
        ))}
      </Group>
      <Group title={t("groups.messages")}>
        <p className="m-0 rounded-lg bg-surface px-6 py-5 text-muted shadow-sm">
          {t("messagesSoon")}
        </p>
      </Group>
      <Group title={t("groups.print")}>
        <p className="m-0 rounded-lg bg-surface px-6 py-5 text-muted shadow-sm">{t("printSoon")}</p>
      </Group>

      <Dialog open={creating} onClose={close} title={t("newTitle")}>
        <NameForm
          submitLabel={t("create")}
          onCancel={close}
          onSubmit={async (name) => {
            const res = await api<JobTemplateResponse>("/job-templates", {
              method: "POST",
              body: { name },
            });
            if (res.ok) {
              router.push(`${SETTINGS_HREF.templates}/${res.data.template.id}`);
              return null;
            }
            return res.fields.name
              ? { field: text.field(res.fields.name) ?? "" }
              : { form: res.fields.form === "templates.limit" ? t("limit") : text.error(res.code) };
          }}
        />
      </Dialog>
    </>
  );
}
