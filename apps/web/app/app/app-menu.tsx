"use client";

import { SideMenu, SideMenuItem } from "@daybell/ui";
import { Bell, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { MenuSearch } from "./menu-search";
import { useMenuFolded } from "./menu-state";
import { SECTIONS, sectionForPath } from "./nav";
import { Popover } from "./popover";
import { ProfileMenu } from "./profile-menu";

const RAIL_BUTTON =
  "grid size-11 shrink-0 place-items-center rounded-md text-white/75 hover:bg-white/6 hover:text-white focus-visible:outline-2 focus-visible:outline-lime [&_svg]:size-5";

/**
 * The studio app's menu (D137, D126, D128): one dark column on every page, no top bar. Logo and the fold button,
 * the search box, the sections ("Soon" for unbuilt ones), then the profile and notifications. Folds to a 64px icon
 * rail; the choice is remembered in this browser. ⌘K / Ctrl+K focuses the search box (never shown as a label).
 */
export function AppMenu({
  email,
  studioName,
  onSignOut,
}: {
  email: string | null;
  studioName: string;
  onSignOut: () => void;
}) {
  const t = useTranslations("app");
  const navId = useId();
  const search = useRef<HTMLInputElement>(null);
  const [folded, setFolded] = useMenuFolded();
  const [focusSearch, setFocusSearch] = useState(false);
  const current = sectionForPath(usePathname());

  // Focus the box once it is on screen (after unfolding).
  useEffect(() => {
    if (focusSearch && !folded) {
      search.current?.focus();
      setFocusSearch(false);
    }
  }, [focusSearch, folded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFolded(false);
        setFocusSearch(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setFolded]);

  const notifications = (
    <Popover
      tone="dark"
      label={t("top.notifications")}
      trigger={<Bell aria-hidden="true" />}
      placement={folded ? "right-end" : "above-start"}
      panelClassName="p-4"
    >
      {() => (
        <>
          <p className="m-0 mb-1 font-semibold">{t("top.notifications")}</p>
          <p className="m-0 text-muted">{t("top.notificationsNone")}</p>
        </>
      )}
    </Popover>
  );

  return (
    <aside
      className={`sticky top-0 z-30 flex h-dvh shrink-0 flex-col bg-ink text-white/75 ${folded ? "w-16" : "w-[220px]"}`}
    >
      <div
        className={`flex h-16 shrink-0 items-center gap-2 ${folded ? "justify-center" : "pr-2 pl-4"}`}
      >
        {folded ? null : (
          <>
            <span
              className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-lime text-sm font-extrabold text-ink"
              aria-hidden="true"
            >
              D
            </span>
            <span className="flex-1 text-lg font-extrabold text-white">{t("brand")}</span>
          </>
        )}
        <button
          type="button"
          aria-expanded={!folded}
          aria-controls={navId}
          aria-label={folded ? t("nav.expand") : t("nav.collapse")}
          onClick={() => setFolded(!folded)}
          className={RAIL_BUTTON}
        >
          {folded ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>

      <div className={`shrink-0 pb-2 ${folded ? "flex justify-center" : "px-3"}`}>
        {folded ? (
          <button
            type="button"
            aria-label={t("search.label")}
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => {
              setFolded(false);
              setFocusSearch(true);
            }}
            className={RAIL_BUTTON}
          >
            <Search aria-hidden="true" />
          </button>
        ) : (
          <MenuSearch inputRef={search} />
        )}
      </div>

      <SideMenu
        id={navId}
        label={t("nav.label")}
        folded={folded}
        className="min-h-0 w-full flex-1 overflow-y-auto py-2"
      >
        {SECTIONS.map((s) => (
          <SideMenuItem
            key={s.key}
            as={Link}
            href={s.href}
            icon={<s.icon />}
            current={current === s.key}
            folded={folded}
            tag={s.built ? undefined : t("nav.soon")}
          >
            {t(`nav.${s.key}`)}
          </SideMenuItem>
        ))}
      </SideMenu>

      <div
        className={`flex shrink-0 gap-1 border-t border-white/10 p-2 ${folded ? "flex-col items-center" : "items-center"}`}
      >
        <div className={folded ? "" : "min-w-0 flex-1"}>
          {email ? (
            <ProfileMenu
              email={email}
              studioName={studioName}
              folded={folded}
              onSignOut={onSignOut}
            />
          ) : null}
        </div>
        {notifications}
      </div>
    </aside>
  );
}
