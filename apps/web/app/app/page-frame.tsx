import type { ReactNode } from "react";

/**
 * The padded, centred column for studio pages that aren't lists (Settings, an order, a price list, coming-soon
 * sections). List pages and Home use ListPage instead (D144, amended Oct 14).
 */
export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-12 pt-10 pb-12">
      {children}
    </div>
  );
}
