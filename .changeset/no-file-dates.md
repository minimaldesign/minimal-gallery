---
'@minimalgallery/pipeline': minor
'@minimalgallery/astro': minor
---

Photo dates come only from the photos, and file times stay out of the manifests.

- `@minimalgallery/pipeline`: a photo with no capture date in any layer (sidecar, album, XMP, EXIF, IPTC) has `date: null` and `dateSource: 'none'`, instead of the file’s modification time with `dateSource: 'mtime'`. `isDated()` is a type guard on `date`. Manifests no longer carry `sourceMtime`: the sizes, modification times and hashes that let a run skip unchanged photos are kept in `.minimalgallery/cache/files.json`, which git ignores. Git does not keep modification times, so a fresh clone, another computer or CI used to rewrite every manifest; now its first run reads each photo once and writes only the manifests that changed.
- `@minimalgallery/astro`: the admin’s undated flag is `no-date` (it was `date-from-mtime`), and a photo summary’s `date` can be null. The flag and the inspector say the photo has no date, rather than offering the file’s.
