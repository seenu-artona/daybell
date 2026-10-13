# 0020 — Payouts with Stripe Connect

- Status: Accepted with the step 7 PR. Amended Oct 12, 2026 by step 7b (section 16: accounts are created with Stripe
  Accounts v2) and by step 7c (section 16, "Contact email": the owner's sign-in email is sent as the account's contact
  email; Q4 changed by Seenu; proposed until Seenu merges that PR).
- Amends:
  - 0017: onboarding gains "Set up payouts".
  - 0016: the region guard gains `PAYOUT_REGIONS`.
  - 0019: the onboarding order becomes account, payouts, price list, first job (D143).
- Decisions implemented: D56, D98, D106, D143, D96, D113, D92.
- Decisions touched: D104, D59, D125, D91, D112, D10.
- Inputs: Seenu's answers 1–4 to the step 7 brief, his answers Q1, Q2, Q3, Q5 and Q6, Claude's calls Q0, Q4 and
  Q7–Q17 (Oct 12, 2026; for Seenu to review), Seenu's answer to code review MF1 (Oct 12: one checklist for every
  studio), and the step 7 security and code reviews.

## Context

Phase 1 step 7: "Stripe Connect onboarding in Settings with Stripe-managed accounts; weekly payouts by default; fees
shown". Phase 1's goal is "Connects payouts (Stripe, test mode)".

Seenu's answers:
1. Only the owner connects or changes payouts. Admins read. Photographers and staff don't see Payouts.
2. Onboarding is on Stripe's hosted pages (Account Links), coming back to Daybell.
3. Schedules are weekly (the default), daily or monthly.
4. Settings › Payouts shows status, next payout, recent payouts and the fees. Nothing goes on Home.

## 1. Stripe configuration

> **Superseded for account creation by section 16** (Stripe refuses Accounts v1 creation for new Connect platforms).
> The responsibilities below are unchanged; they are now expressed in Accounts v2 terms.

**Accounts v1 with `controller` properties (Seenu, Q1).** stripe-node marks `type` as deprecated in favour of
`controller`. Every studio account is created with:
- `controller.requirement_collection: "stripe"`: Stripe collects and verifies requirements.
- `controller.losses.payments: "application"`: Daybell carries negative balances.
- `controller.fees.payer: "application"`: Daybell pays Stripe's fees and passes them on (D98).
- `controller.stripe_dashboard.type: "express"` (Q2): the studio gets the Express dashboard, used to change the bank
  account.
- `country: "CA"`, and capabilities `card_payments` and `transfers` (D106's destination charges `on_behalf_of` for
  Canada).
- `metadata`: `daybell_studio_id` and `daybell_region`.
- A default schedule: weekly, Friday, with Stripe's own delay.
- No name, email or business details are prefilled (Q4). *Changed by Seenu in step 7c (section 16, "Contact email"):
  the owner's sign-in email is sent as the v2 account's `contact_email`, which Stripe requires.*

The brief's "Stripe handles losses" is superseded by Q1.

**Package and API version.**
- `stripe` **22.6.2**, published Sep 9, 2026, pinned exactly. It is the newest release at least two weeks old;
  23.0.0 came out Oct 1.
- `apiVersion: "2026-08-26.dahlia"`, that package's own default, pinned in code (`STRIPE_API_VERSION`).
- Seenu's sandbox webhook destination uses `2026-09-30.endive`. That difference is harmless here: the webhook reads the
  account or payout from Stripe again with the pinned version. Line the destination up with the code when the package
  is upgraded (docs/stripe-staging.md).
- Client options: `maxNetworkRetries: 2`, a 10-second timeout, telemetry off.

**Facts checked (Q0).** docs.stripe.com could not be fetched from the build environment (the outbound proxy refused
every request to `docs.stripe.com`). Following the instruction for that case, the facts were checked against the
TypeScript declarations and JSDoc shipped in stripe-node 22.6.2, which are generated from Stripe's OpenAPI spec
(`OPENAPI_VERSION` v2442):

| Fact | Checked in stripe-node 22.6.2 | Finding |
|---|---|---|
| Controller properties and their values | `resources/Accounts.d.ts`, `AccountCreateParams.Controller` | `requirement_collection: application \| stripe`; `losses.payments: application \| stripe`; `fees.payer: account \| application`; `stripe_dashboard.type: express \| full \| none`. `type` is deprecated in favour of `controller`. |
| That the Q1 combination is allowed | Not in the types | Seenu confirmed it against https://docs.stripe.com/connect/migrate-to-controller-properties |
| Capabilities | `AccountCreateParams.capabilities` | Required only when the dashboard is `none`; Daybell requests both anyway. |
| Account Links | `resources/AccountLinks.d.ts` | URLs are single-use. `refresh_url` is used when a link has expired or was already visited. `return_url` is used when the user leaves *or* completes the flow, so Daybell checks the status on return. `account_update` is not allowed for accounts with a Stripe-hosted dashboard, so "Continue" and "Update details" both use `account_onboarding`. `expires_at` is returned. |
| Login links | `Accounts.createLoginLink` | Only for accounts using the Express dashboard. |
| Payout schedule | `AccountUpdateParams.Settings.Payouts.Schedule` | `interval` is `daily`, `manual`, `weekly` or `monthly`. `weekly_anchor` can be any day of the week. `monthly_anchor` is 1–31, and 29–31 fall on the last day of shorter months (Q6). `delay_days` defaults to `minimum`. The platform sets these with `accounts.update`. |
| Requirements | `Account.Requirements` | `currently_due`, `past_due` and `pending_verification` are lists. `disabled_reason` is an enum (`requirements.past_due`, `requirements.pending_verification`, `rejected.*`, `listed`, `platform_paused`, `under_review`, `other`, `action_required.requested_capabilities`). `current_deadline` is a timestamp. |
| Payout fields | `resources/Payouts.d.ts` | `status` is `pending`, `in_transit`, `paid`, `failed` or `canceled`, and paid can later become failed. `method` is `standard` or `instant`. Also `automatic`, `arrival_date`, `failure_code`. Read on a connected account with `stripeContext`. |
| Connect events | `resources/Events.d.ts` | `event.account` is "the connected account that originates the event". All 7 handled types exist. |
| Webhook signatures | `Webhooks.js` | `constructEvent` defaults to a 300-second tolerance. `generateTestHeaderString` signs test bodies. |
| Accounts v2 | `resources/V2/Core/Accounts` | Present in the SDK. Its GA status and Canadian coverage could not be checked. v1 is kept per Q1. |

**Not checked, from memory only. Seenu or a later agent should confirm these on docs.stripe.com:**
- Webhook retry window (up to 3 days in live mode): https://docs.stripe.com/webhooks
- Instant payouts in Canada: https://docs.stripe.com/connect/instant-payouts
- Canadian test bank numbers and test onboarding data: https://docs.stripe.com/connect/testing
- Cross-border US accounts on a Canadian platform: https://docs.stripe.com/connect/cross-border-payouts
- Pricing for active accounts, payouts and instant payouts: https://stripe.com/connect/pricing
- Hosted onboarding: https://docs.stripe.com/connect/hosted-onboarding
- Payout schedules: https://docs.stripe.com/connect/manage-payout-schedule
- Destination charges: https://docs.stripe.com/connect/destination-charges

## 2. Canada only in Phase 1 (Q3)

- `PAYOUT_REGIONS = ["ca"]`. `assertPayoutRegion` refuses US studios with `region_unavailable` ("Payouts aren't
  available in this region yet"). That refusal is the **only** regional difference.
- **One checklist for every studio** (Seenu, Oct 12, answering code review MF1: "keep it same for everyone, I do not
  want to maintain two codes"). "Set up payouts" is in every studio's onboarding and "Payouts connected" behaves the
  same everywhere. A US studio's "Set up payouts" links to Settings › Payouts, which shows the region message, so its
  onboarding stays open until US payouts exist; its Start selling dialog shows "Payouts connected: To do".
- Follow-up: confirm D106's US setup with Stripe and an adviser before US launch.

## 3. Data

Forward migration `20261012300000_payouts.sql`.

**`payout_accounts`** (one per studio):
- `studio_id` is unique and **on delete restrict**: a studio with a Stripe account is closed, never deleted (D125,
  Q16).
- `stripe_account_id` (unique, `acct_…`), `country` (must match the studio's region), `livemode`.
- Flags: details submitted, charges enabled, payouts enabled.
- Stripe's `disabled_reason` code, the counts of currently due, past due and pending verification, and the deadline.
- `status`, plus the schedule: interval, `weekly_anchor`, `monthly_anchor`, `delay_days`.
- `stripe_fetched_at`: when Daybell asked Stripe for the copy (taken just before the call).
- A composite key `(studio_id, id)` for payouts.

**`payouts`**:
- `stripe_payout_id` (unique, `po_…`) and a composite FK to the studio's own account.
- `amount_cents bigint` (≥ 0) and `currency`, which must be the region's currency (CAD for Canada, D106).
- `status`, `method`, `automatic`, `arrival_date`, `failure_code`, `stripe_created_at`, `stripe_fetched_at`.

**`stripe_events`** (the webhook inbox, D96):
- The event id (unique), type, account, studio, livemode and times.
- A two-minute processing lease with a `lease_token`, `attempts`, and `last_error` (a code name only).
- Never the payload.

**`stripe_call_budget`** (the per-studio rate limit, security review N1): one row per studio with the current
minute's start and its count of calls to Stripe. Ids and counts only; no policy and no grant.

**Never kept anywhere:** bank details, last-4 digits, external account ids, names, emails, addresses, descriptions,
statement descriptors or trace ids.

**Enums** mirror Stripe:
- `payout_interval` includes `manual` (Stripe pays out only when asked, not on a schedule). It is never offered; the
  screens call it neutrally "Manual payouts" (code review N7), not "Paused by Stripe": Stripe pausing an account shows
  as Restricted or Pending verification through `payouts_enabled`.
- `payout_weekday` has all seven days, so a sync can never fail on a weekend. Studios pick Monday to Friday.
- A test keeps core's lists equal to the SQL enums.

**Access:**
- Row-level security: owners and admins read `payout_accounts` and `payouts`. Nobody else reads anything.
- `stripe_events` and `stripe_call_budget` have no policy and no grant.
- Browsers have no insert, update or delete on any of the three tables.

**Functions** are SECURITY DEFINER with an empty `search_path`, and only the service role may execute them.

Owner actions (`app.act_for_owner` = `app.act_for` plus an owner check, refusing with 42501 before anything is read):
- `create_payout_account`: idempotent for the same account; `already_connected` for another one.
- `set_payout_schedule`: `not_connected` if there is no account; skipped if a newer copy was saved meanwhile.

System functions (the webhook, and the routes after their own role checks):
- `record_stripe_event`: inserts once; returns null for an unknown account; claims a two-minute lease and returns its
  `lease` token.
- `finish_stripe_event(inbox, lease, code, permanent)`: only the delivery holding the lease can finish the event, so a
  delivery whose lease ran out can't clear the lease of the one that took over (security review N2). It returns false
  when the lease isn't its own. `permanent` marks an event that can never succeed as processed, with its code.
- `sync_payout_account` and `sync_payout`: each takes `p_fetched_at`. **An answer older than the saved copy is
  skipped** (security review N2), so two events processed at once can't leave `in_transit` after `paid`: the row is
  updated only where `stripe_fetched_at <= p_fetched_at`. A sync that changes nothing still moves
  `stripe_fetched_at` on (so a later stale answer is skipped too), but writes no event.
- `sync_payout` upserts in the account's own studio and refuses a payout id that moves to another account.
- `take_stripe_call(studio, limit)`: counts one call to Stripe in the studio's current minute; false over the limit.

**Deviations from the plan.**
- The plan locked the inbox row with `for update skip locked`. That lock would end with `record_stripe_event`'s own
  transaction, because each RPC is its own transaction. The lease column (with its token) does what the plan meant.
- The plan's `stripe_synced_at` is back as `stripe_fetched_at`, for skip-older writes. A per-account advisory lock
  was not used: Stripe is read outside the database transaction, so a lock can't order two answers; comparing the
  time each was asked for can.

**Tests.** pgTAP `015_payouts` (121 tests) and `016_payouts_canada` (5 tests) cover:
- reads by every role and by anon
- grants and execute rights
- the owner-only functions (admins, photographers, staff, another studio's owner and nobody get 42501)
- unique ids and format checks, the composite FK, country and currency
- duplicate events, leases and their tokens (a lapsed delivery can't finish or clear the new lease), failures,
  permanent failures and retries
- older answers skipped for accounts, payouts and the schedule
- the Stripe call budget (per studio, per minute, limit checked, browsers can't spend it)
- syncs that change nothing, events with ids only, and studio deletion restricted

## 4. Webhooks (`POST /api/v1/webhooks/stripe`)

The steps, in order:
1. Read the raw body, at most 512 KB.
2. Verify `Stripe-Signature` against one or two `STRIPE_WEBHOOK_SECRET`s.
3. Refuse a mode (live or test) that doesn't match the key.
4. Acknowledge other types and platform events (no `account`) with 200, storing nothing.
5. **Check the function region before any Stripe call** (security review M1; D113): `assertPayoutFunctionRegion`
   refuses with `region_unavailable` unless `VERCEL_REGION` is a payout region's function region (yul1 in Phase 1).
   `accounts.retrieve` returns the whole account, which can hold the owner's personal data, so it must never be
   fetched into a US function.
6. **Read the account from Stripe again**, noting the time it was asked.
7. Route by `metadata.daybell_region` if it is a payout region, otherwise Canada (Q11).
8. Run `assertFunctionRegion` for that region as well.
9. Call `record_stripe_event`:
   - unknown account: 404, so Stripe retries (this covers the race with account creation)
   - lease held by another delivery: 409
   - already processed: 200
10. **Backstop** (security review N3): if `metadata.daybell_studio_id` isn't the studio the database maps the account
    to, nothing is copied and the fixed line `stripe_webhook_studio_mismatch` is logged. The database's mapping is what
    is used either way.
11. Read the payout from Stripe again (for payout events), then sync with the time each object was asked for.
12. Call `finish_stripe_event` with the lease. If the lease was taken over meanwhile: 409.
13. Failures (security review N6):
    - **Retryable** (`stripe_unavailable`, `sync_failed`): recorded and answered 500, so Stripe retries.
    - **Permanent** (`payout_currency`, `payout_mismatch`, `payout_fixed`, `payout_account_fixed`, `payout_country`,
      `unexpected_object` such as an unknown interval or monthly with no day, `studio_mismatch`): marked processed
      with the code, answered 200 so Stripe stops retrying, and logged as `stripe_webhook_permanent_failure` with the
      event type and code, for an alert.

Handled events: `account.updated`, `capability.updated`, `payout.created`, `payout.updated`, `payout.paid`,
`payout.failed`, `payout.canceled`.

Logs hold fixed names and the event type only. No cron and no Trigger.dev: Stripe's retries are the queue.

## 5. Return-and-refresh

`POST /studio/payouts/refresh` (owners and admins) reads the account from Stripe and syncs it. The page calls it on
`?stripe=return`, so the status is right when a webhook is late.

`?stripe=refresh` (an expired link) shows a note. The owner continues with the same button. There is no automatic
redirect, so focus stays predictable. The e2e test covers it (code review MF3).

Coming Back from Stripe can restore the page from the browser's back-forward cache with "Opening Stripe…" still
showing; a persisted `pageshow` resets it (code review N2).

**Deployments without Stripe** (PR previews, `STRIPE_DRIVER` unset; Q13): the Stripe routes answer
`region_unavailable` with `fields.form = "payouts.notConfigured"`, and the page says "Payouts aren't set up in this
environment", not the region message (code review N12).

## 5a. Limits on calls to Stripe (security review N1)

`refresh`, `onboarding-link`, `dashboard-link` and `schedule` each make one to four Stripe calls (since section 16 the
first `onboarding-link` creates, reads back, sets the schedule and links; `refresh` may set the default schedule).
Together they may run
at most **10 times a minute per studio** (`STRIPE_CALLS_PER_MINUTE`); the next answers 429 `rate_limited` and calls
nothing. The count is kept in the studio's own regional database (`take_stripe_call`, fixed one-minute windows), so it
holds across serverless instances with no extra service. It is taken after the role and region checks, so refused
requests don't spend it, and the GET never does. Stripe's own webhooks aren't limited.

## 5b. Stripe links (security review N5)

The API returns a link only if it starts with `https://connect.stripe.com/` (real driver) or with this deployment's
`siteUrl()` (fake driver). Anything else is refused with a fixed log line, so the browser never follows an unexpected
address.

## 6. Status rule (`payoutAccountStatus`, pure, in core)

In this order:
1. **restricted** if `disabled_reason` is `rejected.*`, `listed`, `platform_paused` or `other`.
2. **active** if charges and payouts are enabled and nothing is due or past due.
3. **needs_info** if details are not submitted.
4. **restricted** if something is past due after submission.
5. **needs_info** if something is due (or Stripe asks for capabilities).
6. **pending_verification** otherwise.

"Not started" means there is no row.

The plan's "was active, payouts no longer enabled → restricted" isn't used. It needs the previous status, and the rule
must give the same answer for the same facts. Such an account shows Pending verification, or Restricted once Stripe
sets a reason or something is past due.

## 7. Schedule (Q6)

- The owner chooses weekly on a weekday (Friday by default), daily, or monthly on a date (the 1st by default).
- Stripe's delay is kept.
- `PUT /studio/payouts/schedule` changes Stripe first, then saves what Stripe answered.
- "Next payout" is the schedule's next day (UTC, today included) plus any pending or in-transit payouts. It is computed
  from Daybell's copy, with no balance call (Q9).

## 8. Fees (Q8)

- Daybell's 3% of product sales, nothing if nothing sells, never on shipping or tax (D59).
- Stripe's card fees and Connect payout fees (per payout and per monthly active account), passed on at Stripe's rates
  (D98).
- Instant payouts "at Stripe's fee", coming later (Q7).
- The figures are in `packages/config/src/payout-fees.ts`, marked `confirmed: false`. They are **placeholders** for
  Seenu to confirm against Daybell's Stripe pricing.
- How payout fees are charged to studios is decided in step 10 / Phase 3.

## 9. Checklist (D143, Q5)

- Onboarding is now account, **Set up payouts**, price list, first job.
- "Set up payouts" links to Settings › Payouts for the owner and is plain text for admins.
- It ticks only when the account is Active.
- The Start selling dialog's "Payouts connected" is real (it fetches `GET /studio/payouts` each time it opens, says
  "Checking…" until the answer arrives, and ignores an answer that comes after the dialog closed; code review N3).
  Any refusal, including a US studio's, counts as not connected. Only "Photos uploaded" stays "Coming soon".
- The same for every studio (Seenu, Oct 12; section 2).
- No job checklist task, because photographers would see it.
- Studios already onboarded never see the new task.

## 10. Events (D96)

- `payout_account.created {country}`: the actor is the owner.
- `payout_account.status_changed {from, to}`: no actor when Stripe caused it.
- `payout_account.schedule_changed {from, to}`: intervals only. It is written for any change of interval, anchor or
  delay.
- `payout.created {status, method}`.
- `payout.status_changed {from, to}`.
- No Stripe ids or amounts in events. A sync that changes nothing writes nothing.
- Fact changes that don't change the status (e.g. a count) write no event, as planned.
- The activity log doesn't show these yet (Q15).
- There are no ledger entries (Q10).

## 11. Region and privacy (D113)

- Payout routes run in yul1 with `assertFunctionRegion`.
- Data stays in the studio's regional database.
- Stripe is the payment processor (already decided). Only the country and Daybell's ids are sent when an account is
  created, plus the owner's sign-in email as its contact email since step 7c (section 16, "Contact email").
- The webhook checks the function region before any Stripe call (section 4, step 5).
- Account Link and login link URLs are never logged or stored, and must be Stripe's own (section 5b).
- Stripe errors are logged by error type only.
- `stripe_account_unrecorded` logs the studio id only (section 14, orphans).

## 12. The fake driver

`STRIPE_DRIVER=fake` keeps accounts and payouts in the server process's memory (on `globalThis`, which suits one
`next start`). Its hosted onboarding is `/dev/stripe-onboarding`.

`/api/dev-stripe` acts only on the signed-in owner's own studio's account. It has three actions:
- `finish`
- `leave`
- `payoutPaid`

It tells Daybell through the real webhook handler, with a correctly signed event (`generateTestHeaderString`).

Refused on Vercel three ways:
- `next.config.ts` fails the build.
- `stripeSettings()` throws at run time.
- The dev page and route answer 404. Tests check both answer 404 (the route before sign-in or the webhook) on Vercel,
  with `STRIPE_DRIVER=stripe` and with it unset (security review M2).

CI and e2e use it only (Q12): there is no Stripe key in CI.

## 13. Environment

Variables:
- `STRIPE_DRIVER` (`stripe` | `fake`; unset means payouts aren't set up here).
- `STRIPE_SECRET_KEY`: test key only outside `VERCEL_ENV=production`.
- `STRIPE_WEBHOOK_SECRET`: one or two `whsec_` values.

Where they are set:
- Declared in `packages/config` and in turbo's build env (`STRIPE_DRIVER`).
- CI sets `fake` and a random masked secret per run.
- On Vercel: Preview, branch `main` only (staging; Q13).

Setup steps are in `docs/stripe-staging.md`.

## 14. Follow-ups

- Instant payouts (Q7).
- US payouts (Q3).
- A ledger for payouts (Q10).
- Payout events in the activity log (Q15).
- Pruning processed inbox rows after 90 days (Q17).
- Statement descriptor (D104, step 10; Q14).
- How payout fees are charged (step 10 / Phase 3).
- Confirming the fee figures.
- Confirming the unchecked Stripe facts above.
- Disconnecting or replacing an account (support only, Q16).
- Aligning the webhook destination's API version with the pinned one.
- Orphans (security review N4): if a create succeeds at Stripe but the database write fails, the retry uses the same
  idempotency key, but only within Stripe's idempotency window (24 hours on v1; 30 days for the v2 create since
  section 16, https://docs.stripe.com/api-v2-overview). The route now logs the fixed line
  `stripe_account_unrecorded` with the studio id (never the Stripe id), which support matches to the account's
  `daybell_studio_id` metadata on Stripe. A runbook step to record or close such accounts is a follow-up.
- US studios: onboarding stays open until US payouts exist (Seenu, Oct 12). When they launch, nothing else is needed:
  the same task ticks once the account is Active.
- Before Phase 3 (security review, info 8): decide whether production (`VERCEL_ENV=production`) should refuse a
  test-mode key. Today `stripeSettings` accepts either there; harmless while production has no Stripe variables.
- Rotation runbook (security review, info 9): the Vercel deployment-protection bypass token is part of the Stripe
  webhook endpoint's URL (docs/stripe-staging.md, section 3), as for the image worker. Add it to the rotation runbook:
  rotating the token means updating the endpoint URL in the Stripe Dashboard.

## 15. Rejected

- Storing the webhook payload: it holds personal data.
- Fetching payouts live on every page view: a Stripe call per view, and no copy for later steps or the API.
- stripe-mock in CI: it is stateless and doesn't cover Connect flows.
- Trusting the payload's ordering.
- Browsers writing payout rows.
- A job checklist task for payouts: photographers would see it.
- ~~Accounts v2: its availability for Canadian platforms couldn't be checked, and Q1 chose v1 with controller
  properties.~~ Reversed by section 16: Stripe refuses v1 account creation for new platforms.

## 16. Amendment (step 7b, Oct 12, 2026): accounts created with Stripe Accounts v2

Decisions: D106, D56, D113, D96. Seenu chose to rebuild on Accounts v2.

**Why.** On staging, `POST /v1/accounts` answered 400: Stripe no longer recommends Accounts v1 for new Connect
integrations and asks for `POST /v2/core/accounts`, unless v1 support is switched on in the Dashboard for a supported
compatibility case (none applies to Daybell). The v1 limits that would keep an integration on v1 (OAuth, the recipient
service agreement, Treasury or Issuing, deprecated capabilities) don't apply either.

**New idempotency key.** API v1 keeps a key's first answer, even an error, for 24 hours, so
`daybell-payout-account-{studio}` would replay that 400. The key is now `daybell-payout-account-v2-{studio}`. API v2
behaves differently (https://docs.stripe.com/api-v2-overview, checked by the orchestrator on Oct 12): "All POST and
DELETE API v2 requests accept idempotency keys and behave idempotently"; a replay is the same key, API and account
"within 30 days"; and "if the first request failed (or partially failed), the API re-executes the failed requests and
returns the new response", whereas "API v1 always returns the previously-saved response of the first API request, even
if it was an error". So a refused v2 create doesn't lock the studio out: once the cause is fixed, the next click with
the same key creates the account. A successful create is replayed (same account) for 30 days. No key rotation is
needed, and none is built (it would risk a second account per studio; security review 2).

**The account** (`POST /v2/core/accounts`, `stripe.v2.core.accounts.create` in stripe-node 22.6.2, which has it in its
types; no package change):
- `identity.country: "ca"` and `defaults.currency: "cad"` (the studio's region; Canada only in Phase 1).
- `dashboard: "express"` (Q2).
- `defaults.responsibilities: { fees_collector: "application", losses_collector: "application" }`. Stripe computes
  `requirements_collector` as `stripe` (it is `application` only with losses on the platform and no dashboard). This is
  exactly Seenu's Q1 combination (Stripe collects requirements; Daybell carries losses and pays Stripe's fees, passed on
  per D98). `dashboard: "express"` requires both responsibilities on the application, and Stripe recommends that for
  destination charges.
- `configuration.merchant.capabilities.card_payments.requested` (the Canadian studio is the merchant of record with
  D106's destination charges `on_behalf_of`) and `configuration.recipient.capabilities.stripe_balance.stripe_transfers
  .requested` (v2's name for v1 `transfers`, needed for destination charges in step 10).
- `metadata`: `daybell_studio_id`, `daybell_region`. No name, email or business details (Q4). The owner's email is
  sent as `contact_email` only, since step 7c (below).
- The v2 create can't set a payout schedule, and the create is the only thing `createAccount` does: it returns the new
  account's id (security review 1). The route then reads the account back through v1, records it
  (`create_payout_account`), and only then sets Daybell's default schedule (weekly on Friday; D56, Q6) through v1 as
  its own step, saving Stripe's answer with `sync_payout_account`. If the schedule step fails, the account is still
  recorded and the owner still gets their link; the next click finds the recorded account and never creates again.
  Every schedule Daybell sets (the default or the owner's) also writes `daybell_schedule_set: "true"` to the account's
  metadata (v1 metadata updates merge keys). Refresh and the account webhooks set the default on any account without
  that key, so a failed first try is retried, and a schedule the owner chose is never overwritten. (A webhook setting
  the default at the same moment as the owner's very first schedule change could overwrite it; the owner sees the
  result and can change it again. Accepted.)
- Anything that stops Daybell recording an account Stripe made (reading it back, or the database write) logs
  `stripe_account_unrecorded` with the studio id (as in section 14). A create whose outcome is unknown (a 5xx, a
  timeout, a lost connection, an idempotency conflict) logs `stripe_account_create_unknown` with the studio id: an
  account may exist, and the next click gets it back with the same key (within 30 days).

**Which endpoints are v2 and which v1.** Stripe documents that a v2 account's id works on Accounts v1 endpoints: "the
response is structured as a v1 Account, but any updates still apply to the v2 object".

| Call | Endpoint | Why |
|---|---|---|
| Create the account | v2 `accounts.create` | v1 creation is refused. |
| Onboarding links | v2 `accountLinks.create`, `use_case.type: account_onboarding`, `configurations: [merchant, recipient]` | In stripe-node 22.6.2's types. `expires_at` is RFC 3339 there and is turned into seconds. "Update details" also uses `account_onboarding`, as before. |
| Status sync (refresh and webhooks) | v1 `accounts.retrieve` | One call gives every fact Daybell keeps (flags, requirements counts, `disabled_reason`, deadline, schedule, metadata), so `accountFacts`, `accountSchedule` and `payoutAccountStatus` are unchanged. A v2 read has no schedule and a different requirements shape: it would need a second call (a second Stripe call per event and per refresh) and a new mapping. |
| Payout schedule | v1 `accounts.update` (`settings.payouts.schedule`) | Accounts v2 has no payout settings in stripe-node 22.6.2. |
| Login link ("Manage on Stripe") | v1 `accounts.createLoginLink` | No v2 equivalent in stripe-node 22.6.2. |
| Payouts | v1 `payouts.retrieve` on the connected account | Payouts aren't part of Accounts. |

The status rule, the facts mapping, the database functions and the screens are unchanged.

**Errors.** The driver now logs `stripe_error` with the **stage** (`create`, `schedule` or `other`), Stripe's error
**class, raw type and code** (never the message or the request), so staging failures can be told apart; a raw type or
code that isn't a lower-case identifier is logged as `other`, a missing one as `none`. v2 errors may carry their reason
in the raw type rather than the code (stripe-node's `generateV2Error`; security review 3), so both are matched. Every
Stripe failure is a `StripeCallError` (an `ApiError` with server-only `stage` and `outcome`; code review S1): `refused`
when Stripe refused the request outright (invalid request, authentication, permission, rate limit: nothing was made),
otherwise `unknown` (5xx, timeout or lost connection, an idempotency conflict, anything else: it may have taken
effect). These codes mean Daybell's own platform setup isn't finished and are answered with
`fields.form = "payouts.platformSetup"`, which the page shows as "Daybell’s platform setup with Stripe isn’t finished
yet, so payouts can’t be set up. Please contact Daybell support." (locale key `app.payouts.platformSetup`; code review
N2: only Daybell can fix them, so the owner isn't told to try again): `account_creation_liability_unacknowledged`,
`connect_profile_not_submitted`,
`account_create_activation_required`, `accounts_v2_access_blocked`, `capability_not_available_in_country` and
`cross_border_connected_account_creation_not_allowed`. Anything else stays "We couldn't reach Stripe".

**Links.** `assertStripeLink` is unchanged (`https://connect.stripe.com/` only). An unexpected link is now logged with
its host when the host is Stripe's (e.g. `connect.stripe.com` over http), otherwise `other`; never the address. If
Stripe's v2 links turn out to use another Stripe host, the log line says which.

**Webhooks.** Whether Stripe sends v1 snapshot events (`account.updated`, `capability.updated`) for accounts created
with v2 could not be checked. Both are supported:
- The v1 snapshot destination stays as it is (7 events, payouts included).
- A second destination with the **thin** payload style sends v2 account events to the same address. Handled:
  `v2.core.account.updated`, `v2.core.account[requirements].updated`,
  `v2.core.account[configuration.merchant].updated`, `v2.core.account[configuration.merchant].capability_status_updated`,
  `v2.core.account[configuration.recipient].updated` and
  `v2.core.account[configuration.recipient].capability_status_updated`. Other thin events are acknowledged and stored
  nowhere.
- A thin event whose `context` names an account (`acct_…`) must name the same one as `related_object`, and every event's
  time must be within a year of now; otherwise the event is refused with 400 (security review 5 and 7).
- The same rules apply to both: the signature is checked with stripe-node's own `webhooks.signature.verifyHeader` and
  its default five-minute tolerance (what `constructEvent` and `parseEventNotification` both call), the body's
  `object` (`event` or `v2.core.event`) says which style it is, the mode must match the key, the account id comes from
  `related_object` (only when its type is `v2.core.account`), the function region is checked before any Stripe call,
  the account is read again through v1 (the thin event's `fetchRelatedObject` is never used), and the inbox records
  the event once by its id. Ids, the type and the time only.
- `STRIPE_WEBHOOK_SECRET` takes one to four secrets: one per destination, plus one for each during a rotation. The same
  secret twice is refused, so pasting one destination's secret twice is caught (security review 8).
- Getting both a v1 and a v2 event for one change is harmless: each is a separate inbox row, the second read changes
  nothing, and a sync that changes nothing writes no event.

**Data.** Forward migration `20261012400000_stripe_thin_events.sql` changes two checks on `stripe_events`: the type
must be one of the 13 the webhook handles (an allowlist, not a pattern, so nothing else can be stored; security review
4; a unit test keeps it equal to `HANDLED_EVENTS` and `HANDLED_THIN_EVENTS`), and event ids may hold underscores (v2
ids such as `evt_test_…`), still anchored and length-capped. pgTAP `017_stripe_thin_events` (16 tests): v2 events are
recorded once for the account's own studio, a v2 event id never moves to another studio's account, every handled type
is accepted, and free text, lower-case names (`v2.core.account[maya_johnson].updated`, `john.smith`), unhandled Stripe
types and trailing text are refused. No new column or table: the schedule marker lives in Stripe's metadata.

**Not checked (follow-ups).**
- Whether v1 snapshot events fire for v2-created accounts (section 16 supports both).
- The exact host of v2 Account Link URLs (assumed `connect.stripe.com`, as for v1).
- The restricted-key permission names for the v2 endpoints, if Seenu uses a restricted key.
- The exact shape of v2 event ids (underscores allowed to be safe).
- That Stripe enables payouts (`stripe_balance.payouts`) on an account created this way once onboarding is complete:
  the v2 create params in stripe-node 22.6.2 can't request it (it appears only on the response). The staging smoke test
  checks `payouts_enabled` after onboarding (docs/stripe-staging.md, section 5; code review S2).
- Whether Stripe's v1 `accounts.update` accepts the payout schedule (and metadata) on a v2 account with
  `losses_collector: application` (security review 1). If it refuses, accounts are still recorded; the
  `stripe_schedule_default_failed` line and the staging smoke test show it.
- Which v2 errors carry the platform-setup reason in `code` and which in the raw `type` (both are matched and logged).
- Idempotency (settled, not open): v2 re-executes failed requests and replays successful ones for 30 days
  (https://docs.stripe.com/api-v2-overview), so a refused create doesn't lock a studio out and no key rotation is
  built.

**Contact email (step 7c, Oct 12, 2026; D106, D113).** On staging, `POST /v2/core/accounts` answered 400
`invalid_fields`: "If configuration.recipient is supplied, the Account must have a contact email." **Q4 changed by
Seenu:** Claude's call "country only, no email" is replaced; the create sends the studio owner's sign-in email as
`contact_email`.
- Where it comes from: the verified Supabase auth user of the session, read by `userEmail(supabase)` in
  `apps/web/lib/studio.ts` (`getUser()`; `user.email` only, never `user_metadata` or the request body; `""` or missing
  is null). `studioScope()` doesn't carry the email (security review N2): only the onboarding link calls `userEmail`,
  after the owner check (`assertCanManagePayouts`) and only when it is about to create the account. If the sign-in has
  no email, the route answers 409 `conflict` with `fields.form = "payouts.noContactEmail"` (locale key
  `app.payouts.noContactEmail`, whose words the API message matches) and Stripe isn't called.
- Where it never goes: logs, events, URLs, Sentry, Stripe metadata, the idempotency key, Daybell's database. The fake
  driver accepts it and ignores it. Tests assert that the email is in the create body and in no console call.
- **Privacy.** The email is personal data about the studio owner (an adult business contact, not a child). Seenu
  explicitly accepted (Oct 12, 2026) sending it to Stripe as Daybell's payment processor (D106) under D113, for the
  account Stripe holds for that studio, for both regions. No data is copied to any other service.
- **New idempotency key: `daybell-payout-account-v2b-{studio}`.** API v2 re-executes a failed request and replays a
  successful one, but the request body changed (it now has `contact_email`). Reusing `-v2-` for a studio that already
  tried could be refused with an `idempotency_error` for mismatched parameters, which the driver treats as an unknown
  outcome. The `-v2-` creates on staging were refused (that is this step's cause), so as far as known no account exists
  under the old key and the new key doesn't make a second one; if one did, `stripe_account_create_unknown` and the
  account's `daybell_studio_id` metadata would show it. The key holds the studio id only, never the email.
- **Idempotency conflicts (security review N1).** The key stays studio-id only. So a retry after the owner's email
  changed (or after the studio's owner changed) sends different parameters under the same key, and Stripe may refuse
  it as an idempotency error. On the create, the driver turns `StripeIdempotencyError` into a `StripeCallError`
  (outcome `unknown`) with `fields.form = "payouts.createConflict"` and the message "Payout setup needs Daybell support
  to finish." (locale key `app.payouts.createConflict`, same words, en-US and en-CA); the route logs
  `stripe_account_create_conflict <studioId>` instead of `stripe_account_create_unknown`. Support finds the account on
  Stripe by its `daybell_studio_id` metadata and finishes the setup. The same error on any other call is the general
  one. Stripe's `contact_email` is set once at create: it isn't updated if the studio's owner changes later.
- **`invalid_fields` errors.** As well as the `stripe_error` line, the driver logs
  `stripe_invalid_fields <stage> <names>` when the code or raw type is `invalid_fields`: the `field` of each entry in
  Stripe's `invalid_fields` list, each matched against `^[a-z0-9_.\[\]]{1,100}$` or logged as `other`, at most 20,
  without repeats; `none` without a list. Never the messages (they can echo request data). The shape of the list (an
  array of `{ field, message }` on the raw error) is assumed: stripe-node 22.6.2 maps code `invalid_fields` to
  `StripeInvalidRequestError` but doesn't declare the list. Anything else is logged as `none` or `other` (follow-up:
  confirm on the next staging refusal). The error is a refusal (`StripeInvalidRequestError`):
  nothing was made.
- **Follow-ups (contact email).**
  - Keep Stripe's `contact_email` in step with the owner once ownership transfer exists (update the v2 account when the
    owner changes).
  - When Sentry is added: scrub emails (and the rest of the personal data) before events leave the app, and check the
    onboarding route's errors carry none (security review N4).
  - List Stripe as a sub-processor in the privacy policy (PIPEDA; security review N5).

**Sources** (fetched Oct 12, 2026 by the orchestrator; checked here against stripe-node 22.6.2's types:
`resources/V2/Core/Accounts.d.ts`, `resources/V2/Core/AccountLinks.d.ts`, `resources/V2/Core/Events.d.ts`,
`Webhooks.js`, `Error.js`, `stripe.core.js`):
- https://docs.stripe.com/api-v2-overview (idempotency in API v2)
- https://docs.stripe.com/connect/accounts-v2.md
- https://docs.stripe.com/connect/accounts-v2/connected-account-configuration.md
- https://docs.stripe.com/api/v2/core/accounts/create.md
- https://docs.stripe.com/connect/migrate-to-controller-properties.md
