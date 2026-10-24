---
'@minimalgallery/pipeline': patch
'minimalgallery': patch
'create-minimalgallery': patch
---

Stop before the bucket while the config still holds a stand-in from the setup.

- `minimalgallery`: `publish` (and so the admin’s Publish), `sync --prune` and `doctor --bucket` stop before any upload, commit, deploy or bucket check while `minimalgallery.config.ts` still holds `your-account-id` in `storage.endpoint` or `https://media.example.com` as `storage.publicUrl`, naming the key and what to put there: the account id that `npx wrangler whoami` prints, or the custom domain connected to the bucket in its R2 settings. `sync` still encodes, keeps the new files staged and exits with 1.
- `@minimalgallery/pipeline`: `ACCOUNT_ID_PLACEHOLDER`, `PUBLIC_URL_PLACEHOLDER`, `configPlaceholders` and `placeholderMessage`. `uploadToBucket`, `pruneBucket`, `planBucketSync` and `checkBucket` throw a `BucketError` with the code `placeholder` on a stand-in, encoding no longer asks a stand-in endpoint for its listing, and the doctor report lists each stand-in as an issue.
- `create-minimalgallery`: the stand-ins it writes are checked against the pipeline’s in its tests.
