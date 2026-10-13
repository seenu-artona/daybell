"use client";

import {
  type StudioTaxesResponse,
  TAX_CONFLICTS,
  type TaxConflict,
  type TaxRegistration,
} from "@daybell/api";
import { canSeePayouts, HEAD_OFFICE_PROVINCES, PST_PROVINCES } from "@daybell/core";
import { Banner, Button, Card, CardTitle, Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { Dialog, SelectField } from "../../dialog";
import { useStudio } from "../../me-context";

/**
 * Settings › Taxes (Phase 1 step 10; Seenu's answer 2; Claude's calls 3–6; ADR 0023): the business address Stripe uses
 * as the studio's tax head office (Daybell keeps only its province), and GST/HST and PST registrations. No registration
 * means no tax is charged; a tax adviser should check before selling. Owners change them (call 6); admins read;
 * photographers and staff get a plain refusal (the API answers 403 too). Every result is announced in a status
 * region; field problems sit next to their fields (D91).
 */
type Problem = { form: string | null; fields: Record<string, string> };
const NO_PROBLEM: Problem = { form: null, fields: {} };

function Section({ title, children }: { title: string; children: ReactNode }) {
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

export default function TaxesPage() {
  const t = useTranslations("app.taxes");
  const text = useApiText();
  const { me } = useStudio();
  const allowed = canSeePayouts(me.studio.role);
  const [data, setData] = useState<StudioTaxesResponse | null>(null);
  const [problem, setProblem] = useState<Problem>(NO_PROBLEM);
  const [unavailable, setUnavailable] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState<TaxRegistration | null>(null);
  const [province, setProvince] = useState<string>("ON");
  const [pstProvince, setPstProvince] = useState<string>("BC");
  // Which registration form a number problem belongs to.
  const [lastKind, setLastKind] = useState<"gst_hst" | "pst" | null>(null);

  useEffect(() => {
    if (!allowed) return;
    void api<StudioTaxesResponse>("/studio/taxes").then((res) => {
      if (res.ok) {
        setData(res.data);
        if (res.data.headOffice) setProvince(res.data.headOffice.province);
      } else if (res.code === "region_unavailable") setUnavailable(true);
      else setProblem({ form: text.error(res.code), fields: {} });
    });
  }, [allowed, text]);

  const formText = useCallback(
    (fields: Record<string, string>, code: string) => {
      const form = fields.form;
      if (form && (Object.values(TAX_CONFLICTS) as string[]).includes(form))
        return t(`conflicts.${form.slice("taxes.".length) as keyof typeof TAX_CONFLICTS}`);
      return code === "invalid_input" ? null : text.error(code);
    },
    [t, text],
  );

  async function send(
    path: string,
    method: "PUT" | "POST" | "DELETE",
    body: unknown,
    done: string,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setStatus("");
    setProblem(NO_PROBLEM);
    const res = await api<StudioTaxesResponse>(path, { method, body });
    setBusy(false);
    if (res.ok) {
      setData(res.data);
      setStatus(done);
      return true;
    }
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(res.fields))
      if (key !== "form") fields[key] = text.field(value) ?? value;
    setProblem({ form: formText(res.fields, res.code) as TaxConflict | null, fields });
    return false;
  }

  function saveAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send(
      "/studio/taxes/head-office",
      "PUT",
      {
        line1: String(form.get("line1") ?? ""),
        line2: String(form.get("line2") ?? ""),
        city: String(form.get("city") ?? ""),
        province,
        postalCode: String(form.get("postalCode") ?? ""),
      },
      t("headOffice.saved"),
    );
  }

  function addRegistration(kind: "gst_hst" | "pst") {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      const number = String(new FormData(target).get("number") ?? "");
      setLastKind(kind);
      void send(
        "/studio/taxes/registrations",
        "POST",
        kind === "pst" ? { kind, province: pstProvince, number } : { kind, number },
        t("registrations.added"),
      ).then((ok) => {
        if (ok) target.reset();
      });
    };
  }

  if (!allowed)
    return (
      <p role="alert" className="m-0">
        {t("notForRole")}
      </p>
    );
  if (unavailable) return <Banner tone="info" title={t("unavailable")} />;

  const canManage = data?.canManage ?? false;
  const provinceName = (code: string) =>
    t(`provinces.${code as (typeof HEAD_OFFICE_PROVINCES)[number]}`);
  const kindName = (r: TaxRegistration) =>
    r.kind === "gst_hst"
      ? t("registrations.gstHst")
      : t("registrations.pst", { province: provinceName(r.province ?? "") });

  return (
    <div className="flex flex-col gap-4" aria-busy={busy || undefined}>
      <p className="m-0 text-muted">{t("intro")}</p>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
        <li>{t("noRegistration")}</li>
        <li>{t("adviser")}</li>
      </ul>
      <p role="status" className="m-0 empty:sr-only">
        {status}
      </p>
      {problem.form ? (
        <p role="alert" className="m-0 text-danger">
          {problem.form}
        </p>
      ) : null}
      {!data ? (
        <p className="m-0 text-muted">{t("loading")}</p>
      ) : (
        <>
          <Section title={t("collects.title")}>
            <p className="m-0">{data.collectsTax ? t("collects.yes") : t("collects.no")}</p>
            {!canManage ? <p className="m-0 text-muted">{t("ownerOnly")}</p> : null}
          </Section>

          <Section title={t("headOffice.title")}>
            <p className="m-0">
              {data.headOffice
                ? t("headOffice.set", { province: provinceName(data.headOffice.province) })
                : t("headOffice.notSet")}
            </p>
            <p className="m-0 text-caption text-muted">{t("headOffice.hint")}</p>
            {canManage ? (
              <form onSubmit={saveAddress} className="flex flex-col gap-3" noValidate>
                <Field
                  label={t("headOffice.line1")}
                  name="line1"
                  autoComplete="address-line1"
                  required
                  error={problem.fields.line1}
                />
                <Field
                  label={t("headOffice.line2")}
                  name="line2"
                  autoComplete="address-line2"
                  error={problem.fields.line2}
                />
                <Field
                  label={t("headOffice.city")}
                  name="city"
                  autoComplete="address-level2"
                  required
                  error={problem.fields.city}
                />
                <SelectField
                  label={t("headOffice.province")}
                  value={province}
                  onChange={setProvince}
                  options={HEAD_OFFICE_PROVINCES.map((p) => ({ value: p, label: provinceName(p) }))}
                  error={problem.fields.province}
                />
                <Field
                  label={t("headOffice.postalCode")}
                  name="postalCode"
                  autoComplete="postal-code"
                  required
                  error={problem.fields.postalCode}
                />
                <div>
                  <Button type="submit">{t("headOffice.save")}</Button>
                </div>
              </form>
            ) : null}
          </Section>

          <Section title={t("registrations.title")}>
            {data.registrations.length === 0 ? (
              <p className="m-0 text-muted">{t("registrations.none")}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {data.registrations.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <strong>{kindName(r)}</strong> <span>{r.number}</span>
                    </span>
                    {canManage ? (
                      <Button variant="secondary" onClick={() => setEnding(r)}>
                        {t("registrations.end", { kind: kindName(r) })}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canManage && data.headOffice ? (
              <div className="flex flex-col gap-4">
                <form
                  onSubmit={addRegistration("gst_hst")}
                  className="flex flex-col gap-3"
                  noValidate
                >
                  <Field
                    label={t("registrations.gstNumber")}
                    help={t("registrations.gstHelp")}
                    name="number"
                    required
                    error={lastKind === "gst_hst" ? problem.fields.number : undefined}
                  />
                  <div>
                    <Button type="submit">{t("registrations.addGst")}</Button>
                  </div>
                </form>
                <form onSubmit={addRegistration("pst")} className="flex flex-col gap-3" noValidate>
                  <SelectField
                    label={t("registrations.pstProvince")}
                    value={pstProvince}
                    onChange={setPstProvince}
                    options={PST_PROVINCES.map((p) => ({ value: p, label: provinceName(p) }))}
                  />
                  <Field
                    label={t("registrations.pstNumber")}
                    name="number"
                    required
                    error={lastKind === "pst" ? problem.fields.number : undefined}
                  />
                  <div>
                    <Button type="submit">{t("registrations.addPst")}</Button>
                  </div>
                </form>
              </div>
            ) : canManage ? (
              <p className="m-0 text-muted">{t("registrations.addressFirst")}</p>
            ) : null}
          </Section>
        </>
      )}
      <Dialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title={t("registrations.endTitle")}
      >
        <p className="mt-0 mb-5">{t("registrations.endBody")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setEnding(null)}>
            {t("registrations.keep")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const r = ending;
              setEnding(null);
              if (r)
                void send(
                  `/studio/taxes/registrations/${r.id}`,
                  "DELETE",
                  undefined,
                  t("registrations.ended"),
                );
            }}
          >
            {t("registrations.confirmEnd")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
