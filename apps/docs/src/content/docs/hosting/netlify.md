---
title: Netlify
description: Host a minimal gallery on Netlify from a git repository, what the generated netlify.toml does, how the credit-based free plan applies to a photo gallery, and when to move to Cloudflare.
---

This page sets up a gallery on Netlify: importing the repository, the `netlify.toml` the scaffold writes, the free plan’s credits, a custom domain, and when to move to Cloudflare. Netlify works, but it is not recommended for large or busy galleries: its free plan has a monthly credit budget, and when the credits run out the site goes offline until the next month.

## Import the repository

1. Push the gallery to a new repository on GitHub, GitLab, Bitbucket or Azure DevOps. Commit the lockfile your package manager wrote.
2. In Netlify, select **Add new project**, then **Import an existing project**, choose your Git provider, authorize Netlify and pick the repository.
3. Netlify reads `netlify.toml` from the repository, so the build command and the publish directory are already set. Leave the base directory empty unless the gallery is in a subfolder of the repository.
4. Select **Publish**. The site appears at `https://<project>.netlify.app`.

From then on, `npm run publish` processes new photos, commits the photos, manifests and resized copies, and pushes. Each push to the production branch starts a production deploy. The scaffold sets `"minimalgallery": { "publish": "git" }` in `package.json` for Netlify.

## netlify.toml

The scaffold writes this file when you pick Netlify. With npm it reads:

```toml title="netlify.toml"
# Netlify builds the site from the committed photos, manifests and resized
# copies. Photos are processed on your computer, never here.
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "24"

[[headers]]
  for = "/_mg/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

# Astro’s build assets carry a content hash in their names, so they never change.
[[headers]]
  for = "/_astro/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

- `command` runs `astro build`, which reads the committed manifests and resized copies. No photo is processed on Netlify.
- `publish` is the folder Netlify serves.
- `NODE_VERSION` pins Node.js 24.
- The two `[[headers]]` rules let browsers keep the resized photos and Astro’s build files for a year. Their names change whenever their content does, so a cached copy is never out of date. HTML pages keep Netlify’s default and are always checked.

Netlify picks the package manager from the lockfile: `pnpm-lock.yaml` runs pnpm, `yarn.lock` runs Yarn, `bun.lockb` runs Bun, and anything else runs npm. For pnpm and Yarn, it installs the version named in the `packageManager` field of `package.json`, and otherwise its own default (pnpm 10, Yarn 1).

Netlify’s Pretty URLs setting, on by default, redirects a URL without its trailing slash, like `/japan-2025`, to `/japan-2025/`, which matches the gallery’s `trailingSlash: 'always'`.

## The free plan’s credits

Accounts created since September 4, 2025 are on Netlify’s credit-based plans. The Free plan has 300 credits a month, and a gallery spends them on:

| Usage                                             | Credits |
| ------------------------------------------------- | ------- |
| A production deploy (each publish)                | 15      |
| 1 GB of bandwidth                                 | 20      |
| 10,000 requests                                   | 2       |
| Build minutes, deploy previews and branch deploys | 0       |

The Free plan cannot buy more credits. When a team’s credits run out, every project of that team is paused and shows a “Site not available” page until the credits renew.

For a photo gallery the budget is small. Ten publishes in a month cost 150 credits, which leaves 150 credits, or 7.5 GB of bandwidth. Even with no deploys, 300 credits pay for 15 GB, about 50,000 views of a large photo at 300 KB each, before pages and thumbnails. A link that is widely shared can use up the month’s credits and pause the site until the next month.

Accounts created before September 4, 2025 stay on Netlify’s legacy plans unless they switch. See Netlify’s [How credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) for the current costs.

## Custom domain

In the project, open **Domain management** > **Production domains**, select **Add a domain**, then **Add a domain you already own**. Either let Netlify DNS manage the domain, or keep your DNS provider and point a CNAME record for a subdomain (such as `photos.example.com`) at `<project>.netlify.app`. Netlify recommends a subdomain when the DNS stays elsewhere. Then set `site` in `astro.config.mjs` to the new address, and commit and push.

See Netlify’s [Configure external DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/) for apex domains and the `www` subdomain.

## When to move to Cloudflare

Move the gallery to [Cloudflare](/hosting/cloudflare/) when:

- the team’s usage page shows the credits running low before the month ends;
- you publish often, since each publish costs 15 credits;
- `npm run doctor` says to plan bucket mode: Netlify has no bucket mode, and Cloudflare’s planned one runs on R2;
- the gallery might get a burst of visitors, which would pause it on Netlify.

The move keeps the repository as it is:

1. Add `wrangler.jsonc` and `public/_headers` to the gallery, as shown on the [Cloudflare](/hosting/cloudflare/) page, and add Wrangler with `npm install --save-dev wrangler`.
2. Connect the repository to a Worker with Workers Builds, and check the site on its `workers.dev` address.
3. Move the custom domain: remove it from the Netlify project, then add it to the Worker as a custom domain. Cloudflare needs the domain’s DNS on Cloudflare.
4. Delete the Netlify project, or leave it disconnected, and remove `netlify.toml`.

`npm run publish` keeps publishing with git, so nothing changes in how you add photos.
