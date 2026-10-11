import { redirect } from "next/navigation";

/** Contacts opens on Clients until Parents and Children arrive. */
export default function ContactsPage() {
  redirect("/app/contacts/clients");
}
