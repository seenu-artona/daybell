"use client";

import { Ellipsis } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { shopApi } from "@/lib/shop-client";
import { useShop } from "./shop-context";
import { ShopDialog } from "./shop-dialog";
import { shopButton, shopIconButton } from "./styles";

/** The ⋯ menu: "Forget this device", after a confirmation (answer 3, call 11). */
export function ShopMenu() {
  const t = useTranslations("shop");
  const router = useRouter();
  const { refresh } = useShop();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !wrapper.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  const forget = async () => {
    setBusy(true);
    await shopApi.forget();
    await refresh();
    setBusy(false);
    setConfirming(false);
    router.replace("/shop");
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        aria-label={t("header.menu")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={shopIconButton}
      >
        <Ellipsis className="size-6" aria-hidden="true" />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute top-12 right-0 z-30 min-w-56 rounded-md border border-line bg-surface p-1 shadow-lg"
      >
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirming(true);
          }}
          className="flex min-h-11 w-full items-center rounded-sm px-3 text-left text-sm text-ink hover:bg-subtle focus-visible:outline-3 focus-visible:outline-studio-ring"
        >
          {t("menu.forget")}
        </button>
      </div>
      <ShopDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("menu.forgetTitle")}
      >
        <p className="mt-2 mb-5 text-body text-muted">{t("menu.forgetBody")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="inline-flex min-h-12 items-center rounded-full border border-line-strong px-5 font-semibold text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-studio-ring"
          >
            {t("menu.cancel")}
          </button>
          <button type="button" onClick={forget} disabled={busy} className={shopButton}>
            {t("menu.forgetConfirm")}
          </button>
        </div>
      </ShopDialog>
    </div>
  );
}
