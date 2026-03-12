# Sensor Dashboard Project - Copilot Instructions

## Project Overview
Web-based sensor dashboard that fetches and displays temperature, humidity, and soil moisture data from an EcoWitt weather station.

## Data Source
- **Provider**: EcoWitt Weather Station Network
- **Device**: Connected to public share link for real-time data access
- **Data Refresh**: Every 30 seconds (configurable)

## Technology Stack
- HTML5 for structure
- CSS3 for styling and responsive design
- JavaScript for client-side logic and data fetching

## Key Features
- Real-time sensor data display (temperature, humidity, soil moisture)
- Fetches data from EcoWitt weather station
- Responsive dashboard interface
- Clean, modern UI with status indicators
- Auto-refresh with manual refresh button
- Error handling for network/API failures

## Development Guidelines
- Use fetch API for data retrieval
- Parse EcoWitt HTML responses to extract sensor data
- Implement error handling for API failures and CORS issues
- Keep code modular and well-commented
- Ensure responsive design for mobile and desktop
- Update dashboard every 30 seconds

## Configuration
- API endpoint: Uses EcoWitt public share link
- Located in: `script.js` CONFIG object
- To change device: Update `CONFIG.API_URL` with new EcoWitt share link
