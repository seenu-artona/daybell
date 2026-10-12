"use client";

import {
  PAYOUT_NOT_CONFIGURED,
  PAYOUT_PLATFORM_SETUP,
  type PayoutLinkResponse,
  type StudioPayoutsResponse,
} from "@daybell/api";
import { canSeePayouts } from "@daybell/core";
import { Banner } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { onRestoredFromCache } from "@/lib/page-restored";
import { useStudio } from "../../me-context";
import { FeesCard, PayoutsCard, ScheduleCard, StatusCard, scheduleFormKey } from "./payout-cards";

/**
 * Settings › Payouts (Phase 1 step 7; D56, D98, D106; Seenu, answers 1–4; ADR 0020): connection status, the payout
 * schedule, the next and recent payouts, and the fees explained. The owner sets up payouts on Stripe's own pages and
 * changes the schedule; admins see everything read-only; photographers and staff get a plain refusal (the API answers
 * 403 too). Coming back from Stripe (?stripe=return) checks the status with Stripe at once; an expired link
 * (?stripe=refresh) asks the owner to continue, with no automatic redirect, so focus stays put. Every result is
 * announced in a status region; a new attempt clears the last problem. Coming Back from Stripe (the browser's
 * back-forward cache) resets "Opening Stripe…" so the buttons work again.
 */
export default function PayoutsPage() {
  const t = useTranslations("app.payouts");
  const text = useApiText();
  const { me } = useStudio();
  const role = me.studio.role;
  const allowed = canSeePayouts(role);
  const [data, setData] = useState<StudioPayoutsResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [status, setStatus] = useState("");
  const [linkExpired, setLinkExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const handledReturn = useRef(false);

  const conflictText = useCallback(
    (fields: Record<string, string>, code: string) =>
      fields.form === "payouts.alreadyConnected"
        ? t("conflicts.alreadyConnected")
        : fields.form === "payouts.notConnected"
          ? t("conflicts.notConnected")
          : fields.form === PAYOUT_NOT_CONFIGURED
            ? t("notConfigured")
            : fields.form === PAYOUT_PLATFORM_SETUP
              ? t("platformSetup")
              : text.error(code),
    [t, text],
  );

  const statusWord = useCallback(
    (next: StudioPayoutsResponse) => t(`status.${next.account?.status ?? "notStarted"}`),
    [t],
  );

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    (async () => {
      const res = await api<StudioPayoutsResponse>("/studio/payouts");
      if (cancelled) return;
      if (!res.ok) {
        if (res.code === "region_unavailable") setUnavailable(true);
        else setProblem(text.error(res.code));
        return;
      }
      setData(res.data);
      // Back from Stripe: what Stripe says now, whether or not its webhook has arrived (ADR 0020).
      const back = new URLSearchParams(window.location.search).get("stripe");
      if (!back || handledReturn.current) return;
      handledReturn.current = true;
      window.history.replaceState(null, "", window.location.pathname);
      if (back === "refresh") {
        setLinkExpired(true);
        return;
      }
      if (back === "return" && res.data.account) {
        setStatus(t("checking"));
        const checked = await api<StudioPayoutsResponse>("/studio/payouts/refresh", {
          method: "POST",
        });
        if (cancelled) return;
        if (checked.ok) {
          setData(checked.data);
          setStatus(t("checked", { status: statusWord(checked.data) }));
        } else {
          setStatus("");
          setProblem(conflictText(checked.fields, checked.code));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, text, t, statusWord, conflictText]);

  // Back from Stripe without finishing: the page may be the one left behind, still "Opening Stripe…".
  useEffect(
    () =>
      onRestoredFromCache(window, () => {
        setBusy(false);
        setStatus("");
      }),
    [],
  );

  async function goToStripe(
    path: "/studio/payouts/onboarding-link" | "/studio/payouts/dashboard-link",
  ) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setStatus(t("opening"));
    const res = await api<PayoutLinkResponse>(path, { method: "POST" });
    if (res.ok) {
      // A single-use Stripe address: opened at once, never stored.
      window.location.assign(res.data.url);
      return;
    }
    setBusy(false);
    setStatus("");
    setProblem(conflictText(res.fields, res.code));
  }

  if (!allowed) return <p className="m-0 text-muted">{t("notForRole")}</p>;

  return (
    <div className="flex flex-col gap-6" aria-busy={busy}>
      {/* The section's heading, between Settings (h1) and the cards (h3), so headings don't skip a level. */}
      <h2 className="sr-only">{t("title")}</h2>
      <p className="m-0 text-muted">{t("intro")}</p>
      {/* Always rendered so screen readers announce the text when it appears (WCAG 4.1.3). */}
      <p role="status" aria-live="polite" className="m-0 empty:sr-only">
        {status}
      </p>
      {problem ? <Banner tone="danger" title={problem} /> : null}
      {unavailable ? <Banner tone="info" title={t("unavailable")} /> : null}
      {linkExpired ? <Banner tone="info" title={t("linkExpired")} /> : null}
      {!data && !problem && !unavailable ? <p className="m-0 text-muted">{t("loading")}</p> : null}
      {data ? (
        <>
          <StatusCard data={data} onStripe={goToStripe} />
          <ScheduleCard
            // A new form when Stripe's schedule changes (e.g. the check on coming back), so it never shows a stale one.
            key={scheduleFormKey(data)}
            data={data}
            onSaving={() => setProblem(null)}
            onSaved={(next, summary) => {
              setData(next);
              setProblem(null);
              setStatus(t("schedule.saved", { schedule: summary }));
            }}
            onProblem={(fields, code) => setProblem(conflictText(fields, code))}
          />
          <PayoutsCard data={data} />
          <FeesCard fees={data.fees} />
        </>
      ) : null}
    </div>
  );
}
