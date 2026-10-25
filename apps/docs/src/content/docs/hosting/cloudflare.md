---
title: Cloudflare
description: Publish a minimal gallery to Cloudflare from your computer, with cache headers, a custom domain, the free plan’s limits and hotlink protection.
---

This page covers a gallery on Cloudflare: publishing from your computer, what the scaffold sets up, cache headers, a custom domain, the limits and hotlink protection. It suits a library of [about 3,000 photos](/hosting/#how-many-photos-fit); for more, add [photo storage](/hosting/photo-storage/).

## Publish from your computer

`npm run publish` builds the site on your computer and uploads it to Cloudflare. The scaffold sets this up when you pick Cloudflare (`"publish": "deploy"` in `package.json`). You can also publish from the admin’s Publish page, which runs the same command.

```sh
npx wrangler login
npm run publish
```

The first time:

1. `npx wrangler login` opens your browser on Cloudflare. Sign in, or create a free account on the same page, then allow access. You do this once per computer.
2. `npm run publish` processes new photos, shows the plan (`astro build`, then `wrangler deploy`) and asks before it goes ahead. Pass `--yes` to skip the question: `npm run publish -- --yes`.
3. On a new Cloudflare account, `wrangler deploy` asks to register a `workers.dev` subdomain. Answer yes and type a name: it becomes the address of everything you publish on this account, `https://my-gallery.<name>.workers.dev` for this gallery.
4. The first upload creates the Worker, and the last lines show the gallery’s address.

Later publishes send only new or changed files. Cloudflare keeps every version you deploy: `npx wrangler rollback` in the gallery folder puts the previous one back.

The `deploy` script (`npm run deploy`) runs `astro build && wrangler deploy` without processing new photos first. Use `npm run publish` unless you know every photo is already processed.

To publish from an automated build service instead, such as GitHub Actions, run `npm run deploy` there with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` set as secrets. `.env.example` lists both. The service needs the processed photos (`.minimalgallery/manifest` and `public/_mg`), since it does not process any.

## What the scaffold sets up

Cloudflare serves static sites from Workers: its Pages documentation now tells new projects to start with Workers. A gallery is a Worker with no code of its own, only static assets. `wrangler.jsonc` names the Worker and points it at `dist/`, the folder `astro build` writes. Requests for static files are free and unlimited, on the free plan too.

The scaffold writes this file when you pick Cloudflare:

```jsonc title="wrangler.jsonc"
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-gallery",
  "compatibility_date": "2026-10-23",
  "assets": { "directory": "./dist", "not_found_handling": "404-page" },
}
```

- `name` is the Worker’s name. The first deploy serves the gallery at `https://my-gallery.<your-subdomain>.workers.dev`. The scaffold makes it from the folder name, in lowercase letters, digits and dashes.
- `assets.directory` is the folder that is uploaded.
- `not_found_handling: "404-page"` answers an unknown URL with the nearest `404.html` and a 404 status. Workers does not guess this from the files, so it has to be set.

With the default HTML handling, a URL without its trailing slash, like `/japan-2025`, redirects to `/japan-2025/`, which matches the gallery’s `trailingSlash: 'always'`.

The scaffold also adds `wrangler` to the gallery’s `devDependencies`, so every computer and every build uses the same version.

## Cache headers

The scaffold writes `public/_headers`. Astro copies it into `dist/`, and Cloudflare reads it on deploy; the file itself is not served.

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

Without these rules, Cloudflare sends `Cache-Control: public, max-age=0, must-revalidate` for every file, so the browser asks again for each photo, stylesheet and script every time it uses them. The resized photos and Astro’s files never change at a given URL (a new version gets a new name), so the browser can keep them for a year. HTML pages keep the default and are always checked.

A `_headers` file can hold 100 rules, of up to 2,000 characters per line.

## Custom domain

The gallery can run on your own domain as a Worker custom domain. The domain’s DNS must be on Cloudflare, as an active zone in your account.

In the dashboard, open the Worker, go to **Settings** > **Domains & Routes**, select **Add**, then **Custom domain**, and enter the hostname. Or declare it in `wrangler.jsonc`, so every deploy keeps it:

```jsonc title="wrangler.jsonc"
{
  "name": "my-gallery",
  "compatibility_date": "2026-10-23",
  "routes": [
    { "pattern": "photos.example.com", "custom_domain": true },
    { "pattern": "www.photos.example.com", "custom_domain": true },
  ],
  "assets": { "directory": "./dist", "not_found_handling": "404-page" },
}
```

Cloudflare creates the DNS record and the certificate. A hostname that already has a CNAME record cannot become a custom domain: delete that record first.

Then set `site` in `minimalgallery.config.ts` to the new address, for canonical links, the feeds and share images:

```ts title="minimalgallery.config.ts"
export default defineConfig({
  name: 'Photos',
  site: 'https://photos.example.com',
});
```

See Cloudflare’s [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) docs for the details.

## Limits

On the Workers free plan:

- **20,000 files per deploy** (100,000 on Workers Paid), [about 3,000 full-size photos](/hosting/#how-many-photos-fit). Every photo page, every album and filter page with its JSON file and, in repo mode, every resized copy counts. `npm run doctor` projects the count and the number of photos left before the limit. Past it, add [photo storage](/hosting/photo-storage/).
- **25 MiB per file.** Resized copies are far below it. An original published with `originals: 'repo'` can be larger (a big TIFF, for example), and the deploy then fails.

Static file requests and bandwidth are not limited.

## Hotlink protection

Hotlinking is another site showing your photos with an `<img>` that points at your domain. There are two ways to stop it, and both work on your custom domain only, not on `workers.dev`:

- **Hotlink Protection**, a switch in the zone’s security settings. It only covers files ending in `.gif`, `.ico`, `.jpg`, `.jpeg` and `.png`: it protects the JPEG copy each photo has, not the AVIF copies the gallery shows.
- **A WAF custom rule**, which covers every resized copy. The free plan allows five custom rules. Create one with the action **Block** and this expression, with your own hostname:

  ```txt
  starts_with(http.request.uri.path, "/_mg/") and http.referer ne "" and not http.referer contains "photos.example.com"
  ```

  Requests with no referrer stay allowed, as with Hotlink Protection: some browsers and privacy tools send none, and a direct visit to a photo URL has none either.

See Cloudflare’s [Hotlink Protection](https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/) and [Create a custom rule](https://developers.cloudflare.com/waf/custom-rules/create-dashboard/) docs.
