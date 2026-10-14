// @vitest-environment jsdom

import { endOfLocalDay, localDay } from "@daybell/core";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";

// Home's Selling now (D146, amends D145): quiet text on the canvas, not a card; an h2 with "All jobs" at its right, each
// selling job one link with its name and closing date, thin lines between rows.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", async (original) => ({
  ...(await original<typeof import("@/lib/client-api")>()),
  api,
}));
const { JobsSelling } = await import("./jobs-selling");

const JOB = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b01";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("JobsSelling", () => {
  it("lists the selling jobs as plain links under an h2, no card", async () => {
    api.mockResolvedValue({
      ok: true,
      status: 200,
      data: { jobs: [{ id: JOB, name: "Lincoln Elementary", closesAt: null }], nextCursor: null },
    });
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
          <JobsSelling refreshKey={0} />
        </NextIntlClientProvider>,
      ),
    );
    await act(() => new Promise<void>((r) => setTimeout(r, 0)));
    const section = container.querySelector("section");
    expect(section?.className).not.toMatch(/\b(bg-surface|shadow-card|rounded-list)\b/);
    const h2 = section?.querySelector("h2");
    expect(h2?.textContent).toBe("Selling now");
    expect(section?.getAttribute("aria-labelledby")).toBe(h2?.id);
    const all = section?.querySelector('a[href="/app/jobs"]');
    expect(all?.textContent).toBe("All jobs");
    const row = section?.querySelector(`a[href="/app/jobs/${JOB}"]`);
    expect(row?.textContent).toBe("Lincoln ElementaryNo closing date");
    expect(row?.className).toMatch(/\bmin-h-14\b/);
    expect(row?.querySelector("span")?.className).toMatch(/\bgroup-hover:underline\b/);
  });
});

describe("JobsSelling closing lines (D147)", () => {
  // Calendar days, not 24-hour steps, so a daylight-saving change can't skip or repeat one.
  const day = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return localDay(date);
  };
  it("says when the shop closes: amber with words when two days or fewer away, else the last day", async () => {
    api.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        jobs: [
          { id: JOB, name: "Soon", closesAt: endOfLocalDay(day(1)).toISOString() },
          {
            id: `${JOB.slice(0, -1)}2`,
            name: "Later",
            closesAt: endOfLocalDay("2030-10-24").toISOString(),
          },
          {
            id: `${JOB.slice(0, -1)}3`,
            name: "Today",
            closesAt: endOfLocalDay(day(0)).toISOString(),
          },
        ],
        nextCursor: null,
      },
    });
    await act(async () =>
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
          <JobsSelling refreshKey={0} />
        </NextIntlClientProvider>,
      ),
    );
    await act(() => new Promise<void>((r) => setTimeout(r, 0)));
    const lines = [...container.querySelectorAll("li a > span:last-child")];
    expect(lines.map((l) => l.textContent)).toEqual([
      "Closes in 1 day",
      "Closes Oct 24",
      "Closes today",
    ]);
    expect(lines[0]?.className).toMatch(/\btext-warning-text\b/);
    expect(lines[1]?.className).not.toMatch(/\btext-warning-text\b/);
  });
});
