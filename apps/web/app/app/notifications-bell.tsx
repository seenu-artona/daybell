"use client";

import type { Notification, NotificationsResponse, UnreadCountResponse } from "@daybell/api";
import { NOTIFICATION_POLL_MS, newNotifications } from "@daybell/core";
import { cn } from "@daybell/ui";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { notificationHref } from "./notification-links";
import { MENU_ROW, Popover } from "./popover";

/**
 * The bell (D143: information only, never tasks; ADR 0021, call 4): the person's unread count on the menu, asked for
 * every minute while the page is visible and again when it comes back into view (no live connection; Claude's call).
 * The button says the count in words ("Notifications, 3 unread") and shows it as a number, never by colour alone; a
 * rise is announced politely, once. The panel lists the 20 latest; each row is one link that marks it read and goes to
 * where it is dealt with. "Mark all as read" keeps focus where it is.
 */
export function NotificationsBell({ folded }: { folded: boolean }) {
  const t = useTranslations("app.top");
  const [unread, setUnread] = useState<number | null>(null);
  const [news, setNews] = useState("");
  const previous = useRef<number | null>(null);

  const setCount = useCallback(
    (count: number, announce: boolean) => {
      const added = announce ? newNotifications(previous.current, count) : null;
      previous.current = count;
      setUnread(count);
      if (added) {
        // Emptied first, so the same words are read out again next time (WCAG 4.1.3).
        setNews("");
        window.setTimeout(() => setNews(t("notificationsNew", { count: added })), 100);
      }
    },
    [t],
  );

  const refresh = useCallback(async () => {
    const res = await api<UnreadCountResponse>("/notifications/unread-count");
    if (res.ok) setCount(res.data.unread, true);
  }, [setCount]);

  useEffect(() => {
    void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(visible, NOTIFICATION_POLL_MS);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);

  const count = unread ?? 0;
  return (
    <>
      <p role="status" className="sr-only">
        {news}
      </p>
      <Popover
        tone="dark"
        label={count > 0 ? t("notificationsUnread", { count }) : t("notifications")}
        trigger={
          <span className="relative grid place-items-center">
            <Bell aria-hidden="true" />
            {count > 0 ? (
              <span className="absolute -top-2 -right-2.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-lime px-1 text-[11px] leading-none font-bold text-ink tabular-nums">
                {count > 99 ? t("unreadMany") : count}
              </span>
            ) : null}
          </span>
        }
        placement={folded ? "right-end" : "above-start"}
        panelClassName="w-80 p-2"
      >
        {(close) => <NotificationsPanel close={close} onUnread={(n) => setCount(n, false)} />}
      </Popover>
    </>
  );
}

function NotificationsPanel({
  close,
  onUnread,
}: {
  close: () => void;
  onUnread: (count: number) => void;
}) {
  const t = useTranslations("app.top");
  const format = useFormatter();
  const [list, setList] = useState<Notification[] | null>(null);
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loaded once each time the panel opens.
  useEffect(() => {
    let live = true;
    api<NotificationsResponse>("/notifications").then((res) => {
      if (!live) return;
      if (res.ok) {
        setList(res.data.notifications);
        onUnread(res.data.unread);
      } else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const words = (n: Notification) => {
    const job = n.job?.name ?? t("aJob");
    switch (n.kind) {
      case "job_selling":
        return t("notificationText.job_selling", { job, from: n.data.from ?? "draft" });
      case "job_closed":
        return t("notificationText.job_closed", {
          job,
          scheduled: n.data.scheduled ? "yes" : "no",
        });
      case "photos_failed":
        return t("notificationText.photos_failed", { job, failed: n.data.failed ?? 0 });
      case "tagging_ready":
        return t("notificationText.tagging_ready", {
          job,
          leftovers: n.data.leftovers ?? 0,
          flagged: n.data.flagged ?? 0,
        });
      default:
        return t(`notificationText.${n.kind}`);
    }
  };

  async function markOne(id: string) {
    setList(
      (rows) =>
        rows?.map((r) => (r.id === id ? { ...r, readAt: new Date().toISOString() } : r)) ?? null,
    );
    const res = await api<UnreadCountResponse>("/notifications/read", { body: { ids: [id] } });
    if (res.ok) onUnread(res.data.unread);
  }

  async function markAll() {
    const res = await api<UnreadCountResponse>("/notifications/read-all", { method: "POST" });
    if (!res.ok) return;
    const now = new Date().toISOString();
    setList((rows) => rows?.map((r) => ({ ...r, readAt: r.readAt ?? now })) ?? null);
    onUnread(res.data.unread);
  }

  // Shown whenever there is a list, so focus stays on it after it is used (nothing unread is harmless).
  const canMarkAll = (list?.length ?? 0) > 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-11 items-center gap-2 px-2">
        <p className="m-0 flex-1 font-semibold">{t("notifications")}</p>
        {canMarkAll ? (
          <button
            type="button"
            onClick={() => void markAll()}
            className="min-h-11 rounded-md px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {t("markAllRead")}
          </button>
        ) : null}
      </div>
      {failed ? (
        <p className="m-0 px-2 pb-2 text-muted">{t("notificationsFailed")}</p>
      ) : !list ? (
        <p className="m-0 px-2 pb-2 text-muted">{t("notificationsLoading")}</p>
      ) : list.length === 0 ? (
        <p className="m-0 px-2 pb-2 text-muted">{t("notificationsNone")}</p>
      ) : (
        <ul
          aria-label={t("notificationsList")}
          className="m-0 flex max-h-96 list-none flex-col overflow-y-auto p-0"
        >
          {list.map((n) => {
            const href = notificationHref(n.kind, n.job?.id ?? null);
            const fresh = !n.readAt;
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${fresh ? "bg-primary" : "bg-transparent"}`}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block ${fresh ? "font-semibold text-ink" : "font-normal text-ink"}`}
                  >
                    {fresh ? <span className="sr-only">{t("unread")}</span> : null}
                    {words(n)}
                  </span>
                  <time
                    dateTime={n.createdAt}
                    className="block text-caption font-normal text-muted"
                  >
                    {format.relativeTime(new Date(n.createdAt))}
                  </time>
                </span>
              </>
            );
            return (
              <li key={n.id}>
                {href ? (
                  <Link
                    href={href}
                    onClick={() => {
                      if (fresh) void markOne(n.id);
                      close();
                    }}
                    className={cn(MENU_ROW, "items-start py-2")}
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-11 items-start gap-3 px-3 py-2 text-sm">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
