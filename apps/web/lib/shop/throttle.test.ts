import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { clientAddress, networkOf } = await import("./throttle");
const { requestCookie, tokenHash } = await import("./session");

describe("networkOf (call 4)", () => {
  it("keeps an IPv4 address, and an IPv4-mapped one as IPv4", () => {
    expect(networkOf("203.0.113.7")).toBe("203.0.113.7");
    expect(networkOf("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("buckets IPv6 by its /64, however it is written", () => {
    const net = "2001:0db8:0001:0002::/64";
    expect(networkOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(net);
    expect(networkOf("2001:db8:1:2::1")).toBe(net);
    expect(networkOf("[2001:DB8:1:2::ffff]")).toBe(net);
    expect(networkOf("2001:db8:1:2::1%eth0")).toBe(net);
    expect(networkOf("2001:db8:1:3::1")).not.toBe(net);
    expect(networkOf("::1")).toBe("0000:0000:0000:0000::/64");
  });

  it("is unknown for anything else", () => {
    for (const bad of ["", "unknown", "1::2::3", "2001:db8:1:2:3:4:5:6:7", "zz::1", "a:b:c"])
      expect(networkOf(bad)).toBe("unknown");
  });
});

describe("clientAddress", () => {
  it("is the first x-forwarded-for entry (Vercel's own), then x-real-ip, else unknown", () => {
    const req = (headers: Record<string, string>) => new Request("http://x", { headers });
    expect(clientAddress(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientAddress(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddress(req({}))).toBe("unknown");
  });
});

describe("the session cookie", () => {
  it("reads one cookie by name", () => {
    const req = new Request("http://x", { headers: { cookie: "a=1; daybell_shop=ca.x ;b=2" } });
    expect(requestCookie(req, "daybell_shop")).toBe("ca.x");
    expect(requestCookie(req, "missing")).toBeUndefined();
  });

  it("keeps only the token's SHA-256", () => {
    expect(tokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
