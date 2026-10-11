# 0005 — Logins, studio sign-up and invites

- Status: Accepted, Oct 11, 2026
- Decisions: D7, D92, D96, D113, D122

**Logins** use Supabase Auth (email + password, email must be confirmed) through `@supabase/ssr`, so sessions live in
secure cookies. Passwords need 12+ characters with no composition rules (NIST SP 800-63B); Supabase rejects common ones.
Every server check calls `auth.getUser()`, which verifies the session with Supabase rather than trusting the cookie.

**Regions.** A region is available when its two `NEXT_PUBLIC_SUPABASE_*_<REGION>` variables are set. Each regional project
has its own accounts; a `daybell_region` cookie remembers which one this browser signed in to. With one region the
choice is hidden. Adding the US = set its variables (D122).

**Sign-up.** The studio name and web address are saved on the account at sign-up; the studio is created by
`public.create_studio()` once the email is confirmed (in `/auth/confirm`, or on next sign-in). Browsers never insert into
`studios` directly.

**Invites.** Owners create an invite for an email and role (never owner). The database stores only a SHA-256 hash of the
token; the link carries the token, works once, for that email, for 7 days. Until email sending arrives (step 7) the
owner copies the link.

**API first (D92).** Screens call `/api/v1` routes; the routes call database functions that enforce roles themselves, so
the browser, the public API and the MCP server all share one set of rules. Validation messages are keys translated by
the screens (D96).

**Tests.** pgTAP covers the database functions; a Playwright test in CI runs the whole flow (sign up, confirm email,
invite, join, isolation) against a local Supabase on desktop and phone sizes.

**Not yet:** 2-step login for owners (next step), email from Daybell's own domain (step 7).
