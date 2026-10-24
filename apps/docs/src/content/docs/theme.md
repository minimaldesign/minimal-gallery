---
title: Theme and tokens
description: How the minimal gallery theme is built, every token you can change, and how to change tokens and classes in custom.css.
---

minimal gallery ships one theme. This page explains how it is put together, lists the tokens you can change and shows how to change them in `custom.css`, then covers what visitors can change for themselves and the keyboard shortcuts.

## How the theme is put together

### One page for every context

A context is a set of photos: all photos, an album, or a facet such as a year, a month, a place, a camera, a lens, a focal length, an aperture, a shutter speed, an ISO or a keyword. Every page shows one context the same way. On top is the viewer: one photo filling the window, with the controls floating over it. Below it is the panel: the context’s photos as a grid or as a list. Each is one window tall, and the page snaps between them.

The home page and every photo page open on the viewer. Album and facet pages open on the panel, with the viewer above showing the context’s first photo; scroll up or press `Esc` to see it, or click a thumbnail to open that photo.

The overlays share one surface: a dark translucent fill, the photo blurred behind it, and a 1px hairline. They are the HUD at the top (the breadcrumb on the left; filter, information, filmstrip, fit and shortcuts on the right), the filmstrip along the bottom, the information and shortcuts panes, which visitors can drag, and the filter palette.

### Cascade layers and custom.css

The CSS is built on [mCSS](https://mcss.dev), which orders styles with native cascade layers:

```css
@layer base, elements, global, components, theme.default, theme.user, external, helpers;
```

The theme loads three stylesheets, in this order:

1. `theme.mg.tokens.css`, the token contract, with your viewer defaults written in.
2. `mg.css`: the mCSS framework and its default theme in their layers, the gallery theme’s own values in `theme.user`, then one file per block (the HUD, the stage, the filmstrip, the thumbnails and the rest), unlayered, as mCSS does with blocks.
3. Your `custom.css`, if it exists.

Because `custom.css` comes last, a token you set there replaces the theme’s value, and a rule you write against a class can override the theme’s rule for it. The theme’s files are in `node_modules/@minimalgallery/astro/src/theme/styles/`. Read them there, but do not edit them: an upgrade replaces them. Everything you change goes in `custom.css`.

### Without JavaScript

Every page is static HTML and CSS, and works with JavaScript turned off: the photo, its information, the grid (and the list, on album and facet pages), the fit, crop and size controls, the filter palette, and previous and next as plain links. The theme script only adds to that:

- steps between photos inside the page, with a crossfade, instead of a page load;
- keyboard shortcuts, swipes and double-tap zoom;
- the filmstrip, and the list view on the home and photo pages, which are built from the context’s data;
- typing to narrow the filter palette, sorting the list, and dragging the panes;
- remembering each visitor’s settings;
- keeping previous and next inside the context a photo was opened from. Without the script, a photo page stays in its album.

## The token contract

The tokens below are the ones an owner may change. Each is registered with `@property` in `theme.mg.tokens.css`, with a type (`syntax`), a default (`initial-value`) and a comment that gives its label, its group and one line of help. Because each token is typed, a value of the wrong type falls back to the default instead of breaking the page. The contract is written so that a settings screen could be generated from it later; today, you change tokens in `custom.css`.

The theme’s other custom properties (the gray palette, the ink and surface colors, spacing) are not part of the contract. A later version may rename or remove them.

### Color

| Token | Label | Syntax | Default | Note |
| --- | --- | --- | --- | --- |
| `--mg-ground` | Background | `<color>` | `oklch(0.14 0 0)` | The near-black behind every page. |
| `--mg-accent` | Highlight color | `<color>` | `oklch(0.97 0 0)` | Marks the current frame and the chosen options, and draws focus rings. |

### Viewer

| Token | Label | Syntax | Default | Note |
| --- | --- | --- | --- | --- |
| `--mg-fit` | Photo fit | `cover \| contain` | `cover`, from `defaults.fit` | `cover` fills the window and crops the edges, `contain` shows the whole photo. Visitors can switch; this is the default. |
| `--mg-backdrop` | Backdrop | `neutral \| photo \| light` | `neutral`, from `defaults.backdrop` | `neutral` is the background color, `photo` adds a hint of each photo’s own color, `light` is a pale gray. |
| `--mg-backdrop-tint` | Backdrop tint | `<percentage>` | `10%` | How much of the photo’s color reaches the backdrop in photo mode. |
| `--mg-view-inset` | Space around the photo | `<length>` | `16px`, `0px` below 768px wide | `0` lets the photo meet the edge of the window. |
| `--mg-strip` | Filmstrip | `on \| off` | `off`, from `defaults.strip` | The row of frames along the bottom of the viewer. Visitors can turn it on; this is the default. |

### Overlays

| Token | Label | Syntax | Default | Note |
| --- | --- | --- | --- | --- |
| `--mg-hud-idle` | Hide controls after | `<time>` | `2s` | Idle time before the controls fade. Only pointer movement brings them back. |
| `--mg-hud-density` | Control density | `<number>` | `1` | `0.85` is compact, `1` is regular, `1.2` is roomy. |
| `--mg-hud-blur` | Overlay blur | `<length>` | `20px` | How much the photo behind a panel is blurred; `0` for none. |
| `--mg-hud-opacity` | Overlay fill | `<percentage>` | `82%` | Below about 80%, white text can lose contrast over bright photos. |

### Grid

| Token | Label | Syntax | Default | Note |
| --- | --- | --- | --- | --- |
| `--mg-grid-crop` | Grid thumbnails | `square \| original` | `square`, from `defaults.crop` | Square crops or each photo’s own shape. Visitors can switch; this is the default. |
| `--mg-grid-view` | Photos view | `grid \| list` | `grid`, from `defaults.view` | A grid of thumbnails or a list with every value. Visitors can switch; this is the default. |
| `--mg-grid-size` | Thumbnail size step | `small \| medium \| large` | `medium`, from `defaults.size` | Small, medium or large thumbnails. Visitors can switch; this is the default. |
| `--mg-row-height` | Thumbnail size | `<length>` | `180px`, `112px` below 768px wide | The medium step, as a square’s side or a row’s height. |
| `--mg-grid-gap` | Grid gap | `<length>` | `3px` | Space between thumbnails. |

### Motion

| Token | Label | Syntax | Default | Note |
| --- | --- | --- | --- | --- |
| `--mg-motion` | Motion | `<number>` | `1` | Scales every duration; `0` turns movement off. |

### How the viewer defaults reach the tokens

Six tokens take their default from `defaults` in `minimalgallery.config.ts`. At build time the integration writes each configured value into the `initial-value` of its `@property`, and renders the matching control already checked, so the page is right before any script runs, and with no script at all.

| Config key | Config values | Token | Token values |
| --- | --- | --- | --- |
| `defaults.fit` | `'fill'`, `'fit'` | `--mg-fit` | `cover`, `contain` |
| `defaults.strip` | `false`, `true` | `--mg-strip` | `off`, `on` |
| `defaults.crop` | `'square'`, `'original'` | `--mg-grid-crop` | `square`, `original` |
| `defaults.view` | `'grid'`, `'list'` | `--mg-grid-view` | `grid`, `list` |
| `defaults.size` | `1`, `2`, `3` | `--mg-grid-size` | `small`, `medium`, `large` |
| `defaults.backdrop` | `'neutral'`, `'photo'`, `'light'` | `--mg-backdrop` | `neutral`, `photo`, `light` |

Set these six in the config file, not in `custom.css`. The theme’s CSS reads only `--mg-backdrop` directly. For the other five, what a new visitor sees comes from the controls the build renders checked, and the theme script reads the token only as the starting value for a visitor who has not chosen. An override of those five in `custom.css` therefore reaches the page only through the script, after the page first appears, and not at all without JavaScript.

## Changing tokens in custom.css

Create `custom.css` next to `minimalgallery.config.ts`, and set tokens on `:root`, either inside `@layer theme.user`, the layer where the theme sets its own values, or unlayered. Either way your value wins, because `custom.css` comes after the theme. The preview shows each change when you save; if you create the file while the preview is running, restart the preview once.

### A darker ground and slower controls

```css title="custom.css"
@layer theme.user {
  :root {
    --mg-ground: oklch(0.1 0 0);
    --mg-hud-idle: 4s;
  }
}
```

The ground is the color behind every page and the panel. In photo backdrop mode it is also the base the photo’s color is mixed into. The controls now wait four seconds before they fade.

### Larger thumbnails

```css title="custom.css"
@layer theme.user {
  :root {
    --mg-row-height: 240px;
    --mg-grid-gap: 4px;

    @media (width < 768px) {
      --mg-row-height: 140px;
    }
  }
}
```

`--mg-row-height` is the medium step. The small and large steps that visitors pick with `1` and `3` are 0.6 and 1.5 times it, so they grow with it. The theme sets 112px on screens narrower than 768px, and a value set on `:root` replaces that on every screen, so set the narrow-screen size again.

### The photo backdrop

```ts title="minimalgallery.config.ts"
import { defineConfig } from '@minimalgallery/pipeline/config';

export default defineConfig({
  name: 'Field notes',
  defaults: { backdrop: 'photo' },
});
```

```css title="custom.css"
@layer theme.user {
  :root {
    --mg-backdrop-tint: 18%;
  }
}
```

Behind each photo, the backdrop mixes that much of the photo’s dominant color (measured when the photo is processed) into the ground, and it follows the photo when the viewer steps to the next one. Backdrop modes use container style queries; a browser without them shows the neutral backdrop.

## Styling the theme’s classes

When no token covers a change, write rules against the theme’s classes in `custom.css`. These are the blocks, in the order `mg.css` loads them:

| Block | Class | What it styles |
| --- | --- | --- |
| Surface | `.surface` | The translucent material every overlay shares. |
| Toggles | `.toggle` | The icon and segmented controls, and their tooltips. |
| HUD | `.hud` | The bar over the viewer: breadcrumb and controls. |
| Stage | `.stage` | The viewer: the photo, the previous and next click zones, zoom. |
| Panel | `.table` | The panel below the viewer: its header, the photos and the rail. |
| Filmstrip | `.strip` | The filmstrip. |
| Thumbnails | `.thumbs` | The grid of thumbnails and their tooltips. |
| Rail | `.rail` | The year rail beside the grid. |
| Chip | `.chip` | A value in the filter palette. |
| Pane | `.pane` | The draggable panes. |
| Information | `.info` | The contents of the information pane. |
| Palette | `.palette` | The filter dialog. |
| Keys | `.keys` | The contents of the shortcuts pane. |
| Ledger | `.ledger` | The list view, a sortable table. |
| Viewer page | `.viewer` | The page itself: snap points and backdrop modes. |

Class names follow mCSS: a part of a block takes an underscore (`.hud_title`, `.thumbs_image`) and a variant takes a dash (`.pane-info`, `.toggle-plain`). Every `::view-transition` rule is in `global.transitions.css`.

The blocks are unlayered, so an unlayered rule in `custom.css` competes with them on specificity, and wins a tie because it comes later. A rule with the same selector as the theme’s wins; a less specific one loses. Many theme rules depend on state, such as `:root:is([data-fit='cover'], …) .hud`: find the rule in your browser’s inspector and match its selector. Write class rules unlayered, since a rule inside `@layer theme.user` loses to every block. No `!important` is needed.

```css title="custom.css"
/* Captions in the information pane, in full white and a serif face */
.info_caption {
  color: oklch(0.97 0 0);
  font-family: Georgia, serif;
}

/* No brightening when the pointer is over a thumbnail */
.thumbs_link:hover .thumbs_image {
  filter: none;
}
```

Class names and markup change between versions more readily than tokens do. After an upgrade, check the rules you wrote against classes.

## What a visitor can change

Visitors can change five settings for themselves. Each choice is stored in their browser’s localStorage and applies on every page of your gallery from then on. Until they choose, your default applies: the value from the config file, carried by the token.

| Setting | Where | Key | Stored as | Your default |
| --- | --- | --- | --- | --- |
| Fit | Fit photo or Fill window, in the HUD | `f` | `mg-fit` | `defaults.fit`, `--mg-fit` |
| Filmstrip | Filmstrip, in the HUD | `s` | `mg-strip` | `defaults.strip`, `--mg-strip` |
| Crop | The crop pair, in the panel header | `t` | `mg-crop` | `defaults.crop`, `--mg-grid-crop` |
| View | The grid and list pair, in the panel header | `v` | `mg-view` | `defaults.view`, `--mg-grid-view` |
| Size | The size buttons, in the panel header | `1` `2` `3` | `mg-size` | `defaults.size`, `--mg-grid-size` |

The browser also remembers whether the information and shortcuts panes are open and where they were dragged. The backdrop, the colors, the sizes and the timing are yours alone. Nothing is sent anywhere: a visitor who clears your site’s data starts again from your defaults. Without JavaScript, the fit, crop and size controls (and the grid and list pair, on album and facet pages) still work on the page, but a choice lasts only until the next page.

## Keyboard shortcuts

`?` opens the same list in the gallery.

### Viewing mode

| Key | Action |
| --- | --- |
| `←` `→` | Previous or next photo. Nothing happens past the first or last photo, and hidden controls stay hidden. |
| `↑` | Open browsing mode |
| `z` | Zoom to 1:1 and back |
| `i` | Photo information |
| `f` | Fill the window or fit the photo |
| `s` | Filmstrip |
| `/` or `⌘K` | Filter (`Ctrl+K` on Windows and Linux) |
| `?` | Keyboard shortcuts |

With a mouse, a click on the right part of the photo goes to the next one, and a click on its left third to the previous one.

### Browsing mode

| Key | Action |
| --- | --- |
| `←` `→` `↑` `↓` | Move the selection. Up and down go to the nearest photo in the row above or below, or one row in the list. |
| `Enter` | Open the selected photo |
| `Home` `End` | Select the first or last photo |
| `Esc` | Back to viewing mode |
| `1` `2` `3` | Thumbnail size |
| `t` | Square crop or original shape |
| `v` | Grid or list |
| `/` | Filter |

The current photo is selected when the panel opens.

### Filter

| Key     | Action                                      |
| ------- | ------------------------------------------- |
| `Tab`   | Go to the first chip                        |
| `Enter` | Open the first chip that matches the search |
| `Esc`   | Clear the search, then close                |

### Touch

| Gesture             | Action                                        |
| ------------------- | --------------------------------------------- |
| Tap                 | Show or hide the controls                     |
| Swipe left or right | Next or previous photo, and hide the controls |
| Double tap          | Zoom                                          |
| Pinch               | The browser’s own zoom                        |
| Scroll              | Move between the photo and the panel          |
