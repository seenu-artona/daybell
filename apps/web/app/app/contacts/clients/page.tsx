"use client";

import type { Client, ClientsResponse } from "@daybell/api";
import {
  Banner,
  Button,
  ClickableRow,
  ListCard,
  RowChevron,
  RowChevronHead,
  SearchToggle,
  Table,
  TableCell,
  TableHead,
  TableRow,
} from "@daybell/ui";
import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog } from "../../dialog";
import { ListPage } from "../../list-page";
import { useStudio } from "../../me-context";
import { ClientForm } from "../client-form";

/** How long the search waits after the last key before asking the API (GET /clients?q=). */
const CLIENT_SEARCH_DEBOUNCE_MS = 300;

const NAME_BUTTON =
  "inline-flex min-h-11 items-center text-left font-bold text-ink hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * Clients (D144; the menu's Clients, at /app/contacts/clients). Clients are added here ahead of time, or from the job
 * form. One view bar: the search (GET /clients?q=, by name; never in the address, D113) and the green New client. A
 * click on a row, or its name, opens the client in the dialog: editable for owners and admins, read-only for everyone
 * else. ?client=<id> (from the menu search, D138 Q2) opens that client the same way. Only an id goes in the URL.
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
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  // Only the newest request may fill the list, so a slow answer to an older search can't replace a newer one.
  const latest = useRef(0);

  const load = useCallback(
    async (cursor: string | null) => {
      const request = ++latest.current;
      const query = new URLSearchParams();
      if (q) query.set("q", q);
      if (cursor) query.set("cursor", cursor);
      const s = query.toString();
      const res = await api<ClientsResponse>(`/clients${s ? `?${s}` : ""}`);
      if (request !== latest.current) return;
      if (!res.ok) return setProblem(text.error(res.code));
      setProblem(null);
      setClients((prev) => (cursor && prev ? [...prev, ...res.data.clients] : res.data.clients));
      setNextCursor(res.data.nextCursor);
    },
    [text, q],
  );

  // A new search starts from the first page.
  useEffect(() => {
    void load(null);
  }, [load]);

  // The search asks the API once typing pauses.
  useEffect(() => {
    const next = typed.trim();
    const timer = setTimeout(() => setQ(next), CLIENT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

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
    <ListPage
      title={t("title")}
      actions={
        <>
          <SearchToggle label={t("clients.searchLabel")} value={typed} onChange={setTyped} />
          {canManage ? (
            <Button shape="pill" onClick={() => setEditing("new")}>
              <Plus aria-hidden="true" />
              {t("clients.add")}
            </Button>
          ) : null}
        </>
      }
    >
      {problem ? <Banner tone="danger" title={problem} /> : null}
      {!clients && !problem ? <p className="m-0 text-muted">{t("clients.loading")}</p> : null}
      {clients && clients.length === 0 ? (
        <p className="m-0 rounded-list bg-surface px-6 py-10 text-center text-muted shadow-card">
          {q ? t("clients.noMatches") : t("clients.empty")}
        </p>
      ) : null}

      {clients && clients.length > 0 ? (
        <ListCard
          footer={
            nextCursor ? (
              <Button variant="quiet" shape="pill" onClick={() => load(nextCursor)}>
                {t("clients.loadMore")}
              </Button>
            ) : null
          }
        >
          <Table variant="list">
            <thead>
              <TableRow>
                <TableHead>{t("clients.columns.name")}</TableHead>
                <TableHead>{t("clients.columns.contact")}</TableHead>
                <TableHead>{t("clients.columns.city")}</TableHead>
                <RowChevronHead />
              </TableRow>
            </thead>
            <tbody>
              {clients.map((c) => (
                <ClickableRow key={c.id} onActivate={() => setEditing(c)}>
                  <TableCell>
                    <button type="button" className={NAME_BUTTON} onClick={() => setEditing(c)}>
                      {c.name}
                    </button>
                  </TableCell>
                  <TableCell>
                    {[c.contactFirstName, c.contactLastName].filter(Boolean).join(" ")}
                  </TableCell>
                  <TableCell>{[c.city, c.region].filter(Boolean).join(", ")}</TableCell>
                  <RowChevron />
                </ClickableRow>
              ))}
            </tbody>
          </Table>
        </ListCard>
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
    </ListPage>
  );
}
