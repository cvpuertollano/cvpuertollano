begin;

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    role text not null default 'family' check (role in ('admin', 'family')),
    created_at timestamptz not null default now()
);

create table public.guardians (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references auth.users (id) on delete cascade,
    full_name text not null check (length(btrim(full_name)) > 0),
    phone text,
    archived_at timestamptz,
    created_at timestamptz not null default now()
);

create table public.players (
    id uuid primary key default gen_random_uuid(),
    first_name text not null check (length(btrim(first_name)) > 0),
    last_name text not null check (length(btrim(last_name)) > 0),
    archived_at timestamptz,
    created_at timestamptz not null default now()
);

create table public.player_guardians (
    player_id uuid not null references public.players (id) on delete cascade,
    guardian_id uuid not null references public.guardians (id) on delete cascade,
    relationship text,
    created_at timestamptz not null default now(),
    primary key (player_id, guardian_id)
);

create table public.teams (
    id uuid primary key default gen_random_uuid(),
    name text not null unique check (length(btrim(name)) > 0),
    archived_at timestamptz,
    created_at timestamptz not null default now()
);

create table public.seasons (
    id uuid primary key default gen_random_uuid(),
    name text not null unique check (length(btrim(name)) > 0),
    starts_on date,
    ends_on date,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

create table public.player_enrollments (
    id uuid primary key default gen_random_uuid(),
    player_id uuid not null references public.players (id) on delete restrict,
    team_id uuid not null references public.teams (id) on delete restrict,
    season_id uuid not null references public.seasons (id) on delete restrict,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    unique (player_id, team_id, season_id)
);

create table public.fees (
    id uuid primary key default gen_random_uuid(),
    player_id uuid not null references public.players (id) on delete restrict,
    season_id uuid not null references public.seasons (id) on delete restrict,
    description text not null check (length(btrim(description)) > 0),
    amount_cents integer not null check (amount_cents > 0),
    due_date date,
    archived_at timestamptz,
    created_at timestamptz not null default now()
);

create table public.payments (
    id uuid primary key default gen_random_uuid(),
    fee_id uuid not null references public.fees (id) on delete restrict,
    amount_cents integer not null check (amount_cents > 0),
    paid_at date not null default current_date,
    method text not null check (method in ('cash', 'bank_transfer', 'other')),
    reference text check (reference is null or length(reference) <= 120),
    created_at timestamptz not null default now()
);

create index player_guardians_guardian_id_idx on public.player_guardians (guardian_id);
create index player_enrollments_team_id_idx on public.player_enrollments (team_id, player_id);
create index player_enrollments_season_id_idx on public.player_enrollments (season_id, player_id);
create index fees_player_id_idx on public.fees (player_id);
create index fees_season_id_idx on public.fees (season_id);
create index payments_fee_id_idx on public.payments (fee_id);

create schema private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id) values (new.id);
    return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create function private.is_club_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles
        where id = (select auth.uid())
          and role = 'admin'
    );
$$;

create function private.can_access_player(target_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.player_guardians pg
        join public.guardians g on g.id = pg.guardian_id
        where pg.player_id = target_player_id
          and g.user_id = (select auth.uid())
          and g.archived_at is null
    );
$$;

revoke all on function private.is_club_admin() from public, anon, authenticated;
revoke all on function private.can_access_player(uuid) from public, anon, authenticated;
grant execute on function private.is_club_admin() to authenticated;
grant execute on function private.can_access_player(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.guardians enable row level security;
alter table public.players enable row level security;
alter table public.player_guardians enable row level security;
alter table public.teams enable row level security;
alter table public.seasons enable row level security;
alter table public.player_enrollments enable row level security;
alter table public.fees enable row level security;
alter table public.payments enable row level security;

create policy profiles_read_own
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_club_admin()));

create policy guardians_admin_read
on public.guardians for select to authenticated
using ((select private.is_club_admin()));
create policy guardians_family_read_own
on public.guardians for select to authenticated
using (user_id = (select auth.uid()));
create policy guardians_admin_insert
on public.guardians for insert to authenticated
with check ((select private.is_club_admin()));
create policy guardians_admin_update
on public.guardians for update to authenticated
using ((select private.is_club_admin()))
with check ((select private.is_club_admin()));

create policy players_admin_read
on public.players for select to authenticated
using ((select private.is_club_admin()));
create policy players_family_read_linked
on public.players for select to authenticated
using ((select private.can_access_player(id)));
create policy players_admin_insert
on public.players for insert to authenticated
with check ((select private.is_club_admin()));
create policy players_admin_update
on public.players for update to authenticated
using ((select private.is_club_admin()))
with check ((select private.is_club_admin()));

create policy player_guardians_admin_read
on public.player_guardians for select to authenticated
using ((select private.is_club_admin()));
create policy player_guardians_family_read_own
on public.player_guardians for select to authenticated
using (
    exists (
        select 1
        from public.guardians g
        where g.id = guardian_id
          and g.user_id = (select auth.uid())
    )
);
create policy player_guardians_admin_insert
on public.player_guardians for insert to authenticated
with check ((select private.is_club_admin()));
create policy player_guardians_admin_update
on public.player_guardians for update to authenticated
using ((select private.is_club_admin()))
with check ((select private.is_club_admin()));
create policy player_guardians_admin_delete
on public.player_guardians for delete to authenticated
using ((select private.is_club_admin()));

create policy teams_admin_read
on public.teams for select to authenticated
using ((select private.is_club_admin()));
create policy teams_family_read_linked
on public.teams for select to authenticated
using (
    exists (
        select 1
        from public.player_enrollments pe
        where pe.team_id = teams.id
          and (select private.can_access_player(pe.player_id))
    )
);
create policy teams_admin_insert
on public.teams for insert to authenticated
with check ((select private.is_club_admin()));
create policy teams_admin_update
on public.teams for update to authenticated
using ((select private.is_club_admin()))
with check ((select private.is_club_admin()));

create policy seasons_admin_read
on public.seasons for select to authenticated
using ((select private.is_club_admin()));
create policy seasons_family_read_linked
on public.seasons for select to authenticated
using (
    exists (
        select 1
        from public.player_enrollments pe
        where pe.season_id = seasons.id
          and (select private.can_access_player(pe.player_id))
    )
);
create policy seasons_admin_insert
on public.seasons for insert to authenticated
with check ((select private.is_club_admin()));
create policy seasons_admin_update
on public.seasons for update to authenticated
using ((select private.is_club_admin()))
with check ((select private.is_club_admin()));

create policy player_enrollments_admin_read
on public.player_enrollments for select to authenticated
using ((select private.is_club_admin()));
create policy player_enrollments_family_read_linked
on public.player_enrollments for select to authenticated
using ((select private.can_access_player(player_id)));
create policy player_enrollments_admin_insert
on public.player_enrollments for insert to authenticated
with check ((select private.is_club_admin()));
create policy player_enrollments_admin_update
on public.player_enrollments for update to authenticated
using ((select private.is_club_admin()))
with check ((select private.is_club_admin()));

create policy fees_admin_read
on public.fees for select to authenticated
using ((select private.is_club_admin()));
create policy fees_family_read_linked
on public.fees for select to authenticated
using ((select private.can_access_player(player_id)));
create policy fees_admin_insert
on public.fees for insert to authenticated
with check ((select private.is_club_admin()));
create policy fees_admin_update
on public.fees for update to authenticated
using ((select private.is_club_admin()))
with check ((select private.is_club_admin()));

create policy payments_admin_read
on public.payments for select to authenticated
using ((select private.is_club_admin()));
create policy payments_family_read_linked
on public.payments for select to authenticated
using (
    exists (
        select 1
        from public.fees f
        where f.id = fee_id
          and (select private.can_access_player(f.player_id))
    )
);
create policy payments_admin_insert
on public.payments for insert to authenticated
with check ((select private.is_club_admin()));
create policy payments_admin_update
on public.payments for update to authenticated
using ((select private.is_club_admin()))
with check ((select private.is_club_admin()));

create view public.fee_balances with (security_invoker = true) as
select
    f.id as fee_id,
    f.player_id,
    f.season_id,
    f.description,
    f.amount_cents,
    coalesce(sum(p.amount_cents), 0)::bigint as paid_cents,
    greatest(f.amount_cents::bigint - coalesce(sum(p.amount_cents), 0), 0)::bigint as outstanding_cents,
    f.due_date,
    f.archived_at
from public.fees f
left join public.payments p on p.fee_id = f.id
group by f.id;

revoke all on table
    public.profiles,
    public.guardians,
    public.players,
    public.player_guardians,
    public.teams,
    public.seasons,
    public.player_enrollments,
    public.fees,
    public.payments,
    public.fee_balances
from anon, authenticated;

grant usage on schema public to authenticated;
grant select on table public.profiles to authenticated;
grant select, insert, update on table
    public.guardians,
    public.players,
    public.teams,
    public.seasons,
    public.player_enrollments,
    public.fees,
    public.payments
to authenticated;
grant select, insert, update, delete on table public.player_guardians to authenticated;
grant select on table public.fee_balances to authenticated;

commit;