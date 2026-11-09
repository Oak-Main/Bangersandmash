/**
 * mirror.mjs — full recovery crawl of bangersandmash.uk (our Cloudflare Pages
 * deployment of the Emergent-built static export). 104 sitemap pages + assets.
 * Output: /tmp/gastropub/mirror/{pages,images} + recipes.jsonl + summary.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://bangersandmash.uk';
import { dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = HERE + '/mirror';
mkdirSync(join(OUT, 'pages'), { recursive: true });
mkdirSync(join(OUT, 'images'), { recursive: true });

const locs = readFileSync(HERE + '/sitemap.xml', 'utf8')
  .match(/<loc>[^<]+<\/loc>/g).map((s) => s.slice(5, -6));
console.log('pages to fetch:', locs.length);

const imgSet = new Set();
const recipes = [];
let cssInlineBytes = 0;
let failures = [];

for (const loc of locs) {
  const path = new URL(loc).pathname;
  const file = path === '/' ? 'index.html' : path.replace(/^\//, '').replace(/\/$/, '') + '.html';
  try {
    const res = await fetch(loc, { redirect: 'follow' });
    if (!res.ok) { failures.push(`${path}: HTTP ${res.status}`); continue; }
    const html = await res.text();
    mkdirSync(dirname(join(OUT, 'pages', file)), { recursive: true }); writeFileSync(join(OUT, 'pages', file), html);
    cssInlineBytes += (html.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).join('').length;
    for (const m of html.matchAll(/(?:src|href)="(\/(?:images|generated)\/[^"]+)"/g)) imgSet.add(m[1]);
    for (const m of html.matchAll(/srcset="([^"]+)"/g))
      for (const part of m[1].split(',')) {
        const u = part.trim().split(/\s+/)[0];
        if (u.startsWith('/')) imgSet.add(u);
      }
    // extract Recipe JSON-LD
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        const ld = JSON.parse(m[1]);
        if (ld['@type'] === 'Recipe' || (Array.isArray(ld) && ld.some((x) => x['@type'] === 'Recipe'))) {
          const r = Array.isArray(ld) ? ld.find((x) => x['@type'] === 'Recipe') : ld;
          recipes.push({ path, ...r });
        }
      } catch { failures.push(`${path}: unparseable JSON-LD`); }
    }
  } catch (e) { failures.push(`${path}: ${e.message}`); }
}

let imgOk = 0;
const imgs = [...imgSet];
for (const img of imgs) {
  try {
    const res = await fetch(BASE + img, { redirect: 'follow' });
    if (!res.ok) { failures.push(`${img}: HTTP ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const file = img.replace(/^\//, '').replaceAll('/', '__');
    writeFileSync(join(OUT, 'images', file), buf);
    imgOk++;
  } catch (e) { failures.push(`${img}: ${e.message}`); }
}

writeFileSync(join(OUT, 'recipes.jsonl'), recipes.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({
  pages_fetched: locs.length - failures.filter((f) => f.includes('HTTP') || f.includes(': ') && !f.includes('JSON-LD')).length,
  recipe_jsonld: recipes.length,
  with_aggregateRating: recipes.filter((r) => r.aggregateRating).length,
  images_total: imgs.length, images_fetched: imgOk,
  inline_css_bytes_total: cssInlineBytes,
  failures: failures.slice(0, 10),
}, null, 2));
