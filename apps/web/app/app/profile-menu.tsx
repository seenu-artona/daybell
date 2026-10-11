"use client";

import { CircleHelp, ExternalLink, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { initialsFromEmail } from "./initials";
import { MENU_ROW, Popover } from "./popover";

/**
 * The menu's profile button (D137): avatar initials, the person's email (Daybell stores no names yet, Q1) and the
 * studio name. Its menu keeps the old top bar's actions: Settings, View my shop, Help and Sign out.
 */
export function ProfileMenu({
  email,
  studioName,
  folded,
  onSignOut,
}: {
  email: string;
  studioName: string;
  folded: boolean;
  onSignOut: () => void;
}) {
  const t = useTranslations("app");
  const avatar = (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-full bg-lime text-caption font-bold text-ink"
      aria-hidden="true"
    >
      {initialsFromEmail(email)}
    </span>
  );
  return (
    <Popover
      tone="dark"
      placement={folded ? "right-end" : "above-start"}
      {...(folded ? { label: t("top.account") } : {})}
      triggerClassName={folded ? "w-11" : "w-full justify-start px-2 text-left"}
      trigger={
        folded ? (
          avatar
        ) : (
          <>
            {avatar}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label text-white">{email}</span>
              <span className="block truncate text-caption text-white/60">{studioName}</span>
            </span>
          </>
        )
      }
    >
      {(close) => (
        <div className="flex flex-col">
          <p className="m-0 px-3 pt-1 pb-2 text-caption text-muted">
            {t("top.signedInAs")} <span className="font-semibold break-all text-ink">{email}</span>
          </p>
          <Link href="/app/settings" onClick={close} className={MENU_ROW}>
            <Settings aria-hidden="true" />
            {t("nav.settings")}
          </Link>
          <Link href="/app/shop" onClick={close} className={MENU_ROW}>
            <ExternalLink aria-hidden="true" />
            {t("top.viewShop")}
          </Link>
          <Link href="/app/help" onClick={close} className={MENU_ROW}>
            <CircleHelp aria-hidden="true" />
            {t("nav.help")}
          </Link>
          <button
            type="button"
            onClick={() => {
              close();
              onSignOut();
            }}
            className={MENU_ROW}
          >
            <LogOut aria-hidden="true" />
            {t("signOut")}
          </button>
        </div>
      )}
    </Popover>
  );
}
