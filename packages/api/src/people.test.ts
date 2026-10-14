import { describe, expect, it } from "vitest";
import { buildOpenApi } from "./routes";
import {
  contactInput,
  contactListQuery,
  contactPatch,
  contactSearchInput,
  fieldErrors,
  LIST_FILTER_KEYS,
  listFiltersInput,
  subjectListQuery,
  subjectSearchInput,
} from "./schemas";

// People (D150, ADR 0028): contacts (answer 3), subjects across all jobs (answer 4) and the People lists' saved chips
// (answer 6). People are searched only from a POST body (D113): no list query takes text.
const CLIENT = "c0000000-0000-4000-8000-000000000001";
const JOB = "a0000000-0000-4000-8000-000000000001";

describe("contactInput", () => {
  it("takes a client and a name, an email or a phone; trims, lower-cases the email", () => {
    expect(
      contactInput.parse({
        clientId: CLIENT,
        firstName: " Dana ",
        lastName: "Ruiz",
        role: "Office manager",
        email: " Office@Lincoln.Example ",
        isMain: true,
      }),
    ).toEqual({
      clientId: CLIENT,
      firstName: "Dana",
      lastName: "Ruiz",
      role: "Office manager",
      email: "office@lincoln.example",
      isMain: true,
    });
    expect(contactInput.safeParse({ clientId: CLIENT, email: "a@b.example" }).success).toBe(true);
    expect(contactInput.safeParse({ clientId: CLIENT, phone: "555 0100" }).success).toBe(true);
  });

  it("refuses a contact who is nobody, a missing client, and over-long text", () => {
    const errors = (value: unknown) => {
      const r = contactInput.safeParse(value);
      return r.success ? null : fieldErrors(r.error);
    };
    expect(errors({ clientId: CLIENT, role: "Principal" })).toEqual({
      firstName: "validation.contactEmpty",
    });
    expect(errors({ firstName: "Dana" })).toEqual({ clientId: "validation.client" });
    expect(errors({ clientId: CLIENT, firstName: "x".repeat(61) })).toEqual({
      firstName: "validation.tooLong",
    });
    expect(errors({ clientId: CLIENT, firstName: "Dana", role: "r".repeat(61) })).toEqual({
      role: "validation.tooLong",
    });
    expect(errors({ clientId: CLIENT, email: "not an email" })).toEqual({
      email: "validation.email",
    });
  });
});

describe("contactPatch", () => {
  it("changes some fields, never the client, and needs something to change", () => {
    expect(contactPatch.parse({ isMain: true })).toEqual({ isMain: true });
    expect(contactPatch.parse({ role: null })).toEqual({ role: null });
    expect(contactPatch.safeParse({ clientId: CLIENT }).success).toBe(false);
    expect(contactPatch.safeParse({}).success).toBe(false);
  });
});

describe("list queries carry no text (D113)", () => {
  it("Contacts: main only, or one client", () => {
    expect(contactListQuery.parse({ show: "main", clientId: CLIENT })).toMatchObject({
      show: "main",
      clientId: CLIENT,
      limit: 50,
    });
    expect(contactListQuery.safeParse({ show: "everyone" }).success).toBe(false);
    expect(contactListQuery.shape).not.toHaveProperty("q");
  });

  it("Subjects: ordered or not, a job, a client", () => {
    expect(
      subjectListQuery.parse({ show: "notOrdered", jobId: JOB, clientId: CLIENT }),
    ).toMatchObject({ show: "notOrdered", jobId: JOB, clientId: CLIENT });
    expect(subjectListQuery.safeParse({ show: "noFamily" }).success).toBe(false);
    expect(subjectListQuery.shape).not.toHaveProperty("q");
  });

  it("the searches take their text in a body, 1 to 120 characters", () => {
    expect(subjectSearchInput.parse({ q: " maya ", show: "ordered" })).toMatchObject({
      q: "maya",
      show: "ordered",
    });
    expect(contactSearchInput.safeParse({ q: "  " }).success).toBe(false);
    expect(contactSearchInput.safeParse({ q: "x".repeat(121) }).success).toBe(false);
  });
});

describe("the People lists' saved chips (answer 6)", () => {
  it("Clients takes none, Contacts a client, Subjects a job or a client", () => {
    expect(LIST_FILTER_KEYS.people_clients).toEqual({});
    expect(LIST_FILTER_KEYS.people_contacts).toEqual({ client: true });
    expect(LIST_FILTER_KEYS.people_subjects).toEqual({ job: true, client: true });
    expect(
      listFiltersInput.safeParse({
        page: "people_subjects",
        chips: [
          { key: "job", value: JOB },
          { key: "client", value: CLIENT },
        ],
      }).success,
    ).toBe(true);
    expect(
      listFiltersInput.safeParse({ page: "people_contacts", chips: [{ key: "job", value: JOB }] })
        .success,
    ).toBe(false);
    expect(
      listFiltersInput.safeParse({ page: "people_subjects", jobId: JOB, chips: [] }).success,
    ).toBe(false);
  });
});

describe("API description of People", () => {
  const doc = buildOpenApi("https://example.test");
  type Op = { "x-access": string; tags: string[] };
  const op = (path: string, method: string) =>
    (doc.paths[path] as Record<string, Op> | undefined)?.[method];

  it("lists contacts and subjects in the Contacts group, searches as POSTs only", () => {
    for (const [path, method, access] of [
      ["/contacts", "get", "signed-in"],
      ["/contacts", "post", "owner-admin"],
      ["/contacts/{id}", "patch", "owner-admin"],
      ["/contacts/search", "post", "signed-in"],
      ["/subjects", "get", "signed-in"],
      ["/subjects/search", "post", "signed-in"],
    ] as const) {
      const route = op(path, method);
      expect(route, `${method} ${path}`).toBeDefined();
      expect(route?.["x-access"]).toBe(access);
      expect(route?.tags).toEqual(["Contacts"]);
    }
    expect(doc.paths["/contacts/search"]).not.toHaveProperty("get");
    expect(doc.paths["/subjects/search"]).not.toHaveProperty("get");
    for (const name of ["Contact", "Subject", "ClientListItem"])
      expect(doc.components.schemas).toHaveProperty(name);
  });
});
