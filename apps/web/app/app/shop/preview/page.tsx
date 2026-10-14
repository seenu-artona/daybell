import { getTranslations } from "next-intl/server";
import { ComingSoon } from "../../[section]/coming-soon";
import { PageFrame } from "../../page-frame";

/** "View my shop" (the profile menu): the parent-shop preview, moved under Shop so the section owns /app/shop (D150). */
export default async function ShopPreviewPage() {
  const t = await getTranslations("app");
  return (
    <PageFrame>
      <ComingSoon name={t("top.viewShop")} />
    </PageFrame>
  );
}
