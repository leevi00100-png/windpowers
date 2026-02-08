/**
 * WindPowers - Electricity Price Prediction Model
 * 
 * Predicts electricity prices based on:
 * - Wind speed (low wind = high prices, especially in winter)
 * - Temperature (cold = high demand = high prices)
 * - Time of day and day of week
 * - Historical patterns
 * 
 * Model: Multiple Linear Regression (simple but effective)
 * Can be upgraded to XGBoost or Neural Network later
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
    windDataFile: path.join(__dirname, '../public/data/wind-data.json'),
    priceDataFile: path.join(__dirname, '../public/data/nordpool-prices.json'),
    modelFile: path.join(__dirname, '../public/data/prediction-model.json'),
    predictionFile: path.join(__dirname, '../public/data/price-predictions.json')
};

// Simple Linear Regression implementation
class LinearRegression {
    constructor() {
        this.weights = null;
        this.bias = 0;
        this.featureNames = [];
    }
    
    // Fit the model to training data
    fit(X, y) {
        const n = X.length;
        const numFeatures = X[0].length;
        
        // Initialize weights
        this.weights = new Array(numFeatures).fill(0);
        
        // Gradient descent
        const learningRate = 0.01;
        const iterations = 1000;
        
        for (let iter = 0; iter < iterations; iter++) {
            const predictions = X.map(x => this.predict(x));
            
            // Calculate gradients
            const errors = predictions.map((p, i) => p - y[i]);
            
            // Update weights
            for (let j = 0; j < numFeatures; j++) {
                const gradient = errors.reduce((sum, e, i) => sum + e * X[i][j], 0) / n;
                this.weights[j] -= learningRate * gradient;
            }
            
            // Update bias
            const biasGradient = errors.reduce((sum, e) => sum + e, 0) / n;
            this.bias -= learningRate * biasGradient;
        }
        
        return this;
    }
    
    // Predict single sample
    predict(x) {
        if (!this.weights) return 0;
        return x.reduce((sum, val, i) => sum + val * this.weights[i], this.bias);
    }
    
    // Get model coefficients for interpretation
    getCoefficients() {
        return {
            weights: this.weights,
            bias: this.bias,
            featureNames: this.featureNames
        };
    }
    
    // Save model to JSON
    save(filepath) {
        fs.writeFileSync(filepath, JSON.stringify(this.getCoefficients(), null, 2));
    }
    
    // Load model from JSON
    load(filepath) {
        const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        this.weights = data.weights;
        this.bias = data.bias;
        this.featureNames = data.featureNames;
        return this;
    }
}

// Feature extraction. dayIndexInPriceData = 0..N; for 0..8 we use wind forecast for that day;
// for older dates we use synthetic values (no historical weather API).
function extractFeatures(windData, priceData, targetDate, dayIndexInPriceData) {
    const finlandPoints = (windData && Array.isArray(windData)) ? windData.filter(p => p.lat >= 60 && p.lat <= 70 && p.lon >= 20 && p.lon <= 32) : [];
    const hasForecastForDay = dayIndexInPriceData >= 0 && dayIndexInPriceData < 9 && finlandPoints.length > 0;

    let avgWindSpeed, avgTemperature;
    if (hasForecastForDay) {
        avgWindSpeed = finlandPoints.reduce((sum, p) => sum + (p.forecasts[dayIndexInPriceData]?.windSpeed || 0), 0) / (finlandPoints.length || 1);
        avgTemperature = finlandPoints.reduce((sum, p) => sum + (p.forecasts[dayIndexInPriceData]?.temperature || 0), 0) / (finlandPoints.length || 1);
    } else {
        // Synthetic values for historical dates (reproducible from date string)
        const seed = String(targetDate).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        avgWindSpeed = 3 + (seed % 100) / 100 * 8;
        avgTemperature = -5 + (seed % 100) / 100 * 20;
    }

    const date = new Date(targetDate);
    const hour = date.getHours();
    const dayOfWeek = date.getDay();
    const month = date.getMonth();
    const isWinter = month >= 10 || month <= 2 ? 1 : 0;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0;
    const isMorningPeak = (hour >= 7 && hour <= 9) ? 1 : 0;
    const isEveningPeak = (hour >= 17 && hour <= 20) ? 1 : 0;

    return [
        avgWindSpeed,
        avgTemperature,
        isWinter,
        isMorningPeak,
        isEveningPeak,
        isWeekend,
        avgWindSpeed * isWinter
    ];
}

// Train prediction model
async function trainModel() {
    console.log('Training Price Prediction Model');
    console.log('===============================\n');
    
    // Load data
    let windData, priceData;
    
    try {
        const windFile = JSON.parse(fs.readFileSync(CONFIG.windDataFile, 'utf-8'));
        windData = windFile.data || windFile;
        const priceFile = JSON.parse(fs.readFileSync(CONFIG.priceDataFile, 'utf-8'));
        priceData = priceFile.data || priceFile;
    } catch (e) {
        console.log('Data files not found. Run fetch scripts first.');
        console.log('Generating sample training data...');
        windData = generateSampleWindData();
        priceData = generateSamplePriceData();
    }

    if (!Array.isArray(windData)) windData = [];
    if (!Array.isArray(priceData) || priceData.length === 0) {
        console.log('Price data missing or invalid; using sample price data.');
        priceData = generateSamplePriceData();
    }

    console.log(`Wind data points: ${windData.length}`);
    console.log(`Price data records: ${priceData.length}`);

    const X = [];
    const y = [];

    priceData.forEach((dayData, index) => {
        const features = extractFeatures(windData, priceData, dayData.date, index);
        X.push(features);
        y.push(dayData.avgPrice || 50);
    });
    
    console.log(`Training samples: ${X.length}`);
    
    // Train model
    const model = new LinearRegression();
    model.featureNames = [
        'windSpeed',
        'temperature', 
        'isWinter',
        'isMorningPeak',
        'isEveningPeak',
        'isWeekend',
        'windSpeed_x_isWinter'
    ];
    
    model.fit(X, y);
    
    // Print model interpretation
    console.log('\nModel Coefficients:');
    model.featureNames.forEach((name, i) => {
        const weight = model.weights[i].toFixed(3);
        const direction = weight > 0 ? '↑' : '↓';
        console.log(`  ${name}: ${weight} ${direction}`);
    });
    console.log(`  bias: ${model.bias.toFixed(3)}`);
    
    // Calculate R² score
    const predictions = X.map(x => model.predict(x));
    const meanY = y.reduce((a, b) => a + b, 0) / y.length;
    const ssRes = predictions.reduce((sum, p, i) => sum + Math.pow(p - y[i], 2), 0);
    const ssTot = y.reduce((sum, val) => sum + Math.pow(val - meanY, 2), 0);
    const r2 = 1 - ssRes / ssTot;
    
    console.log(`\nModel R² Score: ${(r2 * 100).toFixed(1)}%`);
    
    // Save model
    model.save(CONFIG.modelFile);
    console.log(`\nModel saved to ${CONFIG.modelFile}`);
    
    return model;
}

// Generate predictions for next 9 days
async function generatePredictions() {
    console.log('\nGenerating Predictions...');
    
    let model;
    try {
        model = new LinearRegression().load(CONFIG.modelFile);
    } catch (e) {
        console.log('No trained model found. Training first...');
        model = await trainModel();
    }
    
    // Load current wind forecast
    let windData;
    try {
        const windFile = JSON.parse(fs.readFileSync(CONFIG.windDataFile, 'utf-8'));
        windData = windFile.data || windFile;
    } catch (e) {
        windData = generateSampleWindData();
    }
    
    const predictions = [];
    const now = new Date();
    
    for (let day = 0; day < 9; day++) {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + day);
        
        // Get wind forecast for this day
        const finlandPoints = windData.filter(p => p.lat >= 60 && p.lat <= 70 && p.lon >= 20 && p.lon <= 32);
        
        const avgWindSpeed = finlandPoints.reduce((sum, p) => {
            const forecast = p.forecasts[day];
            return sum + (forecast?.windSpeed || 5);
        }, 0) / (finlandPoints.length || 1);
        
        const avgTemperature = finlandPoints.reduce((sum, p) => {
            const forecast = p.forecasts[day];
            return sum + (forecast?.temperature || 0);
        }, 0) / (finlandPoints.length || 1);
        
        // Predict for different hours
        const hourlyPredictions = [];
        for (let hour = 0; hour < 24; hour++) {
            const date = new Date(targetDate);
            date.setHours(hour);
            
            const features = [
                avgWindSpeed,
                avgTemperature,
                (date.getMonth() >= 10 || date.getMonth() <= 2) ? 1 : 0,
                (hour >= 7 && hour <= 9) ? 1 : 0,
                (hour >= 17 && hour <= 20) ? 1 : 0,
                (date.getDay() === 0 || date.getDay() === 6) ? 1 : 0,
                avgWindSpeed * ((date.getMonth() >= 10 || date.getMonth() <= 2) ? 1 : 0)
            ];
            
            const price = Math.max(0, model.predict(features));
            hourlyPredictions.push({ hour, price: Math.round(price * 100) / 100 });
        }
        
        const avgPrice = hourlyPredictions.reduce((sum, h) => sum + h.price, 0) / 24;
        
        // Determine price level
        let priceLevel = 'NORMAL';
        if (avgPrice < 40) priceLevel = 'LOW';
        else if (avgPrice > 100) priceLevel = 'HIGH';
        else if (avgPrice > 150) priceLevel = 'VERY HIGH';
        
        predictions.push({
            date: targetDate.toISOString().split('T')[0],
            dayName: day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : `+${day} days`,
            avgWindSpeed: Math.round(avgWindSpeed * 10) / 10,
            avgTemperature: Math.round(avgTemperature * 10) / 10,
            predictedPrice: Math.round(avgPrice * 100) / 100,
            priceLevel,
            hourlyPredictions,
            confidence: 0.7 - day * 0.05 // Confidence decreases with forecast distance
        });
    }
    
    // Save predictions
    const output = {
        generated: new Date().toISOString(),
        model: 'LinearRegression v1',
        predictions
    };
    
    fs.writeFileSync(CONFIG.predictionFile, JSON.stringify(output, null, 2));
    console.log(`Predictions saved to ${CONFIG.predictionFile}`);
    
    // Print summary
    console.log('\n9-Day Price Forecast:');
    console.log('─'.repeat(60));
    predictions.forEach(p => {
        const bar = '█'.repeat(Math.min(20, Math.round(p.predictedPrice / 10)));
        console.log(`${p.dayName.padEnd(10)} | Wind: ${p.avgWindSpeed.toFixed(1)}m/s | Temp: ${p.avgTemperature.toFixed(0)}°C | €${p.predictedPrice.toFixed(0)}/MWh ${p.priceLevel.padStart(10)} ${bar}`);
    });
    
    return predictions;
}

// Sample data generators
function generateSampleWindData() {
    const points = [];
    for (let lat = 55; lat <= 70; lat += 1.5) {
        for (let lon = 5; lon <= 30; lon += 1.5) {
            const forecasts = [];
            let baseSpeed = 3 + Math.random() * 7;
            let baseTemp = 5 - (lat - 55) * 0.4;
            
            for (let day = 0; day < 9; day++) {
                forecasts.push({
                    day,
                    windSpeed: Math.max(1, baseSpeed + (Math.random() - 0.5) * 4),
                    temperature: baseTemp + (Math.random() - 0.5) * 5
                });
                baseSpeed += (Math.random() - 0.5) * 2;
            }
            points.push({ lat, lon, forecasts });
        }
    }
    return points;
}

function generateSamplePriceData() {
    const prices = [];
    const now = new Date();
    
    for (let day = -30; day <= 0; day++) {
        const date = new Date(now);
        date.setDate(date.getDate() + day);
        
        const isWinter = date.getMonth() >= 10 || date.getMonth() <= 2;
        const basePrice = isWinter ? 85 : 45;
        
        prices.push({
            date: date.toISOString().split('T')[0],
            avgPrice: basePrice + (Math.random() - 0.5) * 40
        });
    }
    return prices;
}

// Main
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--train')) {
        await trainModel();
    }
    
    if (args.includes('--predict') || args.length === 0) {
        await generatePredictions();
    }
}

main().catch(console.error);
