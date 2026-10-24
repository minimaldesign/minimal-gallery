---
title: Downloads
description: The minimal gallery packages on npm, and what each one is for.
---

minimal gallery is four npm packages. You install none of them by hand: `npm create minimalgallery@latest` sets up a gallery with the right ones, and `npx minimalgallery upgrade` keeps them current.

:::note[Not published yet]

The first release is in preparation. Until it is out, the packages are only in the [repository](https://github.com/minimaldesign/minimal-gallery), and the links below lead to empty npm pages.

:::

| Package | What it is | Installed by |
| --- | --- | --- |
| [`create-minimalgallery`](https://www.npmjs.com/package/create-minimalgallery) | The scaffold behind `npm create minimalgallery@latest`: asks a few questions and writes a new gallery folder. | `npm create`, never installed |
| [`minimalgallery`](https://www.npmjs.com/package/minimalgallery) | The command line: `add`, `sync`, `doctor`, `publish`, `watch`, `admin`, `upgrade`. See [Command line](/reference/cli/). | Each gallery |
| [`@minimalgallery/astro`](https://www.npmjs.com/package/@minimalgallery/astro) | The Astro integration, the content loader and the theme. See [Theme and tokens](/theme/). | Each gallery |
| [`@minimalgallery/pipeline`](https://www.npmjs.com/package/@minimalgallery/pipeline) | The photo processing that runs on your computer: metadata, resized copies, manifests. See [Configuration](/reference/configuration/). | Each gallery |

All four share one version number. [Version history](/versions/) lists what changed in each.

## Requirements

- Node 22.18 or later, from [nodejs.org](https://nodejs.org/). The installer for your system is enough.
- npm, pnpm, Yarn or Bun. npm comes with Node.
- Git, if your host builds from a repository (Cloudflare Workers Builds, GitHub Pages, Netlify).

A desktop app is parked for later. If one ships, its installers will be listed here.
