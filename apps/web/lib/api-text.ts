/** Turns API field keys ("validation.*") and error codes into text, given the two translators (see useApiText). */
export function apiText(
  validation: (key: string) => string,
  errors: (key: string) => string,
): { field: (key: string | undefined) => string | undefined; error: (code: string) => string } {
  return {
    field: (key) =>
      key?.startsWith("validation.")
        ? validation(key.slice("validation.".length))
        : key
          ? validation("invalid")
          : undefined,
    error: (code) => errors(Object.hasOwn(ERROR_KEYS, code) ? code : "internal"),
  };
}

const ERROR_KEYS = {
  network: 1,
  invalid_input: 1,
  not_signed_in: 1,
  shop_session_required: 1,
  forbidden: 1,
  not_found: 1,
  conflict: 1,
  region_unavailable: 1,
  invalid_credentials: 1,
  email_not_confirmed: 1,
  rate_limited: 1,
  internal: 1,
};
