---
title: Putting it online
description: The three ways to publish a minimal gallery, chosen by the size of your photo library and where you want it to live.
---

Your computer resizes the photos and builds the site. Publishing puts the result online. There are three ways to do it, and the choice mostly depends on how many photos you have.

## Small library: Cloudflare

- Holds [about 3,000 photos](#how-many-photos-fit).
- Free, however many people visit the gallery.
- Needs one free Cloudflare account. `npm run publish` uploads the gallery from your computer, and later publishes send only what changed.
- The gallery gets an address like `mg.<your name>.workers.dev`, and you can add your own domain.

This is the default. See [Cloudflare](/hosting/cloudflare/).

## Large library: Cloudflare with photo storage

- For more than [about 3,000 photos](#how-many-photos-fit).
- The resized photos go to a separate photo storage space on Cloudflare (R2), served from an address of yours such as `media.example.com`. The site itself holds only the pages, so it stays far below Cloudflare’s limits.
- Free for the first 10 GB of photos, [about 6,500 photos](#how-many-photos-fit). Above that, Cloudflare charges $0.015 per GB a month, about 1.5 cents per 650 photos. Visitors cost nothing, as with a small library.
- Needs your own domain, with its DNS on Cloudflare, and a payment method on your Cloudflare account: Cloudflare asks for one before it turns on R2, even within the free 10 GB.

See [Photo storage](/hosting/photo-storage/).

## Your own host

- Works with any web host: one you already pay for, your own server, a friend’s.
- `npm run publish` builds the whole site into the `dist` folder, and you upload that folder with the tool your host provides.
- The domain, the upload and the server settings are up to you and your host. minimal gallery sets nothing up there.

See [Your own host](/hosting/your-own-host/).

`npm create minimalgallery@latest` asks “Where will it live?” (Cloudflare or your own host) and, on Cloudflare, “How big is your photo library?”. The answers set how `npm run publish` publishes, in `package.json`, and where the resized photos go, in `minimalgallery.config.ts`. Both can change later.

## How many photos fit

The photo counts on these pages are estimates for full-size photos from a recent camera, about 24 megapixels. How many of your photos fit depends on how large they are, because that decides how many files each photo becomes.

### The files each photo becomes

To keep pages fast, minimal gallery makes several resized copies of each photo, and each browser downloads the one that fits its screen: a phone gets a small copy, a large high-resolution display a big one. Most copies are AVIF, which is about half the size of a JPEG of the same quality. One JPEG is kept for the places that cannot show AVIF.

| File | Long edge | Format | What it is for | Made for |
| --- | --- | --- | --- | --- |
| The photo’s page |  | HTML | The photo’s own address, which works without JavaScript | every photo |
| `grid` | 640 px | AVIF | Thumbnails in the grid and the list | every photo |
| `w1280` | 1,280 px | AVIF | The viewer on phones and small windows | photos at least 1,280 px long |
| `w2048` | 2,048 px | AVIF | The viewer on laptops and most desktop screens | photos at least 2,048 px long |
| `w3200` | 3,200 px | AVIF | The viewer on large and high-density screens | photos at least 3,200 px long |
| `jpeg1600` | 1,600 px | JPEG | Link previews, feeds, and browsers that cannot show AVIF | every photo |

A photo never gets a copy larger than itself: the copies marked “every photo” are made at the photo’s own size when it is smaller, and the others are skipped. So:

- a full-size photo, 6,000 by 4,000 pixels, becomes 6 files, about 1.5 MB of copies;
- a photo exported at 1,600 pixels on its long edge becomes 4 files (its page, `grid`, `w1280` and `jpeg1600`);
- a photo exported at 1,200 pixels becomes 3 files.

Each album, and each filter value such as a year, a camera or a keyword, adds 2 more files to the site: a page and a small JSON file. [Configuration](/reference/configuration/#resized-copies) explains how to change the list of copies.

### What that means for each limit

- **On Cloudflare, the limit is a number of files.** A site can hold 20,000 files. At 6 files per photo, with the album and filter pages, that is about 3,000 full-size photos. At 4 files per photo, about 4,500 photos exported at 1,600 pixels.
- **In photo storage, the limit is a size.** The free tier holds 10 GB, and the copies of a full-size photo weigh about 1.5 MB, so about 6,500 full-size photos fit. Smaller photos make fewer and smaller copies, and more of them fit. The pages stay on Cloudflare, at one file per photo.

`npm run doctor` counts your own gallery: the files the site holds, how many more photos fit at your current average, and one of three verdicts:

- “Site mode is fine.”
- “Site mode works today, but the site is getting close to Cloudflare’s 20,000-file limit. Plan to add photo storage (bucket mode) before then.” This comes past 16,000 files.
- “Add photo storage (bucket mode): the site is over Cloudflare’s 20,000-file limit.”

For a gallery built for your own host, doctor skips Cloudflare’s limit.

## Words on these pages

- **The pipeline** is the part of minimal gallery that reads your photos and makes their resized copies. It runs on your computer.
- **Site mode** is the default: the resized photos are published with the site, from the gallery’s `public/_mg` folder. In the config it is `storage: { mode: 'site' }`.
- **Photo storage** keeps the resized photos in a storage space of their own, outside the site. Storage services call such a space a bucket, so the command line and the config call it **bucket mode**: `storage: { mode: 's3' }` in `minimalgallery.config.ts`, after S3, the protocol these services share. Cloudflare’s photo storage service is called R2.
- **`dist`** is the folder each build writes inside the gallery folder. It holds the whole site, and it is what gets uploaded.

## Why the photos are processed on your computer

Making the resized copies takes a few seconds per photo on a recent computer. It happens once, when a photo is new or changed, and the copies are kept in the gallery folder. Building the site afterwards only writes the pages, so it’s quick.

That is also why the gallery folder matters: it holds your originals, your captions and the record of every photo. Keep it in your backups. See [Backups](/backups/).

## Custom domains

Whichever way you publish, set `site` in `minimalgallery.config.ts` to the gallery’s final address, so the feeds, the sitemap and link previews point to it.

- **Cloudflare:** the domain’s DNS must be on Cloudflare. See [Custom domain](/hosting/cloudflare/#custom-domain).
- **Photo storage** needs a domain on Cloudflare too, for the photos’ address. See [Photo storage](/hosting/photo-storage/).
- **Your own host:** follow your host’s instructions.
