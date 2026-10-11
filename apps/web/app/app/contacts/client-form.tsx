"use client";

import { type Client, COUNTRIES } from "@daybell/api";
import { Banner, Button, Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";
import { SelectField, TextAreaField } from "../dialog";
import { useStudio } from "../me-context";

type Country = (typeof COUNTRIES)[number];

interface ClientDraft {
  name: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  region: string;
  country: Country;
  contactFirstName: string;
  contactLastName: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
}
type TextKey = Exclude<keyof ClientDraft, "country">;

/** A blank client, or an existing one to edit. The country starts as the studio's own (D113). */
function draftFor(client: Client | null, studioRegion: "us" | "ca"): ClientDraft {
  return {
    name: client?.name ?? "",
    addressLine1: client?.addressLine1 ?? "",
    addressLine2: client?.addressLine2 ?? "",
    postalCode: client?.postalCode ?? "",
    city: client?.city ?? "",
    region: client?.region ?? "",
    country: client?.country ?? (studioRegion === "ca" ? "CA" : "US"),
    contactFirstName: client?.contactFirstName ?? "",
    contactLastName: client?.contactLastName ?? "",
    contactPhone: client?.contactPhone ?? "",
    contactEmail: client?.contactEmail ?? "",
    notes: client?.notes ?? "",
  };
}

/** The request body: blank optional fields are sent as null. */
function body(draft: ClientDraft) {
  const orNull = (v: string) => v.trim() || null;
  return {
    name: draft.name,
    addressLine1: orNull(draft.addressLine1),
    addressLine2: orNull(draft.addressLine2),
    postalCode: orNull(draft.postalCode),
    city: orNull(draft.city),
    region: orNull(draft.region),
    country: draft.country,
    contactFirstName: orNull(draft.contactFirstName),
    contactLastName: orNull(draft.contactLastName),
    contactPhone: orNull(draft.contactPhone),
    contactEmail: orNull(draft.contactEmail),
    notes: orNull(draft.notes),
  };
}

const LEGEND = "mb-2 p-0 text-[15px] font-bold";

/**
 * Add or edit a client (GotPhoto "Add new client"): name, address, contact person and private notes. Used in
 * Contacts › Clients and on top of the job form. Address labels follow the studio's region: State / ZIP code in the
 * US, Province / Postal code in Canada.
 */
export function ClientForm({
  client,
  onCancel,
  onSaved,
}: {
  client: Client | null;
  onCancel: () => void;
  onSaved: (client: Client) => void;
}) {
  const t = useTranslations("app.contacts");
  const text = useApiText();
  const { me, changed } = useStudio();
  const region = me.studio.region;
  const [draft, setDraft] = useState(() => draftFor(client, region));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const optional = ` (${t("form.optional")})`;

  const input = (key: TextKey) => ({
    name: key,
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
    error: text.field(errors[key]),
  });

  async function save(e: FormEvent) {
    // A form inside the job form's dialog: never submit the outer form too.
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setErrors({});
    setProblem(null);
    const res = await api<{ client: Client }>(client ? `/clients/${client.id}` : "/clients", {
      method: client ? "PATCH" : "POST",
      body: body(draft),
    });
    setBusy(false);
    if (res.ok) {
      changed();
      return onSaved(res.data.client);
    }
    setErrors(res.fields);
    if (Object.keys(res.fields).length === 0) setProblem(text.error(res.code));
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-5">
      {problem ? <Banner tone="danger" title={problem} /> : null}
      <Field label={t("form.name")} required autoComplete="organization" {...input("name")} />

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className={LEGEND}>{t("form.address")}</legend>
        <Field
          label={`${t("form.addressLine1")}${optional}`}
          autoComplete="address-line1"
          {...input("addressLine1")}
        />
        <Field
          label={`${t("form.addressLine2")}${optional}`}
          autoComplete="address-line2"
          {...input("addressLine2")}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={`${t(`address.${region}.postalCode`)}${optional}`}
            autoComplete="postal-code"
            {...input("postalCode")}
          />
          <Field
            label={`${t("form.city")}${optional}`}
            autoComplete="address-level2"
            {...input("city")}
          />
          <Field
            label={`${t(`address.${region}.region`)}${optional}`}
            help={t(`address.${region}.regionHelp`)}
            autoComplete="address-level1"
            maxLength={2}
            {...input("region")}
          />
          <SelectField
            label={t("form.country")}
            value={draft.country}
            onChange={(v) => setDraft({ ...draft, country: v as Country })}
            options={COUNTRIES.map((c) => ({ value: c, label: t(`form.countries.${c}`) }))}
            error={text.field(errors.country)}
          />
        </div>
      </fieldset>

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className={LEGEND}>{t("form.contact")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={`${t("form.firstName")}${optional}`}
            autoComplete="off"
            {...input("contactFirstName")}
          />
          <Field
            label={`${t("form.lastName")}${optional}`}
            autoComplete="off"
            {...input("contactLastName")}
          />
          <Field
            label={`${t("form.phone")}${optional}`}
            type="tel"
            maxLength={30}
            autoComplete="off"
            {...input("contactPhone")}
          />
          <Field
            label={`${t("form.email")}${optional}`}
            type="email"
            autoComplete="off"
            {...input("contactEmail")}
          />
        </div>
      </fieldset>

      <TextAreaField
        label={`${t("form.notes")}${optional}`}
        help={t("form.notesHelp")}
        {...input("notes")}
      />

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          {t("form.cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? t("form.saving") : t("form.save")}
        </Button>
      </div>
    </form>
  );
}
