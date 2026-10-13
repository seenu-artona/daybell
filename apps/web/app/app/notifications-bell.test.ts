import { NOTIFICATION_KINDS } from "@daybell/core";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import enCA from "@/messages/en-CA.json";
import messages from "@/messages/en-US.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/app" }));
const { NotificationsBell } = await import("./notifications-bell");

// The bell (ADR 0021, call 4; D91): its name says the count in words, a rise is announced in a polite live region that
// exists (empty) from the start, and every kind has whole-sentence words with the job's name put in at read time.
const t = createTranslator({ locale: "en-US", messages, namespace: "app.top" });

describe("the bell's words", () => {
  it("names the button with the count, never by colour alone", () => {
    expect(t("notificationsUnread", { count: 3 })).toBe("Notifications, 3 unread");
    expect(t("notificationsUnread", { count: 1 })).toBe("Notifications, 1 unread");
    expect(t("notifications")).toBe("Notifications");
  });

  it("announces new ones in words", () => {
    expect(t("notificationsNew", { count: 1 })).toBe("1 new notification");
    expect(t("notificationsNew", { count: 4 })).toBe("4 new notifications");
  });

  it("has a sentence for every kind, the same in both locales", () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(messages.app.top.notificationText).toHaveProperty(kind);
      expect(enCA.app.top.notificationText[kind]).toBe(messages.app.top.notificationText[kind]);
    }
    expect(t("notificationText.job_selling", { job: "Fall", from: "draft" })).toBe(
      "Fall is live: parents can order now",
    );
    expect(t("notificationText.job_selling", { job: "Fall", from: "closed" })).toBe(
      "Fall is selling again",
    );
    expect(t("notificationText.job_closed", { job: "Fall", scheduled: "yes" })).toBe(
      "Fall closed on its closing date",
    );
    expect(t("notificationText.photos_failed", { job: "Fall", failed: 2 })).toBe(
      "Fall: 2 photos couldn’t be processed",
    );
    expect(t("notificationText.tagging_ready", { job: "Fall", leftovers: 3, flagged: 1 })).toBe(
      "Fall: photos are tagged, with 3 in Leftovers and 1 to check",
    );
    // Orders (ADR 0024): the reference, never a name or an amount.
    expect(t("notificationText.order_paid", { order: "7KQ2-M9XA" })).toBe("New order 7KQ2-M9XA");
    expect(t("notificationText.refund_failed", { order: "7KQ2-M9XA" })).toBe(
      "A refund of order 7KQ2-M9XA failed: the parent wasn’t refunded",
    );
    expect(t("notificationText.dispute_opened", { order: "7KQ2-M9XA" })).toBe(
      "A dispute was opened on order 7KQ2-M9XA",
    );
  });
});

describe("NotificationsBell", () => {
  it("renders a named button and an empty polite live region before the count arrives", () => {
    const html = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale: "en-US", messages, timeZone: "UTC" } as ComponentProps<
          typeof NextIntlClientProvider
        >,
        createElement(NotificationsBell, { folded: false }),
      ),
    );
    expect(html).toContain('<p role="status" class="sr-only"></p>');
    expect(html).toMatch(/<button[^>]*aria-label="Notifications"/);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"/);
    // No badge until there is something unread.
    expect(html).not.toContain("bg-lime");
  });
});
