import { describe, expect, it } from "vitest";
import { buildOpenApi, ROUTES } from "./routes";

describe("API description", () => {
  const doc = buildOpenApi("https://example.test");

  it("lists every route once", () => {
    const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("produces OpenAPI with bodies and responses for each route", () => {
    expect(doc.openapi).toBe("3.1.0");
    const signUp = doc.paths["/auth/sign-up"]?.post as {
      requestBody?: unknown;
      responses: Record<string, unknown>;
    };
    expect(signUp.requestBody).toBeDefined();
    expect(Object.keys(signUp.responses)).toEqual(expect.arrayContaining(["201", "400", "409"]));
  });

  it("documents path parameters", () => {
    const del = doc.paths["/studio/invites/{id}"]?.delete as { parameters: { name: string }[] };
    expect(del.parameters[0]?.name).toBe("id");
  });
});
