# 0020 — Payouts with Stripe Connect

- Status: Proposed, Oct 12, 2026 (accepted when Seenu merges the step 7 PR).
- Amends:
  - 0017: onboarding gains "Set up payouts".
  - 0016: the region guard gains `PAYOUT_REGIONS`.
  - 0019: the onboarding order becomes account, payouts, price list, first job (D143).
- Decisions implemented: D56, D98, D106, D143, D96, D113, D92.
- Decisions touched: D104, D59, D125, D91, D112, D10.
- Inputs: Seenu's answers 1–4 to the step 7 brief, his answers Q1, Q2, Q3, Q5 and Q6, and Claude's calls Q0, Q4 and
  Q7–Q17 (Oct 12, 2026; for Seenu to review).

## Context

Phase 1 step 7: "Stripe Connect onboarding in Settings with Stripe-managed accounts; weekly payouts by default; fees
shown". Phase 1's goal is "Connects payouts (Stripe, test mode)".

Seenu's answers:
1. Only the owner connects or changes payouts. Admins read. Photographers and staff don't see Payouts.
2. Onboarding is on Stripe's hosted pages (Account Links), coming back to Daybell.
3. Schedules are weekly (the default), daily or monthly.
4. Settings › Payouts shows status, next payout, recent payouts and the fees. Nothing goes on Home.

## 1. Stripe configuration

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
- No name, email or business details are prefilled (Q4).

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
  available in this region yet").
- For US studios, "Set up payouts" is left out of onboarding (so onboarding can still complete), and "Payouts
  connected" in Start selling stays "Coming soon".
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
- A composite key `(studio_id, id)` for payouts.

**`payouts`**:
- `stripe_payout_id` (unique, `po_…`) and a composite FK to the studio's own account.
- `amount_cents bigint` (≥ 0) and `currency`, which must be the region's currency (CAD for Canada, D106).
- `status`, `method`, `automatic`, `arrival_date`, `failure_code`, `stripe_created_at`.

**`stripe_events`** (the webhook inbox, D96):
- The event id (unique), type, account, studio, livemode and times.
- A two-minute processing lease, `attempts`, and `last_error` (a code name only).
- Never the payload.

**Never kept anywhere:** bank details, last-4 digits, external account ids, names, emails, addresses, descriptions,
statement descriptors or trace ids.

**Enums** mirror Stripe:
- `payout_interval` includes `manual`. It is never offered; the screens say "Paused by Stripe".
- `payout_weekday` has all seven days, so a sync can never fail on a weekend. Studios pick Monday to Friday.
- A test keeps core's lists equal to the SQL enums.

**Access:**
- Row-level security: owners and admins read `payout_accounts` and `payouts`. Nobody else reads anything.
- `stripe_events` has no policy and no grant.
- Browsers have no insert, update or delete on any of the three tables.

**Functions** are SECURITY DEFINER with an empty `search_path`, and only the service role may execute them.

Owner actions (`app.act_for_owner` = `app.act_for` plus an owner check, refusing with 42501 before anything is read):
- `create_payout_account`: idempotent for the same account; `already_connected` for another one.
- `set_payout_schedule`: `not_connected` if there is no account.

System functions (the webhook, and the refresh after the route's role check):
- `record_stripe_event`: inserts once; returns null for an unknown account; claims a two-minute lease.
- `finish_stripe_event`.
- `sync_payout_account`: writes nothing when nothing changed.
- `sync_payout`: upserts in the account's own studio and refuses a payout id that moves to another account.

**Deviation from the plan.** The plan locked the inbox row with `for update skip locked`. That lock would end with
`record_stripe_event`'s own transaction, because each RPC is its own transaction. The lease column does what the plan
meant. The plan's `stripe_synced_at` was dropped, because a sync that changes nothing writes nothing.

**Tests.** pgTAP `015_payouts` (98 tests) and `016_payouts_canada` (5 tests) cover:
- reads by every role and by anon
- grants and execute rights
- the owner-only functions (admins, photographers, staff, another studio's owner and nobody get 42501)
- unique ids and format checks, the composite FK, country and currency
- duplicate events, leases, failures and retries
- syncs that change nothing, events with ids only, and studio deletion restricted

## 4. Webhooks (`POST /api/v1/webhooks/stripe`)

The steps, in order:
1. Read the raw body, at most 512 KB.
2. Verify `Stripe-Signature` against one or two `STRIPE_WEBHOOK_SECRET`s.
3. Refuse a mode (live or test) that doesn't match the key.
4. Acknowledge other types and platform events (no `account`) with 200, storing nothing.
5. **Read the account from Stripe again.**
6. Route by `metadata.daybell_region` if it is a payout region, otherwise Canada (Q11).
7. Run `assertFunctionRegion`.
8. Call `record_stripe_event`:
   - unknown account: 404, so Stripe retries (this covers the race with account creation)
   - lease held by another delivery: 409
   - already processed: 200
9. Read the payout from Stripe again (for payout events), then sync.
10. Call `finish_stripe_event`.
11. On failure, record `sync_failed` / `stripe_unavailable` / `unexpected_object` and answer 500, so Stripe retries.

Handled events: `account.updated`, `capability.updated`, `payout.created`, `payout.updated`, `payout.paid`,
`payout.failed`, `payout.canceled`.

Logs hold fixed names and the event type only. No cron and no Trigger.dev: Stripe's retries are the queue.

## 5. Return-and-refresh

`POST /studio/payouts/refresh` (owners and admins) reads the account from Stripe and syncs it. The page calls it on
`?stripe=return`, so the status is right on PR previews without webhooks, and when a webhook is late.

`?stripe=refresh` (an expired link) shows a note. The owner continues with the same button. There is no automatic
redirect, so focus stays predictable.

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
- The Start selling dialog's "Payouts connected" is real (it fetches `GET /studio/payouts` when opened). Only "Photos
  uploaded" stays "Coming soon".
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
  created.
- Account Link and login link URLs are never logged or stored.
- Stripe errors are logged by error type only.

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
- The dev page and route answer 404.

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
- Orphans: if a create succeeds at Stripe but the database write fails, the retry uses the same idempotency key, but
  only within Stripe's idempotency window.

## 15. Rejected

- Storing the webhook payload: it holds personal data.
- Fetching payouts live on every page view: a Stripe call per view, and no copy for later steps or the API.
- stripe-mock in CI: it is stateless and doesn't cover Connect flows.
- Trusting the payload's ordering.
- Browsers writing payout rows.
- A job checklist task for payouts: photographers would see it.
- Accounts v2: its availability for Canadian platforms couldn't be checked, and Q1 chose v1 with controller properties.
