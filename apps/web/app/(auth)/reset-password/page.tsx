"use client";

import { Banner, Button, Field } from "@daybell/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { useApiText } from "@/components/use-messages";
import { api } from "@/lib/client-api";

export default function ResetPasswordPage() {
  const t = useTranslations("auth.reset");
  const text = useApiText();
  const router = useRouter();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    setBusy(true);
    const res = await api("/auth/password", { method: "PUT", body: { password } });
    setBusy(false);
    if (res.ok) {
      setMessage({ tone: "success", text: t("done") });
      router.replace("/app");
      return;
    }
    setFields(res.fields);
    if (Object.keys(res.fields).length === 0)
      setMessage({ tone: "danger", text: text.error(res.code) });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="m-0 text-h2">{t("title")}</h1>
      {message ? <Banner tone={message.tone} title={message.text} /> : null}
      <Field
        label={t("password")}
        name="password"
        type="password"
        autoComplete="new-password"
        error={text.field(fields.password)}
        required
      />
      <Button type="submit" block disabled={busy}>
        {t("submit")}
      </Button>
    </form>
  );
}
