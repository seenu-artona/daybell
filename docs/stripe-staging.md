# Staging payouts on Stripe (Phase 1 step 7)

What Seenu sets up once in the Stripe Dashboard, in **test mode** (a sandbox), so staging can connect studios' payout
accounts with Stripe Connect (ADR 0020; D56, D98, D106, D113). Nothing here goes in the repository. Keys and signing
secrets go straight into Vercel, never into chat, code, commits or logs. Only the names of the variables appear below.

Daybell's code pins **stripe-node 22.6.2** and the API version **`2026-08-26.dahlia`** (that package's own default).

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
   - Daybell creates each account through the API with these same settings (the `controller` properties), so the
     Dashboard choices only need to allow them.
3. **Connect › Settings**:
   - **Countries**: allow **Canada**. Leave the US off for now (Q3: US payouts wait for Stripe's and an adviser's
     confirmation).
   - **Branding**: add the Daybell name, icon and brand colour, so Stripe's hosted pages show Daybell.
   - **Payouts**: leave the default delay as it is. Daybell sets each account's schedule itself: weekly on Friday by
     default, and the owner can change it in Settings › Payouts.

## 2. An API key

**Developers › API keys**: either use the test **secret key** (`sk_test_…`), or create a **restricted key**
(`rk_test_…`) with write access to **Connect › Accounts** (this covers account links and login links) and read access
to **Payouts**. Check the exact permission names on the restricted-key screen; the code calls `accounts.create`,
`accounts.retrieve`, `accounts.update`, `accounts.createLoginLink`, `accountLinks.create` and `payouts.retrieve`
(on the connected account).

Copy the key straight into Vercel (step 4). Don't paste it anywhere else.

## 3. The webhook endpoint

**Developers › Webhooks › Add destination** (or "Add endpoint"):
- **Events from**: **Connected accounts**.
- **API version**: the version the destination already uses is fine. The current sandbox destination uses
  `2026-09-30.endive`; the code pins `2026-08-26.dahlia`. Daybell reads each object from Stripe again with its pinned
  version rather than trusting the payload, so the payload's version matters little. Line them up when the stripe
  package is next upgraded.
- **Payload style**: snapshot.
- **Events** (exactly these 7): `account.updated`, `capability.updated`, `payout.created`, `payout.updated`,
  `payout.paid`, `payout.failed`, `payout.canceled`.
- **Endpoint URL**: `https://<staging domain>/api/v1/webhooks/stripe`. If staging uses Vercel Deployment Protection,
  add the "Protection Bypass for Automation" query parameter, as for the image worker.
- After saving, **reveal the signing secret** (`whsec_…`) and copy it straight into Vercel (step 4).

## 4. Vercel environment variables

**Vercel › Project › Settings › Environment Variables**. Scope: **Preview, branch `main` only** (staging). Not
Production, and not every PR preview (Claude's call Q13). PR previews without these variables say payouts aren't set up
there.

| Name | Value | Sensitive |
|---|---|---|
| `STRIPE_DRIVER` | `stripe` | no |
| `STRIPE_SECRET_KEY` | the test key from step 2 | **yes** |
| `STRIPE_WEBHOOK_SECRET` | the signing secret from step 3 | **yes** |

Notes:
- The app refuses a live key (`sk_live_`/`rk_live_`) anywhere but production, and refuses `STRIPE_DRIVER=fake` on
  Vercel, both at build time and at run time.
- To roll the webhook secret, set `STRIPE_WEBHOOK_SECRET` to `new,old` (comma-separated), redeploy, roll it in Stripe,
  then remove the old one.

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
5. Change the schedule to monthly and save. In the Stripe Dashboard, the connected account's payout schedule should
   match.
6. Trigger a payout event for the connected account with the Stripe CLI, e.g.
   `stripe trigger payout.paid --stripe-account <the account id>`, and check **Recent payouts**.
7. In **Developers › Webhooks**, the destination's deliveries should show 200s. A 404 means the account isn't in
   staging's database yet (Stripe retries). A 500 means processing failed (Stripe retries; the inbox row keeps the
   error's code).

## What Daybell keeps

Stripe account and payout ids, flags (details submitted, card payments, payouts), counts of what's due, Stripe's reason
codes, the schedule, and each payout's amount, currency, status and dates. Never bank details, names, emails or
addresses, and never webhook payloads.
