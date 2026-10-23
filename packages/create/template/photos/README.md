# photos

Put your photos here, one folder per album:

```
photos/
  japan-2025/
    DSC_0412.jpg
    DSC_0412.md     optional: title, caption and other fields you want to change
  family/
    birthdays/      albums can be nested
```

- JPEG, PNG, WebP, AVIF and TIFF are read. Export HEIC and RAW files as JPEG first.
- Titles, captions, keywords, ratings and dates come from the photos’ own metadata, so a Lightroom export with metadata included needs no extra work.
- Your originals are never changed. Resized copies go to `public/_mg/` in repo mode, or to your storage bucket when you publish in bucket mode, and the details the site reads go to `.minimalgallery/`.
- Photos placed directly in this folder, outside an album folder, are skipped.

To copy a folder in and process it in one step:

```sh
npx minimalgallery add ~/Pictures/Export/japan-2025
```

Or run `npx minimalgallery watch` and drop folders here in Finder.
