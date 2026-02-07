// WindPowers - Nordic Wind Map
// Built by Jarvis ⚡

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

const dayNames = ['Today', 'Tomorrow', '+2 days', '+3 days', '+4 days', '+5 days', '+6 days', '+7 days', '+8 days'];

async function init() {
    showLoading(true);
    
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
    
    // Update visualization on zoom
    map.on('zoom', () => {
        updateVisualization();
    });

    map.on('load', async () => {
        await loadWindData();
        setupControls();
        showLoading(false);
    });
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

async function loadWindData() {
    try {
        const response = await fetch('/data/wind-data.json');
        if (response.ok) {
            const cached = await response.json();
            windData = cached.data || cached;
            console.log(`Loaded ${windData.length} wind data points`);
        }
    } catch (e) {
        console.log('Using sample data');
    }
    
    if (!windData.length) {
        windData = generateSampleData();
    }
    
    // Add heatmap source
    addWindSources();
    updateVisualization();
}

function generateSampleData() {
    const points = generateGridPoints();
    return points.map(point => {
        const forecasts = [];
        // Create realistic wind patterns - stronger near coasts, variable inland
        const coastFactor = Math.min(1, Math.abs(point.lon - 10) / 15); // Distance from Atlantic
        let baseSpeed = 2 + Math.random() * 6 + coastFactor * 4;
        let baseDir = 200 + Math.random() * 60; // Prevailing westerlies
        let baseTemp = 5 - (point.lat - 55) * 0.5 + Math.random() * 5;
        
        for (let day = 0; day < 9; day++) {
            forecasts.push({
                day,
                windSpeed: Math.max(0.5, baseSpeed + (Math.random() - 0.5) * 3),
                windDirection: (baseDir + (Math.random() - 0.5) * 30 + 360) % 360,
                temperature: baseTemp + (Math.random() - 0.5) * 4,
                humidity: 60 + Math.random() * 30
            });
            baseSpeed += (Math.random() - 0.5) * 1.5;
            baseDir += (Math.random() - 0.5) * 15;
        }
        return { lat: point.lat, lon: point.lon, forecasts };
    });
}

function addWindSources() {
    // Add GeoJSON source for wind data
    map.addSource('wind-points', {
        type: 'geojson',
        data: getWindGeoJSON()
    });
    
    // Heatmap layer - smooth gradient based on wind speed
    map.addLayer({
        id: 'wind-heat',
        type: 'heatmap',
        source: 'wind-points',
        maxzoom: 10,
        paint: {
            // Weight by wind speed - higher wind = more intensity
            'heatmap-weight': [
                'interpolate', ['linear'], ['get', 'windSpeed'],
                0, 0.1,
                3, 0.3,
                6, 0.5,
                10, 0.8,
                15, 1
            ],
            // Intensity increases with zoom
            'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                3, 0.3,
                5, 0.5,
                7, 0.8,
                9, 1
            ],
            // Beautiful color gradient: blue (calm) → green → yellow → orange → red (strong)
            'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(255,255,255,0)',
                0.05, 'rgba(220,240,255,0.3)',
                0.15, 'rgba(150,200,255,0.5)',
                0.3, 'rgba(100,180,220,0.6)',
                0.45, 'rgba(80,200,170,0.7)',
                0.6, 'rgba(150,220,100,0.75)',
                0.75, 'rgba(240,200,80,0.8)',
                0.9, 'rgba(250,140,60,0.85)',
                1, 'rgba(240,80,60,0.9)'
            ],
            // Smaller radius for denser data = smoother appearance
            'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                3, 8,
                5, 15,
                7, 25,
                9, 40,
                11, 60
            ],
            // Opacity fades as you zoom in to show details
            'heatmap-opacity': [
                'interpolate', ['linear'], ['zoom'],
                5, 0.95,
                7, 0.8,
                9, 0.5,
                11, 0.2
            ]
        }
    });
    
    // Circle layer - shows at medium-high zoom for detail
    map.addLayer({
        id: 'wind-circles',
        type: 'circle',
        source: 'wind-points',
        minzoom: 7,
        paint: {
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                7, 3,
                9, 5,
                11, 8
            ],
            'circle-color': [
                'interpolate', ['linear'], ['get', 'windSpeed'],
                0, '#93c5fd',
                3, '#60a5fa',
                5, '#34d399',
                8, '#fbbf24',
                11, '#f97316',
                15, '#ef4444'
            ],
            'circle-opacity': [
                'interpolate', ['linear'], ['zoom'],
                7, 0.4,
                9, 0.7,
                11, 0.9
            ],
            'circle-stroke-width': 0.5,
            'circle-stroke-color': 'rgba(255,255,255,0.6)',
            'circle-blur': 0.2
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
    
    // Update GeoJSON data
    const source = map.getSource('wind-points');
    if (source) {
        source.setData(getWindGeoJSON());
    }
    
    // Clear and redraw arrows at high zoom
    markers.forEach(m => m.remove());
    markers = [];
    
    if (zoom >= 6) {
        renderArrows(zoom);
    }
}

function renderArrows(zoom) {
    // Determine arrow density based on zoom - skip more at low zoom for dense data
    let skipFactor = 1;
    if (zoom < 8) skipFactor = 9;      // Show 1 in 9
    else if (zoom < 9) skipFactor = 4;  // Show 1 in 4
    else if (zoom < 10) skipFactor = 2; // Show 1 in 2
    
    windData.forEach((point, i) => {
        if (i % skipFactor !== 0) return;
        
        const forecast = point.forecasts[currentDay];
        if (!forecast) return;
        
        const { windSpeed, windDirection } = forecast;
        
        // Create arrow element
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
    if (speed < 3) return '#3b82f6';   // Blue - calm
    if (speed < 5) return '#22c55e';   // Green - light
    if (speed < 8) return '#eab308';   // Yellow - moderate
    if (speed < 11) return '#f97316';  // Orange - fresh
    return '#ef4444';                   // Red - strong
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

// Price predictions
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
        // Generate sample predictions
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
        
        // Simulate: low wind = high price
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
            <div class="price">€${Math.round(p.predictedPrice)}</div>
            <div class="wind-info">${p.avgWindSpeed?.toFixed(1) || '--'} m/s</div>
        </div>
    `).join('');
    
    // Update header price indicator
    const current = pricePredictions[currentDay];
    if (current) {
        const priceEl = document.getElementById('price-value');
        const indicatorEl = document.getElementById('price-indicator');
        
        if (priceEl) priceEl.textContent = Math.round(current.predictedPrice);
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
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    loadPricePredictions();
});
