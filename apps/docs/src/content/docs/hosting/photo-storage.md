---
title: Photo storage
description: Keep a large library’s resized photos in Cloudflare R2, served from your own domain, so the site stays far below Cloudflare’s file limit.
---

With photo storage, the resized photos live in a storage space of their own on Cloudflare, called R2, and are served from an address of yours such as `media.example.com`. The site holds only the pages. It is for a library of more than [about 3,000 photos](/hosting/#how-many-photos-fit), or one that is growing toward it.

In the config and on the command line, photo storage is called bucket mode: storage services call such a space a bucket. The setting is `storage: { mode: 's3' }`, after S3, the protocol these services share.

## What it costs

- **The first 10 GB are free**, [about 6,500 full-size photos](/hosting/#how-many-photos-fit). Above that, R2 charges $0.015 per GB a month: about 1.5 cents for each further 650 photos.
- **Visitors are free.** R2 does not charge for the photos it serves.
- **Uploads and changes** are free within a monthly allowance (a million writes and ten million reads) that a gallery stays far below.
- **A payment method is required.** Cloudflare asks for one before it turns on R2, even if the gallery stays within the free tier.

## What you need

- A Cloudflare account. The site itself is published to Cloudflare as for a [small library](/hosting/cloudflare/).
- **Your own domain, with its DNS on Cloudflare.** The photos are served from a subdomain of it, such as `media.example.com`. R2 also offers an `r2.dev` address, but it is slowed down on purpose and meant for testing, not for a public gallery.
- R2 turned on in the Cloudflare dashboard, under **R2 Object Storage**, which is where Cloudflare asks for the payment method.

## A new gallery

`npm create minimalgallery@latest` sets up photo storage when you pick Cloudflare and answer “More than that” to “How big is your photo library?”. It then asks for:

- **Bucket name**, `mg-media` by default: the name of the storage space.
- **Media domain**, such as `media.example.com`, the address the photos are served from. You can leave it empty and set it later.
- **R2 access key id** and **secret access key**, the key that lets `npm run publish` upload photos. You can leave them empty and add them later.

If you are logged in to Cloudflare (`npx wrangler login`), it finds your account and creates the bucket. Whatever it could not do is listed at the end, under “Before the first publish”. Usually that is:

1. **Connect the media domain to the bucket.** In the Cloudflare dashboard, open **R2**, the bucket, **Settings**, then **Custom Domains**, and select **Connect Domain**.
2. **Create the access key**, if you skipped it. In the dashboard, open **R2**, then **Manage API tokens**, and create a token with **Object Read & Write** on this bucket only. Cloudflare shows its access key id and secret once. Copy `.env.example` to `.env` in the gallery folder and paste them in:

   ```sh title=".env"
   MG_S3_ACCESS_KEY_ID=…
   MG_S3_SECRET_ACCESS_KEY=…
   ```

   `.env` stays on your computer. Never put the key in `minimalgallery.config.ts`.

3. **Check the setup:**

   ```sh
   npx minimalgallery doctor --bucket
   ```

   It writes a test file to the bucket, reads it back through the media domain and deletes it, and says which step failed if one does.

## An existing gallery

To move a gallery from site mode to photo storage, when `npm run doctor` says so:

1. Turn on R2 and create a bucket in the dashboard, under **R2 Object Storage**.
2. Connect the media domain and create the access key, as in steps 1 and 2 above.
3. Point the gallery at the bucket in `minimalgallery.config.ts`, with your account id (`npx wrangler whoami` prints it), the bucket name and the media domain:

   ```ts title="minimalgallery.config.ts"
   storage: {
     mode: 's3',
     bucket: 'mg-media',
     endpoint: 'https://<account id>.r2.cloudflarestorage.com',
     region: 'auto',
     publicUrl: 'https://media.example.com',
   },
   ```

4. Run `npx minimalgallery doctor --bucket` to check it.
5. Run `npm run publish`. It processes every photo again for the new address, uploads the copies, then builds and uploads the site. The first time takes about as long as the gallery’s first processing did.

Once the site is published this way, the copies in `public/_mg` are no longer used, and you can delete that folder (unless `originals: 'site'` publishes your originals from it).

## Publishing

`npm run publish` works as on a small library, with one more step at the start: it uploads the new resized photos to the bucket, then builds the site and uploads it. Photos are uploaded before the pages that show them, so a published page never points at a missing photo. If the upload fails, nothing else is published.

`npx minimalgallery sync` processes new photos and uploads them without publishing the site.

When you delete photos, their copies stay in the bucket. `npx minimalgallery sync --prune` lists the files no photo uses and asks before deleting them. Keep the bucket for the gallery alone: files of another gallery in it would look unused.

## Hotlink protection

The site’s cache rules in `public/_headers` do not apply to the bucket: publish sets the cache header on each photo it uploads. To stop other sites from showing your photos, write the [WAF custom rule](/hosting/cloudflare/#hotlink-protection) for the media domain instead:

```txt
http.host eq "media.example.com" and http.referer ne "" and not http.referer contains "photos.example.com"
```

## Other storage services

Bucket mode works with any service that speaks S3: Backblaze B2, Amazon S3 or MinIO, with their own `endpoint` and `region`. The scaffold and these pages set up R2 only, since it is free for visitors and comes with Cloudflare hosting. See [Configuration](/reference/configuration/#storage-modes) for the settings.
