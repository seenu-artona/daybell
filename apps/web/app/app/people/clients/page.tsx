"use client";

import type { Client, ClientListItem, ClientsResponse } from "@daybell/api";
import { contactName } from "@daybell/core";
import {
  Banner,
  Button,
  ClickableRow,
  FilterChip,
  FilterChips,
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
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { createLoadGuard } from "@/lib/load-guard";
import { Dialog } from "../../dialog";
import { useStudio } from "../../me-context";
import { ClientForm } from "../client-form";
import { PeoplePage } from "../people-page";

/** How long the search waits after the last key before asking the API (GET /clients?q=). */
const CLIENT_SEARCH_DEBOUNCE_MS = 300;

/** The DOM id of a client's name button, so focus can return to it when the dialog closes. */
const nameId = (clientId: string) => `client-name-${clientId}`;

const NAME_BUTTON =
  "inline-flex min-h-11 items-center text-left font-bold text-ink hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary";
const JOB_LINK =
  "inline-flex min-h-11 items-center text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/**
 * People › Clients (D144, D150; ADR 0028), at /app/people/clients. Clients are added here ahead of time, or from the job
 * form. The green New client in the title row; the list card's toolbar has the All chip only (Seenu's answer 1: no
 * client types) and the search (GET /clients?q=, by name; never in the address, D113). Columns: the client, its main
 * contact (name · role), how many jobs it has and its latest job by picture day (a link to the job). No money. A
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
  const tc = useTranslations("app.chips");
  const text = useApiText();
  const { me } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const [clients, setClients] = useState<ClientListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  // The list's own problem, and the problem opening a client from the menu search (?client=): apart, so neither
  // wipes the other.
  const [listProblem, setListProblem] = useState<string | null>(null);
  const [openProblem, setOpenProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  // Only the newest search may fill the list, and Show more runs once at a time (lib/load-guard).
  const [guard] = useState(createLoadGuard);

  const load = useCallback(
    async (cursor: string | null) => {
      const ticket = cursor ? guard.more() : guard.first();
      if (!ticket) return;
      const query = new URLSearchParams();
      if (q) query.set("q", q);
      if (cursor) query.set("cursor", cursor);
      const s = query.toString();
      const res = await api<ClientsResponse>(`/clients${s ? `?${s}` : ""}`);
      if (!ticket.finish()) return;
      if (!res.ok) return setListProblem(text.error(res.code));
      setListProblem(null);
      setClients((prev) => (cursor && prev ? [...prev, ...res.data.clients] : res.data.clients));
      setNextCursor(res.data.nextCursor);
      if (!cursor) setTotal(res.data.total);
    },
    [text, q, guard],
  );

  /** Opens a client from its row or name; focus goes back to the name when the dialog closes. */
  function open(client: Client) {
    setEditing(client);
  }

  function close() {
    const back = editing !== null && editing !== "new" ? editing.id : null;
    setEditing(null);
    // A client opened from menu search may not be on the loaded page; fall back to the page heading.
    if (back)
      setTimeout(() => {
        const name = document.getElementById(nameId(back));
        if (name) return name.focus();
        const heading = document.querySelector<HTMLElement>("main h1, h1");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus();
      }, 0);
  }

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
      if (res.ok) {
        setOpenProblem(null);
        setEditing(res.data.client);
      } else setOpenProblem(text.error(res.code));
      router.replace("/app/people/clients", { scroll: false });
    });
    return () => {
      current = false;
    };
  }, [requested, router, text]);

  return (
    <PeoplePage
      current="clients"
      action={
        canManage ? (
          <Button shape="pill" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("clients.add")}
          </Button>
        ) : null
      }
    >
      {openProblem ? <Banner tone="danger" title={openProblem} /> : null}
      {listProblem ? <Banner tone="danger" title={listProblem} /> : null}

      <ListCard
        toolbar={
          <FilterChips label={t("clients.chipsLabel")}>
            <FilterChip asChild selected>
              <Link href="/app/people/clients" scroll={false}>
                {tc("all")}
              </Link>
            </FilterChip>
          </FilterChips>
        }
        toolbarEnd={
          <SearchToggle label={t("clients.searchLabel")} value={typed} onChange={setTyped} onCard />
        }
        footer={
          clients && clients.length > 0 ? (
            <>
              {total !== null ? <span>{t("clients.footer", { count: total })}</span> : null}
              {nextCursor ? (
                <Button
                  variant="quiet"
                  shape="pill"
                  className="ml-auto"
                  onClick={() => {
                    // While a new search waits to be sent, the list on screen is about to change: no next page of it.
                    if (typed.trim() === q) void load(nextCursor);
                  }}
                >
                  {t("clients.loadMore")}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {!clients && !listProblem ? (
          <p className="m-0 px-6 py-10 text-center text-muted">{t("clients.loading")}</p>
        ) : null}
        {clients && clients.length === 0 ? (
          <p className="m-0 px-6 py-10 text-center text-muted">
            {q ? t("clients.noMatches") : t("clients.empty")}
          </p>
        ) : null}

        {clients && clients.length > 0 ? (
          <Table variant="list">
            <thead>
              <TableRow>
                <TableHead>{t("clients.columns.name")}</TableHead>
                <TableHead>{t("clients.columns.mainContact")}</TableHead>
                <TableHead>{t("clients.columns.jobs")}</TableHead>
                <TableHead>{t("clients.columns.latestJob")}</TableHead>
                <RowChevronHead />
              </TableRow>
            </thead>
            <tbody>
              {clients.map((c) => (
                <ClickableRow key={c.id} onActivate={() => open(c)}>
                  <TableCell>
                    <button
                      type="button"
                      id={nameId(c.id)}
                      className={NAME_BUTTON}
                      onClick={() => open(c)}
                    >
                      {c.name}
                    </button>
                  </TableCell>
                  <TableCell>
                    {c.mainContact ? (
                      c.mainContact.role ? (
                        t("clients.mainContact", {
                          name: contactName(c.mainContact),
                          role: c.mainContact.role,
                        })
                      ) : (
                        contactName(c.mainContact)
                      )
                    ) : (
                      <span className="text-muted">{t("clients.noContact")}</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{c.jobCount}</TableCell>
                  <TableCell>
                    {c.latestJob ? (
                      <Link href={`/app/jobs/${c.latestJob.id}`} className={JOB_LINK}>
                        {c.latestJob.name}
                      </Link>
                    ) : (
                      <span className="text-muted">{t("clients.noJobs")}</span>
                    )}
                  </TableCell>
                  <RowChevron />
                </ClickableRow>
              ))}
            </tbody>
          </Table>
        ) : null}
      </ListCard>

      <Dialog
        open={editing !== null}
        onClose={close}
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
            onCancel={close}
            onSaved={() => {
              close();
              void load(null);
            }}
          />
        ) : null}
      </Dialog>
    </PeoplePage>
  );
}
