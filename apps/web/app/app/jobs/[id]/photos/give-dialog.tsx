"use client";

import type { ChildrenResponse, ClassesResponse, MoveTarget } from "@daybell/api";
import { Button, Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState } from "react";
import { type ApiResult, api } from "@/lib/client-api";
import { Dialog } from "../../../dialog";
import { useJob } from "../job-context";

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  classId: string | null;
}

/** The job's people and classes, for Give to a person: loaded once, the first time it opens. */
function usePeople(jobId: string, open: boolean) {
  const [classes, setClasses] = useState<{ id: string; name: string }[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState(false);
  const loaded = people !== null;
  useEffect(() => {
    if (!open || loaded) return;
    let live = true;
    void (async () => {
      const job = encodeURIComponent(jobId);
      const c = await api<ClassesResponse>(`/jobs/${job}/classes`);
      const all: Person[] = [];
      let cursor: string | null = null;
      do {
        const res: ApiResult<ChildrenResponse> = await api<ChildrenResponse>(
          `/jobs/${job}/children?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        if (!res.ok) {
          if (live) setFailed(true);
          return;
        }
        all.push(
          ...res.data.children.map((p) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            classId: p.class?.id ?? null,
          })),
        );
        cursor = res.data.nextCursor;
      } while (cursor);
      if (!live) return;
      setClasses(c.ok ? c.data.classes : []);
      setPeople(all);
    })();
    return () => {
      live = false;
    };
  }, [jobId, open, loaded]);
  return { classes, people, failed };
}

/** At most this many people are listed at once; typing narrows the list. */
const SHOWN = 200;

/**
 * Give to a person (D156; ADR 0018's Move to…): the way to give photos to someone without dragging (WCAG 2.5.7), from
 * To review, a person's line or the photo panel (C13). A search box and one list of native radios (arrow keys move
 * between them), the people grouped by class. Nothing moves until Give is pressed. Group photos never come here (C8).
 */
export function GiveDialog({
  jobId,
  photoIds,
  onClose,
  onGive,
}: {
  jobId: string;
  /** The photos to give; null when closed. */
  photoIds: string[] | null;
  onClose: () => void;
  onGive: (photoIds: string[], target: MoveTarget, targetName: string) => Promise<void>;
}) {
  const t = useTranslations("app.photos.review.giveDialog");
  // The job's own name for the class field (ADR 0030, call 29).
  const group = useJob().job.classLabel;
  const open = photoIds !== null;
  const { classes, people, failed } = usePeople(jobId, open);
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

  const { sections, shownAll } = useMemo(() => {
    if (!classes || !people) return { sections: [], shownAll: true };
    const q = search.trim().toLowerCase();
    const named = people
      .map((p) => ({ p, label: t("name", { first: p.firstName, last: p.lastName }) }))
      .filter(({ label }) => !q || label.toLowerCase().includes(q));
    const out: { key: string; title: string; options: { id: string; label: string }[] }[] = [];
    let shown = 0;
    for (const c of [...classes, null]) {
      const options = named
        .filter(({ p }) => p.classId === (c?.id ?? null))
        .slice(0, Math.max(0, SHOWN - shown))
        .map(({ p, label }) => ({ id: p.id, label }));
      shown += options.length;
      if (options.length)
        out.push({ key: c?.id ?? "none", title: c?.name ?? t("noClass", { group }), options });
    }
    return { sections: out, shownAll: shown >= named.length };
  }, [classes, people, search, t, group]);

  const options = sections.flatMap((s) => s.options);
  const chosen = options.find((o) => o.id === choice) ?? null;

  return (
    <Dialog open={open} onClose={onClose} title={t("title", { count: photoIds?.length ?? 0 })}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!chosen || !photoIds) return;
          setBusy(true);
          await onGive(photoIds, { kind: "child", childId: chosen.id }, chosen.label);
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
        {!people && !failed ? <p className="m-0 text-muted">{t("loading")}</p> : null}
        {people && options.length === 0 ? <p className="m-0 text-muted">{t("noMatch")}</p> : null}
        <div className="flex max-h-[45dvh] flex-col gap-3 overflow-y-auto">
          {sections.map((section) => (
            <fieldset key={section.key} className="m-0 flex flex-col border-0 p-0">
              <legend className="mb-1 p-0 text-label font-bold text-muted">{section.title}</legend>
              {section.options.map((o) => (
                <label
                  key={o.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-subtle"
                >
                  <input
                    type="radio"
                    name={name}
                    value={o.id}
                    checked={choice === o.id}
                    onChange={() => setChoice(o.id)}
                    className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        {people && !shownAll ? (
          <p className="m-0 text-caption text-muted">{t("shown", { count: SHOWN })}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={!chosen || busy} aria-busy={busy}>
            {t("give")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
