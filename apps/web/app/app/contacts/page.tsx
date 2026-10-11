import { redirect } from "next/navigation";

/** Contacts opens on Organizations until Parents and Children arrive. */
export default function ContactsPage() {
  redirect("/app/contacts/organizations");
}
