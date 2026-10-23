---
title: Sidecars
description: How the photos folder is organized, the metadata files read next to each photo, and the order in which minimal gallery combines them.
---

This page covers the `photos/` folder: how folders become albums, the files you can put next to a photo to set its title, caption, date and other fields, what is read from the photo’s own XMP, IPTC and EXIF data, and which source wins when they disagree.

## The photos folder

```text
photos/
  japan-2025/              an album, at /japan_2025/
    _album.md              album title, sort order, description
    DSC_0412.jpg           the original, never modified
    DSC_0412.md            fields and caption for this photo
    DSC_0412.xmp           Lightroom sidecar, read only
  family/
    birthdays/             a nested album, at /family/birthdays/
      IMG_1042.jpg
```

- Every folder under `photos/` is an album. Albums can be nested.
- A photo placed directly in `photos/`, outside an album folder, is skipped with a warning.
- Files and folders whose name starts with `.` are skipped.
- Next to each photo, the pipeline looks for `<name>.md`, `<name>.json` and `<name>.xmp`, where `<name>` is the photo’s file name without its extension. Each folder can hold one `_album.md`. Any other file is ignored.
- Your originals and sidecars are only read, never changed.

The pipeline writes what it reads to one JSON manifest per photo, in `.minimalgallery/manifest/`. The fields are defined in [`schema.ts`](https://github.com/minimaldesign/minimal-gallery/blob/master/packages/pipeline/src/schema.ts). Editing a sidecar rewrites the photo’s manifest on the next run without encoding the photo again.

## Supported formats

| Kind | Extensions | What happens |
| --- | --- | --- |
| Read | `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.tif`, `.tiff` | Processed. Extensions are matched in any case. |
| HEIC | `.heic`, `.heif`, `.hif` | Reported as failed, with the fix: export a JPEG. |
| RAW | `.3fr`, `.arw`, `.cr2`, `.cr3`, `.crw`, `.dcr`, `.dng`, `.erf`, `.iiq`, `.k25`, `.kdc`, `.mef`, `.mos`, `.mrw`, `.nef`, `.nrw`, `.orf`, `.pef`, `.raf`, `.raw`, `.rw2`, `.rwl`, `.sr2`, `.srf`, `.srw`, `.x3f` | Reported as failed, with the fix: export a JPEG from your RAW editor. |

A HEIC or RAW file with a supported image of the same name next to it (`DSC_0412.NEF` and `DSC_0412.jpg`) is not an error: the image is used, the HEIC or RAW file is ignored, and the run prints how many were ignored. A HEIC file saved with a `.jpg` name is recognized from its content and reported as HEIC.

## Ids, slugs and URLs

| Path in `photos/` | Album id | Photo id | Page URL |
| --- | --- | --- | --- |
| `japan-2025/DSC_0412.jpg` | `japan_2025` | `japan_2025__dsc_0412` | `/japan_2025/dsc_0412/` |
| `Family/Birthdays/IMG 1042.JPG` | `family/birthdays` | `family_birthdays__img_1042` | `/family/birthdays/img_1042/` |
| `Café/Crème brûlée.jpg` | `cafe` | `cafe__creme_brulee` | `/cafe/creme_brulee/` |

- **Slug:** accents are removed, letters are lowercased, and every run of characters other than `a` to `z` and `0` to `9` becomes one `_`. A leading or trailing `_` is kept.
- **Album id:** each folder name in the path, slugged, joined by `/`. The album’s page is `/<album id>/`.
- **Photo id:** the album id with `/` replaced by `_`, then `__`, then the file name without its extension, slugged.
- **Photo URL:** `/<album id>/<file slug>/`.

Two folders or two files that give the same id stop the run with an error naming both, for example `DSC_0412.jpg` and `DSC_0412.png` in one album, or the folders `Kyoto East` and `kyoto-east`. Rename one of them.

:::caution

Letters outside the Latin alphabet are replaced too: a folder named `東京` gets the id `_`, and a second folder in another script then collides with it. Name folders and files with Latin letters and digits.

:::

The first folder of an album path cannot slug to a name the site uses for its own pages: `year`, `month`, `on`, `place`, `camera`, `lens`, `focal`, `aperture`, `shutter`, `iso`, `keyword`, `grid`, `_astro` or `_mg`. The build fails with a message naming the album.

Renaming a file or a folder changes its id and its URL. The old manifest and derivatives stay until you run `minimalgallery sync --prune`; `minimalgallery watch` prunes them on its own.

## Metadata precedence

For each field, the first source that sets it wins, from highest to lowest:

1. `<name>.md`, then `<name>.json` (when both exist, `.md` wins field by field)
2. the photo’s entry in the album’s `_album.md` `photos:` map
3. `<name>.xmp`
4. the XMP embedded in the photo
5. the photo’s IPTC data
6. the photo’s EXIF data
7. the file name (title only)

The date follows its own order; see [Dates](#dates).

- An empty string or an empty list counts as not set, so a sidecar cannot blank out a value that comes from a lower source.
- `place` and `exposure` are merged sub-field by sub-field: a sidecar can set only `city` and keep the country from IPTC.
- `keywords` and `gps` are taken whole from one source: keywords in a sidecar replace the photo’s keywords, they are not added to them.

## `_album.md`

```md title="photos/japan-2025/_album.md"
---
title: Japan, spring 2025
cover: DSC_0412.jpg
sort: manual
order:
  - DSC_0398
  - DSC_0412
  - DSC_0405
photos:
  DSC_0405.jpg:
    title: Philosopher’s Path
    keywords: [cherry blossom, canal]
  DSC_0430:
    hidden: true
---

Two weeks between Tokyo and Kyoto, in the last days of the cherry blossom.
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `title` | `string` | the folder name | Album title. Without it, the folder’s name is used with `_` and `-` turned into spaces and the first letter capitalized: `kyoto_east` gives “Kyoto east”. |
| `cover` | `string` | the first photo that is not hidden, in the album’s order | The cover photo, by file name, with or without its extension. A name that is not a photo of this album stops the run. |
| `sort` | `'date' \| 'name' \| 'manual'` | `albums.sort` in the config, else `'date'` | Photo order in the album. See below. |
| `order` | list of strings | `[]` | For `sort: manual`: the photos to put first, in this order. Each entry is a file name, a file name without its extension, or a photo slug. |
| `hidden` | `boolean` | `false` | Leaves the album and its photos out of the site. See [Hidden photos and albums](#hidden-photos-and-albums). |
| `date` | date | none | An album date. It is stored in the album’s manifest; the theme does not use it yet. |
| `photos` | map | none | Fields for individual photos, keyed by file name, file name without its extension, or photo slug. Each entry takes the same fields as a [photo sidecar](#namemd), without a body. |

The body, after the frontmatter, is the album’s description, in Markdown. `description` is not a frontmatter field.

Sort modes:

- `date`: newest first. Photos taken in the same second are in reverse file-name order. Undated photos come last, in file-name order.
- `name`: by file name, with numbers compared as numbers (`2` before `10`).
- `manual`: the photos named in `order` first, in that order, then the rest by date.

An `_album.md` that does not validate stops the whole run, with the file name and the error.

## `<name>.md`

```md title="photos/japan-2025/DSC_0412.md"
---
title: Fushimi Inari at dusk
date: 2025-04-03 18:42:10
keywords: [torii, Kyoto, dusk]
rating: 4
place:
  city: Kyoto
  country: Japan
---

The last light on the upper gates, after the crowds had gone down.
```

The frontmatter sets fields; the body, when there is one, is the caption, in Markdown. The body wins over a `caption` field.

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | `string` | The photo’s title. Without one from any source, the file name is used with `_` and `-` turned into spaces and the first letter capitalized: `lazy-sunday.jpg` gives “Lazy sunday”. |
| `caption` | `string` | The caption, in Markdown. |
| `date` | date or `string` | The capture date, as local time. See [Dates](#dates). |
| `camera` | `string` | The camera, as shown and used for the camera pages. |
| `lens` | `string` | The lens, as shown and used for the lens pages. |
| `keywords` | list of strings, or one string | Keywords. A single string is split on commas and semicolons. Duplicates that differ only in case are dropped. |
| `rating` | `number` | Stars, 1 to 5. See [Ratings](#ratings). |
| `copyright` | `string` | Copyright notice. |
| `author` | `string` | The photographer. |
| `hidden` | `boolean` | Leaves the photo out of the site. See [Hidden photos and albums](#hidden-photos-and-albums). |
| `place` | object | Any of `city`, `state`, `country` and `location` (the IPTC sub-location: a neighborhood, a park, a building). |
| `gps` | object | `lat` and `lon` in decimal degrees, and optionally `alt` in meters. |

Exposure values (shutter speed, aperture, focal length, ISO and the rest) cannot be set in a sidecar; they come from EXIF only.

The place is shown as the city (else the state, else the location) and the country, “Kyoto, Japan”, and that label is the photo’s place page: `/place/kyoto-japan/`.

Fields that are not in this table are ignored without a warning, so check the spelling of a field that seems to have no effect. A field with the wrong type, or a date that cannot be read, fails that photo: it is reported, its manifest is not written or updated, and the other photos are processed.

## `<name>.json`

The same fields as the `.md` frontmatter, as a JSON object. The caption goes in `caption`.

```json title="photos/japan-2025/DSC_0412.json"
{
  "title": "Fushimi Inari at dusk",
  "date": "2025-04-03T18:42:10",
  "keywords": ["torii", "Kyoto", "dusk"],
  "gps": { "lat": 34.9671, "lon": 135.7727 }
}
```

When a photo has both a `.md` and a `.json` sidecar, a field set in the `.md` file wins.

## `<name>.xmp`

An XMP sidecar is read the same way as the XMP embedded in a photo; the sidecar wins over the embedded packet. The file can be named `<name>.xmp` or `<name>.XMP`. A sidecar named after the full file name, such as `DSC_0412.jpg.xmp`, is not read.

Lightroom writes `<name>.xmp` next to RAW files. Export a JPEG with the same name into the same folder, and the RAW file is ignored while its `.xmp` sidecar applies to the JPEG.

| XMP property | Lightroom field | Sets |
| --- | --- | --- |
| `dc:title` | Title | `title` |
| `dc:description` | Caption | `caption` |
| `dc:subject` | Keywords | `keywords` |
| `dc:creator` | Creator | `author` |
| `dc:rights` | Copyright | `copyright` |
| `xmp:Rating` | Rating | `rating` |
| `photoshop:City` | City | `place.city` |
| `photoshop:State` | State / Province | `place.state` |
| `photoshop:Country` | Country | `place.country` |
| `Iptc4xmpCore:Location` | Sublocation | `place.location` |
| `exif:DateTimeOriginal`, else `photoshop:DateCreated`, else `xmp:CreateDate` | Capture Time | `date`, only when the value includes a time |
| `aux:Lens`, else `exifEX:LensModel` | Lens | `lens` |
| `exif:GPSLatitude` and `exif:GPSLongitude` | GPS | `gps` |

For a text with several languages, the `x-default` one is used. Properties are matched by namespace, so files that use other prefixes (`xap:` for `xmp:`) are read too. The camera and the exposure values are not read from XMP.

## IPTC and EXIF

The photo’s own IPTC and EXIF data fill in what no sidecar or XMP sets.

| IPTC field | Sets |
| --- | --- |
| Object Name | `title` |
| Caption/Abstract | `caption` |
| Keywords | `keywords` |
| By-line | `author` |
| Copyright Notice | `copyright` |
| City | `place.city` |
| Province/State | `place.state` |
| Country/Primary Location Name | `place.country` |
| Sub-location | `place.location` |
| Date Created, with Time Created | `date`, as a fallback only (see [Dates](#dates)) |

| EXIF tag | Sets |
| --- | --- |
| Make and Model | `camera`, cleaned up: `NIKON CORPORATION` and `NIKON D70` give “Nikon D70” |
| LensMake and LensModel, else LensInfo | `lens` |
| DateTimeOriginal | `date` |
| OffsetTimeOriginal | `tz` |
| CreateDate | `date`, as a fallback only |
| ExposureTime | shutter speed, shown as `1/60` or `2.5` |
| FNumber | aperture |
| FocalLength, FocalLengthIn35mmFormat | focal length, and its 35 mm equivalent |
| ISO | ISO |
| ExposureCompensation | exposure compensation |
| MeteringMode | metering mode |
| Flash | whether the flash fired |
| Artist | `author` |
| Copyright | `copyright` |
| GPSLatitude, GPSLongitude, GPSAltitude | `gps` |

:::note

Ratings, `author`, `copyright` and `gps` are stored in each manifest, but the theme does not show them yet.

:::

## Dates

A photo’s `date` is the time the camera’s clock showed, written `YYYY-MM-DDTHH:MM:SS`, with no time zone. A photo taken at 23:00 in New York stays on that day wherever the site is built.

The first source that has a date wins, and `dateSource` in the manifest records which one it was:

| Order | Source | `dateSource` |
| --- | --- | --- |
| 1 | `date` in `<name>.md` or `<name>.json` | `sidecar` |
| 2 | `date` in the album’s `photos:` map | `album` |
| 3 | `<name>.xmp`, when the value includes a time | `xmp` |
| 4 | embedded XMP, when the value includes a time | `xmp` |
| 5 | EXIF DateTimeOriginal | `exif` |
| 6 | EXIF CreateDate | `exif` |
| 7 | IPTC Date Created, with Time Created (midnight without it) | `iptc` |
| 8 | the file’s modification time, in the local time of the computer that runs the pipeline | `mtime` |

Time zone offsets written in XMP or IPTC are dropped: they belong to the computer that edited the file, not to the place the photo was taken. The only offset kept is EXIF OffsetTimeOriginal, stored as `tz` (`+09:00`), and only when `date` is the camera’s own DateTimeOriginal. Most cameras made before 2016 do not record it.

A photo with `dateSource: mtime` counts as undated. It stays in its album and in the archive, sorted after the dated photos, but it is left out of the year, month and day pages. `minimalgallery add` keeps the files’ modification times when it copies them.

### Writing a date in a sidecar

These forms are accepted:

- `2025-04-03` (midnight)
- `2025-04-03 18:42` or `2025-04-03 18:42:10`
- `2025-04-03T18:42:10`
- `2025:04:03 18:42:10`, as EXIF writes it

An offset at the end of a string (`+09:00`, `Z`) is dropped, and the time is kept as written.

:::caution[Offsets in YAML]

In a `.md` sidecar or `_album.md`, an unquoted date and time with an offset, such as `date: 2025-04-03T18:42:10+09:00`, is converted to UTC by the YAML parser before minimal gallery sees it, and the stored time moves by nine hours. Leave the offset out, or put the value in quotes.

:::

## Ratings

A rating is stored as a whole number from 1 to 5, or as unrated.

- From XMP, a rating of 0 (Lightroom’s “unrated”) or -1 (rejected) is stored as unrated.
- In a sidecar or the album’s `photos:` map, the value is rounded and kept between 0 and 5, and 0 or less is stored as unrated. Because 0 counts as a value, `rating: 0` in a sidecar clears a rating that comes from XMP.

## Hidden photos and albums

`hidden: true` on a photo (in a sidecar or the album’s `photos:` map) or on an album (in its `_album.md`) leaves it out of the site: a hidden photo gets no page and is not listed in any album, in the archive or on any facet page; a hidden album gets no page, and neither do its photos.

`hidden` on an album applies to that folder only. To hide a nested album as well, set `hidden: true` in its own `_album.md`.

:::caution[Hidden is not private]

Hidden photos are still processed. In repo mode their derivatives are written to `public/_mg/` and deployed with the site, so anyone who has a derivative’s URL can load it. To keep a photo off the web, move it out of `photos/` and run `minimalgallery sync --prune`.

:::
