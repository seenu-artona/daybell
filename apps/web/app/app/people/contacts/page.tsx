"use client";

import type { ClientsResponse, Contact, ContactsResponse, ListFilterChip } from "@daybell/api";
import { contactName } from "@daybell/core";
import {
  Badge,
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
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { createLoadGuard } from "@/lib/load-guard";
import { Dialog } from "../../dialog";
import type { AddFilterChoice } from "../../filter-chips/add-filter-menu";
import { type ChipItem, ChipRow } from "../../filter-chips/chip-row";
import { SavedChipsNotice } from "../../filter-chips/saved-chips-notice";
import { useListFilters } from "../../filter-chips/use-list-filters";
import { clientName, recordKey, useRecordNames } from "../../filter-chips/use-record-names";
import { useStudio } from "../../me-context";
import { ContactForm } from "../contact-form";
import { PeoplePage } from "../people-page";
import {
  ALL_CONTACTS,
  BUILT_IN_CONTACT_CHIPS,
  type ContactChip,
  contactChipFrom,
  contactChipFromSaved,
  contactChipHref,
  contactsRequest,
  sameContactChip,
} from "../people-views";

/** The search asks the API once typing pauses, like Clients (D144). */
const SEARCH_DEBOUNCE_MS = 300;

/** The DOM id of a contact's name button, so focus can return to it when the dialog closes. */
const nameId = (contactId: string) => `contact-name-${contactId}`;

const NAME_BUTTON =
  "inline-flex min-h-11 items-center text-left font-bold text-ink hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary";

export default function ContactsPageRoute() {
  // useSearchParams (the chip) needs a Suspense boundary.
  return (
    <Suspense>
      <ContactsPage />
    </Suspense>
  );
}

/**
 * People › Contacts (D150; Seenu's answer 3; ADR 0028): the people the studio works with at each client. Chips: All,
 * Main contacts, and a client added from "+ Add filter" (saved per person, D147); the search finds a name or email
 * through POST /contacts/search (never in the address, D113). Columns: Name (with a "Main" badge for the client's main
 * contact: the word, not colour alone, D91), Role, Client, Email. A row opens the contact in a dialog: editable for
 * owners and admins, read-only for everyone else. Owners and admins add contacts with the green New contact.
 */
function ContactsPage() {
  const t = useTranslations("app.contactsList");
  const tc = useTranslations("app.chips");
  const text = useApiText();
  const router = useRouter();
  const { me } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const query = useSearchParams().toString();
  const { chip, clean } = useMemo(() => contactChipFrom(new URLSearchParams(query)), [query]);
  const saved = useListFilters("people_contacts");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [guard] = useState(createLoadGuard);

  // An address with a filter the list doesn't know (or two at once) goes back to All.
  useEffect(() => {
    if (clean) router.replace(contactChipHref(ALL_CONTACTS), { scroll: false });
  }, [clean, router]);

  useEffect(() => {
    const next = typed.trim();
    const timer = setTimeout(() => setSearch(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback(
    async (cursor: string | null) => {
      // An older chip's or search's slow answer is dropped; Show more runs once at a time.
      const ticket = cursor ? guard.more() : guard.first();
      if (!ticket) return;
      const request = contactsRequest(chip, cursor, search);
      const res = await api<ContactsResponse>(
        request.path,
        request.body ? { method: "POST", body: request.body } : undefined,
      );
      if (!ticket.finish()) return;
      if (!res.ok) return setProblem(text.error(res.code));
      setProblem(null);
      setContacts((prev) => (cursor && prev ? [...prev, ...res.data.contacts] : res.data.contacts));
      setNextCursor(res.data.nextCursor);
      if (!cursor) setTotal(res.data.total);
    },
    [text, chip, search, guard],
  );

  useEffect(() => {
    setContacts(null);
    void load(null);
  }, [load]);

  // Clients' names, by id; a saved client that is gone is dropped, and an address naming one goes back to All.
  const refs = useMemo<ListFilterChip[]>(
    () => [
      ...(saved.chips ?? []),
      ...(chip.kind === "client" ? [{ key: "client", value: chip.id }] : []),
    ],
    [saved.chips, chip],
  );
  const names = useRecordNames(refs, { client: clientName });
  const { forget } = saved;
  useEffect(() => {
    const gone = (saved.chips ?? []).filter(
      (c) => c.value !== null && names.get(recordKey(c.key, c.value)) === null,
    );
    if (gone.length > 0) forget(gone);
    if (chip.kind === "client" && names.get(recordKey("client", chip.id)) === null)
      router.replace(contactChipHref(ALL_CONTACTS), { scroll: false });
  }, [names, saved.chips, forget, chip, router]);

  const label = (c: ContactChip): string => {
    switch (c.kind) {
      case "all":
        return tc("all");
      case "main":
        return t("chips.main");
      case "client":
        return names.get(recordKey("client", c.id)) ?? tc("loadingName");
    }
  };
  const unnamed = (c: ContactChip) => c.kind === "client" && !names.get(recordKey("client", c.id));
  const item = (c: ContactChip, remove?: ListFilterChip): ChipItem => ({
    id: contactChipHref(c),
    label: label(c),
    selected: sameContactChip(c, chip),
    href: contactChipHref(c),
    ...(unnamed(c) ? { ariaLabel: t("chips.client") } : {}),
    ...(remove
      ? {
          onRemove: () => {
            void saved.remove(remove);
            if (sameContactChip(c, chip))
              router.push(contactChipHref(ALL_CONTACTS), { scroll: false });
          },
          ...(unnamed(c) ? { removeLabel: tc("remove", { name: t("chips.client") }) } : {}),
        }
      : {}),
  });
  const added = (saved.chips ?? []).flatMap((s) => {
    const c = contactChipFromSaved(s);
    return c ? [{ chip: c, saved: s }] : [];
  });
  const items: ChipItem[] = [
    ...BUILT_IN_CONTACT_CHIPS.map((c) => item(c)),
    ...added.map((a) => item(a.chip, a.saved)),
  ];
  // A chip in the address that isn't saved (a shared link) still shows, selected, without a remove button.
  if (!items.some((i) => i.selected)) items.push(item(chip));

  // Nothing can be added until the saved chips have loaded (a list built from a failed load is never saved).
  const choices: AddFilterChoice[] =
    saved.chips === null || saved.full
      ? []
      : [
          {
            kind: "search",
            id: "client",
            label: t("chips.clientMenu"),
            fieldLabel: t("chips.client"),
            placeholder: t("chips.clientPlaceholder"),
            listLabel: t("chips.clientList"),
            search: async (q) => {
              const res = await api<ClientsResponse>(
                `/clients?limit=20${q ? `&q=${encodeURIComponent(q)}` : ""}`,
              );
              return res.ok
                ? res.data.clients
                    .filter((c) => !added.some((a) => a.saved.value === c.id))
                    .map((c) => ({ id: c.id, name: c.name, detail: c.city }))
                : null;
            },
            onPick: (option) => {
              void saved.add({ key: "client", value: option.id });
              router.push(contactChipHref({ kind: "client", id: option.id }), { scroll: false });
            },
          },
        ];

  function close() {
    const back = editing !== null && editing !== "new" ? editing.id : null;
    setEditing(null);
    if (back) setTimeout(() => document.getElementById(nameId(back))?.focus(), 0);
  }

  return (
    <PeoplePage
      current="contacts"
      action={
        canManage ? (
          <Button shape="pill" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("add")}
          </Button>
        ) : null
      }
    >
      <SavedChipsNotice filters={saved} />
      {problem ? <Banner tone="danger" title={problem} /> : null}

      <ListCard
        toolbar={<ChipRow label={t("chipsLabel")} items={items} choices={choices} />}
        toolbarEnd={
          <SearchToggle
            label={t("searchLabel")}
            value={typed}
            onChange={setTyped}
            maxLength={120}
            onCard
          />
        }
        footer={
          contacts && contacts.length > 0 ? (
            <>
              {total !== null ? <span>{t("footer", { count: total })}</span> : null}
              {nextCursor ? (
                <Button
                  variant="quiet"
                  shape="pill"
                  className="ml-auto"
                  onClick={() => {
                    // While a new search waits to be sent, the list on screen is about to change.
                    if (typed.trim() === search) void load(nextCursor);
                  }}
                >
                  {t("loadMore")}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {!contacts && !problem ? (
          <p className="m-0 px-6 py-10 text-center text-muted">{t("loading")}</p>
        ) : null}
        {contacts && contacts.length === 0 ? (
          <p className="m-0 px-6 py-10 text-center text-muted">
            {chip.kind === "all" && search === "" ? t("empty") : t("noMatches")}
          </p>
        ) : null}
        {contacts && contacts.length > 0 ? (
          <Table variant="list">
            <thead>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.role")}</TableHead>
                <TableHead>{t("columns.client")}</TableHead>
                <TableHead>{t("columns.email")}</TableHead>
                <RowChevronHead />
              </TableRow>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <ClickableRow key={c.id} onActivate={() => setEditing(c)}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        id={nameId(c.id)}
                        className={NAME_BUTTON}
                        onClick={() => setEditing(c)}
                      >
                        {contactName(c)}
                      </button>
                      {c.isMain ? <Badge tone="selling">{t("main")}</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell>{c.role ?? ""}</TableCell>
                  <TableCell>{c.clientName}</TableCell>
                  <TableCell className="text-muted">{c.email ?? ""}</TableCell>
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
          <ContactForm
            contact={editing === "new" ? null : editing}
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
