"use client";

import type { MeResponse } from "@daybell/api";
import { Banner, Button, SideMenu, SideMenuItem } from "@daybell/ui";
import { Bell, CircleHelp, ExternalLink, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { CommandPalette } from "./command-palette";
import { StudioContext, type StudioContextValue } from "./me-context";
import { SECTIONS, sectionForPath } from "./nav";
import { Popover } from "./popover";

function Brand() {
  return (
    <>
      <span
        className="grid size-7 place-items-center rounded-[8px] bg-lime text-sm text-ink"
        aria-hidden="true"
      >
        D
      </span>
      Daybell
    </>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations("app.nav");
  const current = sectionForPath(usePathname());
  return (
    <SideMenu label={t("label")} brand={<Brand />} className="h-full w-full rounded-none">
      {SECTIONS.map((s) => (
        <SideMenuItem
          key={s.key}
          as={Link}
          href={s.href}
          icon={<s.icon />}
          current={current === s.key}
          {...(s.built ? {} : { tag: t("soon") })}
          {...(onNavigate ? { onClick: onNavigate } : {})}
        >
          {t(s.key)}
        </SideMenuItem>
      ))}
    </SideMenu>
  );
}

/** The studio app frame: side menu, top bar, and the signed-in studio for every page (D126–D129). */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("app");
  const text = useApiText();
  const router = useRouter();
  const drawer = useRef<HTMLDialogElement>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<MeResponse>("/me").then((res) => {
      if (res.ok) setMe(res.data);
      else if (res.status === 401) router.replace("/sign-in?next=/app");
      else setFailed(true);
    });
  }, [router]);

  async function signOut() {
    await api("/auth/sign-out", { method: "POST" });
    router.replace("/sign-in");
    router.refresh();
  }

  const studio = me?.studio;
  const value: StudioContextValue | null =
    me && studio
      ? { me: { ...me, studio }, version, changed: () => setVersion((v) => v + 1) }
      : null;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-dvh">
        <Nav />
      </aside>

      <dialog
        ref={drawer}
        aria-label={t("nav.label")}
        className="m-0 h-dvh max-h-dvh w-[264px] bg-ink p-0 backdrop:bg-ink/50 lg:hidden"
      >
        <button
          type="button"
          onClick={() => drawer.current?.close()}
          aria-label={t("nav.closeMenu")}
          className="absolute top-3 right-3 z-10 grid size-11 place-items-center rounded-md text-white/80 hover:bg-white/10"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
        <Nav onNavigate={() => drawer.current?.close()} />
      </dialog>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-line bg-surface px-2 py-2 sm:gap-2 sm:px-4">
          <button
            type="button"
            onClick={() => drawer.current?.showModal()}
            aria-label={t("nav.openMenu")}
            className="grid size-11 place-items-center rounded-md hover:bg-subtle lg:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <span className="truncate font-bold lg:hidden">{studio?.name ?? "Daybell"}</span>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <CommandPalette />
            <Popover label={t("top.help")} icon={<CircleHelp />}>
              {() => <p className="m-0 text-muted">{t("top.helpBody")}</p>}
            </Popover>
            <Popover label={t("top.notifications")} icon={<Bell />}>
              {() => (
                <>
                  <p className="m-0 mb-1 font-semibold">{t("top.notifications")}</p>
                  <p className="m-0 text-muted">{t("top.notificationsEmpty")}</p>
                </>
              )}
            </Popover>
            <Button asChild variant="secondary" size="sm" className="hidden sm:inline-flex">
              <Link href="/app/shop">
                <ExternalLink aria-hidden="true" />
                {t("top.viewShop")}
              </Link>
            </Button>
            <Popover label={t("top.account")} icon={<UserRound />}>
              {(close) => (
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="m-0 text-caption text-muted">{t("top.signedInAs")}</p>
                    <p className="m-0 font-semibold break-all">{me?.email}</p>
                    {studio ? (
                      <p className="m-0 text-caption text-muted">
                        {studio.name} · {t(`roles.${studio.role}`)}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href="/app/shop"
                    onClick={close}
                    className="font-semibold text-primary sm:hidden"
                  >
                    {t("top.viewShop")}
                  </Link>
                  <Button variant="secondary" size="sm" onClick={signOut}>
                    {t("signOut")}
                  </Button>
                </div>
              )}
            </Popover>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 px-4 py-6 sm:py-8">
          {failed ? <Banner tone="danger" title={text.error("internal")} /> : null}
          {!me && !failed ? <p className="text-muted">{t("loading")}</p> : null}
          {me && !studio ? <Banner tone="info" title={t("noStudio")} /> : null}
          {value ? <StudioContext.Provider value={value}>{children}</StudioContext.Provider> : null}
        </main>
      </div>
    </div>
  );
}
