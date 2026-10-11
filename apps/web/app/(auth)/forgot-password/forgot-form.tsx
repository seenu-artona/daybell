"use client";

import type { DataRegion } from "@daybell/config";
import { Banner, Button, Field } from "@daybell/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { RegionField } from "@/components/region-field";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";

export function ForgotForm({ regions }: { regions: DataRegion[] }) {
  const t = useTranslations("auth.forgot");
  const text = useApiText();
  const router = useRouter();
  const [region, setRegion] = useState<DataRegion>(regions[0] ?? "ca");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setBusy(true);
    const res = await api("/auth/password-reset", { body: { region, email } });
    setBusy(false);
    if (res.ok) {
      router.push("/check-email?reset=1");
      return;
    }
    setFields(res.fields);
    if (Object.keys(res.fields).length === 0) setFormError(text.error(res.code));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="m-0 text-h2">{t("title")}</h1>
        <p className="mt-1 mb-0 text-muted">{t("intro")}</p>
      </div>
      {formError ? <Banner tone="danger" title={formError} /> : null}
      <Field
        label={t("email")}
        name="email"
        type="email"
        autoComplete="email"
        error={text.field(fields.email)}
        required
      />
      <RegionField regions={regions} value={region} onChange={setRegion} showFixedNote={false} />
      <Button type="submit" block disabled={busy}>
        {t("submit")}
      </Button>
    </form>
  );
}
