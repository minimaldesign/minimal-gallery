---
title: Cloudflare
description: Host a minimal gallery on Cloudflare Workers with static assets, uploaded from your computer or built from a git repository, with cache headers, a custom domain and hotlink protection.
---

This page sets up a gallery on Cloudflare: the Worker the scaffold configures, the two ways to publish (from your computer, the default, or from a git repository with Workers Builds), cache headers, a custom domain, the limits, hotlink protection, and the planned bucket mode on R2.

## Workers with static assets

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

## Publish from your computer

Direct upload builds the site on your computer and sends it to Cloudflare. It needs no git repository and no GitHub account, and it is the scaffold’s default for Cloudflare (`"publish": "deploy"` in `package.json`).

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

To deploy from another CI service (GitHub Actions, for example) rather than Workers Builds, run `npm run deploy` there with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` set as secrets. `.env.example` lists both.

## Publish from git (optional)

With Workers Builds, Cloudflare builds the gallery from a GitHub or GitLab repository: every push to the production branch builds the site and deploys it. Choose it when you want every published version kept as a commit, a copy of the gallery on GitHub or GitLab, or to publish from more than one computer. Nothing goes live without a commit.

1. Push the gallery to a new GitHub or GitLab repository. Commit the lockfile your package manager wrote (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` or `bun.lock`).
2. In the Cloudflare dashboard, open **Workers & Pages**, select **Create application**, choose GitHub or GitLab, and pick the repository. If the Worker already exists (from a direct upload), open it instead and select **Connect** under **Settings** > **Build**.
3. Fill in the build settings:

   | Field | Value |
   | --- | --- |
   | Git branch | The branch you push to, usually `main`. This is the production branch. |
   | Root directory | Empty when the gallery is at the root of the repository; otherwise the gallery’s folder. |
   | Build command | `npm run build` (or `pnpm run build`, `yarn run build`, `bun run build`) |
   | Deploy command | `npx wrangler deploy`, the default |

4. Save and deploy. Every later push to the production branch starts a new build.

The Worker’s name in the dashboard must match `name` in `wrangler.jsonc`, or the build fails.

The build runs `astro build` only. It reads the committed manifests and resized copies, so no photo is processed on Cloudflare. The build image uses Node.js 24 by default; to pin a version, commit a `.node-version` file containing `24`.

Then set the gallery to publish with git, so `npm run publish` commits and pushes instead of uploading. This sets `"minimalgallery": { "publish": "git" }` in `package.json`:

```sh
npm pkg set minimalgallery.publish=git
```

From then on, `npm run publish` processes new photos, commits the photos, manifests and resized copies, and pushes. Cloudflare builds and deploys from there.

:::tip[Keep the build cache]

Under **Settings** > **Build** > **Build cache**, select **Enable**. Cloudflare then keeps `node_modules/.astro` between builds, where Astro stores its incremental build cache, so pages whose photos have not changed are not rendered again. The cache is kept for 7 days after it was last used.

:::

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

Then set `site` in `astro.config.mjs` to the new address, for canonical links and share images:

```js title="astro.config.mjs"
export default defineConfig({
  site: 'https://photos.example.com',
  // …
});
```

See Cloudflare’s [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) docs for the details.

## Limits

On the Workers free plan:

- **20,000 files per deploy** (100,000 on Workers Paid). Every photo page, every album and facet page with its JSON file and, in repo mode, every resized copy counts. `npm run doctor` projects the count and the number of photos left before the limit.
- **25 MiB per file.** Resized copies are far below it. An original published with `originals: 'repo'` can be larger (a big TIFF, for example), and the deploy then fails.
- **Workers Builds:** 3,000 build minutes a month, 20 minutes per build, one build at a time.

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

## Bucket mode on R2

:::caution[Not available yet]

The s3 storage adapter rejects every write in this version, so bucket mode cannot be used yet. This section describes the planned setup.

:::

In bucket mode the resized copies go to a Cloudflare R2 bucket, served from a subdomain such as `media.example.com`, and the deploy holds only the pages. A gallery then stays under 20,000 files far longer: only the HTML pages and JSON files count.

The setup will be:

1. Enable R2 in the Cloudflare dashboard, under **R2 Object Storage**. Cloudflare asks for a payment method before it enables R2, even if the gallery stays within the free tier. Then create an R2 bucket. In the bucket’s **Settings**, under **Custom Domains**, add `media.example.com`. The domain must be a zone in the same Cloudflare account as the bucket. Do not use the bucket’s `r2.dev` address for a public gallery: it is rate limited and meant for development.
2. Create an R2 API token that can read and write the bucket. Its keys go in `MG_S3_ACCESS_KEY_ID` and `MG_S3_SECRET_ACCESS_KEY`, as environment variables or in the gallery’s `.env` file, never in the config. `.env` is not committed.

3. Point the gallery at the bucket in `minimalgallery.config.ts`:

   ```ts title="minimalgallery.config.ts"
   storage: {
     mode: 's3',
     bucket: 'photos',
     endpoint: 'https://<account id>.r2.cloudflarestorage.com',
     region: 'auto',
     publicUrl: 'https://media.example.com',
   },
   ```

`npm run publish` will upload new resized copies to the bucket before it commits or deploys. The R2 free tier includes 10 GB of storage a month, 1 million Class A and 10 million Class B operations a month, and no egress charges.

The rules in `_headers` apply to the Worker’s files only, not to files served from the bucket. For hotlink protection, write the WAF rule for the `media.` hostname:

```txt
http.host eq "media.example.com" and http.referer ne "" and not http.referer contains "photos.example.com"
```
