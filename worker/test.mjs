// Local verification for the bangersandmash-v2 Worker (offline: no origin
// fetch — only Worker-rendered routes are exercised; unknown paths proxy to
// bangersandmash.pages.dev and are not tested here).
import worker from './worker.js';

const checks = [];
const check = (name, ok) => { checks.push([name, ok]); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); };

const res = await worker.fetch(new Request('https://bangersandmash.uk/'));
const html = await res.text();
const csp = res.headers.get('content-security-policy') ?? '';

check('home renders 200', res.status === 200);
check('references same-origin /ga4.js bootstrap', html.includes('<script src="/ga4.js"></script>'));
check('references per-site gtag loader', html.includes('gtag/js?id=G-BHGK3T9M5L'));
check('no inline gtag bootstrap remains', !html.includes('function gtag(){dataLayer.push(arguments);}</script>'));
check('exactly one </head> and one <body>', (html.match(/<\/head>/g) ?? []).length === 1 && (html.match(/<body>/g) ?? []).length === 1);
check('CSP allows googletagmanager scripts', /script-src [^;]*googletagmanager\.com/.test(csp) && !csp.includes("script-src 'none'"));
check('CSP allows GA collect endpoints', /connect-src [^;]*google-analytics\.com/.test(csp));
check('CSP still denies everything else by default', csp.includes("default-src 'self'"));

const js = await worker.fetch(new Request('https://bangersandmash.uk/ga4.js'));
const jsBody = await js.text();
check('/ga4.js serves bootstrap with per-site ID', js.status === 200 && jsBody.includes("gtag('config','G-BHGK3T9M5L')"));
check('/ga4.js serves bootstrap with roll-up ID', jsBody.includes("gtag('config','G-Z389F0DBM8W')"));
check('/ga4.js is javascript + cacheable', (js.headers.get('content-type') ?? '').includes('javascript') && /max-age=\d+/.test(js.headers.get('cache-control') ?? ''));

check('home links to the combined notice', /<footer[\s\S]*?href="\/privacy"/.test(html));
for (const path of ['/privacy/', '/cookies', '/cookies/']) {
  const response = await worker.fetch(new Request('https://bangersandmash.uk' + path + '?via=footer'));
  check(path + ' redirects to the existing combined notice and preserves the query',
    response.status === 302 && response.headers.get('Location') === 'https://bangersandmash.uk/privacy?via=footer');
}

// A canonical notice and its root-relative assets must still reach Pages.
const realFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url) => new Response(String(url));
  for (const path of ['/privacy', '/assets/notice.js']) {
    const response = await worker.fetch(new Request('https://bangersandmash.uk' + path));
    check(path + ' still reaches the existing fallback', response.status === 200 &&
      await response.text() === 'https://bangersandmash.pages.dev' + path);
  }
} finally {
  globalThis.fetch = realFetch;
}

const robots = await worker.fetch(new Request('https://bangersandmash.uk/robots.txt'));
check('robots.txt unaffected', robots.status === 200 && (await robots.text()).includes('Sitemap:'));

// These paths are rendered by the Worker, not the Pages fallback. The 404
// must be an HTTP status, not a header named "status" on a 200 response.
for (const path of ['/recipe/__missing__', '/collections/__missing__', '/terms', '/terms/', '/affiliate-disclosure', '/affiliate-disclosure/', '/contact', '/advertising']) {
  const missing = await worker.fetch(new Request('https://bangersandmash.uk' + path));
  check(path + ' returns a real 404', missing.status === 404);
  check(path + ' preserves security headers without a status header',
    missing.headers.get('content-security-policy') === csp && !missing.headers.has('status'));
  check(path + ' renders the not-found page', (await missing.text()).includes('<h1>Not found</h1>'));
}

// ---- Pilot packet route: /recipe/roast-beef-yorkshire ---------------------
const pilot = await worker.fetch(new Request('https://bangersandmash.uk/recipe/roast-beef-yorkshire'));
const pilotHtml = await pilot.text();
check('pilot packet route renders 200', pilot.status === 200);
check('pilot: exactly one content container', (pilotHtml.match(/data-rpc="content"/g) ?? []).length === 1);
check('pilot: jump bar sits before the recipe card', pilotHtml.indexOf('data-block="jump-bar"') >= 0 && pilotHtml.indexOf('data-block="jump-bar"') < pilotHtml.indexOf('id="rpc-card"'));
check('pilot: card uses the shared .rpc-card selector', /class="rpc-card"/.test(pilotHtml));
check('pilot: no unmapped placeholder images remain', !pilotHtml.includes('src="/assets/recipes/"'));
check('pilot: no orphaned tag fragments in shot figures', !/data-shot="[^"]*">[^<]*width="/.test(pilotHtml) && !/data-block="[^"]*"[^>]*>\s*width="/.test(pilotHtml));
check('pilot: hero serves the real recovered photograph', pilotHtml.includes('src="/images/recipes/roast-beef-yorkshire.webp"'));
check('pilot: real hero referenced exactly twice (hero + card)', (pilotHtml.match(/src="\/images\/recipes\/roast-beef-yorkshire\.webp"/g) ?? []).length === 2);
const printJs = await worker.fetch(new Request('https://bangersandmash.uk/rpc-pilot.js'));
check('pilot: print handler served same-origin with correct type', printJs.status === 200 && (printJs.headers.get('content-type') ?? '').includes('javascript') && (await printJs.text()).includes('window.print()'));
check('pilot: print script referenced by the page', pilotHtml.includes('<script src="/rpc-pilot.js" defer></script>'));
check('pilot: at least 14 contract blocks rendered', (pilotHtml.match(/data-block="/g) ?? []).length >= 14);
const ldBlocks = pilotHtml.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) ?? [];
const pilotLd = ldBlocks.length ? JSON.parse(ldBlocks[ldBlocks.length - 1].replace(/^<[^>]+>/, '').replace(/<\/script>$/, '')) : null;
check('pilot: Recipe JSON-LD present and typed', !!pilotLd && pilotLd['@type'] === 'Recipe' && pilotLd.name.includes('Roast Beef'));
check('pilot: JSON-LD image is the real hero, absolute', !!pilotLd && Array.isArray(pilotLd.image) && pilotLd.image[0] === 'https://bangersandmash.uk/images/recipes/roast-beef-yorkshire.webp');
check('pilot: no aggregateRating shipped', !!pilotLd && pilotLd.aggregateRating === undefined);
check('pilot: every block is a direct child of the one container', (() => {
  // after the container open tag, the next tag must carry data-block
  const open = pilotHtml.indexOf('<article class="rpc-container"');
  if (open < 0) return false;
  let ok = true;
  const re = /<article class="rpc-container"[^>]*>\s*<([a-z]+)/g;
  re.lastIndex = open; const m = re.exec(pilotHtml);
  return !!m;
})());

check('pilot: no orphaned shot-slot spec captions', !/<figure data-shot="[^"]*"><figcaption>/.test(pilotHtml) && !/must match the card/i.test(pilotHtml));
check('pilot: step figures survived cleanup', /<figure data-block="step"/.test(pilotHtml));

// The lamb is pierced and stuffed, so ensure the serving route and recipe
// structured data both give a measured fully cooked endpoint rather than a
// time-only pink target. This does not assert that the recipe was kitchen tested.
const lamb = await worker.fetch(new Request('https://bangersandmash.uk/recipe/roast-lamb-mint'));
const lambHtml = await lamb.text();
const lambScript = lambHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
const lambLd = lambScript ? JSON.parse(lambScript[1]) : null;
const lambInstructions = (lambLd?.recipeInstructions ?? []).map(s => s.text).join(' ');
const measured = /thickest part of the lamb holds at least 70°C for 2 minutes/;
check('lamb route renders successfully', lamb.status === 200);
check('lamb rendered method has the measured endpoint', measured.test(lambHtml.split('<script type="application/ld+json">').pop()));
check('lamb Recipe JSON-LD has the same endpoint', measured.test(lambInstructions));
check('lamb instructions do not promote a time-only pink endpoint', !/20 minutes per 500g for pink|roasted to a blush/i.test(lambHtml));
check('lamb page marks untested cook and total time as variable', /<dt>Cook<\/dt><dd>Varies<\/dd>/.test(lambHtml) && /<dt>Total<\/dt><dd>Varies<\/dd>/.test(lambHtml));
check('lamb structured data omits untested cook and total times', lambLd && !('cookTime' in lambLd) && !('totalTime' in lambLd));
const listing = await (await worker.fetch(new Request('https://bangersandmash.uk/collections/roasts'))).text();
check('lamb listing does not show the former untested total', /roast-lamb-mint[\s\S]{0,1800}Varies total/.test(listing));
const chicken = await (await worker.fetch(new Request('https://bangersandmash.uk/recipe/roast-chicken-bread-sauce'))).text();
check('other recipe timing labels still show numeric times', /<dt>Cook<\/dt><dd>\d+ min<\/dd>/.test(chicken));

const failed = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
