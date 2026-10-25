---
'@minimalgallery/pipeline': minor
'@minimalgallery/astro': minor
'minimalgallery': minor
'create-minimalgallery': minor
---

Two ways to put a gallery online: Cloudflare, with photo storage on R2 for a large library, or a folder you upload to your own host. Git publishing, GitHub Pages and Netlify are gone.

- `create-minimalgallery`: `--host` takes `cloudflare` (the default) or `local`. On Cloudflare it asks “How big is your photo library?”, and the larger answer sets up photo storage (bucket mode) with the R2 questions that were already there. `--publish` and `--no-git` are gone, and the scaffold no longer makes the folder a git repository. The `.gitignore` still keeps the originals out of a repository the owner makes, and says how to keep them in.
- `minimalgallery`: `publish` takes `--deploy` or `--build`. Without either, it deploys when the gallery has a `wrangler.jsonc` and builds otherwise. `"publish": "git"` in `package.json` stops with an explanation. `--git`, `commitOriginals`, the warnings about originals tracked in git, and the `gitChanges`, `selectChanges`, `isSidecar` and `commitOriginalsSetting` exports are removed.
- `@minimalgallery/astro`: the admin’s publish page offers Upload to Cloudflare and Build for my own host, and no longer checks git or the GitHub CLI. `GET /publish` drops its `git` field, and `method` is `'deploy'` or `'build'`.
- `@minimalgallery/pipeline`: `doctor` drops the repository size check, `commitOriginals`, `repo` and `REPO_BYTE_LIMIT`. It reports `siteMedia.bytes` instead, says “add photo storage” where it said “move to bucket mode”, and skips Cloudflare’s file limit for a gallery built for its own host. A photo whose original was never on this computer is still never pruned.
- Repo mode is renamed site mode: `storage: { mode: 'site' }` and `originals: 'site'` replace `'repo'`, which is no longer accepted. `create-minimalgallery --storage` takes `site` or `bucket`, `doctor`’s `'repo-ok'` recommendation is `'site-ok'`, and the pipeline’s `repoStorage` export is `folderStorage`.
- `create-minimalgallery` names a new gallery folder `mg` by default, instead of `my-gallery`.
