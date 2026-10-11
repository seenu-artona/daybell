import { getTranslations } from "next-intl/server";
import { SOON_SECTIONS } from "../nav";
import { PageFrame } from "../page-frame";
import { ComingSoon } from "./coming-soon";

// Sections still being built (D128), plus the parent-shop preview ("View my shop") and Help.
const ALLOWED = new Set([...SOON_SECTIONS, "shop", "help"]);

export function generateStaticParams() {
  return [...ALLOWED].map((section) => ({ section }));
}
export const dynamicParams = false;

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  // dynamicParams = false: any other section is a 404 before this runs.
  const { section } = await params;
  const t = await getTranslations("app");
  const name =
    section === "shop"
      ? t("top.viewShop")
      : section === "help"
        ? t("nav.help")
        : t(`nav.${section as "orders"}`);
  return (
    <PageFrame>
      <ComingSoon name={name} />
    </PageFrame>
  );
}
