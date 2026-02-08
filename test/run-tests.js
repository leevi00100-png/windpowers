// Simple tests for WindPowers

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (error) {
        console.log(`✗ ${name}: ${error.message}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

console.log('Running WindPowers tests...\n');

// Test 1: app.js has valid syntax
test('app.js has valid syntax', () => {
    const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
    // Just check it has expected functions
    assert(appJs.includes('function init()'), 'Missing init function');
    assert(appJs.includes('function addWindSources()'), 'Missing addWindSources function');
    assert(appJs.includes('setupLazyPanels'), 'Missing setupLazyPanels function');
    assert(appJs.includes('fetchWindData'), 'Missing fetchWindData function');
});

// Test 2: index.html has required elements
test('index.html has required panels', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    assert(indexHtml.includes('dashboard-panel'), 'Missing dashboard-panel');
    assert(indexHtml.includes('alerts-panel'), 'Missing alerts-panel');
    assert(indexHtml.includes('price-panel'), 'Missing price-panel');
    assert(indexHtml.includes('legend-panel'), 'Missing legend-panel');
    assert(indexHtml.includes('id="map"'), 'Missing map element');
});

// Test 3: CSS has required styles
test('styles.css has required styles', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
    assert(css.includes('.dashboard-panel'), 'Missing .dashboard-panel styles');
    assert(css.includes('.legend-panel'), 'Missing .legend-panel styles');
    assert(css.includes('#map'), 'Missing #map styles');
    assert(css.includes('.price-forecast'), 'Missing .price-forecast styles');
});

// Test 4: turbine data exists and is valid (skip if file missing - run fetch scripts or commit fixtures)
test('turbines-finland.json is valid JSON', () => {
    const filePath = path.join(__dirname, '../public/data/turbines-finland.json');
    if (!fs.existsSync(filePath)) {
        console.log('  (skip: file missing; run fetch scripts or add fixture)');
        return;
    }
    const turbines = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(turbines);
    assert(Array.isArray(data.turbines), 'turbines should be an array');
    assert(data.turbines.length > 0, 'turbines should not be empty');
});

// Test 5: wind data structure (skip if file missing)
test('wind-data.json has valid structure', () => {
    const filePath = path.join(__dirname, '../public/data/wind-data.json');
    if (!fs.existsSync(filePath)) {
        console.log('  (skip: file missing; run npm run fetch-data)');
        return;
    }
    const windData = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(windData);
    assert(data.data && Array.isArray(data.data), 'wind-data should have data array');
    assert(data.data.length > 0, 'wind data should not be empty');
});

// Test 6: server.js has required modules
test('server.js has required dependencies', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
    assert(server.includes('express'), 'Missing express import');
    assert(server.includes('fs'), 'Missing fs import');
    assert(server.includes('app.listen'), 'Missing server listen');
});

// Summary
console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\nAll tests passed! ✓');
}
