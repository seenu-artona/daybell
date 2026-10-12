import { getTranslations } from "next-intl/server";
import { ComingSoon } from "../../[section]/coming-soon";
import type { SoonTab } from "./tabs";

/**
 * Photos, Shop, Messages, Orders and Settings (D138): the job's frame with a coming-soon card until each is built,
 * under the D140 header and tabs, with no hero.
 * Each tab is its own folder rather than one [tab] segment, so an unknown tab matches no route and is a real 404.
 * A notFound() inside a [tab] page could not do that: the studio app's shell renders its children only in the
 * browser (after /me loads), so the server had already sent a 200 before React reached the page.
 */
export async function SoonTabPage({ tab }: { tab: SoonTab }) {
  const t = await getTranslations("app.job.tabs");
  return <ComingSoon name={t(tab)} variant="section" />;
}
