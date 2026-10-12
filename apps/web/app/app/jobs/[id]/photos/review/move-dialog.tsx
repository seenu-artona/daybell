"use client";

import type { ChildrenResponse, GroupsResponse, MoveTarget } from "@daybell/api";
import { Button, Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { api } from "@/lib/client-api";
import { Dialog } from "../../../../dialog";

interface Option {
  key: string;
  label: string;
  target: MoveTarget;
}

/** Children and classes of the job, for Move to…: loaded once, the first time it opens. */
function useDestinations(jobId: string, open: boolean) {
  const [groups, setGroups] = useState<{ id: string; name: string }[] | null>(null);
  const [children, setChildren] = useState<
    { id: string; firstName: string; lastName: string; groupId: string | null }[] | null
  >(null);
  const [failed, setFailed] = useState(false);
  const loaded = children !== null;
  useEffect(() => {
    if (!open || loaded) return;
    let live = true;
    void (async () => {
      const job = encodeURIComponent(jobId);
      const g = await api<GroupsResponse>(`/jobs/${job}/groups`);
      const all: { id: string; firstName: string; lastName: string; groupId: string | null }[] = [];
      let cursor: string | null = null;
      do {
        const res: Awaited<ReturnType<typeof api<ChildrenResponse>>> = await api<ChildrenResponse>(
          `/jobs/${job}/children?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        if (!res.ok) {
          if (live) setFailed(true);
          return;
        }
        all.push(
          ...res.data.children.map((c) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            groupId: c.group?.id ?? null,
          })),
        );
        cursor = res.data.nextCursor;
      } while (cursor);
      if (!live) return;
      setGroups(g.ok ? g.data.groups : []);
      setChildren(all);
    })();
    return () => {
      live = false;
    };
  }, [jobId, open, loaded]);
  return { groups, children, failed };
}

/** At most this many children are listed at once; typing narrows the list. */
const SHOWN = 200;

/**
 * "Move to…" (ADR 0018; Seenu, answer 7): the way to move photos without dragging (WCAG 2.5.7). A search box and one
 * radio list (native radios: arrow keys move between them): Leftovers, each class's Class photo set, then the children
 * grouped by class. Nothing moves until Move is pressed.
 */
export function MoveDialog({
  jobId,
  photoIds,
  onClose,
  onMove,
}: {
  jobId: string;
  /** The photos to move; null when closed. */
  photoIds: string[] | null;
  onClose: () => void;
  onMove: (photoIds: string[], target: MoveTarget, targetName: string) => Promise<void>;
}) {
  const t = useTranslations("app.photos.review.moveDialog");
  const open = photoIds !== null;
  const { groups, children, failed } = useDestinations(jobId, open);
  const [search, setSearch] = useState("");
  const [choice, setChoice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const name = useId();
  const hintId = useId();

  useEffect(() => {
    if (open) {
      setSearch("");
      setChoice("");
    }
  }, [open]);

  const sections = useMemo(() => {
    if (!groups || !children) return [];
    const q = search.trim().toLowerCase();
    const matches = (label: string) => !q || label.toLowerCase().includes(q);
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const kids = children
      .map((c) => ({ c, label: t("childName", { first: c.firstName, last: c.lastName }) }))
      .filter(({ label }) => matches(label));
    const byGroup = (id: string | null): Option[] =>
      kids
        .filter(({ c }) => c.groupId === id)
        .map(({ c, label }) => ({
          key: `child:${c.id}`,
          label,
          target: { kind: "child", childId: c.id },
        }));
    const out: { key: string; title: string; options: Option[] }[] = [];
    const places: Option[] = [];
    if (matches(t("leftovers")))
      places.push({ key: "leftovers", label: t("leftovers"), target: { kind: "leftovers" } });
    for (const g of groups) {
      const label = t("classSet", { name: g.name });
      if (matches(label))
        places.push({ key: `class:${g.id}`, label, target: { kind: "classSet", groupId: g.id } });
    }
    if (places.length) out.push({ key: "places", title: t("places"), options: places });
    let shown = 0;
    for (const id of [...groups.map((g) => g.id), null]) {
      const options = byGroup(id).slice(0, Math.max(0, SHOWN - shown));
      shown += options.length;
      if (options.length)
        out.push({
          key: id ?? "none",
          title: id ? (groupName.get(id) ?? "") : t("noClass"),
          options,
        });
    }
    return out;
  }, [groups, children, search, t]);

  const options = sections.flatMap((s) => s.options);
  const chosen = options.find((o) => o.key === choice) ?? null;

  return (
    <Dialog open={open} onClose={onClose} title={t("title", { count: photoIds?.length ?? 0 })}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!chosen || !photoIds) return;
          setBusy(true);
          await onMove(photoIds, chosen.target, chosen.label);
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
        {failed ? <p className="m-0 text-danger">{t("loadFailed")}</p> : null}
        {!children && !failed ? <p className="m-0 text-muted">{t("loading")}</p> : null}
        {children && options.length === 0 ? <p className="m-0 text-muted">{t("noMatch")}</p> : null}
        <div className="flex max-h-[45dvh] flex-col gap-3 overflow-y-auto">
          {sections.map((section) => (
            <fieldset key={section.key} className="m-0 flex flex-col border-0 p-0">
              <legend className="mb-1 p-0 text-label font-bold text-muted">{section.title}</legend>
              {section.options.map((o) => (
                <label
                  key={o.key}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-subtle"
                >
                  <input
                    type="radio"
                    name={name}
                    value={o.key}
                    checked={choice === o.key}
                    onChange={() => setChoice(o.key)}
                    className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
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
