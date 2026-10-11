/**
 * Up to two letters for an avatar. Daybell stores no names for team members yet, only emails (Seenu, Q1 of step 2b),
 * so the initials come from the part of the email before "@": "maya.johnson@…" is "MJ", "pat@…" is "P". With no
 * letter or digit to use it shows a neutral dot rather than a letter that would read as someone's initial.
 */
export const NO_INITIALS = "•";

export function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const letters = local
    .split(/[._+-]+/)
    .map((part) => part.match(/\p{L}|\p{N}/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return letters || NO_INITIALS;
}
