import { z } from "zod";
import { API_ERROR_CODES, type ApiErrorCode, STATUS_FOR } from "./errors";
import {
  acceptInviteInput,
  activityQuery,
  childInput,
  childPatch,
  clientInput,
  clientListQuery,
  clientPatch,
  finishBatchInput,
  groupInput,
  groupPatch,
  inviteInput,
  jobInput,
  jobPatch,
  joinSignUpInput,
  listQuery,
  partUrlsInput,
  passwordResetRequestInput,
  passwordUpdateInput,
  photoIdsInput,
  photoListQuery,
  qrCardsInput,
  rosterImportInput,
  rosterQuery,
  searchInput,
  signInInput,
  signUpInput,
  uploadFilesInput,
  workerResultInput,
} from "./schemas";
import {
  activityResponse,
  checkEmailResponse,
  childResponse,
  childrenResponse,
  clientResponse,
  clientsResponse,
  cronPhotosResponse,
  groupResponse,
  groupsResponse,
  inviteCreatedResponse,
  invitesResponse,
  jobResponse,
  jobsResponse,
  meResponse,
  nextJobNumberResponse,
  partUrlsResponse,
  photoCountsResponse,
  photoDetailResponse,
  photosMovedResponse,
  photosResponse,
  QR_CARD_HEADERS,
  qrCardStatusResponse,
  registerFilesResponse,
  rosterImportResponse,
  searchResponse,
  teamResponse,
  uploadBatchResponse,
  uploadCompleteResponse,
  uploadPartsResponse,
  workerPhotoResponse,
  workerRecordedResponse,
} from "./types";

/**
 * Every /api/v1 endpoint, described once (D92). The docs page and openapi.json are generated from this list, and a test
 * fails if a route file exists that isn't listed here (or the other way round).
 */
export type Access =
  | "public"
  | "signed-in"
  | "owner-admin"
  | "owner"
  | "roster-editor"
  | "uploader"
  | "internal";

export const ROUTE_GROUPS = [
  "Account",
  "Team",
  "Studio",
  "Jobs",
  "Roster",
  "Photos",
  "Contacts",
  "Search",
  "Internal",
] as const;

export interface RouteSpec {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  group: (typeof ROUTE_GROUPS)[number];
  summary: string;
  description?: string;
  access: Access;
  /** Query string parameters, for lists. */
  query?: z.ZodObject;
  body?: z.ZodType;
  success: {
    status: 200 | 201 | 202 | 204;
    schema?: z.ZodType;
    description: string;
    /** A file instead of JSON (e.g. the QR card PDF). */
    contentType?: "application/pdf";
    /** Response headers worth knowing, by name. */
    headers?: Record<string, string>;
  };
  errors: ApiErrorCode[];
}

export const ROUTES: RouteSpec[] = [
  {
    method: "POST",
    path: "/auth/sign-up",
    group: "Account",
    summary: "Start a studio, or create an account to join one",
    description:
      "Passwordless: emails a link. After confirming, the person chooses a password. Answers the same whether or not the email already has an account.",
    access: "public",
    body: z.union([signUpInput, joinSignUpInput]),
    success: { status: 201, schema: checkEmailResponse, description: "Email sent." },
    errors: ["invalid_input", "conflict", "region_unavailable", "rate_limited", "internal"],
  },
  {
    method: "POST",
    path: "/auth/sign-in",
    group: "Account",
    summary: "Sign in with email and password",
    access: "public",
    body: signInInput,
    success: { status: 200, schema: meResponse, description: "Signed in; session cookie set." },
    errors: ["invalid_input", "invalid_credentials", "email_not_confirmed", "rate_limited"],
  },
  {
    method: "POST",
    path: "/auth/sign-out",
    group: "Account",
    summary: "Sign out",
    access: "signed-in",
    success: { status: 204, description: "Signed out." },
    errors: [],
  },
  {
    method: "POST",
    path: "/auth/password-reset",
    group: "Account",
    summary: "Email a link to choose a new password",
    description: "Always answers the same, so it never reveals who has an account.",
    access: "public",
    body: passwordResetRequestInput,
    success: {
      status: 202,
      schema: checkEmailResponse,
      description: "If the account exists, an email was sent.",
    },
    errors: ["invalid_input"],
  },
  {
    method: "PUT",
    path: "/auth/password",
    group: "Account",
    summary: "Set a new password",
    description: "Needs a recent sign-in or the session from an emailed link.",
    access: "signed-in",
    body: passwordUpdateInput,
    success: { status: 204, description: "Password saved." },
    errors: ["invalid_input", "not_signed_in", "internal"],
  },
  {
    method: "GET",
    path: "/me",
    group: "Account",
    summary: "The signed-in person and their studio",
    access: "signed-in",
    success: { status: 200, schema: meResponse, description: "Who is signed in." },
    errors: ["not_signed_in"],
  },
  {
    method: "GET",
    path: "/studio/team",
    group: "Team",
    summary: "Everyone on the studio's team",
    access: "signed-in",
    success: { status: 200, schema: teamResponse, description: "Team members with roles." },
    errors: ["not_signed_in", "not_found"],
  },
  {
    method: "GET",
    path: "/studio/invites",
    group: "Team",
    summary: "Open invites",
    access: "owner-admin",
    success: {
      status: 200,
      schema: invitesResponse,
      description: "Invites waiting to be accepted.",
    },
    errors: ["not_signed_in", "not_found"],
  },
  {
    method: "POST",
    path: "/studio/invites",
    group: "Team",
    summary: "Invite someone to the team",
    description:
      "Returns the invite link once. Re-inviting the same email replaces the open invite.",
    access: "owner",
    body: inviteInput,
    success: { status: 201, schema: inviteCreatedResponse, description: "Invite created." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "DELETE",
    path: "/studio/invites/{id}",
    group: "Team",
    summary: "Withdraw an open invite",
    access: "owner",
    success: { status: 204, description: "Withdrawn." },
    errors: ["not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "POST",
    path: "/invites/accept",
    group: "Team",
    summary: "Accept an invite",
    description: "The signed-in account's confirmed email must match the invited email.",
    access: "signed-in",
    body: acceptInviteInput,
    success: { status: 200, schema: meResponse, description: "Joined the studio." },
    errors: ["invalid_input", "not_signed_in", "forbidden"],
  },
  {
    method: "GET",
    path: "/studio/activity",
    group: "Studio",
    summary: "The studio's activity log",
    description:
      "The latest 50 changes. Events store IDs only; emails come from the current team list. With jobId, only that job's own changes, roster imports and QR card prints (not each child or class change); a job of another studio is not found.",
    access: "owner-admin",
    query: activityQuery,
    success: {
      status: 200,
      schema: activityResponse,
      description: "Latest activity, newest first.",
    },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "GET",
    path: "/jobs",
    group: "Jobs",
    summary: "The studio's jobs",
    description: "Newest first, in pages (keyset pagination).",
    access: "signed-in",
    query: listQuery,
    success: { status: 200, schema: jobsResponse, description: "A page of jobs." },
    errors: ["invalid_input", "not_signed_in", "not_found"],
  },
  {
    method: "POST",
    path: "/jobs",
    group: "Jobs",
    summary: "Create a job",
    description:
      "New jobs are drafts. The client (optional) must belong to the same studio. Without an internalNumber, the next JOBnnnnn number is used.",
    access: "owner-admin",
    body: jobInput,
    success: { status: 201, schema: jobResponse, description: "Job created." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "GET",
    path: "/jobs/next-number",
    group: "Jobs",
    summary: "The next internal job number",
    description: "The highest JOBnnnnn number in the studio plus one, for the new-job form.",
    access: "owner-admin",
    success: { status: 200, schema: nextJobNumberResponse, description: "A suggested number." },
    errors: ["not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "GET",
    path: "/jobs/{id}",
    group: "Jobs",
    summary: "One job",
    access: "signed-in",
    success: { status: 200, schema: jobResponse, description: "The job." },
    errors: ["not_signed_in", "not_found"],
  },
  {
    method: "PATCH",
    path: "/jobs/{id}",
    group: "Jobs",
    summary: "Change a job",
    description: "Send only the fields to change. The status can't be changed here.",
    access: "owner-admin",
    body: jobPatch,
    success: { status: 200, schema: jobResponse, description: "The changed job." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "GET",
    path: "/jobs/{id}/children",
    group: "Roster",
    summary: "A job's roster",
    description:
      "Children sorted by last and first name, in pages (keyset pagination), with duplicate flags over the whole job.",
    access: "signed-in",
    query: rosterQuery,
    success: { status: 200, schema: childrenResponse, description: "A page of children." },
    errors: ["invalid_input", "not_signed_in", "not_found"],
  },
  {
    method: "POST",
    path: "/jobs/{id}/children",
    group: "Roster",
    summary: "Add a child",
    description: "Generates the child's access code. The class (optional) must belong to the job.",
    access: "roster-editor",
    body: childInput,
    success: { status: 201, schema: childResponse, description: "Child added." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "PATCH",
    path: "/children/{id}",
    group: "Roster",
    summary: "Change a child",
    description: "Send only the fields to change. The access code never changes.",
    access: "roster-editor",
    body: childPatch,
    success: { status: 200, schema: childResponse, description: "The changed child." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "DELETE",
    path: "/children/{id}",
    group: "Roster",
    summary: "Remove a child",
    description: "Deletes the child and their access code. Only while the job is a draft.",
    access: "roster-editor",
    success: { status: 204, description: "Removed." },
    errors: ["not_signed_in", "forbidden", "not_found", "conflict"],
  },
  {
    method: "GET",
    path: "/jobs/{id}/groups",
    group: "Roster",
    summary: "A job's classes, teams or groups",
    description: "Sorted by name, numbers in order (Room 2 before Room 10).",
    access: "signed-in",
    success: { status: 200, schema: groupsResponse, description: "The job's groups." },
    errors: ["not_signed_in", "not_found"],
  },
  {
    method: "POST",
    path: "/jobs/{id}/groups",
    group: "Roster",
    summary: "Add a class, team or group",
    description: "Names are unique per job, ignoring case.",
    access: "roster-editor",
    body: groupInput,
    success: { status: 201, schema: groupResponse, description: "Added." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "PATCH",
    path: "/groups/{id}",
    group: "Roster",
    summary: "Rename a class, team or group",
    access: "roster-editor",
    body: groupPatch,
    success: { status: 200, schema: groupResponse, description: "Renamed." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "POST",
    path: "/jobs/{id}/children/import",
    group: "Roster",
    summary: "Import a roster file's rows",
    description:
      "Send the confirmed rows of a CSV or Excel file (the file itself is never uploaded). A row whose student ID matches exactly one child updates that child: names are replaced, blank cells keep their values, and opt-outs can be turned on but never off. Other rows are added with new access codes. Duplicates are flagged, not merged. All rows are saved together or not at all. With dryRun, nothing is saved.",
    access: "roster-editor",
    body: rosterImportInput,
    success: {
      status: 200,
      schema: rosterImportResponse,
      description: "What was (or would be) added and updated.",
    },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found", "conflict"],
  },
  {
    method: "GET",
    path: "/jobs/{id}/qr-cards",
    group: "Roster",
    summary: "How many of a job's children have a QR card",
    description:
      "For the Overview's Print QR cards to-do: done when every child who may be photographed has a card. A child added later reopens it.",
    access: "signed-in",
    success: { status: 200, schema: qrCardStatusResponse, description: "Card counts." },
    errors: ["not_signed_in", "not_found"],
  },
  {
    method: "POST",
    path: "/jobs/{id}/qr-cards",
    group: "Roster",
    summary: "Print QR cards (PDF)",
    description:
      "A PDF of cards, four per US Letter page, sorted by class: the studio's name, the child's name and class, a QR holding a random card ID (never the access code), the access code and the shop link. Children marked Do not photograph get no card. A child's card is made on their first print and reused on every reprint, so cards already handed out keep working. Blank cards (0–100) have a line for the name and a new access code; each print makes new ones. Made on demand in the studio's region and never stored. A card whose access code can't be read is left out and counted, never printed without a working code. A 409 says why in fields.form: qrCards.nothingToPrint, qrCards.doNotPhotograph or qrCards.codesUnreadable (every card's code is unreadable; Daybell-Cards-Skipped gives the count).",
    access: "roster-editor",
    body: qrCardsInput,
    success: {
      status: 200,
      contentType: "application/pdf",
      description: "The PDF, as a download.",
      headers: {
        [QR_CARD_HEADERS.cards]: "Cards in the PDF, blank cards included.",
        [QR_CARD_HEADERS.skipped]: "Cards left out because their access code can't be read.",
        [QR_CARD_HEADERS.replaced]:
          "Cards with characters the font can't print, shown as ? (Latin letters and accents only).",
      },
    },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found", "conflict"],
  },
  {
    method: "POST",
    path: "/jobs/{id}/upload-batches",
    group: "Photos",
    summary: "Start an upload",
    description:
      "One drop of photos (a folder or a selection). Closed jobs refuse uploads (409, photos.jobClosed). Then register the files, upload their parts and finish the batch.",
    access: "uploader",
    success: { status: 201, schema: uploadBatchResponse, description: "The batch." },
    errors: ["not_signed_in", "forbidden", "not_found", "conflict", "region_unavailable"],
  },
  {
    method: "POST",
    path: "/upload-batches/{id}/files",
    group: "Photos",
    summary: "Register files before uploading them",
    description:
      "Up to 500 files: name, size (at most 50 MB) and SHA-256. JPEG only. The same file twice in a job is a duplicate and skipped, the bin included. A file still uploading from an earlier drop answers resume with its photo, so an upload continues after a reload or on another computer. A job holds at most 50,000 photos, the bin included (409, photos.photoLimit).",
    access: "uploader",
    body: uploadFilesInput,
    success: { status: 200, schema: registerFilesResponse, description: "What to upload." },
    errors: [
      "invalid_input",
      "not_signed_in",
      "forbidden",
      "not_found",
      "conflict",
      "region_unavailable",
    ],
  },
  {
    method: "POST",
    path: "/upload-batches/{id}/part-urls",
    group: "Photos",
    summary: "Signed URLs to upload parts",
    description:
      "Up to 200 parts of photos still uploading. Each URL accepts exactly its part's length (8 MiB, the last part shorter) and lasts 15 minutes. Upload straight to storage, several parts at a time.",
    access: "uploader",
    body: partUrlsInput,
    success: { status: 200, schema: partUrlsResponse, description: "One URL per part." },
    errors: [
      "invalid_input",
      "not_signed_in",
      "forbidden",
      "not_found",
      "conflict",
      "region_unavailable",
    ],
  },
  {
    method: "GET",
    path: "/photos/{id}/upload-parts",
    group: "Photos",
    summary: "Parts already uploaded",
    description: "For resuming: upload only the parts missing here.",
    access: "uploader",
    success: { status: 200, schema: uploadPartsResponse, description: "The parts storage has." },
    errors: ["not_signed_in", "forbidden", "not_found", "conflict", "region_unavailable"],
  },
  {
    method: "POST",
    path: "/photos/{id}/upload-complete",
    group: "Photos",
    summary: "Finish a photo's upload",
    description:
      "The server checks storage has every part at its exact length (409, photos.incomplete, if not), assembles the file and checks its size. Its previews are then made once, in the studio's region.",
    access: "uploader",
    success: { status: 200, schema: uploadCompleteResponse, description: "Uploaded." },
    errors: ["not_signed_in", "forbidden", "not_found", "conflict", "region_unavailable"],
  },
  {
    method: "DELETE",
    path: "/photos/{id}/upload",
    group: "Photos",
    summary: "Cancel a photo's upload",
    description: "Only while it is still uploading. Its parts are dropped and the photo is gone.",
    access: "uploader",
    success: { status: 204, description: "Cancelled." },
    errors: ["not_signed_in", "forbidden", "not_found", "conflict", "region_unavailable"],
  },
  {
    method: "POST",
    path: "/upload-batches/{id}/finish",
    group: "Photos",
    summary: "Finish an upload",
    description:
      "Records what was added, skipped and duplicated in the job's activity (counts only). Finishing twice changes nothing. Batches nobody finishes are finished after a day.",
    access: "uploader",
    body: finishBatchInput,
    success: { status: 204, description: "Finished." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found", "region_unavailable"],
  },
  {
    method: "GET",
    path: "/jobs/{id}/photos",
    group: "Photos",
    summary: "A job's photos",
    description:
      "In tagging order (upload batch, then capture time, then filename; photos without a capture time last in their batch), in pages (keyset pagination). Photos still uploading are not listed.",
    access: "signed-in",
    query: photoListQuery,
    success: { status: 200, schema: photosResponse, description: "A page of photos." },
    errors: ["invalid_input", "not_signed_in", "not_found", "region_unavailable"],
  },
  {
    method: "GET",
    path: "/jobs/{id}/photos/summary",
    group: "Photos",
    summary: "A job's photo counts",
    access: "signed-in",
    success: { status: 200, schema: photoCountsResponse, description: "Counts." },
    errors: ["not_signed_in", "not_found"],
  },
  {
    method: "GET",
    path: "/photos/{id}",
    group: "Photos",
    summary: "One photo",
    access: "signed-in",
    success: {
      status: 200,
      schema: photoDetailResponse,
      description: "The photo, with a 1600 px preview.",
    },
    errors: ["not_signed_in", "not_found", "region_unavailable"],
  },
  {
    method: "POST",
    path: "/jobs/{id}/photos/bin",
    group: "Photos",
    summary: "Move photos to the bin",
    description:
      "Up to 500 of the job's photos. Binned photos are deleted for good after 30 days. A photo that has sold can't be binned (409, photos.photoSold; nothing moves).",
    access: "uploader",
    body: photoIdsInput,
    success: { status: 200, schema: photosMovedResponse, description: "Moved." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found", "conflict"],
  },
  {
    method: "POST",
    path: "/jobs/{id}/photos/restore",
    group: "Photos",
    summary: "Restore photos from the bin",
    access: "uploader",
    body: photoIdsInput,
    success: { status: 200, schema: photosMovedResponse, description: "Restored." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "POST",
    path: "/photos/{id}/retry",
    group: "Photos",
    summary: "Make a photo's previews again",
    description:
      "For a photo the worker couldn't read, or one still processing after 15 minutes (409, photos.notRetryable, otherwise).",
    access: "uploader",
    success: { status: 202, schema: uploadCompleteResponse, description: "Queued." },
    errors: ["not_signed_in", "forbidden", "not_found", "conflict", "region_unavailable"],
  },
  {
    method: "GET",
    path: "/clients",
    group: "Contacts",
    summary: "The studio's clients",
    description: "Schools, daycares, teams and families, by name, in pages (keyset pagination).",
    access: "signed-in",
    query: clientListQuery,
    success: { status: 200, schema: clientsResponse, description: "A page of clients." },
    errors: ["invalid_input", "not_signed_in", "not_found"],
  },
  {
    method: "POST",
    path: "/clients",
    group: "Contacts",
    summary: "Add a client",
    description: "Quebec addresses are not accepted yet. Names don't need to be unique.",
    access: "owner-admin",
    body: clientInput,
    success: { status: 201, schema: clientResponse, description: "Client added." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "GET",
    path: "/clients/{id}",
    group: "Contacts",
    summary: "One client",
    access: "signed-in",
    success: { status: 200, schema: clientResponse, description: "The client." },
    errors: ["not_signed_in", "not_found"],
  },
  {
    method: "PATCH",
    path: "/clients/{id}",
    group: "Contacts",
    summary: "Change a client",
    description: "Send only the fields to change. Send null to clear an optional field.",
    access: "owner-admin",
    body: clientPatch,
    success: { status: 200, schema: clientResponse, description: "The changed client." },
    errors: ["invalid_input", "not_signed_in", "forbidden", "not_found"],
  },
  {
    method: "POST",
    path: "/search",
    group: "Search",
    summary: "Search the studio's jobs and clients",
    description:
      "The menu search box. Jobs match on name or internal number, clients on name only; children are never searched. A POST so the typed text stays out of URLs and request logs. Only the caller's own studio is searched.",
    access: "signed-in",
    body: searchInput,
    success: { status: 200, schema: searchResponse, description: "Up to 10 jobs and 10 clients." },
    errors: ["invalid_input", "not_signed_in", "not_found"],
  },
  {
    method: "GET",
    path: "/internal/photo-worker/photos/{id}",
    group: "Internal",
    summary: "The image worker reads a photo",
    description:
      "Not for integrations. Signed with HMAC-SHA256 (Daybell-Signature: t=…,v1=… over time, region, method, path and the body's SHA-256; Daybell-Region names the data region). Ids, hash, size and the studio's name for the watermark; never the filename.",
    access: "internal",
    success: { status: 200, schema: workerPhotoResponse, description: "The photo." },
    errors: ["not_signed_in", "not_found", "region_unavailable"],
  },
  {
    method: "POST",
    path: "/internal/photo-worker/photos/{id}/result",
    group: "Internal",
    summary: "The image worker reports a photo's result",
    description:
      "Not for integrations. Signed like the read. Idempotent: a photo already processed doesn't change.",
    access: "internal",
    body: workerResultInput,
    success: { status: 200, schema: workerRecordedResponse, description: "Recorded." },
    errors: ["invalid_input", "not_signed_in", "region_unavailable"],
  },
  {
    method: "GET",
    path: "/internal/cron/photos",
    group: "Internal",
    summary: "Daily photo clean-up",
    description:
      "Not for integrations. Vercel Cron, with CRON_SECRET as a bearer token. Deletes every stored version of photos in the bin for more than 30 days (storage first, then rows), drops uploads never finished after 7 days and finishes batches idle for a day.",
    access: "internal",
    success: { status: 200, schema: cronPhotosResponse, description: "What was cleaned up." },
    errors: ["not_signed_in", "internal"],
  },
];

const errorBody = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", enum: [...API_ERROR_CODES] },
        message: { type: "string" },
        fields: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Field -> message key",
        },
      },
    },
  },
};

type Json = Record<string, unknown>;

/**
 * JSON Schema (2020-12, which OpenAPI 3.1 uses) for a zod schema. Named shapes (`.meta({ id })`) are moved into
 * `components.schemas` and referenced from there, so every `$ref` in openapi.json resolves.
 */
function json(
  schema: z.ZodType,
  components: Record<string, Json>,
  io: "input" | "output" = "output",
): Json {
  const out = z.toJSONSchema(schema, { unrepresentable: "any", io }) as Json;
  delete out.$schema;
  const defs = (out.$defs ?? {}) as Record<string, Json>;
  delete out.$defs;
  const fix = (v: Json): Json =>
    JSON.parse(JSON.stringify(v).replaceAll('"#/$defs/', '"#/components/schemas/')) as Json;
  for (const [name, def] of Object.entries(defs)) components[name] = fix(def);
  return fix(out);
}

/** OpenAPI 3.1 description of /api/v1. Served at /api/v1/openapi.json. */
export function buildOpenApi(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  const components: Record<string, Json> = {};
  for (const r of ROUTES) {
    const params: Json[] = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    }));
    if (r.query) {
      // Described as the client sends it: parameters with defaults are optional.
      const query = json(r.query, components, "input") as {
        properties?: Record<string, Json>;
        required?: string[];
      };
      for (const [name, schema] of Object.entries(query.properties ?? {})) {
        const { description, ...rest } = schema;
        params.push({
          name,
          in: "query",
          required: query.required?.includes(name) ?? false,
          ...(description ? { description } : {}),
          schema: rest,
        });
      }
    }
    const responses: Record<string, unknown> = {
      [r.success.status]: {
        description: r.success.description,
        ...(r.success.headers
          ? {
              headers: Object.fromEntries(
                Object.entries(r.success.headers).map(([name, description]) => [
                  name,
                  { description, schema: { type: "integer" } },
                ]),
              ),
            }
          : {}),
        ...(r.success.contentType
          ? {
              content: {
                [r.success.contentType]: { schema: { type: "string", format: "binary" } },
              },
            }
          : r.success.schema
            ? { content: { "application/json": { schema: json(r.success.schema, components) } } }
            : {}),
      },
    };
    for (const code of r.errors) {
      const status = String(STATUS_FOR[code]);
      responses[status] ??= {
        description: code,
        content: { "application/json": { schema: errorBody } },
      };
    }
    paths[r.path] ??= {};
    (paths[r.path] as Record<string, unknown>)[r.method.toLowerCase()] = {
      summary: r.summary,
      ...(r.description ? { description: r.description } : {}),
      tags: [r.group],
      "x-access": r.access,
      ...(r.access === "internal" ? { "x-internal": true } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(r.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: json(r.body, components) } },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Daybell API",
      version: "1",
      description:
        "Every Daybell screen uses this same API (D92). Today it authenticates with the session cookie set by sign-in; API keys for integrations come later.",
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    tags: ROUTE_GROUPS.map((name) => ({ name })),
    paths,
    components: { schemas: components },
  };
}
