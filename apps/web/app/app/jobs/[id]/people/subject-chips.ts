"use client";

import type { Class, ListFilterChip } from "@daybell/api";
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
 * items and what "+ Add filter" offers. Classes and grades come from the loaded roster, photo groups from the job's
 * groups (D156; ADR 0030): a saved class or group that is gone is dropped (and saved), and a class, group or grade that
 * goes stops filtering (back to All).
 */
export function useSubjectChips({
  base,
  jobId,
  classes,
  photoGroups,
  grades,
  loaded,
  word,
  seesOrders,
}: {
  /** The Subjects tab's path. */
  base: string;
  jobId: string;
  classes: readonly Class[];
  /** The job's photo groups; null until loaded (a group missing from them is then really gone). */
  photoGroups: readonly { id: string; name: string }[] | null;
  grades: readonly string[];
  /** The roster and its classes have loaded (so a class missing from them is really gone). */
  loaded: boolean;
  word: string;
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
  const tp = useTranslations("app.people.chips");
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

  const classGone = loaded && urlChip.kind === "class" && !classes.some((g) => g.id === urlChip.id);
  const groupGone =
    photoGroups !== null &&
    urlChip.kind === "group" &&
    !photoGroups.some((g) => g.id === urlChip.id);
  useEffect(() => {
    if (clean || classGone || groupGone)
      router.replace(subjectsHref(base, ALL_SUBJECTS, childId), { scroll: false });
  }, [clean, classGone, groupGone, router, base, childId]);

  const { forget } = saved;
  useEffect(() => {
    if (!saved.chips) return;
    const gone = saved.chips.filter(
      (c) =>
        c.value !== null &&
        ((loaded && c.key === "class" && !classes.some((g) => g.id === c.value)) ||
          (photoGroups !== null &&
            c.key === "group" &&
            !photoGroups.some((g) => g.id === c.value))),
    );
    if (gone.length > 0) forget(gone);
  }, [loaded, saved.chips, classes, photoGroups, forget]);

  /** A class or group chip whose name isn't known yet, named by its kind rather than "…". */
  const unnamed = (c: SubjectChip): string | null =>
    c.kind === "class" && !classes.some((g) => g.id === c.id)
      ? tr("columns.group", { group: word })
      : c.kind === "group" && !photoGroups?.some((g) => g.id === c.id)
        ? tp("group")
        : null;

  const label = (c: SubjectChip): string => {
    switch (c.kind) {
      case "all":
        return tc("all");
      case "class":
        return classes.find((g) => g.id === c.id)?.name ?? tc("loadingName");
      case "group":
        return photoGroups?.find((g) => g.id === c.id)?.name ?? tc("loadingName");
      case "grade":
        return t("chips.gradeChip", { grade: c.grade });
      case "show":
        if (c.show === "noClass") return tr("noGroup", { group: word });
        if (c.show === "notOrdered" || c.show === "noPhotos" || c.show === "notPhotographed")
          return t(`chips.${c.show}`);
        return t(`flags.${c.show}`);
    }
  };
  const linkItem = (c: SubjectChip, remove?: ListFilterChip): ChipItem => {
    const kindName = unnamed(c);
    return {
      id: subjectsHref("", c),
      label: label(c),
      selected: sameSubjectChip(c, chip),
      href: subjectsHref(base, c, childId),
      // Until the record's name is known, the chip is named by its kind rather than "…".
      ...(kindName ? { ariaLabel: kindName } : {}),
      // Any chip with an address takes over from a grade chosen in this browser.
      onSelect: () => setGrade(null),
      ...(remove
        ? {
            onRemove: () => {
              void saved.remove(remove);
              if (sameSubjectChip(c, chip))
                router.push(subjectsHref(base, ALL_SUBJECTS, childId), { scroll: false });
            },
            // Until the roster's classes (or the job's groups) are loaded, the button says what kind of chip it removes.
            ...(kindName ? { removeLabel: tc("remove", { name: kindName }) } : {}),
          }
        : {}),
    };
  };
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
          ...classes
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
  const groupsLeft = (photoGroups ?? []).filter((g) => !has("group", g.id));
  const groupChoice: AddFilterChoice[] =
    saved.chips === null || saved.full || groupsLeft.length === 0
      ? []
      : [
          {
            kind: "search",
            id: "group",
            label: tp("groupMenu"),
            fieldLabel: tp("group"),
            placeholder: tp("groupPlaceholder"),
            listLabel: tp("groupList"),
            search: async (q) =>
              groupsLeft
                .filter((g) => fold(g.name).includes(fold(q)))
                .map((g) => ({ id: g.id, name: g.name })),
            onPick: (option) =>
              addSaved({ key: "group", value: option.id }, { kind: "group", id: option.id }),
          },
        ];
  // The classes, No class, Possible duplicates and No photos (moved here by D153), then Grade… (when the roster has
  // grades) and Group… (when the job has photo groups, D156), then the two flags, as the D147 mockup lists them.
  const flags = savedChoices.filter((c) => c.id === "doNotPhotograph" || c.id === "doNotPublish");
  const choices = [
    ...savedChoices.filter((c) => !flags.includes(c)),
    ...gradeChoice,
    ...groupChoice,
    ...flags,
  ];

  return { chip, childId, items, choices, saved };
}
