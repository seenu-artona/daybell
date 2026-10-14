import { describe, expect, it } from "vitest";
import { contactName, isContactEmpty, PEOPLE_SECTIONS, peopleSections } from "./people-pages";

describe("People's sections (D150, ADR 0028)", () => {
  it("are Clients, Contacts, Families and Subjects, in that order", () => {
    expect(PEOPLE_SECTIONS).toEqual(["clients", "contacts", "families", "subjects"]);
  });

  it("show Families only to people who see order data (answer 2)", () => {
    expect(peopleSections("owner")).toEqual(["clients", "contacts", "families", "subjects"]);
    expect(peopleSections("admin")).toEqual(PEOPLE_SECTIONS);
    expect(peopleSections("staff")).toEqual(PEOPLE_SECTIONS);
    expect(peopleSections("photographer")).toEqual(["clients", "contacts", "subjects"]);
    expect(peopleSections("")).toEqual(["clients", "contacts", "subjects"]);
  });
});

describe("contactName", () => {
  it("is the first and last name, or either alone", () => {
    expect(contactName({ firstName: "Dana", lastName: "Ruiz" })).toBe("Dana Ruiz");
    expect(contactName({ firstName: "Dana", lastName: null })).toBe("Dana");
    expect(contactName({ firstName: null, lastName: "Ruiz" })).toBe("Ruiz");
    expect(contactName({ firstName: " Dana ", lastName: "  " })).toBe("Dana");
  });

  it("falls back to the email, then the phone, for a contact with no name", () => {
    expect(
      contactName({ firstName: null, lastName: null, email: "office@x.example", phone: "555" }),
    ).toBe("office@x.example");
    expect(contactName({ firstName: null, lastName: null, email: null, phone: "555 0100" })).toBe(
      "555 0100",
    );
    expect(contactName({ firstName: null, lastName: null })).toBe("");
  });
});

describe("isContactEmpty", () => {
  it("is true only when there is no name, email or phone (blank text counts as none)", () => {
    expect(isContactEmpty({ firstName: null, lastName: null, email: null, phone: null })).toBe(
      true,
    );
    expect(isContactEmpty({ firstName: " ", lastName: "", email: null })).toBe(true);
    expect(isContactEmpty({ firstName: null, lastName: null, phone: "555" })).toBe(false);
    expect(isContactEmpty({ firstName: null, lastName: null, email: "a@b.example" })).toBe(false);
    expect(isContactEmpty({ firstName: "Mark", lastName: null })).toBe(false);
  });
});
