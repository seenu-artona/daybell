// @vitest-environment jsdom
import type { ShopPhoto } from "@daybell/api";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShakaLike } from "@/lib/shop/drm-player";
import messages from "@/messages/en-US.json";
import { DrmPhoto } from "./drm-photo";
import { DrmProvider } from "./drm-provider";

// The large view (D158; ADR 0034, C2, C7) with a fake Shaka: a protected photo plays once a frame is ready, named like
// the image it replaces, with its proof standing in and "Loading photo" said once after half a second; anything else
// falls back to the watermarked WebP, silently: no protection, no hardware DRM, 8 seconds without a frame, or two
// failures in a row (then the rest of the tab); a shown photo never falls back; one player per open viewer; the browser
// is only asked about DRM when a large view opens, and only a plan and a count are kept in the tab.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHILD = "c0000000-0000-4000-8000-000000000001";
const GALLERY = "a".repeat(32);
const photo = (n: number, drm = true): ShopPhoto => ({
  id: `f0000000-0000-4000-8000-00000000000${n}`,
  thumbUrl: `https://photos.example.test/${n}/proof-thumb.webp`,
  viewUrl: `https://photos.example.test/${n}/proof.webp`,
  width: 1600,
  height: 1067,
  drm,
});
const SUPPORTED = {
  widevineHwAll: "supported",
  widevineHwDecode: "supported",
  widevineSwDecode: "supported",
  playready3000: "notSupported",
  playready2000: "notSupported",
  playready3000KeySystem: "notSupported",
  fairplay: "notSupported",
} as const;

type Behaviour = "frame" | "never" | "error";
let behaviour: (url: string) => Behaviour;
let players: FakePlayer[];
let frame: { ready: number; width: number };

class FakePlayer extends EventTarget {
  loads: string[] = [];
  filters: ((type: number, request: { headers: Record<string, string> }) => Promise<void>)[] = [];
  destroyed = false;
  constructor() {
    super();
    players.push(this);
  }
  async attach(video: HTMLVideoElement) {
    Object.defineProperty(video, "readyState", { configurable: true, get: () => frame.ready });
    Object.defineProperty(video, "videoWidth", { configurable: true, get: () => frame.width });
  }
  configure() {
    return true;
  }
  getConfiguration() {
    return { drm: { keySystemsMapping: {} } };
  }
  getNetworkingEngine() {
    return {
      registerRequestFilter: (f: unknown) =>
        void this.filters.push(f as FakePlayer["filters"][number]),
      registerResponseFilter: () => {},
    };
  }
  async load(url: string) {
    this.loads.push(url);
    frame = { ready: 0, width: 0 };
    const b = behaviour(url);
    if (b === "error") throw Object.assign(new Error("shaka"), { code: 6007 });
    if (b === "frame") frame = { ready: 4, width: 1600 };
  }
  async destroy() {
    this.destroyed = true;
  }
  getKeyStatuses() {
    return {};
  }
}
const shaka = {
  polyfill: { installAll: () => {} },
  Player: Object.assign(FakePlayer, { isBrowserSupported: () => true }),
  net: { NetworkingEngine: { RequestType: { LICENSE: 2 } } },
  drm: { FairPlay: { commonFairPlayResponse: () => {} } },
} as unknown as ShakaLike;

let loadShaka: ReturnType<typeof vi.fn<() => Promise<ShakaLike>>>;
let probe: ReturnType<typeof vi.fn>;
let api: {
  drm: ReturnType<typeof vi.fn>;
  drmToken: ReturnType<typeof vi.fn>;
};
let root: Root;
let host: HTMLDivElement;

const enabled = {
  ok: true,
  data: {
    enabled: true,
    licenseUrls: { widevine: "https://w.test", playready: "https://p.test", fairplay: null },
    fairplayCertificateUrl: null,
    codec: "avc1.640028",
  },
};

async function view(
  p: ShopPhoto,
  target: { childId: string; galleryId: string } | null = { childId: CHILD, galleryId: GALLERY },
) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages}>
        <DrmProvider loadShaka={loadShaka} probe={probe as never} api={api as never}>
          <DrmPhoto photo={p} alt="Ava, photo 1 of 3" target={target} />
        </DrmProvider>
      </NextIntlClientProvider>,
    ),
  );
}
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const webp = () => host.querySelector('img[src$="/proof.webp"]') as HTMLImageElement | null;
const drmView = () => host.querySelector('[role="img"]');
const video = () => host.querySelector("video") as HTMLVideoElement;
const status = () => host.querySelector('[role="status"]')?.textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  players = [];
  frame = { ready: 0, width: 0 };
  behaviour = () => "frame";
  loadShaka = vi.fn(async () => shaka);
  probe = vi.fn(async () => SUPPORTED);
  api = {
    drm: vi.fn(async () => enabled),
    drmToken: vi.fn(async (_g: string, _c: string, photoId: string) => ({
      ok: true,
      data: { token: `t-${photoId}`, expiresAt: "" },
    })),
  };
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a protected photo", () => {
  it("plays once a frame is ready, named like the image it replaces; the video is hidden from assistive tech", async () => {
    await view(photo(1));
    await settle();
    expect(drmView()?.getAttribute("aria-label")).toBe("Ava, photo 1 of 3");
    expect(drmView()?.getAttribute("data-drm-photo")).toBe("shown");
    const v = video();
    expect(v.getAttribute("aria-hidden")).toBe("true");
    expect(v.muted).toBe(true);
    expect(v.hasAttribute("playsinline")).toBe(true);
    expect(v.getAttribute("crossorigin")).toBe("anonymous");
    expect(v.hasAttribute("disablepictureinpicture")).toBe(true);
    expect(v.hasAttribute("controls")).toBe(false);
    expect(v.className).toContain("opacity-100");
    expect(v.className).toContain("motion-reduce:transition-none");
    expect(webp()).toBeNull();
    expect(players[0]?.loads).toEqual([
      `/api/v1/shop/children/${CHILD}/photos/${photo(1).id}/drm-manifest?format=dash&gallery=${GALLERY}`,
    ]);
    expect(sessionStorage.getItem("daybell.shop.drmFailures")).toBe("0");
  });

  it("shows its proof while loading, and says 'Loading photo' after half a second, once", async () => {
    behaviour = () => "never";
    await view(photo(1));
    await settle();
    expect(host.querySelector('img[src$="/proof-thumb.webp"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Loading photo");
    await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
    expect(status()).toBe("Loading photo");
    expect(drmView()?.textContent).toContain("Loading photo");
    // The next photo loading slowly shows the words again but doesn't announce them again.
    await act(async () => void (await vi.advanceTimersByTimeAsync(7_500)));
    await view(photo(2));
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(status()).toBe("");
  });

  it("falls back to the WebP, silently, when nothing is shown within 8 seconds", async () => {
    behaviour = () => "never";
    await view(photo(1));
    await act(async () => void (await vi.advanceTimersByTimeAsync(7_999)));
    expect(webp()).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(webp()?.alt).toBe("Ava, photo 1 of 3");
    expect(drmView()).toBeNull();
    expect(host.textContent).toBe("");
    expect(sessionStorage.getItem("daybell.shop.drmFailures")).toBe("1");
  });

  it("after two failures in a row, the rest of the tab gets the WebP without trying", async () => {
    behaviour = () => "error";
    await view(photo(1));
    await settle();
    expect(webp()).not.toBeNull();
    await view(photo(2));
    await settle();
    expect(players[0]?.loads).toHaveLength(2);
    await view(photo(3));
    await settle();
    expect(players[0]?.loads).toHaveLength(2);
    expect(webp()?.src).toContain("/3/proof.webp");
    expect([...Object.keys(sessionStorage)].sort()).toEqual([
      "daybell.shop.drmFailures",
      "daybell.shop.drmPlan",
    ]);
  });

  it("never falls back once shown, whatever happens after", async () => {
    await view(photo(1));
    await settle();
    expect(drmView()?.getAttribute("data-drm-photo")).toBe("shown");
    await act(async () => {
      players[0]?.dispatchEvent(new CustomEvent("error", { detail: { code: 6007 } }));
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(drmView()?.getAttribute("data-drm-photo")).toBe("shown");
    expect(webp()).toBeNull();
  });

  it("uses one player while the viewer is open, a fresh token per license request for the photo shown, and destroys it on close", async () => {
    await view(photo(1));
    await settle();
    await view(photo(2));
    await settle();
    expect(players).toHaveLength(1);
    const license = { headers: {} as Record<string, string> };
    await players[0]?.filters[0]?.(2, license);
    expect(license.headers["X-AxDRM-Message"]).toBe(`t-${photo(2).id}`);
    expect(api.drmToken).toHaveBeenCalledWith(GALLERY, CHILD, photo(2).id);
    await act(async () => root.unmount());
    await settle();
    expect(players[0]?.destroyed).toBe(true);
    root = createRoot(host);
  });
});

describe("the WebP, as before", () => {
  it("for a photo that isn't protected, without asking the API or loading Shaka", async () => {
    await view(photo(1, false));
    await settle();
    expect(webp()?.alt).toBe("Ava, photo 1 of 3");
    expect(api.drm).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(loadShaka).not.toHaveBeenCalled();
  });

  it("where DRM is off for the gallery", async () => {
    api.drm.mockResolvedValue({
      ok: true,
      data: { ...enabled.data, enabled: false, licenseUrls: null },
    });
    await view(photo(1));
    await settle();
    expect(webp()).not.toBeNull();
    expect(loadShaka).not.toHaveBeenCalled();
  });

  it("where the browser has no hardware DRM: the plan is kept for the tab and Shaka never loads", async () => {
    probe.mockResolvedValue({ ...SUPPORTED, widevineHwAll: "notSupported" });
    await view(photo(1));
    await settle();
    expect(webp()).not.toBeNull();
    expect(sessionStorage.getItem("daybell.shop.drmPlan")).toBe("none");
    await view(photo(2));
    await settle();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(loadShaka).not.toHaveBeenCalled();
  });

  it("without a gallery to ask for", async () => {
    await view(photo(1), null);
    await settle();
    expect(webp()).not.toBeNull();
    expect(api.drm).not.toHaveBeenCalled();
  });
});

describe("DrmProvider (C7)", () => {
  it("asks nothing until a large view opens", async () => {
    await act(async () =>
      root.render(
        <DrmProvider loadShaka={loadShaka} probe={probe as never} api={api as never}>
          <p>Gallery</p>
        </DrmProvider>,
      ),
    );
    await settle();
    expect(probe).not.toHaveBeenCalled();
    expect(api.drm).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
});
