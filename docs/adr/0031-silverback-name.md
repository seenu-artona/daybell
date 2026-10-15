# 0031 — The name users see is Silverback (layer 1)

- Status: Proposed (branch `ui/silverback-rename`). Every call under "Calls for Seenu" is provisional until Seenu
  reviews it (CLAUDE.md rule 7: nothing decided is changed silently).
- Decisions implemented: D155 (Seenu, Oct 14, 2026): the product's user-visible name becomes "Silverback"; layer 1 only.
- Decisions touched: D112 (design tokens, no raw hex in components), D91 (the mark's accessible name), D96 (words in the
  locale files), D62 (no platform logo in the parent shop).

## What changed (layer 1: what studio staff, parents and emails see)

- **Words.** Every "Daybell" in `apps/web/messages/en-US.json` and `en-CA.json` (36 each: page titles, the brand,
  sign-in and invite pages, the Quebec notice, fees, refunds, payouts, the API docs page, "Payments processed by …")
  now says "Silverback"; the wording is otherwise unchanged. A new `gallery.brand` replaces the word hard-coded in the
  `/dev/components` side menu. A test fails if any string in either locale says "Daybell" again.
- **Emails.** The magic-link subject and heading say "Your Silverback link" (`packages/db/supabase/config.toml`,
  `templates/magic_link.html`). The emails have no logo, so none was added.
- **Messages the API returns** (shown on screens and to API users): "contact Silverback support" (payouts), "A refund
  was made outside Silverback" (orders).
- **API docs** (`/docs/api` and the OpenAPI document): title "Silverback API" and the prose in route and field
  descriptions. Header names such as `Daybell-Cards` are identifiers and stay.
- **Files users keep.** Downloads are named `silverback-<reference>-<n>.jpg`, zips `silverback-<reference>.zip` and
  `silverback-<reference>-print-files.zip`; the QR card PDF's Creator and Producer say "Silverback".
- **Logo: the interim "Ridge" mark.** `RidgeMark` in `packages/ui` draws two arcs inline in the brand's existing
  tokens (Seenu's change of Oct 14: brand colours, not the silvers of the first draft; no new tokens):
  - light backgrounds: top arc `primary` (#0E7A4F), bottom arc `ink` (#14231C);
  - dark backgrounds: top arc `lime` (#B8F05A), bottom arc `on-primary` (white).

  It replaces the lime "D" tile in the studio app's menu (dark), the sign-in and sign-up layout (light) and the
  `/dev/components` menu, always beside the word "Silverback", so there it is decorative (`aria-hidden`). Standing
  alone it takes a `label` and becomes `role="img"` with that name. `apps/web/app/icon.svg` (the favicon) is the light
  mark; `apps/web/public/brand/silverback-ridge.svg` and `silverback-ridge-dark.svg` hold both for later uses (e.g.
  emails), with hex only in those files. A test keeps the files' arcs and colours equal to the component's paths and the
  tokens. The parent shop has its own neutral favicon (call 3). A designer will make the final mark later; only these places change then.

## What stays "Daybell" (internal) and why

Changing these would break running systems, stored data or history for no user-visible gain:

- package names `@daybell/*`, the repo, the root package, the Supabase `project_id`;
- environment variables, S3 buckets, Supabase projects, Stripe metadata keys (`daybell_studio_id`, …) and idempotency
  keys, cookies (`daybell_region`, `daybell_shop`, `daybell_device`) and browser storage keys;
- HTTP headers (`Daybell-Signature`, `Daybell-Region`, `Daybell-Cards*`), the QR prefix `DBC1`, event names, ledger
  accounts (`daybell_fees`), database names and comments, keyframe names, JSON keys such as `daybellFee`;
- code comments, test names, ADRs, `docs/`, `README.md`, `CLAUDE.md` and `.claude/agents/`: internal documents for
  agents and developers keep "Daybell". `CLAUDE.md` names the product to agents only, so it is unchanged.

## Calls for Seenu

1. **Hosted email settings.** No sender display name is set in the repo (local Supabase uses its test mailbox); the hosted
   projects' SMTP "Sender name" is set in the Supabase dashboard and should become "Silverback" there by hand. The
   live projects also keep the old magic-link subject and HTML until someone pastes the new ones from
   `supabase/config.toml` and `supabase/templates/magic_link.html` into the dashboard again, as
   `packages/db/README.md` describes. Not done here (no production or dashboard changes by agents).
2. **The sign-up address example** still shows `north-peak.daybell.io`: it's the domain, and no new domain is decided.
   Changing it needs a domain decision.
3. **No Ridge mark in the parent shop.** The brief listed the shop header, but D62 says parents see only the studio's
   logo, with no platform logo or "Powered by". The shop keeps the studio's logo; only its words ("Payments processed by
   Silverback for …") changed. **The shop's favicon is neutral:** `apps/web/app/shop/icon.svg` is a plain rounded
   square in the ink colour, with no mark and no letters, so /shop pages don't show the Ridge from `app/icon.svg`. A
   per-studio favicon could come later.
4. **Download and zip file names** now start with `silverback-` (parents and studios keep these files). Earlier
   downloads keep their old names.
5. **API docs prose and API error messages** count as user-visible (studio developers and screens read them), so they
   say Silverback; header names stay as identifiers.
6. **The folded menu** shows no mark, as before (only the unfold button). Showing the mark there would be a design
   change.
