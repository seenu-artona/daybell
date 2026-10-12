"use client";

import { Button, Card } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

type Action = "finish" | "leave" | "payoutPaid";

/** The fake Stripe's buttons. Each tells Daybell through its real webhook path, then goes back as Stripe would. */
export function FakeStripe({ view }: { view: "onboarding" | "dashboard" }) {
  const t = useTranslations("app.payouts.devStripe");
  const [status, setStatus] = useState("");

  async function act(action: Action) {
    const res = await fetch("/api/dev-stripe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const { returnUrl } = (await res.json()) as { returnUrl: string };
    if (action === "payoutPaid") setStatus(t("paidOut"));
    else window.location.assign(returnUrl);
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-12">
      <h1 className="m-0 text-h1">{view === "dashboard" ? t("dashboardTitle") : t("title")}</h1>
      <p className="m-0 text-muted">{t("intro")}</p>
      <p role="status" className="m-0 empty:sr-only">
        {status}
      </p>
      <Card className="flex flex-wrap gap-3">
        {view === "onboarding" ? (
          <>
            <Button onClick={() => void act("finish")}>{t("finish")}</Button>
            <Button variant="secondary" onClick={() => void act("leave")}>
              {t("leave")}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => void act("payoutPaid")}>{t("payoutPaid")}</Button>
            <Button
              variant="secondary"
              onClick={() => window.location.assign("/app/settings/payouts")}
            >
              {t("back")}
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
