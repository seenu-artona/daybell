import { describe, expect, it } from "vitest";
import { fromDatabaseError } from "./errors";
import { fieldErrors, inviteInput, signUpInput, suggestSlug } from "./schemas";

describe("sign-up input", () => {
  const ok = {
    studioName: " North Peak Photo ",
    studioSlug: "North-Peak",
    region: "ca",
    email: " Owner@Example.com ",
    password: "correct horse battery",
  };

  it("normalises email, slug and name", () => {
    const parsed = signUpInput.parse(ok);
    expect(parsed).toMatchObject({
      studioName: "North Peak Photo",
      studioSlug: "north-peak",
      email: "owner@example.com",
    });
  });

  it("explains problems field by field", () => {
    const result = signUpInput.safeParse({
      ...ok,
      password: "short",
      studioSlug: "-x",
      region: "qc",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(errors.password).toBe("validation.passwordShort");
      expect(Object.keys(errors)).toEqual(
        expect.arrayContaining(["password", "studioSlug", "region"]),
      );
    }
  });
});

describe("invites", () => {
  it("never allows inviting an owner", () => {
    expect(inviteInput.safeParse({ email: "a@b.co", role: "owner" }).success).toBe(false);
    expect(inviteInput.parse({ email: "A@B.co", role: "photographer" }).email).toBe("a@b.co");
  });
});

describe("helpers", () => {
  it("suggests a web address from a studio name", () => {
    expect(suggestSlug("Léa's Photo Co.")).toBe("lea-s-photo-co");
  });

  it("maps database errors without leaking internals", () => {
    expect(
      fromDatabaseError({ code: "42501", message: "Only owners can invite people" }).code,
    ).toBe("forbidden");
    const unknown = fromDatabaseError({
      code: "XX000",
      message: "relation secret_table does not exist",
    });
    expect(unknown.code).toBe("internal");
    expect(unknown.message).not.toContain("secret_table");
  });
});
