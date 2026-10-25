# Working on minimalgallery v2

Static photo gallery toolkit: an Astro 7.4 integration plus a local Node pipeline. Read these before changing anything:

- `design/plan.md`: the approved plan, decisions, phases, URL scheme, data model, hosting.
- `design/DESIGN.md`: the theme handoff (page model, blocks, state, keyboard map, motion, token contract, performance baseline).
- `design/brief.md`: the design brief and what changed in each review round.
- `design/prototype/`: the signed-off clickable prototype, the spec the theme was ported from.
- `packages/*/README.md`: each package’s API.

## Rules that are not in the code

- Prose anywhere (copy, comments, docs, commits): no em dashes, never the word "seam", American English, real apostrophes and curly quotes in text a reader sees. No uppercase styling in the UI.
- CSS first, JavaScript last; no size cap, but report the script size. Load the `mcss` skill before writing theme CSS; the theme is built on mCSS cascade layers and the user’s `custom.css` is the last layer.
- Steps between photos happen inside the page (plain CSS opacity transition, pushState). Never make the next/previous path depend on cross-document view transitions, prerendering or render-blocking scripts; those are Chrome-only extras.
- Done means measured: run `node examples/demo/bench/steps.mjs` (Playwright: chromium, webkit, firefox) and `examples/demo/bench/behaviours.mjs` and quote the numbers. Targets: fade starts under 50 ms warm, no strip image reloads, photo page under 60 KB, home under 150 KB. Chrome-only or headless-only checks are not a pass.
- Prettier runs on save and in CI (`pnpm format:check`); never fight its config. `pnpm build && pnpm test` must pass.

## Publishing

- The demo publishes the way a user’s gallery does, so the real user path gets used: `pnpm demo:publish` builds the packages, then runs `minimalgallery publish` in `examples/demo`, which processes new photos, builds the site and uploads `dist/` with `wrangler deploy` from Yann’s Mac. Pushing to `master` does not deploy anything, so the live site can be behind `master` until the next publish. Yann runs the publish; never run it, or `wrangler deploy`, without his go-ahead.
- `apps/docs` is not a gallery and still builds from `master` with Workers Builds (see `apps/docs/README.md`).
- Commit and push only when Yann asks. Branch for anything bigger than a small fix.

## Local setup facts

- Node 24.11 via nodenv (`.node-version`), pnpm 10 (after a global install run `nodenv rehash`), ExifTool and cjxl installed.
- Yann keeps the prototype served on port 4410 and the app’s preview may hold 4322; use 4421 and up for your own servers.
- The demo is in repo mode: its manifests (`examples/demo/.minimalgallery/manifest`) are committed, so each photo keeps its `added` date, and the resized photos (`public/_mg`) are ignored: the pipeline encodes them on the computer that builds, `demo:publish` on Yann’s Mac and the CI job on GitHub. After changing photos or the pipeline, run `node packages/pipeline/dist/cli.js examples/demo` after `pnpm build` and commit the manifests. Moving the demo to bucket mode later is the checklist in PR #8.
- The admin runs only under `astro dev` (`pnpm --filter minimalgallery-demo run admin`, at `/_mg/admin/`); its local HTTP API is described in `packages/astro/src/admin/README.md`.

## Open work

GitHub issues on `minimaldesign/minimal-gallery` hold the next phases with full briefs: #2 Phase 2 viewer completion, #3 Phase 3 ingest and bucket mode, #4 Phase 4 launch and docs, #5 the full-resolution pipeline measurement, and #1 the parked desktop app.
