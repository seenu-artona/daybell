# Staging payouts, checkout and refunds on Stripe (Phase 1 steps 7, 7b, 7c, 10 and 11)

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

**Every destination (A, B and C below):**
- **Endpoint URL**: exactly `https://daybell.vercel.app/api/v1/webhooks/stripe`, with **no query parameter**. Don't add
  Vercel's "Protection Bypass for Automation" parameter: staging found it empty and Vercel answered 401 (step 11 brief).
  If a destination already has another address or a `?x-vercel-protection-bypass=…` on it, edit it to this exact URL.
- After saving, **reveal each signing secret** (`whsec_…`) and copy them straight into Vercel (step 4), comma-separated
  in the one variable.

## 4. Vercel environment variables

**Vercel › Project › Settings › Environment Variables**. Scope: **Production** only. Staging is Vercel's Production
environment: the `main` branch, served at `https://daybell.vercel.app`, where every webhook destination points and
where Vercel Cron runs. Not Preview: PR previews without these variables say payouts aren't set up there (Claude's call
Q13).

| Name | Value | Sensitive |
|---|---|---|
| `STRIPE_DRIVER` | `stripe` | no |
| `STRIPE_SECRET_KEY` | the test key from step 2 | **yes** |
| `STRIPE_WEBHOOK_SECRET` | the signing secrets from step 3 and section 6, comma-separated (`whsec_A,whsec_B,whsec_C`) | **yes** |


Notes:
- The app refuses `STRIPE_DRIVER=fake` on Vercel, at build time and at run time. It refuses a live key
  (`sk_live_`/`rk_live_`) only where `VERCEL_ENV` isn't `production`, and staging **is** Vercel's Production
  environment, so that guard doesn't separate staging from production: staging would accept a live key. Until a real
  production project exists, staging uses **test-mode keys only, by process**: never paste a live key here (ADR 0024,
  launch to-dos).
- `STRIPE_WEBHOOK_SECRET` takes one to six secrets (three destinations since step 10). To roll one, add the new one
  next to the old (e.g. `A,B,C,B-new`), redeploy, roll it in Stripe, then remove the old one.

## 5. Redeploy and smoke test

1. Redeploy staging (the `main` branch, Vercel's Production environment).
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

## 6. Checkout (step 10)

Parents pay on Stripe's hosted Checkout page: a destination charge on behalf of the studio's connected account, with
Daybell's fee taken as an application fee and Stripe's card fee taken back from the studio's transfer (ADR 0023; D59,
D98, D104, D106). Steps 1 to 5 must be done first: a studio needs an active payout account to sell.

1. **A third webhook destination (C).** Checkout's events are Daybell's own (the session is created on the platform),
   so they don't come through destination A. **Developers › Webhooks › Add destination**:
   - **Events from**: **Your account**.
   - **Payload style**: **snapshot**.
   - **Events**: `checkout.session.completed`, `checkout.session.expired` (since step 11, also the four refund and
     dispute events in section 7).
   - **Endpoint URL**: exactly `https://daybell.vercel.app/api/v1/webhooks/stripe`, no query parameter.
   - Reveal its signing secret and add it to `STRIPE_WEBHOOK_SECRET` in Vercel, after the other two
     (`whsec_A,whsec_B,whsec_C`). Redeploy.
   Daybell reads each session from Stripe again rather than trusting the payload, and a cron backstop (the jobs cron)
   completes or expires any checkout whose event never arrived.
2. **The API key.** If staging uses a restricted key, it now also needs write access to **Checkout Sessions**,
   **PaymentIntents** (Daybell sets the receipt email after payment), **Transfers** (the card fee is taken back as a
   transfer reversal), **Tax settings** and **Tax registrations** (on connected accounts), and read access to
   **Charges** and **Balance transactions** (to learn Stripe's fee). The calls are `checkout.sessions.create`,
   `.retrieve` and `.expire`, `paymentIntents.update`, `transfers.listReversals` and `transfers.createReversal`,
   `accounts.update` (the card statement prefix), `tax.settings.update`, `tax.registrations.create` and `.update`.
   If unsure, use the test secret key.
3. **Stripe Tax.** **Settings › Tax** (or **More › Tax**): turn Stripe Tax on for the platform, in test mode. Studios'
   head office and registrations are set by Daybell through the API from Settings › Taxes (the studio is the seller and
   liable). Check that Stripe Tax is allowed for connected accounts on this platform (Connect settings). A studio with
   no registration charges no tax (small supplier; Seenu's answer 2).
4. **Apple Pay and Google Pay (Seenu's answer 3).** **Settings › Payments › Payment methods**, for the platform's
   configuration used with connected accounts: turn on **Apple Pay** and **Google Pay** (they are wallets on cards;
   Daybell asks for `card` only). Leave **Link** off: Daybell also hides it on its Checkout pages (Claude's call 19).
   Klarna and others stay off for now.
5. **Receipts.** **Settings › Business › Customer emails** (Stripe's name may differ): turn on emails for
   **successful payments**. Stripe emails the receipt to the address the parent typed on Checkout; Daybell never keeps
   that address (D24: no sign-up).
6. **Branding.** **Settings › Branding**: Daybell's icon. Checkout shows the studio's name and Daybell's charcoal
   button (logos later; Claude's call 8).
7. **Card statement prefix.** Nothing to do: Daybell sets each connected account's card statement prefix to `DBL` the
   first time it sells, and each charge adds the studio's short name (e.g. `DBL* RIVERSIDE PHOTO`; D104).
8. **Smoke test** (after redeploying):
   - As the owner of a Canadian studio with active payouts: **Settings › Taxes**, save the business address and add a
     test GST/HST number (Stripe's test mode accepts any well-formed number; check Stripe's Tax testing page).
   - Open a job's shop, enter a code as a parent, add a package, a print and a download, choose home delivery and
     click **Pay securely**.
   - On Stripe's page: any email you own, the test card `4242 4242 4242 4242`, any future date, any CVC, a Canadian
     address. Pay.
   - Daybell's order page should say **Thank you!** with the order's reference and the downloads; the downloads open
     (AWS must be set up first: `docs/aws-staging-photos.md`, section 13).
   - The job's **Shop** tab shows the order with its tax, Daybell's fee, Stripe's card fee and what the studio gets.
   - In Stripe: the payment on the platform, the transfer to the connected account with Daybell's application fee,
     and a transfer reversal for the card fee (its metadata has `daybell_purpose: card_fee`). The receipt email arrives.
   - Start another checkout and click Stripe's back arrow: the bag is unchanged and says the payment was canceled.
   - Destination C's deliveries show 200s.
9. **What to check against Stripe's docs.** ADR 0023 section 2 lists the Stripe facts that couldn't be checked from
   here (e.g. whether `statement_descriptor_suffix` works with `on_behalf_of`, Stripe Tax on connected accounts with
   `Stripe-Context`, the tax codes). If staging disagrees with any, tell the developers.

## 7. Refunds and disputes (step 11)

Studios refund from the order page and parents cancel from theirs (ADR 0024; D25). Daybell refunds the parent on the
platform's payment for the exact amount it computes (no `reverse_transfer`, no `refund_application_fee`), then takes
the studio's share back from its transfer with one transfer reversal. Stripe's card fee isn't returned. Steps 1 to 6
must be done first.

1. **Destination C gains four events.** **Developers › Webhooks**, open destination C (Your account, snapshot) and
   **add** these events, keeping the two checkout events. It then has exactly these 6:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `charge.refunded`
   - `refund.updated`
   - `refund.failed`
   - `charge.dispute.created`

   The URL stays exactly `https://daybell.vercel.app/api/v1/webhooks/stripe`, with no query parameter. The signing
   secret doesn't change, so `STRIPE_WEBHOOK_SECRET` stays as it is. Daybell reads each refund, payment and dispute
   from Stripe again rather than trusting the payload, and the jobs cron retries refunds whose event never arrived.
2. **The restricted key's new permissions.** If staging uses a restricted key, add:

   | Resource | Access | Why (the calls) |
   |---|---|---|
   | **Refunds** | write | `refunds.create`, `refunds.retrieve`, `refunds.list` (a refund an earlier try made is found by its metadata) |
   | **Disputes** | read | `disputes.retrieve` (to find the payment a dispute is about; Daybell only flags the order) |
   | **PaymentIntents** | read (write is already granted in section 6) | `paymentIntents.retrieve` (Daybell's ids in the payment's metadata) |
   | **Transfers** | read and write (write is already granted in section 6) | `transfers.retrieve` (what the transfer still holds), `transfers.listReversals`, `transfers.createReversal`, and `transfers.list` and `transfers.create` (a refund Stripe fails after the studio's share was taken back sends that share back to the studio's account) |

   Check the exact permission names on the restricted-key screen. If unsure, use the test secret key.
3. **Smoke test** (after the change; Stripe's test cards are on its "Testing" page, check them there):
   - Pay an order as in section 6 with home delivery and two prints.
   - As the studio's owner, open **Orders**, then the order: **Refund**, one print, reason "Damaged", **Review refund**,
     **Refund $…**. The order shows "Partly refunded" and the refund as Refunded; the ledger shows the refund's four
     lines adding up to zero.
   - In Stripe: the refund on the payment (metadata `daybell_refund_id`), and a transfer reversal on the transfer with
     `daybell_purpose: refund`. Destination C's deliveries show 200s for `charge.refunded` and `refund.updated`.
   - Mark another order Printed, then Shipped with a tracking number: the parent's order page shows the tracking.
   - As a parent, pay a mixed order and click **Cancel order** before the studio prints it: the order is canceled and
     refunded in full.
   - Optional: with a test card whose refund fails (Stripe documents one), the refund shows as Failed and the owner's
     bell says the parent wasn't refunded; with a test card that opens a dispute, the order is flagged as disputed and
     the bell says so.
   - Optional: refund a paid (not yet printed) test order from the Stripe Dashboard instead of Daybell. The order page
     says a refund was made outside Daybell, the owner's bell rings, and Mark printed is refused until an owner or admin
     clicks **Mark as checked**.

## What Daybell keeps

Stripe account and payout ids, flags (details submitted, card payments, payouts), counts of what's due, Stripe's reason
codes, the schedule, and each payout's amount, currency, status and dates. Since step 10, also each order's Checkout
Session, PaymentIntent, transfer, fee reversal and balance transaction ids, its amounts, tax and fees, and, for home
delivery only, the recipient's name and Canadian address (to ship the order). Never bank details or card details, never
the parent's email (Stripe keeps it for the receipt), and never webhook payloads. Since step 11, also each refund's and
its transfer reversal's ids, amounts, status and Stripe's failure reason code, the date a dispute was opened (a flag
only), and the carrier and tracking number of a shipped order. A home delivery address is deleted 90 days after the
order ships (or 90 days after payment when it is canceled or fully refunded, and at the latest 365 days after payment),
and its tracking number with it. Since the step 11 reviews, also a failed refund's share-return transfer id and amount,
and when a refund made outside Daybell was found and checked. (The owner's sign-in email is sent to Stripe as the account's contact email
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
