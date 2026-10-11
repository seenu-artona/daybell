/**
 * Every /api/v1 error has the same shape (D92): a stable machine `code` and a plain-language `message` the screen can
 * show. Messages here are fallbacks; screens map codes to locale text.
 */
export const API_ERROR_CODES = [
  "invalid_input",
  "not_signed_in",
  "forbidden",
  "not_found",
  "conflict",
  "region_unavailable",
  "invalid_credentials",
  "email_not_confirmed",
  "rate_limited",
  "internal",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; fields?: Record<string, string> };
}

export const STATUS_FOR: Record<ApiErrorCode, number> = {
  invalid_input: 400,
  not_signed_in: 401,
  invalid_credentials: 401,
  email_not_confirmed: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  region_unavailable: 422,
  rate_limited: 429,
  internal: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get status(): number {
    return STATUS_FOR[this.code];
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}

/** Maps Postgres error codes to API errors with fixed messages: raw database text never reaches a client. */
export function fromDatabaseError(
  err: { code?: string; message?: string } | null | undefined,
): ApiError {
  switch (err?.code) {
    case "42501":
      return new ApiError("forbidden", "You don't have permission to do that.");
    case "23505":
      return new ApiError("conflict", "That already exists.");
    case "23514":
    case "23503":
    case "22P02":
      return new ApiError("invalid_input", "Please check what you entered.");
    default:
      return new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
}
