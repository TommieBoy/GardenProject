const http = require('node:http');
const { execFileSync } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = 3099;
const RELAY_GPIO_PINS = [5, 6, 13, 16, 19, 20, 21, 26];

function runPinctrl(args) {
  execFileSync('/usr/bin/pinctrl', args, { stdio: 'pipe' });
}

function setRelayHardware(relayId, isOn) {
  const relayIndex = relayId - 1;
  const pin = RELAY_GPIO_PINS[relayIndex];
  if (pin === undefined) {
    throw new Error(`No GPIO mapping for relay ${relayId}`);
  }

  // Active-low relay board: LOW energizes relay (ON), HIGH de-energizes relay (OFF).
  runPinctrl(['set', String(pin), 'op']);
  runPinctrl(['set', String(pin), isOn ? 'dl' : 'dh']);
}

function initializeRelaysOff() {
  for (let relayId = 1; relayId <= RELAY_GPIO_PINS.length; relayId += 1) {
    setRelayHardware(relayId, false);
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && req.url === '/initialize') {
    try {
      initializeRelaysOff();
      jsonResponse(res, 200, { success: true });
    } catch (error) {
      jsonResponse(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/relay-state') {
    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || '{}');
      const relayId = Number.parseInt(payload.relayId, 10);
      const isOn = Boolean(payload.isOn);

      if (!Number.isInteger(relayId) || relayId < 1 || relayId > RELAY_GPIO_PINS.length) {
        jsonResponse(res, 400, { error: `relayId must be between 1 and ${RELAY_GPIO_PINS.length}` });
        return;
      }

      setRelayHardware(relayId, isOn);
      jsonResponse(res, 200, { success: true });
    } catch (error) {
      jsonResponse(res, 500, { error: error.message });
    }
    return;
  }

  jsonResponse(res, 404, { error: 'Not found' });
});

try {
  initializeRelaysOff();
  console.log('Relay helper initialized all relays OFF');
} catch (error) {
  console.error('Relay helper initialization failed:', error.message);
}

server.listen(PORT, HOST, () => {
  console.log(`Relay helper listening on http://${HOST}:${PORT}`);
});
