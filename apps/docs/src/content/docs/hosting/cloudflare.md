---
title: Cloudflare
description: Publish a minimal gallery to Cloudflare from your computer, with cache headers, a custom domain, the free plan’s limits and hotlink protection.
---

This page covers publishing a gallery to Cloudflare, using your own domain, Cloudflare’s limits, and stopping other sites from showing your photos. Cloudflare on its own holds [about 3,000 photos](/hosting/#how-many-photos-fit); for more, add [photo storage](/hosting/photo-storage/).

## Publish from your computer

`npm run publish` builds the site on your computer and uploads it to Cloudflare. This is set up when you pick Cloudflare while creating the gallery. You can also publish from the admin’s Publish page, which does the same thing.

```sh
npx wrangler login
npm run publish
```

The first time:

1. `npx wrangler login` opens your browser on Cloudflare. Sign in, or create a free account on the same page, then allow access. You do this once per computer.
2. `npm run publish` processes new photos, shows what it’s about to do and asks before it goes ahead. To skip the question, run `npm run publish -- --yes`.
3. On a new Cloudflare account, it asks you to register a `workers.dev` subdomain. Answer yes and type a name. It becomes part of the address of everything you publish on this account: `https://mg.<name>.workers.dev` for a gallery named `mg`.
4. The last lines show the gallery’s address.

Later publishes send only new or changed files. Cloudflare keeps every version you publish: to go back to the previous one, run `npx wrangler rollback` in the gallery folder.

`npm run deploy` builds and uploads the site without processing new photos first. Use `npm run publish` unless you know every photo is already processed.

To publish from an automated build service instead, such as GitHub Actions, run `npm run deploy` there with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` set as secrets. `.env.example` lists both. The service needs the processed photos (`.minimalgallery/manifest` and `public/_mg`), since it does not process any.

## What gets set up

On Cloudflare, the gallery is a Worker: Cloudflare’s name for a site or app it runs. A gallery’s Worker has no code, only the site’s files, which Cloudflare serves for free, without limits.

When you pick Cloudflare, `npm create minimalgallery` writes this file:

```jsonc title="wrangler.jsonc"
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "mg",
  "compatibility_date": "2026-10-23",
  "assets": { "directory": "./dist", "not_found_handling": "404-page" },
}
```

- `name` is the Worker’s name, made from the gallery folder’s name. The gallery is served at `https://<name>.<your-subdomain>.workers.dev`.
- `assets.directory` is the folder that is uploaded: `dist`, where the site is built.
- `not_found_handling: "404-page"` shows the gallery’s “page not found” page for an address that doesn’t exist.

An address without its final slash, like `/japan-2025`, is redirected to `/japan-2025/`.

It also installs `wrangler`, Cloudflare’s command-line tool, in the gallery folder, so every computer uses the same version.

## Cache headers

`npm create minimalgallery` also writes `public/_headers`, which tells Cloudflare how long browsers may keep each file. It is copied into `dist` with the site, and Cloudflare reads it when you publish.

```txt title="public/_headers"
# Resized photos are content-addressed (<hash8>-<variant>), so they never change.
/_mg/*
  Cache-Control: public, max-age=31536000, immutable

# Astro’s build assets (CSS, the theme script, fonts) carry a content hash in
# their names, so they never change either. Without this rule the host serves
# them with max-age=0, and browsers fetch the CSS and script again on every page.
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
```

Without these rules, the browser checks with Cloudflare again for every photo, stylesheet and script each time it shows them. The resized photos and the site’s styles and scripts never change at a given address (a new version gets a new name), so the browser can keep them for a year. Pages are always checked, so visitors see your latest publish.

## Custom domain

The gallery can use your own domain, such as `photos.example.com`. The domain must be added to your Cloudflare account, with Cloudflare managing its DNS.

In the dashboard, open the Worker, go to **Settings** > **Domains & Routes**, select **Add**, then **Custom domain**, and enter the hostname. Or declare it in `wrangler.jsonc`, so every deploy keeps it:

```jsonc title="wrangler.jsonc"
{
  "name": "mg",
  "compatibility_date": "2026-10-23",
  "routes": [
    { "pattern": "photos.example.com", "custom_domain": true },
    { "pattern": "www.photos.example.com", "custom_domain": true },
  ],
  "assets": { "directory": "./dist", "not_found_handling": "404-page" },
}
```

Cloudflare creates the DNS record and the certificate. A hostname that already has a CNAME record cannot become a custom domain: delete that record first.

Then set `site` in `minimalgallery.config.ts` to the new address, so feeds and link previews use it:

```ts title="minimalgallery.config.ts"
export default defineConfig({
  name: 'Photos',
  site: 'https://photos.example.com',
});
```

See Cloudflare’s [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) docs for the details.

## Limits

On the Workers free plan:

- **20,000 files per site** (100,000 on the paid plan), [about 3,000 full-size photos](/hosting/#how-many-photos-fit). Every page counts, and so does every resized copy, unless you use photo storage. `npm run doctor` shows your count and how many more photos fit. Past the limit, add [photo storage](/hosting/photo-storage/).
- **25 MiB per file.** Resized copies are far smaller. An original you choose to publish with `originals: 'site'` can be larger (a big TIFF, for example), and publishing then fails.

The number of visitors and the amount of data they download are not limited.

## Hotlink protection

Hotlinking is another site showing your photos on its pages by loading them from your gallery. There are two ways to stop it. Both work only on your own domain, not on a `workers.dev` address:

- **Hotlink Protection**, a switch in your domain’s security settings on Cloudflare. It only covers JPEG, PNG and GIF files, so it protects each photo’s JPEG copy but not the AVIF copies the gallery shows.
- **A custom rule in Cloudflare’s firewall (WAF)**, which covers every resized copy. The free plan allows five custom rules. Create one with the action **Block** and this expression, with your own domain:

  ```txt
  starts_with(http.request.uri.path, "/_mg/") and http.referer ne "" and not http.referer contains "photos.example.com"
  ```

  It still lets through requests that don’t say which page they come from, as Hotlink Protection does: some browsers and privacy tools never say, and someone opening a photo’s address directly doesn’t either.

See Cloudflare’s [Hotlink Protection](https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/) and [Create a custom rule](https://developers.cloudflare.com/waf/custom-rules/create-dashboard/) docs.
