import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)));
vi.stubEnv("SHOP_THROTTLE_KEY", key);
const { clientAddress, codeKeys, networksOf, signDevice, verifiedDevice } = await import(
  "./throttle"
);
const { galleryId, requestCookie, shopCookieName, shopCookieOptions, tokenHash } = await import(
  "./session"
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("SHOP_THROTTLE_KEY", key);
});

describe("networksOf (call 4; security review H1, L4)", () => {
  it("keeps an IPv4 address, with its /24, and an IPv4-mapped one as IPv4", () => {
    const net = { net: "203.0.113.7", wide: "203.0.113.0/24", wider: null };
    expect(networksOf("203.0.113.7")).toEqual(net);
    expect(networksOf("::ffff:203.0.113.7")).toEqual(net);
    expect(networksOf("203.0.113.200").wide).toBe(net.wide);
  });

  it("buckets IPv6 by its /64, /56 and /48, however it is written", () => {
    const net = {
      net: "2001:0db8:0001:0002::/64",
      wide: "2001:0db8:0001:0000::/56",
      wider: "2001:0db8:0001::/48",
    };
    expect(networksOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toEqual(net);
    expect(networksOf("2001:db8:1:2::1")).toEqual(net);
    expect(networksOf("[2001:DB8:1:2::ffff]")).toEqual(net);
    expect(networksOf("2001:db8:1:2::1%eth0")).toEqual(net);
    expect(networksOf("2001:db8:1:3::1").net).not.toBe(net.net);
    expect(networksOf("2001:db8:1:3::1").wide).toBe(net.wide);
    expect(networksOf("2001:db8:1:ff02::1").wide).toBe("2001:0db8:0001:ff00::/56");
    expect(networksOf("2001:db8:2::1").wider).not.toBe(net.wider);
  });

  it("puts anything else, and no address, in one strict bucket", () => {
    const strict = { net: "untrusted", wide: "untrusted", wider: null };
    for (const bad of [
      "",
      "unknown",
      "1::2::3",
      "2001:db8:1:2:3:4:5:6:7",
      "zz::1",
      "a:b:c",
      "999.1.1.1",
    ])
      expect(networksOf(bad)).toEqual(strict);
    expect(networksOf(null)).toEqual(strict);
  });
});

describe("clientAddress (security review L4)", () => {
  const req = (headers: Record<string, string>) => new Request("http://x", { headers });

  it("on Vercel, trusts only Vercel's own header", () => {
    vi.stubEnv("VERCEL", "1");
    expect(
      clientAddress(req({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "1.2.3.4" })),
    ).toBe("203.0.113.7");
    expect(clientAddress(req({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4" }))).toBeNull();
  });

  it("off Vercel (development, CI), the local server's x-forwarded-for, then x-real-ip", () => {
    vi.stubEnv("VERCEL", "");
    expect(clientAddress(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientAddress(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddress(req({}))).toBeNull();
  });
});

describe("signed devices (security review H1, L6)", () => {
  const id = "D".repeat(43);
  const now = 1_800_000_000;

  it("counts only a device this server signed, for 30 days", () => {
    const value = signDevice(id, now);
    expect(value).toMatch(/^D{43}\.1800000000\.[A-Za-z0-9_-]{43}$/);
    expect(verifiedDevice(value, now)).toBe(id);
    expect(verifiedDevice(value, now + 30 * 86_400 - 1)).toBe(id);
    expect(verifiedDevice(value, now + 30 * 86_400)).toBeNull();
    expect(verifiedDevice(value, now - 3600)).toBeNull();
  });

  it("refuses a forged, altered or bare device id", () => {
    const value = signDevice(id, now);
    expect(verifiedDevice(id, now)).toBeNull();
    expect(verifiedDevice(`${"E".repeat(43)}${value.slice(43)}`, now)).toBeNull();
    expect(verifiedDevice(value.replace(".1800000000.", ".1800000001."), now)).toBeNull();
    expect(
      verifiedDevice(`${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`, now),
    ).toBeNull();
    expect(verifiedDevice(undefined, now)).toBeNull();
  });

  it("offers a new device only to a request without a signed one, and keys a device apart from its network", () => {
    const at = now * 1000;
    const fresh = codeKeys(
      new Request("http://localhost/x", { headers: { "x-forwarded-for": "203.0.113.7" } }),
      at,
    );
    expect(fresh.deviceKey).toBeNull();
    expect(fresh.offer?.deviceKey).toMatch(/^[0-9a-f]{64}$/);
    expect(fresh.widerKey).toBeNull();
    const cookie = `daybell_device=${fresh.offer?.cookie}`;
    const back = (address: string) =>
      codeKeys(
        new Request("http://localhost/x", { headers: { cookie, "x-forwarded-for": address } }),
        at,
      );
    const home = back("203.0.113.7");
    const away = back("198.51.100.1");
    expect(home.offer).toBeNull();
    expect(home.deviceKey).toBe(fresh.offer?.deviceKey);
    expect(away.deviceKey).toBe(home.deviceKey);
    expect(away.networkKey).not.toBe(home.networkKey);
    expect(JSON.stringify([home, away])).not.toMatch(/203\.0|198\.51|D{43}/);
  });
});

describe("the session cookie (security review L1)", () => {
  it("reads one cookie by its exact name", () => {
    const req = new Request("http://x", { headers: { cookie: "a=1; daybell_shop=ca.x ;b=2" } });
    expect(requestCookie(req, "daybell_shop")).toBe("ca.x");
    expect(requestCookie(req, "missing")).toBeUndefined();
  });

  it("is __Host- prefixed and Secure over HTTPS, plain only on http://localhost", () => {
    const https = new Request("https://shop.example.test/api/v1/shop/session");
    expect(shopCookieName(https, "daybell_shop")).toBe("__Host-daybell_shop");
    expect(shopCookieOptions(https, 60)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60,
    });
    for (const url of ["http://localhost:3000/x", "http://127.0.0.1/x"]) {
      expect(shopCookieName(new Request(url), "daybell_shop")).toBe("daybell_shop");
      expect(shopCookieOptions(new Request(url), 60).secure).toBe(false);
    }
    expect(shopCookieName(new Request("http://shop.example.test/x"), "daybell_shop")).toBe(
      "__Host-daybell_shop",
    );
  });

  it("keeps only the token's SHA-256, and names a gallery by a one-way hash", () => {
    expect(tokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(galleryId("T".repeat(43))).toMatch(/^[0-9a-f]{32}$/);
    expect(galleryId("T".repeat(43))).not.toBe(tokenHash("T".repeat(43)).slice(0, 32));
  });
});
