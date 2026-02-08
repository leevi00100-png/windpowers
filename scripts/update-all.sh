#!/bin/bash
# WindPowers - Daily Data Update Script
# Updates weather data and electricity prices
# Runs via cron daily

cd "$(dirname "$0")/.."

echo "================================"
echo "WindPowers Daily Update"
echo "$(date)"
echo "================================"

echo ""
echo "Fetching wind data from yr.no..."
node scripts/fetch-wind-data.js

echo ""
echo "Fetching Nordpool prices..."
node scripts/fetch-nordpool-prices.js

echo ""
echo "Generating price predictions..."
node scripts/price-prediction.js

echo ""
echo "================================"
echo "Update complete!"
echo "Next update: tomorrow at 02:00"
echo "================================"
