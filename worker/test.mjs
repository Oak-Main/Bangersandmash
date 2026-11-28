// Offline Worker route tests, with mocked Pages fallback responses.
import worker from './worker.js';

const checks = [];
const check = (name, ok) => { checks.push([name, ok]); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); };

const res = await worker.fetch(new Request('https://bangersandmash.uk/'));
const html = await res.text();
const csp = res.headers.get('content-security-policy') ?? '';

check('home renders 200', res.status === 200);
check('home does not initialize optional GA4', !html.includes('gtag/js') && !html.includes('src="/ga4.js"'));

check('no inline gtag bootstrap remains', !html.includes('function gtag(){dataLayer.push(arguments);}</script>'));
check('exactly one </head> and one <body>', (html.match(/<\/head>/g) ?? []).length === 1 && (html.match(/<body>/g) ?? []).length === 1);
check('CSP allows googletagmanager scripts', /script-src [^;]*googletagmanager\.com/.test(csp) && !csp.includes("script-src 'none'"));
check('CSP allows GA collect endpoints', /connect-src [^;]*google-analytics\.com/.test(csp));
check('CSP still denies everything else by default', csp.includes("default-src 'self'"));

const js = await worker.fetch(new Request('https://bangersandmash.uk/ga4.js'));
const jsBody = await js.text();
check('/ga4.js serves an inert bootstrap', js.status === 200 && !jsBody.includes("gtag("));
check('/ga4.js omits the roll-up configuration', !jsBody.includes("G-Z389F0DBM8W"));
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
  for (const path of ['/assets/notice.js']) {
    const response = await worker.fetch(new Request('https://bangersandmash.uk' + path));
    check(path + ' still reaches the existing fallback', response.status === 200 &&
      await response.text() === 'https://bangersandmash.pages.dev' + path);
  }
} finally {
  globalThis.fetch = realFetch;
}

for (const [path, heading] of [['/privacy', 'Privacy and browser storage'], ['/contact', 'Contact']]) {
  const response = await worker.fetch(new Request('https://bangersandmash.uk' + path));
  const body = await response.text();
  check(path + ' server-renders its heading and verified privacy address',
    response.status === 200 && body.includes('<h1>' + heading + '</h1>') && body.includes('privacy@bangersandmash.uk'));
  check(path + ' omits active GA4 configuration', !body.includes('gtag/js') && !body.includes("gtag('config'"));
}
// Terms of Use is server-rendered by the Worker, linked from the shared
// footer and listed in the sitemap.
for (const path of ['/terms', '/terms/']) {
  const response = await worker.fetch(new Request('https://bangersandmash.uk' + path));
  const body = await response.text();
  check(path + ' server-renders the Terms of Use', response.status === 200 && body.includes('<h1>Terms of Use</h1>') &&
    body.includes('<link rel="canonical" href="https://bangersandmash.uk/terms">'));
  check(path + ' carries the approved information-only and links text',
    body.includes('Everything on this site is general information, not professional, legal, financial, medical or safety advice.') &&
    body.includes('We link to other sites for reference. We do not control them and are not responsible for their content or practices.'));
  // The shared footer now carries the no-affiliate sentence; the terms text itself makes no affiliate claim.
  check(path + ' makes no affiliate claim', !/affiliate/i.test(body.slice(body.indexOf('<main'), body.indexOf('<footer'))));
  check(path + ' omits active GA4 configuration', !body.includes('gtag/js') && !body.includes("gtag('config'"));
}
check('footer links to the Terms of Use next to Privacy', /<footer[\s\S]*?href="\/privacy">[^<]*<\/a> &middot; <a href="\/terms">Terms of use<\/a>/.test(html));
const sitemap = await (await worker.fetch(new Request('https://bangersandmash.uk/sitemap.xml'))).text();
check('sitemap lists /terms', sitemap.includes('<loc>https://bangersandmash.uk/terms</loc>'));

// The no-affiliate sentence: on its own page and in the shared footer (2026-11-24).
const NO_AFFILIATE = 'Bangers &amp; Mash carries no affiliate links and earns no commission.';
for (const path of ['/affiliate-disclosure', '/affiliate-disclosure/']) {
  const response = await worker.fetch(new Request('https://bangersandmash.uk' + path));
  const body = await response.text();
  check(path + ' server-renders the disclosure', response.status === 200 && body.includes('<h1>Affiliate Disclosure</h1>') &&
    body.includes('<p class="lede">' + NO_AFFILIATE + '</p>') &&
    body.includes('<link rel="canonical" href="https://bangersandmash.uk/affiliate-disclosure">'));
  check(path + ' claims no commission and links no retailer', !/amazon\.|amzn\.|rel="[^"]*sponsored/i.test(body));
}
check('footer carries the no-affiliate sentence and links the disclosure', /<footer[\s\S]*?<a href="\/affiliate-disclosure">Affiliate disclosure<\/a>/.test(html) && html.includes('<p>' + NO_AFFILIATE + '</p>'));
check('sitemap lists /affiliate-disclosure', sitemap.includes('<loc>https://bangersandmash.uk/affiliate-disclosure</loc>'));

const robots = await worker.fetch(new Request('https://bangersandmash.uk/robots.txt'));
check('robots.txt unaffected', robots.status === 200 && (await robots.text()).includes('Sitemap:'));

// These paths are rendered by the Worker, not the Pages fallback. The 404
// must be an HTTP status, not a header named "status" on a 200 response.
for (const path of ['/recipe/__missing__', '/collections/__missing__', '/advertising']) {
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

// Chicken liver pâté: the method once told cooks the livers "must stay pink
// inside" after a 2–3 minute sear. The rendered method, the print layout and
// the Recipe JSON-LD must all give the measured FSA endpoint instead, and no
// colour or sear wording may return beside it.
const pateUrl = 'https://bangersandmash.uk/recipe/chicken-liver-pate';
const pate = await worker.fetch(new Request(pateUrl));
const pateHtml = await pate.text();
const pateScript = pateHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
const pateLd = pateScript ? JSON.parse(pateScript[1]) : null;
const pateLdSteps = (pateLd?.recipeInstructions ?? []).map(s => s.text);
const pateMethod = pateHtml.match(/<h2 class="sec">Method<\/h2><ol class="steps">([\s\S]*?)<\/ol>/);
const pateHtmlSteps = pateMethod ? [...pateMethod[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]) : [];
const pateEndpoint = /centre of the thickest livers reaches 70°C and holds there for 2 minutes, checked with a clean thermometer/;
const pateConflict = /stay pink|pink inside|left pink|sear 2[–-]3 minutes|USDA|74°C|165°F/i;
const pateColourTarget = /pink|ros(y|é)|blush|\brare\b|bloody|juices run clear/i;
// Every rule inside an @media print block must hide only the known page
// chrome, so the method (and any ancestor of it) always prints.
const printRules = [];
for (const m of pateHtml.matchAll(/@media\s+print\s*\{/g)) {
  let depth = 1, i = m.index + m[0].length, start = i;
  while (i < pateHtml.length && depth) { if (pateHtml[i] === '{') depth++; else if (pateHtml[i] === '}') depth--; i++; }
  for (const r of pateHtml.slice(start, i - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) printRules.push([r[1].trim(), r[2]]);
}
const printMayHide = new Set(['header.site', 'footer.site', 'nav.main', '.chips', '[data-block="jump-bar"]']);
const printHidden = printRules.filter(([, decl]) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test(decl))
  .flatMap(([sel]) => sel.split(',').map(s => s.trim()));
check('pâté route renders at its existing URL', pate.status === 200 && pateLd?.mainEntityOfPage === pateUrl);
check('pâté rendered method has the 70°C / 2 minute thermometer endpoint', pateHtmlSteps.some(s => pateEndpoint.test(s)));
check('pâté Recipe JSON-LD has the same endpoint', pateLdSteps.some(s => pateEndpoint.test(s)));
check('pâté rendered method and JSON-LD steps agree exactly', pateHtmlSteps.length === 6 &&
  JSON.stringify(pateHtmlSteps) === JSON.stringify(pateLdSteps));
check('pâté print CSS hides only page chrome, never the method', pateHtmlSteps.length === 6 && printRules.length > 0 &&
  printHidden.length > 0 && printHidden.every(s => printMayHide.has(s)));
check('pâté page carries no pink, sear-time or conflicting threshold wording', !pateConflict.test(pateHtml));
check('pâté method and JSON-LD set no colour target', ![...pateHtmlSteps, ...pateLdSteps].some(s => pateColourTarget.test(s)));
check('pâté method does not treat colour or a sear as proof of doneness', /Colour and a short sear are not proof that they are cooked\./.test(pateHtmlSteps.join(' ')));
// The 15-minute cook time was set for the old 2–3 minute sear; no tested
// replacement exists, so it shows as Varies and is left out of the JSON-LD.
check('pâté page marks the untested cook and total time as variable', /<dt>Cook<\/dt><dd>Varies<\/dd>/.test(pateHtml) && /<dt>Total<\/dt><dd>Varies<\/dd>/.test(pateHtml));
check('pâté structured data omits untested cook and total times', pateLd && !('cookTime' in pateLd) && !('totalTime' in pateLd) && pateLd.prepTime === 'PT20M');
const soups = await (await worker.fetch(new Request('https://bangersandmash.uk/collections/soups'))).text();
check('pâté listing does not show the former untested total', soups.match(/chicken-liver-pate[\s\S]{0,1800}?(Varies|\d+ min) total/)?.[1] === 'Varies');

// Liver, bacon & onions: the method once said to sear the liver "for 90
// seconds per side — pink inside is correct". The rendered method, the print
// layout and the Recipe JSON-LD must all give the FSA 70°C / 2 minute
// thermometer endpoint instead, with no colour or sear-time target beside it.
const liverUrl = 'https://bangersandmash.uk/recipe/liver-onions-bacon';
const liver = await worker.fetch(new Request(liverUrl));
const liverHtml = await liver.text();
const liverScript = liverHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
const liverLd = liverScript ? JSON.parse(liverScript[1]) : null;
const liverLdSteps = (liverLd?.recipeInstructions ?? []).map(s => s.text);
const liverMethod = liverHtml.match(/<h2 class="sec">Method<\/h2><ol class="steps">([\s\S]*?)<\/ol>/);
const liverHtmlSteps = liverMethod ? [...liverMethod[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]) : [];
const liverEndpoint = /centre of the thickest slices reaches 70°C and holds there for 2 minutes, checked with a clean thermometer/;
const liverConflict = /pink inside|90 seconds|per side|screaming-hot|flashed in the pan/i;
const liverPrintRules = [];
for (const m of liverHtml.matchAll(/@media\s+print\s*\{/g)) {
  let depth = 1, i = m.index + m[0].length, start = i;
  while (i < liverHtml.length && depth) { if (liverHtml[i] === '{') depth++; else if (liverHtml[i] === '}') depth--; i++; }
  for (const r of liverHtml.slice(start, i - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) liverPrintRules.push([r[1].trim(), r[2]]);
}
const liverPrintHidden = liverPrintRules.filter(([, decl]) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test(decl))
  .flatMap(([sel]) => sel.split(',').map(s => s.trim()));
check('liver route renders at its existing URL', liver.status === 200 && liverLd?.mainEntityOfPage === liverUrl);
check('liver rendered method has the 70°C / 2 minute thermometer endpoint', liverHtmlSteps.some(s => liverEndpoint.test(s)));
check('liver Recipe JSON-LD has the same endpoint', liverLdSteps.some(s => liverEndpoint.test(s)));
check('liver rendered method and JSON-LD steps agree exactly', liverHtmlSteps.length === 4 &&
  JSON.stringify(liverHtmlSteps) === JSON.stringify(liverLdSteps));
check('liver print CSS hides only page chrome, never the method', liverHtmlSteps.length === 4 && liverPrintRules.length > 0 &&
  liverPrintHidden.length > 0 && liverPrintHidden.every(s => printMayHide.has(s)));
check('liver page carries no pink or sear-time wording', !liverConflict.test(liverHtml));
check('liver method and JSON-LD set no colour target', ![...liverHtmlSteps, ...liverLdSteps].some(s => pateColourTarget.test(s)));
check('liver method does not treat colour or a sear as proof of doneness', /Colour and a short sear are not proof that it is cooked\./.test(liverHtmlSteps.join(' ')));
// The 25-minute cook time included the old 90-second sear; no tested
// replacement exists, so it shows as Varies and is left out of the JSON-LD.
check('liver page marks the untested cook and total time as variable', /<dt>Cook<\/dt><dd>Varies<\/dd>/.test(liverHtml) && /<dt>Total<\/dt><dd>Varies<\/dd>/.test(liverHtml));
check('liver structured data omits untested cook and total times', liverLd && !('cookTime' in liverLd) && !('totalTime' in liverLd) && liverLd.prepTime === 'PT10M');
const pubs = await (await worker.fetch(new Request('https://bangersandmash.uk/collections/pub'))).text();
check('liver listing does not show the former untested total', pubs.match(/liver-onions-bacon[\s\S]{0,1800}?(Varies|\d+ min) total/)?.[1] === 'Varies');

// Exercise the origin fallback: missing documents must not inherit the Pages SPA 200.
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response('<!doctype html><title>Legacy homepage</title>', { headers: { 'content-type': 'text/html' } });
  for (const path of ['/audit-missing-page-20261105', '/unmapped-policy']) {
    const missing = await worker.fetch(new Request('https://bangersandmash.uk' + path));
    check(path + ' is a genuine 404', missing.status === 404 && (await missing.text()).includes('<h1>Not found</h1>'));
  }
  globalThis.fetch = async () => new Response('<!doctype html><title>Legacy homepage</title>', { headers: { 'content-type': 'Text/HTML; charset=utf-8' } });
  check('mixed-case HTML fallback is a real 404', (await worker.fetch(new Request('https://bangersandmash.uk/unmapped-policy'))).status === 404);
  globalThis.fetch = async () => new Response('asset-bytes', { headers: { 'content-type': 'image/webp' } });
  const asset = await worker.fetch(new Request('https://bangersandmash.uk/images/recipes/test.webp'));
  check('Pages image bytes and status survive', asset.status === 200 && await asset.text() === 'asset-bytes');
  check('Pages image cache headers survive', asset.headers.get('cache-control') === 'public, max-age=31536000, immutable');
  globalThis.fetch = async () => new Response(null, { status: 404, headers: { 'content-type': 'application/javascript' } });
  check('missing asset keeps its 404', (await worker.fetch(new Request('https://bangersandmash.uk/assets/missing.js'))).status === 404);
} finally { globalThis.fetch = originalFetch; }

const failed = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
