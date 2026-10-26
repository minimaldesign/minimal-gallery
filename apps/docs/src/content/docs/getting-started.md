---
title: Getting started
description: Create a gallery, add your photos, preview it on your computer and publish it, step by step.
---

This guide walks you through creating a gallery, adding your photos, previewing it on your computer and putting it online.

:::note[Not published yet]

The first release is in preparation. Until it is out, `npm create minimalgallery@latest` doesn’t work yet: the packages are only in the [repository](https://github.com/minimaldesign/minimal-gallery). See [Downloads](/downloads/).

:::

You’ll need to type a few commands in Terminal. If you’re not used to it, don’t worry: each step tells you exactly what to type. The guide is written for a Mac, and the commands are the same on Windows and Linux.

## What you need

- **Node.js 22.18 or later.** Download the LTS installer from [nodejs.org](https://nodejs.org) and run it. To check that it worked, open Terminal and type `node --version`: it should print `v22.18.0` or a higher number.
- **A free Cloudflare account**, to put the gallery online. You can sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) now or when you first publish. If you’d rather use a web host you already have, you don’t need one; see [Putting it online](/hosting/).
- **Your photos as JPEG files**, or HEIC files straight from an iPhone. PNG, WebP, AVIF and TIFF work too. RAW files need to be exported as JPEG from your photo editor first.

Terminal is in Applications › Utilities. Type a command, press Return, and wait until it finishes before typing the next one.

## 1. Create the gallery

In Terminal, run:

```sh
npm create minimalgallery@latest
```

The gallery folder is created inside the folder Terminal is in. In a new Terminal window, that’s your home folder. To put the gallery somewhere else, move there first, for example with `cd Pictures`.

It asks a few questions. Press Return to accept the suggested answer.

- **Where should the gallery go?** The folder’s name, `mg` by default. It must be new or empty. On Cloudflare, the folder name is also the site’s name, so `mg` is published at an address like `mg.<your-subdomain>.workers.dev`.
- **Gallery name.** Shown at the top of every page and in the browser tab. `Photos` by default; you can change it later.
- **Your name.** Shown as the gallery’s author. Leave it empty to skip it.
- **Where will it live?** Cloudflare (free, published from your computer with one command) or “My own host”, which builds a folder you upload to any web host yourself. See [Putting it online](/hosting/).
- **How big is your photo library?** Cloudflare only. “Up to about 3,000 photos” is free. “More than that” adds photo storage on Cloudflare, which needs your own domain and a payment method on your Cloudflare account; see [Photo storage](/hosting/photo-storage/) and [How many photos fit](/hosting/#how-many-photos-fit).
- **Package manager.** Keep `npm` unless you know you want another one.

It then creates the gallery folder and installs what it needs, which takes a minute or two. The new folder holds:

| File or folder | What it is |
| --- | --- |
| `photos/` | Your photos, one folder per album. |
| `minimalgallery.config.ts` | The gallery’s settings: name, author, address and how the viewer starts. |
| `package.json` | The commands you run: `npm run admin`, `npm run publish`, `npm run doctor`. |
| `astro.config.mjs`, `src/` | The site’s pages. You can leave them as they are. |
| `wrangler.jsonc`, `public/_headers` | Cloudflare only: the site’s name on Cloudflare and its cache rules. |
| `.env.example` | Where secret keys would go. Only photo storage needs one. |
| `Open minimalgallery.command` | macOS only: double-click it to open the gallery next time. |

When it’s done, it prints the next commands to run.

## 2. Add your first album

Add an album before you start the preview. With an empty `photos/` folder, there is nothing to show.

An album is a folder inside `photos/`. In Finder, open the gallery folder and drag a folder of photos into `photos/`. The folder’s name becomes the album’s title (`kyoto-temples` becomes “Kyoto temples”). An album can hold other albums. Photos placed directly in `photos/`, outside an album folder, are skipped.

Your original photos are never changed, unless you choose to save titles and captions inside them (see [Sidecars](/reference/sidecars/#saving-edits-inside-the-photo)). The resized copies go to `public/_mg/`, and the details read from each photo (title, date, camera, main color) go to `.minimalgallery/`.

## 3. Open the preview

Move into the gallery folder and start the preview:

```sh
cd mg
npm run admin
```

This opens the admin in your browser, at `http://localhost:4800/admin/`, with a checklist for your first steps. In the admin you can add photos and folders, edit titles, captions and albums, change the settings and publish. Its Preview button shows the gallery the way visitors will see it.

The first time, every photo is resized before the browser opens. Each photo becomes up to five copies, so a large folder takes a few minutes. Terminal prints a line when it’s done. Next time, only new or changed photos are processed.

The preview runs as long as that Terminal window stays open. To stop it, press Ctrl+C in that window.

On a Mac, you can also double-click `Open minimalgallery.command` in the gallery folder. It opens a Terminal window and starts the same preview. Close the window to stop it.

## 4. Add more photos

While the preview runs, anything you put in `photos/` is processed a moment later, and the page in your browser reloads to show it. Deleting a photo or an album folder removes its resized copies too.

### From Finder

Drag a folder into `photos/` for a new album, or drag photos into an album’s folder.

### From your photo editor

Export straight into the gallery’s `photos` folder, with one subfolder per album. Titles, captions, keywords, ratings, dates and places are read from the photos’ metadata, so there’s nothing else to fill in. Most photo editors let you save these export settings as a preset:

| Setting | What to choose |
| --- | --- |
| Destination | The gallery’s `photos` folder, in a subfolder named after the album. |
| Format | JPEG, quality 90 or more. |
| Color space | sRGB. Adobe RGB and Display P3 work too: each photo is converted from its own color profile. |
| Size | 3,200 pixels on the long edge, or full size. The largest copy the gallery makes is 3,200 pixels. |
| Metadata | Include all of it. Keep the location info if you want place pages. |

With the preview running, each export shows up in the gallery a few seconds after it finishes. The exports stay on your computer. Only their resized copies go online, so a larger export doesn’t make the published gallery bigger.

The gallery uses these metadata fields:

| In your photo’s metadata | In the gallery |
| --- | --- |
| Title | The photo’s title. Without one, the file name is used. |
| Caption or description | The caption in the information pane. |
| Keywords | Keyword pages and filters. |
| Star rating | Rating. |
| Capture date | Date, sorting, and the year, month and day pages. |
| Sublocation, city, state or province, country | Place pages and filters. |

To change one of these for a single photo without exporting it again, edit it in the admin, or see [Sidecars](/reference/sidecars/).

### From Terminal

Open a second Terminal window and move into the gallery folder: type `cd` and a space, drag the gallery folder from Finder onto the window, and press Return. Then run:

```sh
npx minimalgallery add ~/Pictures/Export/kyoto
```

This copies the photos into `photos/kyoto/` and processes them. Photos already in the gallery are skipped, and a file name that is already taken gets a `-2` at the end. Photos in subfolders all go into the same album. To name the album yourself, add `--album "japan 2025"`. The folder name is written in lowercase, with spaces and punctuation turned into underscores, so the photos go to `photos/japan_2025/`.

When the preview isn’t running, `npx minimalgallery sync` processes new and changed photos. You can also skip this: `npm run publish` processes them before each publish.

## 5. Look around

The preview is the real site. The home page opens on your newest photo, filling the window. Move the pointer to show the controls; they hide again after two seconds. Click the right side of the photo for the next one and the left third for the previous one, or use the keyboard:

| Key     | Action                                                    |
| ------- | --------------------------------------------------------- |
| `←` `→` | Previous or next photo                                    |
| `↑`     | Show the photos below the viewer                          |
| `Esc`   | Back to the photo                                         |
| `i`     | Photo information                                         |
| `f`     | Fill the window or fit the whole photo                    |
| `s`     | Filmstrip                                                 |
| `/`     | Filter: albums, years, places, cameras, keywords and more |
| `?`     | Every shortcut                                            |

The links at the top left lead back to the album and the home page. The values in the information pane are links too: click an aperture or a place to see every photo that shares it. All the shortcuts and touch gestures are listed in [Theme and tokens](/theme/#keyboard-shortcuts).

## 6. Make it yours

### The config file

`minimalgallery.config.ts` holds the gallery’s settings. Open it in a code editor such as [VS Code](https://code.visualstudio.com). Don’t use TextEdit: it can turn straight quotes into curly ones, which breaks the file.

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
- `site` is the gallery’s public address, once you have one. Feeds, link previews and search engines use it.
- `defaults` sets how the viewer looks for a new visitor:

| Key | Values | Default | What it sets |
| --- | --- | --- | --- |
| `fit` | `'fill'`, `'fit'` | `'fill'` | Fill the window, cropping the edges, or show the whole photo. |
| `strip` | `true`, `false` | `false` | The filmstrip along the bottom of the viewer. |
| `crop` | `'square'`, `'original'` | `'square'` | Thumbnails as squares or in each photo’s own shape. |
| `view` | `'grid'`, `'list'` | `'grid'` | The photos below the viewer as a grid, or as a list with every detail. |
| `size` | `1`, `2`, `3` | `2` | Thumbnail size: small, medium or large. |
| `backdrop` | `'neutral'`, `'photo'`, `'light'` | `'neutral'` | Behind the photo: dark gray, a hint of each photo’s own color, or a pale gray. |

Visitors can change the first five for themselves; your values are what they see first. Every other setting is in [Configuration](/reference/configuration/).

The preview reads the config file when it starts. After a change, press Ctrl+C in its Terminal window and run `npm run admin` again.

### custom.css

To change colors, sizes and timing, create a file named `custom.css` next to the config file. It loads after the theme, so what you write there wins. Start with the theme’s tokens, the settings it exposes for this:

```css title="custom.css"
@layer theme.user {
  :root {
    --mg-ground: oklch(0.1 0 0);
    --mg-hud-idle: 4s;
  }
}
```

This makes the background darker and keeps the controls visible for four seconds. The preview updates each time you save. If you created the file while the preview was running, restart the preview once. [Theme and tokens](/theme/) lists every token and explains how to style the rest of the theme.

## 7. Publish

In the gallery folder, run:

```sh
npm run publish
```

What happens next depends on where you said the gallery would live.

### Cloudflare

The first time, it stops and asks you to connect to Cloudflare. You only do this once per computer:

```sh
npx wrangler login
```

Your browser opens on Cloudflare. Sign in, or create a free account on the same page, allow access, and go back to Terminal. Run `npm run publish` again.

It processes any new photos, shows what it’s about to do and asks “Go ahead?”. Choose Yes. It builds the site and uploads it to Cloudflare. On a new Cloudflare account, it first asks you to register a `workers.dev` subdomain: answer yes and type a name, which becomes part of your gallery’s address. The last lines show that address.

Next time, run the same command. You won’t need to log in again, and only what changed is uploaded. To use your own domain, see [Cloudflare](/hosting/cloudflare/). With photo storage, the new photos are uploaded first; see [Photo storage](/hosting/photo-storage/).

### Your own host

`npm run publish` builds the site into the `dist` folder. Upload everything in that folder to your host. [Your own host](/hosting/your-own-host/) explains how.

Either way, the gallery folder is the only copy of your original photos and captions, so include it in your backups. See [Backups](/backups/).

## Next time

1. Double-click `Open minimalgallery.command` in the gallery folder, or run `npm run admin` in it.
2. Add albums in Finder, or export from your photo editor into `photos/`.
3. Press Publish in the admin, or open a second Terminal window in the gallery folder, as described in [From Terminal](#from-terminal), and run `npm run publish`.

## Upgrading

To get the latest version of minimal gallery, run this in the gallery folder:

```sh
npx minimalgallery upgrade
```

It updates minimal gallery, then runs `doctor`, which checks the gallery and changes nothing. Doctor shows how many photos and files you have, how close the site is to your host’s limits, and anything that needs attention, such as a RAW file without a JPEG. Your next publish uses the new version.

## Working from the terminal

You don’t have to use the admin. If you prefer Terminal and your own text editor, you can do everything with two commands and a text file.

Add photos to an album. A `/` in the album name makes an album inside another:

```sh
npx minimalgallery add ~/Pictures/Export/kyoto --album "japan 2025/kyoto"
```

Edit the album’s `_album.md` file, here `photos/japan_2025/kyoto/_album.md`, in any text editor. What you write under a photo’s file name replaces the photo’s own metadata:

```md title="photos/japan_2025/kyoto/_album.md"
---
photos:
  DSC_0412.jpg:
    title: Philosopher’s Path, early
    caption: The canal before the crowds.
    keywords: [canal, cherry blossom]
---
```

Then publish without the “Go ahead?” question:

```sh
npx minimalgallery publish --yes
```

A few other commands:

- `npx minimalgallery sync` processes changes without publishing. Add `--prune` to also remove the copies of deleted photos.
- `npx minimalgallery watch` processes photos as you add them, without the admin.
- `npm run dev` starts the preview without processing new photos.
- The create command can take its answers up front, for example `npm create minimalgallery@latest mg -- --host cloudflare --yes`.

Every command is in [Command line](/reference/cli/), and every field you can set in an album file is in [Sidecars](/reference/sidecars/).
