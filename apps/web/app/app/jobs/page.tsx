"use client";

import type { ClientsResponse, JobListItem, JobsResponse, ListFilterChip } from "@daybell/api";
import { closesSoon, closingDay, localDay } from "@daybell/core";
import {
  Banner,
  Button,
  Card,
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
import { Camera, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { createLoadGuard } from "@/lib/load-guard";
import { Dialog } from "../dialog";
import type { AddFilterChoice } from "../filter-chips/add-filter-menu";
import { type ChipItem, ChipRow } from "../filter-chips/chip-row";
import { SavedChipsNotice } from "../filter-chips/saved-chips-notice";
import { useListFilters } from "../filter-chips/use-list-filters";
import { clientName, recordKey, useRecordNames } from "../filter-chips/use-record-names";
import { ListPage } from "../list-page";
import { useStudio } from "../me-context";
import { JobForm } from "./job-form";
import {
  ALL_JOBS,
  BUILT_IN_JOB_CHIPS,
  type JobChip,
  jobChipFrom,
  jobChipFromSaved,
  jobChipHref,
  jobsQuery,
  sameJobChip,
} from "./job-views";
import { JobsSections } from "./jobs-sections";
import { StatusBadge, useFormatDay } from "./status-badge";

const NAME_LINK =
  "inline-flex min-h-11 items-center font-bold text-ink no-underline hover:underline group-hover:underline focus-visible:outline-2 focus-visible:outline-primary";

/** Search asks the API once typing pauses, like Clients (D144). */
const SEARCH_DEBOUNCE_MS = 300;

export default function JobsPageRoute() {
  // useSearchParams (the chip) needs a Suspense boundary.
  return (
    <Suspense>
      <JobsPage />
    </Suspense>
  );
}

/**
 * Jobs list (Phase 1 step 1; D143, D144; D147). Everyone on the team sees it; owners and admins create jobs in a dialog
 * (the green New job, or /app/jobs?new=1 from Home). The list card's toolbar has the chips (All, Draft, Selling,
 * Closed, then the person's own: Shop closes this week, Picture day this month, a client) and the search (name or job
 * number, never in the address). Columns: job, client, picture day, status and when the shop closes. A row opens the
 * job; its name stays the link.
 */
function JobsPage() {
  const t = useTranslations("app.jobs");
  const tc = useTranslations("app.chips");
  const text = useApiText();
  const router = useRouter();
  const formatDay = useFormatDay();
  const { me, changed } = useStudio();
  const canManage = me.studio.role === "owner" || me.studio.role === "admin";
  const params = useSearchParams();
  const query = params.toString();
  const { chip, clean } = useMemo(() => jobChipFrom(new URLSearchParams(query)), [query]);
  const saved = useListFilters("jobs");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [guard] = useState(createLoadGuard);

  // An address with a filter the list doesn't know (or two at once) goes back to All.
  useEffect(() => {
    if (clean) router.replace(jobChipHref(ALL_JOBS), { scroll: false });
  }, [clean, router]);

  useEffect(() => {
    const next = typed.trim();
    const timer = setTimeout(() => setSearch(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback(
    async (cursor: string | null) => {
      // An older chip's or search's slow answer is dropped; Show more runs once at a time (no duplicate pages).
      const ticket = cursor ? guard.more() : guard.first();
      if (!ticket) return;
      // The browser's own day, so "this week" and "this month" are the person's (ADR 0017).
      const res = await api<JobsResponse>(jobsQuery(chip, localDay(new Date()), cursor, search));
      if (!ticket.finish()) return;
      if (!res.ok) {
        setError(text.error(res.code));
        return;
      }
      setError(null);
      setJobs((prev) => (cursor && prev ? [...prev, ...res.data.jobs] : res.data.jobs));
      setNextCursor(res.data.nextCursor);
    },
    [text, chip, search, guard],
  );

  useEffect(() => {
    setJobs(null);
    void load(null);
  }, [load]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ?new=1 opens the form once.
  useEffect(() => {
    if (canManage && new URLSearchParams(window.location.search).get("new") === "1") {
      setCreating(true);
      router.replace("/app/jobs");
    }
  }, []);

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
      router.replace(jobChipHref(ALL_JOBS), { scroll: false });
  }, [names, saved.chips, forget, chip, router]);

  const label = (c: JobChip): string => {
    switch (c.kind) {
      case "all":
        return tc("all");
      case "status":
        return t(`statuses.${c.status}`);
      case "show":
        return t(`chips.${c.show}`);
      case "client":
        return names.get(recordKey("client", c.id)) ?? tc("loadingName");
    }
  };
  const item = (c: JobChip, remove?: ListFilterChip): ChipItem => ({
    id: jobChipHref(c),
    label: label(c),
    selected: sameJobChip(c, chip),
    href: jobChipHref(c),
    // Until the record's name is known, the chip is named by its kind rather than "…".
    ...(c.kind === "client" && !names.get(recordKey("client", c.id))
      ? { ariaLabel: t("chips.client") }
      : {}),
    ...(remove
      ? {
          onRemove: () => {
            void saved.remove(remove);
            if (sameJobChip(c, chip)) router.push(jobChipHref(ALL_JOBS), { scroll: false });
          },
          // Until the client's name is known, the button says what kind of chip it removes.
          ...(c.kind === "client" && !names.get(recordKey("client", c.id))
            ? { removeLabel: tc("remove", { name: t("chips.client") }) }
            : {}),
        }
      : {}),
  });
  const added = (saved.chips ?? []).flatMap((s) => {
    const c = jobChipFromSaved(s);
    return c ? [{ chip: c, saved: s }] : [];
  });
  const items: ChipItem[] = [
    ...BUILT_IN_JOB_CHIPS.map((c) => item(c)),
    ...added.map((a) => item(a.chip, a.saved)),
  ];
  // A chip in the address that isn't saved (a shared link) still shows, selected, without a remove button.
  if (!items.some((i) => i.selected)) items.push(item(chip));

  /** Saves a chip and shows it at once. */
  const addChip = (saving: ListFilterChip, c: JobChip) => {
    void saved.add(saving);
    router.push(jobChipHref(c), { scroll: false });
  };
  const has = (key: string) => added.some((a) => a.saved.key === key);
  // Nothing can be added until the saved chips have loaded (a list built from a failed load is never saved).
  const choices: AddFilterChoice[] =
    saved.chips === null || saved.full
      ? []
      : [
          ...(["closingThisWeek", "pictureDayThisMonth"] as const)
            .filter((show) => !has(show))
            .map(
              (show): AddFilterChoice => ({
                kind: "plain",
                id: show,
                label: t(`chips.${show}`),
                onPick: () => addChip({ key: show, value: null }, { kind: "show", show }),
              }),
            ),
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
            onPick: (option) =>
              addChip({ key: "client", value: option.id }, { kind: "client", id: option.id }),
          },
        ];

  // With no jobs at all, the empty card has its own "Create your first job".
  const noJobsYet = chip.kind === "all" && search === "" && jobs !== null && jobs.length === 0;

  return (
    <ListPage
      title={t("title")}
      action={
        canManage && !noJobsYet ? (
          <Button shape="pill" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("new")}
          </Button>
        ) : null
      }
      sections={<JobsSections current="list" />}
    >
      <SavedChipsNotice filters={saved} />
      {error ? <Banner tone="danger" title={error} /> : null}

      {noJobsYet ? (
        <Card variant="sheet" className="flex flex-col items-center gap-3 py-12 text-center">
          <span
            className="grid size-14 place-items-center rounded-full bg-primary-soft"
            aria-hidden="true"
          >
            <Camera className="size-6" />
          </span>
          <h2 className="m-0 text-h2">{t("emptyTitle")}</h2>
          <p className="m-0 max-w-100 text-muted">{t("emptyBody")}</p>
          {canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t("emptyCta")}
            </Button>
          ) : (
            <p className="m-0 text-caption text-muted">{t("emptyReadOnly")}</p>
          )}
        </Card>
      ) : (
        <ListCard
          toolbar={<ChipRow label={t("chips.label")} items={items} choices={choices} />}
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
            nextCursor ? (
              <Button variant="quiet" shape="pill" onClick={() => load(nextCursor)}>
                {t("loadMore")}
              </Button>
            ) : null
          }
        >
          {!jobs ? (
            <p className="m-0 px-6 py-10 text-center text-muted">{t("loading")}</p>
          ) : jobs.length === 0 ? (
            <p className="m-0 px-6 py-10 text-center text-muted">
              {chip.kind === "all" && search === "" ? t("emptyView") : t("emptyFiltered")}
            </p>
          ) : (
            <Table variant="list">
              <thead>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.client")}</TableHead>
                  <TableHead>{t("columns.pictureDay")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead>{t("columns.shopCloses")}</TableHead>
                  <RowChevronHead />
                </TableRow>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <ClickableRow key={job.id} onActivate={() => router.push(`/app/jobs/${job.id}`)}>
                    {/* One line per job, as in the approved F_Jobs (D147; Seenu, Oct 14): no job number under the
                        name, and the 44px name link sets the row's height (D91). The number stays searchable and is
                        on the job's own page. */}
                    <TableCell className="py-1">
                      <Link href={`/app/jobs/${job.id}`} className={NAME_LINK}>
                        {job.name}
                      </Link>
                    </TableCell>
                    <TableCell>{job.client?.name ?? t("none")}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDay(job.pictureDay)}</TableCell>
                    <TableCell>
                      <StatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <ShopCloses job={job} />
                    </TableCell>
                    <RowChevron />
                  </ClickableRow>
                ))}
              </tbody>
            </Table>
          )}
        </ListCard>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title={t("form.createTitle")}>
        <JobForm
          job={null}
          onCancel={() => setCreating(false)}
          onSaved={(job) => {
            setCreating(false);
            changed();
            router.push(`/app/jobs/${job.id}`);
          }}
        />
      </Dialog>
    </ListPage>
  );
}

/**
 * When the shop closes (D147): a draft is "Not selling yet", a closed job "Closed", a selling one its last day to order
 * in the viewer's own time, or "No closing date". Two days or fewer away, it is amber and says so in words too
 * ("Oct 15, 2026 · in 2 days"), never colour alone (D91).
 */
function ShopCloses({ job }: { job: JobListItem }) {
  const t = useTranslations("app.jobs.shopCloses");
  const formatDay = useFormatDay();
  if (job.status === "draft") return <span className="text-muted">{t("notSelling")}</span>;
  if (job.status === "closed") return <span>{t("closed")}</span>;
  if (!job.closesAt) return <span className="text-muted">{t("none")}</span>;
  const date = formatDay(closingDay(job.closesAt));
  const days = closesSoon(job.closesAt, localDay(new Date()));
  return days === null ? (
    <span>{date}</span>
  ) : (
    <span className="font-semibold text-warning-text">{t("soon", { date, days })}</span>
  );
}
