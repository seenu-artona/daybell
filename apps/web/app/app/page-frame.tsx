import type { ReactNode } from "react";

/**
 * The padded, centred column for studio pages that don't use the D137 layout yet (Home, Jobs, Contacts, Settings,
 * coming-soon sections). A page that moves to the D137 layout drops it.
 */
export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-12 pt-10 pb-12">
      {children}
    </div>
  );
}
