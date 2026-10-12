import type { OnboardingTaskKey, TaskTarget } from "@daybell/core";
import { tabHref } from "./jobs/[id]/tabs";

/** Where a job task's work happens (D143; ADR 0017): every row is a plain link there, never a button. */
export function taskHref(jobId: string, target: TaskTarget): string {
  switch (target) {
    case "overview":
      return tabHref(jobId, "overview");
    case "people":
      return tabHref(jobId, "people");
    case "peoplePrint":
      // People opens its Print QR cards dialog once, then drops the parameter (ADR 0015).
      return `${tabHref(jobId, "people")}?print=qr`;
    case "photos":
      return tabHref(jobId, "photos");
  }
}

/** Where a studio setup task's work happens; the account row has nowhere to go. */
export function onboardingHref(key: OnboardingTaskKey): string | null {
  switch (key) {
    case "firstJob":
      return "/app/jobs?new=1";
    default:
      return null;
  }
}
