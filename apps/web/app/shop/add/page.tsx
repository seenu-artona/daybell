"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { CodeForm } from "../_components/code-form";
import { Loading } from "../_components/message-screen";
import { useShop } from "../_components/shop-context";
import { ShopHeader } from "../_components/shop-header";

/** Adds a brother or sister by their code: up to 5 children of the same studio (call 1). */
export default function AddChildPage() {
  const t = useTranslations("shop");
  const router = useRouter();
  const { state, refresh } = useShop();
  const first = state.status === "ready" ? state.session.children[0] : undefined;

  useEffect(() => {
    if (state.status === "none") router.replace("/shop");
  }, [state.status, router]);

  if (state.status !== "ready") return <Loading label={t("loading")} />;
  return (
    <>
      <ShopHeader title={t("add.title")} back={first ? `/shop/c/${first.id}` : "/shop"} />
      <main className="px-6 pt-8 pb-10">
        <p className="m-0 mb-6 text-body text-muted">{t("add.hint")}</p>
        <CodeForm
          mode="add"
          submitLabel={t("add.submit")}
          onOpened={async (childId) => {
            await refresh();
            router.push(`/shop/c/${childId}`);
          }}
        />
      </main>
    </>
  );
}
