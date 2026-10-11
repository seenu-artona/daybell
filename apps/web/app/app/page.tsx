import type { Metadata } from "next";
import { StudioHome } from "./studio-home";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Studio home (Phase 0 placeholder). The full app shell with the side menu arrives in Phase 0, step 8. */
export default function AppPage() {
  return <StudioHome />;
}
