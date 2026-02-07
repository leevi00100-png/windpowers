/**
 * WindPowers - Nordpool Electricity Price Fetcher
 * 
 * Nordpool API for day-ahead prices
 * Registration required: https://www.nordpoolgroup.com/
 * 
 * Finland = FI zone
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    // Nordpool API endpoint (public data available without auth)
    apiUrl: 'https://www.nordpoolgroup.com/api/marketdata/page/10',
    outputFile: path.join(__dirname, '../public/data/nordpool-prices.json'),
    areas: ['FI', 'SE1', 'SE2', 'SE3', 'SE4', 'NO1', 'NO2', 'NO3', 'NO4', 'NO5', 'DK1', 'DK2']
};

// Fetch data from Nordpool
function fetchNordpoolData() {
    return new Promise((resolve, reject) => {
        const today = new Date();
        const endDate = today.toISOString().split('T')[0];
        const startDate = new Date(today - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        const url = `${CONFIG.apiUrl}?currency=EUR&endDate=${endDate}&startDate=${startDate}`;
        
        https.get(url, {
            headers: {
                'User-Agent': 'WindPowers/1.0',
                'Accept': 'application/json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    // Nordpool might require authentication or different endpoint
                    console.log('Note: Nordpool public API may have limitations');
                    resolve(null);
                }
            });
        }).on('error', reject);
    });
}

// Alternative: Use ENTSO-E Transparency Platform (free with registration)
// https://transparency.entsoe.eu/
async function fetchEntsoeData(apiKey) {
    // ENTSO-E provides free electricity data for Europe
    // Register at: https://transparency.entsoe.eu/
    console.log('ENTSO-E integration: API key required');
    console.log('Register at: https://transparency.entsoe.eu/');
    return null;
}

// Generate sample price data for development
function generateSamplePrices() {
    const prices = [];
    const now = new Date();
    
    // Generate 30 days of historical + today
    for (let day = -30; day <= 0; day++) {
        const date = new Date(now);
        date.setDate(date.getDate() + day);
        
        // Generate hourly prices
        const hourlyPrices = [];
        for (let hour = 0; hour < 24; hour++) {
            // Simulate price patterns
            // Higher in morning (7-9) and evening (17-20)
            // Lower at night
            // Higher in winter, lower in summer
            const month = date.getMonth();
            const isWinter = month >= 10 || month <= 2;
            
            let basePrice = isWinter ? 80 : 40; // EUR/MWh
            
            // Time of day effect
            if (hour >= 7 && hour <= 9) basePrice *= 1.5;
            else if (hour >= 17 && hour <= 20) basePrice *= 1.8;
            else if (hour >= 0 && hour <= 5) basePrice *= 0.5;
            
            // Add randomness
            const price = Math.max(0, basePrice + (Math.random() - 0.5) * 40);
            
            hourlyPrices.push({
                hour,
                price: Math.round(price * 100) / 100
            });
        }
        
        prices.push({
            date: date.toISOString().split('T')[0],
            area: 'FI',
            hourlyPrices,
            avgPrice: hourlyPrices.reduce((sum, h) => sum + h.price, 0) / 24,
            maxPrice: Math.max(...hourlyPrices.map(h => h.price)),
            minPrice: Math.min(...hourlyPrices.map(h => h.price))
        });
    }
    
    return prices;
}

async function main() {
    console.log('Nordpool Price Fetcher');
    console.log('======================\n');
    
    // Try fetching real data
    console.log('Attempting to fetch Nordpool data...');
    let data = await fetchNordpoolData();
    
    if (!data) {
        console.log('Using sample data for development');
        data = generateSamplePrices();
    }
    
    // Save data
    const output = {
        generated: new Date().toISOString(),
        source: data.length ? 'sample' : 'nordpool',
        data
    };
    
    const dir = path.dirname(CONFIG.outputFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));
    console.log(`\nSaved to ${CONFIG.outputFile}`);
    console.log(`Records: ${data.length} days`);
}

main().catch(console.error);
