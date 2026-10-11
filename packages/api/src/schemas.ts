import { DATA_REGIONS } from "@daybell/config";
import { JOB_TYPES } from "@daybell/core";
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

// ── Clients and jobs (Phase 1 step 1, ADR 0008 and 0009) ──────────────────────────────────────────────────────────

export const COUNTRIES = ["US", "CA"] as const;

/** Optional text: send null (not "") to leave it blank. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, { error: "validation.invalid" })
    .max(max, { error: "validation.tooLong" })
    .nullable()
    .optional();

/** GotPhoto-style "Add new client": name, address, contact person, notes. Contact person is personal data. */
const clientFields = {
  name: z
    .string()
    .trim()
    .min(1, { error: "validation.clientName" })
    .max(120, { error: "validation.tooLong" }),
  addressLine1: optionalText(200).meta({ description: "Street address." }),
  addressLine2: optionalText(200).meta({ description: "Apartment, suite, etc." }),
  postalCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, { error: "validation.invalid" })
    .max(10, { error: "validation.tooLong" })
    .nullable()
    .optional()
    .meta({ description: "ZIP or postal code." }),
  city: optionalText(120),
  region: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, { error: "validation.regionCode" })
    .nullable()
    .optional()
    .meta({ description: "Two-letter state or province code, e.g. OR or ON." }),
  country: z.enum(COUNTRIES, { error: "validation.invalid" }).nullable().optional(),
  contactFirstName: optionalText(60),
  contactLastName: optionalText(60),
  contactPhone: optionalText(30).meta({ description: "Free text, up to 30 characters." }),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email({ error: "validation.email" }))
    .nullable()
    .optional(),
  notes: optionalText(2000).meta({ description: "Only visible to the studio." }),
};

/**
 * Quebec is excluded at launch (D131; Seenu, Oct 11 2026). "QC" is refused whatever country is sent (it is never a
 * US state), and so is a Canadian-shaped postal code starting with G, H or J (all in Quebec).
 */
export function quebecField(address: {
  region?: string | null | undefined;
  postalCode?: string | null | undefined;
  country?: string | null | undefined;
}): "region" | "postalCode" | null {
  if (address.region?.trim().toUpperCase() === "QC") return "region";
  if (/^[GHJ]\d[A-Z]/i.test(address.postalCode?.trim() ?? "")) return "postalCode";
  return null;
}

export function isQuebec(address: Parameters<typeof quebecField>[0]): boolean {
  return quebecField(address) !== null;
}

export const clientInput = z.object(clientFields).superRefine((value, ctx) => {
  const field = quebecField(value);
  if (field) ctx.addIssue({ code: "custom", path: [field], message: "validation.quebec" });
});
export type ClientInput = z.infer<typeof clientInput>;

/** Change some fields of a client. The merged result must still pass clientInput. */
export const clientPatch = z
  .strictObject(z.object(clientFields).partial().shape, { error: "validation.unknownField" })
  .refine((value) => Object.keys(value).length > 0, { error: "validation.nothingToChange" });
export type ClientPatch = z.infer<typeof clientPatch>;

/** GotPhoto-style "Create Photo Job". A client is optional for every job type (Seenu, Oct 11 2026). */
const jobFields = {
  name: z
    .string()
    .trim()
    .min(1, { error: "validation.jobName" })
    .max(120, { error: "validation.tooLong" })
    .meta({ description: "Parents see this." }),
  pictureDay: z.iso
    .date({ error: "validation.pictureDay" })
    .meta({ description: "The shoot date, YYYY-MM-DD." }),
  clientId: z
    .uuid({ error: "validation.client" })
    .nullable()
    .optional()
    .meta({ description: "One of the studio's clients. Optional." }),
  internalNumber: z
    .string()
    .trim()
    .min(1, { error: "validation.internalNumber" })
    .max(30, { error: "validation.internalNumber" })
    .optional()
    .meta({
      description:
        "Only the studio sees it; unique per studio. Left out, the next JOBnnnnn number is used.",
    }),
  type: z.enum(JOB_TYPES, { error: "validation.invalid" }),
  categoryId: z
    .uuid({ error: "validation.category" })
    .meta({ description: "One of the studio's job categories." }),
  subjectsExpected: z
    .number({ error: "validation.subjectsExpected" })
    .int({ error: "validation.subjectsExpected" })
    .min(1, { error: "validation.subjectsExpected" })
    .max(100000, { error: "validation.subjectsExpected" })
    .nullable()
    .optional()
    .meta({ description: "How many people are expected to be photographed, e.g. 120." }),
};

export const jobInput = z.object(jobFields);
export type JobInput = z.infer<typeof jobInput>;

/** Change some fields of a job. A job's status is not changed here (step 8). */
export const jobPatch = z
  .strictObject(z.object(jobFields).partial().shape, { error: "validation.unknownField" })
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
export const clientListQuery = listQuery.extend({
  q: z
    .string()
    .trim()
    .max(120)
    .optional()
    .meta({ description: "Only clients whose name contains this." }),
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
