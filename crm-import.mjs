export const IMPORT_SEASON = '2026-2027';
export const SEASON_FEE_CENTS = 15000;

const TEAM_NAMES = new Map([
    ['junior femenino', 'Junior Femenino'],
    ['junior masculino', 'Junior Masculino'],
    ['senior masculino', 'Senior Masculino']
]);

const MONTHS = new Map([
    ['enero', 1], ['febrero', 2], ['marzo', 3], ['abril', 4], ['mayo', 5], ['junio', 6],
    ['julio', 7], ['agosto', 8], ['septiembre', 9], ['setiembre', 9], ['octubre', 10],
    ['noviembre', 11], ['diciembre', 12], ['september', 9], ['october', 10], ['november', 11],
    ['sep', 9], ['oct', 10], ['nov', 11]
]);

export function normalizeImportText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

export function normalizeTeamName(value) {
    const normalized = normalizeImportText(value);
    for (const [key, name] of TEAM_NAMES) {
        if (normalized.includes(key)) return name;
    }
    return null;
}

export function splitPlayerName(value) {
    const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);
    return { first_name: parts[0] || '', last_name: parts.slice(1).join(' ') };
}

function cellText(value) {
    const text = String(value ?? '').trim();
    if (!text || /^(-|—|no especificado|n\/?a)$/i.test(text)) return '';
    return text;
}

function getSheetRows(workbook, sheetName, XLSX) {
    return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: false,
        defval: ''
    });
}

function findHeaderIndex(headers, predicate) {
    return headers.findIndex(value => predicate(normalizeImportText(value)));
}

function findRosterHeader(rows) {
    return rows.findIndex(row => {
        const headers = row.map(normalizeImportText);
        const hasName = headers.some(value => value.includes('nombre') && !value.includes('tutor'));
        const hasPersonalColumn = headers.some(value => value.includes('fecha') || value.includes('dni') || value.includes('direccion'));
        return hasName && hasPersonalColumn;
    });
}

function parseBirthDate(value) {
    const text = cellText(value);
    if (!text) return '';
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;

    const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!parts) return '';
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    const yearPart = Number(parts[3]);
    const dayFirst = first > 12;
    const month = dayFirst ? second : first;
    const day = dayFirst ? first : second;
    const year = parts[3].length === 2 ? (yearPart >= 30 ? 1900 + yearPart : 2000 + yearPart) : yearPart;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isUnlabelledNationality(value) {
    const nationalities = new Set([
        'venezolano', 'venezolana', 'colombiano', 'colombiana', 'peruano', 'peruana',
        'espanol', 'espanola', 'argentino', 'argentina', 'ecuatoriano', 'ecuatoriana',
        'chileno', 'chilena', 'boliviano', 'boliviana', 'mexicano', 'mexicana',
        'cubano', 'cubana', 'dominicano', 'dominicana', 'paraguayo', 'paraguaya',
        'uruguayo', 'uruguaya', 'brasileno', 'brasilena', 'nicaraguense',
        'costarricense', 'panameno', 'panamena', 'hondureno', 'hondurena',
        'salvadoreno', 'salvadorena', 'guatemalteco', 'guatemalteca',
        'puertorriqueno', 'puertorriquena', 'estadounidense'
    ]);
    return nationalities.has(normalizeImportText(value));
}

export function parseRosterWorkbook(workbook, XLSX) {
    const players = [];
    const errors = [];
    workbook.SheetNames.forEach(sheetName => {
        const rows = getSheetRows(workbook, sheetName, XLSX);
        const headerRowIndex = findRosterHeader(rows);
        if (headerRowIndex < 0) return;

        const teamName = normalizeTeamName(sheetName) || rows.slice(0, headerRowIndex + 1)
            .flat()
            .map(normalizeTeamName)
            .find(Boolean);
        if (!teamName) {
            errors.push(`${sheetName}: no se pudo identificar el equipo.`);
            return;
        }

        const headers = rows[headerRowIndex];
        const nameIndex = findHeaderIndex(headers, value => value.includes('nombre') && !value.includes('tutor'));
        const birthIndex = findHeaderIndex(headers, value => value.includes('fecha') && value.includes('nacimiento'));
        const playerDocumentIndex = findHeaderIndex(headers, value => (value.includes('dni') || value.includes('pasaporte')) && !value.includes('tutor'));
        const guardianDocumentIndex = findHeaderIndex(headers, value => (value.includes('dni') || value.includes('pasaporte')) && value.includes('tutor'));
        const addressIndex = findHeaderIndex(headers, value => value.includes('direccion') || value.includes('domicilio'));
        const playerPhoneIndex = findHeaderIndex(headers, value => value.includes('telefono') && !value.includes('tutor'));
        const guardianPhoneIndex = findHeaderIndex(headers, value => value.includes('telefono') && value.includes('tutor'));
        const emailIndex = findHeaderIndex(headers, value => value.includes('email') || value.includes('correo'));
        const nationalityIndex = findHeaderIndex(headers, value => value.includes('nacionalidad'));
        const guardianNameIndex = findHeaderIndex(headers, value => value.includes('nombre') && value.includes('tutor'));
        const jerseyIndex = findHeaderIndex(headers, value => value.includes('dorsal'));

        if (nameIndex < 0) {
            errors.push(`${sheetName}: falta la columna de nombre del jugador.`);
            return;
        }

        rows.slice(headerRowIndex + 1).forEach((row, offset) => {
            const fullName = cellText(row[nameIndex]);
            if (!fullName) return;
            const name = splitPlayerName(fullName);
            const birthValue = birthIndex >= 0 ? cellText(row[birthIndex]) : '';
            const birthDate = parseBirthDate(birthValue);
            const guardianName = guardianNameIndex >= 0 ? cellText(row[guardianNameIndex]) : '';
            let guardian = guardianName ? {
                full_name: guardianName,
                phone: guardianPhoneIndex >= 0 ? cellText(row[guardianPhoneIndex]) : '',
                identity_document: guardianDocumentIndex >= 0 ? cellText(row[guardianDocumentIndex]) : ''
            } : null;
            const lastNamedHeaderIndex = headers.reduce((lastIndex, value, index) => normalizeImportText(value) ? index : lastIndex, -1);
            let nationalityValue = nationalityIndex >= 0
                ? cellText(row[nationalityIndex])
                : cellText(row[lastNamedHeaderIndex + 1]);
            if (guardian && !guardian.phone && !guardian.identity_document && isUnlabelledNationality(guardian.full_name)) {
                nationalityValue = guardian.full_name;
                guardian = null;
            }
            const player = {
                key: `roster-${players.length}`,
                full_name: fullName,
                ...name,
                team_name: teamName,
                jersey_number: jerseyIndex >= 0 ? cellText(row[jerseyIndex]) : '',
                date_of_birth: birthDate,
                identity_document: playerDocumentIndex >= 0 ? cellText(row[playerDocumentIndex]) : '',
                address: addressIndex >= 0 ? cellText(row[addressIndex]) : '',
                phone: playerPhoneIndex >= 0 ? cellText(row[playerPhoneIndex]) : '',
                email: emailIndex >= 0 ? cellText(row[emailIndex]) : '',
                nationality: nationalityValue,
                guardian,
                source: { sheet: sheetName, row: headerRowIndex + offset + 2 },
                issues: []
            };
            if (!player.first_name || !player.last_name) player.issues.push('Debe incluir nombre y apellidos.');
            if (birthValue && !birthDate) player.issues.push('Fecha de nacimiento no reconocida.');
            players.push(player);
        });
    });

    if (!players.length && !errors.length) errors.push('No se encontraron hojas de jugadores con cabeceras reconocibles.');
    return { players, errors };
}

function monthNumber(value) {
    const normalized = normalizeImportText(value);
    for (const [name, number] of MONTHS) {
        if (normalized === name || normalized.startsWith(`${name} `)) return number;
    }
    return null;
}

function parsePaymentDay(value) {
    const text = cellText(value);
    if (!text) return null;
    const fullDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-]\d{2,4}$/);
    if (fullDate) {
        const first = Number(fullDate[1]);
        const second = Number(fullDate[2]);
        const day = first > 12 ? first : second;
        return day >= 1 && day <= 31 ? day : null;
    }
    const day = text.match(/^(\d{1,2})(?:\D|$)/);
    if (!day) return null;
    const number = Number(day[1]);
    return number >= 1 && number <= 31 ? number : null;
}

function parseInstallmentCount(value) {
    const text = cellText(value);
    if (!text) return { count: null, issue: '' };
    const normalized = normalizeImportText(text);
    const match = normalized.match(/\b([123])\b/);
    if (!match || !normalized.includes('pago')) return { count: null, issue: `Modalidad no reconocida: ${text}.` };
    return { count: Number(match[1]), issue: '' };
}

function sheetTeamName(sheetName, rows, headerRowIndex) {
    return normalizeTeamName(sheetName) || rows.slice(0, headerRowIndex + 1)
        .flat()
        .map(normalizeTeamName)
        .find(Boolean) || null;
}

export function parsePaymentsWorkbook(workbook, XLSX) {
    const rowsFound = [];
    const errors = [];

    workbook.SheetNames.forEach(sheetName => {
        const rows = getSheetRows(workbook, sheetName, XLSX);
        rows.forEach((row, headerRowIndex) => {
            const headers = row.map(normalizeImportText);
            const planIndex = headers.findIndex(value => value.includes('forma pago') || value.includes('modalidad pago'));
            const monthColumns = row.map((value, index) => ({ index, month: monthNumber(value) })).filter(item => item.month);
            if (planIndex < 0 || !monthColumns.length) return;

            const teamName = sheetTeamName(sheetName, rows, headerRowIndex);
            if (!teamName) {
                errors.push(`${sheetName}, fila ${headerRowIndex + 1}: no se pudo identificar el equipo.`);
                return;
            }
            const explicitNameIndex = headers.findIndex((value, index) => index < planIndex && (value.includes('jugador') || value.includes('nombre')));
            const nameIndex = explicitNameIndex >= 0 ? explicitNameIndex : planIndex - 1;

            rows.slice(headerRowIndex + 1).forEach((dataRow, offset) => {
                const playerName = cellText(dataRow[nameIndex]);
                if (!playerName || normalizeTeamName(playerName)) return;
                const planText = cellText(dataRow[planIndex]);
                const plan = parseInstallmentCount(planText);
                const issues = plan.issue ? [plan.issue] : [];
                const payments = [];
                monthColumns.forEach(({ index: columnIndex, month }) => {
                    const value = dataRow[columnIndex];
                    if (!cellText(value)) return;
                    const day = parsePaymentDay(value);
                    if (!day || new Date(Date.UTC(2026, month - 1, day)).getUTCMonth() !== month - 1) {
                        issues.push(`Fecha no reconocida en columna ${String(rows[headerRowIndex][columnIndex])}.`);
                        payments.push({ paid_at: '', source: { sheet: sheetName, row: headerRowIndex + offset + 2, column: columnIndex + 1 }, issue: 'Fecha no reconocida.' });
                        return;
                    }
                    payments.push({
                        paid_at: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
                        source: { sheet: sheetName, row: headerRowIndex + offset + 2, column: columnIndex + 1 },
                        issue: ''
                    });
                });
                if (plan.count && payments.length > plan.count) issues.push('Hay más fechas de pago que plazos indicados.');
                rowsFound.push({
                    key: `payment-${rowsFound.length}`,
                    player_name: playerName,
                    team_name: teamName,
                    installment_count: plan.count,
                    plan_text: planText,
                    payments,
                    issues,
                    source: { sheet: sheetName, row: headerRowIndex + offset + 2 },
                    mapping: { type: '', targetKey: '', newName: '', manualAmount: '', manualDate: '' }
                });
            });
        });
    });

    if (!rowsFound.length && !errors.length) errors.push('No se encontraron tablas de pagos con meses y modalidad reconocibles.');
    return { rows: rowsFound, errors };
}

export function paymentCandidates(paymentName, candidates) {
    const ignored = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
    const tokens = normalizeImportText(paymentName).split(' ').filter(token => token && !ignored.has(token));
    if (!tokens.length) return [];
    return candidates.filter(candidate => {
        const candidateTokens = new Set(normalizeImportText(candidate.full_name).split(' ').filter(Boolean));
        return tokens.every(token => candidateTokens.has(token));
    });
}

function newImportRecord(key, fullName, teamName, player = null) {
    const name = splitPlayerName(fullName);
    return {
        key,
        full_name: fullName,
        first_name: player?.first_name || name.first_name,
        last_name: player?.last_name || name.last_name,
        team_name: teamName,
        jersey_number: '',
        date_of_birth: '',
        identity_document: '',
        address: '',
        phone: '',
        email: '',
        nationality: '',
        guardian: null,
        existingPlayerId: player?.id || null,
        payments: []
    };
}

function rosterImportRecord(player, existingPlayers) {
    const matches = existingPlayers.filter(existing =>
        normalizeImportText(`${existing.first_name} ${existing.last_name}`) === normalizeImportText(player.full_name));
    return {
        key: player.key,
        full_name: player.full_name,
        first_name: player.first_name,
        last_name: player.last_name,
        team_name: player.team_name,
        jersey_number: player.jersey_number,
        date_of_birth: player.date_of_birth,
        identity_document: player.identity_document,
        address: player.address,
        phone: player.phone,
        email: player.email,
        nationality: player.nationality,
        guardian: player.guardian,
        existingPlayerId: matches.length === 1 ? matches[0].id : null,
        payments: []
    };
}

function importSourceKey(draft, source, manual = false) {
    const sheet = normalizeImportText(source.sheet).replace(/\s+/g, '-').slice(0, 30) || 'sheet';
    return `xlsx:${draft.paymentHash}:${sheet}:${source.row}:${manual ? 'manual' : source.column}`;
}

function validCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validImportDate(value) {
    return /^2026-/.test(value || '') && validCalendarDate(value);
}

function importAmountCents(value) {
    const amount = Number(String(value || '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 150) return null;
    const cents = Math.round(amount * 100);
    return Math.abs(amount * 100 - cents) < 0.000001 ? cents : null;
}

export function buildWorkbookImportPlan(draft, currentState = {}) {
    if (!draft) return { records: [], errors: [], warnings: [], paymentCount: 0, totalCents: 0 };
    const existingPlayers = currentState.players || [];
    const errors = [...draft.errors];
    const warnings = [];
    const records = new Map();
    const rosterNames = new Set();

    draft.rosterRows.forEach(player => {
        const record = rosterImportRecord(player, existingPlayers);
        const duplicateKey = `${normalizeImportText(player.team_name)}|${normalizeImportText(player.full_name)}`;
        if (rosterNames.has(duplicateKey)) errors.push(`${player.full_name}: aparece más de una vez en el mismo equipo del libro de jugadores.`);
        rosterNames.add(duplicateKey);
        (player.issues || []).forEach(issue => errors.push(`${player.full_name}: ${issue}`));
        const existingMatches = existingPlayers.filter(existing =>
            normalizeImportText(`${existing.first_name} ${existing.last_name}`) === normalizeImportText(player.full_name));
        if (existingMatches.length > 1) errors.push(`${player.full_name}: hay fichas duplicadas en el CRM; resuélvelas antes de importar.`);
        if (existingMatches.some(existing => existing.archived_at)) errors.push(`${player.full_name}: la ficha del CRM está archivada; reactívala o revisa el nombre antes de importar.`);
        records.set(player.key, record);
    });

    draft.paymentRows.forEach(paymentRow => {
        const mapping = paymentRow.mapping;
        if (mapping.selection === 'skip') return;
        if (!mapping.selection) {
            errors.push(`${paymentRow.player_name} (${paymentRow.team_name}): asigna esta fila a un jugador, crea la ficha o elige omitirla.`);
            return;
        }

        let record;
        if (mapping.selection.startsWith('roster:')) {
            record = records.get(mapping.selection.slice('roster:'.length));
        } else if (mapping.selection.startsWith('existing:')) {
            const player = existingPlayers.find(item => item.id === mapping.selection.slice('existing:'.length));
            if (player) {
                if (player.archived_at) {
                    errors.push(`${player.first_name} ${player.last_name}: la ficha del CRM está archivada; reactívala antes de importar.`);
                    return;
                }
                const key = `existing:${player.id}:${normalizeImportText(paymentRow.team_name)}`;
                if (!records.has(key)) records.set(key, newImportRecord(key, `${player.first_name} ${player.last_name}`, paymentRow.team_name, player));
                record = records.get(key);
            }
        } else if (mapping.selection === 'new') {
            const name = splitPlayerName(mapping.newName);
            if (!name.first_name || !name.last_name) {
                errors.push(`${paymentRow.player_name}: escribe nombre y apellidos para crear la ficha adicional.`);
                return;
            }
            const existingMatches = existingPlayers.filter(player =>
                normalizeImportText(`${player.first_name} ${player.last_name}`) === normalizeImportText(mapping.newName));
            if (existingMatches.length) {
                errors.push(`${mapping.newName}: ya existe en el CRM; selecciónala en vez de crear otra ficha.`);
                return;
            }
            const key = `extra:${paymentRow.key}`;
            if (!records.has(key)) records.set(key, newImportRecord(key, mapping.newName.trim(), paymentRow.team_name));
            record = records.get(key);
        }

        if (!record) {
            errors.push(`${paymentRow.player_name}: la ficha seleccionada ya no está disponible.`);
            return;
        }
        (paymentRow.issues || []).forEach(issue => errors.push(`${paymentRow.player_name}: ${issue}`));
        if (paymentRow.payments.length && !paymentRow.installment_count) {
            errors.push(`${paymentRow.player_name}: hay fechas pero no una modalidad de pago válida.`);
        }

        paymentRow.payments.forEach(payment => {
            if (payment.issue || !payment.paid_at || !paymentRow.installment_count) return;
            record.payments.push({
                amount_cents: SEASON_FEE_CENTS / paymentRow.installment_count,
                paid_at: payment.paid_at,
                import_source: importSourceKey(draft, payment.source)
            });
        });

        const hasManualAmount = Boolean(mapping.manualAmount);
        const hasManualDate = Boolean(mapping.manualDate);
        if (hasManualAmount !== hasManualDate) {
            errors.push(`${paymentRow.player_name}: completa tanto el importe como la fecha del pago manual, o deja ambos vacíos.`);
        } else if (hasManualAmount && hasManualDate) {
            const amountCents = importAmountCents(mapping.manualAmount);
            if (!amountCents || !validImportDate(mapping.manualDate)) {
                errors.push(`${paymentRow.player_name}: el pago manual debe tener un importe válido y una fecha de 2026.`);
            } else {
                record.payments.push({
                    amount_cents: amountCents,
                    paid_at: mapping.manualDate,
                    import_source: importSourceKey(draft, paymentRow.source, true)
                });
            }
        }
    });

    records.forEach(record => {
        if (record.first_name.length > 100 || record.last_name.length > 150 || record.team_name.length > 100) {
            errors.push(`${record.full_name}: el nombre o equipo supera el límite admitido por el CRM.`);
        }
        if (record.jersey_number.length > 20 || record.date_of_birth && !validCalendarDate(record.date_of_birth)
            || record.identity_document.length > 40 || record.address.length > 300 || record.phone.length > 40
            || record.email.length > 254 || record.nationality.length > 80) {
            errors.push(`${record.full_name}: revisa la longitud de los campos personales o el formato de la fecha.`);
        }
        if (record.guardian && (record.guardian.full_name.length > 160
            || record.guardian.phone.length > 40 || record.guardian.identity_document.length > 40)) {
            errors.push(`${record.full_name}: los datos del tutor superan el límite admitido por el CRM.`);
        }
        if (record.existingPlayerId) {
            const storedPrivate = (currentState.playerPrivateData || []).find(item => item.player_id === record.existingPlayerId) || {};
            const playerFields = ['date_of_birth', 'identity_document', 'address', 'phone', 'email', 'nationality'];
            let hasExistingConflict = playerFields.some(field => storedPrivate[field] && record[field]
                && normalizeImportText(storedPrivate[field]) !== normalizeImportText(record[field]));
            if (record.guardian) {
                const guardian = (currentState.guardians || []).find(item =>
                    normalizeImportText(item.full_name) === normalizeImportText(record.guardian.full_name));
                if (guardian) {
                    const storedGuardianPrivate = (currentState.guardianPrivateData || []).find(item => item.guardian_id === guardian.id) || {};
                    hasExistingConflict ||= Boolean(guardian.phone && record.guardian.phone
                        && normalizeImportText(guardian.phone) !== normalizeImportText(record.guardian.phone));
                    hasExistingConflict ||= Boolean(storedGuardianPrivate.identity_document && record.guardian.identity_document
                        && normalizeImportText(storedGuardianPrivate.identity_document) !== normalizeImportText(record.guardian.identity_document));
                }
            }
            if (hasExistingConflict) warnings.push(`${record.full_name}: hay datos no vacíos distintos en el CRM; se conservarán los ya guardados y podrás revisarlos después.`);
        }
        const paymentTotal = record.payments.reduce((total, payment) => total + payment.amount_cents, 0);
        if (paymentTotal > SEASON_FEE_CENTS) errors.push(`${record.full_name}: los pagos previstos superan los 150 € de cuota.`);
        if (!record.payments.length) warnings.push(`${record.full_name}: se creará la cuota de 150 € sin pagos; quedará pendiente.`);
        if (record.existingPlayerId) {
            const fee = (currentState.balances || []).find(balance => balance.player_id === record.existingPlayerId
                && balance.description === `Cuota temporada ${IMPORT_SEASON}`
                && (currentState.seasons || []).some(season => season.id === balance.season_id && season.name === IMPORT_SEASON));
            const alreadyPaid = fee?.paid_cents || 0;
            const newPayments = record.payments
                .filter(payment => !(currentState.payments || []).some(existing => existing.import_source === payment.import_source))
                .reduce((total, payment) => total + payment.amount_cents, 0);
            if (alreadyPaid + newPayments > SEASON_FEE_CENTS) errors.push(`${record.full_name}: la ficha ya tiene pagos que, junto a esta importación, superarían 150 €.`);
        }
    });

    const values = Array.from(records.values());
    if (values.length > 250) errors.push('La importación supera el máximo de 250 jugadores por operación.');
    const payments = values.flatMap(record => record.payments);
    return {
        records: values,
        errors: [...new Set(errors)],
        warnings: [...new Set(warnings)],
        paymentCount: payments.length,
        totalCents: payments.reduce((total, payment) => total + payment.amount_cents, 0)
    };
}
