# Staging payouts on Stripe (Phase 1 steps 7, 7b and 7c)

What Seenu sets up once in the Stripe Dashboard, in **test mode** (a sandbox), so staging can connect studios' payout
accounts with Stripe Connect (ADR 0020; D56, D98, D106, D113). Nothing here goes in the repository. Keys and signing
secrets go straight into Vercel, never into chat, code, commits or logs. Only the names of the variables appear below.

Daybell's code pins **stripe-node 22.6.2** and the API version **`2026-08-26.dahlia`** (that package's own default).

Since step 7b, studio accounts are created with **Accounts v2** (`POST /v2/core/accounts`; ADR 0020, section 16),
because Stripe refuses Accounts v1 creation for new Connect platforms. **Don't** switch on "Accounts v1 support" in the
Dashboard: Daybell doesn't need it.

Since step 7c, the create also sends the **owner's sign-in email** as the account's `contact_email`: Stripe refused the
create without one ("If configuration.recipient is supplied, the Account must have a contact email"; Seenu, Oct 12).
It comes from the signed-in owner's verified account, never from the request, and is never logged or put in metadata.
An owner whose sign-in has no email sees "Stripe needs an email address for your payout account, and your sign-in has
none. Please contact Daybell support." and nothing is sent to Stripe.

## 1. Test mode and Connect

1. Open the Stripe Dashboard for Daybell's **Canadian** Stripe account and switch to **test mode** (or the sandbox
   you use for staging).
2. **Connect › Get started** (if Connect isn't set up yet):
   - Choose **Platform or marketplace**.
   - Onboarding: **Stripe-hosted onboarding**.
   - Responsibilities (Seenu's answers Q1 and Q2):
     - Stripe collects and verifies the account's information (**requirement collection: Stripe**).
     - **Daybell (the platform) is responsible for negative balances** (losses).
     - **Daybell pays Stripe's fees** (fees payer: application). They are passed on to studios (D98).
     - Connected accounts get the **Express dashboard**.
   - Daybell creates each account through the API with these same settings (Accounts v2: `dashboard: express`,
     `fees_collector: application`, `losses_collector: application`), so the Dashboard choices only need to allow
     them.
   - **Platform profile**: finish it, including **acknowledging Daybell's responsibility for losses** (negative
     balances) on connected accounts. Until then Stripe refuses to create accounts (error code
     `account_creation_liability_unacknowledged`), and owners see "Stripe needs the platform setup finished".
3. **Connect › Settings**:
   - **Countries**: allow **Canada**. Leave the US off for now (Q3: US payouts wait for Stripe's and an adviser's
     confirmation).
   - **Branding**: add the Daybell name, icon and brand colour, so Stripe's hosted pages show Daybell.
   - **Payouts**: leave the default delay as it is. Daybell sets each account's schedule itself: weekly on Friday by
     default, and the owner can change it in Settings › Payouts.

## 2. An API key

**Developers › API keys**: either use the test **secret key** (`sk_test_…`), or create a **restricted key**
(`rk_test_…`) with write access to **Connect › Accounts** (this covers account links and login links) and read access
to **Payouts**, plus whatever the screen lists for **Accounts v2** (v2 accounts and account links). Check the exact
permission names on the restricted-key screen; the code calls `v2.core.accounts.create`, `v2.core.accountLinks.create`,
`accounts.retrieve`, `accounts.update`, `accounts.createLoginLink` and `payouts.retrieve` (on the connected account).
The v1 calls take the v2 account's id. If unsure, use the test secret key.

Copy the key straight into Vercel (step 4). Don't paste it anywhere else.

## 3. The webhook destinations (two, same address)

Stripe sends v1 events as **snapshot** payloads and Accounts v2 events as **thin** payloads, and one destination has
one payload style, so Daybell needs **two destinations** pointing at the **same URL**. It isn't known yet whether Stripe
also sends the v1 `account.updated` for accounts created with v2, so both carry account changes; getting both is
harmless (Daybell reads the account from Stripe again either way, and records each event once).

**Developers › Webhooks › Add destination**, twice:

**Destination A: snapshot (keep the one you already have)**
- **Events from**: **Connected accounts**.
- **API version**: the version the destination already uses is fine. The current sandbox destination uses
  `2026-09-30.endive`; the code pins `2026-08-26.dahlia`. Daybell reads each object from Stripe again with its pinned
  version rather than trusting the payload, so the payload's version matters little. Line them up when the stripe
  package is next upgraded.
- **Payload style**: snapshot.
- **Events** (exactly these 7): `account.updated`, `capability.updated`, `payout.created`, `payout.updated`,
  `payout.paid`, `payout.failed`, `payout.canceled`.

**Destination B: thin (new)**
- **Events from**: **Your account** (Accounts v2 events about connected accounts are the platform's own events; if the
  Dashboard offers them under "Connected accounts" instead, choose that).
- **Payload style**: **thin**.
- **Events** (exactly these 6):
  - `v2.core.account.updated`
  - `v2.core.account[requirements].updated`
  - `v2.core.account[configuration.merchant].updated`
  - `v2.core.account[configuration.merchant].capability_status_updated`
  - `v2.core.account[configuration.recipient].updated`
  - `v2.core.account[configuration.recipient].capability_status_updated`

**Both destinations:**
- **Endpoint URL**: `https://<staging domain>/api/v1/webhooks/stripe`. If staging uses Vercel Deployment Protection,
  add the "Protection Bypass for Automation" query parameter, as for the image worker.
- After saving, **reveal each signing secret** (`whsec_…`) and copy them straight into Vercel (step 4), comma-separated
  in the one variable.

## 4. Vercel environment variables

**Vercel › Project › Settings › Environment Variables**. Scope: **Preview, branch `main` only** (staging). Not
Production, and not every PR preview (Claude's call Q13). PR previews without these variables say payouts aren't set up
there.

| Name | Value | Sensitive |
|---|---|---|
| `STRIPE_DRIVER` | `stripe` | no |
| `STRIPE_SECRET_KEY` | the test key from step 2 | **yes** |
| `STRIPE_WEBHOOK_SECRET` | both signing secrets from step 3, comma-separated (`whsec_A,whsec_B`) | **yes** |

Notes:
- The app refuses a live key (`sk_live_`/`rk_live_`) anywhere but production, and refuses `STRIPE_DRIVER=fake` on
  Vercel, both at build time and at run time.
- `STRIPE_WEBHOOK_SECRET` takes one to four secrets. To roll one, add the new one next to the old (e.g.
  `A,B,B-new`), redeploy, roll it in Stripe, then remove the old one.

## 5. Redeploy and smoke test

1. Redeploy staging (the `main` branch).
2. Sign in to staging as a **Canadian** studio's owner. Go to **Settings › Payouts** and click **Set up payouts**.
3. On Stripe's test onboarding, use Stripe's test data. The usual values (check them on Stripe's "Testing Connect"
   page, since they weren't checked from here):
   - Phone and SMS code: Stripe's test phone and the code `000 000`.
   - Business and representative details: any test values Stripe accepts.
   - Bank account: Stripe's Canadian test numbers.
4. Back in Daybell, the status should read **Active**. If it reads Pending verification, wait a minute and reload: the
   `account.updated` webhook updates it.
   - **Check payouts are enabled (code review S2).** Daybell can't request payouts when it creates a v2 account (the
     create has no payouts setting); it assumes Stripe turns them on for an Express-dashboard account with the merchant
     and recipient configurations. In the Stripe Dashboard, open the connected account: **Payouts** must show as
     enabled (`payouts_enabled: true` on the account, e.g. `stripe accounts retrieve <the account id>`). Daybell's
     Settings › Payouts shows a next payout date only when it is. If payouts stay off after onboarding is complete,
     stop and tell the developers: account creation needs another configuration.
   - **Check the default schedule.** The connected account's payout schedule should be weekly on Friday, and its
     metadata should include `daybell_schedule_set: true` (Daybell sets the schedule just after recording the account;
     if that failed, refresh or the next webhook sets it).
5. Change the schedule to monthly and save. In the Stripe Dashboard, the connected account's payout schedule should
   match.
6. Trigger a payout event for the connected account with the Stripe CLI, e.g.
   `stripe trigger payout.paid --stripe-account <the account id>`, and check **Recent payouts**.
7. In **Developers › Webhooks**, both destinations' deliveries should show 200s. A 404 means the account isn't in
   staging's database yet (Stripe retries). A 500 means processing failed (Stripe retries; the inbox row keeps the
   error's code).

## What Daybell keeps

Stripe account and payout ids, flags (details submitted, card payments, payouts), counts of what's due, Stripe's reason
codes, the schedule, and each payout's amount, currency, status and dates. Never bank details, names, emails or
addresses, and never webhook payloads. (The owner's sign-in email is sent to Stripe as the account's contact email
when it is created; Daybell doesn't copy it anywhere.)

## If setting up payouts fails

Vercel's function logs for `POST /api/v1/studio/payouts/onboarding-link` show a line
`stripe_error <stage> <class> <raw type> <code>` (never Stripe's message): the stage is `create` (the v2 account),
`schedule` (the payout schedule, after the account is recorded) or `other`; v2 errors may carry their reason in the
raw type rather than the code, so look at both (`none` when Stripe sent nothing, `other` when it wasn't an
identifier). Stripe's full message for the same request is in the Stripe Dashboard under
**Developers › Logs**. Codes that mean the platform setup isn't finished, with the likely fix (from Stripe's Accounts v2
docs and the codes' names; the message in Stripe's log is the authority):

| Code (or raw type) | What to do |
|---|---|
| `account_creation_liability_unacknowledged` | Connect › Settings › Platform profile: acknowledge responsibility for losses. |
| `connect_profile_not_submitted` | Finish and submit the Connect platform profile. |
| `account_create_activation_required` | Activate the platform account (or use a sandbox where Connect is set up). |
| `accounts_v2_access_blocked` | Accounts v2 isn't open to this platform: contact Stripe support. |
| `capability_not_available_in_country` | A requested capability isn't offered for Canada: check Connect settings, then tell the developers. |
| `cross_border_connected_account_creation_not_allowed` | Connect › Settings › Countries: allow Canada. |

The owner sees "Daybell’s platform setup with Stripe isn’t finished yet, so payouts can’t be set up. Please contact
Daybell support." for these: only Daybell can fix them.

**`invalid_fields` (step 7c).** When Stripe v2 refuses fields (code `invalid_fields`), a second line
`stripe_invalid_fields <stage> <field names>` lists the refused fields' names, comma-separated (e.g.
`configuration.recipient`), at most 20; a name that isn't a plain Stripe field path is shown as `other`, and `none`
means Stripe sent no list. Never the messages: read them in **Developers › Logs**. Tell the developers which fields.

**Retrying after fixing the setup works at once.** Daybell's key is fixed per studio
(`daybell-payout-account-v2b-{studio}` since step 7c; it was `daybell-payout-account-v2-{studio}`, but the request body
changed when `contact_email` was added, and Stripe may refuse a reused key whose earlier request had different
parameters with an `idempotency_error`). Accounts v2 handles idempotency keys differently from v1
(https://docs.stripe.com/api-v2-overview): v1 keeps a key's first answer, even an error, for 24 hours and replays it
(that is what happened with the v1 refusal); v2 replays a *successful* request for 30 days but re-executes a request
that failed. So once the platform setup is fixed, the same studio's next click creates the account.

Other alert lines (the studio id only, never the Stripe id):
- `stripe_account_create_unknown <studio>`: the create timed out or Stripe answered 5xx, so an account may exist. The
  owner's next click gets the same account (same key, within 30 days). If nobody retries, find the account in the
  Stripe Dashboard by its `daybell_studio_id` metadata.
- `stripe_account_create_conflict <studio>`: Stripe refused the create as an idempotency conflict (the studio's key was
  used before with other parameters, e.g. the owner's email changed after a failed try). Retrying won't help; the owner
  sees "Payout setup needs Daybell support to finish." Find the account (if any) by its `daybell_studio_id` metadata
  and finish the setup (ADR 0020 section 16).
- `stripe_account_unrecorded <studio>`: Stripe made the account but Daybell couldn't read it back or record it. The same
  applies: the next click records it; otherwise support finds it by its metadata.
- `stripe_schedule_default_failed`: the account is recorded but its default schedule couldn't be set. Refresh (coming
  back from Stripe) and the next account webhook try again; nothing to do unless it keeps appearing.
