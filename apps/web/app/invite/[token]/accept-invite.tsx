"use client";

import type { MeResponse } from "@daybell/api";
import { Banner, Button } from "@daybell/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations("invite");
  const router = useRouter();
  const [state, setState] = useState<"loading" | "signed-out" | "ready" | "joined" | "invalid">(
    "loading",
  );

  useEffect(() => {
    api<MeResponse>("/me").then((res) => setState(res.ok ? "ready" : "signed-out"));
  }, []);

  async function accept() {
    const res = await api("/invites/accept", { body: { token } });
    if (res.ok) {
      setState("joined");
      router.replace("/app");
    } else {
      setState("invalid");
    }
  }

  const back = encodeURIComponent(`/invite/${token}`);
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-110 flex-col gap-4 rounded-lg border border-line bg-surface p-6 text-center shadow-sm sm:p-8">
        <div
          className="mx-auto grid size-14 place-items-center rounded-full bg-lime text-2xl"
          aria-hidden="true"
        >
          👋
        </div>
        <h1 className="m-0 text-h2">{t("title")}</h1>
        <p className="m-0 text-muted">{t("body")}</p>
        {state === "ready" ? <Button onClick={accept}>{t("accept")}</Button> : null}
        {state === "joined" ? <Banner tone="success" title={t("joined")} /> : null}
        {state === "invalid" ? <Banner tone="danger" title={t("invalid")} /> : null}
        {state === "signed-out" ? (
          <>
            <p className="m-0">{t("signedOut")}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild variant="secondary">
                <Link href={`/sign-in?next=${back}`}>{t("signIn")}</Link>
              </Button>
              <Button asChild>
                <Link href={`/sign-up?invite=${token}`}>{t("create")}</Link>
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
