import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ComingSoon } from "../../../[section]/coming-soon";
import { JobSection } from "../job-section";
import { isSoonTab } from "../tabs";

/**
 * Photos, Shop, Messages, Orders and Settings (D138): the job's frame with a coming-soon panel until each is built.
 * People and Import are their own folders, which take priority over this one; anything else is a 404.
 */
export default async function JobSoonTabPage({
  params,
}: {
  params: Promise<{ id: string; tab: string }>;
}) {
  const { tab } = await params;
  if (!isSoonTab(tab)) notFound();
  const t = await getTranslations("app.job.tabs");
  return (
    <JobSection>
      <div className="p-6">
        <ComingSoon name={t(tab)} variant="section" />
      </div>
    </JobSection>
  );
}
