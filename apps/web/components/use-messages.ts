"use client";

import { useTranslations } from "next-intl";

/** Translates API field keys ("validation.*") and error codes into the visitor's language. */
export function useApiText() {
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  return {
    field: (key: string | undefined) =>
      key?.startsWith("validation.")
        ? tv(key.slice("validation.".length) as Parameters<typeof tv>[0])
        : key,
    error: (code: string) => {
      const k = (code in ERROR_KEYS ? code : "internal") as Parameters<typeof te>[0];
      return te(k);
    },
  };
}

const ERROR_KEYS = {
  network: 1,
  invalid_input: 1,
  not_signed_in: 1,
  forbidden: 1,
  not_found: 1,
  conflict: 1,
  region_unavailable: 1,
  invalid_credentials: 1,
  email_not_confirmed: 1,
  rate_limited: 1,
  internal: 1,
};
