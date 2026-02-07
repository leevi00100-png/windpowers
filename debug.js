const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ 
        headless: true,
        executablePath: '/home/leevi/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome'
    });
    const page = await browser.newPage();
    
    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
    
    await page.goto('http://localhost:3000');
    await page.waitForTimeout(8000);
    
    // Check turbine layers
    const layers = await page.evaluate(() => {
        if (typeof map !== 'undefined' && map.getStyle) {
            return map.getStyle().layers.map(l => ({ id: l.id, type: l.type }));
        }
        return [];
    });
    console.log('Layers:', JSON.stringify(layers, null, 2));
    
    // Check turbine count labels
    const hasLabels = await page.evaluate(() => {
        if (typeof map !== 'undefined' && map.getLayer) {
            return {
                'turbine-names': !!map.getLayer('turbine-names'),
                'turbine-count-labels': !!map.getLayer('turbine-count-labels')
            };
        }
        return {};
    });
    console.log('Label layers:', JSON.stringify(hasLabels, null, 2));
    
    // Console errors
    const errors = consoleMessages.filter(m => m.includes('error') || m.includes('Error') || m.includes('turbine'));
    console.log('Console:', errors.join('\n'));
    
    await page.screenshot({ path: 'debug.png', fullPage: true });
    
    await browser.close();
})();
