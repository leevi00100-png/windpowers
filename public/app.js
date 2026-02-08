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

// ============ REVERSE GEOCODING ============

// Major Nordic cities lookup with approximate coordinates
const NORDIC_CITIES = [
    { name: 'Helsinki', lat: 60.1699, lon: 24.9384, country: 'Finland' },
    { name: 'Stockholm', lat: 59.3293, lon: 18.0686, country: 'Sweden' },
    { name: 'Oslo', lat: 59.9139, lon: 10.7522, country: 'Norway' },
    { name: 'Copenhagen', lat: 55.6761, lon: 12.5683, country: 'Denmark' },
    { name: 'Reykjavik', lat: 64.1466, lon: -21.9426, country: 'Iceland' },
    { name: 'Turku', lat: 60.4518, lon: 22.2666, country: 'Finland' },
    { name: 'Tampere', lat: 61.4991, lon: 23.7871, country: 'Finland' },
    { name: 'Oulu', lat: 65.0121, lon: 25.4650, country: 'Finland' },
    { name: 'Gothenburg', lat: 57.7089, lon: 11.9746, country: 'Sweden' },
    { name: 'Malmö', lat: 55.6050, lon: 13.0038, country: 'Sweden' },
    { name: 'Uppsala', lat: 59.8582, lon: 17.6383, country: 'Sweden' },
    { name: 'Bergen', lat: 60.3913, lon: 5.3221, country: 'Norway' },
    { name: 'Trondheim', lat: 63.4349, lon: 10.3954, country: 'Norway' },
    { name: 'Aarhus', lat: 56.1629, lon: 10.2039, country: 'Denmark' },
    { name: 'Odense', lat: 55.4038, lon: 10.4024, country: 'Denmark' },
    { name: 'Tromsø', lat: 69.6496, lon: 18.9559, country: 'Norway' },
    { name: 'Kuopio', lat: 63.0225, lon: 27.8013, country: 'Finland' },
    { name: 'Jyväskylä', lat: 62.2415, lon: 25.7583, country: 'Finland' },
    { name: 'Vaasa', lat: 63.0964, lon: 21.6158, country: 'Finland' },
    { name: 'Pori', lat: 61.4833, lon: 21.7833, country: 'Finland' },
    { name: 'Luleå', lat: 65.5848, lon: 22.1567, country: 'Sweden' },
    { name: 'Umeå', lat: 63.8257, lon: 20.2632, country: 'Sweden' },
    { name: 'Bodø', lat: 67.2840, lon: 14.3858, country: 'Norway' },
    { name: 'Rovaniemi', lat: 66.5039, lon: 25.7294, country: 'Finland' },
    { name: 'Hämeenlinna', lat: 61.0046, lon: 24.4513, country: 'Finland' },
    { name: 'Lahti', lat: 60.9827, lon: 25.6615, country: 'Finland' },
    { name: 'Joensuu', lat: 62.6010, lon: 29.7636, country: 'Finland' },
    { name: 'Kouvola', lat: 60.8674, lon: 26.7041, country: 'Finland' },
    { name: 'Kokkola', lat: 63.8385, lon: 23.1305, country: 'Finland' },
    { name: 'Mikkeli', lat: 61.6886, lon: 27.2721, country: 'Finland' },
    { name: 'Kemi', lat: 65.7358, lon: 24.5614, country: 'Finland' },
    { name: 'Kristiansand', lat: 58.1586, lon: 8.0065, country: 'Norway' },
    { name: 'Drammen', lat: 59.7446, lon: 10.2040, country: 'Norway' },
    { name: 'Fredrikstad', lat: 59.2842, lon: 10.9030, country: 'Norway' },
    { name: 'Skien', lat: 59.2078, lon: 9.5526, country: 'Norway' },
    { name: 'Täby', lat: 59.4449, lon: 18.0689, country: 'Sweden' },
    { name: 'Västerås', lat: 59.6162, lon: 16.5528, country: 'Sweden' },
    { name: 'Örebro', lat: 59.2746, lon: 15.2066, country: 'Sweden' },
    { name: 'Linköping', lat: 58.4108, lon: 15.6214, country: 'Sweden' },
    { name: 'Helsingborg', lat: 56.0467, lon: 12.6944, country: 'Sweden' },
    { name: 'Jönköping', lat: 57.3395, lon: 14.1786, country: 'Sweden' },
    { name: 'Aalborg', lat: 57.0480, lon: 9.9187, country: 'Denmark' },
    { name: 'Esbjerg', lat: 55.4766, lon: 8.4604, country: 'Denmark' }
];

// Cache for reverse geocoding results
const geocodeCache = new Map();

// Calculate distance between two points using Haversine formula
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Find the nearest city from the lookup table
function findNearestCity(lat, lon) {
    let nearest = null;
    let minDistance = Infinity;

    for (const city of NORDIC_CITIES) {
        const distance = haversineDistance(lat, lon, city.lat, city.lon);
        if (distance < minDistance) {
            minDistance = distance;
            nearest = city;
        }
    }

    // Only return city if within 100km, otherwise return null (use region fallback)
    return minDistance <= 100 ? nearest : null;
}

// Get regional description for areas far from major cities
function getRegionalDescription(lat, lon) {
    // Nordic region detection based on coordinates
    if (lat >= 66) return 'Northern Finland';
    if (lat >= 63 && lon >= 25) return 'Northern Finland';
    if (lat >= 63 && lon < 25) return 'Central Finland';
    if (lat >= 60) {
        if (lon < 20) return 'Western Finland';
        if (lon < 25) return 'Southern Finland';
        return 'Eastern Finland';
    }
    if (lat >= 59 && lon < 18) return 'Gulf of Bothnia';
    if (lat >= 55) {
        if (lon < 12) return 'Western Sweden';
        if (lon < 18) return 'Eastern Sweden';
        return 'Baltic Sea';
    }
    if (lat >= 57) {
        if (lon < 10) return 'Southern Norway';
        if (lon < 14) return 'Southern Sweden';
        return 'Denmark';
    }
    if (lon < 5) return 'North Sea';
    if (lon < 10) return 'Norwegian Coast';
    return 'Nordic Region';
}

// Reverse geocode using Nominatim API (async)
async function reverseGeocode(lat, lon) {
    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    
    // Check cache first
    if (geocodeCache.has(cacheKey)) {
        return geocodeCache.get(cacheKey);
    }

    // Nominatim requires a proper Referer - use API's demo service
    // Fall back to regional description if it fails (CORS often blocked on localhost)
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=en`,
            {
                headers: {
                    'User-Agent': 'WindPowers-Dashboard/1.0',
                    'Referer': 'https://windpowers.app/'
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            const result = data.display_name || null;
            geocodeCache.set(cacheKey, result);
            return result;
        }
    } catch (e) {
        // Silent fail - regional fallback will be used
    }

    return null;
}

// Get location name - first try city lookup, then regional fallback
async function getLocationName(lat, lon) {
    // Try to find nearest major city from lookup
    const nearestCity = findNearestCity(lat, lon);
    
    if (nearestCity) {
        return nearestCity.name;
    }

    // Try Nominatim API as fallback (async)
    try {
        const nominatimResult = await reverseGeocode(lat, lon);
        if (nominatimResult) {
            // Extract city/town name from full address
            const parts = nominatimResult.split(', ');
            if (parts.length >= 2) {
                return parts[0]; // Return the first part (city/town name)
            }
            return nominatimResult;
        }
    } catch (e) {
        // Continue to regional fallback
    }

    // Fallback to regional description
    return getRegionalDescription(lat, lon);
}

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
        
        // Note: addWindSources() is called inside fetchWindData() when cache hits
        updateVisualization();
        await updateDashboardMetrics();
        
        // Load turbine data
        await fetchTurbineData();
        addTurbineSources();
        updateTurbineVisualization();
    });
}

function setupLazyPanels() {
    // Lazy load panels when they come into view
    const panels = document.querySelectorAll('.dashboard-panel, .alerts-panel, .price-panel, .legend-panel');
    
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
                    await updateDashboardMetrics();
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
                    await updateDashboardMetrics();
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
                    await updateDashboardMetrics();
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

async function updateDashboardMetrics() {
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
    
    // Update alerts panel (async)
    await updateAlertsPanel();
}

async function updateAlertsPanel() {
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
            // Get location names for each alert
            const alertsWithNames = await Promise.all(
                alerts.map(async (a) => {
                    const locationName = await getLocationName(a.lat, a.lon);
                    return { ...a, locationName };
                })
            );
            
            container.innerHTML = alertsWithNames.map(a => `
                <div class="alert-item">
                    <span class="alert-coords">${a.locationName}</span>
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
    // Remove existing source if it exists (prevents "Source already exists" errors)
    if (map.getSource('wind-points')) {
        map.removeSource('wind-points');
    }
    
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
    
    slider.addEventListener('input', async (e) => {
        currentDay = parseInt(e.target.value);
        label.textContent = dayNames[currentDay];
        updateVisualization();
        await updateDashboardMetrics();
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

async function setDay(day) {
    currentDay = day;
    document.getElementById('day-slider').value = day;
    document.getElementById('day-label').textContent = dayNames[day];
    updateVisualization();
    renderPriceForecast();
    await updateDashboardMetrics();
    
    // Notify server
    if (socket) {
        socket.emit('changeDay', day);
    }
}

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

function updateTurbineVisualization() {
    const source = map.getSource('turbines');
    if (source) {
        source.setData(getTurbineGeoJSON());
    }
}

// Toggle panels on mobile
let panelsVisible = false; // Hidden by default on mobile

function initTogglePanels() {
    const toggleBtn = document.getElementById('toggle-panels');
    const panels = document.querySelector('.dashboard-layout');
    const mapEl = document.getElementById('map');
    
    if (!toggleBtn || !panels) return;
    
    // On mobile, panels start hidden
    if (window.innerWidth <= 768) {
        panels.classList.remove('visible');
        panelsVisible = false;
        toggleBtn.style.display = 'flex';
        const icon = toggleBtn.querySelector('#toggle-icon');
        if (icon) icon.textContent = '📊';
    }
    
    // Toggle button click handler
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePanels();
    });
    
    // Add touch feedback
    toggleBtn.addEventListener('touchstart', () => {
        toggleBtn.style.transform = 'scale(0.95)';
    });
    toggleBtn.addEventListener('touchend', () => {
        toggleBtn.style.transform = '';
    });
}

function togglePanels() {
    const toggleBtn = document.getElementById('toggle-panels');
    const panels = document.querySelector('.dashboard-layout');
    const mapEl = document.getElementById('map');
    
    if (!toggleBtn || !panels) return;
    
    panelsVisible = !panelsVisible;
    panels.classList.toggle('visible', panelsVisible);
    toggleBtn.classList.toggle('hidden', !panelsVisible);
    
    // Update icon
    const icon = toggleBtn.querySelector('#toggle-icon');
    if (icon) {
        icon.textContent = panelsVisible ? '🗺️' : '📊';
    }
    
    // Toggle map z-index so map becomes interactive when panels are hidden
    if (mapEl) {
        mapEl.style.zIndex = panelsVisible ? '0' : '50';
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    init();
    loadPricePredictions();
    initTogglePanels();
});
