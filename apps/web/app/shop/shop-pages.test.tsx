// @vitest-environment jsdom
import type { ShopCartResponse, ShopGallerySession, ShopPhoto } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";

// The parent shop's screens in a browser-like document (ADR 0022), with the API faked: the bag reads the bag once
// (code review M1, from the scratch reproduction that counted 1154 GET /cart calls in a second), its totals are a
// live region (S2), "Your galleries" lists each studio and only open children's names (S6, M1), a failed session read
// offers "Try again" and never the code form (S5), the viewer keeps focus on a visible button (N5), and each page
// names itself (S3), never with a child's name (R8); a forget that fails says so (R7).
const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  params: {} as Record<string, string>,
  search: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useParams: () => nav.params,
  useSearchParams: () => nav.search,
  usePathname: () => "/shop",
}));
const api = vi.hoisted(() => ({
  session: vi.fn(),
  open: vi.fn(),
  forget: vi.fn(),
  gallery: vi.fn(),
  priceList: vi.fn(),
  cart: vi.fn(),
  addLine: vi.fn(),
  setQuantity: vi.fn(),
  removeLine: vi.fn(),
  setShipping: vi.fn(),
}));
vi.mock("@/lib/shop-client", async (original) => ({
  ...(await original<typeof import("@/lib/shop-client")>()),
  shopApi: api,
}));

const { ShopProvider, useShop } = await import("./_components/shop-context");
const { default: BagPage } = await import("./bag/page");
const { default: ShopEntryPage } = await import("./page");
const { PhotoViewer } = await import("./_components/photo-viewer");
const { ShopTitle } = await import("./_components/shop-title");
const { ShopMenu } = await import("./_components/shop-menu");
const { default: GalleryPage } = await import("./c/[childId]/page");
const { coverSeen, markCoverSeen } = await import("./_components/tab-state");

const G = "0123456789abcdef0123456789abcdef";
const G2 = "fedcba9876543210fedcba9876543210";
const AVA = "c0000000-0000-4000-8000-000000000001";
const gallery = (over: Partial<ShopGallerySession> = {}): ShopGallerySession => ({
  id: G,
  studio: { name: "Maple Lane Photography" },
  expiresAt: "2026-11-11T12:00:00+00:00",
  bagCount: 0,
  children: [
    {
      id: AVA,
      state: "open",
      displayName: "Ava P.",
      firstName: "Ava",
      jobId: "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
      school: "Maple Grove Elementary",
      pictureDay: "2026-10-13",
      closesAt: null,
      deliverToSchool: true,
    },
  ],
  ...over,
});
const money = (cents: number) => ({ cents, currency: "CAD" as const });
const cart = (quantity: number, method: "school" | "home" | null = null): ShopCartResponse => ({
  lines: [
    {
      id: "11111111-0000-4000-8000-000000000001",
      childId: AVA,
      itemId: "22222222-0000-4000-8000-000000000001",
      kind: "print",
      name: "5×7 print",
      printSize: "5x7",
      unitPrice: money(1900),
      quantity,
      lineTotal: money(1900 * quantity),
      available: true,
      physical: true,
      photo: null,
    },
  ],
  count: quantity,
  subtotal: money(1900 * quantity),
  shipping: {
    needed: true,
    home: money(1195),
    school: true,
    method,
    cost: method ? money(0) : null,
  },
  total: method ? money(1900 * quantity) : null,
});
const ok = <T,>(data: T) => ({ ok: true as const, data });

let container: HTMLDivElement;
let root: Root;
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function render(ui: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="America/Toronto">
        <ShopProvider>{ui}</ShopProvider>
      </NextIntlClientProvider>,
    );
  });
  await wait(20);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  nav.search = new URLSearchParams();
  for (const fn of Object.values(api)) fn.mockReset();
  for (const fn of Object.values(nav.router)) fn.mockReset();
  api.session.mockResolvedValue(ok({ galleries: [gallery()] }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the bag (code review M1, S2)", () => {
  it("reads the bag once when it opens, however the header's count changes (regression: 1154 reads a second)", async () => {
    nav.search = new URLSearchParams({ gallery: G });
    api.cart.mockResolvedValue(ok(cart(2)));
    await render(<BagPage />);
    await wait(500);
    expect(api.cart).toHaveBeenCalledTimes(1);
    expect(api.cart).toHaveBeenCalledWith(G);
    expect(container.querySelector('a[aria-label="Bag, 2 items"]')).not.toBeNull();
  });

  it("re-reads nothing after a change: the change's answer is the bag", async () => {
    api.cart.mockResolvedValue(ok(cart(1)));
    api.setQuantity.mockResolvedValue(ok(cart(2, "school")));
    await render(<BagPage />);
    const more = container.querySelector<HTMLButtonElement>('button[aria-label="One more"]');
    await act(async () => more?.click());
    await wait(100);
    expect(api.setQuantity).toHaveBeenCalledWith(G, "11111111-0000-4000-8000-000000000001", 2);
    expect(api.cart).toHaveBeenCalledTimes(1);
  });

  it("announces the totals as a whole when they change (S2)", async () => {
    api.cart.mockResolvedValue(ok(cart(1)));
    api.setShipping.mockResolvedValue(ok(cart(1, "school")));
    await render(<BagPage />);
    const live = container.querySelector('[aria-live="polite"][aria-atomic="true"]');
    expect(live?.textContent).toContain("Choose delivery");
    const school = container.querySelector<HTMLInputElement>('input[value="school"]');
    await act(async () => school?.click());
    await wait(50);
    expect(api.setShipping).toHaveBeenCalledWith(G, "school");
    expect(live?.textContent).toContain("Total $19.00");
  });

  it("checks a delivery radio as soon as it's clicked, and puts the saved one back if the bag refuses (D91)", async () => {
    api.cart.mockResolvedValue(ok(cart(1, "home")));
    let answer: (r: unknown) => void = () => {};
    api.setShipping.mockReturnValue(
      new Promise((r) => {
        answer = r;
      }),
    );
    await render(<BagPage />);
    const school = container.querySelector<HTMLInputElement>('input[value="school"]');
    const home = container.querySelector<HTMLInputElement>('input[value="home"]');
    expect(home?.checked).toBe(true);
    await act(async () => school?.click());
    expect(school?.checked).toBe(true);
    expect(home?.checked).toBe(false);
    expect(school?.disabled).toBe(false);
    expect(api.setShipping).toHaveBeenCalledWith(G, "school");
    await act(async () =>
      answer({ ok: false, status: 503, code: "network", form: null, retryAfter: null }),
    );
    await wait(20);
    expect(school?.checked).toBe(false);
    expect(home?.checked).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).not.toBe("");
  });

  it("names each delivery radio by its words alone, its price as its description (S4)", async () => {
    api.cart.mockResolvedValue(ok(cart(1)));
    await render(<BagPage />);
    const names = [...container.querySelectorAll<HTMLInputElement>('input[name="delivery"]')].map(
      (input) => [
        document.getElementById(input.getAttribute("aria-labelledby") ?? "")?.textContent,
        document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent,
      ],
    );
    expect(names).toEqual([
      ["Delivery to school", "Free"],
      ["Home delivery", "$11.95"],
    ]);
  });
});

describe("the session's provider (code review M1)", () => {
  it("keeps one setBagCount, and leaves the state alone when the count is the same", async () => {
    const seen: unknown[] = [];
    let renders = 0;
    function Probe() {
      const shop = useShop();
      renders += 1;
      seen.push(shop.setBagCount);
      return <button type="button" onClick={() => shop.setBagCount(G, 0)} />;
    }
    await render(<Probe />);
    expect(new Set(seen).size).toBe(1);
    const before = renders;
    await act(async () => container.querySelector("button")?.click());
    expect(renders).toBe(before);
  });
});

describe("/shop (S5, S6)", () => {
  it("lists the device's galleries: each studio, with only its open children's names", async () => {
    api.session.mockResolvedValue(
      ok({
        galleries: [
          gallery(),
          gallery({
            id: G2,
            studio: { name: "Studio B" },
            children: [{ id: "c0000000-0000-4000-8000-000000000009", state: "closed" }],
          }),
        ],
      }),
    );
    await render(<ShopEntryPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Your galleries");
    const links = [...container.querySelectorAll('ul[aria-label="Galleries on this device"] a')];
    expect(links.map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      [`/shop/c/${AVA}`, "Maple Lane PhotographyAva P."],
      ["/shop/c/c0000000-0000-4000-8000-000000000009", "Studio B"],
    ]);
    expect(container.querySelector('input[name="code"]')).not.toBeNull();
    expect(document.title).toBe("Your galleries");
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("goes straight to the only gallery's first child", async () => {
    await render(<ShopEntryPage />);
    expect(nav.router.replace).toHaveBeenCalledWith(`/shop/c/${AVA}`);
  });

  it("offers Try again, never the code form, when the galleries couldn't be read (S5)", async () => {
    api.session.mockResolvedValue({
      ok: false,
      status: 0,
      code: "network",
      form: null,
      retryAfter: null,
    });
    await render(<ShopEntryPage />);
    expect(container.querySelector('input[name="code"]')).toBeNull();
    const retry = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Try again",
    );
    expect(retry).toBeDefined();
    api.session.mockResolvedValue(ok({ galleries: [] }));
    await act(async () => retry?.click());
    await wait(20);
    expect(container.querySelector('input[name="code"]')).not.toBeNull();
  });
});

describe("the viewer (code review N5)", () => {
  const photo = (n: number): ShopPhoto => ({
    id: `f0000000-0000-4000-8000-00000000000${n}`,
    thumbUrl: `https://photos.example.test/${n}/proof-thumb.webp`,
    viewUrl: `https://photos.example.test/${n}/proof.webp`,
    width: 1200,
    height: 1500,
  });
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  function Viewer({ photos }: { photos: ShopPhoto[] }) {
    const [index, setIndex] = useState<number | null>(0);
    return (
      <PhotoViewer
        photos={photos}
        index={index}
        onIndex={setIndex}
        onClose={() => setIndex(null)}
        alt={(n, total) => `Photo ${n} of ${total}`}
        orderHref={null}
      />
    );
  }
  const button = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

  it("moves focus to Previous when Next reaches the last photo, and back", async () => {
    await render(<Viewer photos={[photo(1), photo(2)]} />);
    button("Next photo")?.focus();
    await act(async () => button("Next photo")?.click());
    expect(button("Next photo")?.disabled).toBe(true);
    expect(document.activeElement).toBe(button("Previous photo"));
    await act(async () => button("Previous photo")?.click());
    expect(document.activeElement).toBe(button("Next photo"));
  });
});

describe("page titles (code review S3)", () => {
  it("names the page in the document's title, and keeps it if the head is rewritten", async () => {
    await render(<ShopTitle>Bag</ShopTitle>);
    expect(document.title).toBe("Bag");
    await act(async () => {
      document.title = "Your photos";
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(document.title).toBe("Bag");
  });
});

describe("the gallery's title (security review R8)", () => {
  it("never names the child: titles reach history and tab sync", async () => {
    nav.params = { childId: AVA };
    nav.search = new URLSearchParams({ gallery: G });
    api.gallery.mockReturnValue(new Promise(() => {}));
    await render(<GalleryPage />);
    expect(document.title).toBe("Your child’s photos");
    expect(document.title).not.toContain("Ava");
  });
});

describe("Forget this device (security review R7)", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });
  const byText = (text: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === text);

  it("says so when forgetting fails, and keeps the dialog open; then forgets", async () => {
    await render(<ShopMenu gallery={G} />);
    await act(async () => byText("Forget this device")?.click());
    api.forget.mockResolvedValue({
      ok: false,
      status: 429,
      code: "rate_limited",
      form: null,
      retryAfter: 60,
    });
    await act(async () => byText("Forget")?.click());
    await wait(20);
    expect(api.forget).toHaveBeenCalledWith(null);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "We couldn’t forget this yet. Check your connection and try again.",
    );
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(nav.router.replace).not.toHaveBeenCalled();
    api.forget.mockResolvedValue(ok(undefined));
    await act(async () => byText("Forget")?.click());
    await wait(20);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(nav.router.replace).toHaveBeenCalledWith("/shop");
  });

  // Forgetting leaves nothing about the gallery in the browser: the tab's "cover seen" flags go too, so the cover
  // shows again when the code is entered again (regression: e2e shop-checkout step 8 never saw "See photos").
  const BEN = "c0000000-0000-4000-8000-000000000002";
  const ben = gallery().children.map((c) => ({
    ...c,
    id: BEN,
    displayName: "Ben Q.",
    firstName: "Ben",
  }));
  afterEach(() => window.sessionStorage.clear());

  it("clears every shop key in the tab when it forgets the whole device", async () => {
    markCoverSeen(AVA);
    markCoverSeen(BEN);
    window.sessionStorage.setItem("unrelated", "kept");
    api.forget.mockResolvedValue(ok(undefined));
    await render(<ShopMenu gallery={G} />);
    await act(async () => byText("Forget this device")?.click());
    expect(coverSeen(AVA)).toBe(true);
    await act(async () => byText("Forget")?.click());
    await wait(20);
    expect(api.forget).toHaveBeenCalledWith(null);
    expect(coverSeen(AVA)).toBe(false);
    expect(coverSeen(BEN)).toBe(false);
    expect(window.sessionStorage.getItem("unrelated")).toBe("kept");
  });

  it("clears only the forgotten gallery's children when it forgets one gallery", async () => {
    api.session.mockResolvedValue(
      ok({
        galleries: [
          gallery(),
          gallery({ id: G2, studio: { name: "Birch Studio" }, children: ben }),
        ],
      }),
    );
    markCoverSeen(AVA);
    markCoverSeen(BEN);
    api.forget.mockResolvedValue(ok(undefined));
    await render(<ShopMenu gallery={G} />);
    await act(async () => byText("Forget this device")?.click());
    await act(async () => byText("Forget this gallery")?.click());
    await wait(20);
    expect(api.forget).toHaveBeenCalledWith(G);
    expect(coverSeen(AVA)).toBe(false);
    expect(coverSeen(BEN)).toBe(true);
  });
});
