import "server-only";
import { ApiError, fieldErrors, fromDatabaseError } from "@daybell/api";
import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { z } from "zod";

/** Wraps an /api/v1 handler: one error shape for every failure, no internals leaked, no personal data logged. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
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

/** Throws the matching ApiError when a Supabase call failed. */
export function check<T>(result: {
  data: T;
  error: { code?: string; message?: string } | null;
}): T {
  if (result.error) throw fromDatabaseError(result.error);
  return result.data;
}

export { safeNextClient as safeNext } from "./safe-next";
