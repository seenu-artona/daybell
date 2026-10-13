import type { ReactNode } from "react";

/** A quiet full-width message: a closed shop, no photos yet, nothing in the bag. */
export function MessageScreen({ children }: { children: ReactNode }) {
  return (
    <div className="mt-10 rounded-lg bg-subtle px-5 py-8 text-center text-body text-ink">
      {children}
    </div>
  );
}

/** "Loading…", announced politely. */
export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="m-0 mt-10 text-center text-body text-muted">
      {label}
    </p>
  );
}
