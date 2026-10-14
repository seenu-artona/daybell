"use client";

import { fieldErrors, type RosterImportResponse, type RosterRow, rosterRow } from "@daybell/api";
import {
  buildRows,
  groupLabel,
  guessColumns,
  ROSTER_TARGETS,
  type RosterTarget,
} from "@daybell/core";
import { Badge, Banner, Button, Table, TableCell, TableHead, TableRow } from "@daybell/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ChangeEvent, useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import {
  ROSTER_FILE_ACCEPT,
  RosterFileError,
  type RosterSheet,
  type RosterTable,
  readRosterFile,
  toTable,
} from "@/lib/roster-file";
import { SelectField } from "../../../dialog";
import { useJob } from "../job-context";
import { tabHref } from "../tabs";

type Step = "file" | "columns" | "check";
const STEPS: Step[] = ["file", "columns", "check"];
type Mapping = Record<number, RosterTarget | null>;
type RowFilter = "all" | "duplicates" | "invalid";

/** One file row on the check screen: valid rows go to the API; invalid ones show why and are left out. */
interface CheckedRow {
  line: number;
  draft: ReturnType<typeof buildRows>[number];
  valid: RosterRow | null;
  reason: string | null;
  /** From the server's dry run, for valid rows. */
  action: "add" | "update" | null;
  duplicate: boolean;
}

const PAGE = 100;
/** The import is a full page in the job's main area: one white sheet card on the canvas (D140). */
const PAGE_FRAME = "flex flex-col gap-6 rounded-list bg-surface px-7 pt-4 pb-10 shadow-card";

/**
 * Import a roster from CSV or Excel (Phase 1 step 2, D23, F13; ADR 0011). The file is read in this browser and never
 * uploaded or stored (D113): choose a file, confirm the guessed columns, check the rows (a dry run on the server
 * plans adds, updates by student ID and duplicates), then import them all in one go. A full page inside the job's
 * frame, part of Subjects (D138, D144); the job comes from the job layout.
 */
export default function ImportRosterPage() {
  const t = useTranslations("app.roster.importPage");
  const tr = useTranslations("app.roster");
  const tv = useApiText();
  const router = useRouter();
  const { job, canEditRoster: canEdit, refreshSummary } = useJob();
  const id = job.id;
  const fileId = useId();
  const [step, setStep] = useState<Step>("file");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheets, setSheets] = useState<RosterSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [table, setTable] = useState<RosterTable | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [columnsError, setColumnsError] = useState<string | null>(null);
  const [checked, setChecked] = useState<CheckedRow[]>([]);
  const [plan, setPlan] = useState<RosterImportResponse | null>(null);
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [shown, setShown] = useState(PAGE);

  const word = groupLabel(job.type);
  const targetLabel = (target: RosterTarget | null) =>
    target ? t(`targets.${target}`, { group: word }) : t("targets.skip", { group: word });

  function openSheet(all: RosterSheet[], index: number) {
    const sheet = all[index];
    if (!sheet) return;
    try {
      const next = toTable(sheet.cells);
      setTable(next);
      setMapping(guessColumns(next.headers));
      setColumnsError(null);
      setProblem(null);
      setStep("columns");
    } catch (err) {
      setTable(null);
      setProblem(t(err instanceof RosterFileError ? err.problem : "unreadable"));
    }
  }

  async function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const all = await readRosterFile(file);
      setSheets(all);
      setSheetIndex(0);
      openSheet(all, 0);
    } catch (err) {
      setProblem(t(err instanceof RosterFileError ? err.problem : "unreadable"));
    } finally {
      setBusy(false);
      // Choosing the same file again should read it again.
      e.target.value = "";
    }
  }

  function setTarget(column: number, target: RosterTarget | null) {
    setColumnsError(null);
    setMapping((current) => {
      const next: Mapping = { ...current };
      // One column per kind of information: picking a target takes it from any other column.
      if (target)
        for (const [i, tg] of Object.entries(next)) if (tg === target) next[Number(i)] = null;
      next[column] = target;
      return next;
    });
  }

  async function dryRun(rows: CheckedRow[]) {
    const valid = rows.filter((r) => r.valid);
    if (valid.length === 0) {
      setChecked(rows);
      setPlan(null);
      return true;
    }
    const res = await api<RosterImportResponse>(`/jobs/${id}/children/import`, {
      body: { rows: valid.map((r) => r.valid), dryRun: true },
    });
    if (!res.ok) {
      setProblem(tv.error(res.code));
      return false;
    }
    let i = 0;
    setChecked(
      rows.map((r) => {
        if (!r.valid) return r;
        const planned = res.data.rows[i++];
        return { ...r, action: planned?.action ?? "add", duplicate: planned?.duplicate ?? false };
      }),
    );
    setPlan(res.data);
    return true;
  }

  async function checkRows() {
    if (!table) return;
    const used = Object.values(mapping).filter(Boolean);
    if (!used.includes("firstName") || !used.includes("lastName")) {
      setColumnsError(t("needNames"));
      return;
    }
    if (new Set(used).size !== used.length) {
      setColumnsError(t("usedTwice"));
      return;
    }
    setBusy(true);
    setProblem(null);
    setNotice(null);
    const rows: CheckedRow[] = buildRows(table.rows, mapping).map((draft, i) => {
      const result = rosterRow.safeParse(draft);
      const firstError = result.success ? null : Object.values(fieldErrors(result.error))[0];
      return {
        line: table.lines[i] ?? i + 2,
        draft,
        valid: result.success ? result.data : null,
        reason: result.success ? null : (tv.field(firstError ?? undefined) ?? null),
        action: null,
        duplicate: false,
      };
    });
    const ok = await dryRun(rows);
    setBusy(false);
    if (ok) {
      setRowFilter("all");
      setShown(PAGE);
      setStep("check");
    }
  }

  async function importRows() {
    const valid = checked.filter((r) => r.valid).map((r) => r.valid);
    setBusy(true);
    setProblem(null);
    setNotice(null);
    const res = await api<RosterImportResponse>(`/jobs/${id}/children/import`, {
      body: { rows: valid, dryRun: false },
    });
    if (res.ok) {
      // Only numbers go in the URL.
      refreshSummary();
      router.push(`${tabHref(id, "people")}?imported=${res.data.added}.${res.data.updated}`);
      return;
    }
    if (res.code === "conflict") {
      // The roster changed meanwhile: check the rows again and show the new plan.
      await dryRun(checked.map((r) => ({ ...r, action: null, duplicate: false })));
      setNotice(t("changed"));
    } else {
      setProblem(tv.error(res.code));
    }
    setBusy(false);
  }

  const back = (
    <Link
      href={tabHref(id, "people")}
      className="inline-flex min-h-11 items-center gap-2 self-start font-semibold text-primary no-underline hover:underline focus-visible:outline-2 focus-visible:outline-primary"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {t("back")}
    </Link>
  );

  if (!canEdit) {
    return (
      <div className={PAGE_FRAME}>
        {back}
        <h2 className="m-0 text-h2">{t("title")}</h2>
        <Banner tone="info" title={t("staffOnly")} />
      </div>
    );
  }

  const invalidCount = checked.filter((r) => !r.valid).length;
  const validCount = checked.length - invalidCount;
  const visible = checked.filter((r) =>
    rowFilter === "duplicates" ? r.duplicate : rowFilter === "invalid" ? !r.valid : true,
  );

  return (
    <div className={PAGE_FRAME}>
      {back}
      <h2 className="m-0 text-h2">{t("title")}</h2>
      <ol
        aria-label={t("stepsLabel")}
        className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-sm"
      >
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? "step" : undefined}
            className={`flex items-center gap-2 ${s === step ? "font-semibold text-ink" : "text-muted"}`}
          >
            <span
              className={`grid size-6 place-items-center rounded-full text-caption ${s === step ? "bg-primary text-on-primary" : "bg-subtle"}`}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      {problem ? <Banner tone="danger" title={problem} /> : null}
      {notice ? <Banner tone="warning" title={notice} /> : null}

      {step === "file" ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={fileId} className="text-label text-ink">
              {t("fileLabel")}
            </label>
            <input
              id={fileId}
              type="file"
              accept={ROSTER_FILE_ACCEPT}
              onChange={chooseFile}
              disabled={busy}
              className="min-h-11 text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-md file:border file:border-line-strong file:bg-surface file:px-4 file:font-semibold file:text-ink focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>
          <p className="m-0 text-muted">{t("fileNote")}</p>
          {busy ? <p className="m-0 text-muted">{t("reading")}</p> : null}
        </section>
      ) : null}

      {step === "columns" && table ? (
        <section className="flex flex-col gap-5">
          {sheets.length > 1 ? (
            <div className="max-w-80">
              <SelectField
                label={t("sheet")}
                value={String(sheetIndex)}
                onChange={(v) => {
                  setSheetIndex(Number(v));
                  openSheet(sheets, Number(v));
                }}
                options={sheets.map((s, i) => ({ value: String(i), label: s.name }))}
              />
            </div>
          ) : null}
          <p className="m-0 text-muted">{t("columnsIntro")}</p>
          <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {table.headers.map((header, column) => {
              const title = header || t("column", { n: column + 1 });
              const samples = table.rows
                .map((r) => r[column] ?? "")
                .filter(Boolean)
                .slice(0, 3);
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are fixed for a file.
                  key={column}
                  className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
                >
                  <p className="m-0 font-semibold break-words">{title}</p>
                  <div>
                    <p className="m-0 text-caption text-muted">{t("sample")}</p>
                    <p className="m-0 truncate text-sm">
                      {samples.length ? samples.join(" · ") : t("noSample")}
                    </p>
                  </div>
                  <SelectField
                    label={t("importAs", { column: title })}
                    value={mapping[column] ?? ""}
                    onChange={(v) => setTarget(column, (v || null) as RosterTarget | null)}
                    options={[
                      { value: "", label: targetLabel(null) },
                      ...ROSTER_TARGETS.map((target) => ({
                        value: target,
                        label: targetLabel(target),
                      })),
                    ]}
                  />
                </li>
              );
            })}
          </ul>
          {columnsError ? <Banner tone="danger" title={columnsError} /> : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setStep("file");
                setProblem(null);
              }}
            >
              {t("backStep")}
            </Button>
            <Button onClick={checkRows} disabled={busy}>
              {busy ? t("checking") : t("checkRows")}
            </Button>
          </div>
        </section>
      ) : null}

      {step === "check" ? (
        <section className="flex flex-col gap-5">
          <p className="m-0 flex flex-wrap gap-x-2 font-semibold">
            {[
              t("summary.add", { count: plan?.added ?? 0 }),
              t("summary.update", { count: plan?.updated ?? 0 }),
              t("summary.groups", { count: plan?.groupsAdded ?? 0, group: word }),
              t("summary.duplicates", { count: plan?.duplicates ?? 0 }),
              t("summary.invalid", { count: invalidCount }),
            ].join(" · ")}
          </p>
          {validCount === 0 ? <Banner tone="warning" title={t("nothingToImport")} /> : null}

          <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
            <legend className="sr-only">{t("filterLabel")}</legend>
            {(["all", "duplicates", "invalid"] as const).map((f) => (
              <label
                key={f}
                className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${rowFilter === f ? "border-primary bg-primary-soft text-primary-hover" : "border-line-strong bg-surface text-ink"}`}
              >
                <input
                  type="radio"
                  name="row-filter"
                  value={f}
                  checked={rowFilter === f}
                  onChange={() => {
                    setRowFilter(f);
                    setShown(PAGE);
                  }}
                  className="sr-only"
                />
                {t(`filter.${f}`)}
              </label>
            ))}
          </fieldset>

          {visible.length === 0 ? (
            <p className="m-0 text-muted">{t("noRows")}</p>
          ) : (
            <Table>
              <thead>
                <TableRow>
                  <TableHead numeric>{t("columns.row")}</TableHead>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.group", { group: word })}</TableHead>
                  <TableHead>{t("columns.studentId")}</TableHead>
                  <TableHead>{t("columns.grade")}</TableHead>
                  <TableHead>{t("columns.parentEmail")}</TableHead>
                  <TableHead>{t("columns.flags")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                </TableRow>
              </thead>
              <tbody>
                {visible.slice(0, shown).map((r) => (
                  <TableRow key={r.line}>
                    <TableCell numeric>{r.line}</TableCell>
                    <TableCell className="font-semibold">
                      {`${r.draft.firstName} ${r.draft.lastName}`.trim()}
                    </TableCell>
                    <TableCell>{r.draft.group ?? ""}</TableCell>
                    <TableCell>{r.draft.studentId ?? ""}</TableCell>
                    <TableCell>{r.draft.grade ?? ""}</TableCell>
                    <TableCell>{r.draft.parentEmail ?? ""}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1.5">
                        {r.duplicate ? (
                          <Badge tone="warning">{tr("badges.duplicate")}</Badge>
                        ) : null}
                        {r.draft.doNotPhotograph ? (
                          <Badge tone="danger">{tr("badges.doNotPhotograph")}</Badge>
                        ) : null}
                        {r.draft.doNotPublish ? (
                          <Badge tone="draft">{tr("badges.doNotPublish")}</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.valid ? (
                        <Badge tone={r.action === "update" ? "selling" : "money"}>
                          {t(`status.${r.action ?? "add"}`)}
                        </Badge>
                      ) : (
                        <span className="flex flex-col gap-1">
                          <Badge tone="danger">{t("status.invalid")}</Badge>
                          <span className="text-caption text-danger">{r.reason}</span>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
          {visible.length > shown ? (
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => setShown((n) => n + PAGE)}
            >
              {t("showMore")}
            </Button>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setStep("columns")} disabled={busy}>
              {t("backStep")}
            </Button>
            <Button onClick={importRows} disabled={busy || validCount === 0}>
              {busy ? t("importing") : t("importN", { count: validCount })}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
