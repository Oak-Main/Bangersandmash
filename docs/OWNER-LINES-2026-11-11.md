# OWNER-LINES 2026-11-11 — two empty slots (your words)

Nothing here is recipe text. `write-safety-lines.ps1` (Away Run 3 folder) writes your sentence into every place the page renders it, runs `npm test --prefix worker`, and pushes to this branch.

| Slot | Live page (checked 18:20 PT Nov 10) | Live now | File and anchor | Must state | Max |
|---|---|---|---|---|---|
| BangersGoose | https://bangersandmash.uk/recipe/roast-goose | no internal temperature; "The goose is done when the leg juices run clear. Rest 30 minutes under foil." | `worker/worker.js` line 2: replaces the `/* OWNER-SLOT safety-doneness roast-goose … */` comment with a new step after that sentence | 165 °F (74 °C) in the thickest part of the thigh, and in the centre of the stuffing (the recipe is stuffed) | 160 |
| BangersBeefNote | https://bangersandmash.uk/recipe/roast-beef-yorkshire | "Checkpoint — 50–52 °C (122–126 °F) on the probe for medium-rare" | `worker/packets/roast-beef-yorkshire-pudding.js` line 3: after that checkpoint in the method list, the HowToStep JSON-LD and the step's `checkpoint` field (3 places) | USDA's beef minimum 145 °F (63 °C) with a 3-minute rest, beside the culinary 50–52 °C | 140 |

Ships by hand: merge, then `npx wrangler deploy` from `worker/` on branch `claude/frontend-site-audit-g8zkms` (no deploy on merge).
