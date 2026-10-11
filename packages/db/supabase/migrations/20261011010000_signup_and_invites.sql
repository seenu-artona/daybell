-- Phase 0, step 4: studio sign-up and staff invites (D96, D113).
-- Browsers never write these tables directly; they call these functions, which check who is asking.

-- Create a studio and make the caller its owner. The region is always this database's region (D113).
create function public.create_studio(p_name text, p_slug text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_region public.data_region := (select c.value::public.data_region from app.config c where c.key = 'data_region');
  v_studio uuid;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  -- One new studio per person for now; stops sign-up spam. Owners of several studios come later.
  if exists (select 1 from public.studio_members m where m.user_id = v_user and m.role = 'owner') then
    raise exception 'You already own a studio' using errcode = 'unique_violation';
  end if;
  insert into public.studios (name, slug, data_region)
  values (btrim(p_name), lower(btrim(p_slug)), v_region)
  returning id into v_studio;
  insert into public.studio_members (studio_id, user_id, role) values (v_studio, v_user, 'owner');
  return v_studio;
end;
$$;

-- Invites: owners invite staff by email. Only a hash of the token is stored; the link carries the token itself.
create table public.studio_invites (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.studio_role not null check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index studio_invites_studio_id_idx on public.studio_invites (studio_id);
create unique index studio_invites_one_open_per_email
  on public.studio_invites (studio_id, email) where accepted_at is null;
comment on table public.studio_invites is 'Pending staff invitations. Tokens are stored hashed (sha256).';

alter table public.studio_invites enable row level security;
revoke all on public.studio_invites from anon;
revoke truncate, references, trigger on public.studio_invites from authenticated;
-- No direct writes from browsers; reads show owners and admins their studio's invites, without token hashes.
-- Column grants only work once the table-wide grant Supabase adds by default is removed.
revoke all on public.studio_invites from authenticated;
grant select (id, studio_id, email, role, invited_by, expires_at, accepted_at, created_at)
  on public.studio_invites to authenticated;

create policy "owners and admins see their invites" on public.studio_invites
  for select to authenticated using (app.has_role(studio_id, '{owner,admin}'));

-- Owner creates an invite; returns the raw token once, for the invite link/email.
create function public.invite_member(p_studio_id uuid, p_email text, p_role public.studio_role) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not app.has_role(p_studio_id, '{owner}') then
    raise exception 'Only owners can invite people' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'Invite as admin, photographer or staff' using errcode = 'check_violation';
  end if;
  -- Re-inviting replaces any open invite for the same email.
  delete from public.studio_invites
  where studio_id = p_studio_id and email = lower(btrim(p_email)) and accepted_at is null;
  insert into public.studio_invites (studio_id, email, role, token_hash, invited_by)
  values (p_studio_id, lower(btrim(p_email)), p_role,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid()));
  return v_token;
end;
$$;

-- The invited person, signed in with the invited email, accepts. Returns the studio id.
create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_email text := (select lower(u.email) from auth.users u where u.id = v_user);
  v_invite public.studio_invites;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_invite from public.studio_invites i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;
  -- Same message for every failure, so a guessed token reveals nothing.
  if v_invite.id is null or v_invite.accepted_at is not null or v_invite.expires_at < now()
     or v_invite.email <> v_email then
    raise exception 'This invite link is not valid for your account' using errcode = '42501';
  end if;
  insert into public.studio_members (studio_id, user_id, role)
  values (v_invite.studio_id, v_user, v_invite.role)
  on conflict (studio_id, user_id) do nothing;
  update public.studio_invites set accepted_at = now() where id = v_invite.id;
  return v_invite.studio_id;
end;
$$;

-- Owners withdraw an open invite.
create function public.revoke_invite(p_invite_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select i.studio_id from public.studio_invites i where i.id = p_invite_id);
begin
  if v_studio is null or not app.has_role(v_studio, '{owner}') then
    raise exception 'Only owners can withdraw invites' using errcode = '42501';
  end if;
  delete from public.studio_invites where id = p_invite_id and accepted_at is null;
end;
$$;

revoke all on function public.create_studio(text, text), public.invite_member(uuid, text, public.studio_role),
  public.accept_invite(text), public.revoke_invite(uuid) from public, anon;
grant execute on function public.create_studio(text, text), public.invite_member(uuid, text, public.studio_role),
  public.accept_invite(text), public.revoke_invite(uuid) to authenticated;

-- Team list with emails for a studio's members (auth.users isn't readable directly).
create function public.studio_team(p_studio_id uuid)
returns table (user_id uuid, email text, role public.studio_role)
language sql stable security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, m.role
  from public.studio_members m
  join auth.users u on u.id = m.user_id
  where m.studio_id = p_studio_id and app.is_member(p_studio_id)
  order by m.created_at;
$$;
revoke all on function public.studio_team(uuid) from public, anon;
grant execute on function public.studio_team(uuid) to authenticated;

-- Sign-up form check. Studio web addresses are public, so saying whether one is taken reveals nothing private.
create function public.slug_available(p_slug text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (select 1 from public.studios s where s.slug = lower(btrim(p_slug)));
$$;
revoke all on function public.slug_available(text) from public;
grant execute on function public.slug_available(text) to anon, authenticated;
