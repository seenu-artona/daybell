import type { IconChipTone } from "@daybell/ui";

/** The soft backgrounds avatars take turns with (D140, Seenu's answer 7). Decorative only. */
export const AVATAR_TONES = [
  "lime",
  "info",
  "warning",
  "primary",
] as const satisfies readonly IconChipTone[];

/**
 * A child's avatar tone, picked from their id so it stays the same when the list is searched, filtered or sorted.
 * Only the id is used, never the name.
 */
export function avatarTone(childId: string): (typeof AVATAR_TONES)[number] {
  let sum = 0;
  for (const ch of childId) sum = (sum + ch.charCodeAt(0)) % 997;
  return AVATAR_TONES[sum % AVATAR_TONES.length] ?? "lime";
}

/** Up to two letters for a child's avatar: the first letter of the first and the last name ("Maya Johnson" is "MJ"). */
export function childInitials(firstName: string, lastName: string): string {
  const first = (name: string) => name.trim().match(/\p{L}|\p{N}/u)?.[0] ?? "";
  return `${first(firstName)}${first(lastName)}`.toUpperCase();
}
