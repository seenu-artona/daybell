"use client";

import type { MeResponse } from "@daybell/api";
import { Banner, Button } from "@daybell/ui";
import { Bell, CircleHelp, Ellipsis, ExternalLink, LogOut, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { CommandPalette, type PaletteHandle } from "./command-palette";
import { StudioContext, type StudioContextValue } from "./me-context";
import { SECTIONS, type SectionKey, sectionForPath } from "./nav";
import { Popover } from "./popover";

const FOCUS = " focus-visible:outline-2 focus-visible:outline-primary";
const SHEET_ROW = `flex min-h-12 items-center gap-3 rounded-[10px] px-3 font-medium text-ink no-underline hover:bg-subtle${FOCUS}`;
const SETTINGS = SECTIONS.find((s) => s.key === "settings");

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "D";

function StudioMark({ name }: { name: string }) {
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-ink text-sm font-extrabold text-white"
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/** One menu row. Labels always visible (people 30–60 find labelled menus faster than icon-only ones). */
function NavLink({
  section,
  current,
  onNavigate,
}: {
  section: (typeof SECTIONS)[number];
  current: SectionKey | null;
  onNavigate?: () => void;
}) {
  const t = useTranslations("app.nav");
  const active = current === section.key;
  return (
    <Link
      href={section.href}
      aria-current={active ? "page" : undefined}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      className={`flex min-h-12 items-center gap-3 rounded-[10px] px-3 text-body-lg no-underline focus-visible:outline-2 focus-visible:outline-primary ${
        active
          ? "bg-primary-soft font-bold text-primary-hover"
          : "font-medium text-ink hover:bg-subtle"
      }`}
    >
      <section.icon
        className={`size-5 shrink-0 ${active ? "" : "text-muted"}`}
        aria-hidden="true"
      />
      <span className="flex-1">{t(section.key)}</span>
      {section.built ? null : <span className="text-caption text-muted">{t("soon")}</span>}
    </Link>
  );
}

/**
 * The studio app frame (D126–D130), modelled on Shopify's admin: a top bar with the studio on the left, a wide search
 * in the centre and shop/notifications/account on the right; a light, always-labelled sidebar on desktop; and a
 * labelled bottom tab bar with a "More" sheet on phones.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("app");
  const text = useApiText();
  const router = useRouter();
  const palette = useRef<PaletteHandle>(null);
  const moreSheet = useRef<HTMLDialogElement>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [isMac, setIsMac] = useState(true);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const pathname = usePathname();
  const current = sectionForPath(pathname);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  // The "More" sheet is for phones; if the window grows to desktop width, close it so the page stays usable.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (desktop.matches) moreSheet.current?.close();
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

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
      moreSheet.current?.close();
      setSignOutFailed(true);
      return;
    }
    router.replace("/sign-in");
    router.refresh();
  }

  const studio = me?.studio;
  const studioName = studio?.name ?? "Daybell";
  const value: StudioContextValue | null =
    me && studio
      ? { me: { ...me, studio }, version, changed: () => setVersion((v) => v + 1) }
      : null;
  const onHelp = pathname.replace(/\/+$/, "") === "/app/help";
  const closeMore = () => moreSheet.current?.close();

  const notifications = (
    <Popover label={t("top.notifications")} icon={<Bell />}>
      {() => (
        <>
          <p className="m-0 mb-1 font-semibold">{t("top.notifications")}</p>
          <p className="m-0 text-muted">{t("top.notificationsEmpty")}</p>
        </>
      )}
    </Popover>
  );

  return (
    <div className="min-h-dvh bg-canvas text-body-lg">
      {/* Top bar (desktop and tablet) */}
      <header className="sticky top-0 z-20 hidden h-16 items-center border-b border-line bg-surface px-4 lg:grid lg:grid-cols-[232px_1fr_auto] lg:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <StudioMark name={studioName} />
          <div className="min-w-0">
            <p className="m-0 truncate text-[15px] leading-5 font-bold">{studioName}</p>
            {studio ? (
              <p className="m-0 text-caption text-muted">{t(`roles.${studio.role}`)}</p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => palette.current?.open()}
          aria-keyshortcuts="Meta+K Control+K"
          className="mx-auto flex h-11 w-full max-w-[600px] items-center gap-3 rounded-[10px] border border-line bg-canvas px-4 text-muted hover:border-line-strong focus-visible:outline-2 focus-visible:outline-primary"
        >
          <Search className="size-5" aria-hidden="true" />
          <span className="flex-1 text-left">{t("top.searchPlaceholderLong")}</span>
          <kbd className="rounded-sm border border-line px-1.5 text-caption" aria-hidden="true">
            {isMac ? t("top.searchShortcutMac") : t("top.searchShortcutOther")}
          </kbd>
        </button>
        <div className="flex items-center gap-2">
          <Button asChild variant="secondary" size="sm" className="min-h-11 px-4 text-sm">
            <Link href="/app/shop">
              <ExternalLink aria-hidden="true" />
              {t("top.viewShop")}
            </Link>
          </Button>
          {notifications}
          <Popover
            label={t("top.account")}
            icon={
              <span className="grid size-9 place-items-center rounded-full border border-line bg-subtle text-sm font-bold">
                {initials(me?.email ?? "")}
              </span>
            }
          >
            {() => (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="m-0 text-caption text-muted">{t("top.signedInAs")}</p>
                  <p className="m-0 font-semibold break-all">{me?.email}</p>
                </div>
                <Button variant="secondary" onClick={signOut}>
                  <LogOut aria-hidden="true" />
                  {t("signOut")}
                </Button>
              </div>
            )}
          </Popover>
        </div>
      </header>

      {/* Phone header */}
      <header className="sticky top-0 z-20 flex h-15 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
        <StudioMark name={studioName} />
        <span className="flex-1 truncate font-bold">{studioName}</span>
        {notifications}
      </header>

      <div className="lg:grid lg:grid-cols-[248px_1fr]">
        {/* Sidebar (desktop) */}
        <aside className="hidden border-r border-line lg:sticky lg:top-16 lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col lg:p-3">
          <nav aria-label={t("nav.label")} className="flex flex-1 flex-col gap-1">
            {SECTIONS.filter((s) => s.key !== "settings").map((s) => (
              <NavLink key={s.key} section={s} current={current} />
            ))}
            <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3">
              <Link
                href="/app/help"
                aria-current={onHelp ? "page" : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-[10px] px-3 no-underline focus-visible:outline-2 focus-visible:outline-primary ${onHelp ? "bg-primary-soft font-bold text-primary-hover" : "font-medium text-ink hover:bg-subtle"}`}
              >
                <CircleHelp className="size-5 text-muted" aria-hidden="true" />
                {t("nav.help")}
              </Link>
              {SETTINGS ? <NavLink section={SETTINGS} current={current} /> : null}
            </div>
          </nav>
        </aside>

        <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 pt-6 pb-28 sm:px-8 lg:px-12 lg:pt-10 lg:pb-12">
          {signOutFailed ? <Banner tone="danger" title={t("signOutFailed")} /> : null}
          {failed ? <Banner tone="danger" title={text.error("internal")} /> : null}
          {!me && !failed ? <p className="text-muted">{t("loading")}</p> : null}
          {me && !studio ? <Banner tone="info" title={t("noStudio")} /> : null}
          {value ? <StudioContext.Provider value={value}>{children}</StudioContext.Provider> : null}
        </main>
      </div>

      {/* Phone tab bar */}
      <nav
        aria-label={t("nav.label")}
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-surface pb-[max(env(safe-area-inset-bottom),8px)] lg:hidden"
      >
        {SECTIONS.filter((s) => s.tab).map((s) => (
          <Link
            key={s.key}
            href={s.href}
            aria-current={current === s.key ? "page" : undefined}
            className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-caption no-underline${FOCUS} ${current === s.key ? "font-bold text-primary before:absolute before:inset-x-4 before:top-0 before:h-[3px] before:rounded-b-full before:bg-primary" : "font-semibold text-muted"}`}
          >
            <s.icon className="size-6" aria-hidden="true" />
            {t(`nav.${s.key}`)}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => palette.current?.open()}
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-caption font-semibold text-muted${FOCUS}`}
        >
          <Search className="size-6" aria-hidden="true" />
          {t("top.search")}
        </button>
        <button
          type="button"
          onClick={() => moreSheet.current?.showModal()}
          aria-haspopup="dialog"
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-caption font-semibold text-muted${FOCUS}`}
        >
          <Ellipsis className="size-6" aria-hidden="true" />
          {t("nav.more")}
        </button>
      </nav>

      {/* Phone "More" sheet */}
      <dialog
        ref={moreSheet}
        aria-label={t("nav.more")}
        className="mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none rounded-t-2xl bg-surface p-0 backdrop:bg-ink/40 lg:hidden"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <p className="m-0 font-bold">{t("nav.more")}</p>
          <button
            type="button"
            onClick={closeMore}
            aria-label={t("top.close")}
            className={`grid size-11 place-items-center rounded-md hover:bg-subtle${FOCUS}`}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-1 p-3">
          {SECTIONS.filter((s) => !s.tab).map((s) => (
            <NavLink key={s.key} section={s} current={current} onNavigate={closeMore} />
          ))}
          <Link href="/app/help" onClick={closeMore} className={SHEET_ROW}>
            <CircleHelp className="size-5 text-muted" aria-hidden="true" />
            {t("nav.help")}
          </Link>
          <Link href="/app/shop" onClick={closeMore} className={SHEET_ROW}>
            <ExternalLink className="size-5 text-muted" aria-hidden="true" />
            {t("top.viewShop")}
          </Link>
          <button type="button" onClick={signOut} className={`${SHEET_ROW} text-left`}>
            <LogOut className="size-5 text-muted" aria-hidden="true" />
            {t("signOut")}
          </button>
        </div>
      </dialog>

      <CommandPalette ref={palette} />
    </div>
  );
}
