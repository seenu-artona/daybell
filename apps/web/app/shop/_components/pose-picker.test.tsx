// @vitest-environment jsdom
import type { ShopPhoto } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { PosePicker } from "./pose-picker";

// The pose thumbnails (D24, D91) with the protected image's transparent layer (D60): the radio is what a tap lands on,
// a tap on the picture still chooses its pose, and right-click and dragging stay blocked over the thumbnail.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const photo = (n: number): ShopPhoto => ({
  id: `f0000000-0000-4000-8000-00000000000${n}`,
  thumbUrl: `https://photos.example.test/${n}/proof-thumb.webp`,
  viewUrl: `https://photos.example.test/${n}/proof.webp`,
  width: 1200,
  height: 1500,
  drm: false,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(
  onChange: (id: string) => void,
  value: string | null = photo(1).id,
  groupPhotos: ShopPhoto[] = [],
) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages}>
        <PosePicker
          portraits={[photo(1), photo(2)]}
          groupPhotos={groupPhotos}
          value={value}
          onChange={onChange}
          onImageError={() => {}}
        />
      </NextIntlClientProvider>,
    ),
  );
}
const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];

describe("the pose picker (D60, D91)", () => {
  it("names each radio by its pose, the chosen one checked", () => {
    render(() => {});
    expect(radios().map((r) => r.labels?.[0]?.querySelector("img")?.alt)).toEqual([
      "Pose 1 of 2",
      "Pose 2 of 2",
    ]);
    expect(radios().map((r) => r.checked)).toEqual([true, false]);
  });

  it("stacks the radio above the image's protective layer, so the radio is the hit target", () => {
    render(() => {});
    for (const radio of radios()) {
      expect(radio.className.split(" ")).toEqual(expect.arrayContaining(["absolute", "z-10"]));
      const layer = radio.parentElement?.querySelector('span[aria-hidden="true"]');
      expect(layer?.className).not.toMatch(/\bz-/);
    }
  });

  it("chooses the pose when the radio or the picture is tapped", () => {
    const onChange = vi.fn();
    render(onChange);
    act(() => radios()[1]?.click());
    expect(onChange).toHaveBeenLastCalledWith(photo(2).id);
    render(onChange, photo(2).id);
    const layer = radios()[0]?.parentElement?.querySelector<HTMLElement>(
      'span[aria-hidden="true"]',
    );
    act(() => layer?.click());
    expect(onChange).toHaveBeenLastCalledWith(photo(1).id);
  });

  it("blocks right-click, long-press and dragging over the thumbnail", () => {
    render(() => {});
    const radio = radios()[0];
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const drag = new Event("dragstart", { bubbles: true, cancelable: true });
    act(() => {
      radio?.dispatchEvent(menu);
      radio?.dispatchEvent(drag);
    });
    expect(menu.defaultPrevented).toBe(true);
    expect(drag.defaultPrevented).toBe(true);
  });

  it("puts the group photos after the portraits, in the same radio set, each set a labelled group", () => {
    const onChange = vi.fn();
    render(onChange, photo(1).id, [photo(7), photo(8)]);
    expect(radios().map((r) => r.labels?.[0]?.querySelector("img")?.alt)).toEqual([
      "Pose 1 of 2",
      "Pose 2 of 2",
      "Group photo 1 of 2",
      "Group photo 2 of 2",
    ]);
    expect(new Set(radios().map((r) => r.name)).size).toBe(1);
    const groups = [...container.querySelectorAll('[role="group"]')];
    expect(
      groups.map(
        (g) => document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent,
      ),
    ).toEqual(["Portraits", "Group photos"]);
    act(() => radios()[3]?.click());
    expect(onChange).toHaveBeenLastCalledWith(photo(8).id);
  });

  it("shows no set titles when there are only portraits", () => {
    render(() => {});
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(0);
    expect(container.textContent).not.toContain("Group photos");
  });
});
