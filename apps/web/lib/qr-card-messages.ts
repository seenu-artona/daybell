import { QR_CARD_CONFLICTS, QR_CARD_HEADERS } from "@daybell/api";
import type { DownloadResult } from "./client-api";

/** Which app.qrCards message explains a failed print (ADR 0015), or null to show the general error for its code. */
export type QrCardProblem =
  | { key: "nothing" }
  | { key: "doNotPhotograph" }
  | { key: "skipped"; count: number }
  | null;

export function qrCardProblem(res: Extract<DownloadResult, { ok: false }>): QrCardProblem {
  if (res.code !== "conflict") return null;
  switch (res.fields.form) {
    case QR_CARD_CONFLICTS.doNotPhotograph:
      return { key: "doNotPhotograph" };
    case QR_CARD_CONFLICTS.codesUnreadable:
      return {
        key: "skipped",
        count: Number(res.headers.get(QR_CARD_HEADERS.skipped) ?? "0") || 1,
      };
    default:
      return { key: "nothing" };
  }
}
