import type { PeopleFilter } from "@daybell/core";

/**
 * Subjects' views (D144): All, Possible duplicates, Do not photograph and Do not publish, in the address as ?show=
 * (enum words only, never search text: D113). Ordered / Not ordered / No photos wait for API data (plan B1).
 */
export const SUBJECT_VIEWS = ["all", "duplicates", "doNotPhotograph", "doNotPublish"] as const;
export type SubjectView = (typeof SUBJECT_VIEWS)[number];

/** The view in ?show=; anything unknown is All. */
export function subjectView(param: string | null): SubjectView {
  return (SUBJECT_VIEWS as readonly string[]).includes(param ?? "") && param !== "all"
    ? (param as SubjectView)
    : "all";
}

/** A view's address, with the open child's id when there is one. Only enum words and ids go in it. */
export function subjectsHref(base: string, view: SubjectView, childId?: string | null): string {
  const params = new URLSearchParams();
  if (view !== "all") params.set("show", view);
  if (childId) params.set("child", childId);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** The class menu's choice: every class, children with no class, or one class by id. */
export type ClassChoice = { kind: "all" } | { kind: "none" } | { kind: "group"; id: string };

/** The class menu's choice as one string, for its radio buttons: "" (all), "none" or a class id. */
export function classChoiceValue(choice: ClassChoice): string {
  return choice.kind === "all" ? "" : choice.kind === "none" ? "none" : choice.id;
}

export function classChoiceFrom(value: string): ClassChoice {
  return value === ""
    ? { kind: "all" }
    : value === "none"
      ? { kind: "none" }
      : { kind: "group", id: value };
}

/**
 * The view, the class menu and the grade menu as core filters (they combine with AND; the search box is applied on
 * top). The grade is "" for every grade.
 */
export function subjectFilters({
  view,
  classChoice,
  grade,
}: {
  view: SubjectView;
  classChoice: ClassChoice;
  grade: string;
}): PeopleFilter[] {
  const filters: PeopleFilter[] = [];
  if (view !== "all") filters.push({ kind: view });
  if (classChoice.kind === "none") filters.push({ kind: "noGroup" });
  if (classChoice.kind === "group") filters.push({ kind: "group", id: classChoice.id });
  if (grade) filters.push({ kind: "grade", value: grade });
  return filters;
}

/** The class choice that applies: a class that is no longer on the roster (renamed away, removed) falls back to All. */
export function effectiveClassChoice(
  choice: ClassChoice,
  groups: readonly { id: string }[],
): ClassChoice {
  return choice.kind === "group" && !groups.some((g) => g.id === choice.id)
    ? { kind: "all" }
    : choice;
}

/** The grade that applies: one no child has any more falls back to every grade (""). */
export function effectiveGrade(grade: string, grades: readonly string[]): string {
  return grade && !grades.includes(grade) ? "" : grade;
}
