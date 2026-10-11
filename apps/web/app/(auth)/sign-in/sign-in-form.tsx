"use client";

import type { DataRegion } from "@daybell/config";
import { Banner, Button, Field } from "@daybell/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { RegionField } from "@/components/region-field";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";

export function SignInForm({
  regions,
  next,
  linkExpired,
}: {
  regions: DataRegion[];
  next: string;
  linkExpired: boolean;
}) {
  const t = useTranslations("auth.signIn");
  const text = useApiText();
  const router = useRouter();
  const [region, setRegion] = useState<DataRegion>(regions[0] ?? "ca");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(linkExpired ? t("linkExpired") : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setFormError(null);
    const res = await api("/auth/sign-in", {
      body: {
        region,
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      },
    });
    setBusy(false);
    if (res.ok) {
      router.replace(next);
      router.refresh();
      return;
    }
    setFields(res.fields);
    if (Object.keys(res.fields).length === 0) setFormError(text.error(res.code));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="m-0 text-h2">{t("title")}</h1>
      {formError ? <Banner tone="danger" title={formError} /> : null}
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
        autoComplete="current-password"
        error={text.field(fields.password)}
        required
      />
      <RegionField regions={regions} value={region} onChange={setRegion} showFixedNote={false} />
      <Button type="submit" block disabled={busy}>
        {t("submit")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/forgot-password" className="font-semibold text-primary">
          {t("forgot")}
        </Link>
        <span className="text-muted">
          {t("noAccount")}{" "}
          <Link href="/sign-up" className="font-semibold text-primary">
            {t("signUpLink")}
          </Link>
        </span>
      </div>
    </form>
  );
}
