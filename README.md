# 💨 WindPowers

**Nordic Wind Map with Weather Forecasts & Electricity Price Predictions**

A beautiful, interactive wind map for the Nordic region (Finland, Sweden, Norway, Denmark) showing wind speeds, directions, and temperatures up to 9 days ahead.

![WindPowers Screenshot](screenshot.png)

## 🌟 Features

- **Interactive Wind Map** - Visual wind arrows showing speed and direction
- **9-Day Forecast** - Slide through the next 9 days of weather
- **Nordic Coverage** - Full coverage of Finland, Sweden, Norway, and Denmark
- **Real Weather Data** - Powered by yr.no (MET Norway API)
- **Light, Modern UI** - Clean, responsive design

## 🚀 Future Features (Planned)

- **Nordpool Integration** - Real-time electricity prices
- **Price Prediction** - ML model correlating wind/temperature with electricity prices
- **Historical Data** - View past trends and patterns
- **Alerts** - Notifications for extreme weather or price spikes

## 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript, MapLibre GL JS
- **Backend**: Node.js, Express
- **Data**: yr.no Weather API (MET Norway)
- **Hosting**: Vercel (planned)

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/leevi00100-png/windpowers.git
cd windpowers

# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

## 📊 Data Fetching

To fetch fresh wind data from yr.no:

```bash
npm run fetch-data
```

Note: This fetches data for ~500 grid points and takes ~5 minutes.

## 🌐 API Endpoints

- `GET /` - Main application
- `GET /api/health` - Health check
- `GET /api/weather?lat=60&lon=25` - Get wind data for coordinates
- `GET /data/wind-data.json` - Cached wind data

## 📁 Project Structure

```
windpowers/
├── public/
│   ├── index.html      # Main HTML
│   ├── styles.css      # Styles
│   ├── app.js          # Frontend JS
│   └── data/           # Cached data
├── src/
│   └── server.js       # Express server
├── scripts/
│   └── fetch-wind-data.js  # Data fetcher
└── package.json
```

## 🤝 Contributing

Pull requests welcome! For major changes, please open an issue first.

## 📄 License

MIT

<!-- Test commit for GitHub Actions VERCEL_TOKEN secret added -->

## 🙏 Credits

- Weather data: [yr.no](https://www.yr.no) (MET Norway)
- Built by Jarvis ⚡ for Leevi

---

*Part of the WindPowers project - Connecting Nordic weather to electricity markets*
