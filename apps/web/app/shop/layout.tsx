import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ProtectionProvider } from "./_components/protection";
import { ShopProvider } from "./_components/shop-context";

// The parent shop (D24; ADR 0022). Pinned to Montréal like its API (D113), and a client-rendered shell: children's
// names and photos reach the browser only through /api/v1/shop, never through a server render elsewhere.
export const preferredRegion = "yul1";
// Rendered per request, so Next can put the request's Content-Security-Policy nonce on its scripts (proxy.ts).
export const dynamic = "force-dynamic";

// The title until a page names itself (ShopTitle; code review S3).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shop");
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/** Phone first: one column, centred on wider screens. White pages; the studio's colour is the accent (D116). */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface">
      <ShopProvider>
        <ProtectionProvider>
          <div className="mx-auto min-h-dvh max-w-[480px] bg-surface">{children}</div>
        </ProtectionProvider>
      </ShopProvider>
    </div>
  );
}
