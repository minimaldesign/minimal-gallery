---
title: Your own host
description: Build a minimal gallery into a folder and upload it to any web host, with the settings that make it work well there.
---

A minimal gallery is a folder of ordinary files once it is built, so any web host can serve it: a hosting plan you already pay for, your own server, a friend’s. This page covers building that folder, uploading it, and the few settings that help.

## Build the site

When `npm create minimalgallery@latest` asks “Where will it live?”, pick **My own host**. The gallery is then set up to build for your host (`"publish": "build"` in `package.json`), and nothing about Cloudflare is written.

```sh
npm run publish
```

It processes any new photos and builds the whole site into the `dist` folder, inside the gallery folder. You can also use the admin’s Publish page, with **Build for my own host** selected.

## Upload it

Upload everything inside `dist` to the folder your host serves the site from, often called `public_html`, `www` or `htdocs`. Use whatever your host provides: its file manager, an FTP or SFTP app such as Cyberduck or Transmit, or `rsync` if you have SSH access:

```sh
rsync -av --delete dist/ me@example.com:public_html/
```

`--delete` removes files the new build no longer has, such as the copies of a deleted photo. Without it they stay on the server, unused.

Resized photos keep their names until the photo itself changes, so after the first upload, an app that only sends new and changed files sends little.

## What your host needs to do

Most hosts do all of this already:

- **Serve `index.html` for a folder address.** Every page of the gallery is a folder with an `index.html` file, such as `japan-2025/index.html` for `/japan-2025/`.
- **Show `404.html` for an address that does not exist**, with a 404 status.
- **Redirect an address without its trailing slash**, such as `/japan-2025`, to `/japan-2025/`.

Then set `site` in `minimalgallery.config.ts` to the gallery’s address, such as `https://photos.example.com`, so the feeds, the sitemap and link previews point to it.

## Cache rules

The resized photos and the site’s styles and scripts never change at a given address: a new version gets a new name. A browser can keep them for a year instead of asking for them again on every visit. The gallery works without this rule, but pages a visitor has seen before load faster with it.

On Apache, which most shared hosting runs, add a file named `.htaccess` to the gallery’s `public` folder. Each build copies it into `dist`.

```apache title="public/.htaccess"
ErrorDocument 404 /404.html

<IfModule mod_headers.c>
  <If "%{REQUEST_URI} =~ m#^/(_mg|_astro)/#">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </If>
</IfModule>
```

On nginx, add this to the site’s `server` block:

```nginx
location ~ ^/(_mg|_astro)/ {
  add_header Cache-Control "public, max-age=31536000, immutable";
}
error_page 404 /404.html;
```

For another server, ask your host how to set a `Cache-Control` header on the `/_mg/` and `/_astro/` folders.

## Limits

minimal gallery sets none on your own host, and `npm run doctor` skips Cloudflare’s file limit for a gallery built this way. Check your plan’s disk space: each full-size photo adds about 1.5 MB of resized copies. See [How many photos fit](/hosting/#how-many-photos-fit).
