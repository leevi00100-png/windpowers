const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ 
        headless: true,
        executablePath: '/home/leevi/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome'
    });
    const page = await browser.newPage();
    
    await page.goto('http://localhost:3000');
    await page.waitForTimeout(5000);
    
    await page.screenshot({ path: 'windpowers-fixed.png', fullPage: true });
    console.log('Screenshot saved');
    
    await browser.close();
})();
