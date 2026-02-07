/**
 * WindPowers - Real-Time Dashboard Frontend
 * Uses Socket.IO for live weather updates
 * Performance optimized with caching, lazy loading, and debouncing
 */

const CONFIG = {
    center: [18, 63],
    zoom: 4,
    bounds: { north: 71.5, south: 54, west: 4, east: 32 },
    gridResolution: 1.0,
    // Performance settings
    cacheDuration: 60 * 60 * 1000, // 1 hour in ms
    debounceDelay: 150, // ms for zoom/pan debounce
    viewportPadding: 0.1 // 10% padding for viewport culling
};

let windData = [];
let currentDay = 0;
let map = null;
let markers = [];
let arrowLayerAdded = false;
let heatmapVisible = true;
let socket = null;
let isConnected = false;
let lastUpdate = null;
let currentZoom = CONFIG.zoom;
let viewportBounds = null;

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle helper for high-frequency events
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============ CACHING SYSTEM ============

const CacheManager = {
    CACHE_KEY: 'windpowers_cache',
    
    save(key, data, ttlMs = CONFIG.cacheDuration) {
        try {
            const cacheEntry = {
                data,
                timestamp: Date.now(),
                ttl: ttlMs
            };
            const cache = JSON.parse(localStorage.getItem(this.CACHE_KEY) || '{}');
            cache[key] = cacheEntry;
            localStorage.setItem(this.CACHE_KEY, JSON.stringify(cache));
            console.log(`💾 Cached: ${key}`);
        } catch (e) {
            console.warn('Cache save failed:', e.message);
        }
    },
    
    load(key) {
        try {
            const cache = JSON.parse(localStorage.getItem(this.CACHE_KEY) || '{}');
            const entry = cache[key];
            if (!entry) return null;
            
            const isExpired = Date.now() - entry.timestamp > entry.ttl;
            if (isExpired) {
                delete cache[key];
                localStorage.setItem(this.CACHE_KEY, JSON.stringify(cache));
                return null;
            }
            
            console.log(`📦 Cache hit: ${key}`);
            return entry.data;
        } catch (e) {
            console.warn('Cache load failed:', e.message);
            return null;
        }
    },
    
    isFresh(key, maxAgeMs = CONFIG.cacheDuration) {
        try {
            const cache = JSON.parse(localStorage.getItem(this.CACHE_KEY) || '{}');
            const entry = cache[key];
            if (!entry) return false;
            
            const age = Date.now() - entry.timestamp;
            return age < maxAgeMs && age < entry.ttl;
        } catch (e) {
            return false;
        }
    },
    
    clear(key = null) {
        try {
            if (key) {
                const cache = JSON.parse(localStorage.getItem(this.CACHE_KEY) || '{}');
                delete cache[key];
                localStorage.setItem(this.CACHE_KEY, JSON.stringify(cache));
            } else {
                localStorage.removeItem(this.CACHE_KEY);
            }
        } catch (e) {
            console.warn('Cache clear failed:', e.message);
        }
    }
};

// ============ LAZY LOADING ============

const LazyLoader = {
    observers: new Map(),
    
    observe(element, callback, options = {}) {
        if (!element) return;
        
        const defaultOptions = {
            root: null,
            rootMargin: '100px',
            threshold: 0.1
        };
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    callback(entry.target);
                    // Only trigger once unless specified
                    if (!options.once) {
                        observer.unobserve(entry.target);
                    }
                }
            });
        }, { ...defaultOptions, ...options });
        
        observer.observe(element);
        this.observers.set(element, observer);
    },
    
    unobserve(element) {
        const observer = this.observers.get(element);
        if (observer) {
            observer.disconnect();
            this.observers.delete(element);
        }
    },
    
    disconnectAll() {
        this.observers.forEach(observer => observer.disconnect());
        this.observers.clear();
    }
};

// ============ VIEWPORT CULLING ============

function getViewportBounds() {
    if (!map || !map.loaded()) return null;
    
    const bounds = map.getBounds();
    const padding = CONFIG.viewportPadding;
    
    return {
        north: bounds.getNorth() + padding,
        south: bounds.getSouth() - padding,
        east: bounds.getEast() + padding,
        west: bounds.getWest() - padding
    };
}

function getVisiblePoints(points) {
    const bounds = viewportBounds || getViewportBounds();
    if (!bounds) return points; // Return all if no bounds yet
    
    return points.filter(point => 
        point.lat >= bounds.south && 
        point.lat <= bounds.north && 
        point.lon >= bounds.west && 
        point.lon <= bounds.east
    );
}

function getFilteredGeoJSON() {
    const zoom = map.getZoom();
    let points = windData;
    
    // Always filter by viewport for performance
    const visiblePoints = getVisiblePoints(points);
    
    // At low zoom, sample points to reduce rendering
    if (zoom < 5) {
        // Show every 4th point at zoom < 5
        points = visiblePoints.filter((_, i) => i % 4 === 0);
    } else if (zoom < 7) {
        // Show every 2nd point at zoom 5-7
        points = visiblePoints.filter((_, i) => i % 2 === 0);
    } else {
        points = visiblePoints;
    }
    
    return {
        type: 'FeatureCollection',
        features: points.map(point => {
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

const dayNames = ['Today', 'Tomorrow', '+2 days', '+3 days', '+4 days', '+5 days', '+6 days', '+7 days', '+8 days'];

// Dashboard metrics
let dashboardMetrics = {
    avgWindSpeed: 0,
    maxWindSpeed: 0,
    minTemperature: 0,
    maxTemperature: 0,
    alertCount: 0
};

// Debounced update functions
const debouncedUpdateVisualization = debounce(() => {
    const zoom = map.getZoom();
    currentZoom = zoom;
    viewportBounds = getViewportBounds();
    
    // Adjust heatmap properties based on zoom
    updateHeatmapDetail(zoom);
    
    const source = map.getSource('wind-points');
    if (source) {
        source.setData(getFilteredGeoJSON());
    }
}, CONFIG.debounceDelay);

const throttledFetchWindData = throttle(async (force = false) => {
    await fetchWindData(force);
}, 5000); // Max once per 5 seconds

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
            }],
            glyphs: 'https://cdn.jsdelivr.net/npm/@mapbox/mapbox-gl-style-spec@13.23.5/font/{fontstack}/{range}.pbf'
        },
        center: CONFIG.center,
        zoom: CONFIG.zoom
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    
    // Use debounced zoom handler
    map.on('zoom', debouncedUpdateVisualization);
    
    // Use debounced moveend to update viewport
    map.on('moveend', () => {
        viewportBounds = getViewportBounds();
        debouncedUpdateVisualization();
    });

    map.on('load', async () => {
        setupControls();
        showLoading(false);
        updateConnectionStatus();
        
        // Setup lazy loading for panels
        setupLazyPanels();
        
        // Load cached data first, then fetch fresh
        await fetchWindData(false);
        
        addWindSources();
        updateVisualization();
        updateDashboardMetrics();
        
        // Load turbine data
        await fetchTurbineData();
        addTurbineSources();
        updateTurbineVisualization();
    });
}

function setupLazyPanels() {
    // Lazy load panels when they come into view
    const panels = document.querySelectorAll('.dashboard-panel, .alerts-panel, .price-panel');
    
    panels.forEach(panel => {
        LazyLoader.observe(panel, (el) => {
            el.classList.add('loaded');
            console.log(`📊 Panel loaded: ${el.className}`);
        }, { once: true });
    });
}

function initSocket() {
    // Use polling for Vercel/serverless (WebSockets not supported)
    // Falls back to HTTP polling every 30 seconds
    console.log('📡 Using polling mode for live updates');
    isConnected = true;
    updateConnectionStatus();
    
    // Fetch initial data (will use cache if available)
    fetchWindData();
    
    // Poll for updates every 30 seconds (throttled)
    setInterval(() => throttledFetchWindData(true), 30000);
}

async function fetchWindData(forceRefresh = false) {
    try {
        // Check cache first unless force refresh
        if (!forceRefresh && CacheManager.isFresh('windData', CONFIG.cacheDuration)) {
            const cached = CacheManager.load('windData');
            if (cached) {
                windData = cached;
                lastUpdate = cached._timestamp || lastUpdate;
                
                if (map && map.loaded()) {
                    addWindSources();
                    updateVisualization();
                    updateDashboardMetrics();
                    updateLastUpdateTime();
                    showUpdateIndicator();
                    console.log(`📦 Using cached data: ${windData.length} wind points`);
                }
                return;
            }
        }
        
        const response = await fetch('/data/wind-data.json');
        if (response.ok) {
            const data = await response.json();
            const newData = data.data || data;
            
            // Check if data changed
            if (JSON.stringify(newData) !== JSON.stringify(windData)) {
                windData = newData;
                lastUpdate = new Date().toISOString();
                
                // Add timestamp for caching
                windData._timestamp = lastUpdate;
                
                // Cache the data
                CacheManager.save('windData', windData);
                
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
        
        // Try to load from cache on error
        if (!forceRefresh) {
            const cached = CacheManager.load('windData');
            if (cached) {
                windData = cached;
                if (map && map.loaded()) {
                    updateVisualization();
                    updateDashboardMetrics();
                    console.log(`📦 Fallback to cache: ${windData.length} wind points`);
                }
            }
        }
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
    
    // Subtle heatmap layer - gentle overlay
    map.addLayer({
        id: 'wind-heat',
        type: 'heatmap',
        source: 'wind-points',
        maxzoom: 10,
        paint: {
            // Lower weight for subtle appearance
            'heatmap-weight': [
                'interpolate', ['linear'], ['get', 'windSpeed'],
                0, 0.2, 5, 0.4, 10, 0.6, 15, 0.8
            ],
            // Gentle intensity
            'heatmap-intensity': [
                'interpolate', ['linear'], ['zoom'],
                1, 0.8, 4, 1, 7, 1, 10, 1
            ],
            // Soft colors: light blue → teal → subtle amber
            'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(200, 220, 255, 0.25)',
                0.1, 'rgba(160, 200, 230, 0.35)',
                0.3, 'rgba(120, 180, 200, 0.45)',
                0.5, 'rgba(80, 160, 160, 0.5)',
                0.75, 'rgba(200, 180, 100, 0.55)',
                1, 'rgba(220, 150, 80, 0.6)'
            ],
            // Larger radius for smooth coverage
            'heatmap-radius': [
                'interpolate', ['linear'], ['zoom'],
                1, 30, 4, 50, 7, 70, 10, 90
            ],
            // Lower opacity for subtle overlay (40%)
            'heatmap-opacity': [
                'interpolate', ['linear'], ['zoom'],
                1, 0.4, 4, 0.4, 7, 0.5, 10, 0.4
            ]
        }
    });
    
    // Circle layer - only shows at zoom 7+ for detail
    map.addLayer({
        id: 'wind-circles',
        type: 'circle',
        source: 'wind-points',
        minzoom: 7,
        paint: {
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                7, 4, 9, 6, 12, 10
            ],
            'circle-color': [
                'interpolate', ['linear'], ['get', 'windSpeed'],
                0, '#b8d4e8', 3, '#93c5fd', 5, '#86efac',
                8, '#fde047', 11, '#fbbf24', 15, '#f97316'
            ],
            'circle-opacity': [
                'interpolate', ['linear'], ['zoom'],
                7, 0.5, 9, 0.7, 12, 0.85
            ],
            'circle-stroke-width': 0.5,
            'circle-stroke-color': 'rgba(255,255,255,0.5)',
            'circle-blur': 0.2
        }
    });
    
    // Load arrow icon and add symbol layer for wind direction arrows
    // This is much faster than DOM markers
    loadArrowIcon();
}

function getWindGeoJSON() {
    const zoom = map.getZoom();
    let points = windData;
    
    // At low zoom, sample points to reduce rendering
    if (zoom < 5) {
        // Show every 4th point at zoom < 5
        points = windData.filter((_, i) => i % 4 === 0);
    } else if (zoom < 7) {
        // Show every 2nd point at zoom 5-7
        points = windData.filter((_, i) => i % 2 === 0);
    }
    
    return {
        type: 'FeatureCollection',
        features: points.map(point => {
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

function updateHeatmapDetail(zoom) {
    // Adjust heatmap radius based on zoom for better performance
    const heatmapLayer = map.getLayer('wind-heat');
    if (heatmapLayer) {
        if (zoom < 5) {
            // Reduce detail at low zoom
            map.setPaintProperty('wind-heat', 'heatmap-radius', [
                'interpolate', ['linear'], ['zoom'],
                1, 60, 4, 80, 7, 100
            ]);
            map.setPaintProperty('wind-heat', 'heatmap-weight', [
                'interpolate', ['linear'], ['get', 'windSpeed'],
                0, 0.3, 5, 0.5, 10, 0.7, 15, 0.9
            ]);
        } else {
            // Full detail at higher zoom
            map.setPaintProperty('wind-heat', 'heatmap-radius', [
                'interpolate', ['linear'], ['zoom'],
                1, 30, 4, 50, 7, 70, 10, 90
            ]);
            map.setPaintProperty('wind-heat', 'heatmap-weight', [
                'interpolate', ['linear'], ['get', 'windSpeed'],
                0, 0.2, 5, 0.4, 10, 0.6, 15, 0.8
            ]);
        }
    }
}

function updateVisualization() {
    const zoom = map.getZoom();
    currentZoom = zoom;
    viewportBounds = getViewportBounds();
    
    // Update heatmap detail based on zoom
    updateHeatmapDetail(zoom);
    
    const source = map.getSource('wind-points');
    
    if (source) {
        // Use filtered GeoJSON for better performance
        source.setData(getFilteredGeoJSON());
    }
    
    // Remove old DOM markers if any remain
    markers.forEach(m => m.remove());
    markers = [];
    
    // Arrow layer visibility is now controlled by minzoom/maxzoom in loadArrowIcon
    // No need for manual show/hide based on zoom
}

function loadArrowIcon() {
    // Load the arrow image for the symbol layer
    map.loadImage('arrow.png', (error, image) => {
        if (error) {
            console.error('Failed to load arrow icon:', error);
            return;
        }
        
        // Add the image to the map
        map.addImage('wind-arrow', image);
        
        // Add the symbol layer for arrows
        // Much faster than DOM markers - renders as WebGL
        map.addLayer({
            id: 'wind-arrows',
            type: 'symbol',
            source: 'wind-points',
            minzoom: 4,
            maxzoom: 15,
            layout: {
                'icon-image': 'wind-arrow',
                'icon-size': [
                    'interpolate', ['linear'], ['zoom'],
                    4, 0.4,
                    6, 0.5,
                    8, 0.6,
                    10, 0.7,
                    12, 0.8
                ],
                'icon-rotate': ['get', 'windDirection'],
                'icon-rotation-alignment': 'map',
                'icon-allow-overlap': false,
                'icon-ignore-placement': false,
                'icon-optional': false,
                'visibility': 'visible'
            },
            paint: {
                'icon-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    4, 0.7, 7, 0.8, 10, 0.9, 12, 0.95
                ],
                'icon-color': [
                    'interpolate', ['linear'], ['get', 'windSpeed'],
                    0, '#3b82f6',
                    3, '#22c55e',
                    8, '#eab308',
                    11, '#f97316',
                    15, '#ef4444'
                ]
            }
        });
        
        arrowLayerAdded = true;
        
        // Add click handler for arrows
        map.on('click', 'wind-arrows', (e) => {
            const coordinates = e.features[0].geometry.coordinates.slice();
            
            // Find the original point data
            const point = windData.find(p => p.lon === coordinates[0] && p.lat === coordinates[1]);
            if (point) {
                showInfoPanel(point);
            }
        });
        
        // Change cursor on hover
        map.on('mouseenter', 'wind-arrows', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'wind-arrows', () => {
            map.getCanvas().style.cursor = '';
        });
    });
}

function renderArrows(zoom) {
    // This function is no longer needed - arrows are now rendered as a symbol layer
    // Kept for backwards compatibility but does nothing
    console.log('renderArrows() is deprecated - using symbol layer instead');
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

// ============ TURBINE FUNCTIONS ============

let turbineData = [];

async function fetchTurbineData() {
    try {
        // Check cache first
        const cached = CacheManager.load('turbineData');
        if (cached) {
            turbineData = cached;
            console.log(`🌀 Using cached turbine data: ${turbineData.length} locations`);
            return;
        }
        
        const response = await fetch('/data/turbines-finland.json');
        if (response.ok) {
            const data = await response.json();
            turbineData = data.turbines || [];
            // Cache turbine data
            CacheManager.save('turbineData', turbineData, CONFIG.cacheDuration);
            console.log(`🌀 Loaded ${turbineData.length} wind farm locations`);
        }
    } catch (e) {
        console.log('No turbine data available');
        turbineData = [];
    }
}

function getTurbineGeoJSON() {
    const zoom = map.getZoom();
    let turbines = turbineData;
    
    // At low zoom, reduce turbine detail
    if (zoom < 5) {
        turbines = turbineData.filter((_, i) => i % 2 === 0);
    }
    
    return {
        type: 'FeatureCollection',
        features: turbines.map(turbine => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [turbine.lon, turbine.lat]
            },
            properties: {
                name: turbine.name,
                count: turbine.count,
                type: turbine.type
            }
        }))
    };
}

function addTurbineSources() {
    // Add geojson source for turbines
    map.addSource('turbines', {
        type: 'geojson',
        data: getTurbineGeoJSON()
    });
    
    // Outer glow layer
    map.addLayer({
        id: 'turbine-glow',
        type: 'circle',
        source: 'turbines',
        paint: {
            'circle-color': [
                'interpolate', ['linear'], ['get', 'count'],
                5, '#fde047',
                15, '#fbbf24',
                30, '#f97316',
                50, '#ef4444'
            ],
            'circle-radius': [
                'interpolate', ['linear'], ['get', 'count'],
                5, 20,
                15, 26,
                30, 34,
                50, 44
            ],
            'circle-opacity': 0.3
        }
    });
    
    // Main circle
    map.addLayer({
        id: 'turbine-points',
        type: 'circle',
        source: 'turbines',
        paint: {
            'circle-color': [
                'interpolate', ['linear'], ['get', 'count'],
                5, '#fde047',
                15, '#fbbf24',
                30, '#f97316',
                50, '#ef4444'
            ],
            'circle-radius': [
                'interpolate', ['linear'], ['get', 'count'],
                5, 14,
                15, 20,
                30, 26,
                50, 34
            ],
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff'
        }
    });
    
    // Inner white circle for count background
    map.addLayer({
        id: 'turbine-count-bg',
        type: 'circle',
        source: 'turbines',
        paint: {
            'circle-color': '#ffffff',
            'circle-radius': [
                'interpolate', ['linear'], ['get', 'count'],
                5, 8,
                15, 10,
                30, 14,
                50, 18
            ]
        }
    });
    
    // Wind farm name labels
    map.addLayer({
        id: 'turbine-names',
        type: 'symbol',
        source: 'turbines',
        layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Arial Bold'],
            'text-size': 12,
            'text-offset': [0, 2],
            'text-anchor': 'top'
        },
        paint: {
            'text-color': '#1e293b',
            'text-halo-color': 'rgba(255,255,255,0.9)',
            'text-halo-width': 3
        }
    });
    
    // Count number labels
    map.addLayer({
        id: 'turbine-count-labels',
        type: 'symbol',
        source: 'turbines',
        layout: {
            'text-field': ['to-string', ['get', 'count']],
            'text-font': ['Arial Bold'],
            'text-size': 14
        },
        paint: {
            'text-color': '#1e293b'
        }
    });
}

function getTurbineGeoJSON() {
    return {
        type: 'FeatureCollection',
        features: turbineData.map(turbine => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [turbine.lon, turbine.lat]
            },
            properties: {
                name: turbine.name,
                count: turbine.count,
                type: turbine.type
            }
        }))
    };
}

function updateTurbineVisualization() {
    const source = map.getSource('turbines');
    if (source) {
        source.setData(getTurbineGeoJSON());
    }
}

// Toggle panels on mobile
let panelsVisible = true;

function initTogglePanels() {
    const toggleBtn = document.getElementById('toggle-panels');
    const panels = document.getElementById('panels-container') || document.querySelector('.dashboard-layout');
    
    if (toggleBtn && panels) {
        toggleBtn.addEventListener('click', () => {
            panelsVisible = !panelsVisible;
            panels.classList.toggle('collapsed', !panelsVisible);
            toggleBtn.classList.toggle('hidden', !panelsVisible);
            
            // Update icon
            const icon = toggleBtn.querySelector('#toggle-icon');
            if (icon) {
                icon.textContent = panelsVisible ? '📊' : '🗺️';
            }
        });
    }
}

// Initialize on DOM load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTogglePanels);
} else {
    initTogglePanels();
}
