import { z } from "zod";
import { API_ERROR_CODES, type ApiErrorCode, STATUS_FOR } from "./errors";
import {
  acceptInviteInput,
  clientInput,
  clientListQuery,
  clientPatch,
  inviteInput,
  jobInput,
  jobPatch,
  joinSignUpInput,
  listQuery,
  passwordResetRequestInput,
  passwordUpdateInput,
  signInInput,
  signUpInput,
} from "./schemas";
import {
  activityResponse,
  checkEmailResponse,
  clientResponse,
  clientsResponse,
  inviteCreatedResponse,
  invitesResponse,
  jobCategoriesResponse,
  jobResponse,
  jobsResponse,
  meResponse,
  nextJobNumberResponse,
  teamResponse,
} from "./types";

/**
 * Every /api/v1 endpoint, described once (D92). The docs page and openapi.json are generated from this list, and a test
 * fails if a route file exists that isn't listed here (or the other way round).
 */
export type Access = "public" | "signed-in" | "owner-admin" | "owner";

export const ROUTE_GROUPS = ["Account", "Team", "Studio", "Jobs", "Contacts"] as const;

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
  success: { status: 200 | 201 | 202 | 204; schema?: z.ZodType; description: string };
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
      "The latest 50 changes. Events store IDs only; emails come from the current team list.",
    access: "owner-admin",
    success: {
      status: 200,
      schema: activityResponse,
      description: "Latest activity, newest first.",
    },
    errors: ["not_signed_in", "forbidden", "not_found"],
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
      "New jobs are drafts. The client (optional) and category must belong to the same studio. Without an internalNumber, the next JOBnnnnn number is used.",
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
    path: "/job-categories",
    group: "Jobs",
    summary: "The studio's job categories",
    description:
      "Every studio starts with Fall, Spring, Graduation, Sports, Dance, Yearbook and Other.",
    access: "signed-in",
    success: {
      status: 200,
      schema: jobCategoriesResponse,
      description: "Categories in their display order.",
    },
    errors: ["not_signed_in", "not_found"],
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
        ...(r.success.schema
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
