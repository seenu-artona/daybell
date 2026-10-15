import { canSeePayouts } from "@daybell/core";

/** Settings' sections (D154; ADR 0029), in order: Team, Stripe, Taxes, Templates. */
export type SettingsSection = "team" | "payouts" | "taxes" | "templates";

export const SETTINGS_HREF: Record<SettingsSection, string> = {
  team: "/app/settings",
  payouts: "/app/settings/payouts",
  taxes: "/app/settings/taxes",
  templates: "/app/settings/templates",
};

/**
 * The sections a role sees: Team and Templates for everyone (templates are read by the whole team, who choose one for
 * a new job), Stripe and Taxes for owners and admins only (ADR 0020, 0023).
 */
export function settingsSections(role: string): SettingsSection[] {
  return canSeePayouts(role) ? ["team", "payouts", "taxes", "templates"] : ["team", "templates"];
}

/** The section a path is in; a template's own page has its own frame (null). */
export function settingsSectionFor(path: string): SettingsSection | null {
  const clean = path.replace(/\/+$/, "");
  if (/^\/app\/settings\/templates\/[^/]+$/.test(clean)) return null;
  if (clean.startsWith(SETTINGS_HREF.templates)) return "templates";
  if (clean.startsWith(SETTINGS_HREF.payouts)) return "payouts";
  if (clean.startsWith(SETTINGS_HREF.taxes)) return "taxes";
  return "team";
}
