"use client";

import { ORDER_CONFLICTS } from "@daybell/api";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useApiText } from "@/components/use-messages";
import type { ApiResult } from "@/lib/client-api";

type Refusal = Extract<ApiResult<unknown>, { ok: false }>;
const CONFLICT_KEYS = new Map(
  Object.entries(ORDER_CONFLICTS).map(([key, code]) => [code as string, key]),
);

/** The words for an order refusal (ADR 0024): its orders.* conflict, else the field's, else the error's. */
export function useOrderRefusal() {
  const t = useTranslations("app.orders.conflicts");
  const text = useApiText();
  return useCallback(
    (res: Refusal) => {
      const key = CONFLICT_KEYS.get(res.fields.form ?? "");
      if (key) return t(key as keyof typeof ORDER_CONFLICTS);
      const field = Object.values(res.fields)[0];
      return text.field(field) ?? text.error(res.code);
    },
    [t, text],
  );
}

/** An order conflict's words by its code (bulk results). */
export function useConflictWord() {
  const t = useTranslations("app.orders.conflicts");
  return useCallback(
    (code: string) => {
      const key = CONFLICT_KEYS.get(code);
      return key ? t(key as keyof typeof ORDER_CONFLICTS) : null;
    },
    [t],
  );
}
