import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildWorkbookImportPlan,
    IMPORT_SEASON,
    normalizeTeamName,
    parsePaymentsWorkbook,
    parseRosterWorkbook,
    paymentCandidates
} from './crm-import.mjs';

const XLSX = {
    utils: {
        sheet_to_json: sheet => sheet.rows
    }
};

function workbook(sheetName, rows) {
    return { SheetNames: [sheetName], Sheets: { [sheetName]: { rows } } };
}

function importPlayer() {
    return {
        key: 'roster-0',
        full_name: 'ANA PRUEBA EJEMPLO',
        first_name: 'ANA',
        last_name: 'PRUEBA EJEMPLO',
        team_name: 'Junior Femenino',
        jersey_number: '4',
        date_of_birth: '2009-12-21',
        identity_document: 'X0000000A',
        address: 'CALLE PRUEBA 1',
        phone: '600000000',
        email: 'ana@example.test',
        nationality: 'Venezolana',
        guardian: null,
        issues: []
    };
}

function paymentRow(overrides = {}) {
    return {
        key: 'payment-0',
        player_name: 'ANA PRUEBA',
        team_name: 'Junior Femenino',
        installment_count: 3,
        plan_text: '3 PAGOS',
        payments: [
            { paid_at: '2026-10-05', source: { sheet: 'Junior Femenino', row: 4, column: 6 }, issue: '' },
            { paid_at: '2026-10-05', source: { sheet: 'Junior Femenino', row: 4, column: 7 }, issue: '' },
            { paid_at: '2026-11-05', source: { sheet: 'Junior Femenino', row: 4, column: 8 }, issue: '' }
        ],
        issues: [],
        source: { sheet: 'Junior Femenino', row: 4 },
        mapping: { selection: 'roster:roster-0', newName: '', manualAmount: '', manualDate: '' },
        ...overrides
    };
}

function emptyImportState() {
    return { players: [], playerPrivateData: [], guardians: [], guardianPrivateData: [], balances: [], seasons: [], payments: [] };
}

function importDraft(rosterRows, paymentRows) {
    return { rosterRows, paymentRows, paymentHash: 'a'.repeat(64), errors: [] };
}

test('normalizes accented team names to CRM labels', () => {
    assert.equal(normalizeTeamName('JÚNIOR FEMENINO'), 'Junior Femenino');
    assert.equal(normalizeTeamName('Senior masculino'), 'Senior Masculino');
    assert.equal(normalizeTeamName('Equipo desconocido'), null);
});

test('reads player fields, tutelage and dates without moving adjacent values', () => {
    const data = workbook('JUNIOR FEMENINO', [
        ['', 'Dorsal', 'Nombre', 'Fecha Nacimiento', 'DNI/NIE/Pasaporte', 'Dirección', 'Teléfono', 'Email', 'Nombre Tutor', 'Teléfono Tutor', 'DNI/NIE/Pasaporte Tutor', ''],
        ['', '4', 'ANA PRUEBA EJEMPLO', '12/21/09', 'X0000000A', 'CALLE PRUEBA 1', '600000000', 'ana@example.test', 'TUTORA DE PRUEBA', '600000001', 'Y0000000A', 'Venezolana'],
        ['', '5', 'PABLO MUESTRA EJEMPLO', '7/12/09', 'X0000001A', 'CALLE PRUEBA 2', '600000002', 'pablo@example.test', 'Venezolano', '', '', '']
    ]);

    const result = parseRosterWorkbook(data, XLSX);
    assert.deepEqual(result.errors, []);
    assert.equal(result.players.length, 2);
    assert.equal(result.players[0].team_name, 'Junior Femenino');
    assert.equal(result.players[0].date_of_birth, '2009-12-21');
    assert.equal(result.players[0].nationality, 'Venezolana');
    assert.equal(result.players[0].guardian.identity_document, 'Y0000000A');
    assert.equal(result.players[0].jersey_number, '4');
    assert.equal(result.players[1].nationality, 'Venezolano');
    assert.equal(result.players[1].guardian, null);
});

test('uses the month heading and preserves repeated dates as separate instalments', () => {
    const data = workbook('JUNIOR MASCULINO', [
        ['', 'JUNIOR MASCULINO', '', 'FORMA PAGO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE'],
        ['', '', '', '', '', '', ''],
        ['', '7', 'ALUMNO EJEMPLO UNO', '3 PAGOS', '1-Oct', '5-Nov', '5-Nov'],
        ['', '8', 'ALUMNO EJEMPLO DOS', '3 PAGOS', '2-Sep', '', ''],
        ['', '9', 'ALUMNO EJEMPLO TRES', '1 PAGO', '09/18/2026', '', '']
    ]);

    const result = parsePaymentsWorkbook(data, XLSX);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 3);
    assert.deepEqual(result.rows[0].payments.map(payment => payment.paid_at), ['2026-09-01', '2026-10-05', '2026-11-05']);
    assert.notEqual(result.rows[0].payments[1].source.column, result.rows[0].payments[2].source.column);
    assert.deepEqual(result.rows[1].payments.map(payment => payment.paid_at), ['2026-09-02']);
    assert.deepEqual(result.rows[2].payments.map(payment => payment.paid_at), ['2026-09-18']);
});

test('suggests a payment-row match only when all significant name tokens are unique', () => {
    const players = [
        { full_name: 'Mario de la Sierra Soto' },
        { full_name: 'María Torres' },
        { full_name: 'Aitor Montes Ejemplo' },
        { full_name: 'Álvaro Montes Ejemplo' }
    ];
    assert.deepEqual(paymentCandidates('MARIO DE LA SIERRA', players), [players[0]]);
    assert.deepEqual(paymentCandidates('MONTES', players), [players[2], players[3]]);
    assert.deepEqual(paymentCandidates('ALIAS SIN MATCH', players), []);
});

test('builds a 150 euro fee with separate 50 euro events and stable source keys', () => {
    const draft = importDraft([importPlayer()], [paymentRow()]);
    const plan = buildWorkbookImportPlan(draft, emptyImportState());

    assert.deepEqual(plan.errors, []);
    assert.equal(plan.records.length, 1);
    assert.equal(plan.paymentCount, 3);
    assert.equal(plan.totalCents, 15000);
    assert.deepEqual(plan.records[0].payments.map(payment => payment.amount_cents), [5000, 5000, 5000]);
    assert.equal(plan.records[0].payments[0].paid_at, plan.records[0].payments[1].paid_at);
    assert.notEqual(plan.records[0].payments[0].import_source, plan.records[0].payments[1].import_source);
    assert.equal(plan.records[0].payments[0].import_source, buildWorkbookImportPlan(draft, emptyImportState()).records[0].payments[0].import_source);
});

test('requires a new player name and confirms both fields for a manual payment', () => {
    const row = paymentRow({
        payments: [],
        installment_count: null,
        plan_text: '',
        mapping: { selection: 'new', newName: 'MARTA NUEVA EJEMPLO', manualAmount: '150', manualDate: '2026-11-20' }
    });
    const plan = buildWorkbookImportPlan(importDraft([], [row]), emptyImportState());

    assert.deepEqual(plan.errors, []);
    assert.equal(plan.records[0].full_name, 'MARTA NUEVA EJEMPLO');
    assert.deepEqual(plan.records[0].payments.map(payment => [payment.amount_cents, payment.paid_at]), [[15000, '2026-11-20']]);
});

test('blocks unassigned rows and payments beyond the fee', () => {
    const unassigned = buildWorkbookImportPlan(importDraft([importPlayer()], [paymentRow({ mapping: { selection: '', newName: '', manualAmount: '', manualDate: '' } })]), emptyImportState());
    assert.ok(unassigned.errors.some(issue => issue.includes('asigna esta fila')));

    const overpaidRow = paymentRow({
        installment_count: 1,
        plan_text: '1 PAGO',
        payments: [
            { paid_at: '2026-10-05', source: { sheet: 'Junior Femenino', row: 4, column: 6 }, issue: '' },
            { paid_at: '2026-11-05', source: { sheet: 'Junior Femenino', row: 4, column: 7 }, issue: '' }
        ]
    });
    const overpaid = buildWorkbookImportPlan(importDraft([importPlayer()], [overpaidRow]), emptyImportState());
    assert.ok(overpaid.errors.some(issue => issue.includes('superan los 150')));
});

test('accounts for payments already recorded in the CRM', () => {
    const state = emptyImportState();
    state.players.push({ id: 'player-1', first_name: 'Ana', last_name: 'Prueba Ejemplo' });
    state.seasons.push({ id: 'season-1', name: IMPORT_SEASON });
    state.balances.push({
        player_id: 'player-1',
        season_id: 'season-1',
        description: `Cuota temporada ${IMPORT_SEASON}`,
        paid_cents: 10000
    });
    const row = paymentRow({
        installment_count: 2,
        plan_text: '2 PAGOS',
        payments: [{ paid_at: '2026-11-05', source: { sheet: 'Junior Femenino', row: 4, column: 8 }, issue: '' }]
    });
    const plan = buildWorkbookImportPlan(importDraft([importPlayer()], [row]), state);

    assert.ok(plan.errors.some(issue => issue.includes('superarían 150')));
});