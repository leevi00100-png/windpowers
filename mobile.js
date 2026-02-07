const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ 
        headless: true,
        executablePath: '/home/leevi/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome'
    });
    
    // Mobile viewport
    const context = await browser.newContext({
        viewport: { width: 375, height: 812 } // iPhone X size
    });
    const page = await context.newPage();
    
    await page.goto('http://localhost:3001');
    await page.waitForTimeout(6000);
    
    await page.screenshot({ path: 'mobile-view.png', fullPage: true });
    console.log('Mobile screenshot: mobile-view.png');
    
    await browser.close();
})();
