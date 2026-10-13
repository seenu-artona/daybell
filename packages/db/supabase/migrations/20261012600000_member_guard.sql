-- Phase 1, step 8 security review M2 (D96; orchestrator's call of Oct 12, 2026, for Seenu to review; ADR 0021).
-- A forward migration: 20261011000000_tenancy left Supabase's table-wide UPDATE on studio_members to signed-in
-- people, so an owner could rewrite a row's user_id (or studio_id, owning both studios) instead of only its role:
-- adding someone without an invite, moving the only owner's row past the last-owner guard (which watches role and
-- delete only), and leaving the old person's bell notifications behind.
--
-- Now:
-- - signed-in people may update `role` only (row-level security still limits it to owners of the studio);
-- - a membership's person and studio never change, whoever writes (the service role and the database owner too):
--   someone else joining is a new row (an invite), leaving is a delete;
-- - the notification clean-up also runs when either changes, as a backstop should that guard ever be lifted.

revoke update on public.studio_members from authenticated;
grant update (role) on public.studio_members to authenticated;

create function app.guard_member_identity() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id or new.studio_id is distinct from old.studio_id then
    raise exception 'member_fixed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger studio_members_guard_identity before update on public.studio_members
for each row execute function app.guard_member_identity();
revoke all on function app.guard_member_identity() from public;

-- The old (studio, person) loses its notifications when the row moves; otherwise as before (a role change keeps only
-- the kinds the new role hears about).
create or replace function app.on_member_change_notifications() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or new.user_id is distinct from old.user_id or new.studio_id is distinct from old.studio_id then
    delete from public.notifications n where n.studio_id = old.studio_id and n.user_id = old.user_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  delete from public.notifications n
  where n.studio_id = new.studio_id and n.user_id = new.user_id
    and not new.role = any (app.notification_audience(n.kind));
  return new;
end;
$$;
drop trigger studio_members_notifications on public.studio_members;
create trigger studio_members_notifications after delete or update of role, user_id, studio_id
on public.studio_members
for each row execute function app.on_member_change_notifications();
