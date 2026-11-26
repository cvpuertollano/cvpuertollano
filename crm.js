import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
    IMPORT_SEASON,
    SEASON_FEE_CENTS,
    buildWorkbookImportPlan as createWorkbookImportPlan,
    normalizeImportText,
    parsePaymentsWorkbook,
    parseRosterWorkbook,
    paymentCandidates
} from './crm-import.mjs';

const SUPABASE_URL = 'https://tpqpugpqzuelwmqgzrpp.supabase.co';
const SUPABASE_PUBLIC_KEY = 'sb_publishable_nVk9_qcPpWn4im1MLKWuZw_cf7klUZy';

const elements = {
    authPanel: document.getElementById('authPanel'),
    accessDenied: document.getElementById('accessDenied'),
    accessDeniedMessage: document.getElementById('accessDeniedMessage'),
    familyPanel: document.getElementById('familyPanel'),
    familyHeading: document.getElementById('familyHeading'),
    familyMessage: document.getElementById('familyMessage'),
    familyPlayers: document.getElementById('familyPlayers'),
    adminPanel: document.getElementById('adminPanel'),
    accountLabel: document.getElementById('accountLabel'),
    signOutButton: document.getElementById('signOutButton'),
    loginForm: document.getElementById('loginForm'),
    loginButton: document.getElementById('loginButton'),
    loginMessage: document.getElementById('loginMessage'),
    appMessage: document.getElementById('appMessage')
};

const state = {
    players: [],
    playerPrivateData: [],
    guardians: [],
    guardianPrivateData: [],
    playerGuardians: [],
    profiles: [],
    teams: [],
    seasons: [],
    enrollments: [],
    fees: [],
    balances: [],
    payments: []
};

let supabase;
let workbookImportDraft = null;
let spreadsheetLibraryPromise = null;

function setMessage(element, message, kind = '') {
    element.textContent = message;
    element.classList.remove('error', 'success');
    if (kind) element.classList.add(kind);
}

function formatMoney(cents) {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
}

function formatDate(value) {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
}

function localDateValue() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 10);
}

function centsFromInput(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
        throw new Error('Introduce un importe válido mayor que cero.');
    }
    const cents = Math.round(amount * 100);
    if (cents > 2147483647) throw new Error('El importe supera el máximo permitido.');
    return cents;
}

function tableCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value == null || value === '' ? '—' : String(value);
    row.append(cell);
    return cell;
}

function addStatusCell(row, archivedAt) {
    const cell = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = archivedAt ? 'status-pill archived' : 'status-pill';
    pill.textContent = archivedAt ? 'Archivado' : 'Activo';
    cell.append(pill);
    row.append(cell);
}

function addActionCell(row, actions) {
    const cell = document.createElement('td');
    const group = document.createElement('div');
    group.className = 'table-actions';
    actions.forEach(({ label, onClick, danger = false }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `button button-small${danger ? ' danger' : ''}`;
        button.textContent = label;
        button.addEventListener('click', onClick);
        group.append(button);
    });
    cell.append(group);
    row.append(cell);
}

function setEmptyRow(body, columnCount, message = 'No hay registros todavía.') {
    body.replaceChildren();
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.className = 'empty-row';
    cell.colSpan = columnCount;
    cell.textContent = message;
    row.append(cell);
    body.append(row);
}

async function fetchRows(table, orderBy = 'created_at') {
    const { data, error } = await supabase.from(table).select('*').order(orderBy, { ascending: true });
    if (error) throw error;
    return data || [];
}

async function readRows(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

function fillSelect(id, rows, labelFor, placeholder = 'Selecciona…') {
    const select = document.getElementById(id);
    const selected = select.multiple ? [] : select.value;
    select.replaceChildren();
    if (!select.multiple) {
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = placeholder;
        select.append(placeholderOption);
    }
    rows.forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = labelFor(item);
        if (select.multiple && selected.includes(item.id)) option.selected = true;
        select.append(option);
    });
    if (!select.multiple && rows.some(item => item.id === selected)) select.value = selected;
}

function nameForPlayer(id) {
    const player = state.players.find(item => item.id === id);
    return player ? `${player.first_name} ${player.last_name}` : 'Jugador archivado';
}

function nameForTeam(id) {
    return state.teams.find(item => item.id === id)?.name || 'Equipo archivado';
}

function nameForSeason(id) {
    return state.seasons.find(item => item.id === id)?.name || 'Temporada archivada';
}

function renderPlayers() {
    const body = document.getElementById('playersTable');
    if (!state.players.length) return setEmptyRow(body, 10);
    body.replaceChildren();
    state.players.forEach(player => {
        const row = document.createElement('tr');
        const privateData = state.playerPrivateData.find(item => item.player_id === player.id) || {};
        tableCell(row, `${player.first_name} ${player.last_name}`);
        tableCell(row, formatDate(privateData.date_of_birth));
        tableCell(row, privateData.identity_document);
        tableCell(row, privateData.address);
        tableCell(row, privateData.phone);
        tableCell(row, privateData.email);
        tableCell(row, privateData.nationality);
        const linkedGuardianIds = state.playerGuardians.filter(link => link.player_id === player.id).map(link => link.guardian_id);
        const guardianNames = state.guardians.filter(guardian => linkedGuardianIds.includes(guardian.id)).map(guardian => guardian.full_name);
        tableCell(row, guardianNames.join(', '));
        addStatusCell(row, player.archived_at);
        addActionCell(row, [
            { label: 'Editar', onClick: () => editPlayer(player) },
            { label: player.archived_at ? 'Reactivar' : 'Archivar', danger: !player.archived_at, onClick: () => toggleArchive('players', player.id, player.archived_at) }
        ]);
        body.append(row);
    });
}

function renderGuardians() {
    const body = document.getElementById('guardiansTable');
    if (!state.guardians.length) return setEmptyRow(body, 6);
    body.replaceChildren();
    state.guardians.forEach(guardian => {
        const row = document.createElement('tr');
        const privateData = state.guardianPrivateData.find(item => item.guardian_id === guardian.id) || {};
        tableCell(row, guardian.full_name);
        tableCell(row, guardian.user_id || 'Sin cuenta CRM');
        tableCell(row, guardian.phone);
        tableCell(row, privateData.identity_document);
        addStatusCell(row, guardian.archived_at);
        addActionCell(row, [
            { label: 'Editar', onClick: () => editGuardian(guardian) },
            { label: guardian.archived_at ? 'Reactivar' : 'Archivar', danger: !guardian.archived_at, onClick: () => toggleArchive('guardians', guardian.id, guardian.archived_at) }
        ]);
        body.append(row);
    });
}

function renderSimpleArchiveTable(bodyId, rows, columnCount, renderValues, table) {
    const body = document.getElementById(bodyId);
    if (!rows.length) return setEmptyRow(body, columnCount);
    body.replaceChildren();
    rows.forEach(item => {
        const row = document.createElement('tr');
        renderValues(row, item);
        addStatusCell(row, item.archived_at);
        const actions = [{ label: 'Editar', onClick: () => editNamedRecord(table, item) }];
        actions.push({ label: item.archived_at ? 'Reactivar' : 'Archivar', danger: !item.archived_at, onClick: () => toggleArchive(table, item.id, item.archived_at) });
        addActionCell(row, actions);
        body.append(row);
    });
}

function renderTeams() {
    renderSimpleArchiveTable('teamsTable', state.teams, 3, (row, team) => tableCell(row, team.name), 'teams');
}

function renderSeasons() {
    renderSimpleArchiveTable('seasonsTable', state.seasons, 5, (row, season) => {
        tableCell(row, season.name);
        tableCell(row, formatDate(season.starts_on));
        tableCell(row, formatDate(season.ends_on));
    }, 'seasons');
}

function renderEnrollments() {
    const body = document.getElementById('enrollmentsTable');
    if (!state.enrollments.length) return setEmptyRow(body, 6);
    body.replaceChildren();
    state.enrollments.forEach(enrollment => {
        const row = document.createElement('tr');
        tableCell(row, nameForPlayer(enrollment.player_id));
        tableCell(row, nameForTeam(enrollment.team_id));
        tableCell(row, nameForSeason(enrollment.season_id));
        tableCell(row, enrollment.jersey_number);
        addStatusCell(row, enrollment.archived_at);
        addActionCell(row, [
            { label: 'Editar', onClick: () => editEnrollment(enrollment) },
            { label: enrollment.archived_at ? 'Reactivar' : 'Archivar', danger: !enrollment.archived_at, onClick: () => toggleArchive('player_enrollments', enrollment.id, enrollment.archived_at) }
        ]);
        body.append(row);
    });
}

function renderFees() {
    const body = document.getElementById('feesTable');
    if (!state.balances.length) return setEmptyRow(body, 9);
    body.replaceChildren();
    state.balances.forEach(balance => {
        const fee = state.fees.find(item => item.id === balance.fee_id);
        const row = document.createElement('tr');
        tableCell(row, nameForPlayer(balance.player_id));
        tableCell(row, balance.description);
        tableCell(row, nameForSeason(balance.season_id));
        tableCell(row, formatMoney(balance.amount_cents));
        tableCell(row, formatMoney(balance.paid_cents));
        tableCell(row, formatMoney(balance.outstanding_cents));
        tableCell(row, formatDate(balance.due_date));
        addStatusCell(row, balance.archived_at);
        addActionCell(row, [
            { label: 'Editar', onClick: () => fee && editFee(fee) },
            { label: fee?.archived_at ? 'Reactivar' : 'Archivar', danger: !fee?.archived_at, onClick: () => fee && toggleArchive('fees', fee.id, fee.archived_at) }
        ]);
        body.append(row);
    });
}

function renderPayments() {
    const body = document.getElementById('paymentsTable');
    if (!state.payments.length) return setEmptyRow(body, 6);
    body.replaceChildren();
    state.payments.forEach(payment => {
        const fee = state.fees.find(item => item.id === payment.fee_id);
        const row = document.createElement('tr');
        tableCell(row, formatDate(payment.paid_at));
        tableCell(row, fee ? nameForPlayer(fee.player_id) : '—');
        tableCell(row, fee?.description);
        tableCell(row, formatMoney(payment.amount_cents));
        tableCell(row, { cash: 'Efectivo', bank_transfer: 'Transferencia', other: 'Otro' }[payment.method] || payment.method);
        tableCell(row, payment.reference);
        body.append(row);
    });
}

function updateSelects() {
    const activePlayers = state.players.filter(player => !player.archived_at);
    const activeTeams = state.teams.filter(team => !team.archived_at);
    const activeSeasons = state.seasons.filter(season => !season.archived_at);
    fillSelect('enrollmentPlayer', activePlayers, player => `${player.first_name} ${player.last_name}`);
    fillSelect('enrollmentTeam', activeTeams, team => team.name);
    fillSelect('enrollmentSeason', activeSeasons, season => season.name);
    fillSelect('feePlayer', activePlayers, player => `${player.first_name} ${player.last_name}`);
    fillSelect('feeSeason', activeSeasons, season => season.name);
    fillSelect('playerGuardians', state.guardians.filter(guardian => !guardian.archived_at), guardian => guardian.full_name);

    const currentGuardianId = document.getElementById('guardianId').value;
    const usedUserIds = new Set(state.guardians.filter(guardian => guardian.id !== currentGuardianId).map(guardian => guardian.user_id));
    const availableProfiles = state.profiles.filter(profile => !usedUserIds.has(profile.id));
    fillSelect('guardianUserId', availableProfiles, profile => profile.id, 'Sin cuenta CRM');

    const feeOptions = state.balances.filter(balance => balance.outstanding_cents > 0 && !balance.archived_at);
    fillSelect('paymentFee', feeOptions, balance => `${nameForPlayer(balance.player_id)} · ${balance.description} · pendiente ${formatMoney(balance.outstanding_cents)}`);
    updatePaymentBalance();
}

async function loadAdminData() {
    const [players, playerPrivateData, guardians, guardianPrivateData, playerGuardians, profiles, teams, seasons, enrollments, fees, balances, payments] = await Promise.all([
        fetchRows('players', 'last_name'),
        fetchRows('player_private_data'),
        fetchRows('guardians', 'full_name'),
        fetchRows('guardian_private_data'),
        fetchRows('player_guardians', 'created_at'),
        supabase.from('profiles').select('id, role').eq('role', 'family').then(({ data, error }) => {
            if (error) throw error;
            return data || [];
        }),
        fetchRows('teams', 'name'),
        fetchRows('seasons', 'name'),
        fetchRows('player_enrollments', 'created_at'),
        fetchRows('fees', 'created_at'),
        supabase.from('fee_balances').select('*').order('due_date', { ascending: true, nullsFirst: false }).then(({ data, error }) => {
            if (error) throw error;
            return data || [];
        }),
        supabase.from('payments').select('*').order('paid_at', { ascending: false }).then(({ data, error }) => {
            if (error) throw error;
            return data || [];
        })
    ]);
    Object.assign(state, { players, playerPrivateData, guardians, guardianPrivateData, playerGuardians, profiles, teams, seasons, enrollments, fees, balances, payments });
    updateSelects();
    renderPlayers();
    renderGuardians();
    renderTeams();
    renderSeasons();
    renderEnrollments();
    renderFees();
    renderPayments();
}

function clearEditForm(formId, titleId, defaultTitle, cancelId) {
    const form = document.getElementById(formId);
    form.reset();
    const hiddenId = form.querySelector('input[type="hidden"]');
    if (hiddenId) hiddenId.value = '';
    document.getElementById(titleId).textContent = defaultTitle;
    document.getElementById(cancelId).hidden = true;
    updateSelects();
}

function editPlayer(player) {
    const privateData = state.playerPrivateData.find(item => item.player_id === player.id) || {};
    document.getElementById('playerId').value = player.id;
    document.getElementById('playerFirstName').value = player.first_name;
    document.getElementById('playerLastName').value = player.last_name;
    document.getElementById('playerDateOfBirth').value = privateData.date_of_birth || '';
    document.getElementById('playerIdentityDocument').value = privateData.identity_document || '';
    document.getElementById('playerAddress').value = privateData.address || '';
    document.getElementById('playerPhone').value = privateData.phone || '';
    document.getElementById('playerEmail').value = privateData.email || '';
    document.getElementById('playerNationality').value = privateData.nationality || '';
    const guardianIds = state.playerGuardians.filter(link => link.player_id === player.id).map(link => link.guardian_id);
    Array.from(document.getElementById('playerGuardians').options).forEach(option => { option.selected = guardianIds.includes(option.value); });
    document.getElementById('playerFormTitle').textContent = 'Editar jugador';
    document.getElementById('cancelPlayerEdit').hidden = false;
    document.getElementById('playersPanel').scrollIntoView({ behavior: 'smooth' });
}

function editGuardian(guardian) {
    const privateData = state.guardianPrivateData.find(item => item.guardian_id === guardian.id) || {};
    document.getElementById('guardianId').value = guardian.id;
    updateSelects();
    document.getElementById('guardianUserId').value = guardian.user_id;
    document.getElementById('guardianUserId').disabled = true;
    document.getElementById('guardianName').value = guardian.full_name;
    document.getElementById('guardianPhone').value = guardian.phone || '';
    document.getElementById('guardianIdentityDocument').value = privateData.identity_document || '';
    document.getElementById('guardianFormTitle').textContent = 'Editar tutor';
    document.getElementById('cancelGuardianEdit').hidden = false;
    document.getElementById('guardiansPanel').scrollIntoView({ behavior: 'smooth' });
}

function editEnrollment(enrollment) {
    document.getElementById('enrollmentId').value = enrollment.id;
    updateSelects();
    ensureSelectOption('enrollmentPlayer', enrollment.player_id, nameForPlayer(enrollment.player_id));
    ensureSelectOption('enrollmentTeam', enrollment.team_id, nameForTeam(enrollment.team_id));
    ensureSelectOption('enrollmentSeason', enrollment.season_id, nameForSeason(enrollment.season_id));
    document.getElementById('enrollmentPlayer').value = enrollment.player_id;
    document.getElementById('enrollmentTeam').value = enrollment.team_id;
    document.getElementById('enrollmentSeason').value = enrollment.season_id;
    document.getElementById('enrollmentJerseyNumber').value = enrollment.jersey_number || '';
    document.getElementById('enrollmentFormTitle').textContent = 'Editar asignación';
    document.getElementById('cancelEnrollmentEdit').hidden = false;
    document.getElementById('enrollmentsPanel').scrollIntoView({ behavior: 'smooth' });
}

function editNamedRecord(table, item) {
    if (table === 'teams') {
        document.getElementById('teamId').value = item.id;
        document.getElementById('teamName').value = item.name;
        document.getElementById('teamFormTitle').textContent = 'Editar equipo';
        document.getElementById('cancelTeamEdit').hidden = false;
        document.getElementById('teamsPanel').scrollIntoView({ behavior: 'smooth' });
        return;
    }
    document.getElementById('seasonId').value = item.id;
    document.getElementById('seasonName').value = item.name;
    document.getElementById('seasonStart').value = item.starts_on || '';
    document.getElementById('seasonEnd').value = item.ends_on || '';
    document.getElementById('seasonFormTitle').textContent = 'Editar temporada';
    document.getElementById('cancelSeasonEdit').hidden = false;
    document.getElementById('seasonsPanel').scrollIntoView({ behavior: 'smooth' });
}

function editFee(fee) {
    document.getElementById('feeId').value = fee.id;
    ensureSelectOption('feePlayer', fee.player_id, nameForPlayer(fee.player_id));
    ensureSelectOption('feeSeason', fee.season_id, nameForSeason(fee.season_id));
    document.getElementById('feePlayer').value = fee.player_id;
    document.getElementById('feeSeason').value = fee.season_id;
    document.getElementById('feeDescription').value = fee.description;
    document.getElementById('feeAmount').value = (fee.amount_cents / 100).toFixed(2);
    document.getElementById('feeDueDate').value = fee.due_date || '';
    document.getElementById('feeFormTitle').textContent = 'Editar cuota';
    document.getElementById('cancelFeeEdit').hidden = false;
    document.getElementById('feesPanel').scrollIntoView({ behavior: 'smooth' });
}

function ensureSelectOption(selectId, value, label) {
    const select = document.getElementById(selectId);
    if (!Array.from(select.options).some(option => option.value === value)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `${label} (archivado)`;
        select.append(option);
    }
}

async function syncPlayerGuardians(playerId, selectedGuardianIds) {
    const { data: currentLinks, error: readError } = await supabase.from('player_guardians').select('guardian_id').eq('player_id', playerId);
    if (readError) throw readError;
    const currentIds = (currentLinks || []).map(link => link.guardian_id);
    const toRemove = currentIds.filter(id => !selectedGuardianIds.includes(id));
    const toAdd = selectedGuardianIds.filter(id => !currentIds.includes(id));
    if (toRemove.length) {
        const { error } = await supabase.from('player_guardians').delete().eq('player_id', playerId).in('guardian_id', toRemove);
        if (error) throw error;
    }
    if (toAdd.length) {
        const { error } = await supabase.from('player_guardians').insert(toAdd.map(guardianId => ({ player_id: playerId, guardian_id: guardianId })));
        if (error) throw error;
    }
}

function registerForm(formId, messageId, onSubmit, successMessage) {
    const form = document.getElementById(formId);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        setMessage(document.getElementById(messageId), 'Guardando…');
        try {
            await onSubmit(new FormData(form));
            setMessage(document.getElementById(messageId), successMessage, 'success');
            await loadAdminData();
        } catch (error) {
            setMessage(document.getElementById(messageId), error.message || 'No se pudo guardar el registro.', 'error');
        } finally {
            button.disabled = false;
        }
    });
}

function registerAdminForms() {
    registerForm('playerForm', 'playerMessage', async data => {
        const playerId = data.get('id');
        const payload = { first_name: data.get('first_name').trim(), last_name: data.get('last_name').trim() };
        const nullableValue = name => data.get(name).trim() || null;
        let savedId = playerId;
        if (playerId) {
            const { error } = await supabase.from('players').update(payload).eq('id', playerId);
            if (error) throw error;
        } else {
            const { data: saved, error } = await supabase.from('players').insert(payload).select('id').single();
            if (error) throw error;
            savedId = saved.id;
            document.getElementById('playerId').value = savedId;
            document.getElementById('playerFormTitle').textContent = 'Completar jugador';
            document.getElementById('cancelPlayerEdit').hidden = false;
        }
        const privatePayload = {
            player_id: savedId,
            date_of_birth: nullableValue('date_of_birth'),
            identity_document: nullableValue('identity_document'),
            address: nullableValue('address'),
            phone: nullableValue('phone'),
            email: nullableValue('email'),
            nationality: nullableValue('nationality')
        };
        const { error: privateDataError } = await supabase.from('player_private_data').upsert(privatePayload, { onConflict: 'player_id' });
        if (privateDataError) throw privateDataError;
        await syncPlayerGuardians(savedId, data.getAll('guardian_ids'));
        clearEditForm('playerForm', 'playerFormTitle', 'Añadir jugador', 'cancelPlayerEdit');
    }, 'Jugador guardado.');

    registerForm('guardianForm', 'guardianMessage', async data => {
        const id = data.get('id');
        const payload = { full_name: data.get('full_name').trim(), phone: data.get('phone').trim() || null };
        let savedId = id;
        if (id) {
            const { error } = await supabase.from('guardians').update(payload).eq('id', id);
            if (error) throw error;
        } else {
            const { data: saved, error } = await supabase.from('guardians').insert({ ...payload, user_id: data.get('user_id') || null }).select('id').single();
            if (error) throw error;
            savedId = saved.id;
        }
        const { error: privateDataError } = await supabase.from('guardian_private_data').upsert({
            guardian_id: savedId,
            identity_document: data.get('identity_document').trim() || null
        }, { onConflict: 'guardian_id' });
        if (privateDataError) throw privateDataError;
        clearEditForm('guardianForm', 'guardianFormTitle', 'Añadir tutor', 'cancelGuardianEdit');
        document.getElementById('guardianUserId').disabled = false;
    }, 'Tutor guardado.');

    registerForm('teamForm', 'teamMessage', async data => {
        const id = data.get('id');
        const payload = { name: data.get('name').trim() };
        const result = id
            ? await supabase.from('teams').update(payload).eq('id', id)
            : await supabase.from('teams').insert(payload);
        if (result.error) throw result.error;
        clearEditForm('teamForm', 'teamFormTitle', 'Añadir equipo', 'cancelTeamEdit');
    }, 'Equipo guardado.');

    registerForm('seasonForm', 'seasonMessage', async data => {
        const id = data.get('id');
        const payload = {
            name: data.get('name').trim(),
            starts_on: data.get('starts_on') || null,
            ends_on: data.get('ends_on') || null
        };
        const result = id
            ? await supabase.from('seasons').update(payload).eq('id', id)
            : await supabase.from('seasons').insert(payload);
        if (result.error) throw result.error;
        clearEditForm('seasonForm', 'seasonFormTitle', 'Añadir temporada', 'cancelSeasonEdit');
    }, 'Temporada guardada.');

    registerForm('enrollmentForm', 'enrollmentMessage', async data => {
        const id = data.get('id');
        const payload = {
            player_id: data.get('player_id'),
            team_id: data.get('team_id'),
            season_id: data.get('season_id'),
            jersey_number: data.get('jersey_number').trim() || null
        };
        const result = id
            ? await supabase.from('player_enrollments').update(payload).eq('id', id)
            : await supabase.from('player_enrollments').insert(payload);
        const { error } = result;
        if (error) throw error;
        clearEditForm('enrollmentForm', 'enrollmentFormTitle', 'Añadir asignación', 'cancelEnrollmentEdit');
    }, 'Asignación creada.');

    registerForm('feeForm', 'feeMessage', async data => {
        const id = data.get('id');
        const payload = {
            player_id: data.get('player_id'),
            season_id: data.get('season_id'),
            description: data.get('description').trim(),
            amount_cents: centsFromInput(data.get('amount')),
            due_date: data.get('due_date') || null
        };
        const previousBalance = id && state.balances.find(balance => balance.fee_id === id);
        if (previousBalance && payload.amount_cents < previousBalance.paid_cents) {
            throw new Error(`El importe no puede ser inferior a lo ya pagado (${formatMoney(previousBalance.paid_cents)}).`);
        }
        const result = id
            ? await supabase.from('fees').update(payload).eq('id', id)
            : await supabase.from('fees').insert(payload);
        if (result.error) throw result.error;
        clearEditForm('feeForm', 'feeFormTitle', 'Añadir cuota', 'cancelFeeEdit');
    }, 'Cuota guardada.');

    registerForm('paymentForm', 'paymentMessage', async data => {
        const feeId = data.get('fee_id');
        const balance = state.balances.find(item => item.fee_id === feeId);
        const amountCents = centsFromInput(data.get('amount'));
        if (!balance || balance.outstanding_cents <= 0) throw new Error('Selecciona una cuota pendiente.');
        if (amountCents > balance.outstanding_cents) throw new Error(`El pago supera el saldo pendiente (${formatMoney(balance.outstanding_cents)}).`);
        const payload = {
            fee_id: feeId,
            amount_cents: amountCents,
            paid_at: data.get('paid_at'),
            method: data.get('method'),
            reference: data.get('reference').trim() || null
        };
        const { error } = await supabase.from('payments').insert(payload);
        if (error) throw error;
        document.getElementById('paymentForm').reset();
        document.getElementById('paymentDate').value = localDateValue();
    }, 'Pago registrado.');
}

async function toggleArchive(table, id, archivedAt) {
    const action = archivedAt ? 'reactivar' : 'archivar';
    if (!window.confirm(`¿Quieres ${action} este registro?`)) return;
    try {
        const { error } = await supabase.from(table).update({ archived_at: archivedAt ? null : new Date().toISOString() }).eq('id', id);
        if (error) throw error;
        setMessage(elements.appMessage, 'Estado actualizado.', 'success');
        await loadAdminData();
    } catch (error) {
        setMessage(elements.appMessage, error.message || 'No se pudo actualizar el estado.', 'error');
    }
}

function updatePaymentBalance() {
    const feeId = document.getElementById('paymentFee').value;
    const balance = state.balances.find(item => item.fee_id === feeId);
    document.getElementById('paymentBalance').textContent = balance ? `Saldo pendiente: ${formatMoney(balance.outstanding_cents)}` : '';
}

const MAX_WORKBOOK_BYTES = 15 * 1024 * 1024;

function loadSpreadsheetLibrary() {
    if (window.XLSX?.read) return Promise.resolve(window.XLSX);
    if (spreadsheetLibraryPromise) return spreadsheetLibraryPromise;
    spreadsheetLibraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
        script.onload = () => window.XLSX?.read
            ? resolve(window.XLSX)
            : reject(new Error('No se pudo inicializar el lector de Excel.'));
        script.onerror = () => reject(new Error('No se pudo cargar el lector de Excel; comprueba la conexión e inténtalo otra vez.'));
        document.head.append(script);
    });
    return spreadsheetLibraryPromise;
}

async function readWorkbookFile(file, XLSX) {
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error(`“${file.name}” no parece un archivo Excel compatible.`);
    if (!file.size || file.size > MAX_WORKBOOK_BYTES) throw new Error('Cada libro debe ocupar entre 1 byte y 15 MB.');
    if (!window.crypto?.subtle) throw new Error('La importación requiere una conexión segura HTTPS para generar claves de idempotencia.');
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: 'array', cellDates: false });
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    return { workbook, hash };
}

function importCandidatesFor(paymentRow) {
    const staged = workbookImportDraft.rosterRows
        .filter(player => player.team_name === paymentRow.team_name)
        .map(player => ({ key: `roster:${player.key}`, full_name: player.full_name, kind: 'roster', player }));
    const stagedNames = new Set(workbookImportDraft.rosterRows.map(player => normalizeImportText(player.full_name)));
    const existing = state.players
        .filter(player => !stagedNames.has(normalizeImportText(`${player.first_name} ${player.last_name}`)))
        .map(player => ({ key: `existing:${player.id}`, full_name: `${player.first_name} ${player.last_name}`, kind: 'existing', player }));
    return [...staged, ...existing];
}

function initializePaymentMappings() {
    workbookImportDraft.paymentRows.forEach(paymentRow => {
        const candidates = paymentCandidates(paymentRow.player_name, importCandidatesFor(paymentRow));
        if (candidates.length === 1) {
            paymentRow.mapping.selection = candidates[0].key;
        }
    });
}

function setImportMappingFromControl(paymentRow, value) {
    paymentRow.mapping.selection = value;
}

function renderWorkbookImportMappings() {
    const body = document.getElementById('workbookImportMappings');
    body.replaceChildren();
    if (!workbookImportDraft?.paymentRows.length) return setEmptyRow(body, 5, 'El libro no contiene filas de pagos reconocibles.');

    workbookImportDraft.paymentRows.forEach(paymentRow => {
        const row = document.createElement('tr');
        tableCell(row, `${paymentRow.source.sheet} · fila ${paymentRow.source.row}`);
        tableCell(row, paymentRow.player_name);
        tableCell(row, paymentRow.team_name);
        const paymentLabels = paymentRow.payments.map(payment => payment.paid_at ? formatDate(payment.paid_at) : payment.issue);
        tableCell(row, `${paymentRow.plan_text || 'Sin modalidad'}${paymentLabels.length ? ` · ${paymentLabels.join(', ')}` : ' · Sin fechas'}`);

        const mappingCell = document.createElement('td');
        const select = document.createElement('select');
        select.className = 'import-mapping-select';
        select.dataset.paymentRow = paymentRow.key;
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Selecciona o resuelve el alias…';
        select.append(placeholder);
        importCandidatesFor(paymentRow).forEach(candidate => {
            const option = document.createElement('option');
            option.value = candidate.key;
            option.textContent = `${candidate.full_name}${candidate.kind === 'roster' ? ' · libro de jugadores' : ' · ya existe en CRM'}`;
            select.append(option);
        });
        const newOption = document.createElement('option');
        newOption.value = 'new';
        newOption.textContent = 'Crear ficha adicional…';
        select.append(newOption);
        const skipOption = document.createElement('option');
        skipOption.value = 'skip';
        skipOption.textContent = 'Omitir esta fila de pagos';
        select.append(skipOption);
        select.value = paymentRow.mapping.selection || '';
        mappingCell.append(select);

        const manualFields = document.createElement('div');
        manualFields.className = 'import-new-fields';
        manualFields.hidden = paymentRow.mapping.selection !== 'new' && paymentRow.payments.length > 0;
        if (paymentRow.mapping.selection === 'new') {
            const nameLabel = document.createElement('label');
            nameLabel.textContent = 'Nombre completo de la ficha nueva';
            const nameInput = document.createElement('input');
            nameInput.className = 'import-new-name';
            nameInput.type = 'text';
            nameInput.maxLength = 250;
            nameInput.autocomplete = 'off';
            nameInput.placeholder = 'Nombre y apellidos';
            nameInput.value = paymentRow.mapping.newName;
            nameInput.dataset.importField = 'newName';
            nameInput.dataset.paymentRow = paymentRow.key;
            nameLabel.append(nameInput);
            manualFields.append(nameLabel);
        }
        if (!manualFields.hidden) {
            const amountLabel = document.createElement('label');
            amountLabel.textContent = 'Pago manual confirmado (opcional, €)';
            const amountInput = document.createElement('input');
            amountInput.className = 'import-manual-field';
            amountInput.type = 'number';
            amountInput.min = '0.01';
            amountInput.max = '150';
            amountInput.step = '0.01';
            amountInput.inputMode = 'decimal';
            amountInput.value = paymentRow.mapping.manualAmount;
            amountInput.dataset.importField = 'manualAmount';
            amountInput.dataset.paymentRow = paymentRow.key;
            amountLabel.append(amountInput);
            manualFields.append(amountLabel);

            const dateLabel = document.createElement('label');
            dateLabel.textContent = 'Fecha real del pago';
            const dateInput = document.createElement('input');
            dateInput.className = 'import-manual-field';
            dateInput.type = 'date';
            dateInput.min = '2026-01-01';
            dateInput.max = '2026-12-31';
            dateInput.value = paymentRow.mapping.manualDate;
            dateInput.dataset.importField = 'manualDate';
            dateInput.dataset.paymentRow = paymentRow.key;
            dateLabel.append(dateInput);
            manualFields.append(dateLabel);
        }
        mappingCell.append(manualFields);
        row.append(mappingCell);
        body.append(row);
    });
}

function buildWorkbookImportPlan() {
    return createWorkbookImportPlan(workbookImportDraft, state);
}

function renderWorkbookImportRoster(records) {
    const body = document.getElementById('workbookImportRoster');
    body.replaceChildren();
    if (!records.length) return setEmptyRow(body, 12, 'No hay fichas preparadas.');
    records.forEach(record => {
        const row = document.createElement('tr');
        tableCell(row, record.full_name);
        tableCell(row, record.team_name);
        tableCell(row, record.jersey_number);
        tableCell(row, formatDate(record.date_of_birth));
        tableCell(row, record.identity_document);
        tableCell(row, record.address);
        tableCell(row, record.phone);
        tableCell(row, record.email);
        tableCell(row, record.nationality);
        tableCell(row, record.guardian?.full_name);
        tableCell(row, record.guardian?.phone);
        tableCell(row, record.guardian?.identity_document);
        body.append(row);
    });
}

function updateWorkbookImportPreview() {
    if (!workbookImportDraft) return;
    const plan = buildWorkbookImportPlan();
    const summary = document.getElementById('workbookImportSummary');
    summary.textContent = `${plan.records.length} fichas · ${plan.paymentCount} movimientos por ${formatMoney(plan.totalCents)} · temporada ${IMPORT_SEASON}. Se crearán cuotas de 150 € por ficha; las filas sin pagos quedarán con saldo pendiente.`;
    const issues = document.getElementById('workbookImportIssues');
    issues.replaceChildren();
    [...plan.errors, ...plan.warnings].slice(0, 100).forEach((issue, index) => {
        const item = document.createElement('li');
        item.textContent = issue;
        if (index >= plan.errors.length) item.className = 'warning';
        issues.append(item);
    });
    if (plan.errors.length + plan.warnings.length > 100) {
        const item = document.createElement('li');
        item.textContent = `Se omiten ${plan.errors.length + plan.warnings.length - 100} avisos adicionales en esta vista.`;
        item.className = 'warning';
        issues.append(item);
    }
    document.getElementById('confirmWorkbookImport').disabled = Boolean(plan.errors.length || !plan.records.length);
    renderWorkbookImportRoster(plan.records);
}

async function prepareWorkbookImport(event) {
    event.preventDefault();
    const rosterFile = document.getElementById('rosterWorkbook').files[0];
    const paymentsFile = document.getElementById('paymentsWorkbook').files[0];
    if (!rosterFile || !paymentsFile) return;
    const button = document.getElementById('prepareWorkbookImport');
    button.disabled = true;
    setMessage(document.getElementById('workbookImportMessage'), 'Leyendo los archivos localmente…');
    try {
        const XLSX = await loadSpreadsheetLibrary();
        const [rosterSource, paymentSource] = await Promise.all([
            readWorkbookFile(rosterFile, XLSX),
            readWorkbookFile(paymentsFile, XLSX)
        ]);
        const roster = parseRosterWorkbook(rosterSource.workbook, XLSX);
        const payments = parsePaymentsWorkbook(paymentSource.workbook, XLSX);
        workbookImportDraft = {
            rosterRows: roster.players,
            paymentRows: payments.rows,
            paymentHash: paymentSource.hash,
            errors: [...roster.errors, ...payments.errors]
        };
        initializePaymentMappings();
        document.getElementById('workbookImportPreview').hidden = false;
        renderWorkbookImportMappings();
        updateWorkbookImportPreview();
        setMessage(document.getElementById('workbookImportMessage'), 'Vista previa lista. Los archivos siguen en este navegador.', 'success');
    } catch (error) {
        setMessage(document.getElementById('workbookImportMessage'), error.message || 'No se pudieron leer los libros.', 'error');
    } finally {
        button.disabled = false;
    }
}

function clearWorkbookImportPreview() {
    workbookImportDraft = null;
    document.getElementById('workbookImportPreview').hidden = true;
    document.getElementById('workbookImportMappings').replaceChildren();
    document.getElementById('workbookImportRoster').replaceChildren();
    document.getElementById('confirmWorkbookImport').disabled = true;
}

async function confirmWorkbookImport() {
    const plan = buildWorkbookImportPlan();
    if (plan.errors.length || !plan.records.length) {
        updateWorkbookImportPreview();
        return;
    }
    const confirmation = `Importar ${plan.records.length} fichas, sus cuotas y ${plan.paymentCount} movimientos por ${formatMoney(plan.totalCents)} en la temporada ${IMPORT_SEASON}. ¿Continuar?`;
    if (!window.confirm(confirmation)) return;

    const button = document.getElementById('confirmWorkbookImport');
    button.disabled = true;
    setMessage(document.getElementById('workbookImportMessage'), 'Importando en una transacción…');
    try {
        const records = plan.records.map(record => ({
            first_name: record.first_name,
            last_name: record.last_name,
            team_name: record.team_name,
            existing_player_id: record.existingPlayerId,
            jersey_number: record.jersey_number || null,
            player_private_data: {
                date_of_birth: record.date_of_birth || null,
                identity_document: record.identity_document || null,
                address: record.address || null,
                phone: record.phone || null,
                email: record.email || null,
                nationality: record.nationality || null
            },
            guardian: record.guardian ? {
                full_name: record.guardian.full_name,
                phone: record.guardian.phone || null,
                identity_document: record.guardian.identity_document || null
            } : null,
            fee_amount_cents: SEASON_FEE_CENTS,
            payments: record.payments
        }));
        const { data, error } = await supabase.rpc('import_crm_workbook', {
            p_season_name: IMPORT_SEASON,
            p_records: records
        });
        if (error) {
            const message = error.message || 'Supabase rechazó la importación.';
            if (/import_crm_workbook|schema cache|function .* does not exist/i.test(message)) {
                throw new Error('Falta aplicar la migración supabase/migrations/20261126170000_add_crm_workbook_import.sql en Supabase. No se guardó ningún dato.');
            }
            throw new Error(message);
        }
        clearWorkbookImportPreview();
        document.getElementById('workbookImportForm').reset();
        const resultMessage = `Carga completada: ${data.players_created} jugadores nuevos, ${data.players_reused} reutilizados, ${data.guardians_created} tutores nuevos y ${data.payments_created} pagos registrados (${data.payments_reused} ya estaban importados).`;
        setMessage(document.getElementById('workbookImportMessage'), resultMessage, 'success');
        try {
            await loadAdminData();
            setMessage(elements.appMessage, 'Importación confirmada y datos actualizados.', 'success');
        } catch (refreshError) {
            setMessage(elements.appMessage, `La importación se completó, pero no se pudo actualizar la vista: ${refreshError.message}`, 'error');
        }
    } catch (error) {
        setMessage(document.getElementById('workbookImportMessage'), error.message || 'No se pudo completar la importación; la transacción se revirtió.', 'error');
        updateWorkbookImportPreview();
    } finally {
        button.disabled = false;
    }
}

function setupWorkbookImport() {
    document.getElementById('workbookImportForm').addEventListener('submit', prepareWorkbookImport);
    ['rosterWorkbook', 'paymentsWorkbook'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            if (!workbookImportDraft) return;
            clearWorkbookImportPreview();
            setMessage(document.getElementById('workbookImportMessage'), 'Cambió uno de los archivos. Prepara una nueva vista previa antes de importar.');
        });
    });
    document.getElementById('confirmWorkbookImport').addEventListener('click', confirmWorkbookImport);
    document.getElementById('cancelWorkbookImport').addEventListener('click', () => {
        clearWorkbookImportPreview();
        document.getElementById('workbookImportForm').reset();
        setMessage(document.getElementById('workbookImportMessage'), 'Vista previa descartada. No se guardó ningún dato.');
    });
    const mappings = document.getElementById('workbookImportMappings');
    mappings.addEventListener('change', event => {
        if (event.target.matches('[data-payment-row]') && event.target.tagName === 'SELECT') {
            const paymentRow = workbookImportDraft?.paymentRows.find(item => item.key === event.target.dataset.paymentRow);
            if (!paymentRow) return;
            setImportMappingFromControl(paymentRow, event.target.value);
            renderWorkbookImportMappings();
            updateWorkbookImportPreview();
        }
    });
    mappings.addEventListener('input', event => {
        const { paymentRow: rowKey, importField } = event.target.dataset;
        if (!rowKey || !importField) return;
        const paymentRow = workbookImportDraft?.paymentRows.find(item => item.key === rowKey);
        if (!paymentRow) return;
        paymentRow.mapping[importField] = event.target.value;
        updateWorkbookImportPreview();
    });
}

function appendFamilyText(parent, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
}

function renderFamilyPortal(data) {
    elements.familyPlayers.replaceChildren();
    if (!data.players.length) {
        appendFamilyText(elements.familyPlayers, 'p', 'family-empty', 'El club todavía no ha vinculado jugadores a esta cuenta. Contacta con administración si crees que es un error.');
        return;
    }

    data.players.forEach(player => {
        const card = document.createElement('article');
        card.className = 'family-card';
        appendFamilyText(card, 'h2', '', `${player.first_name} ${player.last_name}`);

        const enrollments = data.enrollments.filter(item => item.player_id === player.id);
        const enrollmentLabels = enrollments.map(item => {
            const team = data.teams.find(row => row.id === item.team_id)?.name;
            const season = data.seasons.find(row => row.id === item.season_id)?.name;
            return [team, season].filter(Boolean).join(' · ');
        }).filter(Boolean);
        appendFamilyText(card, 'p', 'family-detail', enrollmentLabels.length ? `Equipo y temporada: ${enrollmentLabels.join(', ')}` : 'Sin equipo o temporada asignados.');

        const playerFees = data.fees.filter(fee => fee.player_id === player.id);
        if (!playerFees.length) {
            appendFamilyText(card, 'p', 'family-detail', 'No hay cuotas registradas para este jugador.');
        }
        playerFees.forEach(fee => {
            const feeSection = document.createElement('section');
            appendFamilyText(feeSection, 'h3', '', fee.description);
            const season = data.seasons.find(row => row.id === fee.season_id)?.name || 'Temporada';
            appendFamilyText(feeSection, 'p', 'family-detail', `${season} · Cuota: ${formatMoney(fee.amount_cents)} · Vencimiento: ${formatDate(fee.due_date)}`);
            const balance = data.balances.find(item => item.fee_id === fee.id);
            if (balance) {
                appendFamilyText(feeSection, 'p', 'family-detail', `Pagado: ${formatMoney(balance.paid_cents)} · Pendiente: ${formatMoney(balance.outstanding_cents)}`);
            }

            const payments = data.payments.filter(payment => payment.fee_id === fee.id);
            appendFamilyText(feeSection, 'h3', '', 'Movimientos');
            if (payments.length) {
                const list = document.createElement('ul');
                list.className = 'family-payments';
                payments.forEach(payment => {
                    const method = { cash: 'Efectivo', bank_transfer: 'Transferencia', other: 'Otro' }[payment.method] || payment.method;
                    const reference = payment.reference ? ` · Ref.: ${payment.reference}` : '';
                    appendFamilyText(list, 'li', '', `${formatDate(payment.paid_at)} · ${formatMoney(payment.amount_cents)} · ${method}${reference}`);
                });
                feeSection.append(list);
            } else {
                appendFamilyText(feeSection, 'p', 'family-detail', 'Sin pagos registrados.');
            }
            card.append(feeSection);
        });
        elements.familyPlayers.append(card);
    });
}

async function openFamilyAccount(user) {
    clearAdminState();
    clearFamilyState();
    elements.authPanel.hidden = true;
    elements.accessDenied.hidden = true;
    elements.adminPanel.hidden = true;
    elements.familyPanel.hidden = false;
    elements.accountLabel.textContent = user.email || 'Sesión iniciada';
    elements.accountLabel.hidden = false;
    elements.signOutButton.hidden = false;
    setMessage(elements.familyMessage, 'Cargando información…');

    try {
        const { data: guardian, error: guardianError } = await supabase.from('guardians')
            .select('id, full_name')
            .eq('user_id', user.id)
            .maybeSingle();
        if (guardianError) throw guardianError;
        if (!guardian) {
            setMessage(elements.familyMessage, 'El club todavía no ha vinculado esta cuenta con un tutor.', 'error');
            return;
        }
        elements.familyHeading.textContent = `Hola, ${guardian.full_name}`;

        const [players, enrollments, teams, seasons, fees, balances, payments] = await Promise.all([
            readRows(supabase.from('players').select('id, first_name, last_name, archived_at').order('last_name')),
            readRows(supabase.from('player_enrollments').select('id, player_id, team_id, season_id, archived_at')),
            readRows(supabase.from('teams').select('id, name')),
            readRows(supabase.from('seasons').select('id, name')),
            readRows(supabase.from('fees').select('id, player_id, season_id, description, amount_cents, due_date, archived_at')),
            readRows(supabase.from('fee_balances').select('fee_id, paid_cents, outstanding_cents')),
            readRows(supabase.from('payments').select('id, fee_id, amount_cents, paid_at, method, reference').order('paid_at', { ascending: false }))
        ]);
        renderFamilyPortal({ players, enrollments, teams, seasons, fees, balances, payments });
        setMessage(elements.familyMessage, 'Información actualizada.', 'success');
    } catch (error) {
        setMessage(elements.familyMessage, error.message || 'No se pudo cargar la información familiar.', 'error');
    }
}

function showLogin(message = '') {
    clearAdminState();
    clearFamilyState();
    elements.authPanel.hidden = false;
    elements.accessDenied.hidden = true;
    elements.familyPanel.hidden = true;
    elements.adminPanel.hidden = true;
    elements.accountLabel.hidden = true;
    elements.signOutButton.hidden = true;
    if (message) setMessage(elements.loginMessage, message, 'error');
}

function showDenied(message) {
    clearAdminState();
    clearFamilyState();
    elements.authPanel.hidden = true;
    elements.familyPanel.hidden = true;
    elements.adminPanel.hidden = true;
    elements.accessDenied.hidden = false;
    elements.accessDeniedMessage.textContent = message;
    elements.accountLabel.hidden = false;
    elements.signOutButton.hidden = false;
}

function clearAdminState() {
    Object.keys(state).forEach(key => { state[key] = []; });
    clearWorkbookImportPreview();
    document.querySelectorAll('#adminPanel form').forEach(form => form.reset());
    document.querySelectorAll('#adminPanel tbody').forEach(body => body.replaceChildren());
    document.querySelectorAll('#adminPanel select').forEach(select => select.replaceChildren());
    document.querySelectorAll('#adminPanel .form-message').forEach(message => setMessage(message, ''));
    [
        ['playerFormTitle', 'Añadir jugador'],
        ['guardianFormTitle', 'Añadir tutor'],
        ['enrollmentFormTitle', 'Añadir asignación'],
        ['teamFormTitle', 'Añadir equipo'],
        ['seasonFormTitle', 'Añadir temporada'],
        ['feeFormTitle', 'Añadir cuota']
    ].forEach(([id, title]) => { document.getElementById(id).textContent = title; });
    document.querySelectorAll('#adminPanel [id^="cancel"]').forEach(button => { button.hidden = true; });
    document.getElementById('guardianUserId').disabled = false;
}

function clearFamilyState() {
    elements.familyPlayers.replaceChildren();
    elements.familyHeading.textContent = 'Información de tu familia';
    setMessage(elements.familyMessage, '');
}

async function openAccount(user) {
    const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (error || !profile) {
        showDenied('No se pudo verificar el perfil. Contacta con el club.');
        return;
    }
    if (profile.role === 'family') {
        await openFamilyAccount(user);
        return;
    }
    if (profile.role !== 'admin') {
        showDenied('Esta cuenta no tiene un rol habilitado. Contacta con el club.');
        return;
    }
    elements.authPanel.hidden = true;
    elements.accessDenied.hidden = true;
    elements.familyPanel.hidden = true;
    elements.adminPanel.hidden = false;
    elements.accountLabel.textContent = user.email || 'Sesión iniciada';
    elements.accountLabel.hidden = false;
    elements.signOutButton.hidden = false;
    setMessage(elements.appMessage, 'Cargando datos…');
    try {
        await loadAdminData();
        setMessage(elements.appMessage, 'Datos actualizados.', 'success');
    } catch (loadError) {
        setMessage(elements.appMessage, loadError.message || 'No se pudieron cargar los datos.', 'error');
    }
}

function setupTabs() {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(tab => tab.classList.toggle('active', tab === button));
            document.querySelectorAll('#adminPanel > .workspace').forEach(panel => { panel.hidden = panel.id !== button.dataset.panel; });
        });
    });
}

function setupCancelButtons() {
    const mappings = [
        ['cancelPlayerEdit', 'playerForm', 'playerFormTitle', 'Añadir jugador'],
        ['cancelGuardianEdit', 'guardianForm', 'guardianFormTitle', 'Añadir tutor'],
        ['cancelEnrollmentEdit', 'enrollmentForm', 'enrollmentFormTitle', 'Añadir asignación'],
        ['cancelTeamEdit', 'teamForm', 'teamFormTitle', 'Añadir equipo'],
        ['cancelSeasonEdit', 'seasonForm', 'seasonFormTitle', 'Añadir temporada'],
        ['cancelFeeEdit', 'feeForm', 'feeFormTitle', 'Añadir cuota']
    ];
    mappings.forEach(([buttonId, formId, titleId, title]) => {
        document.getElementById(buttonId).addEventListener('click', () => {
            clearEditForm(formId, titleId, title, buttonId);
            if (formId === 'guardianForm') document.getElementById('guardianUserId').disabled = false;
        });
    });
}

async function initialize() {
    setupTabs();
    setupCancelButtons();
    registerAdminForms();
    setupWorkbookImport();
    document.getElementById('paymentDate').value = localDateValue();
    document.getElementById('paymentFee').addEventListener('change', updatePaymentBalance);

    if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
        elements.loginButton.disabled = true;
        setMessage(elements.loginMessage, 'El CRM aún no está conectado. Configura la URL y la clave pública de Supabase en crm.js.', 'error');
        return;
    }

    supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') showLogin();
        if (event === 'SIGNED_IN' && session?.user) window.setTimeout(() => openAccount(session.user), 0);
    });

    const { data, error } = await supabase.auth.getSession();
    if (error) {
        showLogin('No se pudo comprobar la sesión. Inténtalo de nuevo.');
    } else if (data.session?.user) {
        await openAccount(data.session.user);
    }

    elements.loginForm.addEventListener('submit', async event => {
        event.preventDefault();
        elements.loginButton.disabled = true;
        setMessage(elements.loginMessage, 'Comprobando acceso…');
        const formData = new FormData(elements.loginForm);
        try {
            const { error: loginError } = await supabase.auth.signInWithPassword({
                email: formData.get('email'),
                password: formData.get('password')
            });
            if (loginError) setMessage(elements.loginMessage, 'No se pudo iniciar sesión. Revisa tus datos o contacta con el club.', 'error');
        } catch (error) {
            setMessage(elements.loginMessage, 'No se pudo conectar con el servicio de autenticación.', 'error');
        } finally {
            elements.loginButton.disabled = false;
        }
    });

    elements.signOutButton.addEventListener('click', async () => {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) setMessage(elements.appMessage, 'No se pudo cerrar la sesión.', 'error');
        else showLogin();
    });
}

initialize();