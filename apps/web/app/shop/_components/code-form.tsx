"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useRef, useState } from "react";
import { type ShopResult, shopApi } from "@/lib/shop-client";
import { useRefusal } from "./format";
import { shopButton } from "./styles";

/**
 * The access code field (D24; answer 2): a labelled text field that tolerates spaces and dashes and never autocorrects
 * or autofills. The code is sent in the request body only and is never kept in the page's address or storage.
 */
export function CodeForm({
  submitLabel,
  onOpened,
}: {
  submitLabel: string;
  onOpened: (childId: string) => void | Promise<void>;
}) {
  const t = useTranslations("shop.entry");
  const refusal = useRefusal();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!code.trim()) {
      setError(
        refusal({ status: 404, code: "not_found", form: "shop.codeNotFound", retryAfter: null }),
      );
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    // Opening and adding are the same call (S6): the code's studio decides which gallery the child joins.
    const result: ShopResult<{ childId: string }> = await shopApi.open(code);
    if (result.ok) {
      setCode("");
      await onOpened(result.data.childId);
    } else {
      setError(refusal(result));
      input.current?.focus();
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <label htmlFor={id} className="text-label text-ink">
        {t("codeLabel")}
      </label>
      <input
        ref={input}
        id={id}
        name="code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        enterKeyHint="go"
        maxLength={40}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="min-h-14 w-full rounded-md border border-line-strong bg-surface px-4 text-center font-mono text-2xl font-bold tracking-[0.15em] text-ink uppercase focus:border-studio-ring focus:outline-3 focus:outline-offset-1 focus:outline-studio-ring"
      />
      <p id={`${id}-error`} role="alert" className="m-0 min-h-5 text-caption text-danger">
        {error}
      </p>
      <button type="submit" disabled={busy} className={shopButton}>
        {busy ? t("submitting") : submitLabel}
      </button>
    </form>
  );
}
