"use client";

import { type Child, QR_CARD_HEADERS } from "@daybell/api";
import {
  applyFilters,
  gradeOptions,
  groupLabel,
  groupPeople,
  matchesSearch,
  ROSTER_VIEW_MAX,
} from "@daybell/core";
import { Banner } from "@daybell/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { download } from "@/lib/client-api";
import { qrCardProblem } from "@/lib/qr-card-messages";
import { Dialog } from "../../../dialog";
import { ChildForm, GroupForm } from "../child-form";
import { useJob } from "../job-context";
import { JobSection } from "../job-section";
import { LiveNote } from "../live-note";
import { RemoveChildDialog } from "../remove-child-dialog";
import { tabHref } from "../tabs";
import { ChildPanel } from "./child-panel";
import { PeopleList, rowLinkId } from "./people-list";
import { type GroupBy, SubjectsTools, SubjectsViews } from "./people-toolbar";
import { PrintQrCardsDialog } from "./print-qr-cards-dialog";
import { useRoster } from "./use-roster";
import {
  type ClassChoice,
  effectiveClassChoice,
  effectiveGrade,
  subjectFilters,
  subjectsHref,
  subjectView,
} from "./views";

export default function PeoplePageRoute() {
  // useSearchParams (the selected child) needs a Suspense boundary.
  return (
    <Suspense>
      <PeoplePage />
    </Suspense>
  );
}

/**
 * A job's Subjects (D137, D138, D144; the People route, Phase 1 step 2's roster): one view bar (the views All,
 * Possible duplicates, Do not photograph and Do not publish in ?show=; quiet class, grade and grouping menus, Print QR
 * cards, the search and the green Add subjects menu), then a flat list with a Class column in a white list card, its
 * footer counting the roster (Group: Class brings the class headings back), and the selected child in the floating
 * panel (?child=<id>, an id only). Add and edit keep the existing child form dialog (D133); Import stays its own page.
 */
function PeoplePage() {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  const tq = useTranslations("app.qrCards");
  const text = useApiText();
  const router = useRouter();
  const { job, summary, refreshSummary, canEditRoster: canEdit } = useJob();
  const word = groupLabel(job.type);
  const base = tabHref(job.id, "people");
  const roster = useRoster(job.id);
  const [query, setQuery] = useState("");
  const [chosenClass, setClassChoice] = useState<ClassChoice>({ kind: "all" });
  const [chosenGrade, setGrade] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Child | "new" | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Child | null>(null);
  const [printing, setPrinting] = useState(false);
  // Set when the person opens a child, so focus moves to the panel; not on a refresh with ?child= in the URL.
  const [panelFocus, setPanelFocus] = useState<string | null>(null);
  const opener = useRef<string | null>(null);

  const params = useSearchParams();
  const selectedId = params.get("child");
  const view = subjectView(params.get("show"));
  const selected = roster.rows?.find((c) => c.id === selectedId) ?? null;
  const childHref = (childId: string) => subjectsHref(base, view, childId);
  // The list's own address: the view stays, the open child goes.
  const here = subjectsHref(base, view);

  // ?imported=a.b (numbers only) and ?print=qr arrive once from Import and Overview; then the URL is cleaned. The view
  // (?show=) stays: it is the list's state (D144).
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once on open.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const imported = params.get("imported")?.match(/^(\d+)\.(\d+)$/);
    const print = params.get("print");
    if (imported)
      setStatus(tr("imported", { added: Number(imported[1]), updated: Number(imported[2]) }));
    if (print === "qr" && canEdit) setPrinting(true);
    if (imported || print) router.replace(here, { scroll: false });
  }, []);

  // A child that isn't on this roster (removed, or another job's id) is dropped from the URL quietly.
  useEffect(() => {
    if (selectedId && roster.rows && !roster.loadingMore && !selected)
      router.replace(here, { scroll: false });
  }, [selectedId, selected, roster.rows, roster.loadingMore, router, here]);

  const grades = useMemo(() => gradeOptions(roster.rows ?? []), [roster.rows]);
  // A class or grade that left the roster (renamed, removed, last child gone) stops filtering: back to All.
  const classChoice = useMemo(
    () => effectiveClassChoice(chosenClass, roster.groups),
    [chosenClass, roster.groups],
  );
  const grade = useMemo(() => effectiveGrade(chosenGrade, grades), [chosenGrade, grades]);
  const filters = useMemo(
    () => subjectFilters({ view, classChoice, grade }),
    [view, classChoice, grade],
  );
  const searching = query.trim() !== "" || filters.length > 0;
  const visible = useMemo(
    () => applyFilters(roster.rows ?? [], filters).filter((c) => matchesSearch(c, query)),
    [roster.rows, filters, query],
  );
  const sections = useMemo(
    () => groupPeople(visible, roster.groups, groupBy, { includeEmptyGroups: !searching }),
    [visible, roster.groups, groupBy, searching],
  );

  /** One child's card, from the panel (Seenu, answer 4): the same card on every print. */
  async function printCard(child: Child) {
    setStatus("");
    const res = await download(`/jobs/${encodeURIComponent(job.id)}/qr-cards`, {
      childId: child.id,
    });
    if (!res.ok) {
      const why = qrCardProblem(res);
      return setStatus(
        why?.key === "skipped"
          ? tq("skipped", { count: why.count })
          : why
            ? tq(why.key)
            : text.error(res.code),
      );
    }
    const skipped = Number(res.headers.get(QR_CARD_HEADERS.skipped) ?? "0");
    setStatus(skipped > 0 ? tq("skipped", { count: skipped }) : tq("printedCard"));
    refreshSummary();
  }

  function changed(message: string) {
    setStatus(message);
    void roster.reload();
    refreshSummary();
  }

  /** Notes who opened the panel: focus moves to it, and returns to this row when it closes. */
  function opened(childId: string) {
    opener.current = childId;
    setPanelFocus(childId);
  }

  function open(childId: string) {
    opened(childId);
    router.replace(childHref(childId), { scroll: false });
  }

  function closePanel() {
    const back = opener.current ?? selectedId;
    router.replace(here, { scroll: false });
    setPanelFocus(null);
    if (back) setTimeout(() => document.getElementById(rowLinkId(back))?.focus(), 0);
  }

  const empty = roster.rows !== null && roster.total === 0;
  const hasRows = roster.rows !== null && !empty;
  const duplicates = summary?.duplicates ?? 0;
  // Until the job's summary has loaded, the duplicates are unknown: the footer leaves them out rather than say "none".
  const footer = summary
    ? t("footer", { count: roster.total, groups: roster.groups.length, group: word, duplicates })
    : t("footerCounting", { count: roster.total, groups: roster.groups.length, group: word });

  return (
    <JobSection
      title={hasRows ? t("heading", { count: roster.total }) : null}
      views={hasRows ? <SubjectsViews base={base} view={view} /> : null}
      tools={
        <SubjectsTools
          hasRows={hasRows}
          query={query}
          onQuery={setQuery}
          classChoice={classChoice}
          onClassChoice={setClassChoice}
          grade={grade}
          onGrade={setGrade}
          groupBy={groupBy}
          onGroupBy={setGroupBy}
          groups={roster.groups}
          grades={grades}
          word={word}
          canEdit={canEdit}
          importHref={`/app/jobs/${job.id}/import`}
          onPrint={() => setPrinting(true)}
          onAdd={() => setEditing("new")}
        />
      }
      below={
        <>
          {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3); while empty it
          takes no room (the negative margin cancels the column gap). */}
          <p role="status" className="m-0 text-sm text-muted empty:-mb-4">
            {status}
          </p>
          {duplicates > 0 && view !== "duplicates" && !empty ? (
            <Banner
              tone="warning"
              className="py-1"
              title={
                <span className="flex items-center gap-2 font-semibold">
                  {/* Its own element, so the count reads (and is found) apart from the button. */}
                  <span>{t("duplicatesNotice", { count: duplicates })}</span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => router.push(subjectsHref(base, "duplicates"), { scroll: false })}
                    className="min-h-11 font-bold underline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {t("showThem")}
                  </button>
                </span>
              }
            />
          ) : null}
          {roster.total > ROSTER_VIEW_MAX ? (
            <Banner tone="info" title={t("overCap", { max: ROSTER_VIEW_MAX })} />
          ) : null}
          {roster.failed ? <Banner tone="danger" title={tr("loadFailed")} /> : null}
          <LiveNote />
        </>
      }
      panel={
        selected ? (
          <ChildPanel
            key={selected.id}
            child={selected}
            job={job}
            word={word}
            canEdit={canEdit}
            focusKey={panelFocus === selected.id ? panelFocus : null}
            onClose={closePanel}
            onEdit={() => setEditing(selected)}
            onRemove={() => setRemoving(selected)}
            onPrintCard={() => printCard(selected)}
          />
        ) : null
      }
    >
      {!roster.rows && !roster.failed ? <p className="m-0 text-muted">{tr("loading")}</p> : null}

      {empty ? (
        <div className="flex flex-col items-center gap-3 rounded-list bg-surface px-6 py-16 text-center shadow-card">
          <h2 className="m-0 text-h3">{tr("emptyTitle")}</h2>
          <p className="m-0 max-w-120 text-muted">{tr("emptyBody", { group: word })}</p>
          {canEdit ? null : <p className="m-0 text-caption text-muted">{tr("emptyReadOnly")}</p>}
        </div>
      ) : null}

      {roster.rows && !empty ? (
        <div className="flex flex-col gap-3">
          <PeopleList
            sections={sections}
            grouped={groupBy === "group"}
            collapsed={collapsed}
            onToggle={(key) =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            selectedId={selected?.id ?? null}
            childHref={childHref}
            onOpen={open}
            onLinkOpen={opened}
            onRename={canEdit ? setRenaming : null}
            word={word}
            busy={roster.loadingMore}
            footer={footer}
          />
          {visible.length === 0 && searching ? (
            <p className="m-0 text-muted">{t("noMatches")}</p>
          ) : null}
          {roster.loadingMore ? <p className="m-0 text-sm text-muted">{t("loadingMore")}</p> : null}
        </div>
      ) : null}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? tr("form.addTitle") : tr("form.editTitle")}
      >
        {editing ? (
          <ChildForm
            job={job}
            word={word}
            child={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              changed(tr("saved"));
            }}
            onRemoved={() => {
              setEditing(null);
              router.replace(here, { scroll: false });
              changed(tr("removed"));
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={tr("groupForm.renameTitle", { group: word })}
      >
        {renaming ? (
          <GroupForm
            jobId={job.id}
            group={renaming}
            word={word}
            onCancel={() => setRenaming(null)}
            onSaved={() => {
              setRenaming(null);
              changed(tr("saved"));
            }}
          />
        ) : null}
      </Dialog>

      {canEdit && roster.rows ? (
        <PrintQrCardsDialog
          open={printing}
          onClose={() => setPrinting(false)}
          jobId={job.id}
          roster={roster.rows}
          groups={roster.groups}
          word={word}
          onPrinted={refreshSummary}
        />
      ) : null}

      {removing ? (
        <RemoveChildDialog
          child={removing}
          open
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            router.replace(here, { scroll: false });
            changed(tr("removed"));
          }}
        />
      ) : null}
    </JobSection>
  );
}
