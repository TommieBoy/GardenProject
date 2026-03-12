const groupedHistoryEl = document.getElementById('grouped-history');
const historyMetaEl = document.getElementById('history-meta');
const historyErrorEl = document.getElementById('history-error');
const refreshBtn = document.getElementById('refresh-history');
const backBtn = document.getElementById('back-dashboard');

const urlParams = new URLSearchParams(window.location.search);
const limitParam = Number.parseInt(urlParams.get('limit') || '50', 10);
const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 1), 1000) : 500;
const sensorHours = 25;
const relayHours = 24;

refreshBtn.addEventListener('click', loadHistory);
backBtn.addEventListener('click', () => {
    window.location.href = 'index.html';
});

document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
});

async function loadHistory() {
    try {
        refreshBtn.disabled = true;
        historyErrorEl.style.display = 'none';
        historyMetaEl.textContent = 'Loading history...';

        const response = await fetch(`api/history?limit=${limit}&hours=${sensorHours}&relayHours=${relayHours}`);
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'Failed to load history');
        }

        renderGroupedHistory(payload);

        const loadedAt = new Date().toLocaleString();
        historyMetaEl.textContent = `Showing last ${sensorHours} hours of sensor data and relay triggers from last ${relayHours} hours, grouped by Sensor/Relay 1-8. Loaded at ${loadedAt}.`;
    } catch (error) {
        historyErrorEl.textContent = `Unable to load history: ${error.message}`;
        historyErrorEl.style.display = 'block';
        historyMetaEl.textContent = 'History failed to load.';
    } finally {
        refreshBtn.disabled = false;
    }
}

function renderGroupedHistory(payload) {
    const sensorRows = Array.isArray(payload.sensorAccess) ? payload.sensorAccess : [];
    const relayRows = Array.isArray(payload.relayOnEvents) ? payload.relayOnEvents : [];
    const groups = [];

    for (let sensorId = 1; sensorId <= 8; sensorId += 1) {
        const moistureColumn = `soil_moisture_${sensorId}`;
        const sensorSubset = sensorRows
            .filter((row) => row[moistureColumn] !== null && row[moistureColumn] !== undefined)
            .sort((a, b) => toTimestamp(a.recorded_at) - toTimestamp(b.recorded_at));
        const relaySubset = relayRows.filter((row) => Number(row.relay_id) === sensorId);
        const relayContextRows = buildRelayContextRows(sensorSubset, relaySubset, moistureColumn);

        groups.push(`
            <article class="sensor-relay-group">
                <h3>Soil Sensor ${sensorId} and Relay ${sensorId}</h3>

                <p class="group-subtitle">Sensor Rows</p>
                ${renderTableHtml(
                    ['record_date', 'record_time', 'temperature', 'humidity', moistureColumn],
                    sensorSubset,
                    `No Soil Sensor ${sensorId} rows found in this range.`
                )}

                <p class="group-subtitle">Relay ON Rows</p>
                ${renderTableHtml(
                    ['start_date', 'start_time', 'duration_minutes', 'source', 'reason'],
                    relaySubset,
                    `Relay ${sensorId} has no ON rows in this range.`
                )}

                <p class="group-subtitle">Relay Trigger Context (Before/After Reading)</p>
                ${renderTableHtml(
                    [
                        'relay_on_time',
                        'duration_minutes',
                        'reading_before_time',
                        'reading_before_value',
                        'reading_after_time',
                        'reading_after_value'
                    ],
                    relayContextRows,
                    `No before/after context rows for Relay ${sensorId} in the last ${relayHours} hours.`
                )}
            </article>
        `);
    }

    groupedHistoryEl.innerHTML = groups.join('');
}

function buildRelayContextRows(sensorRowsAsc, relayRows, moistureColumn) {
    if (!Array.isArray(sensorRowsAsc) || sensorRowsAsc.length === 0 || !Array.isArray(relayRows) || relayRows.length === 0) {
        return [];
    }

    return relayRows
        .sort((a, b) => toTimestamp(a.started_at) - toTimestamp(b.started_at))
        .map((relayRow) => {
            const relayTime = toTimestamp(relayRow.started_at);
            let beforeRow = null;
            let afterRow = null;

            for (const sensorRow of sensorRowsAsc) {
                const sensorTime = toTimestamp(sensorRow.recorded_at);
                if (sensorTime <= relayTime) {
                    beforeRow = sensorRow;
                    continue;
                }
                afterRow = sensorRow;
                break;
            }

            return {
                relay_on_time: formatIsoLocal(relayRow.started_at),
                duration_minutes: relayRow.duration_minutes,
                reading_before_time: beforeRow ? formatIsoLocal(beforeRow.recorded_at) : '',
                reading_before_value: beforeRow ? beforeRow[moistureColumn] : '',
                reading_after_time: afterRow ? formatIsoLocal(afterRow.recorded_at) : '',
                reading_after_value: afterRow ? afterRow[moistureColumn] : ''
            };
        });
}

function formatIsoLocal(value) {
    if (!value) {
        return '';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return String(value);
    }
    return parsed.toLocaleString();
}

function toTimestamp(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function renderTableHtml(columns, rows, emptyMessage) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return `<p class="group-empty">${escapeHtml(emptyMessage)}</p>`;
    }

    const head = `<tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>`;
    const body = rows
        .map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(formatCellValue(row[column], column))}</td>`).join('')}</tr>`)
        .join('');

    return `
        <div class="table-wrap">
            <table>
                <thead>${head}</thead>
                <tbody>${body}</tbody>
            </table>
        </div>
    `;
}

function formatCellValue(value, column) {
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string' && (column === 'recorded_at' || column === 'started_at')) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleString();
        }
    }

    return String(value);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
