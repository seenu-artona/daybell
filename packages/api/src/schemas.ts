import { DATA_REGIONS } from "@daybell/config";
import {
  CARRIERS,
  classLabelValid,
  cleanGroupName,
  DEFAULT_CLASS_LABEL,
  GROUP_COLUMNS,
  GROUP_PHOTOS_TO,
  HEAD_OFFICE_PROVINCES,
  ITEM_DESCRIPTION_MAX,
  ITEM_NAME_MAX,
  isGroupNameText,
  JOB_STATUSES,
  JOB_TYPES,
  MAX_BLANK_CARDS,
  MAX_CLOSING_DAYS,
  MAX_FILES_PER_REQUEST,
  MAX_GROUP_CHANGE,
  MAX_GROUP_NAME,
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
  normalizePostalCode,
  normalizeTaxNumber,
  normalizeTrackingNumber,
  ORDER_FULFILMENTS,
  PAYOUT_WEEKDAY_CHOICES,
  PEOPLE_PAGE_SIZE,
  PHOTO_PAGE_SIZE,
  PRICE_ITEM_KINDS,
  PRICE_LIST_NAME_MAX,
  PRINT_SIZES,
  PST_PROVINCES,
  planParts,
  REFUND_REASONS,
  RULE_KEYS,
  RULE_LIMITS,
  SHOP_MAX_QUANTITY,
  SHOP_OPENS,
  SHOP_SHIPPING_METHODS,
  STATUS_UNDO_REASONS,
  UPLOAD_KINDS,
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

// ── Job templates and a job's own rules (D152, D154; ADR 0029) ────────────────────────────────────────────────────
const ruleDays = (limits: { min: number; max: number }) =>
  z
    .number({ error: "validation.ruleDays" })
    .int({ error: "validation.ruleDays" })
    .min(limits.min, { error: "validation.ruleDays" })
    .max(limits.max, { error: "validation.ruleDays" });

/** The rules a template gives a new job, and a job may change for itself. Counted from picture day. */
const ruleFields = {
  qrCardsDaysBefore: ruleDays(RULE_LIMITS.qrCardsDaysBefore).nullable().meta({
    description: "QR cards ready this many days before picture day, 0–60; null: no day planned.",
  }),
  shopOpens: z.enum(SHOP_OPENS, { error: "validation.invalid" }).meta({
    description:
      "photosChecked: once the job's photos are checked (someone publishes the shop); afterPictureDay: planned shopOpensDays after picture day.",
  }),
  shopOpensDays: ruleDays(RULE_LIMITS.shopOpensDays).nullable().meta({
    description: "With afterPictureDay, 0–180 days after picture day; null otherwise.",
  }),
  shopClosesDays: ruleDays(RULE_LIMITS.shopClosesDays).nullable().meta({
    description:
      "The shop closes this many days after it first opens, 1–365 (its closing date is set when it opens); null: when someone closes it.",
  }),
};
const RULE_FIELD_NAMES = Object.keys(ruleFields) as (keyof typeof ruleFields)[];

/** Days after picture day go with "after picture day", and only with it. */
function checkOpensDays(
  value: { shopOpens?: string | undefined; shopOpensDays?: number | null | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.shopOpens === undefined) return;
  if ((value.shopOpens === "afterPictureDay") !== (value.shopOpensDays != null))
    ctx.addIssue({ code: "custom", path: ["shopOpensDays"], message: "validation.shopOpensDays" });
}

const templateName = z
  .string()
  .trim()
  .min(1, { error: "validation.templateName" })
  .max(80, { error: "validation.tooLong" })
  .meta({ description: "Only the studio sees it, e.g. School Fall." });

/** What a template's jobs call the roster's class field (ADR 0030, call 29): free text, cleaned, 1 to 30 characters. */
const classLabel = z
  .string({ error: "validation.classLabel" })
  .trim()
  .refine(classLabelValid, { error: "validation.classLabel" })
  .meta({
    description:
      "What new jobs call the roster's class field, e.g. Class, Team or Homeroom (1 to 30 characters). Copied onto each new job.",
  });

/** A new template: a name, and any rules (the rest start as today's defaults: nothing planned, closed by hand). */
export const jobTemplateInput = z
  .strictObject(
    {
      name: templateName,
      qrCardsDaysBefore: ruleFields.qrCardsDaysBefore.default(null),
      shopOpens: ruleFields.shopOpens.default("photosChecked"),
      shopOpensDays: ruleFields.shopOpensDays.default(null),
      shopClosesDays: ruleFields.shopClosesDays.default(null),
      priceListId: z.uuid({ error: "validation.priceList" }).nullable().default(null).meta({
        description:
          "One of the studio's price lists; null: the studio's default when the job is made.",
      }),
      deliverToSchool: z.boolean({ error: "validation.invalid" }).default(false).meta({
        description: "New jobs offer free delivery to the school as well as home shipping.",
      }),
      classLabel: classLabel.default(DEFAULT_CLASS_LABEL),
    },
    { error: "validation.unknownField" },
  )
  .superRefine(checkOpensDays);
export type JobTemplateInput = z.infer<typeof jobTemplateInput>;

/** Change some of a template's fields; jobs already made from it keep theirs (D154). */
export const jobTemplatePatch = z
  .strictObject(
    {
      name: templateName.optional(),
      qrCardsDaysBefore: ruleFields.qrCardsDaysBefore.optional(),
      shopOpens: ruleFields.shopOpens.optional(),
      shopOpensDays: ruleFields.shopOpensDays.optional(),
      shopClosesDays: ruleFields.shopClosesDays.optional(),
      priceListId: z.uuid({ error: "validation.priceList" }).nullable().optional(),
      deliverToSchool: z.boolean({ error: "validation.invalid" }).optional(),
      classLabel: classLabel.optional(),
    },
    { error: "validation.unknownField" },
  )
  .refine((value) => Object.keys(value).length > 0, { error: "validation.nothingToChange" });
export type JobTemplatePatch = z.infer<typeof jobTemplatePatch>;

/** Duplicate a template under a new name (the screens send it from the locale files). */
export const jobTemplateCopyInput = z.strictObject(
  { name: templateName },
  { error: "validation.unknownField" },
);

export const jobInput = z.object({
  ...jobFields,
  templateId: z.uuid({ error: "validation.template" }).optional().meta({
    description:
      "One of the studio's job templates (D154): the new job copies its rules, price list and delivery. Left out, the studio's default template. Only when the job is made.",
  }),
});
export type JobInput = z.infer<typeof jobInput>;

/**
 * Change some fields of a job, and its own rules (D152: "Changed for this job"). A job's status is never changed here:
 * Start selling, Close shop and Reopen shop do it. Its template is chosen when it is made.
 */
export const jobPatch = z
  .strictObject(
    {
      ...z.object(jobFields).partial().shape,
      ...z.object(ruleFields).partial().shape,
    },
    { error: "validation.unknownField" },
  )
  .refine((value) => Object.keys(value).length > 0, { error: "validation.nothingToChange" });
export type JobPatch = z.infer<typeof jobPatch>;
/** The rule fields of a job patch. */
export type JobRulesPatch = Partial<Pick<JobPatch, (typeof RULE_FIELD_NAMES)[number]>>;
/** Splits a job patch into the job's details and its rules. */
export function splitJobPatch(patch: JobPatch): {
  details: Omit<JobPatch, keyof JobRulesPatch>;
  rules: JobRulesPatch;
} {
  const details: Record<string, unknown> = {};
  const rules: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch))
    ((RULE_FIELD_NAMES as string[]).includes(key) ? rules : details)[key] = value;
  return { details, rules } as {
    details: Omit<JobPatch, keyof JobRulesPatch>;
    rules: JobRulesPatch;
  };
}

/** Undo a job's own change to one rule: back to what its template gave it (D152). */
export const jobRuleResetInput = z.strictObject(
  { rule: z.enum(RULE_KEYS, { error: "validation.invalid" }) },
  { error: "validation.unknownField" },
);

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
/** The Jobs list's "Show only" filters (D147): also the keys of the chips people save for them. */
export const JOB_SHOW_FILTERS = ["closingThisWeek", "pictureDayThisMonth"] as const;
export type JobShowFilter = (typeof JOB_SHOW_FILTERS)[number];

export const jobListQuery = listQuery.extend({
  today: todayParam,
  status: z
    .enum(JOB_STATUSES, { error: "validation.invalid" })
    .optional()
    .meta({ description: "Only jobs in this state, e.g. selling (Home's Jobs selling now)." }),
  show: z.enum(JOB_SHOW_FILTERS, { error: "validation.invalid" }).optional().meta({
    description:
      "closingThisWeek: selling jobs whose shop closes from now to the end of the seventh day counting today (today + 6). pictureDayThisMonth: picture day in today's calendar month. Days are `today`'s.",
  }),
  clientId: z
    .uuid({ error: "validation.client" })
    .optional()
    .meta({ description: "Only this client's jobs." }),
  q: z
    .string()
    .trim()
    .max(120)
    .optional()
    .meta({ description: "Only jobs whose name or internal number contains this." }),
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

// ── People: contacts and subjects (D150, ADR 0028) ────────────────────────────────────────────────────────────────
// Contacts and children are people: their names and emails are searched only from a POST body, never a URL (D113,
// as the menu search, ADR 0013).

/** A client's contact (Seenu's answer 3). The limits are the client's own contact fields'. Personal data. */
const contactFields = {
  firstName: optionalText(60),
  lastName: optionalText(60),
  role: optionalText(60).meta({ description: "Their role at the client, e.g. Office manager." }),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email({ error: "validation.email" }))
    .nullable()
    .optional(),
  phone: optionalText(30).meta({ description: "Free text, up to 30 characters." }),
  isMain: z.boolean({ error: "validation.invalid" }).optional().meta({
    description:
      "The client's main contact (at most one). Making one main makes the previous one an ordinary contact. The client's contact fields always show its main contact.",
  }),
};

type ContactParts = { firstName?: unknown; lastName?: unknown; email?: unknown; phone?: unknown };
/** A contact is someone: a name, an email or a phone (the database checks the same). */
export function contactIsEmpty(value: ContactParts): boolean {
  return [value.firstName, value.lastName, value.email, value.phone].every(
    (v) => v === undefined || v === null,
  );
}

export const contactInput = z
  .object({
    clientId: z.uuid({ error: "validation.client" }).meta({
      description: "One of the studio's clients. A contact never moves to another client.",
    }),
    ...contactFields,
  })
  .superRefine((value, ctx) => {
    if (contactIsEmpty(value))
      ctx.addIssue({ code: "custom", path: ["firstName"], message: "validation.contactEmpty" });
  });
export type ContactInput = z.infer<typeof contactInput>;

/** Change some fields of a contact. The merged result must still name someone. */
export const contactPatch = z
  .strictObject(z.object(contactFields).partial().shape, { error: "validation.unknownField" })
  .refine((value) => Object.keys(value).length > 0, { error: "validation.nothingToChange" });
export type ContactPatch = z.infer<typeof contactPatch>;

/** Contacts' built-in chip after All (D147 chips): only each client's main contact. */
export const CONTACT_SHOW_FILTERS = ["main"] as const;
export type ContactShowFilter = (typeof CONTACT_SHOW_FILTERS)[number];

export const contactListQuery = listQuery.extend({
  show: z
    .enum(CONTACT_SHOW_FILTERS, { error: "validation.invalid" })
    .optional()
    .meta({ description: "main: only each client's main contact." }),
  clientId: z
    .uuid({ error: "validation.client" })
    .optional()
    .meta({ description: "Only this client's contacts." }),
});
export type ContactListQuery = z.infer<typeof contactListQuery>;

/** Text a person typed to find people: sent in a POST body only. */
const peopleSearchText = z
  .string({ error: "validation.invalid" })
  .trim()
  .min(1, { error: "validation.invalid" })
  .max(120, { error: "validation.tooLong" });

export const contactSearchInput = contactListQuery.extend({
  q: peopleSearchText.meta({ description: "Part of a contact's name or email." }),
});

/** Subjects' built-in chips after All (D148): who has ordered, and who hasn't. Order data: not for photographers. */
export const SUBJECT_SHOW_FILTERS = ["ordered", "notOrdered"] as const;
export type SubjectShowFilter = (typeof SUBJECT_SHOW_FILTERS)[number];

export const subjectListQuery = listQuery.extend({
  show: z.enum(SUBJECT_SHOW_FILTERS, { error: "validation.invalid" }).optional().meta({
    description:
      "ordered: a paid order, neither canceled nor refunded in full, has a line of the child's own that wasn't given back in full (D148). notOrdered: the others. Owners, admins and staff only.",
  }),
  jobId: z
    .uuid({ error: "validation.invalid" })
    .optional()
    .meta({ description: "Only this job's children." }),
  clientId: z
    .uuid({ error: "validation.client" })
    .optional()
    .meta({ description: "Only the children of this client's jobs." }),
});
export type SubjectListQuery = z.infer<typeof subjectListQuery>;

export const subjectSearchInput = subjectListQuery.extend({
  q: peopleSearchText.meta({ description: "Part of a child's first and last name." }),
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

const className = rosterName("validation.className").meta({
  description: "A class or team name, unique per job ignoring case.",
});

const childFields = {
  firstName: rosterName("validation.firstName"),
  lastName: rosterName("validation.lastName"),
  classId: z
    .uuid({ error: "validation.class" })
    .nullable()
    .optional()
    .meta({ description: "One of this job's classes (or teams). Optional." }),
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

/** A class (or team) of a job's roster (C1, C6: called a class in the API). */
export const classInput = z.object({ name: className });
export type ClassInput = z.infer<typeof classInput>;
export const classPatch = classInput;

/** One confirmed row of a roster file. Opt-outs are null when the file had no such column. */
export const rosterRow = z.object({
  firstName: childFields.firstName,
  lastName: childFields.lastName,
  class: className.nullable().optional(),
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

/** Strict, like the other queries D156 changed: an old ?groupId= is refused (400), never ignored. */
export const rosterQuery = z.strictObject(
  {
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
    classId: z
      .union([z.uuid(), z.literal("none")], { error: "validation.class" })
      .optional()
      .meta({ description: 'Only this class (or team); "none" for children without one.' }),
  },
  { error: "validation.unknownField" },
);

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
 * What to print (Seenu, answer 4): the whole job (no classIds, no childId), chosen classes, or one child's card. Only
 * IDs and a count: the request never carries names or codes, and it is a POST body, never a URL (D113).
 */
export const qrCardsInput = z
  .object({
    classIds: z
      .array(z.union([z.uuid(), z.literal("none")]), { error: "validation.class" })
      .min(1, { error: "validation.qrCardsClasses" })
      .max(500, { error: "validation.class" })
      .refine((ids) => new Set(ids).size === ids.length, { error: "validation.class" })
      .optional()
      .meta({
        description:
          'Only these classes (or teams); "none" for children without one. Leave out for the whole job.',
      }),
    childId: z
      .uuid({ error: "validation.invalid" })
      .optional()
      .meta({ description: "Only this child's card. Not with classIds or blank cards." }),
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
    if (value.childId && value.classIds)
      ctx.addIssue({ code: "custom", path: ["classIds"], message: "validation.invalid" });
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
      "none: no Silverback card; card: a card was read (its code); unreadable: something that looks like a card couldn't be read.",
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

/**
 * An upload (D156; ADR 0030): individual photos, split by their QR cards, optionally adding everyone it places to a
 * group (addToGroupId, C7); or group photos for one group (groupId), linked to it as they are registered. An empty body
 * is an individual upload.
 */
export const uploadBatchInput = z
  .object({
    kind: z.enum(UPLOAD_KINDS, { error: "validation.invalid" }).default("individual").meta({
      description: "individual (split by QR card) or group (group photos for groupId).",
    }),
    groupId: z.uuid({ error: "validation.group" }).optional().meta({
      description:
        "group uploads only: one of the job's groups. Every photo is a group photo in it; QR cards in them are ignored.",
    }),
    addToGroupId: z.uuid({ error: "validation.group" }).optional().meta({
      description:
        "individual uploads only: one of the job's groups. Everyone the upload's photos are given to joins it (add only).",
    }),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "group" && value.groupId === undefined)
      ctx.addIssue({ code: "custom", path: ["groupId"], message: "validation.group" });
    if (value.kind === "group" && value.addToGroupId !== undefined)
      ctx.addIssue({ code: "custom", path: ["addToGroupId"], message: "validation.invalid" });
    if (value.kind === "individual" && value.groupId !== undefined)
      ctx.addIssue({ code: "custom", path: ["groupId"], message: "validation.invalid" });
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
      z.object({ kind: z.literal("leftovers") }),
    ],
    { error: "validation.invalid" },
  )
  .meta({
    id: "MoveTarget",
    description: "A child (Give to a person) or Leftovers. Group photos never move here (C8).",
  });
export type MoveTarget = z.infer<typeof moveTarget>;

/** Move up to 500 of a job's photos by hand (drag, or Give to a person). Card and group photos can't be moved. */
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
  classId: childFields.classId,
});
export type ClaimBlankCardInput = z.infer<typeof claimBlankCardInput>;

export const TAGGING_PLACES = [
  "leftovers",
  "flagged",
  "child",
  "blankCard",
  "unlinkedCards",
] as const;
/** Places that list photos without an id. */
const PLACES_WITHOUT_ID: readonly string[] = ["leftovers", "flagged", "unlinkedCards"];

/** A page of the photos in one place on the review screen. Ids only in the URL (D96). */
export const taggingPhotosQuery = z
  .strictObject(
    {
      place: z.enum(TAGGING_PLACES, { error: "validation.invalid" }).meta({
        description:
          "leftovers, flagged, a child's photos (with their card photos), a blank card's photos, or unlinkedCards (card photos linked to none of the job's cards, such as photos marked card photos in Leftovers).",
      }),
      id: z
        .uuid({ error: "validation.invalid" })
        .optional()
        .meta({ description: "The child or blank card, for those places." }),
      cursor: z
        .uuid({ error: "validation.cursor" })
        .optional()
        .meta({ description: "The nextCursor from the previous page (a photo's id)." }),
      limit: z.coerce.number().int().min(1).max(500).default(PHOTO_PAGE_SIZE),
    },
    { error: "validation.unknownField" },
  )
  .refine((q) => PLACES_WITHOUT_ID.includes(q.place) === (q.id === undefined), {
    error: "validation.invalid",
    path: ["id"],
  });
export type TaggingPhotosQuery = z.infer<typeof taggingPhotosQuery>;

// ── Photos: People and Groups (D156, ADR 0030) ───────────────────────────────────────────────────────────────────
// Ids only in URLs (D113): group names travel in bodies.

/** A page of Photos' People view: 50 people at a time, optionally one group's members. */
export const photoPeopleQuery = z.strictObject(
  {
    groupId: z
      .uuid({ error: "validation.invalid" })
      .optional()
      .meta({ description: "Only this group's members." }),
    cursor: z
      .uuid({ error: "validation.cursor" })
      .optional()
      .meta({ description: "The nextCursor from the previous page (a child's id)." }),
    limit: z.coerce.number().int().min(1).max(PEOPLE_PAGE_SIZE).default(PEOPLE_PAGE_SIZE),
  },
  { error: "validation.unknownField" },
);
export type PhotoPeopleQuery = z.infer<typeof photoPeopleQuery>;

const groupName = z
  .string({ error: "validation.groupName" })
  .transform((name) => cleanGroupName(name))
  .pipe(
    z
      .string()
      .min(1, { error: "validation.groupName" })
      .refine((name) => [...name].length <= MAX_GROUP_NAME, { error: "validation.groupName" })
      .refine(isGroupNameText, { error: "validation.groupName" }),
  )
  .meta({
    description:
      "1 to 60 characters, unique per job ignoring case (C10); no control or bidi characters (as price list names).",
  });

/** Make a group by hand (+ New group), or rename one. */
export const photoGroupInput = z.object({ name: groupName });
export type PhotoGroupInput = z.infer<typeof photoGroupInput>;
export const photoGroupPatch = photoGroupInput;

/** Make a group for each value of a roster column, once (C3 as Seenu narrowed it; ADR 0030, call 9). */
export const groupsFromColumnInput = z.object({
  column: z.enum(GROUP_COLUMNS, { error: "validation.invalid" }).meta({
    description:
      "class (the job's classes, in its own word for them) or grade. Never a column holding a person's name or ID, the parent's email or a flag. Names already used by a group are skipped; blank values make no group.",
  }),
});
export type GroupsFromColumnInput = z.infer<typeof groupsFromColumnInput>;

const groupIds = (description: string) =>
  z
    .array(z.uuid({ error: "validation.invalid" }), { error: "validation.invalid" })
    .max(MAX_GROUP_CHANGE, { error: "validation.invalid" })
    .refine((ids) => new Set(ids).size === ids.length, { error: "validation.invalid" })
    .meta({ description });

/** Add and remove a group's members by hand: up to 500 each, nobody in both. */
export const groupMembersInput = z
  .object({
    add: groupIds("Children of the job to add (up to 500).").default([]),
    remove: groupIds("Members to take out (up to 500).").default([]),
  })
  .superRefine((value, ctx) => {
    if (value.add.length + value.remove.length === 0)
      ctx.addIssue({ code: "custom", path: ["add"], message: "validation.nothingToChange" });
    if (value.add.some((id) => value.remove.includes(id)))
      ctx.addIssue({ code: "custom", path: ["remove"], message: "validation.invalid" });
  });
export type GroupMembersInput = z.infer<typeof groupMembersInput>;

/** A page of a group's members or photos. */
export const groupPageQuery = z.strictObject(
  {
    cursor: z
      .uuid({ error: "validation.cursor" })
      .optional()
      .meta({ description: "The nextCursor from the previous page." }),
    limit: z.coerce.number().int().min(1).max(500).default(PHOTO_PAGE_SIZE),
  },
  { error: "validation.unknownField" },
);
export type GroupPageQuery = z.infer<typeof groupPageQuery>;

const groupPhotoIds = z
  .array(z.uuid({ error: "validation.invalid" }), { error: "validation.invalid" })
  .min(1, { error: "validation.invalid" })
  .max(MAX_GROUP_CHANGE, { error: "validation.invalid" })
  .refine((ids) => new Set(ids).size === ids.length, { error: "validation.invalid" })
  .meta({ description: "1 to 500 of the job's group photos." });

/** Move group photos to another group of the job (Move to group). */
export const moveGroupPhotosInput = z.object({
  photoIds: groupPhotoIds,
  toGroupId: z.uuid({ error: "validation.group" }).meta({ description: "The group they go to." }),
});
export type MoveGroupPhotosInput = z.infer<typeof moveGroupPhotosInput>;

/** Also show group photos in more groups (Also show in…): links only added. */
export const alsoShowPhotosInput = z.object({
  photoIds: groupPhotoIds,
  groupIds: groupIds("1 to 500 of the job's groups.").min(1, { error: "validation.group" }),
});
export type AlsoShowPhotosInput = z.infer<typeof alsoShowPhotosInput>;

/** Where a deleted group's photos go (C4): another group (photosTo=group&targetId=) or the bin. */
export const deleteGroupQuery = z
  .strictObject(
    {
      photosTo: z.enum(GROUP_PHOTOS_TO, { error: "validation.invalid" }).optional().meta({
        description: "group or bin; leave out for a group with no photos.",
      }),
      targetId: z
        .uuid({ error: "validation.group" })
        .optional()
        .meta({ description: "With photosTo=group: the group they go to." }),
    },
    { error: "validation.unknownField" },
  )
  .refine((q) => (q.photosTo === "group") === (q.targetId !== undefined), {
    error: "validation.group",
    path: ["targetId"],
  });
export type DeleteGroupQuery = z.infer<typeof deleteGroupQuery>;

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

// ── The parent shop (Phase 1 step 9, ADR 0022) ────────────────────────────────────────────────────────────────────

/**
 * An access code as the parent typed it: in the body only, never in a URL. Anything that isn't a code gets exactly the
 * answer a wrong code gets (and counts as one), so the format is not checked here, only that something was typed.
 */
export const shopCodeInput = z.strictObject(
  {
    code: z
      .string({ error: "validation.accessCode" })
      .trim()
      .min(1, { error: "validation.accessCode" })
      .max(40, { error: "validation.accessCode" })
      .meta({
        description:
          "The 8-character code from the photo card (K7QM-4XPA; spaces and dashes are fine). Personal data: never in URLs or logs.",
      }),
  },
  { error: "validation.unknownField" },
);
export type ShopCodeInput = z.infer<typeof shopCodeInput>;

const shopQuantity = z
  .number({ error: "validation.quantity" })
  .int({ error: "validation.quantity" })
  .min(1, { error: "validation.quantity" })
  .max(SHOP_MAX_QUANTITY, { error: "validation.quantity" });

/** Adds a package, print or download to the bag: a pose (photoId) for everything but all digitals. */
export const shopCartLineInput = z.strictObject(
  {
    childId: z.uuid({ error: "validation.invalid" }),
    itemId: z.uuid({ error: "validation.invalid" }),
    photoId: z
      .uuid({ error: "validation.invalid" })
      .nullable()
      .default(null)
      .meta({ description: "The pose: one of the child's portraits. Null for all digitals." }),
    quantity: shopQuantity
      .default(1)
      .meta({ description: "1 to 99; digital downloads are bought once." }),
  },
  { error: "validation.unknownField" },
);
export type ShopCartLineInput = z.infer<typeof shopCartLineInput>;

export const shopQuantityInput = z.strictObject(
  { quantity: shopQuantity },
  { error: "validation.unknownField" },
);
export type ShopQuantityInput = z.infer<typeof shopQuantityInput>;

export const shopShippingInput = z.strictObject(
  {
    method: z.enum(SHOP_SHIPPING_METHODS, { error: "validation.invalid" }).meta({
      description:
        "home (the bag's one home fee) or school (free, only if every job delivers to school).",
    }),
  },
  { error: "validation.unknownField" },
);
export type ShopShippingInput = z.infer<typeof shopShippingInput>;

/** Which of the device's galleries (one per studio, code review S6) a shop call is for. */
export const shopGalleryQuery = z.object({
  gallery: z
    .string()
    .regex(/^[0-9a-f]{32}$/, { error: "validation.invalid" })
    .optional()
    .meta({
      description:
        "A gallery's id from GET /shop/session. Without it, the device's first gallery. A gallery not on this device is 401 shop_session_required.",
    }),
});
export type ShopGalleryQuery = z.infer<typeof shopGalleryQuery>;

// ── Checkout and taxes (Phase 1 step 10, ADR 0023) ────────────────────────────────────────────────────────────────

// ── Orders and refunds (Phase 1 step 11, ADR 0024) ──────────────────────────────────────────────────────────────

/** An order reference as typed: dashes and spaces dropped, upper case, 1 to 8 of Crockford's base32 characters. */
const referenceSearch = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{1,8}$/, { error: "validation.reference" }));

/** Groups of order statuses asked for by name (D147): done is ORDER_DONE_STATUSES. */
export const ORDER_STAGES = ["done"] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

/**
 * The studio's paid orders, a page at a time (owners, admins and staff; Q4): optionally one job's, one status's (or
 * stage's), or those whose reference starts with `q`. Names are never searched (and never in a URL).
 */
export const orderListQuery = listQuery.extend({
  jobId: z
    .uuid({ error: "validation.invalid" })
    .optional()
    .meta({ description: "Only this job's orders (the job's Orders tab)." }),
  status: z
    .enum(ORDER_FULFILMENTS, { error: "validation.invalid" })
    .optional()
    .meta({ description: "Only orders at this step." }),
  q: referenceSearch.optional().meta({
    description: "The start of an order's reference, e.g. 7KQ2 or 7KQ2-M9XA. References only.",
  }),
  delivery: z.enum(SHOP_SHIPPING_METHODS, { error: "validation.invalid" }).optional().meta({
    description:
      "Only home delivery or delivery to school. With status paid or printed (what is waiting), fully refunded orders are left out.",
  }),
  stage: z.enum(ORDER_STAGES, { error: "validation.invalid" }).optional().meta({
    description:
      "done: orders with nothing left to do (shipped, delivered to school or complete; D147). Not with status.",
  }),
  childId: z.uuid({ error: "validation.invalid" }).optional().meta({
    description: "Only orders with a line for this person (a subject on a job's roster; D153).",
  }),
});
export type OrderListQuery = z.infer<typeof orderListQuery>;

// ── Saved filter chips (D147, ADR 0026) ───────────────────────────────────────────────────────────────────────────

/**
 * The lists whose "+ Add filter" chips are saved, per person: the studio-wide ones (Jobs, Orders, and People's Clients,
 * Contacts and Subjects, ADR 0028) and three of a job's tabs.
 */
export const LIST_PAGES = [
  "jobs",
  "orders",
  "job_subjects",
  "job_orders",
  "job_photos",
  "people_clients",
  "people_contacts",
  "people_subjects",
] as const;
export type ListPage = (typeof LIST_PAGES)[number];
/** The lists that belong to one job: their chips are that job's only. */
export const JOB_LIST_PAGES = ["job_subjects", "job_orders", "job_photos"] as const;
export function isJobListPage(page: ListPage): boolean {
  return (JOB_LIST_PAGES as readonly string[]).includes(page);
}
/** At most this many saved chips per list (and per job, for a job's tabs). */
export const MAX_LIST_FILTERS = 8;
/**
 * The chips each list takes, by key: true when the chip names a record by id (a client, a job, a class), which must be
 * the studio's own (and a class of the job's). Never text: names are looked up by id when shown (D113).
 */
export const LIST_FILTER_KEYS = {
  jobs: { closingThisWeek: false, pictureDayThisMonth: false, client: true },
  orders: { deliveryHome: false, deliverySchool: false, job: true },
  job_orders: { deliveryHome: false, deliverySchool: false },
  job_subjects: {
    class: true,
    noClass: false,
    doNotPhotograph: false,
    doNotPublish: false,
    duplicates: false,
    noPhotos: false,
    group: true,
  },
  job_photos: { group: true },
  people_clients: {},
  people_contacts: { client: true },
  people_subjects: { job: true, client: true },
} as const satisfies Record<ListPage, Record<string, boolean>>;

/** Whether `key` is one of `page`'s chips, and if so whether it takes an id. */
export function listFilterNeedsValue(page: ListPage, key: string): boolean | undefined {
  const keys: Record<string, boolean> = LIST_FILTER_KEYS[page];
  return Object.hasOwn(keys, key) ? keys[key] : undefined;
}

export const listFiltersQuery = z.object({
  page: z.enum(LIST_PAGES, { error: "validation.invalid" }).meta({ description: "Which list." }),
  jobId: z
    .uuid({ error: "validation.invalid" })
    .optional()
    .meta({ description: "The job, for a job's tab (job_subjects, job_orders, job_photos) only." }),
});

const listFilterChipInput = z.strictObject(
  {
    key: z
      .string({ error: "validation.filterChips" })
      .regex(/^[a-z][a-zA-Z]{1,39}$/, { error: "validation.filterChips" }),
    value: z.uuid({ error: "validation.filterChips" }).nullable().optional(),
  },
  { error: "validation.filterChips" },
);

/**
 * A person's chips for one list, in order, replacing what was saved. Each key must be one of the list's (see
 * LIST_FILTER_KEYS), with an id exactly when the key names a record, and each chip only once.
 */
export const listFiltersInput = z
  .object({
    page: listFiltersQuery.shape.page,
    jobId: listFiltersQuery.shape.jobId,
    chips: z
      .array(listFilterChipInput, { error: "validation.filterChips" })
      .max(MAX_LIST_FILTERS, { error: "validation.filterChips" })
      .meta({ description: `At most ${MAX_LIST_FILTERS}, in the order shown.` }),
  })
  .superRefine((input, ctx) => {
    if ((input.jobId !== undefined) !== isJobListPage(input.page))
      ctx.addIssue({ code: "custom", path: ["jobId"], message: "validation.invalid" });
    const seen = new Set<string>();
    for (const chip of input.chips) {
      const needsValue = listFilterNeedsValue(input.page, chip.key);
      const hasValue = chip.value !== undefined && chip.value !== null;
      const id = `${chip.key}:${hasValue ? chip.value?.toLowerCase() : ""}`;
      if (needsValue === undefined || needsValue !== hasValue || seen.has(id)) {
        ctx.addIssue({ code: "custom", path: ["chips"], message: "validation.filterChips" });
        return;
      }
      seen.add(id);
    }
  });
export type ListFiltersInput = z.infer<typeof listFiltersInput>;

const trackingNumber = z
  .string({ error: "validation.trackingNumber" })
  .transform((v, ctx) => {
    const number = normalizeTrackingNumber(v);
    if (!number) {
      ctx.addIssue({ code: "custom", message: "validation.trackingNumber" });
      return z.NEVER;
    }
    return number;
  })
  .meta({ description: "4 to 40 letters, digits, spaces and dashes." });

const trackingUrl = z
  .url({ protocol: /^https$/, error: "validation.trackingUrl" })
  .max(500, { error: "validation.trackingUrl" })
  .nullable()
  .default(null)
  .meta({ description: "Only for other carriers: their own https tracking page." });

const trackingFields = {
  carrier: z.enum(CARRIERS, { error: "validation.carrier" }),
  trackingNumber,
  trackingUrl,
};

const linkOnlyForOther = (
  v: { carrier: string; trackingUrl: string | null },
  ctx: z.RefinementCtx,
) => {
  if (v.trackingUrl !== null && v.carrier !== "other")
    ctx.addIssue({ code: "custom", path: ["trackingUrl"], message: "validation.trackingUrlOther" });
};

/** Mark one order Printed, Shipped (home: a carrier and tracking number) or Delivered to school (answer 4). */
export const orderStatusInput = z.discriminatedUnion(
  "status",
  [
    z.strictObject({ status: z.literal("printed") }, { error: "validation.unknownField" }),
    z
      .strictObject(
        { status: z.literal("shipped"), ...trackingFields },
        { error: "validation.unknownField" },
      )
      .superRefine(linkOnlyForOther),
    z.strictObject({ status: z.literal("delivered") }, { error: "validation.unknownField" }),
  ],
  { error: "validation.orderStatus" },
);
export type OrderStatusInput = z.infer<typeof orderStatusInput>;

/** Correct a shipped order's tracking. */
export const orderTrackingInput = z
  .strictObject(trackingFields, { error: "validation.unknownField" })
  .superRefine(linkOnlyForOther);
export type OrderTrackingInput = z.infer<typeof orderTrackingInput>;

/** Take one step back, saying why (owners and admins). */
export const orderUndoInput = z.strictObject(
  { reason: z.enum(STATUS_UNDO_REASONS, { error: "validation.undoReason" }) },
  { error: "validation.unknownField" },
);
export type OrderUndoInput = z.infer<typeof orderUndoInput>;

/** Mark printed, or Mark delivered to school, for up to 100 orders. */
export const bulkOrderStatusInput = z.strictObject(
  {
    orderIds: z
      .array(z.uuid({ error: "validation.invalid" }), { error: "validation.orderIds" })
      .min(1, { error: "validation.orderIds" })
      .max(100, { error: "validation.orderIds" })
      .refine((ids) => new Set(ids).size === ids.length, { error: "validation.orderIds" }),
    status: z.enum(["printed", "delivered"], { error: "validation.orderStatus" }),
  },
  { error: "validation.unknownField" },
);
export type BulkOrderStatusInput = z.infer<typeof bulkOrderStatusInput>;

const refundCommon = {
  requestId: z.uuid({ error: "validation.invalid" }).meta({
    description:
      "Made by the client once per refund: sending the same one again is the same refund.",
  }),
  shipping: z
    .boolean({ error: "validation.invalid" })
    .default(false)
    .meta({ description: "Also refund all the shipping that is left." }),
  reason: z
    .enum(REFUND_REASONS, { error: "validation.refundReason" })
    .nullable()
    .default(null)
    .meta({ description: "From a fixed list; never free text." }),
};

/**
 * A refund (owners and admins, answer 3): by line and quantity, or a custom amount of products before tax (Q3); tax is
 * added pro rata and Daybell's fee on it given back (answer 1). By line with no lines and the shipping is a
 * shipping-only refund.
 */
export const refundInput = z.discriminatedUnion(
  "kind",
  [
    z
      .strictObject(
        {
          kind: z.literal("lines"),
          lines: z
            .array(
              z.strictObject(
                {
                  lineId: z.uuid({ error: "validation.invalid" }),
                  quantity: z
                    .number({ error: "validation.quantity" })
                    .int({ error: "validation.quantity" })
                    .min(1, { error: "validation.quantity" })
                    .max(99, { error: "validation.quantity" }),
                },
                { error: "validation.unknownField" },
              ),
              { error: "validation.refundLines" },
            )
            .max(100, { error: "validation.refundLines" })
            .refine((l) => new Set(l.map((x) => x.lineId)).size === l.length, {
              error: "validation.refundLines",
            }),
          ...refundCommon,
        },
        { error: "validation.unknownField" },
      )
      .superRefine((v, ctx) => {
        // No lines is a shipping-only refund (code review S5); without the shipping it is nothing.
        if (v.lines.length === 0 && !v.shipping)
          ctx.addIssue({ code: "custom", path: ["lines"], message: "validation.refundLines" });
      }),
    z.strictObject(
      {
        kind: z.literal("custom"),
        amountCents: z
          .number({ error: "validation.refundAmount" })
          .int({ error: "validation.refundAmount" })
          .min(0, { error: "validation.refundAmount" })
          .max(1_000_000_000, { error: "validation.refundAmount" })
          .meta({ description: "Products before tax, in whole cents." }),
        ...refundCommon,
      },
      { error: "validation.unknownField" },
    ),
  ],
  { error: "validation.refundKind" },
);
export type RefundInput = z.infer<typeof refundInput>;

/** Home's numbers are counted in the person's own day (D127). */
export const salesQuery = z.object({
  tz: z
    .string({ error: "validation.timeZone" })
    .regex(/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/, { error: "validation.timeZone" })
    .max(64, { error: "validation.timeZone" })
    .meta({ description: "An IANA time zone, e.g. America/Toronto." }),
});
export type SalesQuery = z.infer<typeof salesQuery>;

const addressLine = (error: string) =>
  z
    .string({ error })
    .trim()
    .min(1, { error })
    .max(100, { error: "validation.tooLong" })
    // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control and bidi characters is the point.
    .refine((v) => !/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(v), { error });

/**
 * The studio's business address, sent to Stripe as its tax head office (call 3). Daybell keeps only the province.
 * Canada without Quebec at launch.
 */
export const taxHeadOfficeInput = z.strictObject(
  {
    line1: addressLine("validation.addressLine"),
    // The same refusal of control and bidi characters as line 1 (security review S4): it goes straight to Stripe.
    line2: z
      .string()
      .trim()
      .max(100, { error: "validation.tooLong" })
      // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control and bidi characters is the point.
      .refine((v) => !/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(v), {
        error: "validation.addressLine",
      })
      .nullable()
      .default(null)
      .transform((v) => v || null),
    city: addressLine("validation.city"),
    province: z
      .enum(HEAD_OFFICE_PROVINCES, { error: "validation.province" })
      .meta({ description: "Two letters, e.g. ON. Quebec isn't offered at launch." }),
    postalCode: z
      .string({ error: "validation.postalCode" })
      .transform((v, ctx) => {
        const code = normalizePostalCode(v);
        if (!code) {
          ctx.addIssue({ code: "custom", message: "validation.postalCode" });
          return z.NEVER;
        }
        return code;
      })
      .meta({ description: "e.g. M5V 2T6." }),
  },
  { error: "validation.unknownField" },
);
export type TaxHeadOfficeInput = z.infer<typeof taxHeadOfficeInput>;

const taxNumber = (kind: "gst_hst" | "pst", error: string) =>
  z.string({ error }).transform((v, ctx) => {
    const number = normalizeTaxNumber(kind, v);
    if (!number) {
      ctx.addIssue({ code: "custom", message: error });
      return z.NEVER;
    }
    return number;
  });

/** A GST/HST registration, or a PST one in BC, MB or SK (answer 2). The owner only (call 6). */
export const taxRegistrationInput = z.discriminatedUnion(
  "kind",
  [
    z.strictObject(
      {
        kind: z.literal("gst_hst"),
        number: taxNumber("gst_hst", "validation.gstHstNumber").meta({
          description: "9 digits, RT and 4 digits, e.g. 123456789RT0001.",
        }),
      },
      { error: "validation.unknownField" },
    ),
    z.strictObject(
      {
        kind: z.literal("pst"),
        province: z.enum(PST_PROVINCES, { error: "validation.pstProvince" }),
        number: taxNumber("pst", "validation.pstNumber").meta({
          description: "As the province writes it: letters, digits, spaces and dashes.",
        }),
      },
      { error: "validation.unknownField" },
    ),
  ],
  { error: "validation.taxKind" },
);
export type TaxRegistrationInput = z.infer<typeof taxRegistrationInput>;
