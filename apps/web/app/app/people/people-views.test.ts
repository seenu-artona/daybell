import { describe, expect, it } from "vitest";
import {
  ALL_CONTACTS,
  ALL_SUBJECTS,
  builtInSubjectChips,
  childHref,
  contactChipFrom,
  contactChipFromSaved,
  contactChipHref,
  contactsRequest,
  peopleSubjectChipFrom,
  peopleSubjectChipFromSaved,
  peopleSubjectChipHref,
  samePeopleSubjectChip,
  subjectsRequest,
} from "./people-views";

const ID = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const params = (query: string) => new URLSearchParams(query);

describe("Contacts' chips (D150, ADR 0028)", () => {
  it("reads All, Main contacts and a client from the address", () => {
    expect(contactChipFrom(params(""))).toEqual({ chip: ALL_CONTACTS, clean: false });
    expect(contactChipFrom(params("show=main"))).toEqual({ chip: { kind: "main" }, clean: false });
    expect(contactChipFrom(params(`client=${ID.toUpperCase()}`))).toEqual({
      chip: { kind: "client", id: ID },
      clean: false,
    });
  });

  it("treats anything else as All, to be cleaned from the address", () => {
    for (const query of ["show=everyone", "client=Dana", `show=main&client=${ID}`, "q=dana"])
      expect(contactChipFrom(params(query)), query).toEqual({ chip: ALL_CONTACTS, clean: true });
  });

  it("puts only enum words and ids in the address (D113)", () => {
    expect(contactChipHref({ kind: "main" })).toBe("/app/people/contacts?show=main");
    expect(contactChipHref({ kind: "client", id: ID })).toBe(`/app/people/contacts?client=${ID}`);
    expect(contactChipHref(ALL_CONTACTS)).toBe("/app/people/contacts");
  });

  it("takes a saved client chip only", () => {
    expect(contactChipFromSaved({ key: "client", value: ID })).toEqual({ kind: "client", id: ID });
    expect(contactChipFromSaved({ key: "job", value: ID })).toBeNull();
    expect(contactChipFromSaved({ key: "client", value: null })).toBeNull();
  });

  it("searches with a POST, never in the URL", () => {
    expect(contactsRequest({ kind: "main" }, null, "")).toEqual({ path: "/contacts?show=main" });
    expect(contactsRequest({ kind: "client", id: ID }, ID, "")).toEqual({
      path: `/contacts?clientId=${ID}&cursor=${ID}`,
    });
    expect(contactsRequest(ALL_CONTACTS, null, "dana")).toEqual({
      path: "/contacts/search",
      body: { q: "dana" },
    });
    expect(contactsRequest({ kind: "main" }, ID, "dana")).toEqual({
      path: "/contacts/search",
      body: { show: "main", cursor: ID, q: "dana" },
    });
  });
});

describe("Subjects' chips (D150, D148, ADR 0028)", () => {
  it("builds in Ordered and Not ordered only for people who see orders (answer 4)", () => {
    expect(builtInSubjectChips(true)).toEqual([
      ALL_SUBJECTS,
      { kind: "show", show: "ordered" },
      { kind: "show", show: "notOrdered" },
    ]);
    expect(builtInSubjectChips(false)).toEqual([ALL_SUBJECTS]);
  });

  it("reads the chip from the address; an order chip needs order data", () => {
    const sees = { seesOrders: true };
    expect(peopleSubjectChipFrom(params("show=notOrdered"), sees)).toEqual({
      chip: { kind: "show", show: "notOrdered" },
      clean: false,
    });
    expect(peopleSubjectChipFrom(params(`job=${ID}`), sees).chip).toEqual({ kind: "job", id: ID });
    expect(peopleSubjectChipFrom(params(`client=${ID}`), sees).chip).toEqual({
      kind: "client",
      id: ID,
    });
    expect(peopleSubjectChipFrom(params("show=ordered"), { seesOrders: false })).toEqual({
      chip: ALL_SUBJECTS,
      clean: true,
    });
    for (const query of ["show=noFamily", `job=${ID}&client=${ID}`, "job=Lincoln", "q=maya"])
      expect(peopleSubjectChipFrom(params(query), sees), query).toEqual({
        chip: ALL_SUBJECTS,
        clean: true,
      });
  });

  it("has an address per chip, and saved job and client chips", () => {
    expect(peopleSubjectChipHref({ kind: "show", show: "ordered" })).toBe(
      "/app/people/subjects?show=ordered",
    );
    expect(peopleSubjectChipHref({ kind: "job", id: ID })).toBe(`/app/people/subjects?job=${ID}`);
    expect(samePeopleSubjectChip({ kind: "job", id: ID }, { kind: "client", id: ID })).toBe(false);
    expect(peopleSubjectChipFromSaved({ key: "job", value: ID })).toEqual({ kind: "job", id: ID });
    expect(peopleSubjectChipFromSaved({ key: "class", value: ID })).toBeNull();
  });

  it("asks the API with filters in the URL and names in a POST body", () => {
    expect(subjectsRequest({ kind: "show", show: "ordered" }, null, "")).toEqual({
      path: "/subjects?show=ordered",
    });
    expect(subjectsRequest({ kind: "job", id: ID }, null, "")).toEqual({
      path: `/subjects?jobId=${ID}`,
    });
    expect(subjectsRequest({ kind: "client", id: ID }, ID, "maya")).toEqual({
      path: "/subjects/search",
      body: { clientId: ID, cursor: ID, q: "maya" },
    });
  });

  it("opens a child on their job's Subjects tab", () => {
    expect(childHref({ id: ID, job: { id: "a0000000-0000-4000-8000-000000000001" } })).toBe(
      `/app/jobs/a0000000-0000-4000-8000-000000000001/people?child=${ID}`,
    );
  });
});
