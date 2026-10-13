"use client";

import type { MeResponse } from "@daybell/api";
import { Banner } from "@daybell/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { AppMenu } from "./app-menu";
import { StudioContext, type StudioContextValue } from "./me-context";

/**
 * The studio app frame (D136, D137): desktop only, at a fixed layout that never reflows (min 1280px wide; phones show
 * the same screen, zoomable). The dark menu on the left and the page on the right; no top bar. Pages that don't use
 * the D137 layout yet put themselves in a PageFrame column.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("app");
  const text = useApiText();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [signOutFailed, setSignOutFailed] = useState(false);

  useEffect(() => {
    api<MeResponse>("/me").then((res) => {
      if (res.ok) setMe(res.data);
      else if (res.status === 401) router.replace("/sign-in?next=/app");
      else setFailed(true);
    });
  }, [router]);

  async function signOut() {
    setSignOutFailed(false);
    const res = await api("/auth/sign-out", { method: "POST" });
    // If the session could not be ended, stay put and say so; never pretend the user is signed out.
    if (!res.ok) {
      setSignOutFailed(true);
      return;
    }
    router.replace("/sign-in");
    router.refresh();
  }

  const studio = me?.studio;
  const value: StudioContextValue | null =
    me && studio
      ? { me: { ...me, studio }, version, changed: () => setVersion((v) => v + 1) }
      : null;
  const notices = [
    signOutFailed ? <Banner key="signout" tone="danger" title={t("signOutFailed")} /> : null,
    failed ? <Banner key="failed" tone="danger" title={text.error("internal")} /> : null,
    !me && !failed ? (
      <p key="loading" className="m-0 text-muted">
        {t("loading")}
      </p>
    ) : null,
    me && !studio ? <Banner key="nostudio" tone="info" title={t("noStudio")} /> : null,
  ].filter(Boolean);

  return (
    <div className="flex min-h-dvh min-w-[1280px] bg-canvas text-body-lg text-ink">
      <AppMenu
        email={me?.email ?? null}
        studioName={studio?.name ?? ""}
        hasStudio={Boolean(studio)}
        onSignOut={signOut}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {notices.length > 0 ? (
          <div className="flex flex-col gap-3 px-12 pt-6">{notices}</div>
        ) : null}
        {value ? <StudioContext.Provider value={value}>{children}</StudioContext.Provider> : null}
      </main>
    </div>
  );
}
