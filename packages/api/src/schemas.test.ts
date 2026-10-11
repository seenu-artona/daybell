import { describe, expect, it } from "vitest";
import { fromDatabaseError } from "./errors";
import { fieldErrors, inviteInput, passwordUpdateInput, signUpInput, suggestSlug } from "./schemas";

describe("sign-up input", () => {
  const ok = {
    studioName: " North Peak Photo ",
    studioSlug: "North-Peak",
    region: "ca",
    email: " Owner@Example.com ",
  };

  it("normalises email, slug and name", () => {
    expect(signUpInput.parse(ok)).toMatchObject({
      studioName: "North Peak Photo",
      studioSlug: "north-peak",
      email: "owner@example.com",
    });
  });

  it("explains problems field by field, as translatable keys", () => {
    const result = signUpInput.safeParse({ ...ok, email: "nope", studioSlug: "-x", region: "qc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(errors.email).toBe("validation.email");
      expect(Object.keys(errors)).toEqual(
        expect.arrayContaining(["email", "studioSlug", "region"]),
      );
    }
  });

  it("never takes a password at sign-up (no pre-hijacking)", () => {
    expect(Object.keys(signUpInput.shape)).not.toContain("password");
  });
});

describe("passwords", () => {
  it("need 12+ characters", () => {
    expect(passwordUpdateInput.safeParse({ password: "short" }).success).toBe(false);
    expect(passwordUpdateInput.safeParse({ password: "correct horse battery" }).success).toBe(true);
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

  it("maps database errors to fixed messages, never raw database text", () => {
    expect(
      fromDatabaseError({ code: "42501", message: "Only owners can invite people" }).code,
    ).toBe("forbidden");
    expect(
      fromDatabaseError({ code: "23505", message: 'duplicate key "studios_slug_key"' }).message,
    ).not.toContain("studios_slug_key");
    const unknown = fromDatabaseError({
      code: "XX000",
      message: "relation secret_table does not exist",
    });
    expect(unknown.code).toBe("internal");
    expect(unknown.message).not.toContain("secret_table");
  });
});
