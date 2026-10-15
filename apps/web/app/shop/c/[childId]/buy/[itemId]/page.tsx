"use client";

import type { ShopGalleryResponse, ShopPriceListResponse } from "@daybell/api";
import { hasQuantity, initialPose, shopPoses } from "@daybell/core";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useState } from "react";
import { bagCount, shopApi } from "@/lib/shop-client";
import { DockedCta } from "../../../../_components/docked-cta";
import { money, useContents, useRefusal } from "../../../../_components/format";
import { Loading, MessageScreen } from "../../../../_components/message-screen";
import { PosePicker } from "../../../../_components/pose-picker";
import { ProtectedImage } from "../../../../_components/protected-image";
import { Quantity } from "../../../../_components/quantity";
import { useShop } from "../../../../_components/shop-context";
import { ShopHeader } from "../../../../_components/shop-header";
import { ShopTitle } from "../../../../_components/shop-title";
import { shopButton } from "../../../../_components/styles";
import { useChildData } from "../../../../_components/use-child";

/** What the pose page needs: the job's prices, and the child's portraits and group photos. */
interface PoseData {
  prices: ShopPriceListResponse;
  gallery: ShopGalleryResponse;
}

/**
 * The pose (D24: package, then pose): the child's portraits, then the group photos of their groups (D156 C5; N6), as
 * radio buttons shown as thumbnails, a big preview of the one chosen, how many (prints and packages), and "Add to bag"
 * docked with the price. A photo the parent came with (?photo=, from either set) is chosen first.
 */
function Pose() {
  const t = useTranslations("shop");
  const contents = useContents();
  const refusal = useRefusal();
  const router = useRouter();
  const { setBagCount } = useShop();
  const { itemId } = useParams<{ itemId: string }>();
  const wanted = useSearchParams().get("photo");
  const load = useCallback(async (galleryId: string, childId: string) => {
    const [prices, gallery] = await Promise.all([
      shopApi.priceList(galleryId, childId),
      shopApi.gallery(galleryId, childId),
    ]);
    if (!prices.ok) return prices;
    if (!gallery.ok) return gallery;
    return { ok: true as const, data: { prices: prices.data, gallery: gallery.data } };
  }, []);
  const { childId, galleryId, child, studio, data, failed, reload, onImageError } =
    useChildData<PoseData>(load);
  const item = data?.prices.priceList?.items.find((i) => i.id === itemId);
  const portraits = data?.gallery.portraits ?? [];
  const groupPhotos = data?.gallery.groupPhotos ?? [];
  const [pose, setPose] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pose) return;
    setPose(initialPose(portraits, groupPhotos, wanted));
  }, [pose, portraits, groupPhotos, wanted]);

  const add = async () => {
    if (!item || !pose || !galleryId) return;
    setBusy(true);
    setError(null);
    const result = await shopApi.addLine(galleryId, {
      childId,
      itemId: item.id,
      photoId: pose,
      quantity,
    });
    setBusy(false);
    if (!result.ok) {
      setError(refusal(result));
      return;
    }
    setBagCount(galleryId, bagCount(result.data));
    router.push(`/shop/bag?gallery=${encodeURIComponent(galleryId)}`);
  };

  const heading = item?.name ?? t("pose.title");
  const title = <ShopTitle>{heading}</ShopTitle>;
  if (!child || !data)
    return (
      <>
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
      </>
    );
  const chosen = shopPoses(portraits, groupPhotos).find((p) => p.photo.id === pose);
  const closed = data.prices.state !== "open";
  // Back to the packages with the pose the parent came with (code review N9).
  const back = `/shop/c/${childId}/buy${wanted ? `?photo=${encodeURIComponent(wanted)}` : ""}`;
  return (
    <>
      {title}
      <ShopHeader title={heading} back={back} gallery={galleryId} />
      <main className="px-4 pt-4 pb-32">
        {closed ? (
          <MessageScreen>
            {t(data.prices.state === "closed" ? "gallery.closed" : "gallery.unavailable", {
              studio,
            })}
          </MessageScreen>
        ) : !item || item.kind === "digital_all" ? (
          <MessageScreen>{t("refusals.itemUnavailable")}</MessageScreen>
        ) : (
          <>
            {item.kind === "package" ? (
              <p className="m-0 mb-3 text-body text-muted">
                {item.description ?? contents(item.contents)}
              </p>
            ) : null}
            {chosen ? (
              <div className="mx-auto aspect-[4/5] w-3/4 overflow-hidden rounded-lg bg-subtle">
                <ProtectedImage
                  src={chosen.photo.viewUrl}
                  alt={t(chosen.set === "portraits" ? "pose.poseAlt" : "pose.groupAlt", {
                    n: chosen.n,
                    total: chosen.total,
                  })}
                  onError={onImageError}
                  eager
                />
              </div>
            ) : null}
            <PosePicker
              portraits={portraits}
              groupPhotos={groupPhotos}
              value={pose}
              onChange={setPose}
              onImageError={onImageError}
            />
            {hasQuantity(item.kind) ? (
              <div className="mt-5 flex items-center justify-between gap-3">
                <span className="text-title-sm" aria-hidden="true">
                  {t("pose.quantity")}
                </span>
                <Quantity label={t("pose.quantity")} value={quantity} onChange={setQuantity} />
              </div>
            ) : null}
            <p role="alert" className="m-0 mt-3 text-caption text-danger">
              {error}
            </p>
          </>
        )}
      </main>
      {!closed && item && item.kind !== "digital_all" ? (
        <DockedCta
          price={money({ cents: item.price.cents * quantity, currency: item.price.currency })}
          label={t("pose.summary", { name: item.name, count: quantity })}
        >
          <button
            type="button"
            disabled={busy || !pose}
            onClick={() => void add()}
            className={shopButton}
          >
            {t("pose.add")}
          </button>
        </DockedCta>
      ) : null}
    </>
  );
}

export default function PosePage() {
  return (
    <Suspense>
      <Pose />
    </Suspense>
  );
}
