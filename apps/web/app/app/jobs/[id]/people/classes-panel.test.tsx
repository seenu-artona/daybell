// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { ClassesPanel, ClassesRow, renameButtonId } from "./classes-panel";

// Class rename's place on Subjects (D147, Seenu's answer of Oct 14): a "Classes N ›" row under the list opens the
// job's classes in the floating panel, each with a Rename button named for its class (D91).
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
});

describe("Subjects' classes", () => {
  it("the row says how many classes there are, opens the panel and says whether it is open", async () => {
    const onOpen = vi.fn();
    await render(<ClassesRow count={3} word="class" open={false} onOpen={onOpen} />);
    const row = container.querySelector("button") as HTMLButtonElement;
    expect(row.textContent).toBe("Classes3");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.className).toMatch(/\bmin-h-14\b/);
    await act(async () => row.click());
    expect(onOpen).toHaveBeenCalledOnce();
    await render(<ClassesRow count={1} word="team" open onOpen={onOpen} />);
    expect(container.querySelector("button")?.textContent).toBe("Teams1");
  });

  it("the panel lists each class with its children and a Rename button named for it", async () => {
    const onRename = vi.fn();
    const groups = [
      { id: "g1", name: "4C", childCount: 2 },
      { id: "g2", name: "Room 5", childCount: 1 },
    ];
    await render(
      <ClassesPanel
        groups={groups}
        word="class"
        focusKey="k"
        onClose={() => {}}
        onRename={onRename}
      />,
    );
    expect(container.querySelector("h2")?.textContent).toBe("This job's classes");
    expect(container.textContent).toContain("2 children");
    const rename = container.querySelector(`#${renameButtonId("g2")}`) as HTMLButtonElement;
    expect(rename.getAttribute("aria-label")).toBe("Rename class Room 5");
    await act(async () => rename.click());
    expect(onRename).toHaveBeenCalledWith(groups[1]);
  });
});
