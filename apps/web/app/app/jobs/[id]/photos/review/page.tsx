import { redirect } from "next/navigation";
import { reviewHref } from "../../tabs";

/**
 * The old Review address (ADR 0018): Review is now Photos' To review chip (D156; ADR 0030, call 6), so bookmarks, the
 * checklist and the bell land there.
 */
export default async function ReviewRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(reviewHref(id));
}
