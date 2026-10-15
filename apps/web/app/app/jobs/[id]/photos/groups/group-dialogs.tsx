"use client";

import {
  type ChildrenResponse,
  GROUP_CONFLICTS,
  type GroupDeletedResponse,
  type GroupMembersChangedResponse,
  type GroupsMadeResponse,
  type PhotoGroup,
  type PhotoGroupResponse,
  type RosterChild,
} from "@daybell/api";
import {
  cleanGroupName,
  columnGroupsPreview,
  GROUP_COLUMNS,
  type GroupColumn,
  groupNameProblem,
  MAX_GROUP_NAME,
  membersChange,
  membersRequests,
  ROSTER_VIEW_MAX,
} from "@daybell/core";
import { Button, Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { type ApiResult, api } from "@/lib/client-api";
import { Dialog } from "../../../../dialog";
import { useJob } from "../../job-context";
import { useProblem } from "../review-state";

/** The job's roster for the members and column dialogs: every page of 500, up to 5,000 (as Subjects), once opened. */
function useRoster(jobId: string, open: boolean) {
  const [people, setPeople] = useState<RosterChild[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPeople(null);
    setFailed(false);
    void (async () => {
      const all: RosterChild[] = [];
      let cursor: string | null = null;
      do {
        const res: ApiResult<ChildrenResponse> = await api<ChildrenResponse>(
          `/jobs/${encodeURIComponent(jobId)}/children?limit=500${
            cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
          }`,
        );
        if (!live) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        all.push(...res.data.children);
        cursor = res.data.nextCursor;
      } while (cursor && all.length < ROSTER_VIEW_MAX);
      if (live) setPeople(all);
    })();
    return () => {
      live = false;
    };
  }, [jobId, open]);
  return { people, failed };
}

/**
 * + New group and Rename (D156): one name, 1 to 60 characters, unique per job ignoring case (C10), checked here first
 * and again by the server. On save, `onSaved` gets the group as the server has it.
 */
export function GroupNameDialog({
  jobId,
  group,
  groups,
  open,
  onClose,
  onSaved,
}: {
  jobId: string;
  /** The group to rename; null to make a new one. */
  group: PhotoGroup | null;
  groups: readonly PhotoGroup[];
  open: boolean;
  onClose: () => void;
  onSaved: (group: PhotoGroup) => void;
}) {
  const t = useTranslations("app.photos.groups.form");
  const problem = useProblem();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState("");
  const [busy, setBusy] = useState(false);
  // Reset when the dialog opens for a group, not when the Groups list reloads (a new object, the same group).
  const groupId = group?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the name is read when the dialog opens for this group.
  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setError("");
    setForm("");
  }, [open, groupId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const clean = cleanGroupName(name);
    const why = groupNameProblem(clean, groups, group?.id ?? null);
    if (why) {
      setError(
        t(
          why === "empty"
            ? "nameEmpty"
            : why === "tooLong"
              ? "nameTooLong"
              : why === "invalid"
                ? "nameInvalid"
                : "nameTaken",
        ),
      );
      return;
    }
    setBusy(true);
    const res = group
      ? await api<PhotoGroupResponse>(`/groups/${encodeURIComponent(group.id)}`, {
          method: "PATCH",
          body: { name: clean },
        })
      : await api<PhotoGroupResponse>(`/jobs/${encodeURIComponent(jobId)}/groups`, {
          method: "POST",
          body: { name: clean },
        });
    setBusy(false);
    if (res.ok) {
      onSaved(res.data.group);
      return;
    }
    if (res.fields.form === GROUP_CONFLICTS.nameTaken) setError(t("nameTaken"));
    else if (res.fields.name) setError(t("nameInvalid"));
    else setForm(problem(res));
  }

  return (
    <Dialog open={open} onClose={onClose} title={group ? t("renameTitle") : t("newTitle")}>
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <Field
          label={t("name")}
          value={name}
          placeholder={t("namePlaceholder")}
          autoComplete="off"
          maxLength={MAX_GROUP_NAME}
          required
          onChange={(e) => setName(e.target.value)}
          {...(error ? { error } : {})}
        />
        {form ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {form}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? t("saving") : group ? t("save") : t("create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Delete a group (C4; ADR 0030, call 3). Its members simply leave it. A group with photos asks where they go: another
 * group, or the bin (photos also shown in another group stay there; sold photos can't go to the bin, groups.photoSold).
 * A group with no photos asks nothing more.
 */
export function DeleteGroupDialog({
  group,
  groups,
  open,
  onClose,
  onDeleted,
}: {
  group: PhotoGroup | null;
  groups: readonly PhotoGroup[];
  open: boolean;
  onClose: () => void;
  onDeleted: (result: GroupDeletedResponse) => void;
}) {
  const t = useTranslations("app.photos.groups.deleteDialog");
  const problem = useProblem();
  const [to, setTo] = useState<"group" | "bin">("group");
  const [target, setTarget] = useState("");
  const [form, setForm] = useState("");
  const [busy, setBusy] = useState(false);
  // Photos arrived after the list was read (groups.hasPhotos): ask where they go after all.
  const [askWhere, setAskWhere] = useState(false);
  const radios = useId();
  const select = useId();
  const others = groups.filter((g) => g.id !== group?.id);
  useEffect(() => {
    if (!open) return;
    setTo(others.length > 0 ? "group" : "bin");
    setTarget("");
    setForm("");
    setAskWhere(false);
  }, [open, others.length]);
  if (!group) return null;
  const hasPhotos = group.photos > 0 || askWhere;
  const ready = !hasPhotos || to === "bin" || target !== "";

  async function remove(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !ready) return;
    setBusy(true);
    const query = !hasPhotos
      ? ""
      : to === "bin"
        ? "?photosTo=bin"
        : `?photosTo=group&targetId=${encodeURIComponent(target)}`;
    const res = await api<GroupDeletedResponse>(`/groups/${encodeURIComponent(group.id)}${query}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (res.ok) return onDeleted(res.data);
    if (res.fields.form === GROUP_CONFLICTS.hasPhotos) setAskWhere(true);
    setForm(problem(res));
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("title", { name: group.name })}>
      <form onSubmit={remove} className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">{t("body")}</p>
        {hasPhotos ? (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 p-0 text-sm font-semibold text-ink">
              {group.photos > 0 ? t("photosLegend", { count: group.photos }) : t("photosLegendNew")}
            </legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="radio"
                name={radios}
                checked={to === "group"}
                disabled={others.length === 0}
                onChange={() => setTo("group")}
                className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
              {t("toGroup")}
            </label>
            {others.length === 0 ? (
              <p className="m-0 pl-8 text-caption text-muted">{t("noOtherGroup")}</p>
            ) : to === "group" ? (
              <div className="flex flex-col gap-1 pl-8">
                <label htmlFor={select} className="text-label font-semibold text-ink">
                  {t("chooseGroup")}
                </label>
                <select
                  id={select}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="min-h-11 max-w-80 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <option value="">{t("chooseGroup")}</option>
                  {others.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="radio"
                name={radios}
                checked={to === "bin"}
                onChange={() => setTo("bin")}
                className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
              {t("toBin")}
            </label>
            <p className="m-0 pl-8 text-caption text-muted">{t("toBinHint")}</p>
          </fieldset>
        ) : (
          <p className="m-0 text-sm text-muted">{t("noPhotos")}</p>
        )}
        {form ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {form}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="danger" disabled={!ready || busy} aria-busy={busy}>
            {busy ? t("deleting") : t("confirm")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** At most this many people are listed at once; typing narrows the list. */
const SHOWN = 300;

/**
 * Add or remove people (D156): the roster with a search and a 44px tick box each, the group's members ticked. Nothing
 * changes until Save, which sends who joins and who leaves, 500 at a time (C10).
 */
export function MembersDialog({
  jobId,
  group,
  open,
  onClose,
  onSaved,
}: {
  jobId: string;
  group: PhotoGroup | null;
  open: boolean;
  onClose: () => void;
  onSaved: (change: { added: number; removed: number; members: number }) => void;
}) {
  const t = useTranslations("app.photos.groups.membersDialog");
  // The job's own name for the class field (ADR 0030, call 29).
  const classLabel = useJob().job.classLabel;
  const problem = useProblem();
  const { people, failed } = useRoster(jobId, open);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [form, setForm] = useState("");
  const [busy, setBusy] = useState(false);
  const hintId = useId();
  // Keyed on the group's id, not its object: the Groups list reloading (a new object, the same group) never resets
  // the ticks someone is making. The roster itself loads again only when the dialog opens.
  const groupId = group?.id ?? null;
  const before = useMemo(
    () =>
      new Set(
        (people ?? []).filter((p) => p.groups.some((g) => g.id === groupId)).map((p) => p.id),
      ),
    [people, groupId],
  );
  useEffect(() => {
    if (open) {
      setSearch("");
      setForm("");
    }
  }, [open]);
  useEffect(() => setChosen(before), [before]);

  const q = search.trim().toLowerCase();
  const matching = (people ?? []).filter(
    (p) => !q || t("name", { first: p.firstName, last: p.lastName }).toLowerCase().includes(q),
  );
  const shown = matching.slice(0, SHOWN);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!group) return;
    setBusy(true);
    setForm("");
    let added = 0;
    let removed = 0;
    let members = group.members;
    for (const request of membersRequests(membersChange(before, chosen))) {
      const res = await api<GroupMembersChangedResponse>(
        `/groups/${encodeURIComponent(group.id)}/members`,
        { method: "POST", body: request },
      );
      if (!res.ok) {
        setBusy(false);
        setForm(problem(res));
        return;
      }
      added += res.data.added;
      removed += res.data.removed;
      members = res.data.members;
    }
    setBusy(false);
    onSaved({ added, removed, members });
  }

  if (!group) return null;
  return (
    <Dialog open={open} onClose={onClose} title={t("title", { name: group.name })}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field
          label={t("search")}
          type="search"
          value={search}
          autoComplete="off"
          onChange={(e) => setSearch(e.target.value)}
          aria-describedby={hintId}
        />
        <p id={hintId} className="m-0 text-caption text-muted">
          {t("hint")}
        </p>
        {failed ? <p className="m-0 text-danger">{t("loadFailed")}</p> : null}
        {!people && !failed ? <p className="m-0 text-muted">{t("loading")}</p> : null}
        {people && matching.length === 0 ? <p className="m-0 text-muted">{t("noMatch")}</p> : null}
        <ul className="m-0 flex max-h-[45dvh] list-none flex-col overflow-y-auto p-0">
          {shown.map((p) => {
            const name = t("name", { first: p.firstName, last: p.lastName });
            return (
              <li key={p.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-subtle">
                  <input
                    type="checkbox"
                    checked={chosen.has(p.id)}
                    onChange={(e) =>
                      setChosen((current) => {
                        const next = new Set(current);
                        if (e.target.checked) next.add(p.id);
                        else next.delete(p.id);
                        return next;
                      })
                    }
                    className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  />
                  <span className="flex-1">{name}</span>
                  <span className="text-caption text-muted">
                    {p.class?.name ?? t("noClass", { group: classLabel })}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {matching.length > SHOWN ? (
          <p className="m-0 text-caption text-muted">{t("shown", { count: SHOWN })}</p>
        ) : null}
        <p aria-live="polite" className="m-0 text-sm text-muted">
          {t("ticked", { count: chosen.size })}
        </p>
        {form ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {form}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={!people || busy} aria-busy={busy}>
            {busy ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Make groups from a column (C3): any roster column that names a group, the class in the job's own word for it, grade,
 * first name, last name and student ID (ADR 0030, call 9), with what it would make said before anything is saved (core's columnGroupsPreview); the server decides again. Done once: later roster changes don't change groups.
 */
export function ColumnDialog({
  jobId,
  groups,
  open,
  onClose,
  onMade,
}: {
  jobId: string;
  groups: readonly PhotoGroup[];
  open: boolean;
  onClose: () => void;
  onMade: (made: GroupsMadeResponse) => void;
}) {
  const t = useTranslations("app.photos.groups.columnDialog");
  const classLabel = useJob().job.classLabel;
  const problem = useProblem();
  const { people, failed } = useRoster(jobId, open);
  const [column, setColumn] = useState<GroupColumn>("class");
  const [form, setForm] = useState("");
  const [busy, setBusy] = useState(false);
  const radios = useId();
  const previewId = useId();
  useEffect(() => {
    if (open) {
      setColumn("class");
      setForm("");
    }
  }, [open]);
  const preview = people ? columnGroupsPreview(people, column, groups) : null;

  async function make(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setForm("");
    const res = await api<GroupsMadeResponse>(
      `/jobs/${encodeURIComponent(jobId)}/groups/from-column`,
      { method: "POST", body: { column } },
    );
    setBusy(false);
    if (res.ok) onMade(res.data);
    else setForm(problem(res));
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("title")}>
      <form onSubmit={make} className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">{t("intro")}</p>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" aria-describedby={previewId}>
          <legend className="mb-1 p-0 text-sm font-semibold text-ink">{t("legend")}</legend>
          {GROUP_COLUMNS.map((c) => (
            <label key={c} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="radio"
                name={radios}
                checked={column === c}
                onChange={() => setColumn(c)}
                className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
              {c === "class" ? t("class", { group: classLabel }) : t(c)}
            </label>
          ))}
        </fieldset>
        <div id={previewId} aria-live="polite" className="flex flex-col gap-1 text-sm">
          {failed ? (
            <p className="m-0 text-danger">{problem({ code: "internal", fields: {} })}</p>
          ) : null}
          {preview ? (
            preview.make.length === 0 && preview.skipped.length === 0 ? (
              <p className="m-0 text-muted">{t("noValues")}</p>
            ) : (
              <>
                <p className="m-0 text-ink">
                  {preview.make.length === 0
                    ? t("previewNone")
                    : t("preview", {
                        count: preview.make.length,
                        names: preview.make.map((g) => g.name).join(", "),
                      })}
                </p>
                {preview.skipped.length > 0 ? (
                  <p className="m-0 text-muted">
                    {t("skipped", { count: preview.skipped.length })}
                  </p>
                ) : null}
              </>
            )
          ) : null}
        </div>
        {form ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {form}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            disabled={busy || !preview || preview.make.length === 0}
            aria-busy={busy}
          >
            {busy ? t("making") : t("make")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Move to group (D156): one radio per other group, with a search. The photos leave this group (or no group). */
export function MoveToGroupDialog({
  groups,
  from,
  photoIds,
  onClose,
  onMove,
}: {
  groups: readonly PhotoGroup[];
  /** The group they are in now; null for Not in a group. */
  from: PhotoGroup | null;
  photoIds: string[] | null;
  onClose: () => void;
  onMove: (photoIds: string[], to: PhotoGroup) => Promise<void>;
}) {
  const t = useTranslations("app.photos.groups.moveDialog");
  const open = photoIds !== null;
  const [search, setSearch] = useState("");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const name = useId();
  const hintId = useId();
  useEffect(() => {
    if (open) {
      setSearch("");
      setChoice("");
    }
  }, [open]);
  const others = groups.filter((g) => g.id !== from?.id);
  const q = search.trim().toLowerCase();
  const matching = others.filter((g) => !q || g.name.toLowerCase().includes(q));
  const chosen = others.find((g) => g.id === choice) ?? null;
  return (
    <Dialog open={open} onClose={onClose} title={t("title", { count: photoIds?.length ?? 0 })}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!chosen || !photoIds) return;
          setBusy(true);
          await onMove(photoIds, chosen);
          setBusy(false);
          onClose();
        }}
      >
        <Field
          label={t("search")}
          type="search"
          value={search}
          autoComplete="off"
          onChange={(e) => setSearch(e.target.value)}
          aria-describedby={hintId}
        />
        <p id={hintId} className="m-0 text-caption text-muted">
          {from ? t("hint", { from: from.name }) : t("hintNone")}
        </p>
        {others.length === 0 ? <p className="m-0 text-muted">{t("noOther")}</p> : null}
        {others.length > 0 && matching.length === 0 ? (
          <p className="m-0 text-muted">{t("noMatch")}</p>
        ) : null}
        <fieldset className="m-0 flex max-h-[45dvh] flex-col overflow-y-auto border-0 p-0">
          <legend className="sr-only">{t("search")}</legend>
          {matching.map((g) => (
            <label
              key={g.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-subtle"
            >
              <input
                type="radio"
                name={name}
                checked={choice === g.id}
                onChange={() => setChoice(g.id)}
                className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
              {g.name}
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={!chosen || busy} aria-busy={busy}>
            {t("move")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Also show in… (D156): a tick box per other group, with a search. The photos stay where they are too. */
export function AlsoShowDialog({
  groups,
  from,
  photoIds,
  onClose,
  onShow,
}: {
  groups: readonly PhotoGroup[];
  from: PhotoGroup | null;
  photoIds: string[] | null;
  onClose: () => void;
  onShow: (photoIds: string[], groupIds: string[]) => Promise<void>;
}) {
  const t = useTranslations("app.photos.groups.alsoShowDialog");
  const open = photoIds !== null;
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const hintId = useId();
  useEffect(() => {
    if (open) {
      setSearch("");
      setChosen(new Set());
    }
  }, [open]);
  const others = groups.filter((g) => g.id !== from?.id);
  const q = search.trim().toLowerCase();
  const matching = others.filter((g) => !q || g.name.toLowerCase().includes(q));
  return (
    <Dialog open={open} onClose={onClose} title={t("title", { count: photoIds?.length ?? 0 })}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!photoIds || chosen.size === 0) return;
          setBusy(true);
          await onShow(photoIds, [...chosen]);
          setBusy(false);
          onClose();
        }}
      >
        <Field
          label={t("search")}
          type="search"
          value={search}
          autoComplete="off"
          onChange={(e) => setSearch(e.target.value)}
          aria-describedby={hintId}
        />
        <p id={hintId} className="m-0 text-caption text-muted">
          {t("hint")}
        </p>
        {matching.length === 0 ? <p className="m-0 text-muted">{t("noMatch")}</p> : null}
        <ul className="m-0 flex max-h-[45dvh] list-none flex-col overflow-y-auto p-0">
          {matching.map((g) => (
            <li key={g.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-subtle">
                <input
                  type="checkbox"
                  checked={chosen.has(g.id)}
                  onChange={(e) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(g.id);
                      else next.delete(g.id);
                      return next;
                    })
                  }
                  className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />
                {g.name}
              </label>
            </li>
          ))}
        </ul>
        <p aria-live="polite" className="m-0 text-sm text-muted">
          {t("ticked", { count: chosen.size })}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={chosen.size === 0 || busy} aria-busy={busy}>
            {t("show")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
