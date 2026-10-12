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
      "query:today:false",
    ]);
    const clients = doc.paths["/clients"]?.get as { parameters: { name: string }[] };
    expect(clients.parameters.map((p) => p.name)).toContain("q");
  });

  it("describes the checklist on jobs and Home (D143)", () => {
    expect(doc.paths["/studio/checklist"]).toHaveProperty("get");
    for (const name of ["JobListItem", "JobChecklistSummary", "StudioChecklist", "UpNextReason"])
      expect(doc.components.schemas).toHaveProperty(name);
    const checklist = doc.paths["/studio/checklist"]?.get as { parameters: { name: string }[] };
    expect(checklist.parameters.map((p) => p.name)).toEqual(["today"]);
  });

  it("describes jobs and clients", () => {
    expect(doc.paths["/jobs/{id}"]).toHaveProperty("patch");
    expect(doc.paths["/clients/{id}"]).toHaveProperty("patch");
    expect(doc.paths["/jobs/next-number"]).toHaveProperty("get");
    expect(doc.paths).not.toHaveProperty("/job-categories");
    expect(doc.paths).not.toHaveProperty("/organizations");
    expect(doc.components.schemas).toHaveProperty("Client");
    expect(doc.components.schemas).toHaveProperty("Job");
    expect(doc.tags.map((t) => t.name)).toEqual(expect.arrayContaining(["Jobs", "Contacts"]));
  });

  it("describes the roster", () => {
    type Op = { "x-access": string; parameters?: { name: string; in: string }[] };
    const op = (path: string, method: string) =>
      (doc.paths[path] as Record<string, Op> | undefined)?.[method];
    for (const [path, method] of [
      ["/jobs/{id}/children", "get"],
      ["/jobs/{id}/children", "post"],
      ["/children/{id}", "patch"],
      ["/children/{id}", "delete"],
      ["/jobs/{id}/groups", "get"],
      ["/jobs/{id}/groups", "post"],
      ["/groups/{id}", "patch"],
      ["/jobs/{id}/children/import", "post"],
    ] as const) {
      const route = op(path, method);
      expect(route, `${method} ${path}`).toBeDefined();
      expect(route?.parameters?.[0]).toMatchObject({ name: "id", in: "path" });
      expect(route?.["x-access"]).toBe(method === "get" ? "signed-in" : "roster-editor");
    }
    expect(doc.components.schemas).toHaveProperty("Child");
    expect(doc.components.schemas).toHaveProperty("Group");
    expect(JSON.stringify(doc.components.schemas.Child)).not.toContain("accessCodeHash");
    expect(doc.tags.map((t) => t.name)).toContain("Roster");
  });

  it("describes the menu search as a POST, so the text never goes in a URL (ADR 0013)", () => {
    const search = doc.paths["/search"] as Record<string, unknown> | undefined;
    expect(search).toHaveProperty("post");
    expect(search).not.toHaveProperty("get");
    expect(doc.components.schemas).toHaveProperty("SearchJob");
    expect(doc.tags.map((t) => t.name)).toContain("Search");
  });

  it("describes one client and the job filter on activity", () => {
    expect(doc.paths["/clients/{id}"]).toHaveProperty("get");
    const activity = doc.paths["/studio/activity"]?.get as { parameters: { name: string }[] };
    expect(activity.parameters.map((p) => p.name)).toEqual(["jobId"]);
  });

  it("describes QR cards: a PDF from a POST body, and the Overview's card counts", () => {
    type Op = {
      "x-access": string;
      requestBody?: { content: Record<string, unknown> };
      responses: Record<
        string,
        { content?: Record<string, { schema: unknown }>; headers?: object }
      >;
    };
    const paths = doc.paths["/jobs/{id}/qr-cards"] as Record<string, Op> | undefined;
    const print = paths?.post;
    expect(print?.["x-access"]).toBe("roster-editor");
    expect(print?.requestBody?.content).toHaveProperty("application/json");
    expect(print?.responses["200"]?.content).toEqual({
      "application/pdf": { schema: { type: "string", format: "binary" } },
    });
    expect(Object.keys(print?.responses["200"]?.headers ?? {})).toEqual([
      "Daybell-Cards",
      "Daybell-Cards-Skipped",
      "Daybell-Cards-Replaced-Characters",
    ]);
    expect(Object.keys(print?.responses ?? {})).toEqual(
      expect.arrayContaining(["400", "401", "403", "404", "409"]),
    );
    expect(paths?.get?.["x-access"]).toBe("signed-in");
    expect(doc.components.schemas).toHaveProperty("QrCardStatus");
  });

  it("describes photos: uploads by owners, admins and photographers, reads by the team", () => {
    type Op = { "x-access": string; "x-internal"?: boolean };
    const op = (path: string, method: string) =>
      (doc.paths[path] as Record<string, Op> | undefined)?.[method];
    expect(op("/jobs/{id}/upload-batches", "post")?.["x-access"]).toBe("uploader");
    expect(op("/upload-batches/{id}/files", "post")?.["x-access"]).toBe("uploader");
    expect(op("/jobs/{id}/photos/bin", "post")?.["x-access"]).toBe("uploader");
    expect(op("/jobs/{id}/photos", "get")?.["x-access"]).toBe("signed-in");
    expect(op("/photos/{id}", "get")?.["x-access"]).toBe("signed-in");
    expect(doc.components.schemas).toHaveProperty("Photo");
    // Filenames travel in bodies only: no photo route takes one in its path or query.
    expect(JSON.stringify(Object.keys(doc.paths))).not.toMatch(/name/i);
  });

  it("marks the image worker's and the cron's routes as internal", () => {
    type Op = { "x-access": string; "x-internal"?: boolean };
    for (const [path, method] of [
      ["/internal/photo-worker/photos/{id}", "get"],
      ["/internal/photo-worker/photos/{id}/result", "post"],
      ["/internal/cron/photos", "get"],
    ] as const) {
      const route = (doc.paths[path] as Record<string, Op> | undefined)?.[method];
      expect(route?.["x-internal"], path).toBe(true);
    }
    expect(
      (doc.paths["/jobs/{id}/photos"] as Record<string, Op>).get?.["x-internal"],
    ).toBeUndefined();
  });
});
