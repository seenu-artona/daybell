"use client";

import type { ShopGalleryResponse, ShopPhoto } from "@daybell/api";
import { cn } from "@daybell/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { shopApi } from "@/lib/shop-client";
import { ChildSwitcher } from "../../_components/child-switcher";
import { Cover } from "../../_components/cover";
import { DockedCta } from "../../_components/docked-cta";
import { useChildName, useShopDates } from "../../_components/format";
import { Loading, MessageScreen } from "../../_components/message-screen";
import { PhotoGrid } from "../../_components/photo-grid";
import { PhotoViewer } from "../../_components/photo-viewer";
import { ShopHeader } from "../../_components/shop-header";
import { ShopTitle } from "../../_components/shop-title";
import { shopButton } from "../../_components/styles";
import { coverSeen, markCoverSeen } from "../../_components/tab-state";
import { useChildData } from "../../_components/use-child";

const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;

/**
 * A child's gallery (D119, D60): the full-screen cover first, then the grid of portraits, the group photos of their
 * groups as a second tab (each can be ordered, D156 C5), the children as links, the last day to order and delivery to
 * school. Closed and unavailable shops say
 * so, naming the studio and never the child (answer 4, call 6; security review M1).
 */
export default function GalleryPage() {
  const t = useTranslations("shop");
  const dates = useShopDates();
  const childName = useChildName();
  const { childId, galleryId, child, studio, data, failed, reload, onImageError } =
    useChildData<ShopGalleryResponse>(shopApi.gallery);
  const [showCover, setShowCover] = useState<boolean | null>(null);
  const [set, setSet] = useState<"portraits" | "groupPhotos">("portraits");
  const [viewer, setViewer] = useState<number | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const focusHeading = useRef(false);

  useEffect(() => {
    setShowCover(!coverSeen(childId));
    setSet("portraits");
    setViewer(null);
  }, [childId]);

  useEffect(() => {
    if (showCover === false && focusHeading.current) {
      focusHeading.current = false;
      heading.current?.querySelector("h1")?.focus();
    }
  }, [showCover]);

  const name = childName(child);
  // Never the child's name in the title: titles reach history and tab sync, and outlive "Forget this device" (R8).
  const title = <ShopTitle>{t("titles.gallery")}</ShopTitle>;

  if (!child || !data || showCover === null)
    return (
      <main className="px-6">
        {title}
        {failed ? (
          <MessageScreen>
            <button type="button" onClick={() => void reload()} className={shopButton}>
              {t("retry")}
            </button>
          </MessageScreen>
        ) : (
          <Loading label={t("loading")} />
        )}
      </main>
    );

  const open = child.state === "open" && data.state === "open" && data.cover !== null;
  if (open && child.state === "open" && showCover && data.cover)
    return (
      <>
        {title}
        <Cover
          studio={studio}
          child={child}
          photo={data.cover}
          total={data.portraits.length}
          onImageError={onImageError}
          onSeePhotos={() => {
            markCoverSeen(childId);
            focusHeading.current = true;
            setShowCover(false);
          }}
        />
      </>
    );

  const photos: ShopPhoto[] = set === "portraits" ? data.portraits : data.groupPhotos;
  const firstName = child.state === "open" ? child.firstName : name;
  const alt = (n: number, total: number) =>
    set === "portraits"
      ? t("gallery.photoAlt", { name: firstName, n, total })
      : t("gallery.groupAlt", { name: firstName, n, total });

  return (
    <>
      {title}
      <div ref={heading}>
        <ShopHeader title={name} gallery={galleryId} />
      </div>
      <main className={cn("px-4", open ? "pb-32" : "pb-10")}>
        <ChildSwitcher current={childId} />
        {data.state === "closed" ? (
          <MessageScreen>{t("gallery.closed", { studio })}</MessageScreen>
        ) : !open || child.state !== "open" ? (
          <MessageScreen>{t("gallery.unavailable", { studio })}</MessageScreen>
        ) : (
          <>
            {data.groupPhotos.length > 0 ? (
              <div role="group" aria-label={t("gallery.sets")} className="mt-4 flex gap-5">
                {(["portraits", "groupPhotos"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={set === key}
                    onClick={() => setSet(key)}
                    className={cn(
                      "min-h-11 border-b-2 px-1 text-sm font-semibold focus-visible:outline-3 focus-visible:outline-studio-ring",
                      set === key ? "border-studio text-ink" : "border-transparent text-muted",
                    )}
                  >
                    {t(`gallery.${key}`)}
                  </button>
                ))}
              </div>
            ) : null}
            {child.closesAt || child.deliverToSchool ? (
              <p className="m-0 mt-3 text-body">
                {child.closesAt
                  ? t.rich(child.deliverToSchool ? "gallery.orderAndDelivery" : "gallery.orderBy", {
                      date: dates.lastDay(child.closesAt),
                      strong,
                    })
                  : t("gallery.schoolDelivery")}
              </p>
            ) : null}
            <p className="m-0 mt-1 text-caption text-muted">{t("gallery.protected")}</p>
            <PhotoGrid
              label={
                set === "portraits"
                  ? t("gallery.portraitsGrid", { name: child.displayName })
                  : t("gallery.groupGrid", { name: child.displayName })
              }
              photos={photos}
              alt={alt}
              onOpen={setViewer}
              onImageError={onImageError}
            />
            <PhotoViewer
              photos={photos}
              index={viewer}
              onIndex={setViewer}
              onClose={() => setViewer(null)}
              alt={alt}
              orderHref={(photo) => `/shop/c/${childId}/buy?photo=${encodeURIComponent(photo.id)}`}
              drm={galleryId ? { childId, galleryId } : null}
            />
          </>
        )}
      </main>
      {open ? (
        <DockedCta>
          <Link href={`/shop/c/${childId}/buy`} className={shopButton}>
            {t("gallery.choosePackage")}
          </Link>
        </DockedCta>
      ) : null}
    </>
  );
}
