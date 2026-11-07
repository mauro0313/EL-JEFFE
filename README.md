# EL JEFFE — 3JM Exteriors

3JM's job desk with **EL JEFFE**, the insurance supplement agent. Upload the carrier's estimate and the EagleView/HOVER report, press **Run EL JEFFE**, and review a supplement draft: missed and underpaid line items with sources, a review checklist, the town's adopted building code, and the letter to the adjuster. Nothing is sent to the adjuster until you send it yourself.

Setup is in the **EL JEFFE Setup Guide** (PDF). In short: GitHub → Firebase → Anthropic key → Netlify settings → deploy → check the `[3JM setup]` lines in the deploy log.

## How it fits together
| Piece | Where |
|---|---|
| Web app (React + Vite + Tailwind) | `src/` |
| Google sign-in, database, file storage | Firebase (`src/firebase.js`) |
| Team list (who can sign in) | `team.json`, the only place it lives |
| Security rules | generated from `team.json` by `scripts/rules.mjs`, installed on every deploy |
| Deploy-time setup and checks | `scripts/setup.mjs` (prints `[3JM setup] OK / NOT DONE`) |
| Starting knowledge base and letter settings | `scripts/knowledge-seed.json` (added only if missing; your edits are kept) |
| Start a run | `netlify/functions/supplement-start.mjs` |
| The agent (up to 15 min, background) | `netlify/functions/supplement-run-background.mjs` → `netlify/lib/agent.mjs` |
| Ask EL JEFFE chat | `netlify/functions/ask-background.mjs` |
| Roof math shared by app and agent | `shared/roofmath.js` (`npm test`) |

## What EL JEFFE does on a run
1. Reads the job, the knowledge base and both PDFs (scanned PDFs and photos too; Claude reads them directly).
2. Searches the web for the town's adopted residential code and reads the drip edge and ice barrier sections.
3. Works the checklist: drip edge, starter, ice & water (eaves by overhang + wall + 24 in. up the slope, plus valleys), steep (separate removal and replacement per pitch band), high roof, waste, ridge, hips, step flashing, penetrations, underlayment, O&P, code upgrades, permit and debris.
4. Calls `save_draft`. The server checks the arithmetic (`checkDraft`) and sends it back to revise when it's off, up to twice.

The model defaults to `claude-sonnet-5-5`. Set `ANTHROPIC_MODEL` (scope: Functions) to change it, for example `claude-opus-5-5` for the hardest claims at a higher cost per run.

## Data
- `jobs/{jobId}`: the job, its `documents` list (files in Storage under `documents/{jobId}/`) and `lastDraft`
- `jobs/{jobId}/supplementDrafts/{draftId}`: each run, its log, items, checklist, code findings and review
- `jobs/{jobId}/chat/{msgId}`: Ask EL JEFFE
- `knowledge/{id}`, `settings/company`

## Running it on your own computer
```bash
npm install
cp .env.example .env   # fill in the values
npm run dev            # the app; the functions need `netlify dev` (Netlify CLI)
npm test               # roof math tests
```
