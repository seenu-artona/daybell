"use client";

import type { ListFilterChip } from "@daybell/api";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import type { AddFilterChoice } from "../../../filter-chips/add-filter-menu";
import type { ChipItem } from "../../../filter-chips/chip-row";
import { type ListFilters, useListFilters } from "../../../filter-chips/use-list-filters";

/**
 * Photos' People chips (D156, amending D147 and ADR 0026's answer 4): All and To review built in, and a group added by
 * the person through "+ Add filter › Group…" (saved for this job). One chip at a time, in the address as ?show=review or
 * ?group=<id>, with the open photo in &photo=<id> and the bin in ?bin=1 (enum words and ids only, D113).
 */
export type PhotoChip = { kind: "all" } | { kind: "review" } | { kind: "group"; id: string };

export const ALL_PHOTOS: PhotoChip = { kind: "all" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Parameters the page itself keeps beside the chip. */
const OWN = new Set(["photo", "bin"]);

/** The chip in the address. Anything unknown, or both kinds at once, is All, and `clean` asks for a clean address. */
export function photoChipFrom(params: URLSearchParams): { chip: PhotoChip; clean: boolean } {
  const show = params.get("show");
  const group = params.get("group");
  const unknown = [...params.keys()].some((k) => k !== "show" && k !== "group" && !OWN.has(k));
  if (show === null && group === null) return { chip: ALL_PHOTOS, clean: unknown };
  if (show === "review" && group === null) return { chip: { kind: "review" }, clean: unknown };
  if (show === null && group !== null && UUID.test(group))
    return { chip: { kind: "group", id: group.toLowerCase() }, clean: unknown };
  return { chip: ALL_PHOTOS, clean: true };
}

/** A chip's address, with the open photo (or the bin) when there is one. */
export function photosHref(
  base: string,
  chip: PhotoChip,
  extra: { photoId?: string | null; bin?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (extra.bin) params.set("bin", "1");
  else {
    if (chip.kind === "review") params.set("show", "review");
    if (chip.kind === "group") params.set("group", chip.id);
  }
  if (extra.photoId) params.set("photo", extra.photoId);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function samePhotoChip(a: PhotoChip, b: PhotoChip): boolean {
  return photosHref("", a) === photosHref("", b);
}

/** A saved chip's filter, or null for a key Photos doesn't take. */
export function photoChipFromSaved(saved: ListFilterChip): PhotoChip | null {
  return saved.key === "group" && saved.value ? { kind: "group", id: saved.value } : null;
}

/** Case, accents and spaces ignored. */
const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The row's chips and what "+ Add filter" offers. Groups come from the job's loaded groups: a saved group that is gone is
 * dropped (and saved), and an address naming one that is gone goes back to All.
 */
export function usePhotoChips({
  base,
  jobId,
  groups,
}: {
  base: string;
  jobId: string;
  /** The job's groups; null until loaded (a group missing from them is then really gone). */
  groups: readonly { id: string; name: string }[] | null;
}): {
  chip: PhotoChip;
  photoId: string | null;
  bin: boolean;
  items: ChipItem[];
  choices: AddFilterChoice[];
  saved: ListFilters;
} {
  const t = useTranslations("app.photos");
  const tc = useTranslations("app.chips");
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const photoId = params.get("photo");
  const bin = params.get("bin") === "1";
  const { chip, clean } = useMemo(() => photoChipFrom(new URLSearchParams(query)), [query]);
  const saved = useListFilters("job_photos", jobId);

  const gone = groups !== null && chip.kind === "group" && !groups.some((g) => g.id === chip.id);
  useEffect(() => {
    if (clean || gone)
      router.replace(photosHref(base, ALL_PHOTOS, { photoId, bin }), { scroll: false });
  }, [clean, gone, router, base, photoId, bin]);

  const { forget } = saved;
  useEffect(() => {
    if (!groups || !saved.chips) return;
    const missing = saved.chips.filter(
      (c) => c.key === "group" && c.value !== null && !groups.some((g) => g.id === c.value),
    );
    if (missing.length > 0) forget(missing);
  }, [groups, saved.chips, forget]);

  const nameOf = (id: string) => groups?.find((g) => g.id === id)?.name;
  const label = (c: PhotoChip) =>
    c.kind === "all"
      ? tc("all")
      : c.kind === "review"
        ? t("views.toReview")
        : (nameOf(c.id) ?? tc("loadingName"));
  const item = (c: PhotoChip, remove?: ListFilterChip): ChipItem => ({
    id: photosHref("", c),
    label: label(c),
    selected: !bin && samePhotoChip(c, chip),
    href: photosHref(base, c),
    // Until the group's name is known, the chip is named by its kind rather than "…".
    ...(c.kind === "group" && !nameOf(c.id) ? { ariaLabel: t("chips.group") } : {}),
    ...(remove
      ? {
          onRemove: () => {
            void saved.remove(remove);
            if (samePhotoChip(c, chip))
              router.push(photosHref(base, ALL_PHOTOS), { scroll: false });
          },
          ...(c.kind === "group" && !nameOf(c.id)
            ? { removeLabel: tc("remove", { name: t("chips.group") }) }
            : {}),
        }
      : {}),
  });
  const added = (saved.chips ?? []).flatMap((s) => {
    const c = photoChipFromSaved(s);
    return c ? [{ chip: c, saved: s }] : [];
  });
  const items: ChipItem[] = [
    item(ALL_PHOTOS),
    item({ kind: "review" }),
    ...added.map((a) => item(a.chip, a.saved)),
  ];
  // A group in the address that isn't saved (a shared link) still shows, selected, without a remove button.
  if (!bin && !items.some((i) => i.selected)) items.push(item(chip));

  const left = (groups ?? []).filter((g) => !added.some((a) => a.saved.value === g.id));
  const choices: AddFilterChoice[] =
    saved.chips === null || saved.full || left.length === 0
      ? []
      : [
          {
            kind: "search",
            id: "group",
            label: t("chips.groupMenu"),
            fieldLabel: t("chips.group"),
            placeholder: t("chips.groupPlaceholder"),
            listLabel: t("chips.groupList"),
            search: async (q) =>
              left
                .filter((g) => fold(g.name).includes(fold(q)))
                .map((g) => ({ id: g.id, name: g.name })),
            onPick: (option) => {
              void saved.add({ key: "group", value: option.id });
              router.push(photosHref(base, { kind: "group", id: option.id }), { scroll: false });
            },
          },
        ];
  return { chip, photoId, bin, items, choices, saved };
}
