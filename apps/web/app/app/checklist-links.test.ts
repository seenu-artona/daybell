import { ONBOARDING_TASKS } from "@daybell/core";
import { describe, expect, it } from "vitest";
import { onboardingHref, taskHref } from "./checklist-links";

const JOB = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";

describe("taskHref", () => {
  it("links each task to the page where the work happens", () => {
    expect(taskHref(JOB, "overview")).toBe(`/app/jobs/${JOB}`);
    expect(taskHref(JOB, "people")).toBe(`/app/jobs/${JOB}/people`);
    expect(taskHref(JOB, "peoplePrint")).toBe(`/app/jobs/${JOB}/people?print=qr`);
    expect(taskHref(JOB, "photos")).toBe(`/app/jobs/${JOB}/photos`);
    expect(taskHref(JOB, "photosReview")).toBe(`/app/jobs/${JOB}/photos/review`);
  });
});

describe("onboardingHref", () => {
  it("links the price list to Products and the first job to the new-job form; the account goes nowhere", () => {
    expect(ONBOARDING_TASKS.map(onboardingHref)).toEqual([
      null,
      "/app/products",
      "/app/jobs?new=1",
    ]);
  });
});
