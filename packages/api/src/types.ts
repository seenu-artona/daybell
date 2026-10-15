import { DATA_REGIONS } from "@daybell/config";
import {
  CARRIERS,
  CURRENCIES,
  JOB_STATUSES,
  JOB_TYPES,
  MILESTONES,
  NOTIFICATION_KINDS,
  NOTIFICATIONS_SHOWN,
  ONBOARDING_TASKS,
  ORDER_FULFILMENTS,
  ORDER_STATUSES,
  PAYOUT_ACCOUNT_STATUSES,
  PAYOUT_INTERVALS,
  PAYOUT_METHODS,
  PAYOUT_STATUSES,
  PAYOUT_WEEKDAYS,
  PHOTO_FLAGS,
  PHOTO_PLACES,
  PRICE_ITEM_KINDS,
  PRINT_SIZES,
  PROGRESS_STAGES,
  PROGRESS_STEP_STATES,
  PROGRESS_STEPS,
  PST_PROVINCES,
  REFUND_KINDS,
  REFUND_REASONS,
  REFUND_STATUSES,
  RULE_KEYS,
  SHOP_OPENS,
  SHOP_SHIPPING_METHODS,
  TASK_KEYS,
  TAX_REGISTRATION_KINDS,
  UP_NEXT_SHOWN,
} from "@daybell/core";
import { z } from "zod";

/**
 * Response shapes for /api/v1, defined once as schemas: TypeScript types come from them, and so do the API docs (D92).
 */
export const STUDIO_ROLES = ["owner", "admin", "photographer", "staff"] as const;
export const studioRole = z
  .enum(STUDIO_ROLES)
  .meta({ description: "What a person may do in a studio." });
export type StudioRole = z.infer<typeof studioRole>;

export const studioSummary = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string().meta({ description: "The studio's web address, e.g. north-peak." }),
    region: z.enum(DATA_REGIONS).meta({ description: "Where the studio's data lives (D113)." }),
    role: studioRole.meta({ description: "The signed-in person's role here." }),
  })
  .meta({ id: "StudioSummary" });
export type StudioSummary = z.infer<typeof studioSummary>;

export const meResponse = z.object({ email: z.email(), studio: studioSummary.nullable() }).meta({
  id: "Me",
  description: "The signed-in person and their studio (null until they belong to one).",
});
export type MeResponse = z.infer<typeof meResponse>;

export const teamMember = z
  .object({ userId: z.uuid(), email: z.email(), role: studioRole })
  .meta({ id: "TeamMember" });
export type TeamMember = z.infer<typeof teamMember>;

export const pendingInvite = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: z.enum(["admin", "photographer", "staff"]),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "PendingInvite" });
export type PendingInvite = z.infer<typeof pendingInvite>;

export const ACTIVITY_TYPES = [
  "studio.created",
  "studio.updated",
  "member.joined",
  "member.role_changed",
  "member.removed",
  "invite.created",
  "invite.accepted",
  "invite.withdrawn",
  "client.created",
  "client.updated",
  "job.created",
  "job.updated",
  // Going live (ADR 0021): the shop opened (or reopened) and closed.
  "job.selling",
  "job.closed",
  "roster.imported",
  "qr_cards.printed",
  // Orders (ADR 0024): paid, each fulfilment step, refunds and a parent's cancel. Never amounts or names.
  "order.paid",
  "order.printed",
  "order.shipped",
  "order.delivered",
  "order.refunded",
  "order.canceled",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activityItem = z
  .object({
    id: z.number().int(),
    type: z.enum(ACTIVITY_TYPES),
    actorEmail: z.email().nullable().meta({ description: "Who did it, if still on the team." }),
    hasActor: z.boolean().meta({
      description:
        "Whether a person did it. False for things that happened on their own (a shop closed by its closing date); actorEmail is also null when the person has left the team.",
    }),
    subjectEmail: z
      .email()
      .nullable()
      .meta({ description: "Who it was about, for member events." }),
    role: studioRole.nullable(),
    subjectName: z.string().nullable().meta({
      description:
        "The job's or client's current name, for job, client, roster and QR card events; the order's reference for order events.",
    }),
    subjectId: z.uuid().nullable().meta({
      description: "What it was about (an order's id for order events, to link to it).",
    }),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .meta({
    id: "ActivityItem",
    description: "One line of the studio's activity log. Events store IDs only (D96).",
  });
export type ActivityItem = z.infer<typeof activityItem>;

export const teamResponse = z.object({ team: z.array(teamMember) });
export const invitesResponse = z.object({ invites: z.array(pendingInvite) });
export const inviteCreatedResponse = z.object({
  link: z.url().meta({
    description: "Send this to the invited person. Works once, for their email, for 7 days.",
  }),
});
export const activityResponse = z.object({ activity: z.array(activityItem) });
export const checkEmailResponse = z.object({ status: z.literal("check_email") });

// ── Clients and jobs (Phase 1 step 1, ADR 0008 and 0009) ──────────────────────────────────────────────────────────
const nextCursor = z
  .uuid()
  .nullable()
  .meta({ description: "Pass as ?cursor= for the next page; null on the last page." });

export const client = z
  .object({
    id: z.uuid(),
    name: z.string(),
    addressLine1: z.string().nullable(),
    addressLine2: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable().meta({ description: "State or province code." }),
    country: z.enum(["US", "CA"]).nullable(),
    contactFirstName: z.string().nullable(),
    contactLastName: z.string().nullable(),
    contactPhone: z.string().nullable(),
    contactEmail: z.string().nullable(),
    notes: z.string().nullable().meta({ description: "Only visible to the studio." }),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({
    id: "Client",
    description: "A school, daycare, team or family the studio photographs for.",
  });
export type Client = z.infer<typeof client>;

export const clientRef = z
  .object({ id: z.uuid(), name: z.string(), city: z.string().nullable() })
  .meta({ id: "ClientRef" });

/** A job's or a template's rules (D152, D154; ADR 0029), counted from picture day. */
export const jobRules = z
  .object({
    qrCardsDaysBefore: z.number().int().nullable().meta({
      description: "QR cards ready this many days before picture day; null: no day planned.",
    }),
    shopOpens: z.enum(SHOP_OPENS).meta({
      description:
        "photosChecked: once the photos are checked; afterPictureDay: shopOpensDays after picture day.",
    }),
    shopOpensDays: z.number().int().nullable(),
    shopClosesDays: z.number().int().nullable().meta({
      description:
        "The shop closes this many days after it first opens; null: when someone closes it.",
    }),
  })
  .meta({ id: "JobRules" });
export type JobRulesView = z.infer<typeof jobRules>;
export const ruleKey = z.enum(RULE_KEYS).meta({
  id: "RuleKey",
  description:
    "qrCards (QR cards ready), shopOpens or shopCloses: a rule a job can change for itself.",
});

export const job = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum(JOB_TYPES),
    status: z.enum(JOB_STATUSES).meta({
      description:
        "New jobs are drafts; Start selling makes them selling, Close shop closed, Reopen shop selling again (ADR 0021).",
    }),
    pictureDay: z.iso.date(),
    client: clientRef.nullable(),
    internalNumber: z.string().meta({ description: "Only the studio sees it." }),
    subjectsExpected: z.number().int().nullable(),
    priceListId: z.uuid().meta({ description: "The price list the job sells from (ADR 0019)." }),
    deliverToSchool: z.boolean().meta({
      description: "Parents may choose free delivery to the school as well as paid home shipping.",
    }),
    closesAt: z.iso.datetime({ offset: true }).nullable().meta({
      description:
        "When the shop closes by itself (ADR 0021); null for no closing date. Cleared when the shop closes.",
    }),
    openedAt: z.iso.datetime({ offset: true }).nullable().meta({
      description:
        "When the shop first opened; null while a draft and for shops opened before templates.",
    }),
    template: z.object({ id: z.uuid(), name: z.string() }).nullable().meta({
      description:
        "The template the job was made from (D154); null for jobs made before templates, or when it was deleted.",
    }),
    rules: jobRules.meta({
      description: "The job's own rules, copied from its template when it was made.",
    }),
    changedRules: z.array(ruleKey).meta({
      description:
        "The rules that differ from what the template gave the job (D152: 'Changed for this job'); while the shop sells, a closing date other than the template rule's counts as a shopCloses change. Empty for jobs made before templates.",
    }),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "Job", description: "A shoot or season the studio photographs and sells." });
export type Job = z.infer<typeof job>;

// ── One checklist (Phase 1 step 2d, D143, ADR 0017) ───────────────────────────────────────────────────────────────
export const milestone = z.enum(MILESTONES).meta({
  id: "Milestone",
  description: "Set up, Picture day, Photos in, Selling, Fulfilment, in that order.",
});
export const taskKey = z.enum(TASK_KEYS).meta({
  id: "TaskKey",
  description:
    "A job checklist task. Only built tasks are listed; tasks tick themselves from the job's data.",
});

export const jobChecklistSummary = z
  .object({
    milestone: milestone.nullable().meta({
      description:
        "The group of the next unfinished task (Selling while the job sells); null once the job is closed (all done).",
    }),
    done: z.number().int(),
    total: z.number().int().meta({ description: "Built tasks in the job type's checklist." }),
    next: taskKey.nullable().meta({ description: "The next unfinished task, if any." }),
  })
  .meta({ id: "JobChecklistSummary", description: "Where the job is on its checklist (D143)." });
export type JobChecklistSummary = z.infer<typeof jobChecklistSummary>;

export const jobListItem = job
  .extend({ checklist: jobChecklistSummary })
  .meta({ id: "JobListItem", description: "A job in the Jobs list, with its checklist progress." });
export type JobListItem = z.infer<typeof jobListItem>;

export const jobsResponse = z.object({ jobs: z.array(jobListItem), nextCursor });

export const jobChecklist = jobChecklistSummary
  .extend({
    tasks: z
      .array(z.object({ key: taskKey, milestone, done: z.boolean() }))
      .meta({ description: "Every built task of the job type's list, in order." }),
    onTrack: z.boolean().meta({
      description:
        "Past Set up, with no date close and nothing broken (or closed): the Overview collapses the list.",
    }),
  })
  .meta({ id: "JobChecklist", description: "A job's whole checklist (D143)." });
export type JobChecklist = z.infer<typeof jobChecklist>;
export const jobDetailResponse = z.object({ job: job.extend({ checklist: jobChecklist }) });
export type JobDetailResponse = z.infer<typeof jobDetailResponse>;
export type JobsResponse = z.infer<typeof jobsResponse>;
export const jobResponse = z.object({ job });
export type JobResponse = z.infer<typeof jobResponse>;
// ── Job templates (D154) and a job's Progress and numbers (D152; ADR 0029) ──────────────────────────────────────
export const jobTemplate = z
  .object({
    id: z.uuid(),
    name: z.string(),
    isDefault: z.boolean().meta({ description: "New jobs get it unless another is chosen." }),
    usedBy: z.number().int().meta({ description: "Jobs made from it." }),
    rules: jobRules,
    priceListId: z
      .uuid()
      .nullable()
      .meta({ description: "The price list new jobs get; null: the studio's default." }),
    deliverToSchool: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "JobTemplate", description: "The rules a new job starts with (D154)." });
export type JobTemplate = z.infer<typeof jobTemplate>;
export const jobTemplatesResponse = z.object({
  templates: z.array(jobTemplate).meta({ description: "The default first, then by name." }),
});
export type JobTemplatesResponse = z.infer<typeof jobTemplatesResponse>;
export const jobTemplateResponse = z.object({ template: jobTemplate });
export type JobTemplateResponse = z.infer<typeof jobTemplateResponse>;

/** Why a template request was refused with 409, in the error's `fields.form`. */
export const JOB_TEMPLATE_CONFLICTS = {
  /** The default template can't be deleted; make another the default first. */
  isDefault: "templates.isDefault",
  /** At most 50 templates per studio. */
  limit: "templates.limit",
} as const;

export const progressStep = z
  .object({
    key: z.enum(PROGRESS_STEPS),
    state: z.enum(PROGRESS_STEP_STATES).meta({
      description:
        "done; now (the one to do now); next; automatic (the system does it from the job's rules); soon (not built yet).",
    }),
    at: z.iso
      .datetime({ offset: true })
      .nullable()
      .meta({ description: "When a done step happened." }),
    by: z.email().nullable().meta({
      description:
        "Who did it: a team member's email, for owners and admins only (null for everyone else).",
    }),
    planned: z.iso.date().nullable().meta({ description: "The day the job's rules plan it for." }),
    closesAt: z.iso
      .datetime({ offset: true })
      .nullable()
      .meta({ description: "Shop closes, while selling: the closing moment, or null for none." }),
    afterOpeningDays: z.number().int().nullable().meta({
      description:
        "Shop closes, before the shop opens: days after opening (null: when someone closes it).",
    }),
    whenPhotosChecked: z
      .boolean()
      .meta({ description: "Publish shop: once the photos are checked." }),
    changed: z
      .boolean()
      .meta({ description: "Its rule was changed for this job (D152); steps ahead only." }),
  })
  .meta({ id: "ProgressStep" });
export type ProgressStepView = z.infer<typeof progressStep>;
export const jobProgressResponse = z.object({
  progress: z
    .object({
      current: z.enum(PROGRESS_STAGES).nullable(),
      stages: z.array(
        z.object({
          key: z.enum(PROGRESS_STAGES),
          done: z.boolean().meta({ description: "Every built step in it is done." }),
          steps: z.array(progressStep),
        }),
      ),
    })
    .meta({
      id: "JobProgress",
      description:
        "Six stages, Prepare, Picture day, Photos, Selling, Fulfilment and Wrap-up, from the job's checklist (D143), its rules and the event log (D152).",
    }),
});
export type JobProgressResponse = z.infer<typeof jobProgressResponse>;
export type JobProgressView = JobProgressResponse["progress"];

export const jobSalesResponse = z.object({
  sales: z
    .object({
      currency: z.enum(CURRENCIES),
      salesCents: z.number().int().meta({
        description:
          "What parents paid less refunds, from the ledger (Home's rule), in whole cents.",
      }),
      orders: z.number().int().meta({ description: "Paid orders with a line in this job." }),
      firstPaidAt: z.iso.datetime({ offset: true }).nullable(),
      subjects: z.number().int().meta({ description: "Everyone on the job's roster." }),
      subjectsOrdered: z.number().int().meta({ description: "Of those, who has ordered (D148)." }),
    })
    .meta({ id: "JobSales", description: "A job's numbers (D152): owners and admins." }),
});
export type JobSalesResponse = z.infer<typeof jobSalesResponse>;

export const childFactsResponse = z.object({
  facts: z
    .object({
      cardPrintedAt: z.iso
        .datetime({ offset: true })
        .nullable()
        .meta({ description: "When their QR card was first printed." }),
      photographedAt: z.iso.datetime({ local: true }).nullable().meta({
        description:
          "The camera's clock at their first photo, as the camera wrote it (no time zone): show its day as it stands.",
      }),
    })
    .meta({ id: "ChildFacts" }),
});
export type ChildFactsResponse = z.infer<typeof childFactsResponse>;

export const nextJobNumberResponse = z.object({
  internalNumber: z.string().meta({ description: "The next free JOBnnnnn number." }),
});
// ── People (D150, ADR 0028) ───────────────────────────────────────────────────────────────────────────────────────
export const clientListItem = client
  .extend({
    mainContact: z
      .object({
        id: z.uuid(),
        firstName: z.string().nullable(),
        lastName: z.string().nullable(),
        role: z.string().nullable(),
        email: z.string().nullable().meta({ description: "Shown when the contact has no name." }),
      })
      .nullable()
      .meta({ description: "The client's main contact, if it has one." }),
    jobCount: z.number().int().meta({ description: "How many jobs are for this client." }),
    latestJob: z
      .object({ id: z.uuid(), name: z.string(), pictureDay: z.iso.date() })
      .nullable()
      .meta({ description: "The client's job with the latest picture day, if any." }),
  })
  .meta({
    id: "ClientListItem",
    description: "A client in the clients list, with its main contact and jobs. No money (D150).",
  });
export type ClientListItem = z.infer<typeof clientListItem>;
export const clientsResponse = z.object({
  clients: z.array(clientListItem),
  nextCursor,
  total: z.number().int().meta({ description: "Clients matching ?q=." }),
});
export type ClientsResponse = z.infer<typeof clientsResponse>;
export const clientResponse = z.object({ client });

export const contact = z
  .object({
    id: z.uuid(),
    clientId: z.uuid(),
    clientName: z.string().meta({ description: "The client's current name." }),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    role: z.string().nullable().meta({ description: "Their role at the client." }),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    isMain: z.boolean().meta({
      description:
        "The client's main contact: its name, phone and email are the client's contactFirstName, contactLastName, contactPhone and contactEmail.",
    }),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({
    id: "Contact",
    description:
      "Someone the studio works with at a client. Personal data. Has a name, an email or a phone.",
  });
export type Contact = z.infer<typeof contact>;
export const contactsResponse = z.object({
  contacts: z.array(contact),
  nextCursor,
  total: z.number().int().meta({ description: "Contacts matching the filters." }),
});
export type ContactsResponse = z.infer<typeof contactsResponse>;
export const contactResponse = z.object({ contact });
export type ContactResponse = z.infer<typeof contactResponse>;

export const subject = z
  .object({
    id: z.uuid().meta({ description: "The child's id in their job's roster." }),
    firstName: z.string(),
    lastName: z.string(),
    className: z
      .string()
      .nullable()
      .meta({ description: "Their class, team or group in the job." }),
    job: z.object({ id: z.uuid(), name: z.string() }),
    hasPaidOrder: z.boolean().nullable().meta({
      description:
        "A paid order, neither canceled nor refunded in full, has a line of the child's own that wasn't given back in full (D148). Null for people who don't see orders (photographers).",
    }),
  })
  .meta({
    id: "Subject",
    description: "A child in one of the studio's jobs: one row per child per job.",
  });
export type Subject = z.infer<typeof subject>;
export const subjectsResponse = z.object({
  subjects: z.array(subject),
  nextCursor,
  total: z.number().int().meta({ description: "Children matching the filters." }),
  jobs: z.number().int().meta({ description: "How many jobs those children are in." }),
});
export type SubjectsResponse = z.infer<typeof subjectsResponse>;

// ── Search (Phase 1 step 2b, ADR 0013) ────────────────────────────────────────────────────────────────────────────
export const searchJob = job
  .pick({ id: true, name: true, internalNumber: true, status: true, pictureDay: true })
  .meta({ id: "SearchJob", description: "A job found by the menu search." });
export type SearchJob = z.infer<typeof searchJob>;
export const searchResponse = z.object({
  jobs: z.array(searchJob).meta({ description: "At most 10, starts-with matches first." }),
  clients: z.array(clientRef).meta({ description: "At most 10, starts-with matches first." }),
});
export type SearchResponse = z.infer<typeof searchResponse>;
export type ClientRef = z.infer<typeof clientRef>;

// ── Roster (Phase 1 step 2, ADR 0011) ─────────────────────────────────────────────────────────────────────────────
export const group = z
  .object({
    id: z.uuid(),
    name: z.string(),
    childCount: z.number().int().meta({ description: "Children in it." }),
  })
  .meta({ id: "Group", description: "A class, team or group of children in a job." });
export type Group = z.infer<typeof group>;

export const child = z
  .object({
    id: z.uuid(),
    jobId: z.uuid(),
    group: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    firstName: z.string(),
    lastName: z.string(),
    studentId: z.string().nullable(),
    grade: z.string().nullable(),
    parentEmail: z.string().nullable(),
    doNotPhotograph: z.boolean(),
    doNotPublish: z.boolean(),
    schoolProvided: z
      .boolean()
      .meta({ description: "Roster data from the school; never used for marketing." }),
    accessCode: z.string().nullable().meta({
      description:
        "8 characters shown as K7QM-4XPA, or null if the stored copy can't be read. Never put it in URLs or logs.",
    }),
    duplicate: z.boolean().meta({
      description:
        "Another child in the job has the same student ID, or (without IDs) the same name in the same class.",
    }),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({
    id: "Child",
    description: "A child on a job's roster. Names, emails and codes are personal data.",
  });
export type Child = z.infer<typeof child>;

/**
 * A child as the roster list has them (D147): with their photo count and whether a paid order has a line for them.
 * Only the list carries these; one child's own endpoints don't.
 */
export const rosterChild = child
  .extend({
    photoCount: z.number().int().meta({
      description:
        "Ready photos tagged to the child, outside the bin; flagged ones count (they wait for a check).",
    }),
    hasPaidOrder: z.boolean().nullable().meta({
      description:
        "A paid order that is neither canceled nor refunded in full has a line for the child in this job. Null for people who don't see orders (photographers).",
    }),
  })
  .meta({ id: "RosterChild", description: "A child in the roster list, with photos and orders." });
export type RosterChild = z.infer<typeof rosterChild>;

export const childrenResponse = z.object({
  children: z.array(rosterChild),
  nextCursor,
  total: z.number().int().meta({ description: "Children matching the filter." }),
  duplicates: z.number().int().meta({ description: "Of those, how many are flagged duplicates." }),
});
export type ChildrenResponse = z.infer<typeof childrenResponse>;
export const childResponse = z.object({ child });
export const groupsResponse = z.object({ groups: z.array(group) });
export type GroupsResponse = z.infer<typeof groupsResponse>;
export const groupResponse = z.object({ group });

export const rosterImportResponse = z
  .object({
    dryRun: z.boolean(),
    added: z.number().int(),
    updated: z.number().int(),
    groupsAdded: z.number().int(),
    duplicates: z.number().int().meta({ description: "Rows flagged as duplicates." }),
    rows: z
      .array(
        z.object({
          action: z.enum(["add", "update"]),
          duplicate: z.boolean(),
        }),
      )
      .meta({ description: "One per request row, in the same order." }),
  })
  .meta({ id: "RosterImport" });
export type RosterImportResponse = z.infer<typeof rosterImportResponse>;

// ── QR cards (Phase 1 step 3, ADR 0015) ───────────────────────────────────────────────────────────────────────────
export const qrCardStatus = z
  .object({
    eligible: z.number().int().meta({ description: "Children not marked Do not photograph." }),
    withCard: z.number().int().meta({ description: "Of those, how many have a card." }),
    blankCards: z.number().int().meta({ description: "Blank cards printed for the job." }),
  })
  .meta({
    id: "QrCardStatus",
    description:
      "Print QR cards is done when every child who may be photographed has a card (eligible > 0 and withCard = eligible).",
  });
export type QrCardStatus = z.infer<typeof qrCardStatus>;
export const qrCardStatusResponse = z.object({ qrCards: qrCardStatus });
export type QrCardStatusResponse = z.infer<typeof qrCardStatusResponse>;

/** Response headers of the QR card PDF: counts only, so the dialog can say what happened (never names or codes). */
export const QR_CARD_HEADERS = {
  cards: "Daybell-Cards",
  skipped: "Daybell-Cards-Skipped",
  replaced: "Daybell-Cards-Replaced-Characters",
} as const;

/**
 * Why a print was refused with 409, in the error's `fields.form` (stable keys; screens show their own words). With
 * codesUnreadable, the Daybell-Cards-Skipped header says how many cards were left out.
 */
export const QR_CARD_CONFLICTS = {
  nothingToPrint: "qrCards.nothingToPrint",
  doNotPhotograph: "qrCards.doNotPhotograph",
  codesUnreadable: "qrCards.codesUnreadable",
} as const;
export type QrCardConflict = (typeof QR_CARD_CONFLICTS)[keyof typeof QR_CARD_CONFLICTS];

// ── Photos (Phase 1 step 4, ADR 0016) ─────────────────────────────────────────────────────────────────────────────
export const PHOTO_STATUSES = ["processing", "ready", "failed"] as const;
export const PHOTO_FAILURE_REASONS = [
  "not_jpeg",
  "too_large",
  "hash_mismatch",
  "unreadable",
  "incomplete",
] as const;

export const photo = z
  .object({
    id: z.uuid(),
    batchId: z.uuid(),
    status: z.enum(PHOTO_STATUSES).meta({
      description:
        "processing: previews are being made; ready: they are; failed: see failureReason.",
    }),
    originalFilename: z
      .string()
      .meta({ description: "As uploaded. Can be personal data: never put it in URLs or logs." }),
    byteSize: z.number().int(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    capturedAt: z.string().nullable().meta({
      description:
        "EXIF capture time with sub-seconds, as the camera's clock wrote it (no time zone), or null.",
    }),
    failureReason: z.enum(PHOTO_FAILURE_REASONS).nullable(),
    binnedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    retryable: z.boolean().meta({
      description:
        "Its previews can be made again: the worker couldn't read it, or it has been processing for 15 minutes.",
    }),
    thumbUrl: z.url().nullable().meta({
      description:
        "A 400 px preview (WebP, unwatermarked, for the studio only), signed for up to an hour; null until ready.",
    }),
  })
  .meta({
    id: "Photo",
    description:
      "A photo of a job. The original is never served; previews are made once, at upload.",
  });
export type Photo = z.infer<typeof photo>;

export const photosResponse = z.object({
  photos: z
    .array(photo)
    .meta({ description: "In tagging order: upload batch, capture time, filename." }),
  nextCursor: z
    .uuid()
    .nullable()
    .meta({ description: "Pass as ?cursor= for the next page; null on the last page." }),
});
export type PhotosResponse = z.infer<typeof photosResponse>;

export const photoDetailResponse = z.object({
  photo: photo.extend({
    viewUrl: z.url().nullable().meta({
      description:
        "A 1600 px preview (WebP, unwatermarked, studio only), signed for up to an hour.",
    }),
  }),
});
export type PhotoDetailResponse = z.infer<typeof photoDetailResponse>;

export const photoCounts = z
  .object({
    photos: z.number().int().meta({ description: "Uploaded, not in the bin." }),
    ready: z.number().int(),
    processing: z.number().int(),
    failed: z.number().int(),
    uploading: z.number().int().meta({ description: "Registered and not finished uploading." }),
    binned: z.number().int(),
    uploads: z.number().int().meta({ description: "Upload batches (drops of photos)." }),
    duplicatesSkipped: z.number().int(),
    leftovers: z
      .number()
      .int()
      .meta({ description: "Photos in Leftovers after QR tagging (not in the bin)." }),
    flagged: z.number().int().meta({ description: "Photos flagged for checking at review." }),
  })
  .meta({
    id: "PhotoCounts",
    description: "The checklist's Upload photos task is done once ready > 0.",
  });
export type PhotoCounts = z.infer<typeof photoCounts>;
export const photoCountsResponse = z.object({ counts: photoCounts });
export type PhotoCountsResponse = z.infer<typeof photoCountsResponse>;

export const uploadBatchResponse = z.object({ batchId: z.uuid() });
export type UploadBatchResponse = z.infer<typeof uploadBatchResponse>;

export const UPLOAD_OUTCOMES = ["new", "resume", "duplicate", "duplicate_in_bin"] as const;
export type UploadOutcome = (typeof UPLOAD_OUTCOMES)[number];

export const registerFilesResponse = z.object({
  results: z
    .array(
      z.object({
        index: z.number().int().meta({ description: "The file's place in the request." }),
        outcome: z.enum(UPLOAD_OUTCOMES).meta({
          description:
            "new: upload it. resume: the same file is still uploading; ask upload-parts which parts are missing. duplicate / duplicate_in_bin: the job has it already, skipped.",
        }),
        photoId: z.uuid().nullable(),
        partSize: z.number().int(),
        partCount: z.number().int(),
      }),
    )
    .meta({ description: "One per file, in request order." }),
});
export type RegisterFilesResponse = z.infer<typeof registerFilesResponse>;

export const partUrlsResponse = z.object({
  urls: z.array(
    z.object({
      photoId: z.uuid(),
      partNumber: z.number().int(),
      url: z
        .url()
        .meta({ description: "PUT exactly this part's bytes here; any other length is refused." }),
    }),
  ),
  expiresIn: z.number().int().meta({ description: "Seconds the URLs stay valid." }),
});
export type PartUrlsResponse = z.infer<typeof partUrlsResponse>;

export const uploadPartsResponse = z.object({
  parts: z.array(z.number().int()).meta({ description: "Part numbers already uploaded whole." }),
  partSize: z.number().int(),
  partCount: z.number().int(),
});
export type UploadPartsResponse = z.infer<typeof uploadPartsResponse>;

export const uploadCompleteResponse = z.object({
  status: z.enum(["processing", "failed"]).meta({
    description: "failed: the stored file wasn't the declared size; drop the file again.",
  }),
});
export type UploadCompleteResponse = z.infer<typeof uploadCompleteResponse>;

export const photosMovedResponse = z.object({
  moved: z
    .number()
    .int()
    .meta({ description: "Photos that moved (already there ones don't count)." }),
});
export type PhotosMovedResponse = z.infer<typeof photosMovedResponse>;

/** What the image worker learns about a photo (internal route): ids, hash, size and the studio's name for the watermark. */
export const workerPhotoResponse = z.object({
  photo: z.object({
    id: z.uuid(),
    studioId: z.uuid(),
    jobId: z.uuid(),
    status: z.enum(["uploading", "processing", "ready", "failed"]),
    sha256: z.string(),
    byteSize: z.number().int(),
    attempt: z.number().int(),
    studioName: z.string(),
  }),
});
export const workerRecordedResponse = z.object({
  recorded: z.boolean().meta({ description: "false if the photo had already been processed." }),
});
export const cronPhotosResponse = z.object({
  finishedBatches: z.number().int(),
  droppedUploads: z.number().int(),
  purgedPhotos: z.number().int(),
  taggedBatches: z
    .number()
    .int()
    .meta({ description: "Upload batches tagged by the sweep (ADR 0018)." }),
});

// ── QR tagging and review (Phase 1 step 5, ADR 0018) ─────────────────────────────────────────────────────────────
export const photoPlace = z.enum(PHOTO_PLACES).meta({
  id: "PhotoPlace",
  description:
    "child, classSet (a class's Class photo set), leftovers, card (a card photo, never shown to parents), blankCard (waiting for the studio to name a blank card's child).",
});
export const photoFlag = z.enum(PHOTO_FLAGS).meta({
  id: "PhotoFlag",
  description:
    "Why to check a photo: unreadableCard (looks like a card, couldn't be read, or a card photo mark undone), otherCard (another job's card), afterUnreadable or afterFailed (after one of those, or after a photo that couldn't be processed), afterPurge (near photos deleted from the bin, where what they did can't be placed for sure). Flagged photos are hidden from parents until confirmed.",
});

export const taggedPhoto = z
  .object({
    id: z.uuid(),
    status: z.enum(PHOTO_STATUSES),
    place: photoPlace,
    flag: photoFlag.nullable(),
    childId: z.uuid().nullable().meta({ description: "Where tagging (or a person) put it." }),
    groupId: z.uuid().nullable(),
    cardId: z.uuid().nullable(),
    manual: z
      .boolean()
      .meta({ description: "Moved or confirmed by a person: tagging never changes it." }),
    cardRead: z.boolean().meta({
      description: "Its QR card was read: a card photo, which can't be moved.",
    }),
    qrKind: z.enum(["none", "card", "unreadable", "otherCard", "removedCard"]).nullable().meta({
      description:
        "What the image worker read: none, card (one of the job's cards), unreadable (looks like a card), otherCard (another job's card), removedCard (one of the job's cards, since removed with its child); null: no result that reads cards.",
    }),
    actions: z
      .object({
        move: z.boolean(),
        confirm: z.boolean(),
        markCard: z.boolean(),
        undoCard: z.boolean(),
      })
      .meta({
        description:
          "What review allows (for people who fix tagging): move it; confirm it where it is (Looks right / It's a normal photo); mark it a card photo; undo a person's card photo mark (owners and admins only). A photo that may be a card is confirmed before it moves; another job's card can only be marked a card photo; a photo whose card was read stays a card photo.",
      }),
    thumbUrl: z.url().nullable().meta({
      description: "A 400 px preview (studio only), signed for up to an hour; null until ready.",
    }),
  })
  .meta({ id: "TaggedPhoto", description: "A photo on the review screen. Never its filename." });
export type TaggedPhoto = z.infer<typeof taggedPhoto>;

export const NOT_REVIEWABLE_REASONS = [
  "noPhotos",
  "pending",
  "leftovers",
  "flagged",
  "blankCards",
] as const;

export const taggingAlbum = z
  .object({
    groupId: z.uuid().nullable().meta({ description: "Null for children without a class." }),
    name: z.string().nullable(),
    children: z.number().int(),
    childrenWithPhotos: z.number().int(),
    photos: z.number().int().meta({ description: "Photos tagged to its children." }),
    classPhotos: z.number().int().meta({ description: "Photos in its Class photo set." }),
  })
  .meta({ id: "TaggingAlbum", description: "A class (or No class) on the review screen." });
export type TaggingAlbum = z.infer<typeof taggingAlbum>;

export const blankCardGroup = z
  .object({
    cardId: z.uuid(),
    photos: z
      .number()
      .int()
      .meta({ description: "Photos waiting for this card's child to be named." }),
    cardPhotoId: z.uuid().nullable().meta({ description: "The photo of the card itself." }),
    cardPhotoUrl: z.url().nullable().meta({
      description: "Its 400 px preview (studio only), signed for up to an hour.",
    }),
  })
  .meta({ id: "BlankCardGroup" });
export type BlankCardGroup = z.infer<typeof blankCardGroup>;

export const taggingSummary = z
  .object({
    photos: z.number().int().meta({ description: "Uploaded, not in the bin." }),
    processing: z.number().int(),
    failed: z.number().int(),
    pending: z.boolean().meta({
      description: "Photos are still processing, or an upload hasn't been tagged since it changed.",
    }),
    leftovers: z.number().int(),
    flagged: z.number().int(),
    blankCards: z
      .number()
      .int()
      .meta({ description: "Blank cards whose child is still to be named." }),
    cardPhotos: z.number().int(),
    unlinkedCardPhotos: z.number().int().meta({
      description:
        "Card photos linked to none of the job's cards (such as photos marked card photos in Leftovers), listed on their own.",
    }),
    noPhotos: z.number().int().meta({
      description:
        "Children with no photos yet (not counting Do not photograph). Doesn't block selling.",
    }),
    reviewedAt: z.iso.datetime({ offset: true }).nullable(),
    canMarkReviewed: z.boolean(),
    notReviewable: z.enum(NOT_REVIEWABLE_REASONS).nullable().meta({
      description: "Why Mark reviewed is disabled, first reason first.",
    }),
    done: z.boolean().meta({ description: "The checklist's Review tagging task is done." }),
    albums: z.array(taggingAlbum).meta({ description: "Each class, then No class." }),
    blankCardGroups: z.array(blankCardGroup),
  })
  .meta({
    id: "TaggingSummary",
    description: "The review screen's header, albums and blank cards.",
  });
export type TaggingSummary = z.infer<typeof taggingSummary>;
export const taggingSummaryResponse = z.object({ tagging: taggingSummary });
export type TaggingSummaryResponse = z.infer<typeof taggingSummaryResponse>;

export const taggedPhotosResponse = z.object({
  photos: z.array(taggedPhoto).meta({ description: "In tagging order." }),
  nextCursor: z
    .uuid()
    .nullable()
    .meta({ description: "Pass as ?cursor= for the next page; null on the last page." }),
});
export type TaggedPhotosResponse = z.infer<typeof taggedPhotosResponse>;

export const taggingChild = z
  .object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    groupId: z.uuid().nullable(),
    doNotPhotograph: z.boolean(),
    photos: z
      .number()
      .int()
      .meta({ description: "Photos tagged to the child (card photos not counted)." }),
    strip: z
      .array(taggedPhoto)
      .meta({ description: "The first 12, card photos included, in tagging order." }),
  })
  .meta({ id: "TaggingChild", description: "A child in an album on the review screen." });
export type TaggingChild = z.infer<typeof taggingChild>;
export const taggingChildrenResponse = z.object({
  children: z.array(taggingChild),
  nextCursor: z.uuid().nullable(),
});
export type TaggingChildrenResponse = z.infer<typeof taggingChildrenResponse>;

export const noPhotosChild = z
  .object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    group: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  })
  .meta({ id: "NoPhotosChild" });
export const noPhotosResponse = z.object({ children: z.array(noPhotosChild) });
export type NoPhotosResponse = z.infer<typeof noPhotosResponse>;

export const photosConfirmedResponse = z.object({
  confirmed: z.number().int().meta({ description: "Photos that changed." }),
});
export type PhotosConfirmedResponse = z.infer<typeof photosConfirmedResponse>;
export const cardPhotosUndoneResponse = z.object({
  undone: z.number().int().meta({ description: "Photos sent back to Flagged." }),
});
export type CardPhotosUndoneResponse = z.infer<typeof cardPhotosUndoneResponse>;
export const taggingReviewedResponse = z.object({ reviewedAt: z.iso.datetime({ offset: true }) });
export type TaggingReviewedResponse = z.infer<typeof taggingReviewedResponse>;

/** Why a tagging request was refused with 409, in the error's `fields.form`. */
export const TAGGING_CONFLICTS = {
  cardPhoto: "tagging.cardPhoto",
  photoNotReady: "tagging.photoNotReady",
  cardClaimed: "tagging.cardClaimed",
  notReady: "tagging.notReady",
  /** A photo that may be a card is confirmed (either way) before it can be moved. */
  confirmFirst: "tagging.confirmFirst",
  /** A photo of another job's card can only be marked a card photo. */
  otherCard: "tagging.otherCard",
  /** Only photos a person marked as card photos can be unmarked. */
  notMarkedCard: "tagging.notMarkedCard",
} as const;
export type TaggingConflict = (typeof TAGGING_CONFLICTS)[keyof typeof TAGGING_CONFLICTS];

/**
 * Why a photo request was refused with 409, in the error's `fields.form` (stable keys; screens show their own words).
 */
export const PHOTO_CONFLICTS = {
  jobClosed: "photos.jobClosed",
  photoLimit: "photos.photoLimit",
  batchFinished: "photos.batchFinished",
  notUploading: "photos.notUploading",
  incomplete: "photos.incomplete",
  photoSold: "photos.photoSold",
  photoPurging: "photos.photoPurging",
  notRetryable: "photos.notRetryable",
} as const;
export type PhotoConflict = (typeof PHOTO_CONFLICTS)[keyof typeof PHOTO_CONFLICTS];

// ── Studio checklist: onboarding and Up next (Phase 1 step 2d, D143, ADR 0017) ──────────────────────────────────────
export const onboardingTask = z
  .object({
    key: z.enum(ONBOARDING_TASKS),
    done: z.boolean(),
  })
  .meta({ id: "OnboardingTask", description: "A built studio setup task, in order." });

export const upNextReason = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("photosOverdue"),
      days: z.number().int().meta({ description: "Days since picture day." }),
    }),
    z.object({
      kind: z.literal("dateClose"),
      days: z.number().int().meta({ description: "Days until picture day (0 = today)." }),
    }),
    z.object({
      kind: z.literal("brokenPhotos"),
      count: z.number().int().meta({ description: "Failed photos, not in the bin." }),
    }),
    z.object({
      kind: z.literal("taggingProblems"),
      leftovers: z.number().int().meta({ description: "Photos in Leftovers." }),
      flagged: z.number().int().meta({ description: "Photos flagged for checking." }),
    }),
    z.object({ kind: z.literal("nextStep") }),
  ])
  .meta({
    id: "UpNextReason",
    description:
      "Why the task was picked: a date is close (a past picture day without photos first), something is broken (failed photos, Leftovers or flagged photos), the next step.",
  });
export type UpNextReason = z.infer<typeof upNextReason>;

export const upNextItem = z
  .object({
    jobId: z.uuid(),
    jobName: z.string(),
    task: z.union([taskKey, z.literal("reviewFailedPhotos")]),
    reason: upNextReason,
  })
  .meta({ id: "UpNextItem", description: "One task, at most one per job." });
export type UpNextItem = z.infer<typeof upNextItem>;

export const studioChecklistResponse = z
  .object({
    onboarding: z
      .object({ tasks: z.array(onboardingTask) })
      .nullable()
      .meta({
        description:
          "The studio setup checklist (account, payouts where offered, price list, first job), for owners and admins until it is first complete; then null for good.",
      }),
    upNext: z
      .object({
        items: z
          .array(upNextItem)
          .meta({ description: `The ${UP_NEXT_SHOWN} most urgent, most urgent first.` }),
        total: z.number().int().meta({ description: "Jobs with something to do." }),
      })
      .nullable()
      .meta({ description: "Null while onboarding is shown." }),
  })
  .meta({ id: "StudioChecklist" });
export type StudioChecklistResponse = z.infer<typeof studioChecklistResponse>;

// ── Products and price lists (Phase 1 step 6, ADR 0019) ───────────────────────────────────────────────────────────
export const money = z
  .object({
    cents: z.number().int().meta({ description: "Whole cents; never a fraction (D96)." }),
    currency: z
      .enum(CURRENCIES)
      .meta({ description: "USD for US studios, CAD for Canadian ones." }),
  })
  .meta({ id: "Money", description: "An amount in whole cents with its currency, before tax." });
export type MoneyAmount = z.infer<typeof money>;

export const packageLine = z
  .object({
    kind: z.enum(["print", "digital"]),
    printSize: z.enum(PRINT_SIZES).nullable().meta({ description: "Prints only." }),
    quantity: z
      .number()
      .int()
      .meta({ description: "Prints of that size; a digital line is always 1." }),
  })
  .meta({
    id: "PackageLine",
    description:
      "What a package holds. The digital line is the download of the one pose the parent picks.",
  });
export type PackageLineOut = z.infer<typeof packageLine>;

export const priceListItem = z
  .object({
    id: z.uuid(),
    priceListId: z.uuid(),
    kind: z.enum(PRICE_ITEM_KINDS).meta({
      description:
        "package (prints and at most one digital, one pose), print (one size), digital_single (one photo, full resolution, no watermark) or digital_all (every pose of the child in the job).",
    }),
    name: z.string(),
    description: z.string().nullable(),
    printSize: z.enum(PRINT_SIZES).nullable().meta({ description: "Prints only." }),
    price: money,
    contents: z.array(packageLine).meta({ description: "Packages only; empty otherwise." }),
    position: z.number().int(),
  })
  .meta({ id: "PriceListItem" });
export type PriceListItem = z.infer<typeof priceListItem>;

const priceListUsage = {
  isDefault: z.boolean().meta({ description: "New jobs get the studio's default list." }),
  jobs: z.number().int().meta({ description: "Jobs using the list." }),
  sellingJobs: z.number().int().meta({
    description: "Of those, how many are selling: changes apply to their new orders only.",
  }),
};

export const priceListSummary = z
  .object({
    id: z.uuid(),
    name: z.string(),
    currency: z.enum(CURRENCIES),
    ...priceListUsage,
    counts: z.object({
      packages: z.number().int(),
      prints: z.number().int(),
      digitals: z.number().int(),
    }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "PriceListSummary", description: "A price list in the studio's list of them." });
export type PriceListSummary = z.infer<typeof priceListSummary>;

export const priceList = z
  .object({
    id: z.uuid(),
    name: z.string(),
    currency: z.enum(CURRENCIES),
    homeShipping: money.meta({
      description: "The flat home shipping fee. Delivery to school is free.",
    }),
    ...priceListUsage,
    items: z.array(priceListItem).meta({ description: "Every item, in position order." }),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({
    id: "PriceList",
    description: "Packages, prints and digital downloads with their prices, before tax (D36).",
  });
export type PriceList = z.infer<typeof priceList>;

export const priceListsResponse = z.object({
  priceLists: z.array(priceListSummary).meta({ description: "The default first, then by name." }),
});
export type PriceListsResponse = z.infer<typeof priceListsResponse>;
export const priceListResponse = z.object({ priceList });
export type PriceListResponse = z.infer<typeof priceListResponse>;
export const priceListItemResponse = z.object({ item: priceListItem });
export type PriceListItemResponse = z.infer<typeof priceListItemResponse>;

/** Why a price list request was refused with 409, in the error's `fields.form`. */
export const PRICE_LIST_CONFLICTS = {
  /** The studio's default list can't be deleted; make another the default first. */
  isDefault: "priceLists.isDefault",
  /** A list some job uses can't be deleted. */
  inUse: "priceLists.inUse",
  /** At most 50 lists per studio. */
  limit: "priceLists.limit",
  /** At most 100 items per list. */
  itemLimit: "priceLists.itemLimit",
  /** A list has one single digital and one "all digitals" at most. */
  digitalTaken: "priceLists.digitalTaken",
  /** A closed job's price list and delivery don't change. */
  jobClosed: "priceLists.jobClosed",
} as const;
export type PriceListConflict = (typeof PRICE_LIST_CONFLICTS)[keyof typeof PRICE_LIST_CONFLICTS];

// ── Payouts with Stripe Connect (Phase 1 step 7, ADR 0020) ─────────────────────────────────────────────────────────
export const payoutSchedule = z
  .object({
    interval: z.enum(PAYOUT_INTERVALS).meta({
      description:
        "As Stripe has it. Studios choose weekly (the default), daily or monthly; manual means payouts are made only when requested, not on a schedule.",
    }),
    weeklyAnchor: z
      .enum(PAYOUT_WEEKDAYS)
      .nullable()
      .meta({ description: "The weekday of weekly payouts; null otherwise." }),
    monthlyAnchor: z.number().int().nullable().meta({
      description:
        "The day of the month (1-31) of monthly payouts; 29-31 fall on the last day of shorter months. Null otherwise.",
    }),
  })
  .meta({ id: "PayoutSchedule" });
export type PayoutScheduleResponse = z.infer<typeof payoutSchedule>;

export const payoutAccount = z
  .object({
    status: z.enum(PAYOUT_ACCOUNT_STATUSES).meta({
      description:
        'needs_info (Stripe needs details), pending_verification (Stripe is checking them), active (card payments and payouts on, nothing due) or restricted. No account at all is "not started".',
    }),
    chargesEnabled: z.boolean(),
    payoutsEnabled: z.boolean(),
    detailsSubmitted: z.boolean(),
    currentlyDue: z
      .number()
      .int()
      .meta({ description: "How many things Stripe needs now (a count only)." }),
    pastDue: z.number().int().meta({ description: "How many of them are past their deadline." }),
    deadline: z.iso
      .datetime({ offset: true })
      .nullable()
      .meta({ description: "When what is due must be in by." }),
    disabledReason: z
      .string()
      .nullable()
      .meta({ description: "Stripe's reason code, if Stripe turned something off." }),
    schedule: payoutSchedule,
  })
  .meta({
    id: "PayoutAccount",
    description:
      "The studio's Stripe account as Silverback last saw it: no bank details, names or addresses.",
  });
export type PayoutAccount = z.infer<typeof payoutAccount>;

export const payout = z
  .object({
    id: z.uuid(),
    amount: money,
    status: z.enum(PAYOUT_STATUSES),
    method: z.enum(PAYOUT_METHODS).meta({ description: "standard, or instant (not offered yet)." }),
    automatic: z.boolean().meta({ description: "Made by the schedule rather than by hand." }),
    arrivalDate: z.iso.date().meta({ description: "When the bank should have it." }),
    failureCode: z.string().nullable().meta({ description: "Stripe's code when a payout failed." }),
  })
  .meta({ id: "Payout", description: "A payout from the studio's Stripe balance to its bank." });
export type Payout = z.infer<typeof payout>;

const percentPlusFixed = z.object({
  basisPoints: z.number().int().meta({ description: "Hundredths of a percent: 290 is 2.9%." }),
  fixed: money,
});

export const payoutFees = z
  .object({
    daybellBasisPoints: z.number().int().meta({
      description: "Silverback's fee on product sales only, nothing if nothing sells (300 = 3%).",
    }),
    card: percentPlusFixed.meta({ description: "Stripe's fee on each card payment, passed on." }),
    payout: percentPlusFixed.meta({
      description: "Stripe Connect's fee on each payout, passed on (D98).",
    }),
    activeAccount: money.meta({
      description:
        "Stripe Connect's fee for each month the studio receives a payout, passed on (D98).",
    }),
    instantBasisPoints: z
      .number()
      .int()
      .meta({ description: "Stripe's instant payout fee (not offered yet)." }),
  })
  .meta({ id: "PayoutFees", description: "What selling costs, in the studio's currency." });
export type PayoutFees = z.infer<typeof payoutFees>;

export const studioPayoutsResponse = z
  .object({
    account: payoutAccount
      .nullable()
      .meta({ description: "Null until the owner starts setting up payouts." }),
    nextPayoutDate: z.iso.date().nullable().meta({
      description:
        "The schedule's next payout day (UTC), weekly and monthly only; Stripe pays out only when there is money to pay.",
    }),
    payouts: z.array(payout).meta({ description: "The 10 latest, by arrival date, newest first." }),
    fees: payoutFees,
    canManage: z
      .boolean()
      .meta({ description: "Only the owner sets up payouts and changes the schedule." }),
  })
  .meta({ id: "StudioPayouts" });
export type StudioPayoutsResponse = z.infer<typeof studioPayoutsResponse>;

export const payoutLinkResponse = z
  .object({
    url: z
      .url()
      .meta({ description: "A single-use Stripe address. Open it straight away; never store it." }),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: "PayoutLink" });
export type PayoutLinkResponse = z.infer<typeof payoutLinkResponse>;

export const stripeWebhookResponse = z.object({ received: z.literal(true) });

/** Why a payouts request was refused with 409, in the error's `fields.form`. */
export const PAYOUT_CONFLICTS = {
  /** The studio has no payout account yet. */
  notConnected: "payouts.notConnected",
  /** The studio already has another Stripe account (no replacing in Phase 1). */
  alreadyConnected: "payouts.alreadyConnected",
} as const;
export type PayoutConflict = (typeof PAYOUT_CONFLICTS)[keyof typeof PAYOUT_CONFLICTS];

/**
 * In the error's `fields.form` when payouts are refused with region_unavailable because Stripe isn't set up in this
 * deployment at all (e.g. PR previews), as opposed to the studio's region not having payouts yet.
 */
export const PAYOUT_NOT_CONFIGURED = "payouts.notConfigured";

/**
 * In the error's `fields.form` when Stripe refuses to create a studio's account because Daybell's own Stripe platform
 * setup isn't finished (e.g. the platform hasn't acknowledged loss liability; ADR 0020 amendment). Nothing the studio
 * can fix: Daybell finishes the setup in the Stripe Dashboard.
 */
export const PAYOUT_PLATFORM_SETUP = "payouts.platformSetup";

/**
 * In the error's `fields.form` (409 conflict) when the owner's sign-in account has no email: Stripe needs one as the new
 * account's contact email (ADR 0020 section 16, step 7c), so nothing is sent to Stripe.
 */
export const PAYOUT_NO_CONTACT_EMAIL = "payouts.noContactEmail";

/**
 * In the error's `fields.form` when Stripe refuses the account create as an idempotency conflict: the studio's key was
 * used before with other parameters (e.g. a different contact email). Retrying won't help; Daybell support finishes the
 * setup (ADR 0020 section 16; security review N1).
 */
export const PAYOUT_CREATE_CONFLICT = "payouts.createConflict";

// ── Going live and the bell (Phase 1 step 8, ADR 0021) ──────────────────────────────────────────────────────────────

/**
 * Why a Start selling, Close shop, Reopen shop or closing date request was refused with 409, in the error's
 * `fields.form`. A notReady refusal also names each missing item as a field (roster, photos, tagging, priceList,
 * payouts), each with its own message key.
 */
export const JOB_CONFLICTS = {
  /** Something in "Before you can sell" is missing; the fields say what. */
  notReady: "jobs.notReady",
  alreadySelling: "jobs.alreadySelling",
  /** Only a selling shop can close. */
  notSelling: "jobs.notSelling",
  /** Only a closed shop can reopen. */
  notClosed: "jobs.notClosed",
  /** The shop is closed: reopen it first. */
  closed: "jobs.closed",
  /** The job's closing date has already passed: change or remove it before the shop opens. */
  closesAtPassed: "jobs.closesAtPassed",
  /** A job made before templates has no template rule to go back to (ADR 0029). */
  noTemplate: "jobs.noTemplate",
} as const;
export type JobConflict = (typeof JOB_CONFLICTS)[keyof typeof JOB_CONFLICTS];

/** The message key of each missing item in a notReady refusal's fields. */
export const SELL_BLOCKER_FIELDS = {
  roster: "jobs.sell.roster",
  photos: "jobs.sell.photos",
  tagging: "jobs.sell.tagging",
  priceList: "jobs.sell.priceList",
  payouts: "jobs.sell.payouts",
} as const;

export const notificationData = z
  .object({
    scheduled: z
      .boolean()
      .optional()
      .meta({ description: "job_closed: closed by its closing date." }),
    from: z
      .enum(["draft", "closed"])
      .optional()
      .meta({ description: "job_selling: opened from a draft, or reopened." }),
    failed: z.number().int().optional().meta({ description: "photos_failed: photos that failed." }),
    leftovers: z
      .number()
      .int()
      .optional()
      .meta({ description: "tagging_ready: photos in Leftovers." }),
    flagged: z.number().int().optional().meta({ description: "tagging_ready: photos to check." }),
  })
  .meta({ id: "NotificationData", description: "Counts and flags only; never names." });

export const notification = z
  .object({
    id: z.uuid(),
    kind: z.enum(NOTIFICATION_KINDS).meta({
      description:
        "job_selling, job_closed (everyone); payouts_active, payouts_restricted (owners and admins); photos_failed, tagging_ready (owners, admins and photographers); order_paid (owners, admins and staff); refund_failed, dispute_opened, refund_external (owners and admins).",
    }),
    createdAt: z.iso.datetime({ offset: true }),
    readAt: z.iso.datetime({ offset: true }).nullable(),
    job: z
      .object({ id: z.uuid(), name: z.string() })
      .nullable()
      .meta({ description: "The job it is about, with its current name; null for payouts." }),
    order: z.object({ id: z.uuid(), reference: z.string() }).nullable().meta({
      description:
        "The order it is about (order_paid, refund_failed, dispute_opened, refund_external).",
    }),
    data: notificationData,
  })
  .meta({
    id: "Notification",
    description:
      "One line of the signed-in person's bell (information only, D143). The screens write the words; the database keeps ids and counts.",
  });
export type Notification = z.infer<typeof notification>;

export const notificationsResponse = z.object({
  notifications: z
    .array(notification)
    .meta({ description: `The ${NOTIFICATIONS_SHOWN} latest, newest first.` }),
  unread: z.number().int().meta({ description: "How many of all of them are unread." }),
});
export type NotificationsResponse = z.infer<typeof notificationsResponse>;

export const unreadCountResponse = z.object({
  unread: z
    .number()
    .int()
    .meta({ description: "The signed-in person's unread notifications here." }),
});
export type UnreadCountResponse = z.infer<typeof unreadCountResponse>;

export const cronJobsResponse = z.object({
  closedJobs: z.number().int().meta({ description: "Shops closed by their closing date." }),
  prunedNotifications: z.number().int().meta({ description: "Old notifications removed." }),
  prunedShop: z.number().int().meta({
    description: "Expired shop sessions and day-old wrong-code and request counts removed.",
  }),
  settledOrders: z.number().int().meta({
    description:
      "Paid orders whose Stripe fee was settled late (ADR 0023): the webhook's backstop.",
  }),
  expiredOrders: z.number().int().meta({
    description: "Checkouts that ran out two hours ago, checked with Stripe and expired (or paid).",
  }),
  retriedRefunds: z.number().int().meta({
    description:
      "Refunds Stripe hadn't accepted, whose reversal wasn't done or whose status was still pending, tried again (ADR 0024).",
  }),
  purgedAddresses: z.number().int().meta({
    description:
      "Home delivery addresses (and tracking numbers) removed: 90 days after shipping, or after payment once cancelled or refunded; 365 days after payment at most.",
  }),
  absorbedShortfalls: z.number().int().meta({
    description:
      "Refund shortfalls still owed after 180 days without a settled sale to recover them from, absorbed by Silverback (Q2).",
  }),
});
export type CronJobsResponse = z.infer<typeof cronJobsResponse>;

// ── The parent shop (Phase 1 step 9, ADR 0022) ─────────────────────────────────────────────────────────────────────

export const SHOP_CHILD_STATES = ["open", "closed", "unavailable"] as const;
export type ShopChildState = (typeof SHOP_CHILD_STATES)[number];

const shopChildState = z.enum(SHOP_CHILD_STATES).meta({
  description:
    "open: the gallery. closed: the job isn't selling (drafts too) or its closing date has passed. unavailable: no photos to show yet (or never, for a child marked Do not publish). Closed and unavailable show no photos.",
});

const shopOpenChild = z.object({
  id: z.uuid(),
  state: z.literal("open"),
  displayName: z.string().meta({ description: 'First name and last initial only, e.g. "Ava P."' }),
  firstName: z.string().meta({ description: "For the photos' descriptions." }),
  jobId: z.uuid(),
  school: z.string().meta({ description: "The job's client (the school), else the job's name." }),
  pictureDay: z.iso.date(),
  closesAt: z.iso
    .datetime({ offset: true })
    .nullable()
    .meta({ description: "Order by this moment; null when the shop has no closing date." }),
  deliverToSchool: z.boolean().meta({ description: "The job offers free delivery to school." }),
});
const shopHiddenChild = z.object({
  id: z.uuid(),
  state: z.enum(["closed", "unavailable"]),
});

export const shopChild = z.discriminatedUnion("state", [shopOpenChild, shopHiddenChild]).meta({
  id: "ShopChild",
  description:
    "A child in the parent's shop session. Never a full name. A closed, draft or unavailable child is only an id and a state: no name, school or date (a stale card reveals nothing).",
});
export type ShopChild = z.infer<typeof shopChild>;
export type ShopOpenChild = z.infer<typeof shopOpenChild>;

export const shopGallerySession = z
  .object({
    id: z.string().meta({
      description:
        "The gallery's id on this device (not a credential): name it in ?gallery= on the other shop calls.",
    }),
    studio: z.object({ name: z.string() }),
    expiresAt: z.iso
      .datetime({ offset: true })
      .meta({ description: "30 days after the first code; adding a sibling doesn't extend it." }),
    children: z
      .array(shopChild)
      .meta({ description: "In the order their codes were entered; at most 5." }),
    bagCount: z.number().int().meta({ description: "Things in the bag (quantities added)." }),
  })
  .meta({ id: "ShopGallerySession", description: "One studio's gallery and bag on this device." });
export type ShopGallerySession = z.infer<typeof shopGallerySession>;

export const shopSessionResponse = z
  .object({
    galleries: z.array(shopGallerySession).meta({
      description: "One per studio, at most 3, in the order they were opened on this device.",
    }),
  })
  .meta({ id: "ShopSession" });
export type ShopSessionResponse = z.infer<typeof shopSessionResponse>;

export const shopOpenedResponse = z
  .object({
    childId: z.uuid().meta({ description: "The child the code belongs to." }),
    galleryId: z.string().meta({ description: "The gallery (the studio's) the child is in." }),
  })
  .meta({ id: "ShopOpened" });
export type ShopOpenedResponse = z.infer<typeof shopOpenedResponse>;

export const shopPhoto = z
  .object({
    id: z.uuid(),
    thumbUrl: z.url().meta({
      description:
        "A 400 px watermarked preview (WebP), signed for 10 minutes. Never the original, never an unwatermarked preview.",
    }),
    viewUrl: z
      .url()
      .meta({ description: "A 1600 px watermarked preview (WebP), signed for 10 minutes." }),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
  })
  .meta({
    id: "ShopPhoto",
    description: "A photo a parent may see: low resolution, watermarked (D60).",
  });
export type ShopPhoto = z.infer<typeof shopPhoto>;

export const shopGalleryResponse = z
  .object({
    state: shopChildState,
    cover: shopPhoto.nullable().meta({
      description:
        "The child's first portrait in tagging order (the cover, D119); null unless open.",
    }),
    portraits: z
      .array(shopPhoto)
      .meta({ description: "The child's own photos, in tagging order." }),
    classPhotos: z.array(shopPhoto).meta({
      description: "The child's class photo set, to view only in Phase 1; empty without a class.",
    }),
  })
  .meta({ id: "ShopGallery" });
export type ShopGalleryResponse = z.infer<typeof shopGalleryResponse>;

export const shopItem = z
  .object({
    id: z.uuid(),
    kind: z.enum(PRICE_ITEM_KINDS),
    name: z.string(),
    description: z.string().nullable(),
    printSize: z.enum(PRINT_SIZES).nullable(),
    price: money,
    contents: z.array(packageLine).meta({ description: "Packages only." }),
  })
  .meta({
    id: "ShopItem",
    description: "Something the child's job sells, priced now, before tax.",
  });
export type ShopItem = z.infer<typeof shopItem>;

export const shopPriceListResponse = z
  .object({
    state: shopChildState,
    priceList: z
      .object({
        currency: z.enum(CURRENCIES),
        homeShipping: money,
        deliverToSchool: z.boolean(),
        items: z.array(shopItem).meta({ description: "In the studio's order." }),
      })
      .nullable()
      .meta({ description: "The job's current list; null unless open." }),
  })
  .meta({ id: "ShopPriceList" });
export type ShopPriceListResponse = z.infer<typeof shopPriceListResponse>;

export const shopCartLine = z
  .object({
    id: z.uuid(),
    childId: z.uuid(),
    itemId: z.uuid(),
    kind: z.enum(PRICE_ITEM_KINDS),
    name: z.string(),
    printSize: z.enum(PRINT_SIZES).nullable(),
    unitPrice: money,
    quantity: z.number().int(),
    lineTotal: money,
    available: z.boolean().meta({
      description:
        "Can still be bought: the item is on the job's current list, the shop is open and the pose can still be shown. Unavailable lines don't count in the totals.",
    }),
    physical: z.boolean().meta({ description: "Needs delivery (prints)." }),
    photo: z
      .object({ id: z.uuid(), thumbUrl: z.url().nullable() })
      .nullable()
      .meta({ description: "The pose; null for all digitals. No preview for unavailable lines." }),
  })
  .meta({ id: "ShopCartLine" });
export type ShopCartLine = z.infer<typeof shopCartLine>;

export const shopCartResponse = z
  .object({
    lines: z.array(shopCartLine).meta({ description: "By child (as added), then as added." }),
    count: z.number().int().meta({ description: "Things that can be bought (quantities added)." }),
    subtotal: money,
    shipping: z.object({
      needed: z.boolean().meta({ description: "Something in the bag needs delivery." }),
      home: money.meta({
        description: "One home fee per bag: the highest of its jobs' (with something to deliver).",
      }),
      school: z
        .boolean()
        .meta({ description: "Free delivery to school is offered: every such job allows it." }),
      method: z.enum(SHOP_SHIPPING_METHODS).nullable().meta({
        description:
          "The delivery that applies; null when nothing needs delivery or still to choose.",
      }),
      cost: money.nullable().meta({ description: "Null until delivery is chosen." }),
    }),
    total: money
      .nullable()
      .meta({ description: "Subtotal plus delivery, before tax; null until delivery is chosen." }),
  })
  .meta({
    id: "ShopCart",
    description:
      "The bag, priced from each job's current list on every read (nothing is stored but ids and quantities).",
  });
export type ShopCartResponse = z.infer<typeof shopCartResponse>;

/** Why a shop request was refused with 409, in the error's `fields.form`. */
export const SHOP_CONFLICTS = {
  /** The child's shop is closed (or a draft): nothing can be bought. */
  closed: "shop.closed",
  /** A session holds at most 5 children. */
  siblingLimit: "shop.siblingLimit",
  /** The device already holds galleries of 3 other studios: forget one first (S6). */
  galleryLimit: "shop.galleryLimit",
  /** The item isn't on the job's current price list. */
  itemUnavailable: "shop.itemUnavailable",
  /** The pose isn't one of the child's photos that can be shown. */
  photoUnavailable: "shop.photoUnavailable",
  /** Delivery to school isn't offered for everything in the bag. */
  schoolDeliveryOff: "shop.schoolDeliveryOff",
  /** At most 100 lines in a bag. */
  bagFull: "shop.bagFull",
  // Checkout (Phase 1 step 10, ADR 0023).
  /** Nothing in the bag to pay for. */
  bagEmpty: "shop.bagEmpty",
  /** Something in the bag can't be bought any more: remove it first. */
  lineUnavailable: "shop.lineUnavailable",
  /** Choose home or school delivery first. */
  chooseDelivery: "shop.chooseDelivery",
  /** The studio can't take payments right now (its payouts aren't Active). */
  notAccepting: "shop.notAccepting",
  /** The bag is below Stripe's minimum charge (call 13). */
  belowMinimum: "shop.belowMinimum",
  /** The bag's earlier checkout was paid meanwhile: see the order (`fields.orderId`). */
  alreadyPaid: "shop.alreadyPaid",
  /** The paid download is being prepared (made lazily once sold): try again shortly (Retry-After). */
  downloadPreparing: "shop.downloadPreparing",
  /** The paid download couldn't be made after several tries: support has been alerted. */
  downloadUnavailable: "shop.downloadUnavailable",
  // Orders (Phase 1 step 11, ADR 0024).
  /** The order can't be cancelled here: printed already, downloads only, or not this device's purchase. */
  cannotCancel: "shop.cannotCancel",
  /** Too many cancels from this gallery in an hour (429, Retry-After). */
  cancelLimit: "shop.cancelLimit",
  /** More files than one zip holds: download them one at a time. */
  zipTooBig: "shop.zipTooBig",
} as const;
export type ShopConflict = (typeof SHOP_CONFLICTS)[keyof typeof SHOP_CONFLICTS];

/** In `fields.form` of the 404 for a code that opens nothing: wrong, unknown or not a code, all alike. */
export const SHOP_CODE_NOT_FOUND = "shop.codeNotFound";
/** In `fields.form` of the 429 after too many wrong codes; Retry-After gives the seconds. */
export const SHOP_LOCKED = "shop.locked";

/**
 * In `fields.form` of the 422 region_unavailable when checkout isn't set up in this deployment at all (no Stripe, e.g.
 * PR previews), as opposed to the studio's region not taking payments yet.
 */
export const SHOP_CHECKOUT_NOT_CONFIGURED = "shop.checkoutNotConfigured";

// ── Checkout and orders (Phase 1 step 10, ADR 0023) ─────────────────────────────────────────────────────────────

export const checkoutStartResponse = z
  .object({
    orderId: z.uuid(),
    url: z.url().meta({
      description:
        "Stripe's hosted checkout (in development and tests, this deployment's fake one). Go there straight away; it lasts 30 minutes.",
    }),
  })
  .meta({ id: "CheckoutStart" });
export type CheckoutStartResponse = z.infer<typeof checkoutStartResponse>;

const orderStatus = z.enum(ORDER_STATUSES).meta({
  description:
    "pending: Stripe's checkout is open; paid; expired: cancelled, replaced or run out; failed: not used yet.",
});

// Orders after payment (Phase 1 step 11, ADR 0024).
const fulfilment = z.enum(ORDER_FULFILMENTS).meta({
  description:
    "paid → printed → shipped (home, with tracking) or delivered (to school); complete: downloads only, nothing to deliver; canceled: the parent cancelled.",
});
const refundBadge = z.enum(["refunded", "partly_refunded"]).nullable().meta({
  description: "Apart from the status: all or some of it was refunded (Stripe accepted).",
});
const carrier = z.enum(CARRIERS);
const tracking = z
  .object({
    carrier,
    number: z.string(),
    url: z.string().nullable().meta({ description: "The studio's own link, for other carriers." }),
    link: z
      .string()
      .nullable()
      .meta({ description: "Where to follow it: the carrier's page, or the studio's link." }),
  })
  .meta({ id: "Tracking" });

const shopOrderChild = z
  .discriminatedUnion("state", [
    z.object({
      id: z.uuid(),
      state: z.literal("open"),
      displayName: z
        .string()
        .meta({ description: 'First name and last initial only, e.g. "Ava P."' }),
    }),
    z.object({ id: z.uuid(), state: z.enum(["closed", "unavailable"]) }),
  ])
  .meta({
    id: "ShopOrderChild",
    description:
      "A child on an order, named only while their shop is open (a stale card reveals nothing).",
  });
export type ShopOrderChild = z.infer<typeof shopOrderChild>;

const orderView = z.enum(["full", "child"]).meta({
  description:
    "full: the session that paid, or one holding every child on the order; child: only this session's children's lines, with no amounts (call 12).",
});

export const shopOrderLine = z
  .object({
    id: z.uuid(),
    childId: z.uuid().nullable(),
    kind: z.enum(PRICE_ITEM_KINDS),
    name: z.string(),
    printSize: z.enum(PRINT_SIZES).nullable(),
    quantity: z.number().int(),
    refundedQuantity: z.number().int().meta({ description: "How many were refunded." }),
    unitPrice: money.nullable().meta({ description: "Null in the child view." }),
    lineTotal: money.nullable().meta({ description: "Null in the child view." }),
    contents: z.array(packageLine).meta({ description: "A package's contents as sold." }),
    downloads: z
      .array(
        z.object({
          photoId: z.uuid(),
          n: z.number().int().meta({ description: "1, 2, 3… in the order." }),
        }),
      )
      .meta({ description: "The photos this line unlocked, once paid; empty for prints." }),
  })
  .meta({ id: "ShopOrderLine" });
export type ShopOrderLine = z.infer<typeof shopOrderLine>;

export const shopOrder = z
  .object({
    id: z.uuid(),
    reference: z.string().meta({ description: "8 characters, e.g. 7KQ2M9XA." }),
    status: orderStatus,
    fulfilment: fulfilment.nullable().meta({ description: "Once paid (ADR 0024)." }),
    refund: refundBadge,
    canCancel: z.boolean().meta({
      description:
        "This gallery paid and the order isn't printed yet: it may cancel for a full refund (answer 2).",
    }),
    tracking: tracking
      .nullable()
      .meta({ description: "Once shipped; full view only. Never in an email (none in Phase 1)." }),
    view: orderView,
    paidAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    studio: z.object({ name: z.string() }),
    shippingMethod: z.enum(SHOP_SHIPPING_METHODS).nullable(),
    totals: z
      .object({
        products: money,
        shipping: money,
        tax: money.nullable().meta({ description: "Null until paid." }),
        total: money.nullable().meta({ description: "Null until paid." }),
        refunded: money.meta({ description: "Refunded so far." }),
      })
      .nullable()
      .meta({ description: "Full view only." }),
    registrations: z
      .array(
        z.object({
          kind: z.enum(TAX_REGISTRATION_KINDS),
          province: z.enum(PST_PROVINCES).nullable(),
          number: z.string(),
        }),
      )
      .meta({ description: "The studio's tax numbers when it was paid (call 5); full view only." }),
    children: z.array(shopOrderChild),
    lines: z.array(shopOrderLine),
  })
  .meta({
    id: "ShopOrder",
    description:
      "An order as a parent sees it: never an email, an address or a last name; downloads once paid (ADR 0023).",
  });
export type ShopOrder = z.infer<typeof shopOrder>;
export const shopOrderResponse = z.object({ order: shopOrder });
export type ShopOrderResponse = z.infer<typeof shopOrderResponse>;

export const shopOrderSummary = z
  .object({
    id: z.uuid(),
    reference: z.string(),
    status: orderStatus,
    fulfilment: fulfilment.nullable(),
    refund: refundBadge,
    view: orderView,
    paidAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    children: z.array(shopOrderChild),
    downloads: z.number().int().meta({ description: "Photos to download from it." }),
  })
  .meta({ id: "ShopOrderSummary" });
export type ShopOrderSummary = z.infer<typeof shopOrderSummary>;
export const shopOrdersResponse = z
  .object({
    orders: z.array(shopOrderSummary).meta({
      description:
        "Paid orders this gallery may see, and its own checkouts of the last 2 hours; newest first, at most 50.",
    }),
  })
  .meta({ id: "ShopOrders" });
export type ShopOrdersResponse = z.infer<typeof shopOrdersResponse>;

export const downloadLinkResponse = z
  .object({
    url: z.url().meta({
      description:
        "The full-resolution JPEG, metadata stripped (never the original), saved as a file named by the order. Signed for 5 minutes: open it straight away.",
    }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "DownloadLink" });
export type DownloadLinkResponse = z.infer<typeof downloadLinkResponse>;

const personName = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

// ── Orders and refunds (Phase 1 step 11, ADR 0024) ──────────────────────────────────────────────────────────────

export const studioOrder = z
  .object({
    id: z.uuid(),
    reference: z.string(),
    paidAt: z.iso.datetime({ offset: true }),
    total: money,
    shippingMethod: z.enum(SHOP_SHIPPING_METHODS).nullable(),
    fulfilment,
    refund: refundBadge,
    disputed: z.boolean().meta({ description: "A dispute was opened on the payment." }),
    items: z.number().int(),
    children: z
      .array(z.object({ id: z.uuid(), displayName: z.string() }))
      .meta({ description: 'First name and last initial, e.g. "Ava P."' }),
  })
  .meta({
    id: "Order",
    description: "A paid order in the studio's list (owners, admins and staff; Q4).",
  });
export type StudioOrder = z.infer<typeof studioOrder>;
export const ordersResponse = z.object({
  orders: z.array(studioOrder).meta({ description: "Newest first." }),
  nextCursor: z.uuid().nullable(),
});
export type OrdersResponse = z.infer<typeof ordersResponse>;

export const refund = z
  .object({
    id: z.uuid(),
    kind: z.enum(REFUND_KINDS),
    reason: z.enum(REFUND_REASONS).nullable(),
    status: z.enum(REFUND_STATUSES).meta({
      description:
        "requested: not yet accepted by Stripe; pending, succeeded: Stripe's; failed; canceled: Stripe refused it, nothing happened.",
    }),
    products: money,
    shipping: money,
    tax: money,
    amount: money.meta({ description: "What the parent gets back." }),
    daybellFee: money.meta({
      description: "Silverback's fee given back to the studio (answer 1).",
    }),
    unrecovered: money.meta({
      description:
        "What the studio's transfer couldn't give back yet: taken from its next sale (Q2).",
    }),
    createdAt: z.iso.datetime({ offset: true }),
    lines: z.array(z.object({ lineId: z.uuid(), quantity: z.number().int() })),
  })
  .meta({ id: "Refund" });
export type Refund = z.infer<typeof refund>;
export const refundResponse = z.object({ refund });
export type RefundResponse = z.infer<typeof refundResponse>;

export const ledgerTransaction = z
  .object({
    id: z.uuid(),
    kind: z.enum(["order_paid", "order_refunded", "refund_failed", "refund_shortfall"]),
    createdAt: z.iso.datetime({ offset: true }),
    entries: z.array(
      z.object({
        id: z.number().int(),
        account: z.string(),
        amount: money.meta({
          description: "Positive is a debit (in hand or owed to Silverback), negative a credit.",
        }),
      }),
    ),
  })
  .meta({ id: "LedgerTransaction", description: "Balanced: its entries add up to zero." });
export type LedgerTransaction = z.infer<typeof ledgerTransaction>;

export const studioOrderDetail = z
  .object({
    id: z.uuid(),
    reference: z.string(),
    paidAt: z.iso.datetime({ offset: true }),
    products: money,
    shipping: money,
    tax: money,
    total: money,
    daybellFee: z
      .object({ basisPoints: z.number().int(), amount: money })
      .meta({ description: "Silverback's fee on products, at the rate this order used (D59)." }),
    cardFee: money
      .nullable()
      .meta({ description: "Stripe's fee for the payment (D98); null until Stripe says." }),
    paidToStudio: money.nullable().meta({
      description:
        "Total less Silverback's fee and the card fee (tax included: the studio remits it).",
    }),
    feesSettled: z
      .boolean()
      .meta({ description: "Stripe's fee is known: refunds can be made (before, 409)." }),
    shippingMethod: z.enum(SHOP_SHIPPING_METHODS).nullable(),
    fulfilment,
    printedAt: z.iso.datetime({ offset: true }).nullable(),
    shippedAt: z.iso.datetime({ offset: true }).nullable(),
    deliveredAt: z.iso.datetime({ offset: true }).nullable(),
    canceledAt: z.iso.datetime({ offset: true }).nullable(),
    disputedAt: z.iso.datetime({ offset: true }).nullable(),
    shipToPurgedAt: z.iso.datetime({ offset: true }).nullable().meta({
      description:
        "When the home delivery address and tracking number were removed (90 days after shipping; 365 days after payment at most).",
    }),
    externalRefund: z
      .object({
        at: z.iso.datetime({ offset: true }),
        checkedAt: z.iso.datetime({ offset: true }).nullable(),
      })
      .nullable()
      .meta({
        description:
          "A refund made outside Silverback (the Stripe Dashboard): fulfilment stops until an owner or admin marks it checked.",
      }),
    tracking: tracking.nullable(),
    refund: refundBadge,
    refundInFlight: z.boolean().meta({ description: "A refund Stripe hasn't accepted yet." }),
    lines: z.array(
      z.object({
        id: z.uuid(),
        kind: z.enum(PRICE_ITEM_KINDS),
        name: z.string(),
        printSize: z.enum(PRINT_SIZES).nullable(),
        quantity: z.number().int(),
        refundedQuantity: z.number().int().meta({ description: "How many were given back." }),
        unitPrice: money,
        lineTotal: money,
        physical: z
          .boolean()
          .meta({ description: "To be printed (a print, or a package with prints)." }),
        child: personName.nullable(),
        photoId: z.uuid().nullable().meta({ description: "The pose; null for all digitals." }),
        contents: z.array(packageLine),
      }),
    ),
    shipTo: z
      .object({
        name: z.string(),
        line1: z.string(),
        line2: z.string().nullable(),
        city: z.string(),
        province: z.string().nullable(),
        postalCode: z.string(),
        country: z.literal("CA"),
      })
      .nullable()
      .meta({ description: "Home delivery only (call 2); removed 90 days after shipping." }),
    refunds: z
      .array(refund)
      .nullable()
      .meta({ description: "Owners and admins only (Q4); null for staff." }),
    refundable: z
      .object({
        products: money,
        shipping: money,
        tax: money,
        daybellFee: money,
        refunded: money.meta({ description: "Refunded so far (accepted by Stripe)." }),
      })
      .nullable()
      .meta({ description: "What is left to refund. Owners and admins only." }),
    ledger: z
      .array(ledgerTransaction)
      .nullable()
      .meta({ description: "The order's ledger transactions. Owners and admins only." }),
  })
  .meta({ id: "OrderDetail" });
export type StudioOrderDetail = z.infer<typeof studioOrderDetail>;
export const orderResponse = z.object({ order: studioOrderDetail });
export type OrderResponse = z.infer<typeof orderResponse>;

/** Why an order request was refused with 409, in the error's `fields.form`. */
export const ORDER_CONFLICTS = {
  notPaid: "orders.notPaid",
  refunded: "orders.refunded",
  canceled: "orders.canceled",
  refundInFlight: "orders.refundInFlight",
  /** Stripe's fee isn't known yet; Retry-After says when to try again. */
  feesPending: "orders.feesPending",
  wrongDelivery: "orders.wrongDelivery",
  trackingRequired: "orders.trackingRequired",
  statusInvalid: "orders.statusInvalid",
  overRefund: "orders.overRefund",
  nothingToRefund: "orders.nothingToRefund",
  /** Stripe refused the refund outright: nothing happened. */
  refundRefused: "orders.refundRefused",
  /** A refund made outside Daybell must be checked by an owner or admin before fulfilment goes on. */
  externalRefund: "orders.externalRefund",
} as const;
export type OrderConflict = (typeof ORDER_CONFLICTS)[keyof typeof ORDER_CONFLICTS];

/** The database's refusal names (migration 20261013100100), as the API's conflicts. */
export const ORDER_DB_REFUSALS: Record<string, keyof typeof ORDER_CONFLICTS> = {
  order_not_paid: "notPaid",
  order_refunded: "refunded",
  order_canceled: "canceled",
  refund_in_flight: "refundInFlight",
  fees_pending: "feesPending",
  wrong_delivery: "wrongDelivery",
  tracking_required: "trackingRequired",
  status_invalid: "statusInvalid",
  over_refund: "overRefund",
  nothing_to_refund: "nothingToRefund",
  external_refund: "externalRefund",
};

export const bulkOrderStatusResponse = z
  .object({
    results: z.array(
      z.object({
        orderId: z.uuid(),
        outcome: z.string().meta({
          description: 'ok, or why that order was refused (an orders.* conflict, or "not_found").',
        }),
      }),
    ),
  })
  .meta({ id: "BulkOrderStatus", description: "One result per order, in the request's order." });
export type BulkOrderStatusResponse = z.infer<typeof bulkOrderStatusResponse>;

export const salesSummary = z
  .object({
    start: z.iso.datetime({ offset: true }).meta({ description: "Where the range begins." }),
    sales: money.meta({
      description: "What parents paid less what was refunded (from the ledger).",
    }),
    orders: z.number().int(),
    daybellFee: money.meta({ description: "Silverback's fee, net of refunds." }),
    averageOrder: money.nullable(),
  })
  .meta({ id: "SalesSummary" });
export type SalesSummary = z.infer<typeof salesSummary>;

export const salesResponse = z
  .object({
    sales: z
      .object({ today: salesSummary, week: salesSummary, season: salesSummary })
      .nullable()
      .meta({ description: "Owners and admins only (Q4); null for staff." }),
    todo: z.object({
      toPrint: z.number().int(),
      toShip: z.number().int(),
      toDeliver: z.number().int().meta({ description: "Printed, waiting to go to school." }),
    }),
  })
  .meta({
    id: "StudioSales",
    description:
      "Home's numbers (D127): today, this week (from Monday) and this season (from August 1), in the time zone asked.",
  });
export type SalesResponse = z.infer<typeof salesResponse>;

export const taxRegistration = z
  .object({
    id: z.uuid(),
    kind: z.enum(TAX_REGISTRATION_KINDS),
    province: z.enum(PST_PROVINCES).nullable(),
    number: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "TaxRegistration" });
export type TaxRegistration = z.infer<typeof taxRegistration>;

export const studioTaxesResponse = z
  .object({
    headOffice: z
      .object({ province: z.string(), setAt: z.iso.datetime({ offset: true }) })
      .nullable()
      .meta({
        description:
          "Whether the business address is at Stripe; Silverback keeps only its province.",
      }),
    registrations: z.array(taxRegistration).meta({ description: "Active registrations." }),
    collectsTax: z.boolean().meta({
      description:
        "A head office and a registration: checkout charges tax. Otherwise none (small supplier).",
    }),
    canManage: z.boolean().meta({ description: "Only the owner changes taxes (call 6)." }),
  })
  .meta({ id: "StudioTaxes" });
export type StudioTaxesResponse = z.infer<typeof studioTaxesResponse>;

/** Why a taxes request was refused with 409, in the error's `fields.form`. */
export const TAX_CONFLICTS = {
  /** Taxes need the studio's Stripe account first (Settings › Stripe). */
  notConnected: "taxes.notConnected",
  /** Registrations need the business address first. */
  headOfficeRequired: "taxes.headOfficeRequired",
  /** One active registration of each kind (and province). */
  alreadyRegistered: "taxes.alreadyRegistered",
} as const;
export type TaxConflict = (typeof TAX_CONFLICTS)[keyof typeof TAX_CONFLICTS];

// ── Saved filter chips (D147, ADR 0026) ───────────────────────────────────────────────────────────────────────────
export const listFilterChip = z
  .object({
    key: z
      .string()
      .meta({ description: "One of the list's chip keys, e.g. closingThisWeek or client." }),
    value: z.uuid().nullable().meta({
      description:
        "The record the chip names (a client, job or class), for the keys that take one.",
    }),
  })
  .meta({
    id: "ListFilterChip",
    description: "A chip a person added to a list. Ids only: its name is looked up when shown.",
  });
export type ListFilterChip = z.infer<typeof listFilterChip>;
export const listFiltersResponse = z.object({
  chips: z.array(listFilterChip).meta({ description: "In the order shown; at most 8." }),
});
export type ListFiltersResponse = z.infer<typeof listFiltersResponse>;

// ── DRM test page (spike; D158; ADR 0032) ────────────────────────────────────────────────────────────────────────────

export const drmTestTokenResponse = z
  .object({
    token: z.string().meta({
      description:
        "A signed Axinom license token (JWT). Send it as the X-AxDRM-Message header of one license request; never store or log it.",
    }),
    expiresAt: z.iso.datetime({ offset: true }).meta({ description: "At most 60 seconds away." }),
    licenseUrls: z.object({
      widevine: z.url(),
      playready: z.url(),
      fairplay: z.url().nullable().meta({ description: "Null until FairPlay is set up." }),
    }),
    fairplayCertificateUrl: z.url().nullable(),
  })
  .meta({ id: "DrmTestToken" });
export type DrmTestTokenResponse = z.infer<typeof drmTestTokenResponse>;
