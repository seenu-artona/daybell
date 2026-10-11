import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "./app-shell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Desktop only (D136; ADR 0013): a phone lays the page out 1280px wide and scales it to fit, so it shows the same
// screen. initialScale is cleared on purpose: Next.js adds initial-scale=1 by default, which would open the page at
// 100% (its top-left corner) instead of fitted. Never set maximumScale or userScalable: people must be able to
// zoom (WCAG 1.4.4).
export const viewport: Viewport = { width: 1280, initialScale: undefined };

export default function StudioAppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
