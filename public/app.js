// WindPowers - Nordic Wind Map
// Built by Jarvis ⚡

const CONFIG = {
    // Nordic bounds: Norway, Sweden, Finland, Denmark
    center: [18, 63], // Centered on Sweden
    zoom: 4,
    bounds: {
        north: 71.5,
        south: 54,
        west: 4,
        east: 32
    },
    // Grid resolution in degrees
    gridResolution: 1.0,
    // yr.no API
    apiBase: '/api/weather'
};

// Wind data storage
let windData = [];
let currentDay = 0;
let map = null;
let windLayer = null;
let markers = [];

// Day names
const dayNames = ['Today', 'Tomorrow', '+2 days', '+3 days', '+4 days', '+5 days', '+6 days', '+7 days', '+8 days'];

// Initialize the application
async function init() {
    showLoading(true);
    
    // Initialize map
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'osm': {
                    type: 'raster',
                    tiles: [
                        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
                    ],
                    tileSize: 256,
                    attribution: '© OpenStreetMap contributors'
                }
            },
            layers: [{
                id: 'osm-layer',
                type: 'raster',
                source: 'osm',
                minzoom: 0,
                maxzoom: 19
            }]
        },
        center: CONFIG.center,
        zoom: CONFIG.zoom,
        maxBounds: [[CONFIG.bounds.west - 2, CONFIG.bounds.south - 2], 
                    [CONFIG.bounds.east + 2, CONFIG.bounds.north + 2]]
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-left');

    map.on('load', async () => {
        await loadWindData();
        setupControls();
        showLoading(false);
    });
}

// Generate grid points for Nordic region
function generateGridPoints() {
    const points = [];
    const { north, south, west, east } = CONFIG.bounds;
    
    for (let lat = south; lat <= north; lat += CONFIG.gridResolution) {
        for (let lon = west; lon <= east; lon += CONFIG.gridResolution) {
            points.push({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
        }
    }
    
    return points;
}

// Load wind data from API or cache
async function loadWindData() {
    try {
        // Try to load cached data first
        const response = await fetch('/data/wind-data.json');
        if (response.ok) {
            windData = await response.json();
            console.log(`Loaded ${windData.length} wind data points`);
            renderWind();
            return;
        }
    } catch (e) {
        console.log('No cached data, using sample data');
    }
    
    // Use sample/demo data for now
    windData = generateSampleData();
    renderWind();
}

// Generate sample data for demo
function generateSampleData() {
    const points = generateGridPoints();
    const data = [];
    
    points.forEach(point => {
        // Generate 9 days of forecast
        const forecasts = [];
        let baseSpeed = 3 + Math.random() * 8;
        let baseDir = Math.random() * 360;
        let baseTemp = -5 + Math.random() * 15;
        
        for (let day = 0; day < 9; day++) {
            forecasts.push({
                day,
                windSpeed: Math.max(0, baseSpeed + (Math.random() - 0.5) * 4),
                windDirection: (baseDir + (Math.random() - 0.5) * 40 + 360) % 360,
                temperature: baseTemp + (Math.random() - 0.5) * 5,
                humidity: 50 + Math.random() * 40
            });
            
            // Drift values for next day
            baseSpeed += (Math.random() - 0.5) * 2;
            baseDir += (Math.random() - 0.5) * 20;
            baseTemp += (Math.random() - 0.5) * 3;
        }
        
        data.push({
            lat: point.lat,
            lon: point.lon,
            forecasts
        });
    });
    
    return data;
}

// Render wind arrows on map
function renderWind() {
    // Clear existing markers
    markers.forEach(m => m.remove());
    markers = [];
    
    windData.forEach(point => {
        const forecast = point.forecasts[currentDay];
        if (!forecast) return;
        
        const { windSpeed, windDirection } = forecast;
        
        // Create wind arrow element
        const el = document.createElement('div');
        el.className = 'wind-marker';
        el.style.cssText = `
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        `;
        
        const arrow = document.createElement('div');
        const color = getWindColor(windSpeed);
        const size = Math.min(24, 10 + windSpeed * 1.5);
        
        arrow.style.cssText = `
            width: 0;
            height: 0;
            border-left: ${size/3}px solid transparent;
            border-right: ${size/3}px solid transparent;
            border-bottom: ${size}px solid ${color};
            transform: rotate(${windDirection}deg);
            transition: transform 0.5s ease;
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
        `;
        
        el.appendChild(arrow);
        
        // Add click handler
        el.onclick = () => showInfoPanel(point);
        
        const marker = new maplibregl.Marker({ element: el })
            .setLngLat([point.lon, point.lat])
            .addTo(map);
        
        markers.push(marker);
    });
}

// Get color based on wind speed
function getWindColor(speed) {
    if (speed < 3) return '#22c55e';      // Green - calm
    if (speed < 6) return '#eab308';       // Yellow - light
    if (speed < 11) return '#f97316';      // Orange - moderate
    return '#ef4444';                       // Red - strong
}

// Show info panel for selected point
function showInfoPanel(point) {
    const forecast = point.forecasts[currentDay];
    
    document.getElementById('location-name').textContent = 
        `${point.lat.toFixed(2)}°N, ${point.lon.toFixed(2)}°E`;
    document.getElementById('wind-speed').textContent = 
        `${forecast.windSpeed.toFixed(1)} m/s`;
    document.getElementById('wind-direction').textContent = 
        `${Math.round(forecast.windDirection)}° ${getWindDirectionName(forecast.windDirection)}`;
    document.getElementById('temperature').textContent = 
        `${forecast.temperature.toFixed(1)}°C`;
    document.getElementById('humidity').textContent = 
        `${Math.round(forecast.humidity)}%`;
    
    // Render mini forecast
    const miniContainer = document.getElementById('forecast-mini');
    miniContainer.innerHTML = point.forecasts.slice(0, 7).map((f, i) => `
        <div class="forecast-day ${i === currentDay ? 'active' : ''}">
            <div class="day-name">${i === 0 ? 'Today' : `+${i}d`}</div>
            <div class="wind">${f.windSpeed.toFixed(0)}</div>
            <div class="temp">${f.temperature.toFixed(0)}°</div>
        </div>
    `).join('');
    
    document.getElementById('info-panel').classList.remove('hidden');
}

// Close info panel
function closePanel() {
    document.getElementById('info-panel').classList.add('hidden');
}

// Get cardinal direction from degrees
function getWindDirectionName(deg) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(deg / 45) % 8;
    return directions[index];
}

// Setup controls
function setupControls() {
    const slider = document.getElementById('day-slider');
    const label = document.getElementById('day-label');
    
    slider.addEventListener('input', (e) => {
        currentDay = parseInt(e.target.value);
        label.textContent = dayNames[currentDay];
        renderWind();
    });
}

// Loading indicator
function showLoading(show) {
    let loader = document.getElementById('loader');
    
    if (show) {
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'loader';
            loader.className = 'loading';
            loader.innerHTML = `
                <div class="loading-spinner"></div>
                <div>Loading wind data...</div>
            `;
            document.body.appendChild(loader);
        }
        loader.style.display = 'block';
    } else if (loader) {
        loader.style.display = 'none';
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
