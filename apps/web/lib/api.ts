import "server-only";
import { ApiError, fieldErrors, fromDatabaseError } from "@daybell/api";
import { siteUrl } from "@daybell/config";
import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { z } from "zod";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request forgery guard for cookie-authenticated writes. Browsers always send Origin/Sec-Fetch-Site on
 * cross-site requests and a page can't forge them; non-browser API clients send neither and will use tokens.
 * JSON-only bodies also stop plain HTML forms (enctype=text/plain) from reaching the API.
 */
export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ApiError("forbidden", "Cross-site requests are not allowed.");
  }
  // The Origin must be this site: our configured address, or the host the browser actually addressed.
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (origin !== siteUrl() && originHost !== host) {
      throw new ApiError("forbidden", "Cross-site requests are not allowed.");
    }
  }
  const type = request.headers.get("content-type") ?? "";
  // A body exists only if the client declared one (length > 0 or chunked). Bodiless DELETE/POST need no JSON type.
  const length = Number(request.headers.get("content-length") ?? "0");
  const hasBody = length > 0 || request.headers.has("transfer-encoding");
  if (hasBody && !type.toLowerCase().startsWith("application/json")) {
    throw new ApiError("invalid_input", "Send JSON with Content-Type: application/json.");
  }
}

/** Wraps an /api/v1 handler: one error shape for every failure, no internals leaked, no personal data logged. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      const request = args[0];
      if (request instanceof Request) assertSameOrigin(request);
      return await fn(...args);
    } catch (err) {
      const apiError =
        err instanceof ApiError
          ? err
          : new ApiError("internal", "Something went wrong on our side.");
      if (!(err instanceof ApiError))
        console.error("api_unhandled", err instanceof Error ? err.name : typeof err);
      return NextResponse.json(apiError.toBody(), { status: apiError.status });
    }
  };
}

export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError("invalid_input", "The request body must be JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new ApiError(
      "invalid_input",
      "Please check the highlighted fields.",
      fieldErrors(result.error),
    );
  return result.data;
}

export async function requireUser(supabase: {
  auth: { getUser: () => Promise<{ data: { user: User | null } }> };
}): Promise<User> {
  // getUser() asks Supabase to verify the session; never trust the cookie alone.
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new ApiError("not_signed_in", "Please sign in.");
  return data.user;
}

/** Reads ?query parameters with a schema; problems come back as field errors like a body would. */
export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.infer<S> {
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new ApiError(
      "invalid_input",
      "Please check the query parameters.",
      fieldErrors(result.error),
    );
  return result.data;
}

/** Quotes a value for a PostgREST `or=(...)` filter, so commas, dots, brackets and quotes in it stay literal. */
export function filterValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Escapes LIKE wildcards so a search for "50%" finds "50%", not everything. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Throws the matching ApiError when a Supabase call failed. */
export function check<T>(result: {
  data: T;
  error: { code?: string; message?: string } | null;
}): T {
  if (result.error) throw fromDatabaseError(result.error);
  return result.data;
}

export { safeNextClient as safeNext } from "./safe-next";
