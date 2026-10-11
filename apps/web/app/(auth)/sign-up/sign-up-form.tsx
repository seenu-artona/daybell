"use client";

import { suggestSlug } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import { Banner, Button, Field } from "@daybell/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { RegionField } from "@/components/region-field";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";

export function SignUpForm({
  regions,
  inviteToken,
}: {
  regions: DataRegion[];
  inviteToken: string | null;
}) {
  const t = useTranslations("auth.signUp");
  const text = useApiText();
  const router = useRouter();
  const [region, setRegion] = useState<DataRegion>(regions[0] ?? "ca");
  const [studioName, setStudioName] = useState("");
  const [studioSlug, setStudioSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const joining = inviteToken !== null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setFormError(null);
    const base = {
      region,
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    const res = await api("/auth/sign-up", {
      body: joining ? { ...base, inviteToken } : { ...base, studioName, studioSlug },
    });
    setBusy(false);
    if (res.ok) {
      router.push("/check-email");
      return;
    }
    setFields(res.fields);
    if (Object.keys(res.fields).length === 0) setFormError(text.error(res.code));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 text-h2">{joining ? t("joinTitle") : t("title")}</h1>
        <p className="mt-1 mb-0 text-muted">{joining ? t("joinIntro") : t("intro")}</p>
      </div>
      {formError ? <Banner tone="danger" title={formError} /> : null}
      {joining ? null : (
        <>
          <Field
            label={t("studioName")}
            name="studioName"
            autoComplete="organization"
            value={studioName}
            onChange={(e) => {
              setStudioName(e.target.value);
              if (!slugEdited) setStudioSlug(suggestSlug(e.target.value));
            }}
            error={text.field(fields.studioName)}
            required
          />
          <Field
            label={t("studioSlug")}
            name="studioSlug"
            value={studioSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setStudioSlug(e.target.value.toLowerCase());
            }}
            help={t("studioSlugHelp", { example: `${studioSlug || "north-peak"}.daybell.io` })}
            error={text.field(fields.studioSlug)}
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </>
      )}
      <Field
        label={t("email")}
        name="email"
        type="email"
        autoComplete="email"
        error={text.field(fields.email)}
        required
      />
      <Field
        label={t("password")}
        name="password"
        type="password"
        autoComplete="new-password"
        help={t("passwordHelp")}
        error={text.field(fields.password)}
        required
      />
      <RegionField regions={regions} value={region} onChange={setRegion} showFixedNote={!joining} />
      <Button type="submit" block disabled={busy}>
        {joining ? t("joinSubmit") : t("submit")}
      </Button>
      <p className="m-0 text-center text-muted">
        {t("haveAccount")}{" "}
        <Link
          href={joining ? `/sign-in?next=/invite/${inviteToken}` : "/sign-in"}
          className="font-semibold text-primary"
        >
          {t("signInLink")}
        </Link>
      </p>
    </form>
  );
}
