import { DATA_REGIONS } from "@daybell/config";
import { JOB_TYPES, ORGANIZATION_KINDS, organizationRequired } from "@daybell/core";
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

/**
 * Sign-up takes no password: people confirm their email first and choose a password after (ADR 0005). This stops
 * anyone planting a password on someone else's email before they sign up (account pre-hijacking).
 */
export const signUpInput = z.object({
  studioName: z.string().trim().min(1, { error: "validation.studioName" }).max(120),
  studioSlug,
  region: z.enum(DATA_REGIONS),
  email,
});
export type SignUpInput = z.infer<typeof signUpInput>;

const inviteToken = z.string().regex(/^[0-9a-f]{64}$/, { error: "validation.inviteToken" });

/** Someone invited to an existing studio creates their account (no new studio), then returns to the invite. */
export const joinSignUpInput = z.object({
  join: z.literal(true),
  region: z.enum(DATA_REGIONS),
  email,
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

// ── Organizations and jobs (Phase 1 step 1, ADR 0008) ─────────────────────────────────────────────────────────────

export const COUNTRIES = ["US", "CA"] as const;

/** Optional text: send null (not "") to leave it blank. */
const optionalText = (max: number) =>
  z.string().trim().min(1).max(max, { error: "validation.tooLong" }).nullable().optional();

const organizationFields = {
  name: z
    .string()
    .trim()
    .min(1, { error: "validation.organizationName" })
    .max(120, { error: "validation.tooLong" }),
  kind: z.enum(ORGANIZATION_KINDS),
  notes: optionalText(2000),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(120),
  region: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, { error: "validation.regionCode" })
    .nullable()
    .optional()
    .meta({ description: "Two-letter state or province code, e.g. OR or ON." }),
  postalCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(10, { error: "validation.tooLong" })
    .nullable()
    .optional(),
  country: z.enum(COUNTRIES).nullable().optional(),
};

/** Quebec is excluded at launch (D131; Seenu, Oct 11 2026). QC is never a US state, so no country means Canada. */
export function isQuebec(address: {
  region?: string | null | undefined;
  country?: string | null | undefined;
}): boolean {
  return address.region?.toUpperCase() === "QC" && (address.country ?? "CA") === "CA";
}

export const organizationInput = z.object(organizationFields).superRefine((value, ctx) => {
  if (isQuebec(value))
    ctx.addIssue({ code: "custom", path: ["region"], message: "validation.quebec" });
});
export type OrganizationInput = z.infer<typeof organizationInput>;

/** Change some fields of an organization. The merged result must still pass organizationInput. */
export const organizationPatch = z
  .strictObject(z.object(organizationFields).partial().shape)
  .refine((value) => Object.keys(value).length > 0, { error: "validation.nothingToChange" });
export type OrganizationPatch = z.infer<typeof organizationPatch>;

const jobFields = {
  name: z
    .string()
    .trim()
    .min(1, { error: "validation.jobName" })
    .max(120, { error: "validation.tooLong" }),
  type: z.enum(JOB_TYPES),
  organizationId: z
    .uuid({ error: "validation.organization" })
    .nullable()
    .optional()
    .meta({ description: "Required for school, preschool, sports and dance jobs." }),
  pictureDay: z.iso
    .date({ error: "validation.pictureDay" })
    .nullable()
    .optional()
    .meta({ description: "The shoot date, YYYY-MM-DD. Optional." }),
};

export const jobInput = z.object(jobFields).superRefine((value, ctx) => {
  if (organizationRequired(value.type) && !value.organizationId)
    ctx.addIssue({
      code: "custom",
      path: ["organizationId"],
      message: "validation.organizationRequired",
    });
});
export type JobInput = z.infer<typeof jobInput>;

/** Change some fields of a job. A job's status is not changed here (step 8). */
export const jobPatch = z
  .strictObject(z.object(jobFields).partial().shape)
  .refine((value) => Object.keys(value).length > 0, { error: "validation.nothingToChange" });
export type JobPatch = z.infer<typeof jobPatch>;

/** Keyset pagination: pass the last item's id as `cursor` to get the next page. */
export const listQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .meta({ description: "How many to return, 1–100 (default 50)." }),
  cursor: z
    .uuid({ error: "validation.cursor" })
    .optional()
    .meta({ description: "The nextCursor from the previous page." }),
});
export const organizationListQuery = listQuery.extend({
  q: z
    .string()
    .trim()
    .max(120)
    .optional()
    .meta({ description: "Only organizations whose name contains this." }),
});

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
