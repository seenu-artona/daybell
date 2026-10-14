import { canSeeOrders } from "./fulfilment";

/**
 * People (D150; ADR 0028): the studio's clients, their contacts, families and every subject across jobs. Pure rules the
 * screens and the API share.
 */

/** People's sections, in order: Clients, Contacts, Families, Subjects. */
export const PEOPLE_SECTIONS = ["clients", "contacts", "families", "subjects"] as const;
export type PeoplePage = (typeof PEOPLE_SECTIONS)[number];

/**
 * The sections a role sees. Families holds parents' orders (it waits for parent accounts), so only people who see
 * order data get it (Seenu's answer 2); photographers don't.
 */
export function peopleSections(role: string): readonly PeoplePage[] {
  return PEOPLE_SECTIONS.filter((s) => s !== "families" || canSeeOrders(role));
}

export interface ContactNameParts {
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * How a contact is named in a list: "First Last", either alone, or (a contact with no name) their email, then their
 * phone. A contact always has one of the four (the database checks it), so this is never empty for a saved one.
 */
export function contactName(contact: ContactNameParts): string {
  const name = [contact.firstName, contact.lastName]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return name || contact.email?.trim() || contact.phone?.trim() || "";
}

/** A contact must be someone: a first or last name, an email or a phone (as the database's check). */
export function isContactEmpty(contact: ContactNameParts): boolean {
  return [contact.firstName, contact.lastName, contact.email, contact.phone].every(
    (v) => !v?.trim(),
  );
}
