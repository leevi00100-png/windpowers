/**
 * WindPowers - Wind Data Fetcher
 * Fetches weather data from yr.no (MET Norway) API
 * 
 * API Docs: https://api.met.no/weatherapi/locationforecast/2.0/documentation
 * 
 * Usage: node scripts/fetch-wind-data.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    // Nordic region bounds
    bounds: {
        north: 71.5,   // Northern Norway
        south: 54,     // Southern Denmark
        west: 4,       // Western Norway
        east: 32       // Eastern Finland
    },
    gridResolution: 1.5,  // Degrees between points (1.5 = ~500 points)
    outputFile: path.join(__dirname, '../public/data/wind-data.json'),
    // yr.no requires a User-Agent
    userAgent: 'WindPowers/1.0 (https://github.com/leevi00100-png/windpowers)'
};

// Rate limiting
const DELAY_BETWEEN_REQUESTS = 500; // ms
const MAX_RETRIES = 3;

// Generate grid points
function generateGridPoints() {
    const points = [];
    const { north, south, west, east } = CONFIG.bounds;
    
    for (let lat = south; lat <= north; lat += CONFIG.gridResolution) {
        for (let lon = west; lon <= east; lon += CONFIG.gridResolution) {
            points.push({
                lat: Math.round(lat * 100) / 100,
                lon: Math.round(lon * 100) / 100
            });
        }
    }
    
    console.log(`Generated ${points.length} grid points`);
    return points;
}

// Fetch weather data from yr.no
function fetchWeatherData(lat, lon) {
    return new Promise((resolve, reject) => {
        const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;
        
        const options = {
            headers: {
                'User-Agent': CONFIG.userAgent
            }
        };
        
        https.get(url, options, (res) => {
            if (res.statusCode === 203) {
                // Deprecated endpoint warning, but still works
                console.warn('Warning: API endpoint may be deprecated');
            }
            
            if (res.statusCode !== 200 && res.statusCode !== 203) {
                reject(new Error(`HTTP ${res.statusCode} for ${lat},${lon}`));
                return;
            }
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Invalid JSON for ${lat},${lon}`));
                }
            });
        }).on('error', reject);
    });
}

// Parse yr.no response to extract wind data for 9 days
function parseWeatherResponse(data) {
    const forecasts = [];
    const timeseries = data.properties?.timeseries || [];
    
    // Get data for the next 9 days (at 12:00 each day)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    for (let day = 0; day < 9; day++) {
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() + day);
        targetDate.setHours(12, 0, 0, 0);
        
        // Find closest timeseries entry
        let closest = null;
        let minDiff = Infinity;
        
        for (const entry of timeseries) {
            const entryDate = new Date(entry.time);
            const diff = Math.abs(entryDate - targetDate);
            
            if (diff < minDiff) {
                minDiff = diff;
                closest = entry;
            }
        }
        
        if (closest) {
            const instant = closest.data?.instant?.details || {};
            forecasts.push({
                day,
                windSpeed: instant.wind_speed || 0,
                windDirection: instant.wind_from_direction || 0,
                temperature: instant.air_temperature || 0,
                humidity: instant.relative_humidity || 50
            });
        }
    }
    
    return forecasts;
}

// Delay helper
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main fetch function
async function fetchAllData() {
    const points = generateGridPoints();
    const results = [];
    let success = 0;
    let failed = 0;
    
    console.log(`Starting to fetch data for ${points.length} points...`);
    console.log(`Estimated time: ${Math.round(points.length * DELAY_BETWEEN_REQUESTS / 60000)} minutes`);
    
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        
        // Progress update every 10 points
        if (i % 10 === 0) {
            console.log(`Progress: ${i}/${points.length} (${Math.round(i/points.length*100)}%)`);
        }
        
        let retries = 0;
        while (retries < MAX_RETRIES) {
            try {
                const data = await fetchWeatherData(point.lat, point.lon);
                const forecasts = parseWeatherResponse(data);
                
                if (forecasts.length > 0) {
                    results.push({
                        lat: point.lat,
                        lon: point.lon,
                        forecasts
                    });
                    success++;
                }
                break;
            } catch (error) {
                retries++;
                if (retries >= MAX_RETRIES) {
                    console.error(`Failed to fetch ${point.lat},${point.lon}: ${error.message}`);
                    failed++;
                } else {
                    await delay(1000 * retries); // Exponential backoff
                }
            }
        }
        
        // Rate limiting
        await delay(DELAY_BETWEEN_REQUESTS);
    }
    
    console.log(`\nCompleted: ${success} success, ${failed} failed`);
    return results;
}

// Save data to file
function saveData(data) {
    const dir = path.dirname(CONFIG.outputFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    const output = {
        generated: new Date().toISOString(),
        pointCount: data.length,
        data
    };
    
    fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));
    console.log(`Saved ${data.length} points to ${CONFIG.outputFile}`);
}

// Run
async function main() {
    console.log('WindPowers Data Fetcher');
    console.log('=======================\n');
    
    const startTime = Date.now();
    const data = await fetchAllData();
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    console.log(`\nTotal time: ${Math.floor(duration/60)}m ${duration%60}s`);
    
    saveData(data);
}

main().catch(console.error);
