import { DATA_REGIONS } from "@daybell/config";
import { z } from "zod";

/**
 * Request bodies for /api/v1. Shared by route handlers, screens, the public API docs and the MCP server (D92).
 * Validation messages are message keys ("validation.*"); screens translate them from the locale files (D96).
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "validation.email" }));

// Long passphrases beat complexity rules (NIST SP 800-63B); 12 characters minimum.
const password = z
  .string()
  .min(12, { error: "validation.passwordShort" })
  .max(128, { error: "validation.passwordLong" });

export const studioSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, {
    error: "validation.slug",
  });

export const signUpInput = z.object({
  studioName: z.string().trim().min(1, { error: "validation.studioName" }).max(120),
  studioSlug,
  region: z.enum(DATA_REGIONS),
  email,
  password,
});
export type SignUpInput = z.infer<typeof signUpInput>;

const inviteToken = z.string().regex(/^[0-9a-f]{64}$/, { error: "validation.inviteToken" });

/** Someone invited to an existing studio creates their account; no new studio. */
export const joinSignUpInput = z.object({
  region: z.enum(DATA_REGIONS),
  email,
  password,
  inviteToken,
});
export type JoinSignUpInput = z.infer<typeof joinSignUpInput>;

export const signInInput = z.object({
  region: z.enum(DATA_REGIONS),
  email,
  password: z.string().min(1, { error: "validation.passwordRequired" }).max(128),
});
export type SignInInput = z.infer<typeof signInInput>;

export const passwordResetRequestInput = z.object({ region: z.enum(DATA_REGIONS), email });
export const passwordUpdateInput = z.object({ password });

export const STAFF_ROLES = ["admin", "photographer", "staff"] as const;
export const inviteInput = z.object({ email, role: z.enum(STAFF_ROLES) });
export type InviteInput = z.infer<typeof inviteInput>;

export const acceptInviteInput = z.object({ token: inviteToken });

/** Turns zod issues into `{ field: messageKey }` for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Turns a studio name into a suggested web address, e.g. "North Peak Photo" -> "north-peak-photo". */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}
