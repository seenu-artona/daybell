import { Banner } from "@daybell/ui";
import type { ReactNode } from "react";

/**
 * A desktop-only screen (D134; ADR 0012). Below the sm breakpoint it shows a short notice instead of the screen; from
 * sm up it shows the screen. CSS only: the hidden part is display:none, so screen readers skip it too. `display:
 * contents` keeps the screen's children in the page's own flex layout. The page keeps its back link outside this.
 */
export function DesktopOnly({ notice, children }: { notice: string; children: ReactNode }) {
  return (
    <>
      <Banner tone="info" title={notice} className="sm:hidden" />
      <div className="hidden sm:contents">{children}</div>
    </>
  );
}
