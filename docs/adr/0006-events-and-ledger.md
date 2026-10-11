# 0006 — Event log and money ledger

- Status: Accepted, Oct 11, 2026
- Decisions: D96

**Event log (outbox).** Database triggers write one row to `public.events` for every change to studio data, in the same
transaction as the change, so an event exists if and only if the change happened. Events carry IDs and small facts
(roles, field names), never names, emails or photos. They can't be edited; only a publisher may stamp `published_at`.
The activity log (owners and admins) reads them now; a background job (Trigger.dev, step 7) will publish unpublished
events to webhooks, emails and integrations later.

**Ledger.** Money is double-entry in whole cents: each transaction is 2+ lines in one currency and one studio that sum to
zero, checked at commit. Entries are append-only (corrections are reversing transactions), so balances are always sums
of lines. Accounts: parent payments, studio payable, Daybell fees, payment fees, tax payable, refunds, lab costs. Phase 3
writes it; owners and admins can read their studio's lines.

Rejected: storing running balances (drift), floats (rounding), editing rows (no audit trail).
