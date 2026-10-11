import type { ReactNode } from "react";
import { JobShell } from "./job-shell";

/** One job's pages share a header, tabs and the job's data (D137); this layout stays mounted across its tabs. */
export default function JobLayout({ children }: { children: ReactNode }) {
  return <JobShell>{children}</JobShell>;
}
