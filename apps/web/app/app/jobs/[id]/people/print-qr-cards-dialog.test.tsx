// @vitest-environment jsdom
import type { Child } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { PrintQrCardsDialog } from "./print-qr-cards-dialog";

// The Print QR cards dialog (ADR 0015, ADR 0018's amendment of Oct 13, 2026): cards are counted in double-sided
// sheets, and the instruction to print double-sided, flipped on the long edge, sits by the button and describes it.
vi.mock("@/lib/client-api", () => ({ download: vi.fn() }));

const child = (n: number) =>
  ({
    id: `c${n}`,
    firstName: "Kid",
    lastName: `${n}`,
    group: null,
    doNotPhotograph: false,
  }) as unknown as Child;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("PrintQrCardsDialog", () => {
  it("counts sheets and says to print double-sided, flipped on the long edge, by the button", async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
          <PrintQrCardsDialog
            open
            onClose={() => {}}
            jobId="j1"
            roster={[1, 2, 3, 4, 5].map(child)}
            groups={[]}
            word="class"
            onPrinted={() => {}}
          />
        </NextIntlClientProvider>,
      );
    });
    const text = container.textContent ?? "";
    expect(text).toContain("5 cards on 2 sheets of US Letter");
    // Blank cards ask for the name and class (D138).
    expect(text).toContain(
      "Extra cards with lines for the name and class and their own access code",
    );
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Download PDF",
    );
    const described = button?.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    const description = (described ?? "")
      .split(" ")
      .map((ref) => container.ownerDocument.getElementById(ref)?.textContent);
    expect(description).toEqual([messages.app.qrCards.duplex, messages.app.qrCards.checkNames]);
    expect(messages.app.qrCards.checkNames).toBe(
      "Check the name on the back matches the front before handing cards out.",
    );
    expect(messages.app.qrCards.duplex).toBe("Print double-sided, flip on long edge");
  });
});
