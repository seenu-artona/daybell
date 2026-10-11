import { expect } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Waits for the newest email to `to` and returns the first link in it that matches `pattern`. */
export async function linkFromEmail(to: string, pattern: RegExp): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        const newest = messages[0];
        if (!newest) return false;
        const message = (await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json()) as {
          HTML: string;
          Text: string;
        };
        const body = `${message.HTML}\n${message.Text}`.replaceAll("&amp;", "&");
        link = body.match(pattern)?.[0];
        return Boolean(link);
      },
      { timeout: 30_000, message: `no email with a matching link reached ${to}` },
    )
    .toBe(true);
  return link as string;
}
