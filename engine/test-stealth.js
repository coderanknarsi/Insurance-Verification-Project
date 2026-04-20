const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  try {
    console.log('Launching browser...');
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-sandbox",
      ],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      timezoneId: "America/New_York",
      bypassCSP: true,
    });

    // Add stealth script
    await context.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    `);

    // THIS is the suspect - route interception
    await context.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) {
        return route.abort();
      }
      return route.continue();
    });

    const page = await context.newPage();
    
    console.log('Navigating to PROVE portal...');
    await page.goto('https://prove.progressive.com/', { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    
    const title = await page.title();
    console.log('SUCCESS! Title:', title);
    fs.writeFileSync('C:\\Users\\admin\\Desktop\\stealth_test.txt', 'SUCCESS: ' + title);
    
    await browser.close();
  } catch (e) {
    console.log('ERROR:', e.message);
    fs.writeFileSync('C:\\Users\\admin\\Desktop\\stealth_test.txt', 'ERROR: ' + e.message);
  }
  process.exit(0);
})();
