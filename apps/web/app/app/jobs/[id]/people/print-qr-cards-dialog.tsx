"use client";

import { type Child, type Group, QR_CARD_HEADERS } from "@daybell/api";
import {
  CARDS_PER_PAGE,
  type CardScope,
  cardChildren,
  type GroupLabel,
  MAX_BLANK_CARDS,
} from "@daybell/core";
import { Banner, Button, Field } from "@daybell/ui";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useMemo, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { download } from "@/lib/client-api";
import { qrCardProblem } from "@/lib/qr-card-messages";
import { CheckboxField, Dialog } from "../../../dialog";

const NO_GROUP = "none";

/** What a print did, from the PDF's response headers: counts only. */
interface Printed {
  cards: number;
  skipped: number;
  replaced: number;
}

const count = (headers: Headers, name: string) => Number(headers.get(name) ?? "0") || 0;

/**
 * "Print QR cards" (D138; Seenu, answer 4): all classes or chosen ones, and how many blank cards. The PDF is made on
 * the server and downloaded; only IDs and the count are sent. Children marked Do not photograph get no card. The
 * counts here come from the loaded roster; the server decides what is printed and says how many in the response.
 */
export function PrintQrCardsDialog({
  open,
  onClose,
  jobId,
  roster,
  groups,
  word,
  onPrinted,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  roster: readonly Child[];
  groups: readonly Group[];
  word: GroupLabel;
  onPrinted: () => void;
}) {
  const t = useTranslations("app.qrCards");
  const tv = useTranslations("validation");
  const text = useApiText();
  const id = useId();
  const [mode, setMode] = useState<"all" | "choose">("all");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [blank, setBlank] = useState("0");
  const [busy, setBusy] = useState(false);
  const [printed, setPrinted] = useState<Printed | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const blankCards = /^\d+$/.test(blank.trim()) ? Number(blank.trim()) : Number.NaN;
  const blankValid =
    Number.isInteger(blankCards) && blankCards >= 0 && blankCards <= MAX_BLANK_CARDS;
  const scope: CardScope =
    mode === "all"
      ? { kind: "job" }
      : {
          kind: "groups",
          groupIds: [...chosen].filter((g) => g !== NO_GROUP),
          noGroup: chosen.has(NO_GROUP),
        };
  const children = cardChildren(roster, scope).length;
  const cards = children + (blankValid ? blankCards : 0);
  // Each sheet prints double-sided: a front page and a back page.
  const sheets = Math.ceil(cards / CARDS_PER_PAGE);

  const perGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cardChildren(roster, { kind: "job" })) {
      const key = c.group?.id ?? NO_GROUP;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [roster]);
  const withoutGroup = perGroup.get(NO_GROUP) ?? 0;

  function toggle(key: string, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /** Closes and forgets the last result, from the header's X, Escape and the footer's Close alike. */
  function close() {
    setProblem(null);
    setPrinted(null);
    setFields({});
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // aria-disabled keeps focus on the button while the PDF is made; this stops a second print meanwhile.
    if (busy) return;
    setProblem(null);
    setPrinted(null);
    const errors: Record<string, string> = {};
    if (!blankValid) errors.blankCards = tv("blankCards");
    if (mode === "choose" && chosen.size === 0) errors.groupIds = tv("qrCardsGroups");
    setFields(errors);
    if (Object.keys(errors).length > 0) return;
    if (cards === 0) return setProblem(t("nothing"));
    setBusy(true);
    const res = await download(`/jobs/${encodeURIComponent(jobId)}/qr-cards`, {
      ...(mode === "choose" ? { groupIds: [...chosen] } : {}),
      blankCards,
    });
    setBusy(false);
    if (res.ok) {
      setPrinted({
        cards: count(res.headers, QR_CARD_HEADERS.cards),
        skipped: count(res.headers, QR_CARD_HEADERS.skipped),
        replaced: count(res.headers, QR_CARD_HEADERS.replaced),
      });
      onPrinted();
      return;
    }
    const { form: _reason, ...inputs } = res.fields;
    if (Object.keys(inputs).length > 0)
      setFields(
        Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, text.field(v) ?? ""])),
      );
    const why = qrCardProblem(res);
    setProblem(
      why?.key === "skipped"
        ? t("skipped", { count: why.count })
        : why
          ? t(why.key)
          : text.error(res.code),
    );
  }

  const radio = (value: "all" | "choose", label: string) => (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm text-ink">
      <input
        type="radio"
        name={`${id}-which`}
        checked={mode === value}
        onChange={() => setMode(value)}
        className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
      {label}
    </label>
  );

  return (
    <Dialog open={open} onClose={close} title={t("title")}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-5">
        {problem ? <Banner tone="danger" title={problem} /> : null}

        <fieldset className="m-0 flex flex-col border-0 p-0">
          <legend className="mb-1 p-0 text-label text-ink">{t("which")}</legend>
          {radio("all", t("allGroups", { group: word }))}
          {radio("choose", t("chooseGroups", { group: word }))}
        </fieldset>

        {mode === "choose" ? (
          <fieldset
            className="m-0 flex max-h-60 flex-col overflow-y-auto border-0 py-0 pr-0 pl-8"
            aria-describedby={fields.groupIds ? `${id}-groups-note` : undefined}
          >
            <legend className="sr-only">{t("groupsLegend", { group: word })}</legend>
            {groups.map((g) => (
              <CheckboxField
                key={g.id}
                label={t("groupOption", { name: g.name, count: perGroup.get(g.id) ?? 0 })}
                checked={chosen.has(g.id)}
                onChange={(on) => toggle(g.id, on)}
              />
            ))}
            {withoutGroup > 0 ? (
              <CheckboxField
                label={t("noGroupOption", { group: word, count: withoutGroup })}
                checked={chosen.has(NO_GROUP)}
                onChange={(on) => toggle(NO_GROUP, on)}
              />
            ) : null}
            {fields.groupIds ? (
              <span id={`${id}-groups-note`} className="text-caption text-danger">
                {fields.groupIds}
              </span>
            ) : null}
          </fieldset>
        ) : null}

        <Field
          label={t("blankCards")}
          help={t("blankCardsHelp", { max: MAX_BLANK_CARDS })}
          error={fields.blankCards}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_BLANK_CARDS}
          step={1}
          value={blank}
          onChange={(e) => setBlank(e.target.value)}
          className="max-w-48"
        />

        <div className="flex flex-col gap-1">
          <p className="m-0 font-semibold text-ink">{t("summary", { cards, sheets })}</p>
          <p className="m-0 text-caption text-muted">{t("dnpNote")}</p>
        </div>

        {/* Always rendered so screen readers announce the result when it appears (WCAG 4.1.3); while empty, the
        negative margin cancels the form's gap. */}
        <div role="status" className="flex flex-col gap-2 empty:-mb-5">
          {printed ? (
            <p className="m-0 font-semibold">{t("done", { count: printed.cards })}</p>
          ) : null}
          {printed && printed.skipped > 0 ? (
            <Banner tone="warning" title={t("skipped", { count: printed.skipped })} />
          ) : null}
          {printed && printed.replaced > 0 ? (
            <Banner tone="warning" title={t("replaced", { count: printed.replaced })} />
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* The cards' backs line up only when printed this way (Seenu, Oct 13, 2026). */}
          <p id={`${id}-duplex`} className="m-0 text-sm font-semibold text-ink">
            {t("duplex")}
          </p>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={close}>
              {t("close")}
            </Button>
            <Button
              type="submit"
              aria-describedby={`${id}-duplex`}
              aria-disabled={busy || undefined}
              className="aria-disabled:opacity-60"
            >
              <Download aria-hidden="true" />
              {busy ? t("preparing") : t("download")}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
