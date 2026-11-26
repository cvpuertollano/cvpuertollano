begin;

alter table public.player_enrollments
    add column jersey_number text check (jersey_number is null or length(jersey_number) <= 20);

alter table public.guardians
    alter column user_id drop not null;

create table public.player_private_data (
    player_id uuid primary key references public.players (id) on delete cascade,
    date_of_birth date,
    identity_document text check (identity_document is null or length(identity_document) <= 40),
    address text check (address is null or length(address) <= 300),
    phone text check (phone is null or length(phone) <= 40),
    email text check (email is null or length(email) <= 254),
    nationality text check (nationality is null or length(nationality) <= 80),
    created_at timestamptz not null default now()
);

create table public.guardian_private_data (
    guardian_id uuid primary key references public.guardians (id) on delete cascade,
    identity_document text check (identity_document is null or length(identity_document) <= 40),
    created_at timestamptz not null default now()
);

alter table public.player_private_data enable row level security;
alter table public.guardian_private_data enable row level security;

create policy player_private_data_admin_read
on public.player_private_data for select to authenticated
using ((select private.is_club_admin()));
create policy player_private_data_admin_insert
on public.player_private_data for insert to authenticated
with check ((select private.is_club_admin()));
create policy player_private_data_admin_update
on public.player_private_data for update to authenticated
using ((select private.is_club_admin()))
with check ((select private.is_club_admin()));

create policy guardian_private_data_admin_read
on public.guardian_private_data for select to authenticated
using ((select private.is_club_admin()));
create policy guardian_private_data_admin_insert
on public.guardian_private_data for insert to authenticated
with check ((select private.is_club_admin()));
create policy guardian_private_data_admin_update
on public.guardian_private_data for update to authenticated
using ((select private.is_club_admin()))
with check ((select private.is_club_admin()));

revoke all on table public.player_private_data, public.guardian_private_data from anon, authenticated;
grant select, insert, update on table public.player_private_data, public.guardian_private_data to authenticated;

commit;