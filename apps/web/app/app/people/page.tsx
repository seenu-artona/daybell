import { redirect } from "next/navigation";

/** People opens on its first section, Clients (D150; ADR 0028). */
export default function PeoplePage() {
  redirect("/app/people/clients");
}
