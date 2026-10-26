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

- JPEG, PNG, WebP, AVIF, TIFF and HEIC (iPhone) are read. Export RAW files as JPEG first.
- Titles, captions, keywords and dates come from the photos’ own metadata, so a Lightroom export with metadata included needs no extra work.
- Your originals are never changed. Resized copies go to `public/_mg/` in site mode, or to your storage bucket when you publish in bucket mode, and the details the site reads go to `.minimalgallery/`.
- Photos placed directly in this folder, outside an album folder, are skipped.
- This folder holds your only copy of the originals and captions in the gallery: keep it in your backups. If you keep the gallery in git, `.gitignore` leaves the photo files out of it and keeps their sidecars and `_album.md` files. See https://docs.minimalgallery.net/backups/

To copy a folder in and process it in one step:

```sh
npx minimalgallery add ~/Pictures/Export/japan-2025
```

Or run `npx minimalgallery watch` and drop folders here in Finder.
