"use client";

import { Banner } from "@daybell/ui";
import { useTranslations } from "next-intl";
import { useJob } from "./job-context";

/**
 * While a job is selling, People, Photos, Review and Shop say so (ADR 0021, call 3): changes stay allowed and show to
 * parents straight away; orders already placed keep what they bought. Nothing while the job is a draft or closed.
 */
export function LiveNote() {
  const t = useTranslations("app.job");
  const { job } = useJob();
  return job.status === "selling" ? <Banner tone="info" title={t("liveNote")} /> : null;
}
