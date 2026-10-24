---
title: GitHub Pages
description: Host a small minimal gallery on GitHub Pages with the generated GitHub Actions workflow, which sets the site’s address for you, and a custom domain.
---

This page sets up a gallery on GitHub Pages: what to check first, the site’s address, the repository settings, the workflow the scaffold writes, a custom domain and the limits. GitHub Pages suits small galleries; for anything near 1 GB, use [Cloudflare](/hosting/cloudflare/).

## Before you start

- **The repository is public.** On a free GitHub account, Pages publishes only from a public repository, and anyone can browse and download what you commit to it. The originals in `photos/` are not committed, only their resized copies and sidecars; see [Originals and git](/hosting/#originals-and-git). GitHub Pro can publish from a private repository; the site itself is public either way.
- **Repo mode only.** The site, resized photos included, must stay under 1 GB. minimal gallery does not set up bucket mode for GitHub Pages: when `npm run doctor` says to move to bucket mode, move the gallery to Cloudflare.
- **No cache headers.** GitHub Pages does not let a site set its own headers. See [Cache headers](#cache-headers).
- **Not for a business.** GitHub does not allow Pages to be used as free hosting for an online business, or for a site mainly meant for commercial transactions.

## The site address

GitHub Pages serves a project site from a subfolder, `https://<user>.github.io/<repo>/`, so Astro has to know that folder when it builds. The workflow takes care of it: it reads the address from the repository’s Pages settings and passes it to `astro build` as `--site` and `--base`.

| Address | `--site` | `--base` |
| --- | --- | --- |
| `https://<user>.github.io/<repo>/`, a project site | `https://<user>.github.io` | `/<repo>` |
| `https://<user>.github.io/`, from a repository named `<user>.github.io` | `https://<user>.github.io` | `/` |
| A custom domain, such as `https://photos.example.com/` | `https://photos.example.com` | `/` |

With a base, every link, photo URL, stylesheet and script starts with `/<repo>/`. Without one, a project site’s pages would ask the domain root for their styles, scripts and photos, and show none of them.

`astro.config.mjs` keeps `site` and `base` commented out. Builds on your computer (`npm run build`, `npm run preview`) stay at the root, and renaming the repository or adding a custom domain needs no change to the gallery. Set them in `astro.config.mjs` only to build for GitHub Pages somewhere else; the workflow’s values win over them.

## Push the repository and turn on Pages

1. On GitHub, create an empty repository: no README, no license, no `.gitignore` (the gallery has its own).
2. Push the gallery to it from the gallery’s folder:

   ```sh
   git init -b main
   git add .
   git commit -m "First version of the gallery"
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```

   The scaffold has usually done the first three commands already. `-b main` names the branch `main`; the workflow listens to `main` and to `master`, which `git init` without `-b` still names the first branch on many computers.

3. In the repository, open **Settings** > **Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab, select **Deploy to GitHub Pages**, and select **Run workflow**. If the run started by the first push failed because Pages was not on yet, this one publishes the site. The run’s summary shows the address.

From then on, `npm run publish` processes new photos, commits the manifests, resized copies and sidecars (not the originals), and pushes. The workflow builds and deploys the new version, and you can follow it in the **Actions** tab. The scaffold sets `"minimalgallery": { "publish": "git" }` in `package.json` for GitHub Pages.

## The workflow

The scaffold writes `.github/workflows/deploy.yml`. With npm it reads:

```yaml title=".github/workflows/deploy.yml"
# Builds the site from the committed manifests and resized copies, and
# publishes it to GitHub Pages. In the repository settings, under Pages, set
# the source to GitHub Actions.
#
# configure-pages reads the address GitHub serves the site at, which the
# build gets as --site and --base, so a project site
# (https://<user>.github.io/<repo>/), a user site and a custom domain all
# work without editing astro.config.mjs. withastro/action installs with the
# package manager of the committed lockfile, at the version package.json’s
# packageManager names, on Node 24, and keeps Astro’s build cache between
# runs.
name: Deploy to GitHub Pages

on:
  push:
    # The scaffold creates the repository on main; master is for one made
    # with a plain git init.
    branches: [main, master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - id: pages
        uses: actions/configure-pages@v6
      - uses: withastro/action@v6
        with:
          build-cmd: npm run build -- --site "${{ steps.pages.outputs.origin }}" --base "${{ steps.pages.outputs.base_path || '/' }}"

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

- It runs on every push to `main` or `master`, and from the **Actions** tab (`workflow_dispatch`).
- `actions/configure-pages` reads the site’s address from the Pages settings; see [The site address](#the-site-address).
- `withastro/action` picks the package manager from the lockfile, so commit `package-lock.json` (or `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`): without one the run stops. For pnpm and Yarn it installs the version in the `packageManager` field of `package.json`, which the scaffold writes. It sets up Node 24 and keeps Astro’s build cache between runs, so pages whose photos have not changed are not rendered again.
- The build runs `astro build`, which reads the committed manifests and resized copies. No photo is processed on GitHub. With pnpm, Yarn or Bun, the scaffold writes that package manager’s `run build` instead of `npm run build --`.
- The deploy job publishes `dist/` to the `github-pages` environment.

A gallery made before the scaffold wrote `packageManager` installs the latest pnpm, with a warning in the run. To pin it:

```sh
npm pkg set packageManager=pnpm@$(pnpm --version)
```

## Custom domain

1. In **Settings** > **Pages**, enter the domain under **Custom domain** and save.
2. At your DNS provider, point the domain at GitHub. For a subdomain such as `photos.example.com`, add a CNAME record to `<user>.github.io`. For an apex domain such as `example.com`, add A records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`.
3. Once GitHub has found the DNS records, select **Enforce HTTPS**. The option can take up to a day to appear.
4. Run the workflow again (**Actions** > **Deploy to GitHub Pages** > **Run workflow**), or publish: the build reads the new address from the Pages settings, so the feeds, the sitemap and the link previews use the domain. Nothing in the gallery changes.

A site published by a workflow needs no `CNAME` file; GitHub ignores it. See GitHub’s [Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) for the details, including the `www` subdomain and domain verification.

## Limits

- **1 GB published site.** The site holds the pages, the JSON files and the resized copies (and the originals, with `originals: 'repo'`). `npm run doctor` reports the resized copies against 1 GB; the pages add little.
- **Repository size.** GitHub recommends keeping a repository under 1 GB, and strongly under 5 GB. A push with a file over 100 MiB is rejected, and a file over 50 MiB gets a warning. The repository holds about what the site holds, plus the history of every resized copy; the originals stay out of it unless you set `commitOriginals`, which makes it grow several times faster.
- **100 GB of bandwidth a month.** This is a soft limit. Over it, GitHub may email you with suggestions or stop serving the site.
- **10 minutes per deploy.** A deploy that takes longer times out.
- **Build minutes.** GitHub Actions is free for public repositories on GitHub-hosted runners. The limit of 10 Pages builds an hour does not apply to sites published by a workflow.

## Cache headers

GitHub Pages has no way for a site to set its own headers, and it sends `Cache-Control: max-age=600` with every file. A browser reuses a resized photo, stylesheet or script for 10 minutes, then asks GitHub again whether it changed. The answer is a short “not modified” when it has not, but every file costs one request to find out.

On Cloudflare and Netlify, the gallery tells browsers to keep resized photos and Astro’s build files for a year, since their names change whenever their content does. On GitHub Pages a returning visitor checks each file again, so pages and photos they have already seen appear a little later than on the other two hosts. The gallery works the same otherwise.
