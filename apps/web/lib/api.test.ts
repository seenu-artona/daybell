import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { assertSameOrigin, filterValue, likePattern, parseQuery } = await import("./api");
const { page } = await import("./jobs");

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

describe("list helpers", () => {
  it("quotes PostgREST filter values so names can't add conditions", () => {
    expect(filterValue('St. Mary\'s, "North" (K-8)')).toBe('"St. Mary\'s, \\"North\\" (K-8)"');
    expect(filterValue("a\\b")).toBe('"a\\\\b"');
  });

  it("escapes LIKE wildcards in searches", () => {
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
    expect(likePattern("*")).toBe("%%");
    expect(likePattern("Lin*coln")).toBe("%Lincoln%");
  });

  it("reads query parameters and reports problems as fields", async () => {
    const { listQuery } = await import("@daybell/api");
    expect(parseQuery(new Request("https://x.test/api/v1/jobs?limit=5"), listQuery)).toEqual({
      limit: 5,
    });
    expect(() =>
      parseQuery(new Request("https://x.test/api/v1/jobs?limit=500"), listQuery),
    ).toThrow();
  });

  it("pages with a cursor only when there is more", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(page(rows, 2)).toEqual({ items: [{ id: "a" }, { id: "b" }], nextCursor: "b" });
    expect(page(rows, 3)).toEqual({ items: rows, nextCursor: null });
  });
});
