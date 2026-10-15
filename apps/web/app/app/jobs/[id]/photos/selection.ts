import type { TaggedPhoto } from "@daybell/api";

/**
 * The ticked photos after one section's photos load again (D143; ADR 0018): a ticked photo that was in the section and
 * no longer is drops out, and a ticked photo still in it takes the fresh data, so the selection bar never offers
 * actions from old data. Ticked photos from other sections are left alone. `before` is null on a section's first load
 * (nothing can drop then). Returns `checked` itself when nothing changed.
 */
export function reconcileChecked(
  checked: ReadonlyMap<string, TaggedPhoto>,
  before: readonly TaggedPhoto[] | null,
  after: readonly TaggedPhoto[],
): ReadonlyMap<string, TaggedPhoto> {
  if (checked.size === 0) return checked;
  const fresh = new Map(after.map((p) => [p.id, p]));
  const gone = new Set((before ?? []).filter((p) => !fresh.has(p.id)).map((p) => p.id));
  let next: Map<string, TaggedPhoto> | null = null;
  for (const [id, photo] of checked) {
    const now = fresh.get(id);
    if (gone.has(id)) {
      next ??= new Map(checked);
      next.delete(id);
    } else if (now && now !== photo) {
      next ??= new Map(checked);
      next.set(id, now);
    }
  }
  return next ?? checked;
}
