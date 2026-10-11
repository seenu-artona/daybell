# 0006 — Event log and money ledger

- Status: Accepted, Oct 11, 2026
- Decisions: D96

**Event log (outbox).** Database triggers write one row to `public.events` for every change to studio data, in the same
transaction as the change, so an event exists if and only if the change happened. Events carry IDs and small facts
(roles, field names), never names, emails or photos. They can't be edited or deleted (only a publisher may stamp `published_at`; they go only when their studio is deleted).
`actor_id` has no foreign key, so erasing a person is never blocked by the log.
The activity log (owners and admins) reads them now; a background job (Trigger.dev, step 7) will publish unpublished
events to webhooks, emails and integrations later.

**Ledger.** Money is double-entry in whole cents: each transaction is 2+ lines, written in one database transaction, in
one studio and that studio's currency (US → USD, Canada → CAD), summing to zero — checked at commit, so a recorded
money transaction can never be extended later. Entries are append-only (corrections are reversing transactions), so balances are always sums
of lines. Accounts: parent payments, studio payable, Daybell fees, payment fees, tax payable, refunds, lab costs. Phase 3
writes it; owners and admins can read their studio's lines.

**Retention (D125).** Ledger lines carry no personal data. When a studio closes, its money records are kept 7 years
(tax rules: CRA 6, IRS up to 7) and everything else is erased; a studio with money records is closed, not deleted.

Rejected: storing running balances (drift), floats (rounding), editing rows (no audit trail).
