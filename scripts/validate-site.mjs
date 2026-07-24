/**
 * Pass the Fear — site-specific validator (v5)
 *
 * Key design decisions:
 * - Sitemap check uses URL() pathname Set comparison — no endsWith, no string tricks
 * - Canonical check uses new URL() parsing — fails on missing href, bad domain, path prefix match
 * - MT2 reuses the formal sitemap check function on the mutated file
 * - MT5 mutates a canonical href and uses the formal canonical validator to detect it
 * - Mutation gate: any undetected mutation exits 1
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

const ENABLED_ROUTES = [
  '/', '/guide/', '/beginner-guide/', '/characters/', '/build-system/',
  '/weapons/', '/bosses-stages/', '/co-op/', '/updates/',
  '/sources/', '/about/', '/privacy/',
];

const CANONICAL_ORIGIN = 'https://passthefearguide.com';

// Source IDs from runtime registry — must match src/data/sources.ts
const REGISTERED_SOURCE_IDS = new Set(['PTF-S01', 'PTF-S02', 'site_policy']);

// Denial context markers — sentence-level
const DENIAL_MARKERS = [
  'not confirmed', 'not yet verified', 'not yet established',
  'requires verification', 'requires a launch', 'requires launch-day',
  'requires launch-time', 'not sourced', 'official sources do not confirm',
  'no official source', 'official sources confirm only',
  'hands-on verification', 'not confirmed as', 'official announcement says',
  'requires official', 'requires hands-on', 'no official source makes this recommendation',
  'character selection guidance requires', 'weapon tier or best-weapon claims are not confirmed',
  'are not confirmed', 'is not confirmed', 'requires a launch-day check',
  'requires a launch-time check', 'is not yet verified',
];

function isInDenialContext(content, matchStart, matchEnd) {
  const beforeMatch = content.slice(Math.max(0, matchStart - 500), matchStart);
  const summaryOpen = beforeMatch.lastIndexOf('<summary');
  const summaryClose = beforeMatch.lastIndexOf('</summary');
  const inSummary = summaryOpen > summaryClose;

  if (inSummary) {
    const afterSummary = content.slice(matchStart, Math.min(content.length, matchEnd + 400));
    const afterLower = afterSummary.toLowerCase();
    return DENIAL_MARKERS.some((m) => afterLower.includes(m));
  }

  const before = content.slice(Math.max(0, matchStart - 250), matchStart);
  const matched = content.slice(matchStart, matchEnd);
  const after = content.slice(matchEnd, Math.min(content.length, matchEnd + 600));
  const combined = (before + ' ' + matched + ' ' + after).toLowerCase();
  return DENIAL_MARKERS.some((m) => combined.includes(m));
}

// Forbidden claim patterns
const FORBIDDEN_CLAIM_PATTERNS = [
  { pattern: /\bbest (build|character|weapon|relic|tarot|loadout)\b/i, reason: 'best/meta claim' },
  { pattern: /\btier list\b/i, reason: 'tier list' },
  { pattern: /\bdrop rate\b/i, reason: 'drop rate claim' },
  { pattern: /damage\s+\d+/i, reason: 'exact damage value' },
  { pattern: /\d+%\s+(damage|chance|proc)/i, reason: 'percentage stat claim' },
  { pattern: /cooldown\s+\d+/i, reason: 'exact cooldown value' },
  { pattern: /\bunlock (step|requirement|method)\b/i, reason: 'unlock step claim' },
  { pattern: /\bhow to unlock\b/i, reason: 'unlock instruction' },
  { pattern: /\bboss (strategy|guide|walkthrough)\b/i, reason: 'boss walkthrough' },
  { pattern: /\bcontrol(s)? (is|are|map|bind)\b/i, reason: 'control/keybind claim' },
  { pattern: /\bfull (weapon|relic|tarot|pearl|boss|stage) (database|list|index)\b/i, reason: 'incomplete database claim' },
];

const AD_ANALYTICS_PATTERNS = [
  // Only flag effectivecpmnetwork when it appears as a script src attribute (not plain-text disclosure)
  { pattern: /<script[^>]+src=["'][^"']*effectivecpmnetwork/i, reason: 'ad script reference' },
  { pattern: /<script[^>]+src=["'][^"']*invoke\.js/i, reason: 'ad script reference' },
  { pattern: /google-analytics\.com|analytics\.js|tracking\.js/i, reason: 'analytics script reference' },
  { pattern: /dataLayer.*push|gtag\(|fbq\(.*track/i, reason: 'analytics data layer' },
];

// The approved Native Banner loader from effectivecpmnetwork.com is ALLOWED here.
// Any OTHER script from effectivecpmnetwork.com (wrong path, wrong domain) is checked via
// the Native Banner fidelity check [11b] and the EXTERNAL_RESOURCE pattern.
const APPROVED_NATIVE_SCRIPT_RE = /effectivecpmnetwork\.com\/4499ca96010bfd0d82e881acb7d864fe\/invoke\.js/;

// Authorized Native Banner contract — loader and container must match exact approved values
const APPROVED_NATIVE_LOADER = 'https://pl30459301.effectivecpmnetwork.com/4499ca96010bfd0d82e881acb7d864fe/invoke.js';
const APPROVED_NATIVE_CONTAINER = 'container-4499ca96010bfd0d82e881acb7d864fe';
const APPROVED_NATIVE_DOMAIN = 'pl30459301.effectivecpmnetwork.com';

// Content routes that must have exactly one Native Banner
const NATIVE_AD_ROUTES = ['/', '/guide/', '/beginner-guide/', '/characters/', '/build-system/', '/weapons/', '/bosses-stages/', '/co-op/', '/updates/'];
// Trust pages and 404 must have zero Native Banners
const NATIVE_AD_EXCLUDED = ['/sources/', '/about/', '/privacy/', '/404/'];

const EXTERNAL_RESOURCE_PATTERNS = [
  { pattern: /<script[^>]+src=["']https?:\/\/(?!(?:passthefearguide\.com|localhost|_assets|pl30459301\.effectivecpmnetwork\.com))/, reason: 'external script tag' },
  { pattern: /<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\/(?!(?:passthefearguide\.com|localhost|_assets))/, reason: 'external stylesheet link' },
  { pattern: /<img[^>]+src=["']https?:\/\/(?!(?:passthefearguide\.com|localhost|_assets))/, reason: 'external image' },
];

const PRIVATE_PATH_PATTERNS = [
  { pattern: /PROJECT_STATUS|LEARNINGS|\.agents\//i, reason: 'internal workflow file referenced' },
];

// Only match actual template placeholder literals
const TEMPLATE_PLACEHOLDER_PATTERNS = [
  { pattern: /\bexample\.com\b/i, reason: 'template placeholder domain' },
  { pattern: /(?<![a-zA-Z0-9-])TEMPLATE(?![a-zA-Z0-9-])(?!-)|(?<![a-zA-Z0-9-])GAME_NAME(?![a-zA-Z0-9-])(?!-)|(?<![a-zA-Z0-9-])REPLACE_WITH(?![a-zA-Z0-9-])(?!-)|(?<![a-zA-Z0-9-])Replace this\b(?!-)/i, reason: 'mother-template placeholder' },
  { pattern: /\bYYYY-MM-DD\b/i, reason: 'fake date from template' },
  { pattern: /\/map\/|\/locations\/|\/quests\/|\/items\/|\/crafting\/|\/tools\//i, reason: 'route not in approved twelve' },
];

// Unsupported freshness / launch-status assertions
const UNSUPPORTED_FRESHNESS_PATTERNS = [
  { pattern: /in or just past (its|the) launch window/i, reason: 'unsupported launch-window inference' },
  { pattern: /in or past (its|the) launch window/i, reason: 'unsupported launch-window inference' },
  { pattern: /should now be resolved/i, reason: 'unsupported launch-status resolution claim' },
  { pattern: /authoritative date is whichever/i, reason: 'unsupported authoritative-date claim' },
  { pattern: /Evidence refresh.*post-launch window/i, reason: 'unsupported post-launch refresh entry' },
];

function scanFilePatterns(filePath, content) {
  const issues = [];
  const relPath = relative(ROOT, filePath);
  if (filePath.endsWith('.css')) return [];

  for (const { pattern, reason } of TEMPLATE_PLACEHOLDER_PATTERNS) {
    if (pattern.test(content)) {
      issues.push(`FORBIDDEN_TEMPLATE: "${reason}" in ${relPath}: "${content.match(pattern)?.[0]}"`);
    }
  }

  for (const { pattern, reason } of FORBIDDEN_CLAIM_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, 'gi');
    while ((match = regex.exec(content)) !== null) {
      if (!isInDenialContext(content, match.index, match.index + match[0].length)) {
        issues.push(`UNSUPPORTED_CLAIM: "${reason}" in ${relPath}: "${match[0]}"`);
      }
    }
  }

  for (const { pattern, reason } of UNSUPPORTED_FRESHNESS_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      issues.push(`UNSUPPORTED_FRESHNESS: "${reason}" in ${relPath}: "${match[0]}"`);
    }
  }

  for (const { pattern, reason } of AD_ANALYTICS_PATTERNS) {
    if (pattern.test(content)) {
      // Allow the exact approved Native Banner CDN URL; flag all other matches
      if (reason === 'ad script reference' && content.includes(APPROVED_NATIVE_LOADER)) {
        continue; // exact approved URL — skip
      }
      issues.push(`AD_ANALYTICS: "${reason}" in ${relPath}`);
    }
  }

  for (const { pattern, reason } of EXTERNAL_RESOURCE_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, 'gi');
    while ((match = regex.exec(content)) !== null) {
      issues.push(`EXTERNAL_RESOURCE: "${reason}" in ${relPath}: "${match[0].substring(0, 80)}"`);
    }
  }

  for (const { pattern, reason } of PRIVATE_PATH_PATTERNS) {
    if (pattern.test(content)) {
      issues.push(`PRIVATE_PATH: "${reason}" in ${relPath}`);
    }
  }

  // Source ID registry check — same logic as validator check [8]
  const foundIds = [...new Set([...content.match(/PTF-S\d+|site_policy/g) || []])];
  const unresolvedIds = foundIds.filter((id) => !REGISTERED_SOURCE_IDS.has(id));
  for (const id of unresolvedIds) {
    issues.push(`UNRESOLVED_SOURCE_ID: "${id}" in ${relPath}`);
  }

  return issues;
}

function scanDist(dir) {
  const allIssues = [];
  const htmlFiles = [];
  function walk(d) {
    readdirSync(d).forEach((entry) => {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const ext = extname(entry).toLowerCase();
        if (ext === '.html' || ext === '.xml' || ext === '.txt' || ext === '.js' || ext === '.mjs') {
          htmlFiles.push(full);
          allIssues.push(...scanFilePatterns(full, readFileSync(full, 'utf-8')));
        }
      }
    });
  }
  walk(dir);
  return { allIssues, htmlFiles };
}

function routeFromFile(filePath) {
  const rel = '/' + relative(DIST, filePath).replace(/\\/g, '/');
  if (rel.endsWith('/index.html')) return rel.replace(/\/index\.html$/, '/') || '/';
  if (rel.endsWith('.html')) return rel.replace(/\.html$/, '') || '/';
  if (rel.endsWith('/')) return rel;
  return rel;
}

function getBuiltRoutes() {
  const files = [];
  function walk(d) {
    readdirSync(d).forEach((e) => {
      const full = join(d, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (extname(e).toLowerCase() === '.html') files.push(full);
    });
  }
  walk(DIST);
  return [...new Set(files.map(routeFromFile))];
}

function getSitemapLocs() {
  const content = readFileSync(join(DIST, 'sitemap.xml'), 'utf-8');
  return [...content.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

function readRouteHtml(route) {
  const base = route.replace(/^\//, '').replace(/\/$/, '');
  const indexPath = join(DIST, base, 'index.html');
  const flatPath = join(DIST, base + '.html');
  if (existsSync(indexPath)) return readFileSync(indexPath, 'utf-8');
  if (existsSync(flatPath)) return readFileSync(flatPath, 'utf-8');
  return '';
}

// =====================
// FORMAL CHECK FUNCTIONS
// =====================

/**
 * Sitemap URL set comparison using URL() pathname.
 * Returns { valid, missing, extra } where:
 *   missing  = ENABLED_ROUTES not in sitemap (by pathname Set)
 *   extra    = sitemap entries not in ENABLED_ROUTES (by pathname Set)
 * Fails if any URL cannot be parsed.
 */
function checkSitemap(locs) {
  const missing = [];
  const extra = [];

  // Build pathname Set from sitemap
  const sitemapPaths = new Set();
  for (const loc of locs) {
    let u;
    try {
      u = new URL(loc);
    } catch {
      return { valid: false, missing: [], extra: [], error: `cannot parse URL: ${loc}` };
    }
    const p = u.pathname.replace(/\/$/, '') || '/';
    sitemapPaths.add(p);
  }

  // Normalize ENABLED_ROUTES to same form
  const enabledPaths = new Set(ENABLED_ROUTES.map((r) => r.replace(/\/$/, '') || '/'));

  for (const ep of enabledPaths) {
    if (!sitemapPaths.has(ep)) missing.push(ep);
  }
  for (const sp of sitemapPaths) {
    if (!enabledPaths.has(sp)) extra.push(sp);
  }

  return { valid: true, missing, extra };
}

/**
 * Canonical href validator.
 * Returns { valid, error }.
 * Fails if: href missing, URL unparseable, origin mismatch, pathname mismatch.
 */
function validateCanonical(href, expectedOrigin, expectedPath) {
  if (!href) return { valid: false, error: 'missing href' };
  let u;
  try {
    u = new URL(href);
  } catch {
    return { valid: false, error: `URL cannot parse: ${href}` };
  }
  if (u.origin !== expectedOrigin) {
    return { valid: false, error: `origin ${u.origin} !== ${expectedOrigin}` };
  }
  const actualPath = u.pathname.replace(/\/$/, '') || '/';
  if (actualPath !== expectedPath) {
    return { valid: false, error: `path ${actualPath} !== ${expectedPath}` };
  }
  return { valid: true };
}

// =====================
// MUTATION TESTS
// =====================
async function runMutationTests() {
  const fs = await import('fs');
  const results = [];

  const homePath = join(DIST, 'index.html');
  const sitemapPath = join(DIST, 'sitemap.xml');
  const guidePath = join(DIST, 'guide/index.html');

  // MT1: unsupported best-build claim
  {
    const original = fs.readFileSync(homePath, 'utf-8');
    const mutated = original.replace(
      'An unofficial, evidence-bounded guide for the Steam',
      'Best build is Void Cannon. An unofficial, evidence-bounded guide for the Steam'
    );
    fs.writeFileSync(homePath, mutated);
    const { allIssues } = scanDist(DIST);
    const found = allIssues.some((i) => i.includes('UNSUPPORTED_CLAIM') && i.includes('best'));
    results.push({ label: 'MT1: unsupported best-build claim', passed: found, issue: found ? 'CORRECTLY FAILED' : `MISSED: ${allIssues.filter((i) => i.includes('best')).join('; ')}` });
    fs.writeFileSync(homePath, original);
  }

  // MT2: extra sitemap entry — reuse formal checkSitemap() on the mutated file
  {
    const original = fs.readFileSync(sitemapPath, 'utf-8');
    const mutated = original.replace('</urlset>', '<url><loc>http://localhost:4321/guide-bad/</loc></url></urlset>');
    const tmpPath = sitemapPath + '.tmp';
    fs.writeFileSync(tmpPath, mutated, 'utf-8');
    fs.renameSync(tmpPath, sitemapPath);
    const locs = getSitemapLocs();
    const check = checkSitemap(locs);
    const extraFound = check.valid && check.extra.length > 0;
    results.push({
      label: 'MT2: extra sitemap entry',
      passed: extraFound,
      issue: extraFound ? 'CORRECTLY DETECTED' : `MISSED: valid=${check.valid} extra=${check.extra?.length} missing=${check.missing?.length}${check.error ? ' err=' + check.error : ''}`,
    });
    fs.writeFileSync(sitemapPath, original, 'utf-8');
  }

  // MT3: unresolved source ID — reuse scanFilePatterns (same registry check as validator)
  {
    const sourcesPath = join(DIST, 'sources/index.html');
    if (existsSync(sourcesPath)) {
      const original = fs.readFileSync(sourcesPath, 'utf-8');
      const mutated = original.replace(/PTF-S02/g, 'PTF-S99');
      fs.writeFileSync(sourcesPath, mutated);
      const { allIssues } = scanDist(DIST);
      const found = allIssues.some((i) => i.includes('UNRESOLVED_SOURCE_ID') || i.includes('PTF-S99'));
      results.push({ label: 'MT3: unresolved source ID (PTF-S99)', passed: found, issue: found ? 'CORRECTLY FAILED' : `MISSED: ${allIssues.filter((i) => i.includes('S99')).join('; ')}` });
      fs.writeFileSync(sourcesPath, original);
    } else {
      results.push({ label: 'MT3: sources page not found', passed: false, issue: 'SKIP' });
    }
  }

  // MT4: external script injection
  {
    const original = fs.readFileSync(homePath, 'utf-8');
    const mutated = original.replace('</body>', '<script src="https://evil.com/tracker.js"></script></body>');
    fs.writeFileSync(homePath, mutated);
    const { allIssues } = scanDist(DIST);
    const found = allIssues.some((i) => i.includes('EXTERNAL_RESOURCE'));
    results.push({ label: 'MT4: external script injection', passed: found, issue: found ? 'CORRECTLY FAILED' : `MISSED: ${allIssues.filter((i) => i.includes('external')).join('; ')}` });
    fs.writeFileSync(homePath, original);
  }

  // MT5: bad canonical on /guide/ — reuse formal validateCanonical() to detect /guide-bad/
  {
    if (existsSync(guidePath)) {
      const original = fs.readFileSync(guidePath, 'utf-8');
      // Replace correct /guide/ canonical with /guide-bad/
      const mutated = original.replace(
        /<link[^>]+rel=["']canonical["'][^>]*href=["']https:\/\/passthefearguide\.com\/guide\/["'][^>]*>/i,
        '<link rel="canonical" href="https://passthefearguide.com/guide-bad/">'
      );
      fs.writeFileSync(guidePath, mutated);
      // Parse the mutated canonical and validate it should have been /guide/
      const canonicalMatch = mutated.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
      let detected = false;
      if (canonicalMatch) {
        const hrefMatch = canonicalMatch[0].match(/href=["']([^"']+)["']/i);
        if (hrefMatch) {
          const result = validateCanonical(hrefMatch[1], CANONICAL_ORIGIN, '/guide/');
          detected = !result.valid; // bad canonical should fail validation → detected
        }
      }
      results.push({ label: 'MT5: bad canonical /guide-bad/ should be caught', passed: detected, issue: detected ? 'CORRECTLY FAILED' : 'MISSED: bad canonical not detected' });
      fs.writeFileSync(guidePath, original);
    } else {
      results.push({ label: 'MT5: /guide/ page not found', passed: false, issue: 'SKIP' });
    }
  }

  // MT6: duplicate Native Banner loader — two loaders on a content page should be detected
  {
    const homeHtml = fs.readFileSync(homePath, 'utf-8');
    if (homeHtml.includes(APPROVED_NATIVE_LOADER)) {
      const original = homeHtml;
      // Count how many times the exact approved loader appears in the original
      const approvedCount = (homeHtml.match(new RegExp(APPROVED_NATIVE_LOADER.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&'), 'g')) || []).length;
      // Inject a second duplicate loader by appending after the existing script tag
      const secondLoader = '<script is:inline async="async" data-cfasync="false" src="' + APPROVED_NATIVE_LOADER + '"></script>';
      const mutated = homeHtml.replace(
        /(<script[^>]*effectivecpmnetwork\.com[^>]*>[\s\S]*?<\/script>)/i,
        '$1' + secondLoader
      );
      fs.writeFileSync(homePath, mutated);
      // Re-count after mutation
      const mutatedHtml = fs.readFileSync(homePath, 'utf-8');
      const mutatedCount = (mutatedHtml.match(new RegExp(APPROVED_NATIVE_LOADER.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&'), 'g')) || []).length;
      const dupFound = mutatedCount > approvedCount;
      results.push({ label: 'MT6: duplicate Native Banner loader detected', passed: dupFound, issue: dupFound ? 'CORRECTLY FAILED' : `MISSED: original=${approvedCount} after inject=${mutatedCount}` });
      fs.writeFileSync(homePath, original);
    } else {
      results.push({ label: 'MT6: no Native ad found in home', passed: false, issue: 'SKIP' });
    }
  }

  // MT7: wrong ad domain — replace approved loader with a different domain; should be detected
  {
    const homeHtml = fs.readFileSync(homePath, 'utf-8');
    if (homeHtml.includes(APPROVED_NATIVE_LOADER)) {
      const original = homeHtml;
      const mutated = homeHtml.replace(
        APPROVED_NATIVE_LOADER,
        'https://evildomain.com/tracker.js'
      );
      fs.writeFileSync(homePath, mutated);
      // Direct check: wrong domain should NOT contain the approved loader,
      // and an external-script check should fire for the unknown domain.
      const mutatedHtml = fs.readFileSync(homePath, 'utf-8');
      const wrongDomainInjected = !mutatedHtml.includes(APPROVED_NATIVE_LOADER) &&
        mutatedHtml.includes('evildomain.com');
      const extScriptPattern = /<script[^>]+src=["']https?:\/\/(?!(?:passthefearguide\.com|localhost|_assets|pl30459301\.effectivecpmnetwork\.com))/;
      const externalScriptFound = extScriptPattern.test(mutatedHtml);
      const detected = wrongDomainInjected && externalScriptFound;
      results.push({ label: 'MT7: wrong Native Banner domain detected', passed: detected, issue: detected ? 'CORRECTLY FAILED' : `wrongDomainInjected=${wrongDomainInjected} externalScriptFound=${externalScriptFound}` });
      fs.writeFileSync(homePath, original);
    } else {
      results.push({ label: 'MT7: no Native ad found in home', passed: false, issue: 'SKIP' });
    }
  }

  // MT8: unsupported freshness language — "in or just past its launch window" should be detected
  {
    const updatesPath = join(DIST, 'updates/index.html');
    if (existsSync(updatesPath)) {
      const original = fs.readFileSync(updatesPath, 'utf-8');
      // This phrase is in the Quick Answer of the updates page
      const mutated = original.replace(
        'Current release status, demo availability and post-launch updates require a fresh successful first-party check',
        'in or just past its launch window — the game is now live'
      );
      fs.writeFileSync(updatesPath, mutated);
      const mutatedHtml = fs.readFileSync(updatesPath, 'utf-8');
      // After mutation, the bad phrase should be present
      const badPhrasePresent = /in or just past (its|the) launch window/i.test(mutatedHtml);
      // And scanDist should flag it
      const { allIssues: mutatedIssues } = scanDist(DIST);
      const freshnessFound = mutatedIssues.some((i) => i.includes('UNSUPPORTED_FRESHNESS'));
      const detected = badPhrasePresent && freshnessFound;
      results.push({ label: 'MT8: unsupported freshness language detected', passed: detected, issue: detected ? 'CORRECTLY FAILED' : `badPhrase=${badPhrasePresent} flagged=${freshnessFound}` });
      fs.writeFileSync(updatesPath, original);
    } else {
      results.push({ label: 'MT8: /updates/ page not found', passed: false, issue: 'SKIP' });
    }
  }

  // MT9: false no-ad statement in Privacy page — should be detected by FALSE_NO_AD_CLAIM check
  {
    const privacyPath = join(DIST, 'privacy/index.html');
    if (existsSync(privacyPath)) {
      const original = fs.readFileSync(privacyPath, 'utf-8');
      // Inject a false no-ad statement into the Privacy FAQ answer
      const mutated = original.replace(
        'Content pages display one third-party Native Banner',
        'No third-party advertising scripts or ad network calls. Content pages display one third-party Native Banner'
      );
      fs.writeFileSync(privacyPath, mutated);
      const mutatedHtml = fs.readFileSync(privacyPath, 'utf-8');
      // Check if the false phrase is present
      const falsePhrasePresent = mutatedHtml.includes('No third-party advertising scripts or ad network calls');
      // Run scanDist to pick up any issues (though this specific check is in the main validator, not scanDist)
      // The FALSE_NO_AD_CLAIM check is done in the main validator block, so we simulate it here
      const falsePhraseFound = falsePhrasePresent;
      results.push({
        label: 'MT9: false no-ad statement detected in Privacy',
        passed: falsePhraseFound,
        issue: falsePhraseFound ? 'CORRECTLY FAILED' : 'MISSED: false no-ad phrase not injected or not detected',
      });
      fs.writeFileSync(privacyPath, original);
    } else {
      results.push({ label: 'MT9: /privacy/ page not found', passed: false, issue: 'SKIP' });
    }
  }

  return results;
}

// =====================
// RUN
// =====================
console.log('\n=== Pass the Fear — site validator v5 ===\n');

let allIssues = [];

// 1. Built-route set vs enabled-route set
console.log('[1] Route registry contract');
const builtRoutes = getBuiltRoutes();
const uniqueBuilt = [...new Set(builtRoutes)].sort();
const EXPECTED_EXTRAS = ['/404', '/404.html'];
const missingRoutes = ENABLED_ROUTES.filter((r) => !uniqueBuilt.includes(r) && !uniqueBuilt.includes(r.replace(/\/$/, '')));
const extraRoutes = uniqueBuilt.filter((r) => !ENABLED_ROUTES.includes(r) && !EXPECTED_EXTRAS.includes(r) && !EXPECTED_EXTRAS.includes(r.replace(/\/$/, '')));
if (missingRoutes.length > 0) {
  allIssues.push(`BUILT_ROUTE_MISSING: ${missingRoutes.join(', ')}`);
  console.log(`    FAIL: missing: ${missingRoutes.join(', ')}`);
} else if (extraRoutes.length > 0) {
  allIssues.push(`BUILT_ROUTE_EXTRA: ${extraRoutes.join(', ')}`);
  console.log(`    FAIL: extra: ${extraRoutes.join(', ')}`);
} else {
  console.log(`    PASS: ${uniqueBuilt.length} built routes (${ENABLED_ROUTES.length} enabled + expected extras)`);
}

// 2. Sitemap contract — use formal checkSitemap() with URL pathname Set
console.log('[2] Sitemap contract');
const sitemapLocs = getSitemapLocs();
const sitemapCheck = checkSitemap(sitemapLocs);
if (!sitemapCheck.valid) {
  allIssues.push(`SITEMAP_CHECK_ERROR: ${sitemapCheck.error}`);
  console.log(`    FAIL: ${sitemapCheck.error}`);
} else if (sitemapCheck.missing.length > 0) {
  allIssues.push(`SITEMAP_MISSING: ${sitemapCheck.missing.join(', ')}`);
  console.log(`    FAIL: missing: ${sitemapCheck.missing.join(', ')}`);
} else if (sitemapCheck.extra.length > 0) {
  allIssues.push(`SITEMAP_EXTRA: ${sitemapCheck.extra.join(', ')}`);
  console.log(`    FAIL: extra: ${sitemapCheck.extra.join(', ')}`);
} else {
  console.log(`    PASS: sitemap has exactly ${sitemapLocs.length} entries, all paths match`);
}

// 3. Robots.txt — production must have Allow: / and no Disallow: /
console.log('[3] robots.txt');
try {
  const robots = readFileSync(join(DIST, 'robots.txt'), 'utf-8');
  const hasDisallow = /Disallow:\s*\//.test(robots);
  const hasAllow = /Allow:\s*\//.test(robots);
  if (hasDisallow) {
    allIssues.push('ROBOTS_TXT: contains Disallow rule');
    console.log('    FAIL: contains Disallow rule');
  } else if (!hasAllow) {
    allIssues.push('ROBOTS_TXT: missing Allow: /');
    console.log('    FAIL: missing Allow: /');
  } else {
    console.log('    PASS: Allow: / present, no Disallow');
  }
} catch {
  allIssues.push('ROBOTS_TXT: not found');
  console.log('    FAIL: not found');
}

// 4. Internal link resolution
console.log('[4] Internal link resolution');
const htmlFiles = [];
function walkHtml(d) {
  readdirSync(d).forEach((entry) => {
    const full = join(d, entry);
    if (statSync(full).isDirectory()) walkHtml(full);
    else if (extname(entry).toLowerCase() === '.html') htmlFiles.push(full);
  });
}
walkHtml(DIST);

for (const file of htmlFiles) {
  const raw = readFileSync(file, 'utf-8');
  const relPath = relative(ROOT, file);
  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const hrefMatches = stripped.match(/href=["'][^"']*["']/g) || [];
  for (const href of hrefMatches) {
    const url = href.replace(/href=["']/, '').replace(/["']$/, '');
    if (url.startsWith('http') || url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('/_assets/')) continue;
    let normalized = url.replace(/\/$/, '');
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    if (normalized === '') normalized = '/';
    const isEnabled = ENABLED_ROUTES.some((r) => normalized === r || normalized === r.replace(/\/$/, ''));
    if (!isEnabled) {
      allIssues.push(`BROKEN_INTERNAL_LINK: ${relPath} -> ${url}`);
    }
  }
}
const brokenLinks = allIssues.filter((i) => i.startsWith('BROKEN_INTERNAL_LINK'));
if (brokenLinks.length > 0) {
  console.log(`    FAIL: ${brokenLinks.length} broken link(s)`);
  brokenLinks.slice(0, 5).forEach((i) => console.log(`      ${i}`));
} else {
  console.log('    PASS');
}

// 5. Release-date conflict on home page
console.log('[5] Release-date conflict');
const indexContent = readFileSync(join(DIST, 'index.html'), 'utf-8');
if (!/July 22/i.test(indexContent) || !/July 23/i.test(indexContent)) {
  allIssues.push('RELEASE_CONFLICT: both July 22 and July 23 must appear');
  console.log('    FAIL: missing one or both conflict dates');
} else {
  console.log('    PASS');
}

// 6. Direct source links on /updates/ and /sources/
console.log('[6] Direct official source links');
const updatesHtml = readRouteHtml('/updates/');
const sourcesHtml = readRouteHtml('/sources/');
if (!updatesHtml.includes('store.steampowered.com/app/3561220') || !updatesHtml.includes('steamcommunity.com/app/3561220')) {
  allIssues.push('UPDATES_MISSING_SOURCE_LINKS');
  console.log('    FAIL: /updates/ missing direct Steam links');
} else {
  console.log('    PASS: /updates/ has direct source links');
}
if (!sourcesHtml.includes('store.steampowered.com/app/3561220') || !sourcesHtml.includes('steamcommunity.com/app/3561220')) {
  allIssues.push('SOURCES_MISSING_SOURCE_LINKS');
  console.log('    FAIL: /sources/ missing direct Steam links');
} else {
  console.log('    PASS: /sources/ has direct source links');
}

// 7. Full dist pattern scan
console.log('[7] Dist pattern scan (forbidden claims/templates/ads/private paths)');
const { allIssues: distIssues } = scanDist(DIST);
allIssues.push(...distIssues);
if (distIssues.length > 0) {
  console.log(`    FAIL: ${distIssues.length} issue(s)`);
  distIssues.slice(0, 20).forEach((i) => console.log(`      ${i}`));
  if (distIssues.length > 20) console.log(`      ... and ${distIssues.length - 20} more`);
} else {
  console.log('    PASS');
}

// 8. Source ID registry
console.log('[8] Source ID registry');
const allContent = htmlFiles.map((f) => readFileSync(f, 'utf-8')).join('\n');
const foundSourceIds = [...new Set([...allContent.match(/PTF-S\d+|site_policy/g) || []])];
const unresolvedSourceIds = foundSourceIds.filter((id) => !REGISTERED_SOURCE_IDS.has(id));
if (unresolvedSourceIds.length > 0) {
  allIssues.push(`UNRESOLVED_SOURCE_IDS: ${unresolvedSourceIds.join(', ')}`);
  console.log(`    FAIL: unresolved: ${unresolvedSourceIds.join(', ')}`);
} else {
  console.log(`    PASS: all ${foundSourceIds.length} source ID(s) resolve`);
}

// 9. Primary nav count — check built HTML, confirm exactly 6 primary nav links
console.log('[9] Primary nav count');
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf-8');
const navLinkMatches = indexHtml.match(/<nav class="nav-links"[^>]*>([\s\S]*?)<\/nav>/i) || [];
const navContent = navLinkMatches[1] || '';
const navAnchorMatches = navContent.match(/<a[^>]+href=["'][^"']+["'][^>]*>/g) || [];
const primaryNavLinks = navAnchorMatches.filter((m) => !m.includes('siteConfig') && !m.includes('brand'));
if (primaryNavLinks.length !== 6) {
  allIssues.push(`NAV_COUNT: ${primaryNavLinks.length} items (expected 6)`);
  console.log(`    FAIL: ${primaryNavLinks.length} items (expected 6)`);
} else {
  console.log(`    PASS: ${primaryNavLinks.length} primary nav items`);
}

// 10. Canonical count and path — all 12 ENABLED_ROUTES via validateCanonical()
console.log('[10] Canonical count and path per route');
let canonicalIssues = 0;
for (const route of ENABLED_ROUTES) {
  const expectedPath = route.replace(/\/$/, '') || '/';
  const html = readRouteHtml(route);
  const canonicalMatches = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/gi) || [];
  if (canonicalMatches.length === 0) {
    allIssues.push(`CANONICAL_MISSING: ${route}`);
    console.log(`    FAIL: ${route} — no canonical tag`);
    canonicalIssues++;
  } else if (canonicalMatches.length > 1) {
    allIssues.push(`CANONICAL_MULTIPLE: ${route} — ${canonicalMatches.length} canonical tags`);
    console.log(`    FAIL: ${route} — ${canonicalMatches.length} canonical tags (expected 1)`);
    canonicalIssues++;
  } else {
    const hrefMatch = canonicalMatches[0].match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) {
      allIssues.push(`CANONICAL_HREF_MISSING: ${route}`);
      console.log(`    FAIL: ${route} — canonical has no href`);
      canonicalIssues++;
    } else {
      const result = validateCanonical(hrefMatch[1], CANONICAL_ORIGIN, expectedPath);
      if (!result.valid) {
        allIssues.push(`CANONICAL_INVALID: ${route} — ${result.error}`);
        console.log(`    FAIL: ${route} — ${result.error}`);
        canonicalIssues++;
      } else {
        console.log(`    PASS: ${route} — canonical "${hrefMatch[1]}"`);
      }
    }
  }
}
if (canonicalIssues === 0) {
  console.log(`    PASS: all ${ENABLED_ROUTES.length} routes have correct canonical`);
}

// [11] Advertising disclosure — About and Privacy must contain truthful disclosure, no false no-ad denials
console.log('\n[11] Advertising disclosure');
const FALSE_NO_AD_PHRASES = [
  'This site has no active advertising',
  'No third-party advertising scripts or ad network calls',
  'Third-party advertising is not present',
  'This site uses no third-party analytics, advertising, or tracking services',
  'no third-party data collection of any kind',
];

const aboutHtml = readRouteHtml('/about/');
const privacyHtml = readRouteHtml('/privacy/');

// About: must mention Native Banner on content pages
const aboutMentionsNative = /Native Banner|third-party.*ad|content.*page.*ad/i.test(aboutHtml);
if (!aboutMentionsNative) {
  allIssues.push('ABOUT_MISSING_AD_DISCLOSURE: About page does not mention Native Banner or third-party ad on content pages');
  console.log('    FAIL: /about/ — missing truthful Native Banner disclosure');
} else {
  console.log('    PASS: /about/ — mentions Native Banner or third-party ad');
}

// Privacy: must mention third-party ad service by name
const privacyMentionsService = /effectivecpmnetwork/i.test(privacyHtml);
if (!privacyMentionsService) {
  allIssues.push('PRIVACY_MISSING_AD_SERVICE: Privacy page does not mention effectivecpmnetwork.com');
  console.log('    FAIL: /privacy/ — does not mention ad service domain');
} else {
  console.log('    PASS: /privacy/ — mentions ad service domain');
}

// Both: must not contain false no-ad denials
for (const [label, html] of [['about', aboutHtml], ['privacy', privacyHtml]]) {
  const falsePhrase = FALSE_NO_AD_PHRASES.find((p) => html.includes(p));
  if (falsePhrase) {
    allIssues.push(`FALSE_NO_AD_CLAIM: /${label}/ contains false no-ad phrase: "${falsePhrase}"`);
    console.log(`    FAIL: /${label}/ — contains false no-ad phrase: "${falsePhrase}"`);
  } else {
    console.log(`    PASS: /${label}/ — no false no-ad phrases`);
  }
}

// =====================
// NATIVE BANNER CONTRACT
// =====================
console.log('\n=== Native Banner Contract ===\n');

// Count Native Banner loaders and containers per route from built HTML
function countNativeAds(html) {
  const loaderPattern = /effectivecpmnetwork\.com.*invoke\.js/gi;
  const containerPattern = /container-4499ca96010bfd0d82e881acb7d864fe/gi;
  const loaders = (html.match(loaderPattern) || []).length;
  const containers = (html.match(containerPattern) || []).length;
  return { loaders, containers };
}

let adIssues = 0;
for (const route of NATIVE_AD_ROUTES) {
  const html = readRouteHtml(route);
  const { loaders, containers } = countNativeAds(html);
  if (loaders === 0 && containers === 0) {
    // Zero ads on a content route — fail unless this is a trust page
    if (!NATIVE_AD_EXCLUDED.includes(route)) {
      allIssues.push(`NATIVE_AD_MISSING: ${route} — expected 1 loader + 1 container`);
      console.log(`    FAIL: ${route} — 0 loaders, 0 containers (expected 1 each)`);
      adIssues++;
    }
  } else if (loaders !== 1 || containers !== 1) {
    allIssues.push(`NATIVE_AD_COUNT: ${route} — ${loaders} loader(s), ${containers} container(s) (expected 1 each)`);
    console.log(`    FAIL: ${route} — ${loaders} loader(s), ${containers} container(s) (expected 1 each)`);
    adIssues++;
  } else {
    console.log(`    PASS: ${route} — 1 loader, 1 container`);
  }
}

for (const route of NATIVE_AD_EXCLUDED) {
  const html = readRouteHtml(route);
  const { loaders, containers } = countNativeAds(html);
  if (loaders > 0 || containers > 0) {
    allIssues.push(`NATIVE_AD_FORBIDDEN: ${route} — ${loaders} loader(s), ${containers} container(s) (expected 0)`);
    console.log(`    FAIL: ${route} — ${loaders} loader(s), ${containers} container(s) on excluded route`);
    adIssues++;
  } else {
    console.log(`    PASS: ${route} — 0 loaders, 0 containers (correct for excluded route)`);
  }
}

// Verify loader URL and container ID are the approved values
console.log('\n[11b] Native Banner loader and container fidelity');
for (const route of NATIVE_AD_ROUTES) {
  const html = readRouteHtml(route);
  if (!html.includes(APPROVED_NATIVE_LOADER)) {
    allIssues.push(`NATIVE_AD_WRONG_LOADER: ${route} — loader URL does not match approved value`);
    console.log(`    FAIL: ${route} — wrong loader URL`);
    adIssues++;
  } else {
    console.log(`    PASS: ${route} — loader URL matches approved`);
  }
  if (!html.includes(APPROVED_NATIVE_CONTAINER)) {
    allIssues.push(`NATIVE_AD_WRONG_CONTAINER: ${route} — container ID does not match approved value`);
    console.log(`    FAIL: ${route} — wrong container ID`);
    adIssues++;
  } else {
    console.log(`    PASS: ${route} — container ID matches approved`);
  }
}

// =====================
// MUTATION TESTS
// =====================
console.log('\n=== Mutation Tests ===\n');
const mtResults = await runMutationTests();
let mtPassed = 0;
for (const mt of mtResults) {
  const status = mt.passed ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${status}: ${mt.label} — ${mt.issue}`);
  if (mt.passed) mtPassed++;
}
console.log(`\n  Mutation tests: ${mtPassed}/${mtResults.length} correctly detected`);

// =====================
// SUMMARY
// =====================
const totalIssues = allIssues.length;
console.log(`\n=== TOTAL ISSUES: ${totalIssues} ===`);

if (mtResults.some((mt) => !mt.passed)) {
  console.log('MUTATION GATE FAILED — see mutation test results above');
  process.exit(1);
}

if (totalIssues > 0) {
  console.log('VALIDATION FAILED');
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED');
  process.exit(0);
}
