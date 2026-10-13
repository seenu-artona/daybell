"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { CodeForm } from "./_components/code-form";
import { Loading } from "./_components/message-screen";
import { useShop } from "./_components/shop-context";

/**
 * /shop: the one shop address every studio shares (Seenu, answer 1). The code says which studio and child (D24). With
 * a session on this device, straight to the gallery (answer 3). Neutral until a code is entered: the studio isn't
 * known yet.
 */
export default function ShopEntryPage() {
  const t = useTranslations("shop");
  const router = useRouter();
  const { state, refresh } = useShop();
  const [lostOpen, setLostOpen] = useState(false);
  const lostId = useId();
  const first = state.status === "ready" ? state.session.children[0] : undefined;

  useEffect(() => {
    if (first) router.replace(`/shop/c/${first.id}`);
  }, [first, router]);

  if (state.status === "loading" || first)
    return (
      <main className="px-6">
        <Loading label={t("loading")} />
      </main>
    );

  return (
    <main className="flex min-h-dvh flex-col px-6 pt-16 pb-8">
      <h1 className="m-0 text-h2">{t("entry.title")}</h1>
      <p className="m-0 mt-2 mb-6 text-body text-muted">{t("entry.hint")}</p>
      <CodeForm
        mode="open"
        submitLabel={t("entry.submit")}
        onOpened={async (childId) => {
          await refresh();
          router.push(`/shop/c/${childId}`);
        }}
      />
      <div className="mt-auto pt-10 text-center text-caption text-muted">
        <p className="m-0">{t("privacy")}</p>
        <button
          type="button"
          aria-expanded={lostOpen}
          aria-controls={lostId}
          onClick={() => setLostOpen((o) => !o)}
          className="mt-1 inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-studio-ring"
        >
          {t("entry.lost")}
        </button>
        <p id={lostId} hidden={!lostOpen} className="m-0 text-body text-ink">
          {t("entry.lostAnswer")}
        </p>
      </div>
    </main>
  );
}
