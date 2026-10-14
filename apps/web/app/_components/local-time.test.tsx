// @vitest-environment jsdom
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { LocalTime, useLocalDateTime, viewerTimeZone } from "./local-time";

// Moments in the viewer's own time zone, not the server's (staging showed a 12:03 PM Vancouver payment as 7:03 PM, and
// a refund made on Oct 13 local as Oct 14). The provider is given UTC, as the server's config is; the browser says
// Vancouver.
const PAID = "2026-10-13T19:03:00.000Z"; // 12:03 PM in Vancouver (UTC−7)
const REFUNDED = "2026-10-14T03:30:00.000Z"; // 8:30 PM on Oct 13 in Vancouver

/** The browser's time zone, as Intl reports it. */
function browserZone(timeZone: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...real.call(this), timeZone };
  });
}

const withIntl = (ui: ReactNode) => (
  <NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
    {ui}
  </NextIntlClientProvider>
);

function Sentence({ at }: { at: string }) {
  const local = useLocalDateTime();
  return <p>{`Paid on ${local(at, { dateStyle: "medium" })}`}</p>;
}

let container: HTMLDivElement;
let root: Root | null = null;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  browserZone("America/Vancouver");
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe("viewerTimeZone", () => {
  it("is the browser's zone, or UTC when it can't say", () => {
    expect(viewerTimeZone()).toBe("America/Vancouver");
    vi.restoreAllMocks();
    browserZone("");
    expect(viewerTimeZone()).toBe("UTC");
  });
});

describe("LocalTime", () => {
  it("shows a moment in the browser's time zone, in a <time> with the exact moment", async () => {
    root = createRoot(container);
    await act(async () => {
      root?.render(
        withIntl(
          <>
            <LocalTime value={PAID} options={{ dateStyle: "medium", timeStyle: "short" }} />
            <LocalTime value={REFUNDED} />
          </>,
        ),
      );
    });
    const times = [...container.querySelectorAll("time")];
    expect(times.map((t) => t.textContent)).toEqual(["Oct 13, 2026, 12:03 PM", "Oct 13, 2026"]);
    expect(times.map((t) => t.getAttribute("datetime"))).toEqual([PAID, REFUNDED]);
  });

  it("follows the viewer's zone, whatever it is", async () => {
    vi.restoreAllMocks();
    browserZone("America/Toronto");
    root = createRoot(container);
    await act(async () => {
      root?.render(withIntl(<LocalTime value={PAID} options={{ timeStyle: "short" }} />));
    });
    expect(container.textContent).toBe("3:03 PM");
  });

  it("renders no time on the server and hydrates without a mismatch, then fills it in", async () => {
    const ui = withIntl(
      <>
        <LocalTime value={PAID} options={{ dateStyle: "medium", timeStyle: "short" }} />
        <Sentence at={REFUNDED} />
      </>,
    );
    // The server can't know the zone: an empty <time> with the moment, and no date in the sentence.
    const html = renderToString(ui);
    expect(html).toContain(`<time dateTime="${PAID}"></time>`);
    expect(html).not.toMatch(/7:03|Oct 14/);
    container.innerHTML = html;
    const errors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, ui, { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    expect(container.querySelector("time")?.textContent).toBe("Oct 13, 2026, 12:03 PM");
    expect(container.querySelector("p")?.textContent).toBe("Paid on Oct 13, 2026");
  });
});
