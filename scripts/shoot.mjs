// Screenshots of pages at a few sizes, for checking the design by eye: node scripts/shoot.mjs out-dir page...
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
const [out, ...pages] = process.argv.slice(2);
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const p of pages) {
  for (const [name, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', (e) => console.log('pageerror', p, e.message));
    page.on('console', (m) => m.type() === 'error' && console.log('console', p, m.text()));
    await page.goto(base + p);
    await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${p.replace('.html', '')}-${name}.png`, fullPage: true });
    await page.close();
  }
}
await browser.close();
server.close();
