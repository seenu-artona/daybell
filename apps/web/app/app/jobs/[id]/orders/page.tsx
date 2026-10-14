"use client";

import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { OrdersList, useOrderView } from "../../../orders/orders-list";
import { useJob } from "../job-context";
import { JobSection } from "../job-section";

/** A job's Orders tab (ADR 0024; D138, D144): the studio's Orders list, filtered to this job's orders. */
function JobOrders() {
  const tt = useTranslations("app.job.tabs");
  const { job } = useJob();
  const { status, delivery, viewHref } = useOrderView();
  return (
    <JobSection title={tt("orders")}>
      <OrdersList
        jobId={job.id}
        level="sub"
        status={status}
        delivery={delivery}
        viewHref={viewHref}
      />
    </JobSection>
  );
}

export default function Page() {
  // The view (?status=) comes from the address, which needs a Suspense boundary.
  return (
    <Suspense>
      <JobOrders />
    </Suspense>
  );
}
