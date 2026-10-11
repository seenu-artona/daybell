import { getRequestConfig } from "next-intl/server";

/**
 * All user-facing words live in messages/*.json (D96). English for the US and Canada at launch;
 * French (Canada) arrives after open beta (D90). The locale will follow the studio's country.
 */
export const LOCALES = ["en-US", "en-CA"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en-US";

export default getRequestConfig(async () => {
  const locale: Locale = DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
