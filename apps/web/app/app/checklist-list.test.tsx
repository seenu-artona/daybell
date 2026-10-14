// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import messages from "@/messages/en-US.json";
import { ChecklistGroups, type ChecklistLook } from "./checklist-list";

// Home's setup checklist uses look="rows" (D145, amends D144): full-width 56px rows at 16px that turn canvas grey on
// hover, underline the task and end with a faint chevron hidden from screen readers. The job Overview keeps "plain".
let root: Root;
let container: HTMLDivElement;

async function render(look?: ChecklistLook) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages}>
        <ChecklistGroups
          {...(look ? { look } : {})}
          groups={[
            {
              key: "onboarding",
              rows: [
                { key: "account", label: "Create your account", state: "done", href: null },
                {
                  key: "payouts",
                  label: "Set up payouts",
                  state: "next",
                  href: "/app/settings/payouts",
                },
              ],
            },
          ]}
        />
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

describe("ChecklistGroups", () => {
  it('look="rows": link rows in the ClickableRow style with a hidden chevron', async () => {
    await render("rows");
    const link = container.querySelector('a[href="/app/settings/payouts"]') as HTMLAnchorElement;
    expect(link.className).toMatch(/\bmin-h-14\b/);
    expect(link.className).toMatch(/\btext-body-lg\b/);
    expect(link.className).toMatch(/\bpx-6\b/);
    expect(link.className).toMatch(/\bhover:bg-canvas\b/);
    // The name stays the label and its state in words; the chevron is decorative.
    expect(link.textContent).toBe("Set up payoutsNext");
    const chevron = link.querySelector("svg:last-child");
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    expect(chevron?.getAttribute("class")).toMatch(/\btext-line-strong\b/);
    expect(link.querySelector(".group-hover\\:underline")?.textContent).toBe("Set up payouts");
    // A row with nowhere to go has no chevron and no hover.
    const plain = container.querySelectorAll("li")[0]?.firstElementChild as HTMLElement;
    expect(plain.tagName).toBe("DIV");
    expect(plain.querySelectorAll("svg")).toHaveLength(1);
    expect(plain.className).not.toMatch(/\bhover:/);
  });

  it("plain (the job Overview) keeps its look: no chevron, 14px", async () => {
    await render();
    const link = container.querySelector('a[href="/app/settings/payouts"]') as HTMLAnchorElement;
    expect(link.className).toMatch(/\btext-body\b/);
    expect(link.className).not.toMatch(/\btext-body-lg\b/);
    expect(link.className).toMatch(/\bhover:bg-subtle\b/);
    expect(link.querySelectorAll("svg")).toHaveLength(0);
  });
});
