"use client";

import type { Group, ListFilterChip } from "@daybell/api";
import type { GroupLabel } from "@daybell/core";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { AddFilterChoice } from "../../../filter-chips/add-filter-menu";
import type { ChipItem } from "../../../filter-chips/chip-row";
import { type ListFilters, useListFilters } from "../../../filter-chips/use-list-filters";
import {
  ALL_SUBJECTS,
  BUILT_IN_SHOWS,
  SAVED_SHOWS,
  type SubjectChip,
  sameSubjectChip,
  subjectChipFrom,
  subjectChipFromSaved,
  subjectsHref,
} from "./views";

/** Case, accents and spaces ignored, like core's roster search. */
const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Subjects' chips (D147, ADR 0026): the selected chip (from the address, or a grade kept in this browser), the row's
 * items and what "+ Add filter" offers. Classes and grades come from the loaded roster: a saved class that is gone is
 * dropped (and saved), and a class or grade that leaves the roster stops filtering (back to All).
 */
export function useSubjectChips({
  base,
  jobId,
  groups,
  grades,
  loaded,
  word,
  seesOrders,
}: {
  /** The Subjects tab's path. */
  base: string;
  jobId: string;
  groups: readonly Group[];
  grades: readonly string[];
  /** The roster and its classes have loaded (so a class missing from them is really gone). */
  loaded: boolean;
  word: GroupLabel;
  seesOrders: boolean;
}): {
  chip: SubjectChip;
  childId: string | null;
  items: ChipItem[];
  choices: AddFilterChoice[];
  /** The saved chips' state, for SavedChipsNotice. */
  saved: ListFilters;
} {
  const t = useTranslations("app.people");
  const tr = useTranslations("app.roster");
  const tc = useTranslations("app.chips");
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const childId = params.get("child");
  const { chip: urlChip, clean } = useMemo(
    () => subjectChipFrom(new URLSearchParams(query), { seesOrders }),
    [query, seesOrders],
  );
  const saved = useListFilters("job_subjects", jobId);
  // Grades are chips in this browser only: never saved, never in the address.
  const [gradeChips, setGradeChips] = useState<string[]>([]);
  const [grade, setGrade] = useState<string | null>(null);
  const shownGrades = gradeChips.filter((g) => grades.includes(g));
  const activeGrade = grade !== null && grades.includes(grade) ? grade : null;
  const chip: SubjectChip =
    urlChip.kind === "all" && activeGrade !== null
      ? { kind: "grade", grade: activeGrade }
      : urlChip;

  const classGone = loaded && urlChip.kind === "class" && !groups.some((g) => g.id === urlChip.id);
  useEffect(() => {
    if (clean || classGone)
      router.replace(subjectsHref(base, ALL_SUBJECTS, childId), { scroll: false });
  }, [clean, classGone, router, base, childId]);

  const { forget } = saved;
  useEffect(() => {
    if (!loaded || !saved.chips) return;
    const gone = saved.chips.filter(
      (c) => c.key === "class" && c.value !== null && !groups.some((g) => g.id === c.value),
    );
    if (gone.length > 0) forget(gone);
  }, [loaded, saved.chips, groups, forget]);

  const label = (c: SubjectChip): string => {
    switch (c.kind) {
      case "all":
        return tc("all");
      case "class":
        return groups.find((g) => g.id === c.id)?.name ?? tc("loadingName");
      case "grade":
        return t("chips.gradeChip", { grade: c.grade });
      case "show":
        if (c.show === "noClass") return tr("noGroup", { group: word });
        if (c.show === "notOrdered" || c.show === "noPhotos") return t(`chips.${c.show}`);
        return t(`flags.${c.show}`);
    }
  };
  const linkItem = (c: SubjectChip, remove?: ListFilterChip): ChipItem => ({
    id: subjectsHref("", c),
    label: label(c),
    selected: sameSubjectChip(c, chip),
    href: subjectsHref(base, c, childId),
    // Until the record's name is known, the chip is named by its kind rather than "…".
    ...(c.kind === "class" && !groups.some((g) => g.id === c.id)
      ? { ariaLabel: tr("columns.group", { group: word }) }
      : {}),
    // Any chip with an address takes over from a grade chosen in this browser.
    onSelect: () => setGrade(null),
    ...(remove
      ? {
          onRemove: () => {
            void saved.remove(remove);
            if (sameSubjectChip(c, chip))
              router.push(subjectsHref(base, ALL_SUBJECTS, childId), { scroll: false });
          },
          // Until the roster's classes are loaded, the button says what kind of chip it removes.
          ...(c.kind === "class" && !groups.some((g) => g.id === c.id)
            ? { removeLabel: tc("remove", { name: tr("columns.group", { group: word }) }) }
            : {}),
        }
      : {}),
  });
  const added = (saved.chips ?? []).flatMap((s) => {
    const c = subjectChipFromSaved(s);
    return c ? [{ chip: c, saved: s }] : [];
  });
  const items: ChipItem[] = [
    linkItem(ALL_SUBJECTS),
    ...BUILT_IN_SHOWS.filter((show) => show !== "notOrdered" || seesOrders).map((show) =>
      linkItem({ kind: "show", show }),
    ),
    ...added.map((a) => linkItem(a.chip, a.saved)),
    ...shownGrades.map(
      (g): ChipItem => ({
        id: `grade:${g}`,
        label: label({ kind: "grade", grade: g }),
        selected: chip.kind === "grade" && chip.grade === g,
        onSelect: () => {
          setGrade(g);
          router.push(subjectsHref(base, ALL_SUBJECTS, childId), { scroll: false });
        },
        onRemove: () => {
          setGradeChips((list) => list.filter((x) => x !== g));
          if (activeGrade === g) setGrade(null);
        },
      }),
    ),
  ];
  // A chip in the address that isn't saved (a shared link) still shows, selected, without a remove button.
  if (!items.some((i) => i.selected)) items.push(linkItem(chip));

  const addSaved = (saving: ListFilterChip, c: SubjectChip) => {
    void saved.add(saving);
    setGrade(null);
    router.push(subjectsHref(base, c, childId), { scroll: false });
  };
  const has = (key: string, value: string | null = null) =>
    added.some((a) => a.saved.key === key && a.saved.value === value);
  // Nothing can be saved until the saved chips have loaded; a grade (browser only) can be added meanwhile.
  const savedChoices: AddFilterChoice[] =
    saved.chips === null || saved.full
      ? []
      : [
          ...groups
            .filter((g) => !has("class", g.id))
            .map(
              (g): AddFilterChoice => ({
                kind: "plain",
                id: `class:${g.id}`,
                label: g.name,
                onPick: () => addSaved({ key: "class", value: g.id }, { kind: "class", id: g.id }),
              }),
            ),
          ...SAVED_SHOWS.filter((show) => !has(show)).map(
            (show): AddFilterChoice => ({
              kind: "plain",
              id: show,
              label: label({ kind: "show", show }),
              onPick: () => addSaved({ key: show, value: null }, { kind: "show", show }),
            }),
          ),
        ];
  const gradesLeft = grades.filter((g) => !gradeChips.includes(g));
  const gradeChoice: AddFilterChoice[] =
    gradesLeft.length > 0
      ? [
          {
            kind: "search",
            id: "grade",
            label: t("chips.gradeMenu"),
            fieldLabel: t("chips.grade"),
            placeholder: t("chips.gradePlaceholder"),
            listLabel: t("chips.gradeList"),
            search: async (q) =>
              gradesLeft.filter((g) => fold(g).includes(fold(q))).map((g) => ({ id: g, name: g })),
            onPick: (option) => {
              setGradeChips((list) => (list.includes(option.id) ? list : [...list, option.id]));
              setGrade(option.id);
              router.push(subjectsHref(base, ALL_SUBJECTS, childId), { scroll: false });
            },
          },
        ]
      : [];
  // The classes, No class, then Grade… (when the roster has grades), then the two flags, as the mockup lists them.
  const flags = savedChoices.filter((c) => c.id === "doNotPhotograph" || c.id === "doNotPublish");
  const choices = [...savedChoices.filter((c) => !flags.includes(c)), ...gradeChoice, ...flags];

  return { chip, childId, items, choices, saved };
}
