/**
 * WindPowers - Real-Time Dashboard Frontend
 * Uses Socket.IO for live weather updates
 */

const CONFIG = {
    center: [18, 63],
    zoom: 4,
    bounds: { north: 71.5, south: 54, west: 4, east: 32 },
    gridResolution: 1.0
};

let windData = [];
let currentDay = 0;
let map = null;
let markers = [];
let heatmapVisible = true;
let socket = null;
let isConnected = false;
let lastUpdate = null;

const dayNames = ['Today', 'Tomorrow', '+2 days', '+3 days', '+4 days', '+5 days', '+6 days', '+7 days', '+8 days'];

// Dashboard metrics
let dashboardMetrics = {
    avgWindSpeed: 0,
    maxWindSpeed: 0,
    minTemperature: 0,
    maxTemperature: 0,
    alertCount: 0
};

async function init() {
    showLoading(true);
    
    // Initialize Socket.IO connection
    initSocket();
    
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'carto-light': {
                    type: 'raster',
                    tiles: [
                        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
                        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'
                    ],
                    tileSize: 256,
                    attribution: '© CartoDB © OpenStreetMap'
                }
            },
            layers: [{
                id: 'carto-layer',
                type: 'raster',
                source: 'carto-light',
                minzoom: 0,
                maxzoom: 19
            }]
        },
        center: CONFIG.center,
        zoom: CONFIG.zoom
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    
    map.on('zoom', () => {
        updateVisualization();
    });

    map.on('load', async () => {
        setupControls();
        showLoading(false);
        updateConnectionStatus();
        // Ensure wind data is loaded and visualized
        if (windData.length === 0) {
            await fetchWindData();
        }
        addWindSources();
        updateVisualization();
        updateDashboardMetrics();
    });
}

function initSocket() {
    // Use polling for Vercel/serverless (WebSockets not supported)
    // Falls back to HTTP polling every 30 seconds
    console.log('📡 Using polling mode for live updates');
    isConnected = true;
    updateConnectionStatus();
    
    // Fetch initial data
    fetchWindData();
    
    // Poll for updates every 30 seconds
    setInterval(fetchWindData, 30000);
}

async function fetchWindData() {
    try {
        const response = await fetch('/data/wind-data.json');
        if (response.ok) {
            const data = await response.json();
            const newData = data.data || data;
            
            // Check if data changed or map is ready
            if (JSON.stringify(newData) !== JSON.stringify(windData)) {
                windData = newData;
                lastUpdate = new Date().toISOString();
                
                // Update visualization if map is ready
                if (map && map.loaded()) {
                    addWindSources();
                    updateVisualization();
                    updateDashboardMetrics();
                    updateLastUpdateTime();
                    showUpdateIndicator();
                    console.log(`📦 Data loaded: ${windData.length} wind points`);
                }
            }
        }
    } catch (e) {
        console.log('Fetch failed:', e.message);
    }
}

function updateConnectionStatus() {
    const statusEl = document.getElementById('connection-status');
    const dotEl = document.getElementById('status-dot');
    
    if (statusEl) {
        statusEl.textContent = isConnected ? '🟢 Live' : '🔴 Reconnecting...';
        statusEl.title = isConnected ? 'Updates every 30 seconds' : 'Reconnecting...';
    }
    if (dotEl) {
        dotEl.className = isConnected ? 'status-dot live' : 'status-dot offline';
    }
}

function updateLastUpdateTime() {
    const timeEl = document.getElementById('last-update');
    if (timeEl && lastUpdate) {
        const date = new Date(lastUpdate);
        timeEl.textContent = date.toLocaleTimeString();
    }
}

function applyWeatherUpdate(updates) {
    // Update local data
    updates.forEach(update => {
        const point = windData.find(p => p.lat === update.lat && p.lon === update.lon);
        if (point && point.forecasts && point.forecasts.length > 0) {
            point.forecasts[0] = { ...point.forecasts[0], ...update.forecast };
        }
    });
    
    // Update map visualization
    updateVisualization();
    
    // Show update indicator
    showUpdateIndicator();
}

function showUpdateIndicator() {
    const indicator = document.getElementById('update-indicator');
    if (indicator) {
        indicator.classList.add('visible');
        setTimeout(() => {
            indicator.classList.remove('visible');
        }, 2000);
    }
}

function updateDashboardMetrics() {
    if (!windData.length) return;
    
    let totalWind = 0;
    let maxWind = 0;
    let minTemp = Infinity;
    let maxTemp = -Infinity;
    let alertCount = 0;
    
    windData.forEach(point => {
        const forecast = point.forecasts[currentDay];
        if (forecast) {
            totalWind += forecast.windSpeed;
            maxWind = Math.max(maxWind, forecast.windSpeed);
            minTemp = Math.min(minTemp, forecast.temperature);
            maxTemp = Math.max(maxTemp, forecast.temperature);
            
            // Count alerts for high wind
            if (forecast.windSpeed >= 15) alertCount++;
        }
    });
    
    dashboardMetrics = {
        avgWindSpeed: (totalWind / windData.length).toFixed(1),
        maxWindSpeed: maxWind.toFixed(1),
        minTemperature: minTemp.toFixed(1),
        maxTemperature: maxTemp.toFixed(1),
        alertCount
    };
    
    // Update DOM
    document.getElementById('avg-wind').textContent = dashboardMetrics.avgWindSpeed;
    document.getElementById('max-wind').textContent = dashboardMetrics.maxWindSpeed;
    document.getElementById('min-temp').textContent = dashboardMetrics.minTemperature;
    document.getElementById('max-temp').textContent = dashboardMetrics.maxTemperature;
    document.getElementById('alert-count').textContent = dashboardMetrics.alertCount;
    
    // Update alerts panel
    updateAlertsPanel();
}

function updateAlertsPanel() {
    const alerts = windData
        .map(p => ({ ...p, forecast: p.forecasts[currentDay] }))
        .filter(p => p.forecast && p.forecast.windSpeed >= 12)
        .sort((a, b) => b.forecast.windSpeed - a.forecast.windSpeed)
        .slice(0, 10);
    
    const container = document.getElementById('alerts-list');
    if (container) {
        if (alerts.length === 0) {
            container.innerHTML = '<div class="no-alerts">No high wind alerts</div>';
        } else {
            container.innerHTML = alerts.map(a => `
                <div class="alert-item">
                    <span class="alert-coords">${a.lat.toFixed(1)}°N, ${a.lon.toFixed(1)}°E</span>
                    <span class="alert-wind">${a.forecast.windSpeed.toFixed(1)} m/s</span>
                </div>
            `).join('');
        }
    }
}

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

function addWindSources() {
    map.addSource('wind-points', {
        type: 'geojson',
        data: getWindGeoJSON()
    });
    
    // Heatmap layer - enhanced visibility at low zoom
    map.addLayer({
        id: 'wind-heat',
        type: 'heatmap',
        source: 'wind-points',
        maxzoom: 12,
        paint: {
            'heatmap-weight': [
                'interpolate', ['linear'], ['get', 'windSpeed'],
                0, 0.4, 5, 0.6, 10, 0.85, 15, 1
            ],
            'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                1, 1.2, 4, 1.5, 7, 1, 10, 1
            ],
            'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(59, 130, 246, 0.5)',
                0.02, 'rgba(59, 130, 246, 0.6)',
                0.1, 'rgba(34, 197, 94, 0.75)',
                0.3, 'rgba(234, 179, 8, 0.85)',
                0.6, 'rgba(249, 115, 22, 0.9)',
                1, 'rgba(239, 68, 68, 0.95)'
            ],
            'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                1, 20, 4, 30, 7, 45, 10, 60
            ],
            'heatmap-opacity': [
                'interpolate', ['linear'], ['zoom'],
                1, 0.9, 5, 0.85, 8, 0.7, 12, 0.5
            ]
        }
    });
    
    // Circle layer - shows at zoom 5+
    map.addLayer({
        id: 'wind-circles',
        type: 'circle',
        source: 'wind-points',
        minzoom: 5,
        paint: {
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                5, 5, 7, 7, 10, 12
            ],
            'circle-color': [
                'interpolate', ['linear'], ['get', 'windSpeed'],
                0, '#93c5fd', 3, '#60a5fa', 5, '#34d399',
                8, '#fbbf24', 11, '#f97316', 15, '#ef4444'
            ],
            'circle-opacity': [
                'interpolate', ['linear'], ['zoom'],
                5, 0.6, 8, 0.8, 11, 0.95
            ],
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(255,255,255,0.7)',
            'circle-blur': 0.1
        }
    });
}

function getWindGeoJSON() {
    return {
        type: 'FeatureCollection',
        features: windData.map(point => {
            const forecast = point.forecasts[currentDay] || point.forecasts[0];
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
                properties: {
                    windSpeed: forecast?.windSpeed || 0,
                    windDirection: forecast?.windDirection || 0,
                    temperature: forecast?.temperature || 0
                }
            };
        })
    };
}

function updateVisualization() {
    const zoom = map.getZoom();
    const source = map.getSource('wind-points');
    
    if (source) {
        source.setData(getWindGeoJSON());
    }
    
    markers.forEach(m => m.remove());
    markers = [];
    
    if (zoom >= 6) {
        renderArrows(zoom);
    }
}

function renderArrows(zoom) {
    let skipFactor = 1;
    if (zoom < 8) skipFactor = 9;
    else if (zoom < 9) skipFactor = 4;
    else if (zoom < 10) skipFactor = 2;
    
    windData.forEach((point, i) => {
        if (i % skipFactor !== 0) return;
        
        const forecast = point.forecasts[currentDay];
        if (!forecast) return;
        
        const { windSpeed, windDirection } = forecast;
        
        const el = document.createElement('div');
        el.className = 'wind-arrow-container';
        
        const size = Math.max(16, Math.min(32, 12 + windSpeed * 1.5));
        const opacity = Math.min(0.9, 0.4 + (zoom - 6) * 0.15);
        
        el.innerHTML = `
            <svg width="${size}" height="${size}" viewBox="0 0 24 24" 
                 style="transform: rotate(${windDirection + 180}deg); opacity: ${opacity}; 
                        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                <path d="M12 2 L8 12 L12 9 L16 12 Z" fill="${getWindColor(windSpeed)}"/>
            </svg>
        `;
        
        el.style.cssText = 'cursor: pointer;';
        el.onclick = () => showInfoPanel(point);
        
        const marker = new maplibregl.Marker({ element: el })
            .setLngLat([point.lon, point.lat])
            .addTo(map);
        
        markers.push(marker);
    });
}

function getWindColor(speed) {
    if (speed < 3) return '#3b82f6';
    if (speed < 5) return '#22c55e';
    if (speed < 8) return '#eab308';
    if (speed < 11) return '#f97316';
    return '#ef4444';
}

function showInfoPanel(point) {
    const forecast = point.forecasts[currentDay];
    
    document.getElementById('location-name').textContent = 
        `${point.lat.toFixed(1)}°N, ${point.lon.toFixed(1)}°E`;
    document.getElementById('wind-speed').textContent = 
        `${forecast.windSpeed.toFixed(1)} m/s`;
    document.getElementById('wind-direction').textContent = 
        `${Math.round(forecast.windDirection)}° ${getWindDirectionName(forecast.windDirection)}`;
    document.getElementById('temperature').textContent = 
        `${forecast.temperature.toFixed(1)}°C`;
    document.getElementById('humidity').textContent = 
        `${Math.round(forecast.humidity)}%`;
    
    // Subscribe to location updates
    if (socket) {
        socket.emit('subscribeLocation', { lat: point.lat, lon: point.lon });
    }
    
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

function closePanel() {
    document.getElementById('info-panel').classList.add('hidden');
}

function getWindDirectionName(deg) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(deg / 45) % 8];
}

function setupControls() {
    const slider = document.getElementById('day-slider');
    const label = document.getElementById('day-label');
    
    slider.addEventListener('input', (e) => {
        currentDay = parseInt(e.target.value);
        label.textContent = dayNames[currentDay];
        updateVisualization();
        updateDashboardMetrics();
    });
}

function showLoading(show) {
    let loader = document.getElementById('loader');
    if (show) {
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'loader';
            loader.className = 'loading';
            loader.innerHTML = '<div class="loading-spinner"></div><div>Loading wind data...</div>';
            document.body.appendChild(loader);
        }
        loader.style.display = 'block';
    } else if (loader) {
        loader.style.display = 'none';
    }
}

// Price predictions (unchanged)
let pricePredictions = [];

async function loadPricePredictions() {
    try {
        const response = await fetch('/data/price-predictions.json');
        if (response.ok) {
            const data = await response.json();
            pricePredictions = data.predictions || [];
            renderPriceForecast();
        }
    } catch (e) {
        pricePredictions = generateSamplePredictions();
        renderPriceForecast();
    }
}

function generateSamplePredictions() {
    const predictions = [];
    const now = new Date();
    
    for (let day = 0; day < 9; day++) {
        const date = new Date(now);
        date.setDate(date.getDate() + day);
        
        const avgWind = 4 + Math.random() * 8;
        const basePrice = 80 - avgWind * 5 + Math.random() * 30;
        
        predictions.push({
            date: date.toISOString().split('T')[0],
            dayName: day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : `+${day}d`,
            avgWindSpeed: avgWind,
            predictedPrice: Math.max(20, basePrice),
            priceLevel: basePrice < 50 ? 'LOW' : basePrice > 90 ? 'HIGH' : 'NORMAL'
        });
    }
    return predictions;
}

function renderPriceForecast() {
    const container = document.getElementById('price-forecast');
    if (!container || !pricePredictions.length) return;
    
    container.innerHTML = pricePredictions.map((p, i) => `
        <div class="price-day ${p.priceLevel.toLowerCase()} ${i === currentDay ? 'active' : ''}"
             onclick="setDay(${i})">
            <div class="day-name">${p.dayName}</div>
            <div class="price">${Math.round(p.predictedPrice / 10)}¢</div>
            <div class="wind-info">${p.avgWindSpeed?.toFixed(1) || '--'} m/s</div>
        </div>
    `).join('');
    
    const current = pricePredictions[currentDay];
    if (current) {
        const priceEl = document.getElementById('price-value');
        const indicatorEl = document.getElementById('price-indicator');
        
        if (priceEl) priceEl.textContent = Math.round(current.predictedPrice / 10);
        if (indicatorEl) {
            indicatorEl.classList.remove('low', 'high');
            if (current.priceLevel === 'LOW') indicatorEl.classList.add('low');
            else if (current.priceLevel === 'HIGH') indicatorEl.classList.add('high');
        }
    }
}

function setDay(day) {
    currentDay = day;
    document.getElementById('day-slider').value = day;
    document.getElementById('day-label').textContent = dayNames[day];
    updateVisualization();
    renderPriceForecast();
    updateDashboardMetrics();
    
    // Notify server
    if (socket) {
        socket.emit('changeDay', day);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    loadPricePredictions();
});
