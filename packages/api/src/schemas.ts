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

// ── Roster (Phase 1 step 2, ADR 0011) ─────────────────────────────────────────────────────────────────────────────
// Every limit is at least as strict as the database's check constraints, so Postgres never rejects (and logs) a row
// with names or emails in it.

const collapseSpaces = (value: string) => value.replace(/\s+/g, " ").trim();

// Control characters (C0 and DEL) and lone UTF-16 surrogates are never real roster text; they come from broken files
// and break printing, exports and search. Checked after trimming and collapsing, so tabs and line breaks inside names
// have already become spaces; in other roster text they are refused too.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Text without control characters or lone surrogates (String.isWellFormed, which ES2022 lacks). */
function isCleanText(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value) && !LONE_SURROGATE.test(value);
}

/** A name: trimmed, inner runs of whitespace collapsed to one space, 1 to `max` characters. */
const rosterName = (error: string, max = 60) =>
  z
    .string({ error })
    .trim()
    .overwrite(collapseSpaces)
    .min(1, { error })
    .max(max, { error })
    .refine(isCleanText, { error });

/** Optional roster text: send null (not "") to leave it blank. */
const rosterText = (error: string, max: number) =>
  z
    .string({ error })
    .trim()
    .min(1, { error })
    .max(max, { error })
    .refine(isCleanText, { error })
    .nullable()
    .optional();

const parentEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, { error: "validation.email" })
  .pipe(z.email({ error: "validation.email" }))
  .nullable()
  .optional()
  .meta({ description: "School-provided; never used for marketing." });

const groupName = rosterName("validation.groupName").meta({
  description: "A class, team or group name, unique per job ignoring case.",
});

const childFields = {
  firstName: rosterName("validation.firstName"),
  lastName: rosterName("validation.lastName"),
  groupId: z
    .uuid({ error: "validation.group" })
    .nullable()
    .optional()
    .meta({ description: "One of this job's classes, teams or groups. Optional." }),
  studentId: rosterText("validation.studentId", 40).meta({
    description: "The school's ID for the child. Re-imports match children by it.",
  }),
  grade: rosterText("validation.grade", 20),
  parentEmail,
  doNotPhotograph: z.boolean({ error: "validation.invalid" }).optional(),
  doNotPublish: z.boolean({ error: "validation.invalid" }).optional(),
};

/** Add a child by hand. The access code is generated by the server. */
export const childInput = z.object(childFields);
export type ChildInput = z.infer<typeof childInput>;

/** Change some fields of a child. Access codes and the school-provided tag never change. */
export const childPatch = z
  .strictObject(z.object(childFields).partial().shape, { error: "validation.unknownField" })
  .refine((value) => Object.keys(value).length > 0, { error: "validation.nothingToChange" });
export type ChildPatch = z.infer<typeof childPatch>;

export const groupInput = z.object({ name: groupName });
export type GroupInput = z.infer<typeof groupInput>;
export const groupPatch = groupInput;

/** One confirmed row of a roster file. Opt-outs are null when the file had no such column. */
export const rosterRow = z.object({
  firstName: childFields.firstName,
  lastName: childFields.lastName,
  group: groupName.nullable().optional(),
  studentId: childFields.studentId,
  grade: childFields.grade,
  parentEmail,
  doNotPhotograph: z.boolean({ error: "validation.invalid" }).nullable().optional(),
  doNotPublish: z.boolean({ error: "validation.invalid" }).nullable().optional(),
});
export type RosterRow = z.infer<typeof rosterRow>;

export const rosterImportInput = z.object({
  rows: z
    .array(rosterRow)
    .min(1, { error: "validation.rosterEmpty" })
    .max(5000, { error: "validation.rosterTooLarge" })
    .meta({ description: "1 to 5,000 rows, in file order." }),
  dryRun: z
    .boolean()
    .default(false)
    .meta({ description: "true: only report what would happen; nothing is saved." }),
});
export type RosterImportInput = z.infer<typeof rosterImportInput>;

export const rosterQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(200)
    .meta({ description: "How many to return, 1–500 (default 200)." }),
  cursor: z
    .uuid({ error: "validation.cursor" })
    .optional()
    .meta({ description: "The nextCursor from the previous page." }),
  groupId: z
    .union([z.uuid(), z.literal("none")], { error: "validation.group" })
    .optional()
    .meta({ description: 'Only this class, team or group; "none" for children without one.' }),
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
