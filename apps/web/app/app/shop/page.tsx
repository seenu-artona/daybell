import { getTranslations } from "next-intl/server";
import { ComingSoon } from "../[section]/coming-soon";
import { PageFrame } from "../page-frame";

/** Shop (D150, D149): Setup, Promotions and Messages. Coming soon until its design is approved (D128). */
export default async function ShopPage() {
  const t = await getTranslations("app");
  return (
    <PageFrame>
      <ComingSoon name={t("nav.shop")} />
    </PageFrame>
  );
}
