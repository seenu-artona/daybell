-- Phase 1 step 7b: Stripe Accounts v2 (D106, D56, D113, D96; ADR 0020 amendment).
--
-- Studio accounts are now created with Accounts v2, whose changes Stripe announces as "thin" v2 events
-- (e.g. v2.core.account[requirements].updated) through an event destination. The webhook inbox keeps them like the
-- v1 snapshot events: ids, the type and times only, never a payload. Two checks from 20261012300000_payouts.sql are
-- widened so these events fit:
-- - the event type may hold digits and a bracketed part (`v2.core.account[configuration.merchant].updated`);
-- - the event id may hold underscores (v2 event ids such as `evt_test_…`).
-- Both stay anchored, lower-case or alphanumeric only, and length-capped: nothing free-form is stored.

alter table public.stripe_events
  drop constraint stripe_events_stripe_event_id_check,
  drop constraint stripe_events_type_check;

alter table public.stripe_events
  add constraint stripe_events_stripe_event_id_check
    check (char_length(stripe_event_id) <= 255 and stripe_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  add constraint stripe_events_type_check
    check (char_length(type) <= 100 and type ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+|\[[a-z_]+(\.[a-z_]+)*\])+$');
