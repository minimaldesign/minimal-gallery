---
'@minimalgallery/pipeline': minor
'@minimalgallery/astro': minor
'minimalgallery': minor
'create-minimalgallery': minor
---

The browser admin and bucket mode.

- `@minimalgallery/astro`: a browser admin at `/_mg/admin/`, under `astro dev` only: drop photos and folders (chunked uploads, dedupe by content, progress as each photo is processed), “needs attention” badges, a photo inspector that writes only the overridden fields to `<name>.md`, album editing and drag-to-reorder in `_album.md`, a first-run checklist, settings with a `custom.css` editor, and a publish page with the log and the final address. It answers only this computer, through a local HTTP API, and is never part of a build. Files copied into `photos/` are processed while it runs. A new gallery with no photos yet opens in dev. Absolute media URLs (bucket mode) are no longer prefixed with the site’s base.
- `@minimalgallery/pipeline`: the S3 storage adapter (Cloudflare R2, Backblaze B2, AWS S3, MinIO) with `aws4fetch`. Bucket mode stages derivatives in `.minimalgallery/cache/media` and never touches the network while encoding; `uploadToBucket`, `pruneBucket`, `planBucketSync`, `pendingUploads` and `checkBucket` do the remote work. Credentials come from `MG_S3_ACCESS_KEY_ID` and `MG_S3_SECRET_ACCESS_KEY` in the environment or the gallery’s `.env`. Derivative keys now also depend on the ladder, so a ladder or color change gives new URLs instead of stale cached files; a changed `publicUrl` rewrites manifests without encoding. `processGallery` reports progress through `onPlan`, `onPhoto` and `onError`.
- `minimalgallery`: `sync` uploads what bucket mode staged and, with `--prune`, deletes unused bucket files after asking; `publish` uploads before it commits, deploys or builds and names the site’s address at the end; `watch` reports files waiting for upload; `doctor --bucket` checks the bucket end to end; `admin` opens the admin.
- `create-minimalgallery`: bucket mode (R2) is the default on Cloudflare, with the bucket name, media domain and R2 token asked once (the token goes to `.env`); the scaffold reads the account id from `wrangler whoami`, creates the bucket when it can, and asks whether to publish by pushing to GitHub (the default) or uploading from this computer.
