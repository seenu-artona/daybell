"use client";

import { useFormatter } from "next-intl";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Moments (timestamps) in the viewer's own time zone (D91, D96). The app's next-intl config has no time zone, so a
 * plain `format.dateTime` uses the server's (UTC): a 12:03 PM Vancouver payment read "7:03 PM". These read the zone
 * from the browser instead.
 *
 * The server can't know the zone, so the server render and the hydrating render show no time at all (the same empty
 * text on both, so no hydration mismatch); the browser fills it in straight after. Every screen that shows these loads
 * its data in the browser, so in practice the time is there as soon as the data is.
 *
 * Calendar dates (picture day, a closing day) are not moments: they keep `timeZone: "UTC"` where they are formatted.
 */

/** The browser's time zone, e.g. "America/Vancouver"; "UTC" if it can't say. Also what Home sends as `?tz=`. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const subscribe = () => () => {};

/** next-intl's date options (its second overload's third argument). */
export type DateTimeOptions = NonNullable<
  Parameters<ReturnType<typeof useFormatter>["dateTime"]>[2]
>;

/** The viewer's time zone, or null on the server and while hydrating. */
export function useViewerTimeZone(): string | null {
  return useSyncExternalStore(subscribe, viewerTimeZone, () => null);
}

/** Formats a moment in the viewer's time zone, for words inside a sentence; "" until the zone is known. */
export function useLocalDateTime(): (value: string | Date, options: DateTimeOptions) => string {
  const format = useFormatter();
  const timeZone = useViewerTimeZone();
  return useCallback(
    (value, options) =>
      timeZone ? format.dateTime(new Date(value), { ...options, timeZone }) : "",
    [format, timeZone],
  );
}

/** A moment on its own (a table cell, a line), as a <time> element in the viewer's time zone. */
export function LocalTime({
  value,
  options = { dateStyle: "medium" },
  className,
}: {
  /** An ISO timestamp. */
  value: string;
  options?: DateTimeOptions;
  className?: string;
}) {
  const local = useLocalDateTime();
  return (
    <time dateTime={value} className={className}>
      {local(value, options)}
    </time>
  );
}
