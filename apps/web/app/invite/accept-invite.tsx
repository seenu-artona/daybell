"use client";

import type { MeResponse } from "@daybell/api";
import { Banner, Button } from "@daybell/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

const STORAGE_KEY = "daybell_invite";

/** Reads the token from the link's #fragment and keeps it in this tab while the person signs up or in. */
function takeToken(): string | null {
  const fromHash = window.location.hash.slice(1);
  if (/^[0-9a-f]{64}$/.test(fromHash)) {
    try {
      sessionStorage.setItem(STORAGE_KEY, fromHash);
    } catch {
      // Private mode: keep it in the address bar instead.
      return fromHash;
    }
    history.replaceState(null, "", window.location.pathname);
    return fromHash;
  }
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function AcceptInvite() {
  const t = useTranslations("invite");
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "signed-out" | "ready" | "joined" | "invalid">(
    "loading",
  );

  useEffect(() => {
    const found = takeToken();
    setToken(found);
    if (!found) {
      setState("invalid");
      return;
    }
    api<MeResponse>("/me").then((res) => setState(res.ok ? "ready" : "signed-out"));
  }, []);

  async function accept() {
    if (!token) return;
    const res = await api("/invites/accept", { body: { token } });
    if (res.ok) {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
      setState("joined");
      router.replace("/app");
    } else {
      setState("invalid");
    }
  }

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
                <Link href="/sign-in?next=/invite">{t("signIn")}</Link>
              </Button>
              <Button asChild>
                <Link href="/sign-up?join=1">{t("create")}</Link>
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
