"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { apiText } from "@/lib/api-text";

/**
 * Translates API field keys ("validation.*") and error codes into the visitor's language. The result is memoized, so
 * effects can list it as a dependency without running again on every render.
 */
export function useApiText() {
  const tv = useTranslations("validation");
  const te = useTranslations("errors");
  return useMemo(
    () =>
      apiText(
        (key) => tv(key as Parameters<typeof tv>[0]),
        (key) => te(key as Parameters<typeof te>[0]),
      ),
    [tv, te],
  );
}
