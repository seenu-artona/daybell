import { DATA_REGIONS } from "@daybell/config";
import {
  ITEM_DESCRIPTION_MAX,
  ITEM_NAME_MAX,
  JOB_STATUSES,
  JOB_TYPES,
  MAX_BLANK_CARDS,
  MAX_CLOSING_DAYS,
  MAX_FILES_PER_REQUEST,
  MAX_ITEM_PRICE_CENTS,
  MAX_LINE_QUANTITY,
  MAX_NOTIFICATIONS_PER_READ,
  MAX_PACKAGE_LINES,
  MAX_PART_URLS_PER_REQUEST,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_BIN_REQUEST,
  MAX_PHOTOS_PER_MOVE,
  MAX_PRICE_LIST_ITEMS,
  MAX_SHIPPING_CENTS,
  PAYOUT_WEEKDAY_CHOICES,
  PHOTO_PAGE_SIZE,
  PRICE_ITEM_KINDS,
  PRICE_LIST_NAME_MAX,
  PRINT_SIZES,
  planParts,
  REVIEW_CHILDREN_PAGE,
} from "@daybell/core";
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
  priceListId: z.uuid({ error: "validation.priceList" }).optional().meta({
    description:
      "One of the studio's price lists (ADR 0019). Left out of a new job, the studio's default is used. A closed job's can't change.",
  }),
  deliverToSchool: z.boolean({ error: "validation.invalid" }).optional().meta({
    description:
      "Parents may choose free delivery to the school as well as paid home shipping. Off unless turned on; a closed job's can't change.",
  }),
  closesAt: z.iso
    .datetime({ offset: true, error: "validation.closesAt" })
    .nullable()
    .optional()
    .meta({
      description: `When the shop closes by itself (ADR 0021), an exact moment with its offset; null for no closing date. In the future and at most ${MAX_CLOSING_DAYS} days away. The screens send the end of the chosen day in the setter's own time zone. Checked within the hour (the jobs cron); a closed job's can't be set.`,
    }),
};

export const jobInput = z.object(jobFields);
export type JobInput = z.infer<typeof jobInput>;

/** Change some fields of a job. A job's status is never changed here: Start selling, Close shop and Reopen shop do it. */
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
/** Today's date where the person is (D143): picture day tasks tick and Up next counts days in their own day. */
const todayParam = z.iso.date({ error: "validation.invalid" }).optional().meta({
  description:
    "Today's date in the person's time zone, YYYY-MM-DD; within a day of the server's UTC date. Defaults to the UTC date.",
});
export const jobListQuery = listQuery.extend({
  today: todayParam,
  status: z
    .enum(JOB_STATUSES, { error: "validation.invalid" })
    .optional()
    .meta({ description: "Only jobs in this state, e.g. selling (Home's Jobs selling now)." }),
});
export const studioChecklistQuery = z.object({ today: todayParam });

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

// ── Job page (Phase 1 step 2b, ADR 0013) ──────────────────────────────────────────────────────────────────────────

/**
 * The menu search box. Sent in a POST body, never a URL: people may type a child's or contact's name (ADR 0011).
 * Jobs and clients only; children are never searched.
 */
export const searchInput = z.object({
  q: z
    .string({ error: "validation.searchShort" })
    .trim()
    .min(2, { error: "validation.searchShort" })
    .max(100, { error: "validation.tooLong" })
    .meta({ description: "2 to 100 characters. Matches job names and numbers, and client names." }),
});
export type SearchInput = z.infer<typeof searchInput>;

export const activityQuery = z.object({
  jobId: z
    .uuid({ error: "validation.invalid" })
    .optional()
    .meta({ description: "Only this job's activity (the job and its roster imports)." }),
});

// ── QR cards (Phase 1 step 3, ADR 0015) ───────────────────────────────────────────────────────────────────────────

/**
 * What to print (Seenu, answer 4): the whole job (no groupIds, no childId), chosen classes, or one child's card. Only
 * IDs and a count: the request never carries names or codes, and it is a POST body, never a URL (D113).
 */
export const qrCardsInput = z
  .object({
    groupIds: z
      .array(z.union([z.uuid(), z.literal("none")]), { error: "validation.group" })
      .min(1, { error: "validation.qrCardsGroups" })
      .max(500, { error: "validation.group" })
      .refine((ids) => new Set(ids).size === ids.length, { error: "validation.group" })
      .optional()
      .meta({
        description:
          'Only these classes, teams or groups; "none" for children without one. Leave out for the whole job.',
      }),
    childId: z
      .uuid({ error: "validation.invalid" })
      .optional()
      .meta({ description: "Only this child's card. Not with groupIds or blank cards." }),
    blankCards: z
      .number({ error: "validation.blankCards" })
      .int({ error: "validation.blankCards" })
      .min(0, { error: "validation.blankCards" })
      .max(MAX_BLANK_CARDS, { error: "validation.blankCards" })
      .default(0)
      .meta({
        description: `Extra cards with a line for the name and a new access code, 0–${MAX_BLANK_CARDS}.`,
      }),
  })
  .superRefine((value, ctx) => {
    if (value.childId && value.groupIds)
      ctx.addIssue({ code: "custom", path: ["groupIds"], message: "validation.invalid" });
    if (value.childId && value.blankCards > 0)
      ctx.addIssue({ code: "custom", path: ["blankCards"], message: "validation.blankCards" });
  });
export type QrCardsInput = z.infer<typeof qrCardsInput>;

// ── Photos (Phase 1 step 4, ADR 0016) ─────────────────────────────────────────────────────────────────────────────
// Bodies, never URLs, carry filenames (D96): a photo's name can be a child's name.

// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point.
const FILE_NAME_FORBIDDEN = /[\u0000-\u001F\u007F/\\]/;

export const uploadFile = z.object({
  name: z
    .string({ error: "validation.photoName" })
    .min(1, { error: "validation.photoName" })
    .max(255, { error: "validation.photoName" })
    .refine((name) => !FILE_NAME_FORBIDDEN.test(name), { error: "validation.photoName" })
    .meta({ description: "The file's own name, without folders. Kept only in the database." }),
  size: z
    .number({ error: "validation.photoSize" })
    .int({ error: "validation.photoSize" })
    .min(1, { error: "validation.photoSize" })
    .max(MAX_PHOTO_BYTES, { error: "validation.photoSize" })
    .meta({ description: "Bytes, at most 50 MB (52,428,800)." }),
  sha256: z
    .string({ error: "validation.photoHash" })
    .regex(/^[0-9a-f]{64}$/, { error: "validation.photoHash" })
    .meta({
      description: "SHA-256 of the file, lower-case hex. Duplicates in the job are found by it.",
    }),
});
export type UploadFile = z.infer<typeof uploadFile>;

/** Register up to 500 files of a drop before uploading them. JPEG only; the image worker checks the bytes. */
export const uploadFilesInput = z.object({
  files: z
    .array(uploadFile, { error: "validation.photoFiles" })
    .min(1, { error: "validation.photoFiles" })
    .max(MAX_FILES_PER_REQUEST, { error: "validation.photoFiles" }),
});
export type UploadFilesInput = z.infer<typeof uploadFilesInput>;

/** Signed URLs for parts of photos being uploaded: at most 200 parts per request. */
export const partUrlsInput = z.object({
  items: z
    .array(
      z.object({
        photoId: z.uuid({ error: "validation.invalid" }),
        partNumbers: z
          .array(z.number().int().min(1).max(planParts(MAX_PHOTO_BYTES).partCount), {
            error: "validation.invalid",
          })
          .min(1, { error: "validation.invalid" })
          .refine((n) => new Set(n).size === n.length, { error: "validation.invalid" }),
      }),
      { error: "validation.invalid" },
    )
    .min(1, { error: "validation.invalid" })
    .max(50, { error: "validation.invalid" })
    .refine(
      (items) =>
        items.reduce((sum, i) => sum + i.partNumbers.length, 0) <= MAX_PART_URLS_PER_REQUEST,
      { error: "validation.invalid" },
    )
    .refine((items) => new Set(items.map((i) => i.photoId)).size === items.length, {
      error: "validation.invalid",
    }),
});
export type PartUrlsInput = z.infer<typeof partUrlsInput>;

export const finishBatchInput = z.object({
  skipped: z
    .number({ error: "validation.invalid" })
    .int({ error: "validation.invalid" })
    .min(0, { error: "validation.invalid" })
    .max(1_000_000, { error: "validation.invalid" })
    .default(0)
    .meta({
      description:
        "Files the browser left out (not JPEG, empty, over 50 MB), for the batch's counts.",
    }),
  duplicates: z
    .number({ error: "validation.invalid" })
    .int({ error: "validation.invalid" })
    .min(0, { error: "validation.invalid" })
    .max(1_000_000, { error: "validation.invalid" })
    .default(0)
    .meta({
      description:
        "Files that were twice in the drop (sent once), added to the batch's duplicates.",
    }),
});
export type FinishBatchInput = z.infer<typeof finishBatchInput>;

/** Photos to move to or from the bin: 1 to 500 of one job. */
export const photoIdsInput = z.object({
  photoIds: z
    .array(z.uuid({ error: "validation.invalid" }), { error: "validation.invalid" })
    .min(1, { error: "validation.invalid" })
    .max(MAX_PHOTOS_PER_BIN_REQUEST, { error: "validation.invalid" })
    .refine((ids) => new Set(ids).size === ids.length, { error: "validation.invalid" }),
});
export type PhotoIdsInput = z.infer<typeof photoIdsInput>;

export const photoListQuery = z.object({
  cursor: z
    .uuid({ error: "validation.cursor" })
    .optional()
    .meta({ description: "The nextCursor from the previous page (a photo's id)." }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(PHOTO_PAGE_SIZE)
    .meta({ description: `How many to return, 1–500 (default ${PHOTO_PAGE_SIZE}).` }),
  bin: z
    .enum(["true", "false"], { error: "validation.invalid" })
    .default("false")
    .transform((v) => v === "true")
    .meta({ description: "true: the job's bin instead of its photos." }),
  status: z
    .enum(["processing", "ready", "failed"], { error: "validation.invalid" })
    .optional()
    .meta({ description: "Only photos with this status." }),
});
export type PhotoListQuery = z.infer<typeof photoListQuery>;

/**
 * What the image worker read in a ready photo (ADR 0018). Optional: results from a worker that doesn't read cards yet
 * count as plain photos. The card code travels only in this signed body: never in a URL, a log or a queue message.
 */
const workerQr = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("unreadable") }),
    z.object({
      kind: z.literal("card"),
      cardCode: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{20}$/),
    }),
  ])
  .meta({
    description:
      "none: no Daybell card; card: a card was read (its code); unreadable: something that looks like a card couldn't be read.",
  });

/** The image worker's result for a photo (internal route). */
const attempt = z.number().int().min(1).meta({
  description:
    "The round of processing, as the read gave it; results of an earlier round are ignored.",
});
export const workerResultInput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    attempt,
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
    capturedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/)
      .nullable(),
    // Required (security review 2): a result from a worker that doesn't read cards is refused, and its message tried
    // again, rather than tagging the photo as if it had no card.
    qr: workerQr,
  }),
  z.object({
    status: z.literal("failed"),
    attempt,
    failureReason: z.enum(["not_jpeg", "too_large", "hash_mismatch", "unreadable"]),
  }),
]);
export type WorkerResultInput = z.infer<typeof workerResultInput>;

// ── QR tagging and review (Phase 1 step 5, ADR 0018) ─────────────────────────────────────────────────────────────

/** An upload: individual photos (tagged by their QR cards), or a class's "Class photo" set (Seenu, answer 3). */
export const uploadBatchInput = z.object({
  groupId: z.uuid({ error: "validation.group" }).nullable().optional().meta({
    description:
      "One of the job's classes: every photo of this upload goes to its Class photo set, and QR cards in it are ignored. Leave out for individual photos.",
  }),
});
export type UploadBatchInput = z.infer<typeof uploadBatchInput>;

const reviewPhotoIds = z
  .array(z.uuid({ error: "validation.invalid" }), { error: "validation.invalid" })
  .min(1, { error: "validation.invalid" })
  .max(MAX_PHOTOS_PER_MOVE, { error: "validation.invalid" })
  .refine((ids) => new Set(ids).size === ids.length, { error: "validation.invalid" });

export const moveTarget = z
  .discriminatedUnion(
    "kind",
    [
      z.object({ kind: z.literal("child"), childId: z.uuid({ error: "validation.invalid" }) }),
      z.object({ kind: z.literal("classSet"), groupId: z.uuid({ error: "validation.invalid" }) }),
      z.object({ kind: z.literal("leftovers") }),
    ],
    { error: "validation.invalid" },
  )
  .meta({ id: "MoveTarget", description: "A child, a class's Class photo set, or Leftovers." });
export type MoveTarget = z.infer<typeof moveTarget>;

/** Move up to 500 of a job's photos by hand (drag, or Move to…). Card photos can't be moved. */
export const movePhotosInput = z.object({ photoIds: reviewPhotoIds, target: moveTarget });
export type MovePhotosInput = z.infer<typeof movePhotosInput>;

/** Confirm flagged photos: keep them where they are, or (asCard) mark them card photos, hidden from parents. */
export const confirmPhotosInput = z.object({
  photoIds: reviewPhotoIds,
  asCard: z.boolean({ error: "validation.invalid" }).default(false).meta({
    description:
      "true: these are card photos (hidden from parents). false: they look right where they are.",
  }),
});
export type ConfirmPhotosInput = z.infer<typeof confirmPhotosInput>;

/** Undo "This is a card photo" (Seenu, answer 12): the photos go back to Flagged, hidden until confirmed again. */
export const undoCardPhotosInput = z.object({ photoIds: reviewPhotoIds });
export type UndoCardPhotosInput = z.infer<typeof undoCardPhotosInput>;

/** Name a blank card's child (Seenu, answer 2): a new child in one of the job's classes, with the card's access code. */
export const claimBlankCardInput = z.object({
  firstName: childFields.firstName,
  lastName: childFields.lastName,
  groupId: childFields.groupId,
});
export type ClaimBlankCardInput = z.infer<typeof claimBlankCardInput>;

export const TAGGING_PLACES = [
  "leftovers",
  "flagged",
  "child",
  "classSet",
  "blankCard",
  "unlinkedCards",
] as const;
/** Places that list photos without an id. */
const PLACES_WITHOUT_ID: readonly string[] = ["leftovers", "flagged", "unlinkedCards"];

/** A page of the photos in one place on the review screen. Ids only in the URL (D96). */
export const taggingPhotosQuery = z
  .object({
    place: z.enum(TAGGING_PLACES, { error: "validation.invalid" }).meta({
      description:
        "leftovers, flagged, a child's photos (with their card photos), a class's Class photo set, a blank card's photos, or unlinkedCards (card photos linked to none of the job's cards, such as photos marked card photos in Leftovers).",
    }),
    id: z
      .uuid({ error: "validation.invalid" })
      .optional()
      .meta({ description: "The child, class or blank card, for those places." }),
    cursor: z
      .uuid({ error: "validation.cursor" })
      .optional()
      .meta({ description: "The nextCursor from the previous page (a photo's id)." }),
    limit: z.coerce.number().int().min(1).max(500).default(PHOTO_PAGE_SIZE),
  })
  .refine((q) => PLACES_WITHOUT_ID.includes(q.place) === (q.id === undefined), {
    error: "validation.invalid",
    path: ["id"],
  });
export type TaggingPhotosQuery = z.infer<typeof taggingPhotosQuery>;

/** An album's children: a class (groupId), or children without one (noGroup=true). */
export const taggingChildrenQuery = z
  .object({
    groupId: z.uuid({ error: "validation.invalid" }).optional(),
    noGroup: z
      .enum(["true", "false"], { error: "validation.invalid" })
      .default("false")
      .transform((v) => v === "true"),
    cursor: z
      .uuid({ error: "validation.cursor" })
      .optional()
      .meta({ description: "The nextCursor from the previous page (a child's id)." }),
    limit: z.coerce.number().int().min(1).max(500).default(REVIEW_CHILDREN_PAGE),
  })
  .refine((q) => (q.groupId !== undefined) !== q.noGroup, {
    error: "validation.invalid",
    path: ["groupId"],
  });
export type TaggingChildrenQuery = z.infer<typeof taggingChildrenQuery>;

// ── Products and price lists (Phase 1 step 6, ADR 0019) ───────────────────────────────────────────────────────────
// Money is whole cents only (D96): 12.5, "1250" and negatives are refused, never rounded. The currency is never sent:
// it is always the studio's region's.

const cents = (error: string, max: number) =>
  z.number({ error }).int({ error }).min(0, { error }).max(max, { error });

// Names and descriptions parents see: besides C0 controls and lone surrogates (isCleanText), no C1 controls and no
// bidi overrides or isolates, which can make a name read differently from what it is. The database refuses the same
// characters (price_lists and price_list_items checks), so this only gives the person a field error first.
const PRICE_TEXT_FORBIDDEN = /[\u0080-\u009F\u202A-\u202E\u2066-\u2069]/;

/** Text for a price list or item: clean text without C1 controls or bidi overrides and isolates. */
export function isPriceText(value: string): boolean {
  return isCleanText(value) && !PRICE_TEXT_FORBIDDEN.test(value);
}

const priceListName = z
  .string({ error: "validation.priceListName" })
  .trim()
  .min(1, { error: "validation.priceListName" })
  .max(PRICE_LIST_NAME_MAX, { error: "validation.priceListName" })
  .refine(isPriceText, { error: "validation.priceListName" });

/** A new price list: blank, or a copy of one of the studio's lists (Claude's call 2). */
export const priceListInput = z.strictObject(
  {
    name: priceListName,
    copyFromId: z.uuid({ error: "validation.priceList" }).optional().meta({
      description:
        "Copy this list's shipping fee, items and package contents. Left out, the list starts empty.",
    }),
  },
  { error: "validation.unknownField" },
);
export type PriceListInput = z.infer<typeof priceListInput>;

export const priceListPatch = z
  .strictObject(
    {
      name: priceListName.optional(),
      homeShippingCents: cents("validation.shipping", MAX_SHIPPING_CENTS).optional().meta({
        description: "The flat home shipping fee in whole cents, 0–100000 ($1,000).",
      }),
    },
    { error: "validation.unknownField" },
  )
  .refine((value) => Object.keys(value).length > 0, { error: "validation.nothingToChange" });
export type PriceListPatch = z.infer<typeof priceListPatch>;

export const packageLineInput = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("print"),
      printSize: z.enum(PRINT_SIZES, { error: "validation.printSize" }),
      quantity: z
        .number({ error: "validation.quantity" })
        .int({ error: "validation.quantity" })
        .min(1, { error: "validation.quantity" })
        .max(MAX_LINE_QUANTITY, { error: "validation.quantity" }),
    }),
    z.strictObject({ kind: z.literal("digital") }),
  ],
  { error: "validation.invalid" },
);
export type PackageLineInput = z.infer<typeof packageLineInput>;

/** A package's whole contents (answer 3): 1 to 20 lines, at most one digital download (one pose). */
const packageContents = z
  .array(packageLineInput, { error: "validation.invalid" })
  .min(1, { error: "validation.packageEmpty" })
  .max(MAX_PACKAGE_LINES, { error: "validation.packageLines" })
  .refine((lines) => lines.filter((l) => l.kind === "digital").length <= 1, {
    error: "validation.packageDigitals",
  })
  .meta({ description: "Packages only: replaces all of the package's contents." });

const itemFields = {
  name: z
    .string({ error: "validation.itemName" })
    .trim()
    .min(1, { error: "validation.itemName" })
    .max(ITEM_NAME_MAX, { error: "validation.itemName" })
    .refine(isPriceText, { error: "validation.itemName" }),
  description: z
    .string({ error: "validation.invalid" })
    .trim()
    .min(1, { error: "validation.invalid" })
    .max(ITEM_DESCRIPTION_MAX, { error: "validation.tooLong" })
    .refine(isPriceText, { error: "validation.invalid" })
    .nullable()
    .optional()
    .meta({ description: "Shown to parents. Send null to clear it." }),
  priceCents: cents("validation.price", MAX_ITEM_PRICE_CENTS).meta({
    description: "Whole cents, before tax, 0–1000000 ($10,000). $0 is allowed.",
  }),
  printSize: z
    .enum(PRINT_SIZES, { error: "validation.printSize" })
    .optional()
    .meta({ description: "Prints only." }),
  contents: packageContents.optional(),
};

type ItemShape = {
  kind?: (typeof PRICE_ITEM_KINDS)[number];
  printSize?: unknown;
  contents?: unknown;
};

/** The rules that depend on the kind: a print has a size, a package has contents, nothing else has either. */
export function itemKindIssues(
  kind: (typeof PRICE_ITEM_KINDS)[number],
  value: ItemShape,
  isNew: boolean,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (kind === "print" && isNew && value.printSize === undefined)
    issues.push({ path: "printSize", message: "validation.printSize" });
  if (kind !== "print" && value.printSize !== undefined)
    issues.push({ path: "printSize", message: "validation.printSize" });
  if (kind === "package" && isNew && value.contents === undefined)
    issues.push({ path: "contents", message: "validation.packageEmpty" });
  if (kind !== "package" && value.contents !== undefined)
    issues.push({ path: "contents", message: "validation.invalid" });
  return issues;
}

/** A new item: a package, a single print, the single digital download or "all digitals". */
export const priceListItemInput = z
  .strictObject(
    { kind: z.enum(PRICE_ITEM_KINDS, { error: "validation.invalid" }), ...itemFields },
    { error: "validation.unknownField" },
  )
  .superRefine((value, ctx) => {
    for (const issue of itemKindIssues(value.kind, value, true))
      ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
  });
export type PriceListItemInput = z.infer<typeof priceListItemInput>;

/** Change some fields of an item. Its kind never changes; size and contents must suit it (checked by the server). */
export const priceListItemPatch = z
  .strictObject(z.object(itemFields).partial().shape, { error: "validation.unknownField" })
  .refine((value) => Object.keys(value).length > 0, { error: "validation.nothingToChange" });
export type PriceListItemPatch = z.infer<typeof priceListItemPatch>;

/** Every item of the list, each once, in the new order (Move up / Move down; no drag, WCAG 2.5.7). */
export const itemOrderInput = z.strictObject(
  {
    itemIds: z
      .array(z.uuid({ error: "validation.itemOrder" }), { error: "validation.itemOrder" })
      .max(MAX_PRICE_LIST_ITEMS, { error: "validation.itemOrder" })
      .refine((ids) => new Set(ids).size === ids.length, { error: "validation.itemOrder" }),
  },
  { error: "validation.unknownField" },
);
export type ItemOrderInput = z.infer<typeof itemOrderInput>;

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

// ── Payouts (Phase 1 step 7, ADR 0020) ────────────────────────────────────────────────────────────────────────────

/** The owner's payout schedule (Seenu, answer 3 and Q6): weekly on a weekday, daily, or monthly on a date. */
export const payoutScheduleInput = z.discriminatedUnion(
  "interval",
  [
    z.strictObject(
      {
        interval: z.literal("weekly"),
        weeklyAnchor: z.enum(PAYOUT_WEEKDAY_CHOICES, { error: "validation.payoutWeekday" }).meta({
          description: "Monday to Friday.",
        }),
      },
      { error: "validation.unknownField" },
    ),
    z.strictObject({ interval: z.literal("daily") }, { error: "validation.unknownField" }),
    z.strictObject(
      {
        interval: z.literal("monthly"),
        monthlyAnchor: z
          .number({ error: "validation.payoutMonthDay" })
          .int({ error: "validation.payoutMonthDay" })
          .min(1, { error: "validation.payoutMonthDay" })
          .max(31, { error: "validation.payoutMonthDay" })
          .meta({ description: "1-31; 29-31 fall on the last day of shorter months." }),
      },
      { error: "validation.unknownField" },
    ),
  ],
  { error: "validation.payoutInterval" },
);
export type PayoutScheduleInput = z.infer<typeof payoutScheduleInput>;

// ── Going live (Phase 1 step 8, ADR 0021) ─────────────────────────────────────────────────────────────────────────

/** Mark some of my notifications read. */
export const markNotificationsReadInput = z.strictObject(
  {
    ids: z
      .array(z.uuid({ error: "validation.invalid" }), { error: "validation.invalid" })
      .min(1, { error: "validation.invalid" })
      .max(MAX_NOTIFICATIONS_PER_READ, { error: "validation.invalid" })
      .meta({ description: `1 to ${MAX_NOTIFICATIONS_PER_READ} of your own notifications' ids.` }),
  },
  { error: "validation.unknownField" },
);
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadInput>;
