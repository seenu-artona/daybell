"use client";

import {
  PAYOUT_CONFLICTS,
  PAYOUT_NOT_CONFIGURED,
  PAYOUT_PLATFORM_SETUP,
  type PayoutFees,
  type PayoutScheduleResponse,
  type StudioPayoutsResponse,
} from "@daybell/api";
import {
  DEFAULT_MONTHLY_ANCHOR,
  DEFAULT_WEEKLY_ANCHOR,
  formatBasisPoints,
  formatMoney,
  localeForCurrency,
  type Money,
  PAYOUT_INTERVAL_CHOICES,
  PAYOUT_WEEKDAY_CHOICES,
  type PayoutAccountStatus,
  type PayoutIntervalChoice,
  type PayoutWeekdayChoice,
} from "@daybell/core";
import {
  Badge,
  type BadgeProps,
  Button,
  Card,
  CardTitle,
  Table,
  TableCell,
  TableHead,
  TableRow,
} from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { api } from "@/lib/client-api";
import { useFormatDay } from "../../jobs/status-badge";

const SELECT =
  "min-h-11 rounded-md border border-line-strong bg-surface px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** The word is always shown; the tone only supports it (D91). */
const TONE: Record<PayoutAccountStatus | "notStarted", BadgeProps["tone"]> = {
  notStarted: "draft",
  needs_info: "warning",
  pending_verification: "info",
  active: "selling",
  restricted: "danger",
};

const money = (m: Money) => formatMoney(m, localeForCurrency(m.currency));

/** The schedule in words, e.g. "Weekly, every Friday". */
function useScheduleText() {
  const t = useTranslations("app.payouts.schedule");
  return (s: PayoutScheduleResponse) =>
    s.interval === "weekly"
      ? t("summary.weekly", { day: t(`days.${s.weeklyAnchor ?? "friday"}`) })
      : s.interval === "monthly"
        ? t("summary.monthly", { day: s.monthlyAnchor ?? DEFAULT_MONTHLY_ANCHOR })
        : t(`summary.${s.interval}`);
}

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <Card asChild className="flex flex-col gap-3">
      <section aria-labelledby={id}>
        <CardTitle id={id}>{title}</CardTitle>
        {children}
      </section>
    </Card>
  );
}

/**
 * The app.payouts message for a payout error's form code, or null for the general error text (code review N5): already
 * connected, not connected, not set up in this environment, and Daybell's Stripe platform setup not finished.
 */
export function payoutProblemKey(
  fields: Record<string, string>,
):
  | "conflicts.alreadyConnected"
  | "conflicts.notConnected"
  | "notConfigured"
  | "platformSetup"
  | null {
  switch (fields.form) {
    case PAYOUT_CONFLICTS.alreadyConnected:
      return "conflicts.alreadyConnected";
    case PAYOUT_CONFLICTS.notConnected:
      return "conflicts.notConnected";
    case PAYOUT_NOT_CONFIGURED:
      return "notConfigured";
    case PAYOUT_PLATFORM_SETUP:
      return "platformSetup";
    default:
      return null;
  }
}

type StripePath = "/studio/payouts/onboarding-link" | "/studio/payouts/dashboard-link";

/** The schedule form's identity: a different schedule from Stripe gives a new form with its values (code review N5). */
export function scheduleFormKey(data: StudioPayoutsResponse): string {
  const s = data.account?.schedule;
  return s ? `${s.interval}:${s.weeklyAnchor ?? ""}:${s.monthlyAnchor ?? ""}` : "none";
}

/** Connection: Seenu's five states in words, what they mean, and (owner only) the way to Stripe. */
export function StatusCard({
  data,
  onStripe,
}: {
  data: StudioPayoutsResponse;
  onStripe: (path: StripePath) => void;
}) {
  const t = useTranslations("app.payouts");
  const formatDay = useFormatDay();
  const ids = { go: useId(), manage: useId() };
  const account = data.account;
  const state = account?.status ?? "notStarted";
  const action =
    state === "notStarted"
      ? "start"
      : state === "needs_info"
        ? "continue"
        : state === "restricted"
          ? "update"
          : null;
  return (
    <CardSection title={t("status.title")}>
      <p className="m-0">
        <Badge tone={TONE[state]}>{t(`status.${state}`)}</Badge>
      </p>
      <p className="m-0">
        {state === "needs_info"
          ? t("explain.needs_info", { count: account?.currentlyDue ?? 0 })
          : t(`explain.${state}`)}
      </p>
      {account?.deadline && (state === "needs_info" || state === "restricted") ? (
        <p className="m-0">
          {/* Admins can't add anything themselves (Seenu, answer 1): they're told the owner needs to. */}
          {t(data.canManage ? "explain.deadline" : "explain.deadlineOwner", {
            date: formatDay(account.deadline.slice(0, 10)),
          })}
        </p>
      ) : null}
      {data.canManage ? (
        <div className="flex flex-col gap-3">
          {action ? (
            <div className="flex flex-col items-start gap-1">
              <Button
                aria-describedby={ids.go}
                onClick={() => onStripe("/studio/payouts/onboarding-link")}
              >
                {t(`actions.${action}`)}
              </Button>
              <p id={ids.go} className="m-0 text-caption text-muted">
                {t("goToStripe")}
              </p>
            </div>
          ) : null}
          {account?.detailsSubmitted ? (
            <div className="flex flex-col items-start gap-1">
              <Button
                variant="secondary"
                aria-describedby={ids.manage}
                onClick={() => onStripe("/studio/payouts/dashboard-link")}
              >
                {t("actions.manage")}
              </Button>
              <p id={ids.manage} className="m-0 text-caption text-muted">
                {t("actions.manageHelp")}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="m-0 text-caption text-muted">{t("ownerOnly")}</p>
      )}
    </CardSection>
  );
}

/** Weekly on a weekday (Friday by default), daily, or monthly on a date (the 1st by default); Seenu, answer 3 and Q6. */
export function ScheduleCard({
  data,
  onSaving,
  onSaved,
  onProblem,
}: {
  data: StudioPayoutsResponse;
  /** A save starts: the page clears the last problem. */
  onSaving: () => void;
  onSaved: (next: StudioPayoutsResponse, summary: string) => void;
  onProblem: (fields: Record<string, string>, code: string) => void;
}) {
  const t = useTranslations("app.payouts.schedule");
  const summary = useScheduleText();
  const schedule = data.account?.schedule ?? null;
  const [interval, setInterval] = useState<PayoutIntervalChoice>(
    schedule && schedule.interval !== "manual" ? schedule.interval : "weekly",
  );
  const [weekday, setWeekday] = useState<PayoutWeekdayChoice>(
    (PAYOUT_WEEKDAY_CHOICES as readonly string[]).includes(schedule?.weeklyAnchor ?? "")
      ? (schedule?.weeklyAnchor as PayoutWeekdayChoice)
      : DEFAULT_WEEKLY_ANCHOR,
  );
  const [monthDay, setMonthDay] = useState(schedule?.monthlyAnchor ?? DEFAULT_MONTHLY_ANCHOR);
  const [saving, setSaving] = useState(false);
  const ids = { weekday: useId(), monthDay: useId(), help: useId() };

  async function save(e: FormEvent) {
    e.preventDefault();
    // Nothing is disabled while saving (focus stays put, WCAG 2.4.3); repeated submits are ignored instead.
    if (saving) return;
    setSaving(true);
    onSaving();
    const body =
      interval === "weekly"
        ? { interval, weeklyAnchor: weekday }
        : interval === "monthly"
          ? { interval, monthlyAnchor: monthDay }
          : { interval };
    const res = await api<StudioPayoutsResponse>("/studio/payouts/schedule", {
      method: "PUT",
      body,
    });
    setSaving(false);
    if (!res.ok) return onProblem(res.fields, res.code);
    onSaved(res.data, res.data.account ? summary(res.data.account.schedule) : "");
  }

  if (!schedule)
    return (
      <CardSection title={t("title")}>
        <p className="m-0 text-muted">{t("notYet")}</p>
      </CardSection>
    );

  if (!data.canManage)
    return (
      <CardSection title={t("title")}>
        <p className="m-0">{summary(schedule)}</p>
        <p className="m-0 text-caption text-muted">{t("readOnly")}</p>
      </CardSection>
    );

  return (
    <CardSection title={t("title")}>
      {schedule.interval === "manual" ? <p className="m-0">{summary(schedule)}</p> : null}
      <form onSubmit={save} className="flex flex-col gap-4" aria-busy={saving}>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-label">{t("legend")}</legend>
          {PAYOUT_INTERVAL_CHOICES.map((choice) => (
            <label
              key={choice}
              className="flex min-h-11 cursor-pointer items-center gap-3 self-start"
            >
              <input
                type="radio"
                name="payout-interval"
                value={choice}
                checked={interval === choice}
                onChange={() => setInterval(choice)}
                className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
              {t(choice)}
            </label>
          ))}
        </fieldset>
        {interval === "weekly" ? (
          <div className="flex flex-col gap-1.5 self-start">
            <label htmlFor={ids.weekday} className="text-label">
              {t("weekday")}
            </label>
            <select
              id={ids.weekday}
              value={weekday}
              onChange={(e) => setWeekday(e.target.value as PayoutWeekdayChoice)}
              className={SELECT}
            >
              {PAYOUT_WEEKDAY_CHOICES.map((day) => (
                <option key={day} value={day}>
                  {t(`days.${day}`)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {interval === "monthly" ? (
          <div className="flex flex-col gap-1.5 self-start">
            <label htmlFor={ids.monthDay} className="text-label">
              {t("monthDay")}
            </label>
            <select
              id={ids.monthDay}
              value={monthDay}
              aria-describedby={ids.help}
              onChange={(e) => setMonthDay(Number(e.target.value))}
              className={SELECT}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
            <p id={ids.help} className="m-0 text-caption text-muted">
              {t("monthDayHelp")}
            </p>
          </div>
        ) : null}
        <p className="m-0 text-caption text-muted">{t("delay")}</p>
        <Button type="submit" className="self-start">
          {t("save")}
        </Button>
      </form>
    </CardSection>
  );
}

/** Next payout (the schedule's day and any payout on its way; Claude's call Q9) and the 10 latest payouts. */
export function PayoutsCard({ data }: { data: StudioPayoutsResponse }) {
  const t = useTranslations("app.payouts");
  const formatDay = useFormatDay();
  const account = data.account;
  const onTheirWay = data.payouts.filter(
    (p) => p.status === "pending" || p.status === "in_transit",
  );
  const next = !account?.payoutsEnabled
    ? t("next.notActive")
    : account.schedule.interval === "manual"
      ? t("next.manual")
      : account.schedule.interval === "daily"
        ? t("next.daily")
        : data.nextPayoutDate
          ? t("next.date", { date: formatDay(data.nextPayoutDate) })
          : t("next.notActive");
  return (
    <>
      <CardSection title={t("next.title")}>
        <p className="m-0">{next}</p>
        {onTheirWay.map((p) => (
          <p key={p.id} className="m-0">
            {t("next.onItsWay", { amount: money(p.amount), date: formatDay(p.arrivalDate) })}
          </p>
        ))}
      </CardSection>
      <CardSection title={t("recent.title")}>
        {data.payouts.length === 0 ? (
          <p className="m-0 text-muted">{t("recent.empty")}</p>
        ) : (
          <Table>
            <caption className="sr-only">{t("recent.caption")}</caption>
            <thead>
              <TableRow>
                <TableHead>{t("recent.columns.arrival")}</TableHead>
                <TableHead numeric>{t("recent.columns.amount")}</TableHead>
                <TableHead>{t("recent.columns.status")}</TableHead>
                <TableHead>{t("recent.columns.method")}</TableHead>
              </TableRow>
            </thead>
            <tbody>
              {data.payouts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{formatDay(p.arrivalDate)}</TableCell>
                  <TableCell numeric>{money(p.amount)}</TableCell>
                  <TableCell>{t(`recent.statuses.${p.status}`)}</TableCell>
                  <TableCell>{t(`recent.methods.${p.method}`)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </CardSection>
    </>
  );
}

/** What selling costs (D59, D98; Claude's call Q8): Daybell's 3%, and Stripe's card and payout fees passed on. */
export function FeesCard({ fees }: { fees: PayoutFees }) {
  const t = useTranslations("app.payouts.fees");
  return (
    <CardSection title={t("title")}>
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
        <li>{t("daybell", { percent: formatBasisPoints(fees.daybellBasisPoints) })}</li>
        <li>
          {t("card", {
            percent: formatBasisPoints(fees.card.basisPoints),
            fixed: money(fees.card.fixed),
          })}
        </li>
        <li>
          {t("payout", {
            percent: formatBasisPoints(fees.payout.basisPoints),
            fixed: money(fees.payout.fixed),
            monthly: money(fees.activeAccount),
          })}
        </li>
        <li>{t("instant", { percent: formatBasisPoints(fees.instantBasisPoints) })}</li>
      </ul>
    </CardSection>
  );
}
