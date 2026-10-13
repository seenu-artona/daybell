"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect } from "react";
import { isGalleryId } from "@/lib/shop-client";
import { CodeForm } from "../_components/code-form";
import { Loading, MessageScreen } from "../_components/message-screen";
import { useShop } from "../_components/shop-context";
import { ShopHeader } from "../_components/shop-header";
import { ShopTitle } from "../_components/shop-title";
import { shopButton } from "../_components/styles";

/**
 * Adds a brother or sister by their code: up to 5 children of the same studio (call 1). A code from another studio
 * opens a gallery of its own on this device (S6). `?gallery=` is the gallery the parent came from (for Back and the
 * bag). When the galleries couldn't be read, "Try again" instead of waiting for ever (code review N10).
 */
function AddChild() {
  const t = useTranslations("shop");
  const router = useRouter();
  const shop = useShop();
  const asked = useSearchParams().get("gallery");
  const gallery = shop.gallery(isGalleryId(asked) ? asked : null);
  const first = gallery?.children[0];
  const status = shop.state.status;

  useEffect(() => {
    if (status === "none") router.replace("/shop");
  }, [status, router]);

  const title = <ShopTitle>{t("titles.add")}</ShopTitle>;
  if (status === "error")
    return (
      <main className="px-6">
        {title}
        <MessageScreen>
          <button type="button" onClick={() => void shop.refresh()} className={shopButton}>
            {t("retry")}
          </button>
        </MessageScreen>
      </main>
    );
  if (status !== "ready") return <Loading label={t("loading")} />;
  return (
    <>
      {title}
      <ShopHeader
        title={t("add.title")}
        back={first ? `/shop/c/${first.id}` : "/shop"}
        gallery={gallery?.id ?? null}
      />
      <main className="px-6 pt-8 pb-10">
        <p className="m-0 mb-6 text-body text-muted">{t("add.hint")}</p>
        <CodeForm
          submitLabel={t("add.submit")}
          onOpened={async (childId) => {
            await shop.refresh();
            router.push(`/shop/c/${childId}`);
          }}
        />
      </main>
    </>
  );
}

export default function AddChildPage() {
  return (
    <Suspense>
      <AddChild />
    </Suspense>
  );
}
