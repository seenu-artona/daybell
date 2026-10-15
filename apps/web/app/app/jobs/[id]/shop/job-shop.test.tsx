// @vitest-environment jsdom
import type { Job, JobShop } from "@daybell/api";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { ChangeListForm } from "./change-list-dialog";
import { PriceCell } from "./price-cell";
import { ShopTable } from "./shop-table";

// Job › Shop's screen rules (D157; N4; D91; ADR 0033): a price saves on Enter or on leaving the field, once, in whole
// cents; Escape puts the saved price back; a bad price says so under its labelled field and saves nothing. The table
// names every control for its product, says "Not on the price list" for a job's own product, dims a row switched off
// and says Off in words. Change warns how many of the job's changes a swap removes (B1). "N changes for this job".
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api }));

let root: Root;
let container: HTMLDivElement;
async function render(ui: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
        {ui}
      </NextIntlClientProvider>,
    );
  });
}
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  api.mockReset();
});

const field = () => container.querySelector("input") as HTMLInputElement;
async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(input: HTMLInputElement, name: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

describe("the price cell (D157, N4)", () => {
  it("is labelled for its product, with the currency read out", async () => {
    await render(<PriceCell name="Package A" cents={6400} currency="USD" onSave={vi.fn()} />);
    const input = field();
    expect(input.labels?.[0]?.textContent).toBe("Price for this job: Package A");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(input.value).toBe("64.00");
    const described = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      "Amount in USD",
    ]);
    expect(input.className).toMatch(/\bmin-h-11\b/);
  });

  it("Enter saves whole cents once, even with the blur that follows", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    await render(<PriceCell name="Package A" cents={6400} currency="USD" onSave={onSave} />);
    const input = field();
    await act(async () => input.focus());
    await type(input, "$70.50");
    await key(input, "Enter");
    await act(async () => input.blur());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(7050);
  });

  it("leaving the field saves too (like Shopify, N4)", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    await render(<PriceCell name="Package A" cents={6400} currency="USD" onSave={onSave} />);
    const input = field();
    await act(async () => input.focus());
    await type(input, "59");
    await act(async () => input.blur());
    expect(onSave).toHaveBeenCalledWith(5900);
  });

  it("Escape puts the saved price back and saves nothing", async () => {
    const onSave = vi.fn();
    await render(<PriceCell name="Package A" cents={6400} currency="USD" onSave={onSave} />);
    const input = field();
    await type(input, "1");
    await key(input, "Escape");
    expect(input.value).toBe("64.00");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("the same price again saves nothing", async () => {
    const onSave = vi.fn();
    await render(<PriceCell name="Package A" cents={6400} currency="USD" onSave={onSave} />);
    const input = field();
    await type(input, "64");
    await key(input, "Enter");
    expect(onSave).not.toHaveBeenCalled();
    expect(input.value).toBe("64.00");
  });

  it("a price that isn't one says so under the field, linked to it, and saves nothing", async () => {
    const onSave = vi.fn();
    await render(<PriceCell name="Package A" cents={6400} currency="USD" onSave={onSave} />);
    const input = field();
    for (const bad of ["7.005", "abc", "10000.01"]) {
      await type(input, bad);
      await key(input, "Enter");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      const ids = input.getAttribute("aria-describedby")?.split(" ") ?? [];
      expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(
        messages.validation.price,
      );
    }
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a refusal from the server shows under the field, and leaving it doesn't send it again", async () => {
    const onSave = vi.fn().mockResolvedValue("This job is closed, so its shop can't change.");
    await render(<PriceCell name="Package A" cents={6400} currency="USD" onSave={onSave} />);
    const input = field();
    await act(async () => input.focus());
    await type(input, "1");
    await key(input, "Enter");
    expect(container.textContent).toContain("This job is closed, so its shop can't change.");
    await act(async () => input.blur());
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("the price cell while saving (review fixes M1, M2; tester 2, 3)", () => {
  it("saves text typed during a save after it, never replacing it with the older answer", async () => {
    let finish: (problem: string | null) => void = () => {};
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string | null>((resolve) => (finish = resolve)))
      .mockResolvedValue(null);
    const cell = (cents: number) => (
      <PriceCell name="Package A" cents={cents} currency="USD" onSave={onSave} />
    );
    await render(cell(6400));
    const input = field();
    await act(async () => input.focus());
    await type(input, "70");
    await key(input, "Enter");
    await type(input, "75");
    await render(cell(7000));
    expect(input.value).toBe("75");
    await act(async () => finish(null));
    expect(onSave).toHaveBeenNthCalledWith(1, 7000);
    expect(onSave).toHaveBeenNthCalledWith(2, 7500);
    expect(input.value).toBe("75.00");
  });

  it("Enter retries a refused price; leaving the field doesn't send it again", async () => {
    const onSave = vi.fn().mockResolvedValue("We couldn't save that. Try again.");
    await render(<PriceCell name="Package A" cents={6400} currency="USD" onSave={onSave} />);
    const input = field();
    await act(async () => input.focus());
    await type(input, "70");
    await key(input, "Enter");
    await key(input, "Enter");
    expect(onSave).toHaveBeenCalledTimes(2);
    await act(async () => input.blur());
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("announces a refusal where it happens (role alert)", async () => {
    const onSave = vi.fn().mockResolvedValue("This job is closed, so its shop can't change.");
    await render(<PriceCell name="Package A" cents={6400} currency="USD" onSave={onSave} />);
    const input = field();
    await act(async () => input.focus());
    await type(input, "1");
    await act(async () => input.blur());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "This job is closed, so its shop can't change.",
    );
  });
});

const SHOP: JobShop = {
  jobId: "j1",
  priceList: { id: "l1", name: "Starter", homeShipping: { cents: 895, currency: "USD" } },
  rows: [
    {
      itemId: "i1",
      source: "list",
      kind: "package",
      name: "Package A",
      description: null,
      printSize: null,
      contents: [{ kind: "print", printSize: "8x10", quantity: 1 }],
      listPrice: { cents: 6400, currency: "USD" },
      price: { cents: 7000, currency: "USD" },
      sold: true,
      changed: true,
    },
    {
      itemId: "i2",
      source: "job",
      kind: "print",
      name: "Panorama",
      description: null,
      printSize: "11x14",
      contents: [],
      listPrice: null,
      price: { cents: 4500, currency: "USD" },
      sold: false,
      changed: true,
    },
  ],
  changes: 2,
};

describe("the table (D157, D91)", () => {
  const table = (editable: boolean, onEdit = vi.fn(), onSold = vi.fn()) =>
    render(
      <ShopTable
        shop={SHOP}
        editable={editable}
        onPrice={vi.fn()}
        onSold={onSold}
        onEdit={onEdit}
      />,
    );

  it("has the four columns, the list's price, and — for a job's own product", async () => {
    await table(true);
    expect([...container.querySelectorAll("th")].map((th) => th.textContent)).toEqual([
      "Product",
      "Price list",
      "This job",
      "Sold",
    ]);
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows[0]?.querySelectorAll("td")[1]?.textContent).toBe("$64.00");
    expect(rows[1]?.querySelectorAll("td")[1]?.textContent).toBe("—Not on the price list");
    expect(rows[1]?.querySelector('[aria-hidden="true"]')?.textContent).toBe("—");
  });

  it("names every control for its product; a row switched off is dimmed and says Off", async () => {
    const onEdit = vi.fn();
    const onSold = vi.fn();
    await table(true, onEdit, onSold);
    const switches = [...container.querySelectorAll('[role="switch"]')];
    expect(switches.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Sold: Package A",
      "Sold: Panorama",
    ]);
    expect(switches.map((s) => [s.getAttribute("aria-checked"), s.textContent])).toEqual([
      ["true", "On"],
      ["false", "Off"],
    ]);
    const off = container.querySelectorAll("tbody tr")[1] as HTMLElement;
    expect(off.querySelector("button")?.className).toMatch(/\btext-muted\b/);
    const edit = container.querySelector('button[aria-label="Edit Panorama"]') as HTMLButtonElement;
    expect(edit.textContent).toBe("Panorama");
    await act(async () => edit.click());
    expect(onEdit).toHaveBeenCalledWith(SHOP.rows[1]);
    await act(async () => (switches[1] as HTMLButtonElement).click());
    expect(onSold).toHaveBeenCalledWith(SHOP.rows[1], true);
    expect([...container.querySelectorAll("input")].map((i) => i.labels?.[0]?.textContent)).toEqual(
      ["Price for this job: Package A", "Price for this job: Panorama"],
    );
  });

  it("is text for everyone else: no fields, switches or edit buttons", async () => {
    await table(false);
    expect(container.querySelectorAll("input, button, [role='switch']")).toHaveLength(0);
    const cells = [...container.querySelectorAll("tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((c) => c.textContent),
    );
    expect(cells[0]).toEqual(["Package A1 × 8×10", "$64.00", "$70.00", "On"]);
    expect(cells[1]?.slice(2)).toEqual(["$45.00", "Off"]);
  });
});

describe("Change (B1)", () => {
  const job = { id: "j1", priceListId: "l1" } as unknown as Job;
  const lists = {
    ok: true,
    data: {
      priceLists: [
        { id: "l1", name: "Starter", isDefault: true },
        { id: "l2", name: "Spring", isDefault: false },
      ],
    },
  };
  const select = () => container.querySelector("select") as HTMLSelectElement;
  async function choose(value: string) {
    await act(async () => {
      select().value = value;
      select().dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("says how many of the job's changes another list removes, and that its own products stay", async () => {
    api.mockResolvedValue(lists);
    await render(
      <ChangeListForm job={job} dropped={2} ownProducts onCancel={vi.fn()} onChanged={vi.fn()} />,
    );
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toBe("");
    await choose("l2");
    expect(status.textContent).toContain("2 changes for this job will be removed.");
    expect(status.textContent).toContain("Products only this job sells stay.");
    await choose("l1");
    expect(status.textContent).toBe("");
  });

  it("one change reads in the singular; none needs no warning", async () => {
    api.mockResolvedValue(lists);
    await render(
      <ChangeListForm
        job={job}
        dropped={1}
        ownProducts={false}
        onCancel={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await choose("l2");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "1 change for this job will be removed.",
    );
    await render(
      <ChangeListForm
        job={job}
        dropped={0}
        ownProducts={false}
        onCancel={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await choose("l2");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("saves the job's new list through PATCH /jobs/{id}", async () => {
    api.mockResolvedValueOnce(lists).mockResolvedValueOnce({ ok: true, data: { job } });
    const onChanged = vi.fn();
    await render(
      <ChangeListForm
        job={job}
        dropped={0}
        ownProducts={false}
        onCancel={vi.fn()}
        onChanged={onChanged}
      />,
    );
    await choose("l2");
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
    expect(api).toHaveBeenLastCalledWith("/jobs/j1", {
      method: "PATCH",
      body: { priceListId: "l2" },
    });
    expect(onChanged).toHaveBeenCalledWith(job, "Spring");
  });
});

describe("N changes for this job (N1)", () => {
  it("reads naturally for none, one and many", () => {
    const t = createTranslator({ locale: "en-US", messages, namespace: "app.job.shop" });
    expect(t("changes", { count: 0 })).toBe("No changes for this job");
    expect(t("changes", { count: 1 })).toBe("1 change for this job");
    expect(t("changes", { count: 3 })).toBe("3 changes for this job");
    expect(t("savedChanges", { changes: t("changes", { count: 2 }) })).toBe(
      "Saved. 2 changes for this job",
    );
  });
});
