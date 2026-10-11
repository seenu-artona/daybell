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

  it("every $ref resolves inside the document, and nullable fields are nullable", () => {
    const text = JSON.stringify(doc);
    for (const [, name] of text.matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)) {
      expect(doc.components.schemas).toHaveProperty(name as string);
    }
    expect(text).not.toContain("#/definitions/");
    expect(text).not.toContain("#/$defs/");
    expect(JSON.stringify(doc.components.schemas.Me)).toContain('"null"');
  });

  it("documents path parameters", () => {
    const del = doc.paths["/studio/invites/{id}"]?.delete as { parameters: { name: string }[] };
    expect(del.parameters[0]?.name).toBe("id");
  });

  it("documents list query parameters as optional", () => {
    const list = doc.paths["/jobs"]?.get as {
      parameters: { name: string; in: string; required: boolean }[];
    };
    expect(list.parameters.map((p) => `${p.in}:${p.name}:${p.required}`)).toEqual([
      "query:limit:false",
      "query:cursor:false",
    ]);
    const clients = doc.paths["/clients"]?.get as { parameters: { name: string }[] };
    expect(clients.parameters.map((p) => p.name)).toContain("q");
  });

  it("describes jobs, clients and categories", () => {
    expect(doc.paths["/jobs/{id}"]).toHaveProperty("patch");
    expect(doc.paths["/clients/{id}"]).toHaveProperty("patch");
    expect(doc.paths["/jobs/next-number"]).toHaveProperty("get");
    expect(doc.paths["/job-categories"]).toHaveProperty("get");
    expect(doc.paths).not.toHaveProperty("/organizations");
    expect(doc.components.schemas).toHaveProperty("Client");
    expect(doc.components.schemas).toHaveProperty("Job");
    expect(doc.tags.map((t) => t.name)).toEqual(expect.arrayContaining(["Jobs", "Contacts"]));
  });
});
