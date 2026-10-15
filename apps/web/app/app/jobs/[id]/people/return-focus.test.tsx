// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useReturnFocus } from "./return-focus";

// Unfolding the person record puts focus back on their row's name link in the full table, after the table has
// replaced the folded list (D153, WCAG 2.4.3; CI regression of round 5).
const idFor = (id: string) => `child-link-${id}`;
let unfold: () => void = () => {};

function List() {
  const [open, setOpen] = useState<string | null>("a");
  const returnTo = useReturnFocus(open, idFor);
  unfold = () => {
    returnTo(open);
    setOpen(null);
  };
  // Folded: a different element with the same id, as the folded list has; unfolded: the table's link.
  return open ? (
    <a id={idFor("a")} href="#folded" data-kind="folded">
      Ava
    </a>
  ) : (
    <a id={idFor("a")} href="#table" data-kind="table">
      Ava
    </a>
  );
}

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
});

describe("focus after unfolding (D153)", () => {
  it("lands on the full table's row link, not the folded list's", async () => {
    await act(async () => root.render(<List />));
    await act(async () => unfold());
    await act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));
    expect((document.activeElement as HTMLElement).dataset.kind).toBe("table");
  });
});
