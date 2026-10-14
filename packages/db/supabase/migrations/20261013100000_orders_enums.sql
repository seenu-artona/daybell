-- Phase 1, step 11: orders and refunds (D25, D59, D127, D96; ADR 0024). Enum values only, in their own migration: a
-- value added to an enum can't be used in the transaction that adds it, and 20261013100100 uses all of these. A
-- forward migration: 20261013000000 is merged.

-- The ledger's new transactions (ADR 0024 §ledger): a refund Stripe accepted, its mirror when Stripe later says it
-- failed, and a refund's shortfall Daybell absorbs after 180 days without a sale to recover it from (Seenu, Q2).
alter type public.ledger_kind add value 'order_refunded';
alter type public.ledger_kind add value 'refund_failed';
alter type public.ledger_kind add value 'refund_shortfall';

-- The bell's new kinds (ADR 0024 §bell): a new order (owners, admins and staff), a refund Stripe couldn't make, a
-- dispute opened and a refund made outside Daybell (owners and admins). The same list as packages/core
-- NOTIFICATION_KINDS.
alter type public.notification_kind add value 'order_paid';
alter type public.notification_kind add value 'refund_failed';
alter type public.notification_kind add value 'dispute_opened';
alter type public.notification_kind add value 'refund_external';
