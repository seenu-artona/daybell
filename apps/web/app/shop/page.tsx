"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { CodeForm } from "./_components/code-form";
import { Loading, MessageScreen } from "./_components/message-screen";
import { useShop } from "./_components/shop-context";
import { ShopTitle } from "./_components/shop-title";
import { shopButton } from "./_components/styles";

/**
 * /shop: the one shop address every studio shares (Seenu, answer 1). The code says which studio and child (D24).
 * - No gallery on this device: the code form, neutral (the studio isn't known yet).
 * - One: straight to its first child (answer 3).
 * - More than one (a studio each, S6): "Your galleries", each with the studio's name and its open children's names,
 *   and the form for another code.
 * - The galleries couldn't be read: "Try again", never the form, so a network blip can't lead to a code typed over a
 *   bag (code review S5).
 */
export default function ShopEntryPage() {
  const t = useTranslations("shop");
  const format = useFormatter();
  const router = useRouter();
  const { state, refresh } = useShop();
  const [lostOpen, setLostOpen] = useState(false);
  const lostId = useId();
  const galleries = state.status === "ready" ? state.galleries : [];
  const only = galleries.length === 1 ? galleries[0]?.children[0] : undefined;

  useEffect(() => {
    if (only) router.replace(`/shop/c/${only.id}`);
  }, [only, router]);

  const opened = async (childId: string) => {
    await refresh();
    router.push(`/shop/c/${childId}`);
  };

  if (state.status === "loading" || only)
    return (
      <main className="px-6">
        <Loading label={t("loading")} />
      </main>
    );

  if (state.status === "error")
    return (
      <main className="px-6">
        <ShopTitle>{t("titles.entry")}</ShopTitle>
        <MessageScreen>
          <button type="button" onClick={() => void refresh()} className={shopButton}>
            {t("retry")}
          </button>
        </MessageScreen>
      </main>
    );

  if (galleries.length > 1)
    return (
      <main className="flex min-h-dvh flex-col px-6 pt-16 pb-8">
        <ShopTitle>{t("titles.galleries")}</ShopTitle>
        <h1 className="m-0 text-h2">{t("galleries.title")}</h1>
        <p className="m-0 mt-2 mb-6 text-body text-muted">{t("galleries.hint")}</p>
        <ul aria-label={t("galleries.list")} className="m-0 flex list-none flex-col gap-3 p-0">
          {galleries.map((g) => {
            const names = g.children.flatMap((c) => (c.state === "open" ? [c.displayName] : []));
            const first = g.children[0];
            return first ? (
              <li key={g.id}>
                <Link
                  href={`/shop/c/${first.id}`}
                  className="flex min-h-14 items-center gap-3 rounded-lg border border-line-strong px-4 py-3 text-ink no-underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-studio-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-title-sm">{g.studio.name}</span>
                    {names.length > 0 ? (
                      <span className="block text-body text-muted">
                        {format.list(names, { type: "conjunction" })}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="size-5 shrink-0" aria-hidden="true" />
                </Link>
              </li>
            ) : null;
          })}
        </ul>
        <h2 className="m-0 mt-10 mb-3 text-title-sm">{t("galleries.another")}</h2>
        <CodeForm submitLabel={t("galleries.submit")} onOpened={opened} />
      </main>
    );

  return (
    <main className="flex min-h-dvh flex-col px-6 pt-16 pb-8">
      <ShopTitle>{t("titles.entry")}</ShopTitle>
      <h1 className="m-0 text-h2">{t("entry.title")}</h1>
      <p className="m-0 mt-2 mb-6 text-body text-muted">{t("entry.hint")}</p>
      <CodeForm submitLabel={t("entry.submit")} onOpened={opened} />
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
