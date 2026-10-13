"use client";

import { useTranslations } from "next-intl";
import { OrdersList } from "../../../orders/orders-list";
import { useJob } from "../job-context";
import { JobSection } from "../job-section";

/** A job's Orders tab (ADR 0024; D138): the studio's Orders list, filtered to this job's orders. */
export default function Page() {
  const t = useTranslations("app.orders");
  const tt = useTranslations("app.job.tabs");
  const { job } = useJob();
  return (
    <JobSection title={tt("orders")} subline={t("jobIntro")}>
      <OrdersList jobId={job.id} />
    </JobSection>
  );
}
