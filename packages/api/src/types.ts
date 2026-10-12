import { DATA_REGIONS } from "@daybell/config";
import {
  JOB_STATUSES,
  JOB_TYPES,
  MILESTONES,
  ONBOARDING_TASKS,
  PHOTO_FLAGS,
  PHOTO_PLACES,
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
    "Why to check a photo: unreadableCard (looks like a card, couldn't be read), otherCard (another job's card), afterUnreadable or afterFailed (after one of those, or after a photo that couldn't be processed). Flagged photos are hidden from parents until confirmed.",
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
      })
      .meta({
        description:
          "What review allows (for people who fix tagging): move it; confirm it where it is (Looks right / It's a normal photo); mark it a card photo. A photo that may be a card is confirmed before it moves; another job's card can only be marked a card photo; card photos stay card photos.",
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
          "The studio setup checklist (account, first job), for owners and admins until it is first complete; then null for good.",
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
