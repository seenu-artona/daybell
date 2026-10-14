// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import messages from "@/messages/en-US.json";
import { FilterMenu, filtersOn } from "./filter-menu";

// D145, amends D144: every filter behind one 44px filter icon. Its name says how many filters are on (words, not
// the dot alone: D91); its panel has one named radio group per filter that applies as it changes and stays open; Clear
// filters resets them all, closes the panel and puts focus back on the icon.
let root: Root;
let container: HTMLDivElement;

function Filters() {
  const [delivery, setDelivery] = useState("");
  const [groupBy, setGroupBy] = useState("none");
  return (
    <NextIntlClientProvider locale="en-US" messages={messages}>
      <p data-testid="state">{`${delivery}|${groupBy}`}</p>
      <FilterMenu
        onClear={() => {
          setDelivery("");
          setGroupBy("none");
        }}
        groups={[
          {
            key: "delivery",
            legend: "Delivery",
            value: delivery,
            onChange: setDelivery,
            options: [
              { value: "", label: "Any" },
              { value: "home", label: "Home" },
              { value: "school", label: "School" },
            ],
          },
          {
            key: "groupBy",
            legend: "Group by",
            value: groupBy,
            initial: "none",
            onChange: setGroupBy,
            options: [
              { value: "group", label: "Class" },
              { value: "none", label: "None" },
            ],
          },
        ]}
      />
    </NextIntlClientProvider>
  );
}

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Filters />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const trigger = () => container.querySelector("button") as HTMLButtonElement;
const radio = (name: string) =>
  [...container.querySelectorAll("label")]
    .find((l) => l.textContent?.trim() === name)
    ?.querySelector("input") as HTMLInputElement;
const clear = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Clear filters");
const state = () => container.querySelector('[data-testid="state"]')?.textContent;

describe("filtersOn", () => {
  it("counts the groups set away from their unfiltered choice", () => {
    expect(filtersOn([{ value: "" }, { value: "none", initial: "none" }])).toBe(0);
    expect(filtersOn([{ value: "home" }, { value: "none", initial: "none" }])).toBe(1);
    expect(filtersOn([{ value: "home" }, { value: "group", initial: "none" }])).toBe(2);
  });
});

describe("FilterMenu (D145, amends D144)", () => {
  it("is a 44px icon button named Filter, with no dot while nothing is set", () => {
    expect(trigger().getAttribute("aria-label")).toBe("Filter");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().className).toMatch(/\bsize-11\b/);
    expect(trigger().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(trigger().querySelector("[data-filter-dot]")).toBeNull();
  });

  it("opens one named radio group per filter; choosing applies, keeps it open and says how many are on", async () => {
    await act(async () => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(trigger().getAttribute("aria-controls") ?? "");
    expect(
      [...(panel?.querySelectorAll("fieldset legend") ?? [])].map((l) => l.textContent),
    ).toEqual(["Delivery", "Group by"]);
    expect(radio("Any").checked).toBe(true);
    expect(radio("None").checked).toBe(true);
    expect(clear()).toBeUndefined();
    await act(async () => radio("School").click());
    expect(state()).toBe("school|none");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-label")).toBe("Filter (1 on)");
    // The dot repeats the words; it is hidden from screen readers.
    expect(trigger().querySelector("[data-filter-dot]")?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => radio("Class").click());
    expect(trigger().getAttribute("aria-label")).toBe("Filter (2 on)");
  });

  it("clears every filter from the panel, closes it and puts focus back on the icon", async () => {
    await act(async () => trigger().click());
    await act(async () => radio("Home").click());
    await act(async () => radio("Class").click());
    await act(async () => clear()?.click());
    expect(state()).toBe("|none");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().getAttribute("aria-label")).toBe("Filter");
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on Escape and returns focus to its button", async () => {
    await act(async () => trigger().click());
    radio("Home").focus();
    await act(async () => {
      radio("Home").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });
});
