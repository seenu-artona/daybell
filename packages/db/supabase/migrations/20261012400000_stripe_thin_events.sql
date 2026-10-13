-- Phase 1 step 7b: Stripe Accounts v2 (D106, D56, D113, D96; ADR 0020 amendment).
--
-- Studio accounts are now created with Accounts v2, whose changes Stripe announces as "thin" v2 events
-- (e.g. v2.core.account[requirements].updated) through an event destination. The webhook inbox keeps them like the
-- v1 snapshot events: ids, the type and times only, never a payload. Two checks from 20261012300000_payouts.sql change
-- so these events fit:
-- - the event type must be one of the 13 types the webhook handles (7 v1 snapshot, 6 v2 thin; HANDLED_EVENTS and
--   HANDLED_THIN_EVENTS in apps/web/lib/stripe-webhook.ts), an allowlist rather than a pattern (security review 4), so
--   nothing else can ever be stored. A new type needs a new migration as well as the webhook change;
-- - the event id may hold underscores (v2 event ids such as `evt_test_…`), still anchored, alphanumeric and capped.

alter table public.stripe_events
  drop constraint stripe_events_stripe_event_id_check,
  drop constraint stripe_events_type_check;

alter table public.stripe_events
  add constraint stripe_events_stripe_event_id_check
    check (char_length(stripe_event_id) <= 255 and stripe_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  add constraint stripe_events_type_check
    check (type in (
      'account.updated',
      'capability.updated',
      'payout.created',
      'payout.updated',
      'payout.paid',
      'payout.failed',
      'payout.canceled',
      'v2.core.account.updated',
      'v2.core.account[requirements].updated',
      'v2.core.account[configuration.merchant].updated',
      'v2.core.account[configuration.merchant].capability_status_updated',
      'v2.core.account[configuration.recipient].updated',
      'v2.core.account[configuration.recipient].capability_status_updated'
    ));
