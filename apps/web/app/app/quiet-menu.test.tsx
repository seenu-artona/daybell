// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuietMenu } from "./quiet-menu";

// The D144 quiet menu: its visible words are its name (WCAG 2.5.3); it opens radio buttons that apply as they
// change and keep it open (so arrow keys work); Escape closes it and puts focus back on the button.
let root: Root;
let container: HTMLDivElement;

function Menu() {
  const [value, setValue] = useState("");
  const labels: Record<string, string> = { "": "Any", home: "Home", school: "School" };
  return (
    <QuietMenu
      label={`Delivery: ${labels[value]}`}
      legend="Delivery"
      value={value}
      onChange={setValue}
      options={[
        { value: "", label: "Any" },
        { value: "home", label: "Home" },
        { value: "school", label: "School" },
      ]}
    />
  );
}

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Menu />));
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

describe("QuietMenu (D144)", () => {
  it("is named by its visible words, with no separate label", () => {
    expect(trigger().textContent).toBe("Delivery: Any");
    expect(trigger().getAttribute("aria-label")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().className).toMatch(/\bmin-h-11\b/);
    expect(trigger().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("opens a named group of radio buttons; choosing applies and keeps it open", async () => {
    await act(async () => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(trigger().getAttribute("aria-controls") ?? "");
    expect(panel?.querySelector("fieldset legend")?.textContent).toBe("Delivery");
    expect(radio("Any").checked).toBe(true);
    await act(async () => radio("School").click());
    expect(trigger().textContent).toBe("Delivery: School");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(radio("School").checked).toBe(true);
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
