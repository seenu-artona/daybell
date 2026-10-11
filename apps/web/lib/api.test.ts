import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { assertSameOrigin } = await import("./api");

const url = "https://daybell.vercel.app/api/v1/studio/invites/abc";
const req = (method: string, headers: Record<string, string>, body?: string) =>
  new Request(url, {
    method,
    headers: { host: "daybell.vercel.app", ...headers },
    ...(body ? { body } : {}),
  });

describe("assertSameOrigin (CSRF guard)", () => {
  it("allows a same-site DELETE with no body", () => {
    expect(() =>
      assertSameOrigin(
        req("DELETE", { origin: "https://daybell.vercel.app", "sec-fetch-site": "same-origin" }),
      ),
    ).not.toThrow();
  });

  it("allows same-site JSON", () => {
    expect(() =>
      assertSameOrigin(
        req(
          "POST",
          {
            origin: "https://daybell.vercel.app",
            "content-type": "application/json",
            "content-length": "2",
          },
          "{}",
        ),
      ),
    ).not.toThrow();
  });

  it("refuses cross-site writes", () => {
    expect(() =>
      assertSameOrigin(
        req("POST", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
      ),
    ).toThrow();
    expect(() => assertSameOrigin(req("DELETE", { origin: "https://evil.example" }))).toThrow();
  });

  it("refuses non-JSON bodies (plain HTML form posts)", () => {
    expect(() =>
      assertSameOrigin(
        req("POST", { "content-type": "text/plain", "content-length": "5" }, "x=1&y"),
      ),
    ).toThrow();
  });
});
