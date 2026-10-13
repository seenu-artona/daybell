import { DATA_REGIONS } from "@daybell/config";
import {
  CURRENCIES,
  JOB_STATUSES,
  JOB_TYPES,
  MILESTONES,
  ONBOARDING_TASKS,
  PAYOUT_ACCOUNT_STATUSES,
  PAYOUT_INTERVALS,
  PAYOUT_METHODS,
  PAYOUT_STATUSES,
  PAYOUT_WEEKDAYS,
  PHOTO_FLAGS,
  PHOTO_PLACES,
  PRICE_ITEM_KINDS,
  PRINT_SIZES,
  TASK_KEYS,
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
  "roster.imported",
  "qr_cards.printed",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activityItem = z
  .object({
    id: z.number().int(),
    type: z.enum(ACTIVITY_TYPES),
    actorEmail: z.email().nullable().meta({ description: "Who did it, if still on the team." }),
    subjectEmail: z
      .email()
      .nullable()
      .meta({ description: "Who it was about, for member events." }),
    role: studioRole.nullable(),
    subjectName: z.string().nullable().meta({
      description:
        "The job's or client's current name, for job, client, roster and QR card events.",
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

export const job = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: z.enum(JOB_TYPES),
    status: z.enum(JOB_STATUSES).meta({ description: "New jobs are drafts." }),
    pictureDay: z.iso.date(),
    client: clientRef.nullable(),
    internalNumber: z.string().meta({ description: "Only the studio sees it." }),
    subjectsExpected: z.number().int().nullable(),
    priceListId: z.uuid().meta({ description: "The price list the job sells from (ADR 0019)." }),
    deliverToSchool: z.boolean().meta({
      description: "Parents may choose free delivery to the school as well as paid home shipping.",
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
export const nextJobNumberResponse = z.object({
  internalNumber: z.string().meta({ description: "The next free JOBnnnnn number." }),
});
export const clientsResponse = z.object({ clients: z.array(client), nextCursor });
export type ClientsResponse = z.infer<typeof clientsResponse>;
export const clientResponse = z.object({ client });

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

export const childrenResponse = z.object({
  children: z.array(child),
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
      "The studio's Stripe account as Daybell last saw it: no bank details, names or addresses.",
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
      description: "Daybell's fee on product sales only, nothing if nothing sells (300 = 3%).",
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
