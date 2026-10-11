"use client";

import type { Organization, OrganizationsResponse } from "@daybell/api";
import { Badge, Banner, Button, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../dialog";
import { useStudio } from "../../me-context";
import {
  draftFrom,
  emptyOrganization,
  OrganizationFields,
  organizationBody,
} from "../organization-fields";

const TAB =
  "inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold no-underline";

/** Contacts › Organizations (Phase 1 step 1). Parents and Children arrive in later steps. */
export default function OrganizationsPage() {
  const t = useTranslations("app.contacts");
  const text = useApiText();
  const { me, changed } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<Organization | "new" | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      const res = await api<OrganizationsResponse>(
        cursor ? `/organizations?cursor=${cursor}` : "/organizations",
      );
      if (!res.ok) return setProblem(text.error(res.code));
      setOrganizations((prev) =>
        cursor && prev ? [...prev, ...res.data.organizations] : res.data.organizations,
      );
      setNextCursor(res.data.nextCursor);
    },
    [text],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on open.
  useEffect(() => {
    void load(null);
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-h1">{t("title")}</h1>
        {canManage ? (
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("organizations.add")}
          </Button>
        ) : null}
      </div>

      <nav aria-label={t("tabsLabel")} className="flex gap-1 overflow-x-auto border-b border-line">
        {(["parents", "children"] as const).map((tab) => (
          <span key={tab} aria-disabled="true" className={`${TAB} border-transparent text-muted`}>
            {t(`tabs.${tab}`)}
            <Badge tone="draft">{t("soon")}</Badge>
          </span>
        ))}
        <Link
          href="/app/contacts/organizations"
          aria-current="page"
          className={`${TAB} border-primary text-ink focus-visible:outline-2 focus-visible:outline-primary`}
        >
          {t("tabs.organizations")}
        </Link>
      </nav>

      <p className="m-0 text-muted">{t("organizations.intro")}</p>
      {problem ? <Banner tone="danger" title={problem} /> : null}
      {!organizations && !problem ? (
        <p className="m-0 text-muted">{t("organizations.loading")}</p>
      ) : null}
      {organizations && organizations.length === 0 ? (
        <p className="m-0 rounded-2xl border border-line bg-surface px-5 py-4 text-muted">
          {t("organizations.empty")}
        </p>
      ) : null}

      {organizations && organizations.length > 0 ? (
        <>
          <Table>
            <thead>
              <TableRow>
                <TableHead>{t("organizations.columns.name")}</TableHead>
                <TableHead>{t("organizations.columns.kind")}</TableHead>
                <TableHead>{t("organizations.columns.city")}</TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">{t("organizations.columns.actions")}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </thead>
            <tbody>
              {organizations.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-semibold">{o.name}</TableCell>
                  <TableCell className="whitespace-nowrap">{t(`kinds.${o.kind}`)}</TableCell>
                  <TableCell>{[o.city, o.region].filter(Boolean).join(", ")}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        aria-label={t("organizations.editLabel", { name: o.name })}
                        onClick={() => setEditing(o)}
                      >
                        {t("organizations.edit")}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </tbody>
          </Table>
          {nextCursor ? (
            <Button variant="secondary" className="self-start" onClick={() => load(nextCursor)}>
              {t("organizations.loadMore")}
            </Button>
          ) : null}
        </>
      ) : null}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? t("form.addTitle") : t("form.editTitle")}
      >
        {editing ? (
          <OrganizationForm
            organization={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              changed();
              void load(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function OrganizationForm({
  organization,
  onCancel,
  onSaved,
}: {
  organization: Organization | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("app.contacts.form");
  const text = useApiText();
  const { me } = useStudio();
  const [draft, setDraft] = useState(() =>
    organization
      ? draftFrom(organization, me.studio.region)
      : emptyOrganization("school", me.studio.region),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setProblem(null);
    const res = await api(organization ? `/organizations/${organization.id}` : "/organizations", {
      method: organization ? "PATCH" : "POST",
      body: organizationBody(draft),
    });
    setBusy(false);
    if (res.ok) return onSaved();
    setErrors(res.fields);
    if (Object.keys(res.fields).length === 0) setProblem(text.error(res.code));
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <OrganizationFields value={draft} onChange={setDraft} errors={errors} />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
