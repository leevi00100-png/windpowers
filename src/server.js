/**
 * WindPowers - Simple Express Server
 * Serves static files and API endpoints
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
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Wind data API endpoint
app.get('/api/weather', async (req, res) => {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) {
        return res.status(400).json({ error: 'lat and lon required' });
    }
    
    // In production, this would fetch from yr.no
    // For now, return from cached data
    const dataFile = path.join(__dirname, '../public/data/wind-data.json');
    
    if (fs.existsSync(dataFile)) {
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
        const point = data.data.find(p => 
            Math.abs(p.lat - parseFloat(lat)) < 0.5 && 
            Math.abs(p.lon - parseFloat(lon)) < 0.5
        );
        
        if (point) {
            return res.json(point);
        }
    }
    
    res.status(404).json({ error: 'No data for this location' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🌬️ WindPowers server running at http://localhost:${PORT}`);
});
