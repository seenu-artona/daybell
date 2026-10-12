-- Phase 1, step 3: QR cards (D32, D138, D140, D96, D113; Seenu's answers of Oct 11, 2026; ADR 0015).
-- A forward migration: 20261011080000 is deployed. qr_cards and access_code_hashes are new; access_code_hashes is
-- backfilled from children.
-- Card codes are not secret on their own (a photo of a card shows one), but they are never the access code and never
-- derived from it. Access codes and their hashes stay out of events, logs and URLs, as in ADR 0011.

-- Lets a card reference a child together with its studio and job, so a card's child is always in the card's own job.
alter table public.children add constraint children_studio_job_id_key unique (studio_id, job_id, id);

-- ── One access code, wherever it lives ────────────────────────────────────────────────────────────────────────────
-- Parents type only the code, so a code must be unique across every child and every blank card in the regional
-- database (Seenu, answer 1). Postgres can't put one unique constraint over two tables, so every code-bearing row
-- claims its hash here first. The primary key makes two concurrent claims of one hash wait for each other, with no
-- extra locks. Written only by the triggers below (SECURITY DEFINER); nobody signed in can read or write it.
create table public.access_code_hashes (
  access_code_hash text primary key check (access_code_hash ~ '^[0-9a-f]{64}$'),
  studio_id uuid not null references public.studios (id) on delete cascade
);
comment on table public.access_code_hashes is
  'Every access code hash in this regional database, from children and blank QR cards, so codes are unique across both. Never readable by browsers.';
alter table public.access_code_hashes enable row level security;
-- No policies and no grants: only the triggers below write it, and nothing reads it but them (and, later, lookup).
revoke all on public.access_code_hashes from anon, authenticated;

insert into public.access_code_hashes (access_code_hash, studio_id)
select c.access_code_hash, c.studio_id from public.children c;

-- Claims a hash for a new code. A hash already claimed (by a child or a card) raises access_code_collision, the name
-- add_child and import_roster already use, so the API's retry with a fresh code covers both tables.
create function app.claim_access_code(p_hash text, p_studio_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.access_code_hashes (access_code_hash, studio_id) values (p_hash, p_studio_id)
  on conflict (access_code_hash) do nothing;
  if not found then
    raise exception 'access_code_collision' using errcode = 'P0001';
  end if;
end;
$$;

create function app.on_access_code_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.access_code_hash is not null
     and (tg_op = 'DELETE' or new.access_code_hash is distinct from old.access_code_hash) then
    delete from public.access_code_hashes h where h.access_code_hash = old.access_code_hash;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.access_code_hash is not null
     and (tg_op = 'INSERT' or new.access_code_hash is distinct from old.access_code_hash) then
    perform app.claim_access_code(new.access_code_hash, new.studio_id);
  end if;
  return coalesce(new, old);
end;
$$;
create trigger children_access_code after insert or update of access_code_hash or delete on public.children
for each row execute function app.on_access_code_change();

-- ── QR cards ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- A printed card (D32, D138). Its QR holds only card_code, a random card ID, never the access code, so a photo of a
-- card never reveals the code.
-- - A child's card: child_id is set. A child has one card forever (Seenu, answer 2); reprints reuse it, so cards
--   already handed out keep working. Created on the first print that includes the child.
-- - A blank card: child_id is null. It carries a pre-made access code (Seenu, answer 1): the hash, claimed in
--   access_code_hashes, and an AES-256-GCM copy bound to the card's id. When the card is tagged (a later step) a
--   child is made, the code moves to that child (re-encrypted for the child's id), and this row gets child_id and
--   loses its code columns, in one transaction.
create table public.qr_cards (
  -- The API sets a blank card's id itself: the encrypted code is bound to it.
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  job_id uuid not null,
  child_id uuid,
  -- 20 symbols of Crockford base32 (no I, L, O or U): 100 random bits from pgcrypto's CSPRNG.
  card_code text not null check (card_code ~ '^[0-9A-HJKMNP-TV-Z]{20}$'),
  access_code_hash text check (access_code_hash ~ '^[0-9a-f]{64}$'),
  access_code_ciphertext text check (access_code_ciphertext ~ '^v1\.[A-Za-z0-9_-]{48}$'),
  created_at timestamptz not null default now(),
  constraint qr_cards_job_fk foreign key (studio_id, job_id)
    references public.jobs (studio_id, id) on delete restrict,
  -- MATCH SIMPLE: a blank card has no child; a child's card is always in the child's own studio and job. Cascade:
  -- children are removed only while the job is a draft, and a child's card must never turn into a blank card.
  constraint qr_cards_child_fk foreign key (studio_id, job_id, child_id)
    references public.children (studio_id, job_id, id) on delete cascade,
  constraint qr_cards_card_code_key unique (card_code),
  -- A blank card has a code; a child's card never does (the child has it).
  constraint qr_cards_code_on_blank_cards check (
    (child_id is null) = (access_code_hash is not null)
    and (access_code_hash is null) = (access_code_ciphertext is null))
);
create unique index qr_cards_child_key on public.qr_cards (child_id) where child_id is not null;
create index qr_cards_job_idx on public.qr_cards (studio_id, job_id, child_id);
comment on table public.qr_cards is
  'Printed QR cards. The QR holds card_code only, never the access code. Blank cards carry a pre-made access code (hash and encrypted copy), never readable by browsers.';

create trigger qr_cards_access_code after insert or update of access_code_hash or delete on public.qr_cards
for each row execute function app.on_access_code_change();

alter table public.qr_cards enable row level security;
create policy "members read their studio's cards" on public.qr_cards
  for select to authenticated using (app.is_member(studio_id));
-- No insert, update or delete policy or grant: cards are made only by prepare_qr_cards (service role, below), so a
-- browser can never choose a card code or a code, and card codes never change. Code columns are never readable.
revoke all on public.qr_cards from anon, authenticated;
grant select (id, studio_id, job_id, child_id, card_code, created_at) on public.qr_cards to authenticated;

-- A new card code: each of 20 random bytes masked to 5 bits picks one of 32 symbols. 256 is a multiple of 32, so every
-- symbol is equally likely.
create function app.new_card_code() returns text
language sql volatile
set search_path = ''
as $$
  select string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(r.b, i) & 31) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(20) as b) r, generate_series(0, 19) i;
$$;

-- ── Preparing a print ─────────────────────────────────────────────────────────────────────────────────────────────
-- Makes the missing cards for a print and returns the card codes; the API builds the PDF on demand and never stores it
-- (D138). Run only as the service role, because blank cards carry codes (ADR 0011's server-only code writes): the API
-- generates each blank card's code, hash and encrypted copy, and sends them with the card ids it chose. Like add_child,
-- it acts for p_actor and checks that person's role (owners, admins and photographers; Seenu, answer 3).
-- Scope: the whole job; or chosen groups (p_group_ids, with p_no_group for children without one); or one child.
-- Children marked Do not photograph get no card. Error messages carry no values.
create type app.blank_card_row as (id uuid, access_code_hash text, access_code_ciphertext text);

create function public.prepare_qr_cards(
  p_actor uuid, p_job_id uuid, p_group_ids uuid[], p_no_group boolean, p_child_id uuid, p_blanks jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_studio uuid := (select j.studio_id from public.jobs j where j.id = p_job_id);
  v_previous text;
  v_by_group boolean := p_group_ids is not null or coalesce(p_no_group, false);
  v_groups int := coalesce(cardinality(p_group_ids), 0);
  v_blanks int;
  v_new int;
  v_scope uuid[];
  v_constraint text;
  v_result jsonb;
begin
  if v_studio is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_previous := app.act_for(p_actor, v_studio);
  if jsonb_typeof(coalesce(p_blanks, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Blank cards must be a list' using errcode = '22023';
  end if;
  v_blanks := jsonb_array_length(coalesce(p_blanks, '[]'::jsonb));
  if v_blanks > 100 then
    raise exception 'At most 100 blank cards per print' using errcode = '22023';
  end if;
  if p_child_id is not null and (v_by_group or v_blanks > 0) then
    raise exception 'A single card has no groups or blank cards' using errcode = '22023';
  end if;
  if v_groups <> (select count(*) from public.job_groups g
                  where g.studio_id = v_studio and g.job_id = p_job_id and g.id = any (p_group_ids))
     or v_groups <> (select count(distinct x) from unnest(p_group_ids) x) then
    raise exception 'Every group must be one of the job''s, once' using errcode = '22023';
  end if;
  if p_child_id is not null then
    if not exists (select 1 from public.children c
                   where c.studio_id = v_studio and c.job_id = p_job_id and c.id = p_child_id) then
      raise exception 'The child must be in the job' using errcode = '22023';
    end if;
    if exists (select 1 from public.children c where c.id = p_child_id and c.do_not_photograph) then
      raise exception 'do_not_photograph' using errcode = 'P0001';
    end if;
  end if;

  -- Prints for the same job run one at a time, so a child never gets two cards.
  perform pg_advisory_xact_lock(hashtextextended('qr_cards:' || p_job_id::text, 0));

  select coalesce(array_agg(c.id), '{}') into v_scope
  from public.children c
  where c.studio_id = v_studio and c.job_id = p_job_id and not c.do_not_photograph
    and (p_child_id is null or c.id = p_child_id)
    and (not v_by_group
         or c.group_id = any (coalesce(p_group_ids, '{}'))
         or (coalesce(p_no_group, false) and c.group_id is null));

  if cardinality(v_scope) = 0 and v_blanks = 0 then
    raise exception 'nothing_to_print' using errcode = 'P0001';
  end if;

  begin
    insert into public.qr_cards (studio_id, job_id, child_id, card_code)
    select v_studio, p_job_id, s.child_id, app.new_card_code()
    from unnest(v_scope) s (child_id)
    where not exists (select 1 from public.qr_cards q where q.child_id = s.child_id);
    get diagnostics v_new = row_count;

    insert into public.qr_cards (id, studio_id, job_id, card_code, access_code_hash, access_code_ciphertext)
    select b.id, v_studio, p_job_id, app.new_card_code(), b.access_code_hash, b.access_code_ciphertext
    from jsonb_populate_recordset(null::app.blank_card_row, coalesce(p_blanks, '[]'::jsonb)) b;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'qr_cards_card_code_key' then
      -- 100 random bits make this all but impossible; the API tries again.
      raise exception 'card_code_collision' using errcode = 'P0001';
    end if;
    raise;
  end;

  select jsonb_build_object(
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object('child_id', q.child_id, 'card_code', q.card_code) order by q.child_id)
      from public.qr_cards q where q.child_id = any (v_scope)), '[]'::jsonb),
    'blanks', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'card_code', q.card_code) order by q.id)
      from public.qr_cards q
      where q.id in (select b.id from jsonb_populate_recordset(null::app.blank_card_row, coalesce(p_blanks, '[]'::jsonb)) b)),
      '[]'::jsonb),
    'new_cards', v_new)
  into v_result;

  -- Counts and IDs only (D96): never names, card codes or access codes.
  perform app.emit(v_studio, 'qr_cards.printed', p_job_id, jsonb_build_object(
    'cards', jsonb_array_length(v_result -> 'cards'),
    'new_cards', v_new,
    'blank_cards', v_blanks,
    'groups', case when v_by_group then v_groups + case when coalesce(p_no_group, false) then 1 else 0 end end,
    'single', p_child_id is not null));
  perform app.end_act_for(v_previous);
  return v_result;
end;
$$;

-- ── The Overview's "Print QR cards" ───────────────────────────────────────────────────────────────────────────────
-- Done when every child who may be photographed has a card (Seenu, answer 2); a child added later reopens it.
-- SECURITY INVOKER: row-level security applies, so another studio's job counts nothing.
create function public.qr_card_status(p_job_id uuid) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'eligible', (select count(*) from public.children c where c.job_id = p_job_id and not c.do_not_photograph),
    'with_card', (select count(*) from public.children c
                  where c.job_id = p_job_id and not c.do_not_photograph
                    and exists (select 1 from public.qr_cards q where q.child_id = c.id)),
    'blank_cards', (select count(*) from public.qr_cards q where q.job_id = p_job_id and q.child_id is null));
$$;

revoke all on function app.claim_access_code(text, uuid), app.on_access_code_change(), app.new_card_code()
  from public;
revoke all on type app.blank_card_row from public;
revoke all on function public.qr_card_status(uuid) from public, anon;
grant execute on function public.qr_card_status(uuid) to authenticated;
-- Code-bearing writes: the service role only (server-side route handlers), never browsers (ADR 0011).
revoke all on function public.prepare_qr_cards(uuid, uuid, uuid[], boolean, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.prepare_qr_cards(uuid, uuid, uuid[], boolean, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
