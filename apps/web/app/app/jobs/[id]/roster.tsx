"use client";

import type { Child, ChildrenResponse, Group, GroupsResponse, Job } from "@daybell/api";
import { groupLabel } from "@daybell/core";
import { Badge, Banner, Button, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { Pencil, Plus, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { Dialog, SelectField } from "../../dialog";
import { ChildForm, GroupForm } from "./child-form";

/** "" = every child, "none" = children without a group, otherwise a group id. */
type Filter = string;

function childrenPath(jobId: string, filter: Filter, cursor: string | null, limit?: number) {
  const params = new URLSearchParams();
  if (filter) params.set("groupId", filter);
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const query = params.toString();
  // Only IDs ever go in this URL: never names or codes (D96).
  return `/jobs/${jobId}/children${query ? `?${query}` : ""}`;
}

/**
 * The job's roster (Phase 1 step 2, D23; Seenu #2, #10, #11): children with their access codes always visible, a
 * class filter, duplicates flagged. Owners, admins and photographers add, import, edit and rename; staff read. It loads
 * its own data, so the job page still works where the roster tables don't exist yet.
 */
export function RosterSection({ job, canEdit }: { job: Job; canEdit: boolean }) {
  const t = useTranslations("app.roster");
  const router = useRouter();
  const word = groupLabel(job.type);
  const headingId = useId();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ total: number; duplicates: number } | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [filter, setFilter] = useState<Filter>("");
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Child | "new" | null>(null);
  const [renaming, setRenaming] = useState(false);
  // A new filter keeps the current table (and the focused filter) on screen while the list loads.
  const [listLoading, setListLoading] = useState(false);
  const latest = useRef(0);

  /** Loads a page of the list; resolves to false when a newer request replaced this one. */
  const load = useCallback(
    async (nextFilter: Filter, cursor: string | null): Promise<boolean> => {
      const request = ++latest.current;
      const [list, groupList, whole] = await Promise.all([
        api<ChildrenResponse>(childrenPath(job.id, nextFilter, cursor)),
        cursor ? null : api<GroupsResponse>(`/jobs/${job.id}/groups`),
        // The header always counts the whole roster, whatever the filter.
        nextFilter && !cursor ? api<ChildrenResponse>(childrenPath(job.id, "", null, 1)) : null,
      ]);
      // A newer request (e.g. another filter chosen meanwhile) wins.
      if (request !== latest.current) return false;
      if (!list.ok || (groupList && !groupList.ok) || (whole && !whole.ok)) {
        setFailed(true);
        return true;
      }
      setFailed(false);
      setChildren((prev) =>
        cursor && prev ? [...prev, ...list.data.children] : list.data.children,
      );
      setNextCursor(list.data.nextCursor);
      if (groupList?.ok) setGroups(groupList.data.groups);
      const counts = whole?.ok ? whole.data : nextFilter ? null : list.data;
      if (counts) setSummary({ total: counts.total, duplicates: counts.duplicates });
      return true;
    },
    [job.id],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once; ?imported= (numbers only) shows once.
  useEffect(() => {
    void load("", null);
    const imported = new URLSearchParams(window.location.search).get("imported");
    const match = imported?.match(/^(\d+)\.(\d+)$/);
    if (match) {
      setStatus(t("imported", { added: Number(match[1]), updated: Number(match[2]) }));
      router.replace(`/app/jobs/${job.id}`);
    }
  }, []);

  const refresh = (message: string) => {
    setStatus(message);
    void load(filter, null);
  };

  const chosenGroup = groups.find((g) => g.id === filter) ?? null;
  const empty = summary?.total === 0;
  const flags = (c: Child) => [
    c.duplicate ? (
      <Badge key="dup" tone="warning">
        {t("badges.duplicate")}
      </Badge>
    ) : null,
    c.doNotPhotograph ? (
      <Badge key="dnp" tone="danger">
        {t("badges.doNotPhotograph")}
      </Badge>
    ) : null,
    c.doNotPublish ? (
      <Badge key="dnpub" tone="draft">
        {t("badges.doNotPublish")}
      </Badge>
    ) : null,
  ];

  const actions = canEdit ? (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      <Button variant="secondary" asChild>
        <Link href={`/app/jobs/${job.id}/import`}>
          <Upload aria-hidden="true" />
          {t("import")}
        </Link>
      </Button>
      <Button onClick={() => setEditing("new")}>
        <Plus aria-hidden="true" />
        {t("add")}
      </Button>
    </div>
  ) : null;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="grid size-10 place-items-center rounded-[10px] bg-subtle"
          aria-hidden="true"
        >
          <Users className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="m-0 text-h3">
            {t("title")}
          </h2>
          {summary ? (
            <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>
                {t("childCount", { count: summary.total })} ·{" "}
                {t("groupCount", { count: groups.length, group: word })}
              </span>
              {summary.duplicates > 0 ? (
                <Badge tone="warning">{t("duplicateCount", { count: summary.duplicates })}</Badge>
              ) : null}
            </p>
          ) : null}
        </div>
        {!empty ? actions : null}
      </div>

      {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
      <p role="status" className="m-0 text-sm text-muted">
        {status}
      </p>

      {failed ? <Banner tone="danger" title={t("loadFailed")} /> : null}
      {!children && !failed ? <p className="m-0 text-muted">{t("loading")}</p> : null}

      {empty && !failed ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <h3 className="m-0 text-h3">{t("emptyTitle")}</h3>
          <p className="m-0 max-w-120 text-muted">{t("emptyBody", { group: word })}</p>
          {canEdit ? actions : <p className="m-0 text-caption text-muted">{t("emptyReadOnly")}</p>}
        </div>
      ) : null}

      {children && !empty ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56">
              <SelectField
                label={t("filter", { group: word })}
                value={filter}
                onChange={(value) => {
                  setFilter(value);
                  setListLoading(true);
                  void load(value, null).then((current) => {
                    if (current) setListLoading(false);
                  });
                }}
                options={[
                  { value: "", label: t("filterAll", { group: word }) },
                  ...groups.map((g) => ({ value: g.id, label: g.name })),
                  { value: "none", label: t("noGroup", { group: word }) },
                ]}
              />
            </div>
            {canEdit && chosenGroup ? (
              <Button variant="secondary" onClick={() => setRenaming(true)}>
                <Pencil aria-hidden="true" />
                {t("renameGroup", { group: word })}
              </Button>
            ) : null}
          </div>

          {listLoading ? <p className="m-0 text-sm text-muted">{t("loading")}</p> : null}
          <Table aria-busy={listLoading} className={listLoading ? "opacity-60" : undefined}>
            <thead>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.group", { group: word })}</TableHead>
                <TableHead>{t("columns.studentId")}</TableHead>
                <TableHead>{t("columns.grade")}</TableHead>
                <TableHead>{t("columns.accessCode")}</TableHead>
                <TableHead>{t("columns.flags")}</TableHead>
                {canEdit ? (
                  <TableHead>
                    <span className="sr-only">{t("columns.actions")}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </thead>
            <tbody>
              {children.map((c) => {
                const name = `${c.firstName} ${c.lastName}`;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-semibold">{name}</TableCell>
                    <TableCell>{c.group?.name ?? t("noGroup", { group: word })}</TableCell>
                    <TableCell>{c.studentId ?? ""}</TableCell>
                    <TableCell>{c.grade ?? ""}</TableCell>
                    {c.accessCode ? (
                      <TableCell className="whitespace-nowrap font-mono font-semibold tracking-wider">
                        {c.accessCode}
                      </TableCell>
                    ) : (
                      <TableCell className="text-muted">{t("codeUnavailable")}</TableCell>
                    )}
                    <TableCell>
                      <span className="flex flex-wrap gap-1.5">{flags(c)}</span>
                    </TableCell>
                    {canEdit ? (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          aria-label={t("edit", { name })}
                          onClick={() => setEditing(c)}
                        >
                          {t("editShort")}
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
          {nextCursor ? (
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => load(filter, nextCursor)}
            >
              {t("loadMore")}
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
          <ChildForm
            job={job}
            word={word}
            child={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh(t("saved"));
            }}
            onRemoved={() => {
              setEditing(null);
              refresh(t("removed"));
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title={t("groupForm.renameTitle", { group: word })}
      >
        {chosenGroup ? (
          <GroupForm
            jobId={job.id}
            group={chosenGroup}
            word={word}
            onCancel={() => setRenaming(false)}
            onSaved={() => {
              setRenaming(false);
              refresh(t("saved"));
            }}
          />
        ) : null}
      </Dialog>
    </section>
  );
}
