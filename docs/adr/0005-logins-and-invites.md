# 0005 — Logins, studio sign-up and invites

- Status: Accepted, Oct 11, 2026
- Decisions: D7, D92, D96, D113, D122

**Logins** use Supabase Auth through `@supabase/ssr`, so sessions live in secure cookies. **Sign-up is passwordless:**
we email a link; after confirming, the person chooses a password (12+ characters, no composition rules, NIST SP
800-63B). This blocks account pre-hijacking: Supabase keeps the first password if someone signs up an email twice, so
taking a password before confirmation would let an attacker plant one on a victim's email. Changing a password needs a
recent sign-in ("secure password change"). Every server check calls `auth.getUser()`, which verifies the session with
Supabase rather than trusting the cookie.

**Links and requests.** Every emailed link is built from `siteUrl()` (SITE_URL or Vercel's own address), never from the
request's Host header. Cookie-authenticated writes must be JSON and same-origin (Origin / Sec-Fetch-Site), which stops
cross-site request forgery including login CSRF. Database errors reach clients only as fixed messages.

**Regions.** A region is available when its two `NEXT_PUBLIC_SUPABASE_*_<REGION>` variables are set. Each regional project
has its own accounts; a `daybell_region` cookie remembers which one this browser signed in to. With one region the
choice is hidden. Adding the US = set its variables (D122).

**Sign-up.** The studio name and web address are saved on the account at sign-up; the studio is created by
`public.create_studio()` once the email is confirmed (in `/auth/confirm`, or on next sign-in). Browsers never insert into
`studios` directly.

**Email links work anywhere.** Our auth email templates (`packages/db/supabase/templates/`) link to `/auth/confirm`
with a `token_hash` and the region, so a link opened in a new tab, another browser or a phone still signs the person in
to the right regional database.

**Invites.** Owners create an invite for an email and role (never owner). The database stores only a SHA-256 hash of the
token. The link is `/invite#<token>`: the fragment never reaches a server, so tokens stay out of logs. The page keeps
the token in localStorage (7 days) so it survives the confirmation email opening in a new tab. It works once, for
that exact *confirmed* email, for 7 days. People join studios only through invites (owners can't insert members
directly). Until email sending arrives (step 7) the owner copies the link.

**API first (D92).** Screens call `/api/v1` routes; the routes call database functions that enforce roles themselves, so
the browser, the public API and the MCP server all share one set of rules. Validation messages are keys translated by
the screens (D96).

**Tests.** pgTAP covers the database functions; a Playwright test in CI runs the whole flow (sign up, confirm email,
invite, join, isolation) against a local Supabase on desktop and phone sizes.

**Not yet:** 2-step login for owners (next step), email from Daybell's own domain (step 7).
