---
title: GitHub Pages
description: Host a small minimal gallery on GitHub Pages with the generated GitHub Actions workflow, the right site and base settings, and a custom domain.
---

This page sets up a gallery on GitHub Pages: what to check first, the `site` and `base` settings, the repository settings, the workflow the scaffold writes, a custom domain and the limits. GitHub Pages suits small galleries; for anything near 1 GB, use [Cloudflare](/hosting/cloudflare/).

## Before you start

- **The repository is public.** On a free GitHub account, Pages publishes only from a public repository, and anyone can browse and download what you commit to it. The originals in `photos/` are not committed, only their resized copies and sidecars; see [Originals and git](/hosting/#originals-and-git). GitHub Pro can publish from a private repository; the site itself is public either way.
- **Repo mode only.** The site, resized photos included, must stay under 1 GB. minimal gallery does not set up bucket mode for GitHub Pages: when `npm run doctor` says to move to bucket mode, move the gallery to Cloudflare.
- **No cache headers.** GitHub Pages does not let a site set its own headers. See [Cache headers](#cache-headers).
- **Not for a business.** GitHub does not allow Pages to be used as free hosting for an online business, or for a site mainly meant for commercial transactions.

## Set the site address

GitHub Pages serves a project site from a subfolder, `https://<user>.github.io/<repo>/`, so Astro has to know that folder before it builds. Set `site` and `base` in `astro.config.mjs`. The scaffold writes both lines commented out:

```js title="astro.config.mjs"
export default defineConfig({
  // GitHub Pages serves a project at https://<user>.github.io/<repo>/:
  site: 'https://<user>.github.io',
  base: '/<repo>',
  output: 'static',
  trailingSlash: 'always',
  // …
});
```

| Address | `site` | `base` |
| --- | --- | --- |
| `https://<user>.github.io/<repo>/`, a project site | `'https://<user>.github.io'` | `'/<repo>'` |
| `https://<user>.github.io/`, from a repository named `<user>.github.io` | `'https://<user>.github.io'` | none |
| A custom domain, such as `https://photos.example.com/` | `'https://photos.example.com'` | none |

With `base` set, every link, photo URL, stylesheet and script starts with `/<repo>/`. Without it, a project site’s pages ask the domain root for their styles, scripts and photos, and show none of them.

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

   `-b main` names the branch `main`, which is the branch the workflow listens to. Without it, `git init` still names the first branch `master` on many computers.

3. In the repository, open **Settings** > **Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab, select **Deploy to GitHub Pages**, and select **Run workflow**. If the run started by the first push failed because Pages was not on yet, this one publishes the site. The run’s summary shows the address.

From then on, `npm run publish` processes new photos, commits the manifests, resized copies and sidecars (not the originals), and pushes. The workflow builds and deploys the new version, and you can follow it in the **Actions** tab. The scaffold sets `"minimalgallery": { "publish": "git" }` in `package.json` for GitHub Pages.

## The workflow

The scaffold writes `.github/workflows/deploy.yml`. With npm it reads:

```yaml title=".github/workflows/deploy.yml"
# Builds the site from the committed photos, manifests and resized copies,
# and publishes it to GitHub Pages. In the repository settings, under Pages,
# set the source to GitHub Actions.
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
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
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- It runs on every push to `main`, and from the **Actions** tab (`workflow_dispatch`). If your branch is `master`, change `branches: [main]` to `branches: [master]`.
- `npm ci` installs exactly what `package-lock.json` lists, so commit that file. With pnpm, Yarn or Bun, the scaffold writes that package manager’s install step instead, and its lockfile must be committed too.
- `npm run build` runs `astro build`, which reads the committed manifests and resized copies. No photo is processed on GitHub.
- The last two steps upload `dist/` and publish it to the `github-pages` environment.

With pnpm, the `pnpm/action-setup` step reads the pnpm version from the `packageManager` field of `package.json`. If the field is missing, the step fails; add it with:

```sh
npm pkg set packageManager=pnpm@$(pnpm --version)
```

## Custom domain

1. In **Settings** > **Pages**, enter the domain under **Custom domain** and save.
2. At your DNS provider, point the domain at GitHub. For a subdomain such as `photos.example.com`, add a CNAME record to `<user>.github.io`. For an apex domain such as `example.com`, add A records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`.
3. Once GitHub has found the DNS records, select **Enforce HTTPS**. The option can take up to a day to appear.
4. In `astro.config.mjs`, set `site` to the domain and remove `base`, then commit and push.

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
