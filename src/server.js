/**
 * WindPowers - Real-Time Express Server with Socket.IO
 * Serves static files, API endpoints, and real-time weather updates
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;
const UPDATE_INTERVAL = 60000; // 1 minute for real-time updates

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Serve data files
app.use('/data', express.static(path.join(__dirname, '../public/data')));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        connections: io.engine.clientsCount
    });
});

// Wind data API endpoint (legacy support)
app.get('/api/weather', async (req, res) => {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) {
        return res.status(400).json({ error: 'lat and lon required' });
    }
    
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

// Get full wind data
app.get('/api/wind-data', (req, res) => {
    const dataFile = path.join(__dirname, '../public/data/wind-data.json');
    
    if (fs.existsSync(dataFile)) {
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
        return res.json(data);
    }
    
    res.status(404).json({ error: 'No wind data available' });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`🌬️ Client connected: ${socket.id}`);
    
    // Send initial data immediately
    sendInitialData(socket);
    
    // Handle day change requests
    socket.on('changeDay', (day) => {
        io.emit('dayChanged', day);
        console.log(`📅 Day changed to: ${day}`);
    });
    
    // Handle location subscription for updates
    socket.on('subscribeLocation', (coords) => {
        socket.join(`loc_${coords.lat}_${coords.lon}`);
        console.log(`📍 ${socket.id} subscribed to ${coords.lat},${coords.lon}`);
    });
    
    // Handle unsubscription
    socket.on('unsubscribeLocation', (coords) => {
        socket.leave(`loc_${coords.lat}_${coords.lon}`);
    });
    
    socket.on('disconnect', () => {
        console.log(`🌬️ Client disconnected: ${socket.id}`);
    });
});

// Send initial data to newly connected client
function sendInitialData(socket) {
    const dataFile = path.join(__dirname, '../public/data/wind-data.json');
    
    if (fs.existsSync(dataFile)) {
        const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
        socket.emit('initialData', {
            data: data.data || data,
            timestamp: new Date().toISOString()
        });
    } else {
        socket.emit('initialData', { data: [], timestamp: new Date().toISOString() });
    }
}

// Simulated real-time data updates (replace with actual API calls in production)
function generateRealTimeUpdate() {
    const dataFile = path.join(__dirname, '../public/data/wind-data.json');
    
    if (!fs.existsSync(dataFile)) return null;
    
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    const points = data.data || data;
    
    // Update random subset of points to simulate real-time changes
    const updates = [];
    const updateCount = Math.min(50, points.length);
    
    for (let i = 0; i < updateCount; i++) {
        const randomIndex = Math.floor(Math.random() * points.length);
        const point = points[randomIndex];
        
        if (point.forecasts && point.forecasts.length > 0) {
            // Add small variations to simulate real-time changes
            const forecast = { ...point.forecasts[0] };
            forecast.windSpeed = Math.max(0.5, forecast.windSpeed + (Math.random() - 0.5) * 0.5);
            forecast.temperature = forecast.temperature + (Math.random() - 0.5) * 0.3;
            
            updates.push({
                lat: point.lat,
                lon: point.lon,
                forecast
            });
        }
    }
    
    return {
        type: 'windUpdate',
        updates,
        timestamp: new Date().toISOString()
    };
}

// Broadcast real-time updates periodically
function startRealTimeUpdates() {
    console.log('🔄 Starting real-time updates...');
    
    setInterval(() => {
        const update = generateRealTimeUpdate();
        if (update) {
            io.emit('weatherUpdate', update);
            console.log(`📡 Broadcasted weather update at ${update.timestamp}`);
        }
    }, UPDATE_INTERVAL);
}

// Start server
httpServer.listen(PORT, () => {
    console.log(`🌬️ WindPowers real-time server running at http://localhost:${PORT}`);
    startRealTimeUpdates();
});

// Export for testing
module.exports = { app, httpServer, io };
