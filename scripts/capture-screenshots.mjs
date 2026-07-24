/**
 * Capture 390px screenshots for Pass the Fear local build
 * Serves dist/ locally with correct static asset paths.
 * Fixed: do NOT append /index.html to CSS/JS asset requests.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT_DIR = process.env.SCREENSHOT_OUT_DIR ?? join(ROOT, 'qa-screenshots');

const PORT = 4321;
const ROUTES = ['/', '/guide/', '/characters/', '/build-system/', '/co-op/', '/updates/'];
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

/**
 * Serve a URL path from DIST.
 * - /                   -> /index.html
 * - /guide/             -> /guide/index.html
 * - /_assets/file.css   -> /_assets/file.css (Astro hashed asset, direct)
 * - /sitemap.xml        -> /sitemap.xml
 * Never append /index.html to paths that already have a file extension.
 */
function urlToFilePath(urlPath) {
  // Remove query string
  const pathname = urlPath.split('?')[0];

  // Astro hashed assets (_assets/*.css, _assets/*.js) go directly
  if (pathname.startsWith('/_assets/')) {
    return join(DIST, pathname);
  }

  // Paths with a file extension go directly
  const hasExt = /\.\w{2,6}$/.test(pathname);
  if (hasExt) {
    return join(DIST, pathname);
  }

  // Directory route -> index.html
  if (pathname.endsWith('/')) {
    return join(DIST, pathname + 'index.html');
  }
  return join(DIST, pathname + '/index.html');
}

const server = createServer((req, res) => {
  const filePath = urlToFilePath(req.url);
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found: ' + req.url);
    return;
  }
  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(readFileSync(filePath));
});

async function capture() {
  await new Promise((resolve) => server.listen(PORT, () => resolve()));
  console.log(`Server running on http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  const results = [];
  for (const route of ROUTES) {
    const page = await context.newPage();
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      // Ignore external failures (network issues in headless are ok)
      if (!url.startsWith('http://localhost') && !url.startsWith('https://')) return;
      errors.push(`requestfailed: ${req.failure()?.errorText} — ${url}`);
    });

    const url = `http://localhost:${PORT}${route}`;
    console.log(`Capturing ${url} ...`);
    await page.goto(url, { waitUntil: 'networkidle' });

    // Check computed body background
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });

    // Check for document overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });

    // Check first useful action position
    const pickerBox = await page.evaluate(() => {
      const el = document.querySelector('.picker-wrap') || document.querySelector('h1');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, visible: rect.top < window.innerHeight };
    });

    const label = route.replace(/\//g, '_').replace(/^_/, '').replace(/_$/, '') || 'home';
    const outPath = join(OUT_DIR, `${label}.png`);
    await page.screenshot({ path: outPath, type: 'png' });

    results.push({
      route,
      label,
      outPath,
      bgColor,
      hasOverflow,
      pickerTop: pickerBox?.top,
      pickerVisible: pickerBox?.visible,
      errors: errors.filter((e) => !e.includes('favicon')),
    });

    console.log(`  -> saved ${outPath}`);
    console.log(`  body background: ${bgColor}`);
    console.log(`  scroll overflow: ${hasOverflow}`);
    console.log(`  picker top: ${pickerBox?.top ?? 'not found'}`);
    console.log(`  picker visible in first viewport: ${pickerBox?.visible}`);
    if (errors.length > 0) console.log(`  console errors: ${errors.join('; ')}`);

    await page.close();
  }

  await browser.close();
  server.close();

  console.log('\n=== Screenshot QA Summary ===');
  for (const r of results) {
    console.log(`${r.route}: bg=${r.bgColor} overflow=${r.hasOverflow} pickerTop=${r.pickerTop} pickerVisible=${r.pickerVisible} errors=${r.errors.length}`);
  }
  console.log('Done.');
}

capture().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
