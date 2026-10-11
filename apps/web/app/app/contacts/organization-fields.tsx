"use client";

import { COUNTRIES, type Organization } from "@daybell/api";
import { ORGANIZATION_KINDS, type OrganizationKind } from "@daybell/core";
import { Field } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useApiText } from "@/components/use-messages";
import { SelectField } from "../dialog";
import { useStudio } from "../me-context";

export interface OrganizationDraft {
  name: string;
  kind: OrganizationKind;
  notes: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: (typeof COUNTRIES)[number];
}

/** A blank organization. The country starts as the studio's own (D113). */
export function emptyOrganization(
  kind: OrganizationKind,
  studioRegion: "us" | "ca",
): OrganizationDraft {
  return {
    name: "",
    kind,
    notes: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postalCode: "",
    country: studioRegion === "ca" ? "CA" : "US",
  };
}

export function draftFrom(org: Organization, studioRegion: "us" | "ca"): OrganizationDraft {
  const blank = emptyOrganization(org.kind, studioRegion);
  return {
    name: org.name,
    kind: org.kind,
    notes: org.notes ?? "",
    addressLine1: org.addressLine1 ?? "",
    addressLine2: org.addressLine2 ?? "",
    city: org.city ?? "",
    region: org.region ?? "",
    postalCode: org.postalCode ?? "",
    country: org.country ?? blank.country,
  };
}

/** The request body: blank optional fields are sent as null. */
export function organizationBody(draft: OrganizationDraft) {
  const orNull = (v: string) => v.trim() || null;
  return {
    name: draft.name,
    kind: draft.kind,
    notes: orNull(draft.notes),
    addressLine1: orNull(draft.addressLine1),
    addressLine2: orNull(draft.addressLine2),
    city: orNull(draft.city),
    region: orNull(draft.region),
    postalCode: orNull(draft.postalCode),
    country: draft.country,
  };
}

/**
 * The organization form fields, shared by the Contacts dialog and the new-job wizard. Address labels follow the
 * studio's region: State / ZIP code in the US, Province / Postal code in Canada.
 */
export function OrganizationFields({
  value,
  onChange,
  errors,
  showNotes = true,
}: {
  value: OrganizationDraft;
  onChange: (next: OrganizationDraft) => void;
  errors: Record<string, string>;
  showNotes?: boolean;
}) {
  const t = useTranslations("app.contacts");
  const text = useApiText();
  const { me } = useStudio();
  const region = me.studio.region;
  const set =
    <K extends keyof OrganizationDraft>(key: K) =>
    (v: OrganizationDraft[K]) =>
      onChange({ ...value, [key]: v });
  const input = (key: Exclude<keyof OrganizationDraft, "kind" | "country">) => ({
    name: key,
    value: value[key],
    onChange: (e: { target: { value: string } }) => set(key)(e.target.value),
    error: text.field(errors[key]),
  });
  const optional = ` (${t("form.optional")})`;

  return (
    <div className="flex flex-col gap-3">
      <Field label={t("form.name")} required autoComplete="organization" {...input("name")} />
      <SelectField
        label={t("form.kind")}
        value={value.kind}
        onChange={(v) => set("kind")(v as OrganizationKind)}
        options={ORGANIZATION_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
        error={text.field(errors.kind)}
      />
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
        <Field
          label={`${t(`address.${region}.postalCode`)}${optional}`}
          autoComplete="postal-code"
          {...input("postalCode")}
        />
        <SelectField
          label={t("form.country")}
          value={value.country}
          onChange={(v) => set("country")(v as OrganizationDraft["country"])}
          options={COUNTRIES.map((c) => ({ value: c, label: t(`form.countries.${c}`) }))}
          error={text.field(errors.country)}
        />
      </div>
      {showNotes ? (
        <Field
          label={`${t("form.notes")}${optional}`}
          help={t("form.notesHelp")}
          {...input("notes")}
        />
      ) : null}
    </div>
  );
}
