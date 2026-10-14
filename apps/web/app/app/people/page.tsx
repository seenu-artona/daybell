import { redirect } from "next/navigation";

/** People opens on Clients until Contacts, Families and Subjects arrive (D150). */
export default function PeoplePage() {
  redirect("/app/people/clients");
}
