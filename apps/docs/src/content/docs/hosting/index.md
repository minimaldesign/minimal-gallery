---
title: Hosting
description: Which host to pick for a minimal gallery, the free limits that matter for photos, repo mode and bucket mode, and the two ways to publish.
---

A minimal gallery is a static site: your computer processes the photos, and the host only builds the HTML and serves files. This page compares the three hosts the scaffold sets up, explains where the resized photos live, and describes the two ways to publish.

## Which host

- **Cloudflare** is recommended. Static files are served with no bandwidth charge, a deploy can hold 20,000 files, and bucket mode on Cloudflare R2 is planned for galleries that outgrow that. See [Cloudflare](/hosting/cloudflare/).
- **GitHub Pages** is fine for small galleries. The published site is limited to 1 GB, the repository must be public on a free account, and there is no bucket mode. See [GitHub Pages](/hosting/github-pages/).
- **Netlify** works, but is not recommended for large galleries. Its free plan is paid in credits, and a gallery spends them on bandwidth and on every publish; when they run out, the site is paused until the next month. See [Netlify](/hosting/netlify/).

Vercel is not supported: its free Hobby plan is for non-commercial, personal use only.

Pick the host when `npm create minimalgallery@latest` asks “Where will it live?”. The scaffold writes that host’s config file and sets how `npm run publish` publishes. “Just build it locally” writes no host config: `npm run publish` builds the site into `dist/`, and you upload that folder to any static host.

## Free limits that matter for a photo gallery

|  | Cloudflare | GitHub Pages | Netlify |
| --- | --- | --- | --- |
| Files per site | 20,000 per deploy | No published limit | No published limit |
| Site size | No total limit | 1 GB | No published limit |
| Bandwidth | Unlimited for static files | 100 GB a month, a soft limit | 20 credits per GB, out of 300 credits a month |
| Builds | 3,000 build minutes a month, 20 minutes per build | Free on public repositories; a deploy times out after 10 minutes | Build minutes are not counted; each production deploy costs 15 credits |
| File size | 25 MiB per file | 100 MiB per file in the repository | No published limit |
| Cache headers | Yes, with `_headers` | No | Yes, in `netlify.toml` |
| Bucket mode | Planned (R2) | No | No |

Each photo adds one HTML page and, in repo mode, about five resized files of about 1.5 MB in total for a 24-megapixel original. Each album and each facet value (a year, a camera, a keyword) adds an HTML page and a JSON file. `npm run doctor` counts all of them for your gallery.

## Repo mode and bucket mode

In **repo mode** (the default and, for now, the only mode), the pipeline writes the resized copies to `public/_mg/` and one manifest per photo to `.minimalgallery/manifest/`. Both are committed with the `photos/` folder, and the host deploys the resized copies with the pages. Nothing else is needed: no storage account, no keys.

In **bucket mode**, the resized copies go to an S3-compatible bucket such as Cloudflare R2, served from a subdomain like `media.example.com`. The repository keeps the photos, the manifests and the code, and the deploy holds only the pages, so a gallery can grow far past the file and size limits above.

:::caution[Not built yet]

Bucket mode is not available yet: the s3 storage adapter rejects every write. Every gallery runs in repo mode for now.

:::

`npm run doctor` tells you when repo mode is getting tight. It projects the number of files in the deploy and the size of the resized copies, and prints one of three verdicts:

- “Repo mode is fine.”
- Plan the move to bucket mode: past 500 photos or 500 MB of resized copies.
- Move to bucket mode: the deploy is over 20,000 files, or the resized copies are over 1 GB.

Until bucket mode ships, the way to make each photo smaller is the derivative ladder: fewer or smaller variants per photo. See [Configuration](/reference/configuration/). Changing the ladder re-encodes every photo.

## Why processing never runs on the host

The pipeline reads every original, converts its colors and encodes five resized copies, mostly AVIF. That takes a few seconds per photo on a recent computer. On a host’s build machine it would run again on every build, need every original on that machine, and a gallery of a few thousand photos would run past the free build time limits.

So the work happens once, on your computer, and only for new or changed photos. The host’s build runs `astro build`, which reads the committed manifests and writes the pages. It never opens an original and never encodes an image.

## Two ways to publish

| Method | Command | What it does | Hosts |
| --- | --- | --- | --- |
| Git | `minimalgallery publish --git` | Processes new photos, commits the gallery’s changes and pushes. The host builds and deploys the site from the repository. | Cloudflare, GitHub Pages, Netlify |
| Direct upload | `minimalgallery publish --deploy` | Processes new photos, builds the site on your computer and uploads `dist/` with `wrangler deploy`. No git repository needed. | Cloudflare |

`npm run publish` runs `minimalgallery publish`, and the `minimalgallery.publish` field in `package.json` picks the method: `"git"`, `"deploy"` or `"build"` (build into `dist/` and stop). The scaffold sets `"deploy"` for Cloudflare, `"git"` for GitHub Pages and Netlify, and `"build"` for a local build. Both methods show what they are about to do and ask before they push or upload; `--yes` skips the question. See [Command line](/reference/cli/).

Git is the better default when you already use GitHub or GitLab: every published version is a commit, and the host builds it. Direct upload suits a gallery that lives only on your computer.

## Custom domains

Each host serves the gallery on its own address first (`*.workers.dev`, `*.github.io`, `*.netlify.app`). Whichever host you use, set `site` in `astro.config.mjs` to the final address so canonical links and share images point to it.

**Cloudflare:** the domain’s DNS must be on Cloudflare, in your account. Add the domain to the Worker as a custom domain, in the dashboard or in `wrangler.jsonc`, and Cloudflare creates the DNS record and the certificate. See [Custom domain](/hosting/cloudflare/#custom-domain) and Cloudflare’s [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) docs.

**GitHub Pages:** enter the domain in the repository’s Pages settings, then point a CNAME record (for a subdomain) or four A records (for an apex domain) at GitHub. See [Custom domain](/hosting/github-pages/#custom-domain) and GitHub’s [Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) docs.

**Netlify:** add the domain under **Domain management**, then use Netlify DNS or point a record at the project’s `netlify.app` address from your DNS provider. See [Custom domain](/hosting/netlify/#custom-domain) and Netlify’s [domain docs](https://docs.netlify.com/manage/domains/get-started-with-domains/).
