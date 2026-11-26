begin;

alter table public.payments
    add column import_source text unique check (import_source is null or length(import_source) <= 220);

create function public.import_crm_workbook(p_season_name text, p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_record jsonb;
    v_payment jsonb;
    v_player_private jsonb;
    v_guardian jsonb;
    v_season_ids uuid[];
    v_team_ids uuid[];
    v_player_ids uuid[];
    v_guardian_ids uuid[];
    v_fee_ids uuid[];
    v_season_id uuid;
    v_team_id uuid;
    v_player_id uuid;
    v_requested_player_id uuid;
    v_guardian_id uuid;
    v_fee_id uuid;
    v_match_count integer;
    v_fee_amount integer;
    v_payment_amount integer;
    v_paid_at date;
    v_existing_payment record;
    v_existing_paid bigint;
    v_source text;
    v_team_name text;
    v_first_name text;
    v_last_name text;
    v_guardian_name text;
    v_fee_description text;
    v_archived_at timestamptz;
    v_players_created integer := 0;
    v_players_reused integer := 0;
    v_guardians_created integer := 0;
    v_guardians_reused integer := 0;
    v_teams_created integer := 0;
    v_fees_created integer := 0;
    v_fees_reused integer := 0;
    v_payments_created integer := 0;
    v_payments_reused integer := 0;
    v_enrollments_written integer := 0;
begin
    if auth.uid() is null or not private.is_club_admin() then
        raise exception 'Solo una cuenta administradora puede importar libros.' using errcode = '42501';
    end if;
    if p_season_name is null or length(btrim(p_season_name)) not between 1 and 100 then
        raise exception 'El nombre de temporada no es válido.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_records) is distinct from 'array' then
        raise exception 'La importación debe contener una lista de jugadores.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_records) not between 1 and 250 then
        raise exception 'La importación debe contener entre 1 y 250 jugadores.' using errcode = '22023';
    end if;

    select array_agg(id), count(*)::integer
    into v_season_ids, v_match_count
    from public.seasons
    where lower(btrim(name)) = lower(btrim(p_season_name));

    if v_match_count > 1 then
        raise exception 'Hay temporadas duplicadas con el mismo nombre; resuélvelo antes de importar.' using errcode = '23505';
    elsif v_match_count = 1 then
        v_season_id := v_season_ids[1];
        select archived_at into v_archived_at from public.seasons where id = v_season_id;
        if v_archived_at is not null then
            raise exception 'La temporada está archivada; reactívala antes de importar.' using errcode = '22023';
        end if;
    else
        insert into public.seasons (name) values (btrim(p_season_name)) returning id into v_season_id;
    end if;

    v_fee_description := 'Cuota temporada ' || btrim(p_season_name);

    for v_record in select value from jsonb_array_elements(p_records)
    loop
        if jsonb_typeof(v_record) <> 'object' then
            raise exception 'Una fila de jugador no tiene un formato válido.' using errcode = '22023';
        end if;

        v_first_name := nullif(btrim(v_record->>'first_name'), '');
        v_last_name := nullif(btrim(v_record->>'last_name'), '');
        v_team_name := nullif(btrim(v_record->>'team_name'), '');
        v_requested_player_id := nullif(v_record->>'existing_player_id', '')::uuid;
        if v_first_name is null or v_last_name is null or v_team_name is null
           or length(v_first_name) > 100 or length(v_last_name) > 150 or length(v_team_name) > 100 then
            raise exception 'Hay un jugador sin nombre, apellidos o equipo válidos.' using errcode = '22023';
        end if;

        perform pg_advisory_xact_lock(hashtext(
            'crm-player:' || translate(lower(v_first_name), 'áéíóúüñ', 'aeiouun') || ':'
            || translate(lower(v_last_name), 'áéíóúüñ', 'aeiouun')
        ));

        select array_agg(id), count(*)::integer
        into v_team_ids, v_match_count
        from public.teams
        where lower(btrim(name)) = lower(v_team_name);
        if v_match_count > 1 then
            raise exception 'Hay equipos duplicados llamados "%".', v_team_name using errcode = '23505';
        elsif v_match_count = 1 then
            v_team_id := v_team_ids[1];
            select archived_at into v_archived_at from public.teams where id = v_team_id;
            if v_archived_at is not null then
                raise exception 'El equipo "%" está archivado; reactívalo antes de importar.', v_team_name using errcode = '22023';
            end if;
        else
            insert into public.teams (name) values (v_team_name) returning id into v_team_id;
            v_teams_created := v_teams_created + 1;
        end if;

        if v_requested_player_id is not null then
            select id, archived_at into v_player_id, v_archived_at
            from public.players
            where id = v_requested_player_id
              and translate(lower(btrim(first_name)), 'áéíóúüñ', 'aeiouun') = translate(lower(v_first_name), 'áéíóúüñ', 'aeiouun')
              and translate(lower(btrim(last_name)), 'áéíóúüñ', 'aeiouun') = translate(lower(v_last_name), 'áéíóúüñ', 'aeiouun');
            if not found then
                raise exception 'La ficha seleccionada para "% %" no coincide con la base actual.', v_first_name, v_last_name using errcode = '22023';
            end if;
            if v_archived_at is not null then
                raise exception 'La ficha de "% %" está archivada; reactívala antes de importar.', v_first_name, v_last_name using errcode = '22023';
            end if;
            v_players_reused := v_players_reused + 1;
        else
            select array_agg(id), count(*)::integer
            into v_player_ids, v_match_count
            from public.players
            where translate(lower(btrim(first_name)), 'áéíóúüñ', 'aeiouun') = translate(lower(v_first_name), 'áéíóúüñ', 'aeiouun')
              and translate(lower(btrim(last_name)), 'áéíóúüñ', 'aeiouun') = translate(lower(v_last_name), 'áéíóúüñ', 'aeiouun');
            if v_match_count > 1 then
                raise exception 'Hay varias fichas para "% %"; resuelve el duplicado antes de importar.', v_first_name, v_last_name using errcode = '23505';
            elsif v_match_count = 1 then
                v_player_id := v_player_ids[1];
                select archived_at into v_archived_at from public.players where id = v_player_id;
                if v_archived_at is not null then
                    raise exception 'La ficha de "% %" está archivada; reactívala antes de importar.', v_first_name, v_last_name using errcode = '22023';
                end if;
                v_players_reused := v_players_reused + 1;
            else
                insert into public.players (first_name, last_name)
                values (v_first_name, v_last_name)
                returning id into v_player_id;
                v_players_created := v_players_created + 1;
            end if;
        end if;

        v_player_private := coalesce(v_record->'player_private_data', '{}'::jsonb);
        if jsonb_typeof(v_player_private) <> 'object' then
            raise exception 'Los datos privados de "% %" no tienen un formato válido.', v_first_name, v_last_name using errcode = '22023';
        end if;
        insert into public.player_private_data (
            player_id, date_of_birth, identity_document, address, phone, email, nationality
        ) values (
            v_player_id,
            nullif(v_player_private->>'date_of_birth', '')::date,
            nullif(btrim(v_player_private->>'identity_document'), ''),
            nullif(btrim(v_player_private->>'address'), ''),
            nullif(btrim(v_player_private->>'phone'), ''),
            nullif(btrim(v_player_private->>'email'), ''),
            nullif(btrim(v_player_private->>'nationality'), '')
        )
        on conflict (player_id) do update set
            date_of_birth = coalesce(public.player_private_data.date_of_birth, excluded.date_of_birth),
            identity_document = coalesce(public.player_private_data.identity_document, excluded.identity_document),
            address = coalesce(public.player_private_data.address, excluded.address),
            phone = coalesce(public.player_private_data.phone, excluded.phone),
            email = coalesce(public.player_private_data.email, excluded.email),
            nationality = coalesce(public.player_private_data.nationality, excluded.nationality);

        v_guardian := v_record->'guardian';
        if jsonb_typeof(v_guardian) = 'object' then
            v_guardian_name := nullif(btrim(v_guardian->>'full_name'), '');
            if v_guardian_name is not null then
                if length(v_guardian_name) > 160
                   or length(coalesce(v_guardian->>'phone', '')) > 40
                   or length(coalesce(v_guardian->>'identity_document', '')) > 40 then
                    raise exception 'Los datos del tutor de "% %" superan el límite permitido.', v_first_name, v_last_name using errcode = '22023';
                end if;

                select array_agg(id), count(*)::integer
                into v_guardian_ids, v_match_count
                from public.guardians
                where translate(lower(btrim(full_name)), 'áéíóúüñ', 'aeiouun')
                    = translate(lower(v_guardian_name), 'áéíóúüñ', 'aeiouun');
                if v_match_count > 1 then
                    raise exception 'Hay varias fichas para el tutor "%"; resuelve el duplicado antes de importar.', v_guardian_name using errcode = '23505';
                elsif v_match_count = 1 then
                    v_guardian_id := v_guardian_ids[1];
                    select archived_at into v_archived_at from public.guardians where id = v_guardian_id;
                    if v_archived_at is not null then
                        raise exception 'La ficha del tutor "%" está archivada; reactívala antes de importar.', v_guardian_name using errcode = '22023';
                    end if;
                    v_guardians_reused := v_guardians_reused + 1;
                else
                    insert into public.guardians (user_id, full_name, phone)
                    values (null, v_guardian_name, nullif(btrim(v_guardian->>'phone'), ''))
                    returning id into v_guardian_id;
                    v_guardians_created := v_guardians_created + 1;
                end if;

                update public.guardians
                set phone = coalesce(phone, nullif(btrim(v_guardian->>'phone'), ''))
                where id = v_guardian_id;

                insert into public.guardian_private_data (guardian_id, identity_document)
                values (v_guardian_id, nullif(btrim(v_guardian->>'identity_document'), ''))
                on conflict (guardian_id) do update set
                    identity_document = coalesce(public.guardian_private_data.identity_document, excluded.identity_document);

                insert into public.player_guardians (player_id, guardian_id)
                values (v_player_id, v_guardian_id)
                on conflict (player_id, guardian_id) do nothing;
            end if;
        elsif v_guardian is not null and jsonb_typeof(v_guardian) <> 'null' then
            raise exception 'Los datos del tutor de "% %" no tienen un formato válido.', v_first_name, v_last_name using errcode = '22023';
        end if;

        if length(coalesce(v_record->>'jersey_number', '')) > 20 then
            raise exception 'El dorsal de "% %" supera el límite permitido.', v_first_name, v_last_name using errcode = '22023';
        end if;
        select archived_at into v_archived_at
        from public.player_enrollments
        where player_id = v_player_id and team_id = v_team_id and season_id = v_season_id;
        if found and v_archived_at is not null then
            raise exception 'La asignación de "% %" está archivada; reactívala antes de importar.', v_first_name, v_last_name using errcode = '22023';
        end if;
        insert into public.player_enrollments (player_id, team_id, season_id, jersey_number)
        values (v_player_id, v_team_id, v_season_id, nullif(btrim(v_record->>'jersey_number'), ''))
        on conflict (player_id, team_id, season_id) do update set
            jersey_number = coalesce(public.player_enrollments.jersey_number, excluded.jersey_number);
        v_enrollments_written := v_enrollments_written + 1;

        v_fee_amount := nullif(v_record->>'fee_amount_cents', '')::integer;
        if v_fee_amount is distinct from 15000 then
            raise exception 'La cuota de "% %" debe ser de 150 euros.', v_first_name, v_last_name using errcode = '22023';
        end if;
        select array_agg(id), count(*)::integer
        into v_fee_ids, v_match_count
        from public.fees
        where player_id = v_player_id
          and season_id = v_season_id
          and description = v_fee_description;
        if v_match_count > 1 then
            raise exception 'Hay cuotas duplicadas para "% %" en esta temporada.', v_first_name, v_last_name using errcode = '23505';
        elsif v_match_count = 1 then
            v_fee_id := v_fee_ids[1];
            select amount_cents, archived_at into v_payment_amount, v_archived_at from public.fees where id = v_fee_id;
            if v_payment_amount <> v_fee_amount then
                raise exception 'La cuota existente de "% %" no es de 150 euros; revísala antes de importar.', v_first_name, v_last_name using errcode = '22023';
            end if;
            if v_archived_at is not null then
                raise exception 'La cuota de "% %" está archivada; revísala antes de importar.', v_first_name, v_last_name using errcode = '22023';
            end if;
            v_fees_reused := v_fees_reused + 1;
        else
            insert into public.fees (player_id, season_id, description, amount_cents)
            values (v_player_id, v_season_id, v_fee_description, v_fee_amount)
            returning id into v_fee_id;
            v_fees_created := v_fees_created + 1;
        end if;

        if jsonb_typeof(v_record->'payments') is distinct from 'array' then
            raise exception 'Los pagos de "% %" no tienen un formato válido.', v_first_name, v_last_name using errcode = '22023';
        end if;
        for v_payment in select value from jsonb_array_elements(v_record->'payments')
        loop
            v_payment_amount := nullif(v_payment->>'amount_cents', '')::integer;
            v_paid_at := nullif(v_payment->>'paid_at', '')::date;
            v_source := nullif(btrim(v_payment->>'import_source'), '');
            if v_payment_amount is null or v_payment_amount <= 0 or v_payment_amount > v_fee_amount
               or v_paid_at is null or extract(year from v_paid_at) <> 2026
               or v_source is null or length(v_source) > 220 then
                raise exception 'Un pago de "% %" tiene importe, fecha o referencia de importación no válidos.', v_first_name, v_last_name using errcode = '22023';
            end if;

            select fee_id, amount_cents, paid_at, method
            into v_existing_payment
            from public.payments
            where import_source = v_source;
            if found then
                if v_existing_payment.fee_id <> v_fee_id
                   or v_existing_payment.amount_cents <> v_payment_amount
                   or v_existing_payment.paid_at <> v_paid_at
                   or v_existing_payment.method <> 'bank_transfer' then
                    raise exception 'La referencia de un pago ya existe con datos distintos; revisa el Excel.' using errcode = '23505';
                end if;
                v_payments_reused := v_payments_reused + 1;
            else
                select coalesce(sum(amount_cents), 0)::bigint into v_existing_paid
                from public.payments
                where fee_id = v_fee_id;
                if v_existing_paid + v_payment_amount > v_fee_amount then
                    raise exception 'Los pagos de "% %" superan la cuota de 150 euros.', v_first_name, v_last_name using errcode = '22023';
                end if;
                insert into public.payments (fee_id, amount_cents, paid_at, method, import_source)
                values (v_fee_id, v_payment_amount, v_paid_at, 'bank_transfer', v_source);
                v_payments_created := v_payments_created + 1;
            end if;
        end loop;
    end loop;

    return jsonb_build_object(
        'players_created', v_players_created,
        'players_reused', v_players_reused,
        'guardians_created', v_guardians_created,
        'guardians_reused', v_guardians_reused,
        'teams_created', v_teams_created,
        'fees_created', v_fees_created,
        'fees_reused', v_fees_reused,
        'payments_created', v_payments_created,
        'payments_reused', v_payments_reused,
        'enrollments_written', v_enrollments_written
    );
end;
$function$;

revoke all on function public.import_crm_workbook(text, jsonb) from public, anon, authenticated;
grant execute on function public.import_crm_workbook(text, jsonb) to authenticated;

commit;