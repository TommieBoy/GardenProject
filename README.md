# Sensor Dashboard

A modern, responsive web-based sensor dashboard that displays real-time temperature, humidity, and soil moisture readings from an external web API.

## Features

- **Real-time Sensor Monitoring**: Display temperature, humidity, and soil moisture data
- **Easy Configuration**: Setup button allows changing EcoWitt URL without editing code
- **Network Access**: Access dashboard from any device on your home network (phone, tablet, laptop)
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Auto-Refresh**: Automatically fetches sensor data at configurable intervals
- **Auto-Start**: Runs automatically on boot via systemd service
- **Error Handling**: Graceful error messages when API fails or data is unavailable
- **Status Indicators**: Color-coded sensor status (green=good, amber=warning, red=alert)
- **Modern UI**: Beautiful gradient colors and smooth animations

## Project Structure

```
.
├── index.html          # Main HTML file with dashboard markup
├── style.css           # Responsive styling and animations
├── script.js           # JavaScript logic for data fetching and display
├── README.md           # This file
└── .github/
    └── copilot-instructions.md  # Copilot configuration
```

## Setup Instructions

### 1. API Configuration

The dashboard is configured to fetch data from a local backend proxy:

```javascript
const CONFIG = {
    API_URL: 'http://localhost:3000/api/sensors',
    REFRESH_INTERVAL: 30000, // 30 seconds
    TIMEOUT: 10000 // 10 seconds
};
```

If you need to change the EcoWitt device, update `ECOWITT_URL` in `server.js`.

### 2. Data Source

Data is fetched from your EcoWitt weather station and includes:
- **Temperature**: In Celsius (°C)
- **Humidity**: As a percentage (%)
- **Soil Moisture**: As a percentage (%)

**To change the EcoWitt device:**
1. Open the dashboard in your browser
2. Click the "Setup" button
3. Enter your new EcoWitt public share URL
4. Click "Save Configuration"

The configuration is saved in `config.json` and persists across reboots.

### 3. Running the Dashboard

The backend service runs automatically on system boot. Access the dashboard from:

**On the Raspberry Pi itself:**
```
http://localhost:3000
```

**From other devices on your home network (WiFi/Ethernet):**
```
http://192.168.1.124:3000
```

Replace `192.168.1.124` with your Raspberry Pi's actual IP address. To find it, run:
```bash
hostname -I
```

Start the backend manually (if service is not running):

```bash
cd /home/tom/Garden
npm start
```

If `npm` says package metadata is missing, run once:

```bash
cd /home/tom/Garden
npm install
```

### 4. Auto-start on reboot (systemd)

Install and enable the service:

```bash
cd /home/tom/Garden
./install-service.sh
```

Useful commands:

```bash
sudo systemctl status sensor-dashboard.service --no-pager
sudo systemctl restart sensor-dashboard.service
sudo journalctl -u sensor-dashboard.service -n 50 --no-pager
```

Simply open `index.html` in a web browser:

- **Local:** Double-click `index.html` or open it with your browser
- **With Server:** Use any HTTP server (e.g., `python -m http.server 8000`)
- **VS Code:** Use the Live Server extension

## Features in Detail

### Auto-Refresh
The dashboard automatically fetches data every 30 seconds (configurable in `CONFIG.REFRESH_INTERVAL`).

### Manual Refresh
Click the "Refresh Data" button to immediately fetch the latest sensor readings.

### Status Messages
Each sensor displays a contextual status message:

- **Temperature**: Freezing cold → Very cold → Cool → Comfortable → Warm → Very hot
- **Humidity**: Dry → Comfortable → Humid → Very humid
- **Soil Moisture**: Very dry → Dry → Good → Moist → Very moist

### Error Handling
If the API fails or the network is unavailable, the dashboard displays:
- An error message explaining what went wrong
- Placeholder values (--) for sensor readings
- The "Refresh Data" button remains enabled for retry

## Customization

### Change the EcoWitt Device

**Option 1: Using the Setup Button (Recommended)**
1. Open the dashboard in your browser
2. Click "Setup"
3. Enter your new EcoWitt public share URL
4. Click "Save Configuration"

**Option 2: Manual Configuration**
Edit `config.json` in the project directory:
```json
{
  "ecowittUrl": "https://www.ecowitt.net/home/share?authorize=YOUR_AUTH_CODE&device_id=YOUR_DEVICE_ID"
}
```
Then restart the service: `sudo systemctl restart sensor-dashboard.service`

### Change Refresh Interval
Edit `CONFIG.REFRESH_INTERVAL` in `script.js` (value in milliseconds):

```javascript
REFRESH_INTERVAL: 60000  // 60 seconds instead of 30
```

### Change API Timeout
Edit `CONFIG.TIMEOUT` in `script.js`:

```javascript
TIMEOUT: 5000  // 5 seconds timeout
```

### Modify Status Thresholds
Edit the status functions in `script.js`:
- `getTemperatureStatus()`
- `getHumidityStatus()`
- `getSoilMoistureStatus()`

### Customize Colors and Styling
Edit `style.css` to change:
- Color gradients in `.sensor-card` classes
- Font sizes and layouts
- Card animations and hover effects

## Browser Compatibility

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Technical Stack

- **HTML5**: Semantic markup and structure
- **CSS3**: Flexbox, Grid, Gradients, Animations
- **JavaScript (ES6+)**: Fetch API, async/await, DOM manipulation

## Troubleshooting

### Cannot Access from Other Devices

If you can't access the dashboard from another device on your network:

1. Verify the Raspberry Pi's IP address:
   ```bash
   hostname -I
   ```

2. Check if the service is running:
   ```bash
   systemctl status sensor-dashboard.service --no-pager
   ```

3. Test from the Pi itself:
   ```bash
   curl http://localhost:3000
   ```

4. Check firewall (if enabled):
   ```bash
   sudo ufw status
   sudo ufw allow 3000/tcp  # If firewall is active
   ```

5. Ensure both devices are on the same WiFi network

### Data Not Loading
1. Check browser console (F12) for errors
2. Verify `node server.js` is running in `/home/tom/Garden`
3. Ensure the weather station is online and reporting data
4. Open `http://localhost:3000/api/sensors` in a browser to confirm proxy output

### Proxy Not Running

If you see `Failed to fetch` in the dashboard, the frontend cannot reach the local server.

Run:
```bash
cd /home/tom/Garden
node server.js
```
- Clear browser cache (Ctrl+Shift+Delete)
- Verify `style.css` is in the same directory as `index.html`

### Auto-Refresh Not Working
- Check browser console for JavaScript errors
- Verify `CONFIG.REFRESH_INTERVAL` is set correctly (in milliseconds)

## Future Enhancements

- Add data history/charts
- Store data in localStorage
- Add multiple location/room support
- Push notifications for critical thresholds
- Export data to CSV
- Dark mode theme

## License

This project is provided as-is for educational and personal use.

## Support

For issues or questions, check:
1. Browser console for error messages
2. Network tab in browser DevTools to see API responses
3. Verify API endpoint URL and response format
