# Recovery — bangersandmash.uk production snapshot (2026-10-02)

The Emergent platform path is closed (preview expired to a loading shell;
nextprompt's EMERGENT_MCP_TOKEN returns 401). This snapshot instead recovers
EVERYTHING from our own Cloudflare Pages deployment — which, because the site
is a fully pre-rendered static export with zero JS bundles, is lossless at the
artifact level:

- `pages/` — all 104 sitemap pages, verbatim rendered HTML
- `images/` — all 184 image assets incl. srcset variants (22 MB)
- `recipes.jsonl` — 92 recipes extracted from live Recipe JSON-LD
  (every one has ingredients, instructions, times, yield, category, image)
- ~556 KB of inline CSS across pages = the complete design system
- `mirror.mjs` + `sitemap.xml` — regenerate anytime (read-only crawl)

If you can still open the `gastropub-table` job in the Emergent dashboard,
downloading `/app/frontend` from its file browser would add the original JSX
source on top — nice-to-have, NOT required: the reconstruction path (owned
static rebuild in this repo, presentation contract native) is fully unblocked
from this snapshot alone. Source of truth for the rebuild plan:
`C:\Users\Dell\Recipe Finalz\presentation\README.md` §7a.
