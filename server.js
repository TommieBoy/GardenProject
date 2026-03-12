const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const PORT = 3000;
const HOST = '0.0.0.0'; // Listen on all network interfaces
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DB_FILE = path.join(__dirname, 'garden_data.db');
const DEFAULT_ECOWITT_URL = 'https://www.ecowitt.net/home/share?authorize=WGFA9S&device_id=NXVKd3Azd3RMdXUyZDE1LzE4SzYydz09';
const DAILY_REPORT_HOUR = 7;
const DAILY_REPORT_MINUTE = 0;
const RELAY_COUNT = 8;
const SOIL_MOISTURE_THRESHOLD = 30;
const SENSOR_POLL_INTERVAL_MS = 3600000;
const RELAY_HELPER_HOST = '127.0.0.1';
const RELAY_HELPER_PORT = 3099;

// Load or create configuration
let config = {
  ecowittUrl: DEFAULT_ECOWITT_URL,
  accessCount: 9,
  wateringInterval: 20,
  wateringStartTime: '0600',
  email1: '',
  email2: ''
};
let reportTimer = null;
let sensorPollTimer = null;
let sensorPollStartTimer = null;
let latestSensorSnapshot = null;
const relayAutoOffTimers = new Array(RELAY_COUNT).fill(null);
const relayState = Array.from({ length: RELAY_COUNT }, (_, index) => ({
  id: index + 1,
  isOn: false,
  source: 'idle',
  reason: '',
  startedAt: null,
  autoOffAt: null,
  sensorAvailable: false,
  lastMoisture: null
}));

function sqliteEscapeString(value) {
  return String(value).replace(/'/g, "''");
}

function toSqlValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  return `'${sqliteEscapeString(value)}'`;
}

function runSql(sql) {
  execFileSync('sqlite3', [DB_FILE, sql], { stdio: 'pipe' });
}

function querySqlRows(sql) {
  const raw = execFileSync('sqlite3', ['-json', DB_FILE, sql], {
    stdio: 'pipe',
    encoding: 'utf8'
  });

  if (!raw || !raw.trim()) {
    return [];
  }

  return JSON.parse(raw);
}

function querySqlCsv(sql) {
  return execFileSync('sqlite3', ['-header', '-csv', DB_FILE, sql], {
    stdio: 'pipe',
    encoding: 'utf8'
  });
}

function formatDateAndTime(isoTimestamp) {
  const timestamp = isoTimestamp || new Date().toISOString();
  return {
    date: timestamp.slice(0, 10),
    time: timestamp.slice(11, 19)
  };
}

function initializeDatabase() {
  const schemaSql = `
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS ecowitt_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      record_date TEXT NOT NULL,
      record_time TEXT NOT NULL,
      temperature REAL,
      humidity REAL,
      soil_moisture_1 REAL,
      soil_moisture_2 REAL,
      soil_moisture_3 REAL,
      soil_moisture_4 REAL,
      soil_moisture_5 REAL,
      soil_moisture_6 REAL,
      soil_moisture_7 REAL,
      soil_moisture_8 REAL
    );
    CREATE TABLE IF NOT EXISTS relay_on_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      relay_id INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      start_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      source TEXT,
      reason TEXT
    );
  `;

  try {
    runSql(schemaSql);
    console.log(`Database initialized at ${DB_FILE}`);
  } catch (error) {
    console.error(`Failed to initialize database: ${error.message}`);
  }
}

function recordEcoWittAccess(snapshot) {
  const recordedAt = snapshot?.capturedAt || new Date().toISOString();
  const { date, time } = formatDateAndTime(recordedAt);
  const insertSql = `
    INSERT INTO ecowitt_access_log (
      recorded_at,
      record_date,
      record_time,
      temperature,
      humidity,
      soil_moisture_1,
      soil_moisture_2,
      soil_moisture_3,
      soil_moisture_4,
      soil_moisture_5,
      soil_moisture_6,
      soil_moisture_7,
      soil_moisture_8
    ) VALUES (
      ${toSqlValue(recordedAt)},
      ${toSqlValue(date)},
      ${toSqlValue(time)},
      ${toSqlValue(snapshot?.temperature)},
      ${toSqlValue(snapshot?.humidity)},
      ${toSqlValue(snapshot?.soilMoisture)},
      ${toSqlValue(snapshot?.soilMoisture2)},
      ${toSqlValue(snapshot?.soilMoisture3)},
      ${toSqlValue(snapshot?.soilMoisture4)},
      ${toSqlValue(snapshot?.soilMoisture5)},
      ${toSqlValue(snapshot?.soilMoisture6)},
      ${toSqlValue(snapshot?.soilMoisture7)},
      ${toSqlValue(snapshot?.soilMoisture8)}
    );
  `;

  try {
    runSql(insertSql);
  } catch (error) {
    console.error(`Failed to record EcoWitt access: ${error.message}`);
  }
}

function recordRelayOnEvent(relayId, startedAt, durationMinutes, source, reason) {
  const duration = Number.isFinite(durationMinutes) ? Math.max(0, Math.round(durationMinutes)) : 0;
  const { date, time } = formatDateAndTime(startedAt);
  const insertSql = `
    INSERT INTO relay_on_log (
      relay_id,
      started_at,
      start_date,
      start_time,
      duration_minutes,
      source,
      reason
    ) VALUES (
      ${toSqlValue(relayId)},
      ${toSqlValue(startedAt)},
      ${toSqlValue(date)},
      ${toSqlValue(time)},
      ${toSqlValue(duration)},
      ${toSqlValue(source || '')},
      ${toSqlValue(reason || '')}
    );
  `;

  try {
    runSql(insertSql);
  } catch (error) {
    console.error(`Failed to record relay event: ${error.message}`);
  }
}

function requestRelayHelper(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify(payload || {});
    const req = http.request(
      {
        host: RELAY_HELPER_HOST,
        port: RELAY_HELPER_PORT,
        path: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody)
        },
        timeout: 4000
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseBody ? JSON.parse(responseBody) : {});
            return;
          }

          try {
            const parsed = responseBody ? JSON.parse(responseBody) : {};
            reject(new Error(parsed.error || `Relay helper request failed with status ${res.statusCode}`));
          } catch {
            reject(new Error(`Relay helper request failed with status ${res.statusCode}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Relay helper timeout'));
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

async function setRelayHardware(relayId, isOn) {
  await requestRelayHelper('/relay-state', { relayId, isOn });
}

async function initializeRelayHardware() {
  try {
    await requestRelayHelper('/initialize', {});
  } catch (error) {
    console.error(`Relay helper initialization failed: ${error.message}`);
  }
}

function checkRelayHelperHealth() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: RELAY_HELPER_HOST,
        port: RELAY_HELPER_PORT,
        path: '/health',
        method: 'GET',
        timeout: 2500
      },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
          res.resume();
          return;
        }

        reject(new Error(`Relay helper health returned status ${res.statusCode}`));
        res.resume();
      }
    );

    req.on('timeout', () => req.destroy(new Error('Relay helper health timeout')));
    req.on('error', reject);
    req.end();
  });
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      config = JSON.parse(data);
      
      // Initialize accessCount if it doesn't exist
      if (typeof config.accessCount !== 'number') {
        config.accessCount = 9;
        saveConfig();
      }
      
      // Initialize wateringInterval if it doesn't exist
      if (typeof config.wateringInterval !== 'number') {
        config.wateringInterval = 20;
        saveConfig();
      }

      if (typeof config.wateringStartTime !== 'string' || !/^([01]\d|2[0-3])[0-5]\d$/.test(config.wateringStartTime)) {
        config.wateringStartTime = '0600';
        saveConfig();
      }

      if (typeof config.email1 !== 'string') {
        config.email1 = '';
        saveConfig();
      }

      if (typeof config.email2 !== 'string') {
        config.email2 = '';
        saveConfig();
      }
      
      console.log('Configuration loaded from', CONFIG_FILE);
    } else {
      saveConfig();
      console.log('Created default configuration');
    }
  } catch (error) {
    console.error('Error loading config:', error);
    config = {
      ecowittUrl: DEFAULT_ECOWITT_URL,
      accessCount: 9,
      wateringInterval: 20,
      wateringStartTime: '0600',
      email1: '',
      email2: ''
    };
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('Configuration saved');
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

function getSoilMoistureValue(snapshot, sensorId) {
  const key = sensorId === 1 ? 'soilMoisture' : `soilMoisture${sensorId}`;
  const value = snapshot ? snapshot[key] : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getRelayPayload() {
  return relayState.map((relay) => ({
    ...relay,
    threshold: SOIL_MOISTURE_THRESHOLD,
    wateringInterval: config.wateringInterval
  }));
}

async function setRelayState(relayId, isOn, options = {}) {
  const relayIndex = relayId - 1;
  const relay = relayState[relayIndex];
  if (!relay) {
    throw new Error(`Invalid relay id ${relayId}`);
  }

  if (relayAutoOffTimers[relayIndex]) {
    clearTimeout(relayAutoOffTimers[relayIndex]);
    relayAutoOffTimers[relayIndex] = null;
  }

  await setRelayHardware(relayId, isOn);

  relay.isOn = isOn;
  relay.source = options.source || 'manual';
  relay.reason = options.reason || '';
  relay.startedAt = isOn ? new Date().toISOString() : null;
  relay.autoOffAt = null;
  const durationMinutes = isOn && typeof options.durationMinutes === 'number' && Number.isFinite(options.durationMinutes)
    ? options.durationMinutes
    : 0;

  if (isOn) {
    recordRelayOnEvent(relayId, relay.startedAt, durationMinutes, relay.source, relay.reason);
  }

  if (isOn && durationMinutes > 0) {
    const autoOffTime = Date.now() + durationMinutes * 60 * 1000;
    relay.autoOffAt = new Date(autoOffTime).toISOString();
    relayAutoOffTimers[relayIndex] = setTimeout(() => {
      setRelayState(relayId, false, {
        source: 'auto-timeout',
        reason: `Relay ${relayId} watering interval completed`
      }).catch((error) => {
        console.error(`Failed to auto turn off relay ${relayId}: ${error.message}`);
      });
    }, durationMinutes * 60 * 1000);
  }

  console.log(`Relay ${relayId} => ${isOn ? 'ON' : 'OFF'} (${relay.source}${relay.reason ? `: ${relay.reason}` : ''})`);
}

async function evaluateRelayAutomation(snapshot) {
  for (let relayId = 1; relayId <= RELAY_COUNT; relayId += 1) {
    const relay = relayState[relayId - 1];
    const moisture = getSoilMoistureValue(snapshot, relayId);
    relay.sensorAvailable = moisture !== null;
    relay.lastMoisture = moisture;

    if (moisture === null) {
      continue;
    }

    if (moisture < SOIL_MOISTURE_THRESHOLD && !relay.isOn) {
      await setRelayState(relayId, true, {
        source: 'auto',
        reason: `Sensor ${relayId} moisture ${moisture.toFixed(1)}% below ${SOIL_MOISTURE_THRESHOLD}%`,
        durationMinutes: config.wateringInterval
      });
    }
  }
}

async function pollSensorsForRelayControl(recordReading = false) {
  try {
    latestSensorSnapshot = await fetchAndParseSensorSnapshot({ recordReading });

    await evaluateRelayAutomation(latestSensorSnapshot);
  } catch (error) {
    console.error('Scheduled sensor poll failed:', error.message);
  }
}

function millisecondsUntilNextHour() {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(now.getHours() + 1);
  return next.getTime() - now.getTime();
}

function scheduleSensorPolling() {
  if (sensorPollTimer) {
    clearInterval(sensorPollTimer);
  }

  if (sensorPollStartTimer) {
    clearTimeout(sensorPollStartTimer);
  }

  const delayMs = millisecondsUntilNextHour();
  const nextRun = new Date(Date.now() + delayMs);
  console.log(`Next hourly sensor database reading scheduled for ${nextRun.toLocaleString()}`);

  sensorPollStartTimer = setTimeout(() => {
    pollSensorsForRelayControl(true);
    sensorPollTimer = setInterval(() => {
      pollSensorsForRelayControl(true);
    }, SENSOR_POLL_INTERVAL_MS);
  }, delayMs);

  // Keep relay automation state warm without recording a DB reading immediately.
  pollSensorsForRelayControl(false);
}

function getMirrorUrl() {
  return `https://r.jina.ai/http://${config.ecowittUrl.replace(/^https?:\/\//, '')}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getReportRecipients() {
  return [config.email1, config.email2]
    .map((email) => (typeof email === 'string' ? email.trim() : ''))
    .filter((email) => email.length > 0);
}

function formatReportDate(date) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function getDailyComparisonWindow(referenceDate = new Date()) {
  const windowEnd = new Date(referenceDate);
  windowEnd.setHours(5, 0, 0, 0);
  if (referenceDate < windowEnd) {
    windowEnd.setDate(windowEnd.getDate() - 1);
  }

  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - 1);

  return {
    start: windowStart,
    end: windowEnd
  };
}

function getSensorReadingAroundBoundary(sensorId, boundaryIso, direction) {
  const moistureColumn = `soil_moisture_${sensorId}`;
  const comparator = direction === 'after' ? '>=' : '<=';
  const sortOrder = direction === 'after' ? 'ASC' : 'DESC';

  const rows = querySqlRows(`
    SELECT recorded_at, ${moistureColumn} AS moisture
    FROM ecowitt_access_log
    WHERE recorded_at ${comparator} ${toSqlValue(boundaryIso)}
      AND ${moistureColumn} IS NOT NULL
    ORDER BY recorded_at ${sortOrder}
    LIMIT 1;
  `);

  return rows.length > 0 ? rows[0] : null;
}

function buildSoilMoistureDeltaLines(windowStartIso, windowEndIso) {
  const lines = [];

  for (let sensorId = 1; sensorId <= RELAY_COUNT; sensorId += 1) {
    const startReading = getSensorReadingAroundBoundary(sensorId, windowStartIso, 'after');
    const endReading = getSensorReadingAroundBoundary(sensorId, windowEndIso, 'before');

    if (!startReading || !endReading) {
      lines.push(`Sensor ${sensorId}: insufficient readings around the 5:00 AM boundaries`);
      continue;
    }

    const startValue = Number(startReading.moisture);
    const endValue = Number(endReading.moisture);
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) {
      lines.push(`Sensor ${sensorId}: insufficient numeric readings around the 5:00 AM boundaries`);
      continue;
    }

    const delta = endValue - startValue;
    const deltaLabel = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);

    lines.push(
      `Sensor ${sensorId}: ${startValue.toFixed(1)}% @ ${new Date(startReading.recorded_at).toLocaleString()} ` +
      `-> ${endValue.toFixed(1)}% @ ${new Date(endReading.recorded_at).toLocaleString()} ` +
      `(change ${deltaLabel}%)`
    );
  }

  return lines;
}

function getRelayTriggersInWindow(windowStartIso, windowEndIso) {
  return querySqlRows(`
    SELECT relay_id, started_at, duration_minutes, source, reason
    FROM relay_on_log
    WHERE started_at >= ${toSqlValue(windowStartIso)}
      AND started_at <= ${toSqlValue(windowEndIso)}
    ORDER BY started_at ASC;
  `);
}

function buildRelayTriggerLines(relayRows) {
  if (!Array.isArray(relayRows) || relayRows.length === 0) {
    return ['No relays were triggered ON in this window.'];
  }

  return relayRows.map((row) => {
    const startedAt = row.started_at ? new Date(row.started_at).toLocaleString() : 'unknown time';
    const duration = Number.isFinite(Number(row.duration_minutes)) ? `${row.duration_minutes} min` : 'unknown duration';
    const source = row.source || 'unknown source';
    const reason = row.reason || 'no reason logged';
    return `Relay ${row.relay_id} ON at ${startedAt} for ${duration} (${source}; ${reason})`;
  });
}

function sendMail(recipients, subject, body) {
  return new Promise((resolve, reject) => {
    const sendmailPath = '/usr/sbin/sendmail';
    if (!fs.existsSync(sendmailPath)) {
      reject(new Error('sendmail not found at /usr/sbin/sendmail'));
      return;
    }

    const process = spawn(sendmailPath, ['-t', '-oi']);
    let stderr = '';

    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `sendmail exited with code ${code}`));
      }
    });

    const headers = [
      `From: ${config.email1 || 'lewisrpi@proton.me'}`,
      `To: ${recipients.join(', ')}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      ''
    ].join('\r\n') + '\r\n';

    process.stdin.write(headers);
    process.stdin.write(`${body}\r\n`);
    process.stdin.end();
  });
}

function formatNumberValue(value, decimals = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--';
  }
  return value.toFixed(decimals);
}

async function ensureLatestSnapshot() {
  if (latestSensorSnapshot) {
    return latestSensorSnapshot;
  }

  latestSensorSnapshot = await fetchAndParseSensorSnapshot({ recordReading: false });
  await evaluateRelayAutomation(latestSensorSnapshot);
  return latestSensorSnapshot;
}

async function fetchAndParseSensorSnapshot(options = {}) {
  const { recordReading = false } = options;
  const markdown = await fetchEcoWittMarkdown();
  const data = parseEcoWittData(markdown);
  const snapshot = {
    ...data,
    capturedAt: new Date().toISOString()
  };

  if (recordReading) {
    recordEcoWittAccess(snapshot);
  }
  return snapshot;
}

async function sendGardenReportToRecipients(recipients) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('No recipients configured');
  }

  const today = new Date();
  const subject = `Garden Report for ${formatReportDate(today)}`;

  let temperatureLine = 'Temperature: -- C';
  let humidityLine = 'Humidity: -- %';
  let planterLine = 'Planter: -- %';
  let capturedAtLine = 'Sensor snapshot time: unavailable';

  try {
    const snapshot = await ensureLatestSnapshot();
    temperatureLine = `Temperature: ${formatNumberValue(snapshot.temperature)} C`;
    humidityLine = `Humidity: ${formatNumberValue(snapshot.humidity)} %`;
    planterLine = `${snapshot.soilMoistureName || 'Planter'}: ${formatNumberValue(snapshot.soilMoisture)} %`;
    capturedAtLine = `Sensor snapshot time: ${new Date(snapshot.capturedAt).toLocaleString()}`;
  } catch (error) {
    capturedAtLine = `Sensor snapshot time: unavailable (${error.message})`;
  }

  const cpuTemp = readCpuTemperature();
  const cpuLine = cpuTemp === null ? 'CPU Temp: unavailable' : `CPU Temp: ${cpuTemp.toFixed(1)} C`;

  const comparisonWindow = getDailyComparisonWindow(today);
  const windowStartIso = comparisonWindow.start.toISOString();
  const windowEndIso = comparisonWindow.end.toISOString();
  const soilDeltaLines = buildSoilMoistureDeltaLines(windowStartIso, windowEndIso);
  const relayTriggerLines = buildRelayTriggerLines(getRelayTriggersInWindow(windowStartIso, windowEndIso));

  const body = [
    `Garden report generated at ${today.toLocaleString()}`,
    capturedAtLine,
    '',
    temperatureLine,
    humidityLine,
    planterLine,
    cpuLine,
    '',
    `Soil moisture change window: ${comparisonWindow.start.toLocaleString()} to ${comparisonWindow.end.toLocaleString()}`,
    ...soilDeltaLines,
    '',
    'Relay ON activity in the same window:',
    ...relayTriggerLines
  ].join('\n');

  await sendMail(recipients, subject, body);
  console.log(`Daily garden report sent to ${recipients.join(', ')}`);
}

async function sendDailyGardenReport() {
  const recipients = getReportRecipients();
  if (recipients.length === 0) {
    console.log('Daily report skipped: no report email recipients configured');
    return;
  }

  await sendGardenReportToRecipients(recipients);
}

async function sendCompleteHistoryEmail() {
  const recipients = getReportRecipients();
  if (recipients.length === 0) {
    throw new Error('No report email addresses configured');
  }

  const sensorCsv = querySqlCsv(`
    SELECT
      id,
      recorded_at,
      record_date,
      record_time,
      temperature,
      humidity,
      soil_moisture_1,
      soil_moisture_2,
      soil_moisture_3,
      soil_moisture_4,
      soil_moisture_5,
      soil_moisture_6,
      soil_moisture_7,
      soil_moisture_8
    FROM ecowitt_access_log
    ORDER BY id DESC;
  `);

  const relayCsv = querySqlCsv(`
    SELECT
      id,
      relay_id,
      started_at,
      start_date,
      start_time,
      duration_minutes,
      source,
      reason
    FROM relay_on_log
    ORDER BY id DESC;
  `);

  const subject = `Garden Complete History ${new Date().toLocaleDateString()}`;
  const body = [
    `Complete history export generated at ${new Date().toLocaleString()}`,
    '',
    '=== Sensor Access History (CSV) ===',
    sensorCsv || '(no sensor history rows)',
    '',
    '=== Relay ON History (CSV) ===',
    relayCsv || '(no relay history rows)'
  ].join('\n');

  await sendMail(recipients, subject, body);
  return recipients;
}

function millisecondsUntilNextReport() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(DAILY_REPORT_HOUR, DAILY_REPORT_MINUTE, 0, 0);
  if (now >= next) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function scheduleDailyReport() {
  if (reportTimer) {
    clearTimeout(reportTimer);
  }

  const delayMs = millisecondsUntilNextReport();
  const nextRun = new Date(Date.now() + delayMs);
  console.log(`Next daily garden report scheduled for ${nextRun.toLocaleString()}`);

  reportTimer = setTimeout(async () => {
    try {
      await sendDailyGardenReport();
    } catch (error) {
      console.error('Failed to send daily garden report:', error.message);
    } finally {
      scheduleDailyReport();
    }
  }, delayMs);
}

function readCpuTemperature() {
  try {
    const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    const tempCelsius = parseFloat(raw) / 1000;
    return Number.isFinite(tempCelsius) ? tempCelsius : null;
  } catch {
    return null;
  }
}

function fetchEcoWittMarkdown() {
  return new Promise((resolve, reject) => {
    // Increment access count
    config.accessCount = (config.accessCount || 9) + 1;
    saveConfig();
    
    https
      .get(getMirrorUrl(), (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Mirror request failed with status ${response.statusCode}`));
          response.resume();
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve(body);
        });
      })
      .on('error', reject);
  });
}

function parseMetric(markdown, labelRegex, unitRegex) {
  const sectionRegex = new RegExp(`${labelRegex}[\\s\\S]{0,120}?\\*\\*(-?\\d+(?:\\.\\d+)?)\\*\\*\\s*${unitRegex}`, 'i');
  const match = markdown.match(sectionRegex);
  if (!match || !match[1]) {
    return null;
  }
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseSoilMoistureName(markdown) {
  const nameMatch = markdown.match(/(?:\n|^)\s*([A-Za-z0-9 _-]{2,40})\s*\n\s*\n\[\]\([^)]+#ch_soil_temp_humidity\d+\)/i);
  if (!nameMatch || !nameMatch[1]) {
    return 'Soil Moisture';
  }

  const name = nameMatch[1].trim();
  return name || 'Soil Moisture';
}

function parseSoilMoistureValues(markdown) {
  const regex = /Soil\s*Moisture[\s\S]{0,120}?\*\*(-?\d+(?:\.\d+)?)\*\*\s*%/gi;
  const values = [];
  let match = regex.exec(markdown);

  while (match && values.length < RELAY_COUNT) {
    const parsed = Number.parseFloat(match[1]);
    values.push(Number.isFinite(parsed) ? parsed : null);
    match = regex.exec(markdown);
  }

  return values;
}

function parseEcoWittData(markdown) {
  const temperature = parseMetric(markdown, 'Temperature', '(?:℃|°C)');
  const humidity = parseMetric(markdown, 'Humidity', '%');
  const soilTemperature = parseMetric(markdown, 'Soil\\s*Temperature', '(?:℃|°C)');
  const parsedMoistureValues = parseSoilMoistureValues(markdown);
  const soilMoisture = parsedMoistureValues[0] ?? parseMetric(markdown, 'Soil\\s*Moisture', '%');
  const soilMoistureName = parseSoilMoistureName(markdown);

  const result = {
    temperature,
    humidity,
    soilTemperature,
    soilMoisture,
    soilMoistureName,
    source: 'EcoWitt'
  };

  for (let sensorId = 2; sensorId <= RELAY_COUNT; sensorId += 1) {
    result[`soilMoisture${sensorId}`] = parsedMoistureValues[sensorId - 1] ?? null;
  }

  return result;
}

function serveStaticFile(filePath, res) {
  const extname = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reqPath = reqUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET configuration endpoint
  if (reqPath === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config));
    return;
  }

  // POST configuration endpoint
  if (reqPath === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const newConfig = JSON.parse(body);
        
        if (!newConfig.ecowittUrl || typeof newConfig.ecowittUrl !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid ecowittUrl' }));
          return;
        }

        const email1 = typeof newConfig.email1 === 'string' ? newConfig.email1.trim() : '';
        const email2 = typeof newConfig.email2 === 'string' ? newConfig.email2.trim() : '';

        if (email1 && !isValidEmail(email1)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report Email 1 is invalid' }));
          return;
        }

        if (email2 && !isValidEmail(email2)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report Email 2 is invalid' }));
          return;
        }
        
        // Validate wateringInterval if provided
        if (newConfig.wateringInterval !== undefined) {
          const interval = parseInt(newConfig.wateringInterval, 10);
          if (isNaN(interval) || interval < 1 || interval > 60) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Watering interval must be between 1 and 60 minutes' }));
            return;
          }
          config.wateringInterval = interval;
        }

        if (newConfig.wateringStartTime !== undefined) {
          const wateringStartTime = String(newConfig.wateringStartTime).trim();
          if (!/^([01]\d|2[0-3])[0-5]\d$/.test(wateringStartTime)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Watering start time must be in HHMM format (0000-2359)' }));
            return;
          }
          config.wateringStartTime = wateringStartTime;
        }
        
        config.ecowittUrl = newConfig.ecowittUrl;
        config.email1 = email1;
        config.email2 = email2;
        
        if (saveConfig()) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Configuration saved' }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to save configuration' }));
        }
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // API endpoint for CPU temperature
  if (reqPath === '/api/relays' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ relays: getRelayPayload() }));
    return;
  }

  if (reqPath.startsWith('/api/history') && req.method === 'GET') {
    try {
      const requestedLimit = Number.parseInt(reqUrl.searchParams.get('limit') || '50', 10);
      const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 50;
      const requestedHours = Number.parseInt(reqUrl.searchParams.get('hours') || '', 10);
      const requestedRelayHours = Number.parseInt(reqUrl.searchParams.get('relayHours') || '', 10);
      const hours = Number.isInteger(requestedHours) ? Math.min(Math.max(requestedHours, 1), 168) : null;
      const relayHours = Number.isInteger(requestedRelayHours)
        ? Math.min(Math.max(requestedRelayHours, 1), 168)
        : (hours || null);

      const sensorWhereClause = hours ? `WHERE julianday(recorded_at) >= julianday('now', '-${hours} hours')` : '';
      const relayWhereClause = relayHours ? `WHERE julianday(started_at) >= julianday('now', '-${relayHours} hours')` : '';

      const sensorRows = querySqlRows(`
        SELECT
          id,
          recorded_at,
          record_date,
          record_time,
          temperature,
          humidity,
          soil_moisture_1,
          soil_moisture_2,
          soil_moisture_3,
          soil_moisture_4,
          soil_moisture_5,
          soil_moisture_6,
          soil_moisture_7,
          soil_moisture_8
        FROM ecowitt_access_log
        ${sensorWhereClause}
        ORDER BY id DESC
        LIMIT ${limit};
      `);

      const relayRows = querySqlRows(`
        SELECT
          id,
          relay_id,
          started_at,
          start_date,
          start_time,
          duration_minutes,
          source,
          reason
        FROM relay_on_log
        ${relayWhereClause}
        ORDER BY id DESC
        LIMIT ${limit};
      `);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        limit,
        hours,
        relayHours,
        sensorAccessColumns: [
          'id',
          'recorded_at',
          'record_date',
          'record_time',
          'temperature',
          'humidity',
          'soil_moisture_1',
          'soil_moisture_2',
          'soil_moisture_3',
          'soil_moisture_4',
          'soil_moisture_5',
          'soil_moisture_6',
          'soil_moisture_7',
          'soil_moisture_8'
        ],
        relayOnColumns: [
          'id',
          'relay_id',
          'started_at',
          'start_date',
          'start_time',
          'duration_minutes',
          'source',
          'reason'
        ],
        sensorAccess: sensorRows,
        relayOnEvents: relayRows
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read history', details: error.message }));
    }
    return;
  }

  if (reqPath === '/api/relay-helper-health' && req.method === 'GET') {
    try {
      await checkRelayHelperHealth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  if (reqPath === '/api/relays' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const relayId = Number.parseInt(payload.relayId, 10);
        const action = typeof payload.action === 'string' ? payload.action.trim().toLowerCase() : '';

        if (!Number.isInteger(relayId) || relayId < 1 || relayId > RELAY_COUNT) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `relayId must be between 1 and ${RELAY_COUNT}` }));
          return;
        }

        if (action !== 'on' && action !== 'off') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'action must be on or off' }));
          return;
        }

        await setRelayState(relayId, action === 'on', {
          source: 'manual',
          reason: `Manual ${action.toUpperCase()} from dashboard`,
          durationMinutes: action === 'on' ? config.wateringInterval : undefined
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, relays: getRelayPayload() }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (reqPath === '/api/cpu-temp') {
    try {
      const temp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
      const tempCelsius = parseFloat(temp) / 1000;
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ temperature: tempCelsius }));
    } catch (error) {
      console.error('Error reading CPU temperature:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read CPU temperature', details: error.message }));
    }
    return;
  }

  // API endpoint for sensor data
  if (reqPath === '/api/sensors') {
    try {
      latestSensorSnapshot = await fetchAndParseSensorSnapshot({ recordReading: false });
      const data = latestSensorSnapshot;
      await evaluateRelayAutomation(latestSensorSnapshot);

      if (data.temperature === null && data.humidity === null && data.soilMoisture === null) {
        throw new Error('No sensor metrics found in mirrored content');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Failed to fetch sensor data from EcoWitt',
          details: error.message
        })
      );
    }
    return;
  }

  // API endpoint to trigger a test report email immediately
  if (reqPath === '/api/test-report' && req.method === 'POST') {
    try {
      const recipients = getReportRecipients();
      if (recipients.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No report email addresses configured' }));
        return;
      }

      await sendGardenReportToRecipients(recipients);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: `Test report sent to ${recipients.join(', ')}` }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to send test report', details: error.message }));
    }
    return;
  }

  if (reqPath === '/api/history/email' && req.method === 'POST') {
    try {
      const recipients = await sendCompleteHistoryEmail();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: `Complete history emailed to ${recipients.join(', ')}`
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // Serve static files
  let filePath = '.' + reqPath;
  if (filePath === './') {
    filePath = './index.html';
  }

  const resolvedPath = path.resolve(__dirname, filePath);
  
  // Security: prevent directory traversal
  if (!resolvedPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveStaticFile(resolvedPath, res);
});

// Load configuration before starting server
loadConfig();
initializeDatabase();
initializeRelayHardware();
scheduleDailyReport();
scheduleSensorPolling();

server.listen(PORT, HOST, () => {
  console.log(`Sensor proxy running on http://localhost:${PORT}/api/sensors`);
  console.log(`Dashboard accessible at http://localhost:${PORT}`);
  console.log(`Access from network: http://<your-pi-ip>:${PORT}`);
  console.log(`Using EcoWitt URL: ${config.ecowittUrl.substring(0, 50)}...`);
});
