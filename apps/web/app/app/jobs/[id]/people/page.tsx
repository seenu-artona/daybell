"use client";

import { type Child, type Group, QR_CARD_HEADERS } from "@daybell/api";
import {
  applyFilters,
  canSeeOrders,
  gradeOptions,
  groupLabel,
  matchesSearch,
  ROSTER_VIEW_MAX,
} from "@daybell/core";
import { Banner, SearchToggle } from "@daybell/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { download } from "@/lib/client-api";
import { qrCardProblem } from "@/lib/qr-card-messages";
import { Dialog } from "../../../dialog";
import { ChipRow } from "../../../filter-chips/chip-row";
import { SavedChipsNotice } from "../../../filter-chips/saved-chips-notice";
import { useStudio } from "../../../me-context";
import { ChildForm, GroupForm } from "../child-form";
import { useJob } from "../job-context";
import { JobSection } from "../job-section";
import { LiveNote } from "../live-note";
import { RemoveChildDialog } from "../remove-child-dialog";
import { tabHref } from "../tabs";
import { ClassesPanel, ClassesRow, renameButtonId } from "./classes-panel";
import { PeopleList, rowLinkId } from "./people-list";
import { PersonRecord } from "./person-record";
import { PrintQrCardsDialog } from "./print-qr-cards-dialog";
import { useReturnFocus } from "./return-focus";
import { useSubjectChips } from "./subject-chips";
import { SubjectsActions } from "./subjects-actions";
import { useRoster } from "./use-roster";
import { subjectFilters, subjectsHref } from "./views";

export default function PeoplePageRoute() {
  // useSearchParams (the selected child) needs a Suspense boundary.
  return (
    <Suspense>
      <PeoplePage />
    </Suspense>
  );
}

/**
 * A job's Subjects (D153, amending D137, D138, D144 and D147): white "Print ▾" and "Add subjects ▾" at the right end of
 * the job's tab row; then one flat list in a white list card whose toolbar has the chips (All, Not photographed, Not
 * ordered for people who see orders, then the person's own through "+ Add filter": a class, No class, Possible
 * duplicates, No photos, Do not photograph, Do not publish, and grades kept in this browser) and the search (never
 * sent or put in the address, D113); Name with small tags, Class, Photos and Ordered columns; the footer counts the
 * roster. Opening a person (?child=<id>, an id only) folds the list to its Name column in the same card and shows their
 * record beside it. Under the list, roster editors get a "Classes N ›" row that opens the job's classes in the floating
 * panel, each with Rename (D147). Add and edit keep the existing child form dialog (D133); Upload a list is the Import
 * page.
 */
function PeoplePage() {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  const tq = useTranslations("app.qrCards");
  const text = useApiText();
  const router = useRouter();
  const { me } = useStudio();
  const seesOrders = canSeeOrders(me.studio.role);
  const { job, summary, refreshSummary, canEditRoster: canEdit } = useJob();
  const word = groupLabel(job.type);
  const base = tabHref(job.id, "people");
  const roster = useRoster(job.id);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Child | "new" | null>(null);
  const [removing, setRemoving] = useState<Child | null>(null);
  const [printing, setPrinting] = useState(false);
  // Counts prints of the job's cards, so an open record reads its card's Printed date again.
  const [printedKey, setPrintedKey] = useState(0);
  // Set when the person opens a child, so focus moves to the panel; not on a refresh with ?child= in the URL.
  const [panelFocus, setPanelFocus] = useState<string | null>(null);
  const opener = useRef<string | null>(null);
  // The classes panel (roster editors, D147): open with a focus key, and the class being renamed.
  const [classesFocus, setClassesFocus] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Group | null>(null);
  const classesRow = useRef<HTMLButtonElement>(null);

  const grades = useMemo(() => gradeOptions(roster.rows ?? []), [roster.rows]);
  const chips = useSubjectChips({
    base,
    jobId: job.id,
    groups: roster.groups,
    grades,
    loaded: roster.rows !== null && !roster.failed && !roster.loadingMore,
    word,
    seesOrders,
  });
  const { chip } = chips;
  const selectedId = useSearchParams().get("child");
  // Unfolding puts focus back on the row once the full table is back (D153, WCAG 2.4.3).
  const returnFocusTo = useReturnFocus(selectedId, rowLinkId);
  const selected = roster.rows?.find((c) => c.id === selectedId) ?? null;
  const childHref = (childId: string) => subjectsHref(base, chip, childId);
  // The list's own address: the chip stays, the open child goes.
  const here = subjectsHref(base, chip);

  // ?imported=a.b (numbers only) and ?print=qr arrive once from Import and Overview; then the URL is cleaned. The chip
  // (?show=, ?class=) stays: it is the list's state (D144, D147).
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

  const filters = useMemo(() => subjectFilters(chip), [chip]);
  const searching = query.trim() !== "" || filters.length > 0;
  const visible = useMemo(
    () => applyFilters(roster.rows ?? [], filters).filter((c) => matchesSearch(c, query)),
    [roster.rows, filters, query],
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
    setClassesFocus(null);
    opener.current = childId;
    setPanelFocus(childId);
  }

  function open(childId: string) {
    opened(childId);
    router.replace(childHref(childId), { scroll: false });
  }

  // A child in the address (opened from a row, or back and forward in history) takes the panel from the classes.
  useEffect(() => {
    if (selectedId) setClassesFocus(null);
  }, [selectedId]);

  /** Opens the classes panel in place of any open child. */
  function openClasses() {
    if (selectedId) router.replace(here, { scroll: false });
    setPanelFocus(null);
    setClassesFocus(`classes-${Date.now()}`);
  }

  function closeClasses() {
    setClassesFocus(null);
    setTimeout(() => classesRow.current?.focus(), 0);
  }

  function closePanel() {
    // Back to the row of the person who was open (↑↓ may have moved from the one first opened).
    returnFocusTo(selectedId ?? opener.current);
    router.replace(here, { scroll: false });
    setPanelFocus(null);
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
      below={
        <>
          <SubjectsActions
            hasRows={hasRows}
            canEdit={canEdit}
            importHref={`/app/jobs/${job.id}/import`}
            onPrint={() => setPrinting(true)}
            onAdd={() => setEditing("new")}
          />
          {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3); while empty it
          takes no room (the negative margin cancels the column gap). */}
          <p role="status" className="m-0 text-sm text-muted empty:-mb-4">
            {status}
          </p>
          <SavedChipsNotice filters={chips.saved} />
          {duplicates > 0 && !(chip.kind === "show" && chip.show === "duplicates") && !empty ? (
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
                    onClick={() =>
                      router.push(subjectsHref(base, { kind: "show", show: "duplicates" }), {
                        scroll: false,
                      })
                    }
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
        classesFocus !== null && canEdit ? (
          <ClassesPanel
            groups={roster.groups}
            word={word}
            focusKey={classesFocus}
            onClose={closeClasses}
            onRename={setRenaming}
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
            rows={visible}
            toolbar={
              <ChipRow label={t("chips.label")} items={chips.items} choices={chips.choices} />
            }
            toolbarEnd={
              <SearchToggle label={t("searchLabel")} value={query} onChange={setQuery} onCard />
            }
            empty={visible.length === 0 && searching ? t("noMatches") : null}
            showOrdered={seesOrders}
            selectedId={selected?.id ?? null}
            childHref={childHref}
            onOpen={open}
            onLinkOpen={opened}
            word={word}
            busy={roster.loadingMore}
            footer={footer}
            person={
              selected ? (
                <PersonRecord
                  key={selected.id}
                  child={selected}
                  job={job}
                  word={word}
                  canEdit={canEdit}
                  seesOrders={seesOrders}
                  focusKey={panelFocus === selected.id ? panelFocus : null}
                  printedKey={printedKey}
                  onUnfold={closePanel}
                  onEdit={() => setEditing(selected)}
                  onRemove={() => setRemoving(selected)}
                  onPrintCard={() => printCard(selected)}
                />
              ) : null
            }
          />
          {roster.loadingMore ? <p className="m-0 text-sm text-muted">{t("loadingMore")}</p> : null}
        </div>
      ) : null}

      {canEdit && roster.rows && roster.groups.length > 0 ? (
        <div className="mt-3">
          <ClassesRow
            ref={classesRow}
            count={roster.groups.length}
            word={word}
            open={classesFocus !== null}
            onOpen={openClasses}
          />
        </div>
      ) : null}

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
              const back = renaming.id;
              setRenaming(null);
              changed(tr("saved"));
              setTimeout(() => document.getElementById(renameButtonId(back))?.focus(), 0);
            }}
          />
        ) : null}
      </Dialog>

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

      {canEdit && roster.rows ? (
        <PrintQrCardsDialog
          open={printing}
          onClose={() => setPrinting(false)}
          jobId={job.id}
          roster={roster.rows}
          groups={roster.groups}
          word={word}
          onPrinted={() => {
            refreshSummary();
            setPrintedKey((k) => k + 1);
          }}
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
