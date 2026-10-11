"use client";

import type { Child } from "@daybell/api";
import {
  addFilter,
  applyFilters,
  gradeOptions,
  groupLabel,
  groupPeople,
  matchesSearch,
  type PeopleFilter,
  ROSTER_VIEW_MAX,
} from "@daybell/core";
import { Banner, Button } from "@daybell/ui";
import { Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../../../dialog";
import { ChildForm, GroupForm } from "../child-form";
import { HIT_44 } from "../hit-area";
import { useJob } from "../job-context";
import { JobSection } from "../job-section";
import { RemoveChildDialog } from "../remove-child-dialog";
import { tabHref } from "../tabs";
import { ChildPanel } from "./child-panel";
import { PeopleList, rowLinkId } from "./people-list";
import { FilterChips, type GroupBy, PeopleToolbar } from "./people-toolbar";
import { useRoster } from "./use-roster";

export default function PeoplePageRoute() {
  // useSearchParams (the selected child) needs a Suspense boundary.
  return (
    <Suspense>
      <PeoplePage />
    </Suspense>
  );
}

/**
 * A job's People (D137, D138; Phase 1 step 2's roster moved here): search, filters and grouping over the whole
 * roster, a flat list grouped by class, and the selected child in the side panel (?child=<id>, an id only). Add and
 * edit keep the existing child form dialog (D133); Import stays its own page.
 */
function PeoplePage() {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  const router = useRouter();
  const { job, summary, refreshSummary, canEditRoster: canEdit } = useJob();
  const word = groupLabel(job.type);
  const base = tabHref(job.id, "people");
  const roster = useRoster(job.id);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<PeopleFilter[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>("group");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Child | "new" | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Child | null>(null);
  // Set when the person opens a child, so focus moves to the panel; not on a refresh with ?child= in the URL.
  const [panelFocus, setPanelFocus] = useState<string | null>(null);
  const opener = useRef<string | null>(null);

  const selectedId = useSearchParams().get("child");
  const selected = roster.rows?.find((c) => c.id === selectedId) ?? null;
  const childHref = (childId: string) => `${base}?child=${childId}`;

  // ?imported=a.b (numbers only) and ?show=duplicates arrive once from Import and Overview; then the URL is cleaned.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once on open.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const imported = params.get("imported")?.match(/^(\d+)\.(\d+)$/);
    const show = params.get("show");
    if (imported)
      setStatus(tr("imported", { added: Number(imported[1]), updated: Number(imported[2]) }));
    if (show === "duplicates") setFilters((f) => addFilter(f, { kind: "duplicates" }));
    if (imported || show) router.replace(base, { scroll: false });
  }, []);

  // A child that isn't on this roster (removed, or another job's id) is dropped from the URL quietly.
  useEffect(() => {
    if (selectedId && roster.rows && !roster.loadingMore && !selected)
      router.replace(base, { scroll: false });
  }, [selectedId, selected, roster.rows, roster.loadingMore, router, base]);

  const searching = query.trim() !== "" || filters.length > 0;
  const visible = useMemo(
    () => applyFilters(roster.rows ?? [], filters).filter((c) => matchesSearch(c, query)),
    [roster.rows, filters, query],
  );
  const sections = useMemo(
    () => groupPeople(visible, roster.groups, groupBy, { includeEmptyGroups: !searching }),
    [visible, roster.groups, groupBy, searching],
  );
  const grades = useMemo(() => gradeOptions(roster.rows ?? []), [roster.rows]);

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
    router.replace(base, { scroll: false });
    setPanelFocus(null);
    if (back) setTimeout(() => document.getElementById(rowLinkId(back))?.focus(), 0);
  }

  const empty = roster.rows !== null && roster.total === 0;
  const duplicates = summary?.duplicates ?? 0;
  const showingDuplicates = filters.some((f) => f.kind === "duplicates");

  return (
    <JobSection
      bar={
        empty ? null : (
          <PeopleToolbar
            query={query}
            onQuery={setQuery}
            filters={filters}
            onFilters={setFilters}
            groupBy={groupBy}
            onGroupBy={setGroupBy}
            groups={roster.groups}
            grades={grades}
            word={word}
          />
        )
      }
      barEnd={
        canEdit ? (
          <>
            <Button asChild variant="secondary" size="sm" className={HIT_44}>
              <Link href={`/app/jobs/${job.id}/import`}>
                <Upload aria-hidden="true" />
                {tr("import")}
              </Link>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={HIT_44}
              onClick={() => setEditing("new")}
            >
              <Plus aria-hidden="true" />
              {tr("add")}
            </Button>
          </>
        ) : null
      }
      below={
        <FilterChips filters={filters} onFilters={setFilters} groups={roster.groups} word={word} />
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
          />
        ) : null
      }
    >
      <div className="flex flex-col">
        {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
        <p role="status" className="m-0 px-6 text-sm text-muted [&:not(:empty)]:pt-3">
          {status}
        </p>
        {duplicates > 0 && !showingDuplicates && !empty ? (
          <div className="px-6 pt-3">
            <Banner
              tone="warning"
              className="py-2"
              title={
                <span className="flex items-center gap-2 font-semibold">
                  {/* Its own element, so the count reads (and is found) apart from the button. */}
                  <span>{t("duplicatesNotice", { count: duplicates })}</span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => setFilters((f) => addFilter(f, { kind: "duplicates" }))}
                    className={`${HIT_44} font-bold underline focus-visible:outline-2 focus-visible:outline-primary`}
                  >
                    {t("showThem")}
                  </button>
                </span>
              }
            />
          </div>
        ) : null}
        {roster.total > ROSTER_VIEW_MAX ? (
          <div className="px-6 pt-3">
            <Banner tone="info" title={t("overCap", { max: ROSTER_VIEW_MAX })} />
          </div>
        ) : null}
        {roster.failed ? (
          <div className="px-6 pt-3">
            <Banner tone="danger" title={tr("loadFailed")} />
          </div>
        ) : null}
        {!roster.rows && !roster.failed ? (
          <p className="m-0 px-6 py-4 text-muted">{tr("loading")}</p>
        ) : null}

        {empty ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <h2 className="m-0 text-h3">{tr("emptyTitle")}</h2>
            <p className="m-0 max-w-120 text-muted">{tr("emptyBody", { group: word })}</p>
            {canEdit ? null : <p className="m-0 text-caption text-muted">{tr("emptyReadOnly")}</p>}
          </div>
        ) : null}

        {roster.rows && !empty ? (
          <>
            <div className="mt-3">
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
              />
            </div>
            {visible.length === 0 && searching ? (
              <p className="m-0 px-6 py-4 text-muted">{t("noMatches")}</p>
            ) : null}
            {roster.loadingMore ? (
              <p className="m-0 px-6 py-3 text-sm text-muted">{t("loadingMore")}</p>
            ) : null}
          </>
        ) : null}
      </div>

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
              router.replace(base, { scroll: false });
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

      {removing ? (
        <RemoveChildDialog
          child={removing}
          open
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            router.replace(base, { scroll: false });
            changed(tr("removed"));
          }}
        />
      ) : null}
    </JobSection>
  );
}
