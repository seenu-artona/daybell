"use client";

import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { OrdersList } from "../../../orders/orders-list";
import { useJob } from "../job-context";
import { JobSection } from "../job-section";

/**
 * A job's Orders tab (ADR 0024; D138, D144, D147): the studio's Orders list filtered to this job's orders, with the
 * same chips (Delivery: Home and School are its "+ Add filter" choices, saved for this job only).
 */
function JobOrders() {
  const tt = useTranslations("app.job.tabs");
  const { job } = useJob();
  return (
    <JobSection title={tt("orders")}>
      <OrdersList jobId={job.id} />
    </JobSection>
  );
}

export default function Page() {
  // The chip comes from the address, which needs a Suspense boundary.
  return (
    <Suspense>
      <JobOrders />
    </Suspense>
  );
}
