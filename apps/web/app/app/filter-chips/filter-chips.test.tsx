// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { type AddFilterChoice, AddFilterMenu } from "./add-filter-menu";
import { type ListFilters, useListFilters } from "./use-list-filters";

// Saved filter chips in the browser (D147, ADR 0026): the hook reads once, saves the whole list on every change,
// shows changes at once and undoes them if saving fails, and drops chips whose record is gone; the "+ Add filter" menu
// is a dashed pill whose panel ("Show only") adds a plain choice at once or opens a second step with Back and a search,
// keeping focus where people expect it (WCAG 2.4.3). The API is faked.
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", async (original) => ({
  ...(await original<typeof import("@/lib/client-api")>()),
  api,
}));

const CLIENT = "c0000000-0000-4000-8000-000000000001";
const GONE = "c0000000-0000-4000-8000-000000000002";
const JOB = "a0000000-0000-4000-8000-000000000001";

let root: Root;
let container: HTMLDivElement;
const wait = (ms = 10) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function render(ui: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
        {ui}
      </NextIntlClientProvider>,
    );
  });
  await wait();
}
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const puts = () =>
  api.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === "PUT");

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

describe("useListFilters", () => {
  let latest: ListFilters;
  function Probe({ page = "jobs", jobId }: { page?: "jobs" | "job_subjects"; jobId?: string }) {
    const filters = useListFilters(page, jobId);
    useEffect(() => {
      latest = filters;
    });
    return null;
  }
  const answer = (chips: unknown[], putOk = true) =>
    api.mockImplementation(async (_path: string, init?: { method?: string }) =>
      init?.method === "PUT"
        ? putOk
          ? { ok: true, status: 204, data: undefined }
          : { ok: false, status: 500, code: "internal", message: "", fields: {} }
        : { ok: true, status: 200, data: { chips } },
    );

  it("reads the person's chips for the list (and job) once", async () => {
    answer([{ key: "closingThisWeek", value: null }]);
    await render(<Probe page="job_subjects" jobId={JOB} />);
    expect(api).toHaveBeenCalledWith(`/me/list-filters?page=job_subjects&jobId=${JOB}`);
    expect(latest.chips).toEqual([{ key: "closingThisWeek", value: null }]);
  });

  it("adds at once and saves the whole list; the same chip twice is ignored", async () => {
    answer([{ key: "closingThisWeek", value: null }]);
    await render(<Probe />);
    await act(async () => {
      await latest.add({ key: "client", value: CLIENT });
    });
    expect(latest.chips).toEqual([
      { key: "closingThisWeek", value: null },
      { key: "client", value: CLIENT },
    ]);
    expect(puts()[0]?.[1]).toEqual({
      method: "PUT",
      body: { page: "jobs", chips: [{ key: "closingThisWeek" }, { key: "client", value: CLIENT }] },
    });
    await act(async () => {
      expect(await latest.add({ key: "client", value: CLIENT })).toBe(false);
    });
    expect(puts()).toHaveLength(1);
  });

  it("undoes a change that can't be saved, and says so", async () => {
    answer([{ key: "closingThisWeek", value: null }], false);
    await render(<Probe />);
    let saved = true;
    await act(async () => {
      saved = await latest.remove({ key: "closingThisWeek", value: null });
    });
    expect(saved).toBe(false);
    expect(latest.chips).toEqual([{ key: "closingThisWeek", value: null }]);
    expect(latest.saveFailed).toBe(true);
  });

  it("drops chips whose record is gone and saves what is left", async () => {
    answer([
      { key: "client", value: CLIENT },
      { key: "client", value: GONE },
    ]);
    await render(<Probe />);
    await act(async () => latest.forget([{ key: "client", value: GONE }]));
    await wait();
    expect(latest.chips).toEqual([{ key: "client", value: CLIENT }]);
    expect((puts()[0]?.[1] as { body: unknown } | undefined)?.body).toEqual({
      page: "jobs",
      chips: [{ key: "client", value: CLIENT }],
    });
  });

  it("a failed load leaves the chips unknown: nothing is added, removed or saved until Retry loads them", async () => {
    api.mockImplementation(async () => ({
      ok: false,
      status: 500,
      code: "internal",
      message: "",
      fields: {},
    }));
    await render(<Probe />);
    expect(latest.chips).toBeNull();
    expect(latest.loadFailed).toBe(true);
    await act(async () => {
      expect(await latest.add({ key: "closingThisWeek", value: null })).toBe(false);
      expect(await latest.remove({ key: "client", value: CLIENT })).toBe(false);
      latest.forget([{ key: "client", value: CLIENT }]);
    });
    expect(puts()).toHaveLength(0);
    answer([{ key: "client", value: CLIENT }]);
    await act(async () => latest.retry());
    await wait();
    expect(latest.loadFailed).toBe(false);
    expect(latest.chips).toEqual([{ key: "client", value: CLIENT }]);
  });

  /** PUTs that answer only when the test says so, in order. */
  function heldPuts(chips: unknown[]) {
    const held: ((ok: boolean) => void)[] = [];
    api.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === "PUT"
        ? new Promise((resolve) =>
            held.push((ok) =>
              resolve(
                ok
                  ? { ok: true, status: 204, data: undefined }
                  : { ok: false, status: 500, code: "internal", message: "", fields: {} },
              ),
            ),
          )
        : Promise.resolve({ ok: true, status: 200, data: { chips } }),
    );
    return held;
  }
  const bodies = () => puts().map((c) => (c[1] as { body: { chips: unknown[] } }).body.chips);

  it("saves one list at a time; changes made meanwhile go next as one list, the newest", async () => {
    const held = heldPuts([]);
    await render(<Probe />);
    let first: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      first = latest.add({ key: "closingThisWeek", value: null });
      void latest.add({ key: "client", value: CLIENT });
      void latest.remove({ key: "closingThisWeek", value: null });
    });
    // One request in flight, the screen already shows the newest list.
    expect(puts()).toHaveLength(1);
    expect(latest.chips).toEqual([{ key: "client", value: CLIENT }]);
    await act(async () => held[0]?.(true));
    await wait();
    expect(puts()).toHaveLength(2);
    expect(bodies()[1]).toEqual([{ key: "client", value: CLIENT }]);
    await act(async () => held[1]?.(true));
    expect(await first).toBe(true);
    expect(latest.chips).toEqual([{ key: "client", value: CLIENT }]);
    expect(latest.saveFailed).toBe(false);
  });

  it("puts back the last list the server accepted when the newest can't be saved", async () => {
    const held = heldPuts([]);
    await render(<Probe />);
    await act(async () => {
      void latest.add({ key: "closingThisWeek", value: null });
    });
    await act(async () => held[0]?.(true));
    await wait();
    await act(async () => {
      void latest.add({ key: "client", value: CLIENT });
    });
    expect(latest.chips).toHaveLength(2);
    await act(async () => held[1]?.(false));
    await wait();
    expect(latest.chips).toEqual([{ key: "closingThisWeek", value: null }]);
    expect(latest.saveFailed).toBe(true);
  });

  it("offers no more than eight", async () => {
    answer(
      Array.from({ length: 8 }, (_, i) => ({ key: "client", value: `${CLIENT.slice(0, -1)}${i}` })),
    );
    await render(<Probe />);
    expect(latest.full).toBe(true);
    await act(async () => {
      expect(await latest.add({ key: "closingThisWeek", value: null })).toBe(false);
    });
    expect(puts()).toHaveLength(0);
  });
});

describe("AddFilterMenu", () => {
  const picked = vi.fn();
  const choices: AddFilterChoice[] = [
    {
      kind: "plain",
      id: "closingThisWeek",
      label: "Shop closes this week",
      onPick: () => picked("week"),
    },
    {
      kind: "search",
      id: "client",
      label: "Client…",
      fieldLabel: "Client",
      placeholder: "Search clients…",
      listLabel: "Clients",
      search: async () => [{ id: CLIENT, name: "Lincoln SD" }],
      onPick: (option) => picked(option.id),
    },
  ];
  const pill = () => button("Add filter") as HTMLButtonElement;

  it("is a dashed pill opening a 'Show only' panel of plain rows; a plain choice adds and returns focus", async () => {
    await render(<AddFilterMenu choices={choices} />);
    expect(pill().className).toMatch(/\bborder-dashed\b/);
    expect(pill().getAttribute("aria-expanded")).toBe("false");
    await act(async () => pill().click());
    expect(pill().getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Show only");
    await act(async () => button("Shop closes this week")?.click());
    expect(picked).toHaveBeenCalledWith("week");
    expect(pill().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(pill());
  });

  it("a choice ending in … opens a second step with Back and a search; picking adds it", async () => {
    await render(<AddFilterMenu choices={choices} />);
    await act(async () => pill().click());
    await act(async () => button("Client…")?.click());
    const field = container.querySelector('[role="combobox"]') as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(container.querySelector(`label[for="${field.id}"]`)?.textContent).toBe("Client");
    // Back returns to the first step, with focus on the row that opened the second.
    await act(async () => button("Back")?.click());
    expect(document.activeElement).toBe(button("Client…"));
    await act(async () => button("Client…")?.click());
    const again = container.querySelector('[role="combobox"]') as HTMLInputElement;
    await act(async () => {
      again.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    await wait(250);
    const option = container.querySelector('[role="option"]') as HTMLElement;
    expect(option.textContent).toBe("Lincoln SD");
    // No "Add new" in a filter.
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
    await act(async () => option.click());
    expect(picked).toHaveBeenCalledWith(CLIENT);
    expect(pill().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(pill());
  });

  it("Escape closes the panel and puts focus back on the pill", async () => {
    await render(<AddFilterMenu choices={choices} />);
    await act(async () => pill().click());
    const row = button("Shop closes this week") as HTMLButtonElement;
    row.focus();
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(pill().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(pill());
  });

  it("shows nothing when there is nothing left to add", async () => {
    await render(<AddFilterMenu choices={[]} />);
    expect(button("Add filter")).toBeUndefined();
  });
});
