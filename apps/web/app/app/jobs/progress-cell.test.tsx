// @vitest-environment jsdom
import type { JobListItem } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import messages from "@/messages/en-US.json";
import { ProgressCell } from "./progress-cell";

// A Jobs row's progress on one line (D143; D145, amends D144): "1 of 7 · Next: Add the roster", the separator hidden
// from screen readers, the next task a link named with its job, plain text for a role that can't do it, and
// "All done" for a closed job.
const JOB = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b01";
let root: Root;
let container: HTMLDivElement;

const job = (checklist: JobListItem["checklist"]) =>
  ({ id: JOB, name: "Lincoln Elementary", checklist }) as JobListItem;

async function render(item: JobListItem, role: string) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages}>
        <ProgressCell job={item} role={role} />
      </NextIntlClientProvider>,
    ),
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const separator = () =>
  [...container.querySelectorAll("span")].find(
    (s) => s.textContent === messages.app.checklist.separator,
  );

describe("ProgressCell", () => {
  it("reads 1 of 7 · Next: the task, as a link named with its job, on one line", async () => {
    await render(job({ milestone: "setUp", done: 1, total: 7, next: "addRoster" }), "owner");
    expect(container.textContent).toBe("1 of 7·Next: Add the roster");
    expect(separator()?.getAttribute("aria-hidden")).toBe("true");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/app/jobs/${JOB}/people`);
    expect(link?.getAttribute("aria-label")).toBe("Next: Add the roster, Lincoln Elementary");
    expect(link?.querySelector("span")?.className).toMatch(/\btruncate\b/);
    expect(container.firstElementChild?.className).toMatch(/\bwhitespace-nowrap\b/);
    // No milestone pill: the Status pill says the shop's state.
    expect(container.textContent).not.toContain("Set up");
  });

  it("shows the next task as plain text to a role that can't do it", async () => {
    await render(job({ milestone: "selling", done: 6, total: 7, next: "startSelling" }), "staff");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("6 of 7·Next: Start selling");
  });

  it("ends a closed job's line with All done", async () => {
    await render(job({ milestone: null, done: 7, total: 7, next: null }), "owner");
    expect(container.textContent).toBe("7 of 7·All done");
    expect(separator()?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("a")).toBeNull();
  });

  it("shows only the count while a job waits with no next task", async () => {
    await render(job({ milestone: "selling", done: 6, total: 7, next: null }), "owner");
    expect(container.textContent).toBe("6 of 7");
    expect(separator()).toBeUndefined();
  });
});
