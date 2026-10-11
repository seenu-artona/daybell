"use client";

import type { Client, ClientsResponse } from "@daybell/api";
import { Badge, Banner, Button, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../dialog";
import { useStudio } from "../../me-context";
import { PageFrame } from "../../page-frame";
import { ClientForm } from "../client-form";

const TAB =
  "inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold no-underline";

/**
 * Contacts › Clients. Clients are added here ahead of time, or from the job form. Parents and Children come later.
 * ?client=<id> (from the menu search, D138 Q2) opens that client in the dialog: editable for owners and admins,
 * read-only for everyone else. Only an id goes in the URL.
 */
export default function ClientsPageRoute() {
  // useSearchParams needs a Suspense boundary; the page loads its data in the browser anyway.
  return (
    <Suspense>
      <ClientsPage />
    </Suspense>
  );
}

function ClientsPage() {
  const t = useTranslations("app.contacts");
  const text = useApiText();
  const { me } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const [clients, setClients] = useState<Client[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<Client | "new" | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      const res = await api<ClientsResponse>(cursor ? `/clients?cursor=${cursor}` : "/clients");
      if (!res.ok) return setProblem(text.error(res.code));
      setClients((prev) => (cursor && prev ? [...prev, ...res.data.clients] : res.data.clients));
      setNextCursor(res.data.nextCursor);
    },
    [text],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on open.
  useEffect(() => {
    void load(null);
  }, []);

  // A client opened from the menu search: show it, then clean the URL so the same result can be opened again.
  const requested = useSearchParams().get("client");
  const router = useRouter();
  useEffect(() => {
    if (!requested) return;
    let current = true;
    api<{ client: Client }>(`/clients/${encodeURIComponent(requested)}`).then((res) => {
      if (!current) return;
      if (res.ok) setEditing(res.data.client);
      else setProblem(text.error(res.code));
      router.replace("/app/contacts/clients", { scroll: false });
    });
    return () => {
      current = false;
    };
  }, [requested, router, text]);

  return (
    <PageFrame>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-h1">{t("title")}</h1>
        {canManage ? (
          <Button onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("clients.add")}
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
          href="/app/contacts/clients"
          aria-current="page"
          className={`${TAB} border-primary text-ink focus-visible:outline-2 focus-visible:outline-primary`}
        >
          {t("tabs.clients")}
        </Link>
      </nav>

      <p className="m-0 text-muted">{t("clients.intro")}</p>
      {problem ? <Banner tone="danger" title={problem} /> : null}
      {!clients && !problem ? <p className="m-0 text-muted">{t("clients.loading")}</p> : null}
      {clients && clients.length === 0 ? (
        <p className="m-0 rounded-2xl border border-line bg-surface px-5 py-4 text-muted">
          {t("clients.empty")}
        </p>
      ) : null}

      {clients && clients.length > 0 ? (
        <>
          <Table>
            <thead>
              <TableRow>
                <TableHead>{t("clients.columns.name")}</TableHead>
                <TableHead>{t("clients.columns.contact")}</TableHead>
                <TableHead>{t("clients.columns.city")}</TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">{t("clients.columns.actions")}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </thead>
            <tbody>
              {clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold">{c.name}</TableCell>
                  <TableCell>
                    {[c.contactFirstName, c.contactLastName].filter(Boolean).join(" ")}
                  </TableCell>
                  <TableCell>{[c.city, c.region].filter(Boolean).join(", ")}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        aria-label={t("clients.editLabel", { name: c.name })}
                        onClick={() => setEditing(c)}
                      >
                        {t("clients.edit")}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </tbody>
          </Table>
          {nextCursor ? (
            <Button variant="secondary" className="self-start" onClick={() => load(nextCursor)}>
              {t("clients.loadMore")}
            </Button>
          ) : null}
        </>
      ) : null}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing === "new"
            ? t("form.addTitle")
            : canManage
              ? t("form.editTitle")
              : t("form.viewTitle")
        }
      >
        {editing ? (
          <ClientForm
            client={editing === "new" ? null : editing}
            readOnly={!canManage}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void load(null);
            }}
          />
        ) : null}
      </Dialog>
    </PageFrame>
  );
}
