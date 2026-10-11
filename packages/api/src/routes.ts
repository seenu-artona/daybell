import { z } from "zod";
import { API_ERROR_CODES, type ApiErrorCode, STATUS_FOR } from "./errors";
import {
  acceptInviteInput,
  inviteInput,
  joinSignUpInput,
  passwordResetRequestInput,
  passwordUpdateInput,
  signInInput,
  signUpInput,
} from "./schemas";
import {
  activityResponse,
  checkEmailResponse,
  inviteCreatedResponse,
  invitesResponse,
  meResponse,
  teamResponse,
} from "./types";

/**
 * Every /api/v1 endpoint, described once (D92). The docs page and openapi.json are generated from this list, and a test
 * fails if a route file exists that isn't listed here (or the other way round).
 */
export type Access = "public" | "signed-in" | "owner-admin" | "owner";

export interface RouteSpec {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  group: "Account" | "Studio" | "Team";
  summary: string;
  description?: string;
  access: Access;
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
function json(schema: z.ZodType, components: Record<string, Json>): Json {
  const out = z.toJSONSchema(schema, { unrepresentable: "any" }) as Json;
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
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    }));
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
    tags: [{ name: "Account" }, { name: "Team" }, { name: "Studio" }],
    paths,
    components: { schemas: components },
  };
}
