/**
 * WindPowers - Express Server for Vercel Deployment
 * Serves static files with polling-based live updates
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Serve data files
app.use('/data', express.static(path.join(__dirname, '../public/data')));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString()
    });
});

// Wind data API endpoint
app.get('/api/weather', (req, res) => {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) {
        return res.status(400).json({ error: 'lat and lon required' });
    }
    
    const dataFile = path.join(__dirname, '../public/data/wind-data.json');
    
    try {
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
        const point = data.data.find(p => 
            Math.abs(p.lat - parseFloat(lat)) < 0.5 && 
            Math.abs(p.lon - parseFloat(lon)) < 0.5
        );
        
        if (point) {
            return res.json(point);
        }
    } catch (e) {
        // Continue to 404
    }
    
    res.status(404).json({ error: 'No data for this location' });
});

// Get full wind data
app.get('/api/wind-data', (req, res) => {
    const dataFile = path.join(__dirname, '../public/data/wind-data.json');
    
    try {
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
        return res.json(data);
    } catch (e) {
        res.status(404).json({ error: 'No wind data available' });
    }
});

// For local development
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🌬️ WindPowers server running at http://localhost:${PORT}`);
        console.log(`📡 Live updates every 30 seconds via polling`);
    });
}

module.exports = app;
