// Sensor Dashboard - JavaScript

// Configuration
const CONFIG = {
    // Local backend proxy endpoint (relative path works from any device)
    API_URL: '/api/sensors',
    CPU_TEMP_URL: '/api/cpu-temp',
    RELAYS_API_URL: '/api/relays',
    RELAY_HEALTH_API_URL: '/api/relay-helper-health',
    REFRESH_INTERVAL: 3600000, // 1 hour (60 minutes * 60 seconds * 1000 ms)
    CPU_TEMP_INTERVAL: 60000, // 1 minute
    RELAY_REFRESH_INTERVAL: 15000, // 15 seconds
    RELAY_HEALTH_REFRESH_INTERVAL: 15000, // 15 seconds
    TIMEOUT: 10000, // 10 seconds
    BLANK_TILE_RELOAD_COOLDOWN: 30000 // avoid reload loops if blank values persist
};

// DOM Elements
const temperatureEl = document.getElementById('temperature');
const humidityEl = document.getElementById('humidity');
const soilMoistureEl = document.getElementById('soilMoisture');
const cpuTempEl = document.getElementById('cpuTemp');
const soilTitleEl = document.getElementById('soil-title');
const tempStatusEl = document.getElementById('temp-status');
const humidityStatusEl = document.getElementById('humidity-status');
const soilStatusEl = document.getElementById('soil-status');
const cpuStatusEl = document.getElementById('cpu-status');
const lastUpdatedEl = document.getElementById('last-updated');
const errorMessageEl = document.getElementById('error-message');
const refreshBtn = document.getElementById('refresh-btn');
const setupBtn = document.getElementById('setup-btn');
const setupModal = document.getElementById('setup-modal');
const closeModalBtn = document.getElementById('close-modal');
const saveConfigBtn = document.getElementById('save-config');
const cancelConfigBtn = document.getElementById('cancel-config');
const showHistoryBtn = document.getElementById('show-history');
const emailHistoryBtn = document.getElementById('email-history');
const ecowittUrlInput = document.getElementById('ecowitt-url');
const wateringIntervalInput = document.getElementById('watering-interval');
const wateringStartTimeInput = document.getElementById('watering-start-time');
const email1Input = document.getElementById('email-1');
const email2Input = document.getElementById('email-2');
const setupMessageEl = document.getElementById('setup-message');
const accessCountEl = document.getElementById('access-count');
const relayHealthEl = document.getElementById('relay-health');
const relayStatusEls = Array.from(document.querySelectorAll('.relay-status'));
const relayButtons = Array.from(document.querySelectorAll('.relay-btn'));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_24H_HHMM_REGEX = /^([01]\d|2[0-3])[0-5]\d$/;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('Dashboard initialized');
    refreshBtn.addEventListener('click', fetchSensorData);
    setupBtn.addEventListener('click', openSetupModal);
    closeModalBtn.addEventListener('click', closeSetupModal);
    cancelConfigBtn.addEventListener('click', closeSetupModal);
    saveConfigBtn.addEventListener('click', saveConfiguration);
    showHistoryBtn.addEventListener('click', showRecentHistory);
    emailHistoryBtn.addEventListener('click', emailCompleteHistory);
    relayButtons.forEach((btn) => {
        btn.addEventListener('click', handleRelayButtonClick);
    });
    
    // Close modal when clicking outside
    setupModal.addEventListener('click', (e) => {
        if (e.target === setupModal) {
            closeSetupModal();
        }
    });
    
    // Fetch data immediately on load
    fetchSensorData();
    fetchCPUTemp();
    fetchRelayStates();
    fetchRelayHardwareHealth();
    
    // Set up auto-refresh
    setInterval(fetchSensorData, CONFIG.REFRESH_INTERVAL);
    setInterval(fetchCPUTemp, CONFIG.CPU_TEMP_INTERVAL);
    setInterval(fetchRelayStates, CONFIG.RELAY_REFRESH_INTERVAL);
    setInterval(fetchRelayHardwareHealth, CONFIG.RELAY_HEALTH_REFRESH_INTERVAL);

    // Guard against occasional blank tile rendering on the main dashboard.
    setInterval(reloadPageIfTileValuesAreBlank, 5000);
});

function reloadPageIfTileValuesAreBlank() {
    const tileElements = [temperatureEl, humidityEl, soilMoistureEl, cpuTempEl];
    const hasBlankValue = tileElements.some((el) => !el || el.textContent.trim() === '');

    if (!hasBlankValue) {
        return;
    }

    const now = Date.now();
    const lastReloadAt = Number(sessionStorage.getItem('blankTileReloadAt') || '0');

    if (now - lastReloadAt < CONFIG.BLANK_TILE_RELOAD_COOLDOWN) {
        return;
    }

    sessionStorage.setItem('blankTileReloadAt', String(now));
    window.location.reload();
}

async function fetchRelayHardwareHealth() {
    try {
        const response = await fetchWithTimeout(CONFIG.RELAY_HEALTH_API_URL, CONFIG.TIMEOUT);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const payload = await response.json();
        renderRelayHardwareHealth(Boolean(payload.ok));
    } catch (error) {
        console.error('Error fetching relay helper health:', error);
        renderRelayHardwareHealth(false);
    }
}

function renderRelayHardwareHealth(isHealthy) {
    if (!relayHealthEl) {
        return;
    }

    relayHealthEl.classList.remove('relay-health-ok', 'relay-health-down', 'relay-health-unknown');

    if (isHealthy) {
        relayHealthEl.textContent = 'Relay hardware: online';
        relayHealthEl.classList.add('relay-health-ok');
        return;
    }

    relayHealthEl.textContent = 'Relay hardware: offline';
    relayHealthEl.classList.add('relay-health-down');
}

/**
 * Fetch sensor data from the API
 */
async function fetchSensorData() {
    console.log('Fetching sensor data from local proxy...');
    
    try {
        // Clear previous error messages
        hideError();
        
        // Disable refresh button during fetch
        refreshBtn.disabled = true;
        
        // Fetch JSON from the local backend proxy
        const response = await fetchWithTimeout(CONFIG.API_URL, CONFIG.TIMEOUT);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Display sensor data
        displaySensorData(data);
        fetchRelayStates();
        
        // Update last updated timestamp
        updateLastUpdated();
        
        console.log('Sensor data fetched successfully from proxy:', data);
    } catch (error) {
        console.error('Error fetching sensor data:', error);
        
        // Provide helpful error message
        if (error.message.includes('timeout')) {
            showError('Request timed out. Please check your internet connection.');
        } else if (error.message.includes('Failed to fetch')) {
            showError('Cannot reach local proxy. Start server with: node /home/tom/Garden/server.js');
        } else {
            showError(`Failed to fetch sensor data: ${error.message}`);
        }
        
        displayPlaceholderData();
    } finally {
        refreshBtn.disabled = false;
    }
}

async function fetchRelayStates() {
    try {
        const response = await fetchWithTimeout(CONFIG.RELAYS_API_URL, CONFIG.TIMEOUT);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const payload = await response.json();
        renderRelayStates(payload.relays || []);
    } catch (error) {
        console.error('Error fetching relay states:', error);
        relayStatusEls.forEach((el) => {
            el.textContent = 'Relay status unavailable';
            el.classList.remove('status-good', 'status-warn', 'status-alert');
            el.classList.add('status-alert');
        });
    }
}

function renderRelayStates(relays) {
    relays.forEach((relay) => {
        const statusEl = document.getElementById(`relay-status-${relay.id}`);
        if (!statusEl) {
            return;
        }

        if (relay.isOn) {
            statusEl.textContent = relay.autoOffAt
                ? `ON (auto off at ${new Date(relay.autoOffAt).toLocaleTimeString()})`
                : 'ON';
            statusEl.classList.remove('status-warn', 'status-alert');
            statusEl.classList.add('status-good');
        } else if (!relay.sensorAvailable) {
            statusEl.textContent = 'OFF (waiting for sensor data)';
            statusEl.classList.remove('status-good', 'status-alert');
            statusEl.classList.add('status-warn');
        } else {
            statusEl.textContent = 'OFF';
            statusEl.classList.remove('status-good', 'status-alert');
            statusEl.classList.add('status-warn');
        }
    });
}

async function handleRelayButtonClick(event) {
    const button = event.currentTarget;
    const relayId = Number(button.dataset.relayId);
    const action = button.dataset.action;

    if (!relayId || !action) {
        return;
    }

    try {
        button.disabled = true;

        const response = await fetch(CONFIG.RELAYS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ relayId, action })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to update relay state');
        }

        renderRelayStates(result.relays || []);
    } catch (error) {
        showError(`Relay control failed: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

/**
 * Fetch with timeout
 * @param {string} url - The API endpoint URL
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise} The fetch promise with timeout
 */
function fetchWithTimeout(url, timeout) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Fetch timeout')), timeout)
        )
    ]);
}

/**
 * Display sensor data on the dashboard
 * @param {Object} data - The sensor data object
 * Expected structure: { temperature: number, humidity: number, soilMoisture: number }
 */
function displaySensorData(data) {
    soilTitleEl.textContent = data.soilMoistureName || 'Soil Moisture';

    // Validate and display temperature
    if (typeof data.temperature === 'number') {
        temperatureEl.textContent = data.temperature.toFixed(1) + ' °C';
        tempStatusEl.textContent = getTemperatureStatus(data.temperature);
        applyStatusClass(tempStatusEl, getTemperatureLevel(data.temperature));
    } else {
        temperatureEl.textContent = '-- °C';
        tempStatusEl.textContent = 'Invalid data';
        applyStatusClass(tempStatusEl, 'alert');
    }
    
    // Validate and display humidity
    if (typeof data.humidity === 'number') {
        humidityEl.textContent = data.humidity.toFixed(1) + ' %';
        humidityStatusEl.textContent = getHumidityStatus(data.humidity);
        applyStatusClass(humidityStatusEl, getHumidityLevel(data.humidity));
    } else {
        humidityEl.textContent = '-- %';
        humidityStatusEl.textContent = 'Invalid data';
        applyStatusClass(humidityStatusEl, 'alert');
    }
    
    // Validate and display soil moisture
    if (typeof data.soilMoisture === 'number') {
        soilMoistureEl.textContent = data.soilMoisture.toFixed(1) + ' %';
        soilStatusEl.textContent = getSoilMoistureStatus(data.soilMoisture);
        applyStatusClass(soilStatusEl, getSoilMoistureLevel(data.soilMoisture));
    } else {
        soilMoistureEl.textContent = '-- %';
        soilStatusEl.textContent = 'Invalid data';
        applyStatusClass(soilStatusEl, 'alert');
    }

    reloadPageIfTileValuesAreBlank();
}

/**
 * Display placeholder data (used when API is not configured or fails)
 */
function displayPlaceholderData() {
    soilTitleEl.textContent = 'Soil Moisture';
    temperatureEl.textContent = '-- °C';
    humidityEl.textContent = '-- %';
    soilMoistureEl.textContent = '-- %';
    
    tempStatusEl.textContent = 'Waiting for data...';
    humidityStatusEl.textContent = 'Waiting for data...';
    soilStatusEl.textContent = 'Waiting for data...';

    applyStatusClass(tempStatusEl, 'warn');
    applyStatusClass(humidityStatusEl, 'warn');
    applyStatusClass(soilStatusEl, 'warn');

    reloadPageIfTileValuesAreBlank();
}

function applyStatusClass(element, level) {
    element.classList.remove('status-good', 'status-warn', 'status-alert');
    if (level === 'good') {
        element.classList.add('status-good');
    } else if (level === 'warn') {
        element.classList.add('status-warn');
    } else {
        element.classList.add('status-alert');
    }
}

function getTemperatureLevel(temperature) {
    if (temperature < 0 || temperature >= 35) return 'alert';
    if (temperature < 10 || temperature >= 30) return 'warn';
    return 'good';
}

function getHumidityLevel(humidity) {
    if (humidity < 25 || humidity > 80) return 'alert';
    if (humidity < 35 || humidity > 70) return 'warn';
    return 'good';
}

function getSoilMoistureLevel(moisture) {
    if (moisture < 20 || moisture > 85) return 'alert';
    if (moisture < 35 || moisture > 70) return 'warn';
    return 'good';
}

/**
 * Get temperature status description
 * @param {number} temperature - Temperature in Celsius
 * @returns {string} Status description
 */
function getTemperatureStatus(temperature) {
    if (temperature < 0) return 'Freezing cold';
    if (temperature < 10) return 'Very cold';
    if (temperature < 20) return 'Cool';
    if (temperature < 25) return 'Comfortable';
    if (temperature < 35) return 'Warm';
    return 'Very hot';
}

/**
 * Get humidity status description
 * @param {number} humidity - Humidity percentage
 * @returns {string} Status description
 */
function getHumidityStatus(humidity) {
    if (humidity < 30) return 'Dry';
    if (humidity < 50) return 'Comfortable';
    if (humidity < 70) return 'Humid';
    return 'Very humid';
}

/**
 * Get soil moisture status description
 * @param {number} moisture - Soil moisture percentage
 * @returns {string} Status description
 */
function getSoilMoistureStatus(moisture) {
    if (moisture < 20) return 'Very dry - water needed';
    if (moisture < 40) return 'Dry';
    if (moisture < 60) return 'Good';
    if (moisture < 80) return 'Moist';
    return 'Very moist';
}

/**
 * Fetch CPU temperature from the API
 */
async function fetchCPUTemp() {
    console.log('Fetching CPU temperature...');
    
    try {
        const response = await fetchWithTimeout(CONFIG.CPU_TEMP_URL, CONFIG.TIMEOUT);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        displayCPUTemp(data.temperature);
        
        console.log('CPU temperature fetched:', data.temperature);
    } catch (error) {
        console.error('Error fetching CPU temperature:', error);
        cpuTempEl.textContent = '-- °C';
        cpuStatusEl.textContent = 'Error loading';
        cpuStatusEl.className = 'sensor-status';
    }
}

/**
 * Display CPU temperature with status color
 * @param {number} temp - CPU temperature in Celsius
 */
function displayCPUTemp(temp) {
    if (temp === null || temp === undefined) {
        cpuTempEl.textContent = '-- °C';
        cpuStatusEl.textContent = 'No data';
        cpuStatusEl.className = 'sensor-status';
        reloadPageIfTileValuesAreBlank();
        return;
    }
    
    cpuTempEl.textContent = `${temp.toFixed(1)} °C`;
    
    // Determine status based on temperature
    // Green: < 60°C (good)
    // Amber: 60-75°C (warm)
    // Red: > 75°C (hot)
    if (temp < 60) {
        cpuStatusEl.textContent = 'Normal';
        cpuStatusEl.className = 'sensor-status status-good';
    } else if (temp < 75) {
        cpuStatusEl.textContent = 'Warm';
        cpuStatusEl.className = 'sensor-status status-warn';
    } else {
        cpuStatusEl.textContent = 'Hot';
        cpuStatusEl.className = 'sensor-status status-alert';
    }

    reloadPageIfTileValuesAreBlank();
}

/**
 * Update the last updated timestamp
 */
function updateLastUpdated() {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    const dateString = now.toLocaleDateString();
    lastUpdatedEl.textContent = `Last updated: ${dateString} ${timeString}`;
}

/**
 * Show error message
 * @param {string} message - Error message to display
 */
function showError(message) {
    errorMessageEl.textContent = message;
    errorMessageEl.style.display = 'block';
}

/**
 * Hide error message
 */
function hideError() {
    errorMessageEl.style.display = 'none';
    errorMessageEl.textContent = '';
}

/**
 * Open setup modal and load current configuration
 */
async function openSetupModal() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        ecowittUrlInput.value = config.ecowittUrl || '';
        wateringIntervalInput.value = config.wateringInterval || 20;
        wateringStartTimeInput.value = config.wateringStartTime || '0600';
        email1Input.value = config.email1 || '';
        email2Input.value = config.email2 || '';
        accessCountEl.textContent = config.accessCount || 0;
    } catch (error) {
        console.error('Failed to load config:', error);
        ecowittUrlInput.value = '';
        wateringIntervalInput.value = 20;
        wateringStartTimeInput.value = '0600';
        email1Input.value = '';
        email2Input.value = '';
        accessCountEl.textContent = '--';
    }
    setupModal.style.display = 'flex';
    setupMessageEl.style.display = 'none';
}

/**
 * Close setup modal
 */
function closeSetupModal() {
    setupModal.style.display = 'none';
    setupMessageEl.style.display = 'none';
}

/**
 * Save configuration to server
 */
async function saveConfiguration() {
    const newUrl = ecowittUrlInput.value.trim();
    const wateringInterval = parseInt(wateringIntervalInput.value, 10);
    const wateringStartTime = wateringStartTimeInput.value.trim();
    const email1 = email1Input.value.trim();
    const email2 = email2Input.value.trim();
    
    if (!newUrl) {
        showSetupMessage('Please enter a valid URL', 'error');
        return;
    }
    
    // Basic URL validation
    if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
        showSetupMessage('URL must start with http:// or https://', 'error');
        return;
    }
    
    // Validate watering interval
    if (isNaN(wateringInterval) || wateringInterval < 1 || wateringInterval > 60) {
        showSetupMessage('Watering interval must be between 1 and 60 minutes', 'error');
        return;
    }

    if (!TIME_24H_HHMM_REGEX.test(wateringStartTime)) {
        showSetupMessage('Watering start time must be 4 digits in 24-hour HHMM format (0000-2359)', 'error');
        return;
    }

    if (email1 && !EMAIL_REGEX.test(email1)) {
        showSetupMessage('Report Email 1 is not a valid email address', 'error');
        return;
    }

    if (email2 && !EMAIL_REGEX.test(email2)) {
        showSetupMessage('Report Email 2 is not a valid email address', 'error');
        return;
    }
    
    try {
        saveConfigBtn.disabled = true;
        saveConfigBtn.textContent = 'Saving...';
        
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                ecowittUrl: newUrl,
                wateringInterval: wateringInterval,
                wateringStartTime: wateringStartTime,
                email1: email1,
                email2: email2
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showSetupMessage('Configuration saved! Refreshing data...', 'success');
            setTimeout(() => {
                closeSetupModal();
                fetchSensorData();
            }, 1500);
        } else {
            showSetupMessage(result.error || 'Failed to save configuration', 'error');
        }
    } catch (error) {
        console.error('Failed to save config:', error);
        showSetupMessage('Network error: ' + error.message, 'error');
    } finally {
        saveConfigBtn.disabled = false;
        saveConfigBtn.textContent = 'Save Configuration';
    }
}

async function showRecentHistory() {
    window.location.href = 'history.html?limit=50';
}

async function emailCompleteHistory() {
    try {
        emailHistoryBtn.disabled = true;
        emailHistoryBtn.textContent = 'Emailing...';

        const response = await fetch('/api/history/email', {
            method: 'POST'
        });
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'Failed to email history');
        }

        showSetupMessage(payload.message || 'History email sent', 'success');
    } catch (error) {
        showSetupMessage(`Failed to email history: ${error.message}`, 'error');
    } finally {
        emailHistoryBtn.disabled = false;
        emailHistoryBtn.textContent = 'Email Complete History';
    }
}

/**
 * Show setup message
 * @param {string} message - Message to display
 * @param {string} type - 'success' or 'error'
 */
function showSetupMessage(message, type) {
    setupMessageEl.textContent = message;
    setupMessageEl.className = 'setup-message ' + type;
    setupMessageEl.style.display = 'block';
}

