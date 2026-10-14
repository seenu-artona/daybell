"use client";

import type {
  ClientsResponse,
  JobsResponse,
  ListFilterChip,
  Subject,
  SubjectsResponse,
} from "@daybell/api";
import { canSeeOrders } from "@daybell/core";
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
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { createLoadGuard } from "@/lib/load-guard";
import type { AddFilterChoice } from "../../filter-chips/add-filter-menu";
import { type ChipItem, ChipRow } from "../../filter-chips/chip-row";
import { SavedChipsNotice } from "../../filter-chips/saved-chips-notice";
import { useListFilters } from "../../filter-chips/use-list-filters";
import {
  clientName,
  jobName,
  recordKey,
  useRecordNames,
} from "../../filter-chips/use-record-names";
import { useStudio } from "../../me-context";
import { PeoplePage } from "../people-page";
import {
  ALL_SUBJECTS,
  builtInSubjectChips,
  childHref,
  type PeopleSubjectChip,
  peopleSubjectChipFrom,
  peopleSubjectChipFromSaved,
  peopleSubjectChipHref,
  samePeopleSubjectChip,
  subjectsRequest,
} from "../people-views";

/** The search asks the API once typing pauses, like Clients (D144). */
const SEARCH_DEBOUNCE_MS = 300;

const LINK =
  "inline-flex min-h-11 items-center text-ink no-underline hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary";

export default function SubjectsPageRoute() {
  // useSearchParams (the chip) needs a Suspense boundary.
  return (
    <Suspense>
      <SubjectsPage />
    </Suspense>
  );
}

/**
 * People › Subjects (D150; Seenu's answer 4; ADR 0028): every child across the studio's jobs, one row per child per
 * job. Chips: All, Ordered and Not ordered (D148; only for people who see orders), and a job or client added from
 * "+ Add filter" (saved per person, D147). The search finds a name through POST /subjects/search (never in the
 * address, D113). Columns: Name, Class, Job (a link to the job) and, for people who see orders, Ordered. A row opens
 * the child on their job's Subjects tab (?child=<id>). The footer counts the subjects and their jobs.
 */
function SubjectsPage() {
  const t = useTranslations("app.subjectsList");
  const tc = useTranslations("app.chips");
  const text = useApiText();
  const router = useRouter();
  const { me } = useStudio();
  const seesOrders = canSeeOrders(me.studio.role);
  const query = useSearchParams().toString();
  const { chip, clean } = useMemo(
    () => peopleSubjectChipFrom(new URLSearchParams(query), { seesOrders }),
    [query, seesOrders],
  );
  const saved = useListFilters("people_subjects");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ total: number; jobs: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [guard] = useState(createLoadGuard);

  // An address with a filter the list doesn't know (or an order chip for someone who doesn't see orders) goes to All.
  useEffect(() => {
    if (clean) router.replace(peopleSubjectChipHref(ALL_SUBJECTS), { scroll: false });
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
      const request = subjectsRequest(chip, cursor, search);
      const res = await api<SubjectsResponse>(
        request.path,
        request.body ? { method: "POST", body: request.body } : undefined,
      );
      if (!ticket.finish()) return;
      if (!res.ok) return setProblem(text.error(res.code));
      setProblem(null);
      setSubjects((prev) => (cursor && prev ? [...prev, ...res.data.subjects] : res.data.subjects));
      setNextCursor(res.data.nextCursor);
      if (!cursor) setCounts({ total: res.data.total, jobs: res.data.jobs });
    },
    [text, chip, search, guard],
  );

  useEffect(() => {
    setSubjects(null);
    void load(null);
  }, [load]);

  // Jobs' and clients' names, by id; a saved one that is gone is dropped, and an address naming one goes to All.
  const refs = useMemo<ListFilterChip[]>(
    () => [
      ...(saved.chips ?? []),
      ...(chip.kind === "job" || chip.kind === "client"
        ? [{ key: chip.kind, value: chip.id }]
        : []),
    ],
    [saved.chips, chip],
  );
  const names = useRecordNames(refs, { job: jobName, client: clientName });
  const { forget } = saved;
  useEffect(() => {
    const gone = (saved.chips ?? []).filter(
      (c) => c.value !== null && names.get(recordKey(c.key, c.value)) === null,
    );
    if (gone.length > 0) forget(gone);
    if (
      (chip.kind === "job" || chip.kind === "client") &&
      names.get(recordKey(chip.kind, chip.id)) === null
    )
      router.replace(peopleSubjectChipHref(ALL_SUBJECTS), { scroll: false });
  }, [names, saved.chips, forget, chip, router]);

  const label = (c: PeopleSubjectChip): string => {
    switch (c.kind) {
      case "all":
        return tc("all");
      case "show":
        return t(`chips.${c.show}`);
      case "job":
      case "client":
        return names.get(recordKey(c.kind, c.id)) ?? tc("loadingName");
    }
  };
  /** A job's or client's chip whose name is still loading is named by its kind. */
  const kindName = (c: PeopleSubjectChip): string | null =>
    (c.kind === "job" || c.kind === "client") && !names.get(recordKey(c.kind, c.id))
      ? t(`chips.${c.kind}`)
      : null;
  const item = (c: PeopleSubjectChip, remove?: ListFilterChip): ChipItem => {
    const kind = kindName(c);
    return {
      id: peopleSubjectChipHref(c),
      label: label(c),
      selected: samePeopleSubjectChip(c, chip),
      href: peopleSubjectChipHref(c),
      ...(kind ? { ariaLabel: kind } : {}),
      ...(remove
        ? {
            onRemove: () => {
              void saved.remove(remove);
              if (samePeopleSubjectChip(c, chip))
                router.push(peopleSubjectChipHref(ALL_SUBJECTS), { scroll: false });
            },
            ...(kind ? { removeLabel: tc("remove", { name: kind }) } : {}),
          }
        : {}),
    };
  };
  const added = (saved.chips ?? []).flatMap((s) => {
    const c = peopleSubjectChipFromSaved(s);
    return c ? [{ chip: c, saved: s }] : [];
  });
  const items: ChipItem[] = [
    ...builtInSubjectChips(seesOrders).map((c) => item(c)),
    ...added.map((a) => item(a.chip, a.saved)),
  ];
  // A chip in the address that isn't saved (a shared link) still shows, selected, without a remove button.
  if (!items.some((i) => i.selected)) items.push(item(chip));

  const addChip = (c: PeopleSubjectChip & { kind: "job" | "client" }) => {
    void saved.add({ key: c.kind, value: c.id });
    router.push(peopleSubjectChipHref(c), { scroll: false });
  };
  const isAdded = (key: string, id: string) =>
    added.some((a) => a.saved.key === key && a.saved.value === id);
  // Nothing can be added until the saved chips have loaded (a list built from a failed load is never saved).
  const choices: AddFilterChoice[] =
    saved.chips === null || saved.full
      ? []
      : [
          {
            kind: "search",
            id: "job",
            label: t("chips.jobMenu"),
            fieldLabel: t("chips.job"),
            placeholder: t("chips.jobPlaceholder"),
            listLabel: t("chips.jobList"),
            search: async (q) => {
              const res = await api<JobsResponse>(
                `/jobs?limit=20${q ? `&q=${encodeURIComponent(q)}` : ""}`,
              );
              return res.ok
                ? res.data.jobs
                    .filter((j) => !isAdded("job", j.id))
                    .map((j) => ({ id: j.id, name: j.name, detail: j.internalNumber }))
                : null;
            },
            onPick: (option) => addChip({ kind: "job", id: option.id }),
          },
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
                    .filter((c) => !isAdded("client", c.id))
                    .map((c) => ({ id: c.id, name: c.name, detail: c.city }))
                : null;
            },
            onPick: (option) => addChip({ kind: "client", id: option.id }),
          },
        ];

  return (
    <PeoplePage current="subjects">
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
          subjects && subjects.length > 0 ? (
            <>
              {counts ? (
                <span>{t("footer", { count: counts.total, jobs: counts.jobs })}</span>
              ) : null}
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
        {!subjects && !problem ? (
          <p className="m-0 px-6 py-10 text-center text-muted">{t("loading")}</p>
        ) : null}
        {subjects && subjects.length === 0 ? (
          <p className="m-0 px-6 py-10 text-center text-muted">
            {chip.kind === "all" && search === "" ? t("empty") : t("noMatches")}
          </p>
        ) : null}
        {subjects && subjects.length > 0 ? (
          <Table variant="list">
            <thead>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.class")}</TableHead>
                <TableHead>{t("columns.job")}</TableHead>
                {seesOrders ? <TableHead>{t("columns.ordered")}</TableHead> : null}
                <RowChevronHead />
              </TableRow>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <ClickableRow key={s.id} onActivate={() => router.push(childHref(s))}>
                  <TableCell>
                    <Link href={childHref(s)} className={`${LINK} font-bold`}>
                      {s.firstName} {s.lastName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {s.className ?? <span className="text-muted">{t("noClass")}</span>}
                  </TableCell>
                  <TableCell>
                    <Link href={`/app/jobs/${s.job.id}`} className={LINK}>
                      {s.job.name}
                    </Link>
                  </TableCell>
                  {seesOrders ? (
                    <TableCell>
                      {s.hasPaidOrder === null ? null : s.hasPaidOrder ? (
                        t("ordered.yes")
                      ) : (
                        <span className="text-muted">{t("ordered.no")}</span>
                      )}
                    </TableCell>
                  ) : null}
                  <RowChevron />
                </ClickableRow>
              ))}
            </tbody>
          </Table>
        ) : null}
      </ListCard>
    </PeoplePage>
  );
}
