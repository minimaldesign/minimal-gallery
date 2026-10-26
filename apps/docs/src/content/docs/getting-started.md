---
title: Getting started
description: Create a gallery, add your photos, preview it on your computer and publish it, step by step.
---

This page takes you from nothing to a gallery online: create the project, add photos, look at it on your computer, make it yours and publish it. It is written for a Mac with Lightroom and a terminal you have opened a few times; the commands are the same on Windows and Linux.

## What you need

- **Node.js 22.18 or later.** Download the LTS installer from [nodejs.org](https://nodejs.org) and run it. To check, open Terminal and type `node --version`: it should print `v22.18.0` or a higher number.
- **A free Cloudflare account**, to put the gallery online. You can sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) now or when you first publish. If you would rather use a web host you already have, you need none; see [Putting it online](/hosting/).
- **Photos as JPEG files**, or HEIC files straight from an iPhone. PNG, WebP, AVIF and TIFF work too. Export RAW files as JPEG first.

Terminal is in Applications › Utilities. You type a command, press Return, and wait for the prompt to come back before typing the next one.

## 1. Create the gallery

In Terminal, run:

```sh
npm create minimalgallery@latest
```

The gallery folder is created inside the folder Terminal is in, which is your home folder in a new window. To put it somewhere else, move there first, for example with `cd Pictures`.

It asks a few questions. Press Return to accept the answer it suggests.

- **Where should the gallery go?** The folder’s name, `mg` by default. It must be new or empty. On Cloudflare the folder name also becomes the site’s name, so `mg` is published at an address like `mg.<your-subdomain>.workers.dev`.
- **Gallery name.** The title at the start of the breadcrumb on every page and in the browser tab. `Photos` by default; you can change it later.
- **Your name.** Shown as the gallery’s author. Leave it empty to skip it.
- **Where will it live?** Cloudflare (free, published from your computer with one command) or “My own host”, which builds a folder you upload to any web host yourself. This decides what `npm run publish` does later. See [Putting it online](/hosting/).
- **How big is your photo library?** Cloudflare only. “Up to about 3,000 photos” keeps the resized photos with the site, which is free. “More than that” adds photo storage on Cloudflare, which needs your own domain and a payment method on your Cloudflare account; see [Photo storage](/hosting/photo-storage/). The count depends on the size of your photos; see [How many photos fit](/hosting/#how-many-photos-fit).
- **Package manager.** Keep `npm` unless you know you want another one.

It then writes the project and installs its packages, which takes a minute or two. The new folder holds:

| File or folder | What it is |
| --- | --- |
| `photos/` | Your photos, one folder per album. |
| `minimalgallery.config.ts` | The gallery’s name, author, address and viewer defaults. |
| `package.json` | The commands you run: `npm run admin`, `npm run publish`, `npm run doctor`. |
| `astro.config.mjs`, `src/` | The site’s pages. You can leave them as they are. |
| `wrangler.jsonc`, `public/_headers` | Cloudflare only: the site’s name on Cloudflare and its cache rules. |
| `.env.example` | Where secret keys would go. Only photo storage needs one. |
| `Open minimalgallery.command` | macOS only: double-click it to open the gallery next time. |

It ends by printing the next commands to run.

## 2. Add your first album

Add an album before you start the preview: with an empty `photos/` folder, the preview has nothing to show.

An album is a folder inside `photos/`. In Finder, open the gallery folder and drag a folder of photos into `photos/`. The folder’s name becomes the album’s title (`kyoto-temples` becomes “Kyoto temples”), and an album can hold other albums. Photos placed directly in `photos/`, outside any album folder, are skipped.

Your originals are never changed. Resized copies go to `public/_mg/`, and what the site reads about each photo (title, date, camera, dominant color) goes to `.minimalgallery/`.

## 3. Open the preview

Move into the gallery folder and start the preview:

```sh
cd mg
npm run admin
```

It opens the admin in your browser, at `http://localhost:4800/admin/`, with a checklist for your first steps. The admin processes the photos in `photos/` and keeps watching that folder. From it you can drop in photos and folders, edit titles, captions and albums, change the settings and publish, and its Preview button opens the gallery as visitors will see it. The first start resizes every photo before the browser opens. Each photo becomes up to five copies, so a large folder takes a few minutes, and Terminal prints one line when it is done. Later starts skip photos that have not changed.

The preview runs as long as that Terminal window stays open. Press Ctrl+C in it to stop.

On macOS you can double-click `Open minimalgallery.command` in the gallery folder instead. It opens a Terminal window, installs the packages if they are missing, and starts the same preview. Close the window to stop it.

## 4. Add more photos

While the preview runs, anything you put in `photos/` is processed a moment after the last file lands, and the page in your browser reloads to show it. Deleting a photo or an album folder removes its resized copies too.

### From Finder

Drag a folder into `photos/` for a new album, or drag photos into an album’s folder.

### From Terminal

Open a second Terminal window and move into the gallery folder: type `cd` and a space, drag the gallery folder from Finder onto the window, and press Return. Then run:

```sh
npx minimalgallery add ~/Pictures/Export/kyoto
```

It copies the photos into `photos/kyoto/` and processes them. Photos already in the gallery are skipped, a file name that is already taken gets a `-2` suffix, and `.xmp`, `.md` and `.json` files next to a photo come with it. Photos in subfolders of the folder you add all go into the one album. To choose the album’s name, add `--album "japan 2025"`: the folder name is lowercased, with spaces and punctuation turned into underscores, so the photos go to `photos/japan_2025/`.

When the preview is not running, `npx minimalgallery sync` processes new and changed photos. You can also skip that step: `npm run publish` processes them before every publish.

### From Lightroom

Titles, captions, keywords, ratings, capture dates and places come from the photos’ own metadata, so an export that includes it needs no further work and no sidecar files. In the Export dialog of Lightroom Classic:

| Section | Setting |
| --- | --- |
| Export Location | Export To: Specific folder, the gallery’s `photos` folder. Put in Subfolder: the album’s name. |
| File Settings | Image Format: JPEG, Quality 90 or more. Color Space: sRGB. Adobe RGB and Display P3 also work: each photo is converted from its embedded profile. |
| Image Sizing | Resize to Fit: Long Edge, 3200 pixels, or leave it off for full size. The largest copy the site makes is 3200 pixels on the long edge. |
| Metadata | Include: All Metadata. Leave Remove Location Info unchecked to keep places and GPS positions. |

Save these settings as a preset (Add, at the bottom left of the dialog) and change only the subfolder name for each new album. With the preview or `npx minimalgallery watch` running, each export appears in the gallery a few seconds after Lightroom finishes it. Export size does not change what is published: the exports stay on your computer, and only their resized copies go online.

The fields map like this:

| In Lightroom | In the gallery |
| --- | --- |
| Title | The photo’s title. Without one, the title comes from the file name. |
| Caption | The caption in the information pane. |
| Keywords | Keyword pages and filters. |
| Star rating | Rating. |
| Capture Time | Date, sorting and the year, month and day pages. |
| Sublocation, City, State / Province, Country | Place pages and filters. |

To change one of these for a single photo without exporting again, write a sidecar file next to it; see [Sidecars](/reference/sidecars/).

## 5. Look around

The preview is the real site. The home page opens on your newest photo, filling the window. Move the pointer to bring up the controls; they fade after two seconds without movement. Click the right part of the photo for the next one and its left third for the previous one, or use the keyboard:

| Key     | Action                                                    |
| ------- | --------------------------------------------------------- |
| `←` `→` | Previous or next photo                                    |
| `↑`     | Open the photos below the viewer                          |
| `Esc`   | Back to the photo                                         |
| `i`     | Photo information                                         |
| `f`     | Fill the window or fit the whole photo                    |
| `s`     | Filmstrip                                                 |
| `/`     | Filter: albums, years, places, cameras, keywords and more |
| `?`     | Every shortcut                                            |

The breadcrumb at the top left leads back to the album and to the home page. The values in the information pane are links: click an aperture or a place to see every photo that shares it. The full list of shortcuts, touch gestures included, is in [Theme and tokens](/theme/#keyboard-shortcuts).

## 6. Make it yours

### The config file

`minimalgallery.config.ts` holds the gallery’s settings. Open it in a code editor such as [VS Code](https://code.visualstudio.com). TextEdit can turn straight quotes into curly ones, which breaks the file.

```ts title="minimalgallery.config.ts"
import { defineConfig } from '@minimalgallery/pipeline/config';

export default defineConfig({
  name: 'Field notes',
  author: 'Ana Ruiz',
  site: 'https://photos.example.com',
  storage: { mode: 'site' },
  defaults: { fit: 'fit', strip: true, backdrop: 'photo' },
});
```

- `name` is the gallery’s title and `author` is you.
- `site` is the public address, once you have one. It is used for canonical links, the feed and share images.
- `defaults` sets how the viewer starts for a new visitor:

| Key | Values | Default | What it sets |
| --- | --- | --- | --- |
| `fit` | `'fill'`, `'fit'` | `'fill'` | Fill the window, cropping the edges, or show the whole photo. |
| `strip` | `true`, `false` | `false` | The filmstrip along the bottom of the viewer. |
| `crop` | `'square'`, `'original'` | `'square'` | Grid thumbnails as squares or in each photo’s own shape. |
| `view` | `'grid'`, `'list'` | `'grid'` | The photos below the viewer as a grid or as a list with every value. |
| `size` | `1`, `2`, `3` | `2` | Thumbnail size: small, medium or large. |
| `backdrop` | `'neutral'`, `'photo'`, `'light'` | `'neutral'` | Behind the photo: the dark ground, a hint of each photo’s own color, or a pale gray. |

Visitors can change the first five for themselves; your values are where they start. Every other key is in [Configuration](/reference/configuration/).

The preview reads the config file when it starts. After a change, press Ctrl+C in its Terminal window and run `npm run admin` again.

### custom.css

For colors, sizes and timing beyond those defaults, create a file named `custom.css` next to the config file. The theme loads it last, so what you write there wins. Start with the theme’s tokens:

```css title="custom.css"
@layer theme.user {
  :root {
    --mg-ground: oklch(0.1 0 0);
    --mg-hud-idle: 4s;
  }
}
```

This makes the background darker and keeps the controls up for four seconds. The preview shows each change when you save. If you created the file while the preview was running, restart the preview once. [Theme and tokens](/theme/) lists every token and shows how to style the theme’s classes.

## 7. Publish

In the gallery folder, run:

```sh
npm run publish
```

What it does depends on where you said the gallery would live.

### Cloudflare

The first time, it stops and asks you to connect Cloudflare. This is needed once per computer:

```sh
npx wrangler login
```

Your browser opens on Cloudflare. Sign in, or create the free account on the same page, allow access, and go back to Terminal. Run `npm run publish` again. It processes any new photos, shows what it is about to do (build the site, then upload it) and asks “Go ahead?”. Choose Yes: it builds the site into `dist/` and uploads it to Cloudflare. On a new Cloudflare account, it first asks to register a `workers.dev` subdomain: answer yes and type a name, which becomes part of your gallery’s address. The last lines show that address.

Every later publish is the same command, without the login, and sends only what changed. To use your own domain, see [Cloudflare](/hosting/cloudflare/). With photo storage, publish uploads the new photos first; see [Photo storage](/hosting/photo-storage/).

### Your own host

`npm run publish` builds the site into `dist/`. Upload everything in that folder to your host; [Your own host](/hosting/your-own-host/) explains how, and the settings that help.

Either way, the gallery folder is the only copy of your originals and captions: keep it in your backups. See [Backups](/backups/).

## Next time

1. Double-click `Open minimalgallery.command` in the gallery folder, or run `npm run admin` in it.
2. Add albums in Finder, or export from Lightroom into `photos/`.
3. Open a second Terminal window in the gallery folder, as described in [From Terminal](#from-terminal), and run `npm run publish`.

## Upgrading

In the gallery folder, run:

```sh
npx minimalgallery upgrade
```

It updates the minimal gallery packages to their latest versions with the gallery’s package manager, then runs `doctor`. Doctor reports the number of photos and files, the projected size of the published site against the host’s limits, and anything that needs attention, such as RAW files without a JPEG. It changes nothing. Your next publish builds the site with the new version.

## Working from the terminal

The preview is optional. If you prefer Terminal and your own editor, the whole cycle is two commands and a text file. Add photos to an album, where a `/` makes a nested album:

```sh
npx minimalgallery add ~/Pictures/Export/kyoto --album "japan 2025/kyoto"
```

Edit a sidecar next to a photo, here `photos/japan_2025/kyoto/DSC_0412.md`, in any editor. Its fields win over the photo’s own metadata, and its text is the caption:

```md title="photos/japan_2025/kyoto/DSC_0412.md"
---
title: Philosopher’s Path, early
keywords: [canal, cherry blossom]
---

The canal before the crowds.
```

Then publish without the confirmation:

```sh
npx minimalgallery publish --yes
```

`npx minimalgallery sync` processes changes without publishing (`--prune` also removes the copies of deleted photos), `npx minimalgallery watch` runs the folder watcher on its own, and `npm run dev` starts the preview without it. The create command takes its answers as options, for example `npm create minimalgallery@latest mg -- --host cloudflare --yes`. Every command and option is in [Command line](/reference/cli/), and every sidecar field in [Sidecars](/reference/sidecars/).
