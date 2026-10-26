---
title: Theme and tokens
description: How the minimal gallery theme is built, every token you can change, and how to change tokens and classes in custom.css.
---

minimal gallery comes with one theme. This page explains how it is put together, lists the tokens you can change and shows how to change them in `custom.css`. It also covers what visitors can change for themselves, and every keyboard shortcut.

## How the theme is put together

### The same layout on every page

Each page of the gallery shows a set of photos: all of them, an album, or the photos that share one value, such as a year, a month, a place, a camera, a lens, a focal length, an aperture, a shutter speed, an ISO or a keyword. These last ones are the filter pages. Every page is laid out the same way. At the top is the viewer: one photo filling the window, with the controls over it. Below it is the panel: the same photos as a grid or a list. Each one fills the window, and the page snaps between them.

The home page and every photo page open on the viewer. Album and filter pages open on the panel, with the viewer above showing the first photo; scroll up or press `Esc` to see it, or click a thumbnail to open that photo.

Everything that floats over the photo has the same look: a dark, see-through fill with the photo blurred behind it, and a thin outline. That is the bar of controls at the top, called the HUD (the breadcrumb on the left; filter, information, filmstrip, fit and shortcuts on the right), the filmstrip along the bottom, the information and shortcuts panes, which visitors can drag, and the filter palette.

### Cascade layers and custom.css

The CSS is built on [mCSS](https://mcss.dev), which orders styles with native cascade layers:

```css
@layer base, elements, global, components, theme.default, theme.user, external, helpers;
```

The theme loads three stylesheets, in this order:

1. `theme.mg.tokens.css`, the token contract, with your viewer defaults written in.
2. `mg.css`, the theme itself: the mCSS framework, the gallery’s own values in `theme.user`, then one file per part of the page, called a block (the HUD, the viewer, the filmstrip, the thumbnails and the rest). As in any mCSS project, the blocks are not in a layer.
3. Your `custom.css`, if it exists.

Because `custom.css` comes last, a token you set there replaces the theme’s value, and a rule you write against a class can override the theme’s rule for it. The theme’s files are in `node_modules/@minimalgallery/astro/src/theme/styles/`. Read them there, but do not edit them: an upgrade replaces them. Everything you change goes in `custom.css`.

### Without JavaScript

Every page is plain HTML and CSS, and works with JavaScript turned off: the photo, its information, the grid (and the list, on album and filter pages), the fit, crop and size controls, the filter palette, and previous and next as ordinary links. The theme’s script adds:

- steps between photos inside the page, with a crossfade, instead of a page load;
- keyboard shortcuts, swipes and double-tap zoom;
- the filmstrip, and the list view on the home and photo pages, which are built from the context’s data;
- typing to narrow the filter palette, sorting the list, and dragging the panes;
- remembering each visitor’s settings;
- keeping previous and next inside the context a photo was opened from. Without the script, a photo page stays in its album.

## Tokens you can change

These are the tokens you can change in `custom.css`. They are defined in `theme.mg.tokens.css`, each with a type and a default. A value of the wrong type, such as a color where a length is expected, is ignored and the default is used, so a typo can’t break the page.

The theme’s other custom properties (the grays, the text and surface colors, spacing) are for its own use. A later version may rename or remove them.

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

Six tokens take their default from `defaults` in `minimalgallery.config.ts`. When the site is built, each value from the config file becomes the token’s default, and the matching control is shown already selected. The page is right as soon as it loads, even without JavaScript.

| Config key | Config values | Token | Token values |
| --- | --- | --- | --- |
| `defaults.fit` | `'fill'`, `'fit'` | `--mg-fit` | `cover`, `contain` |
| `defaults.strip` | `false`, `true` | `--mg-strip` | `off`, `on` |
| `defaults.crop` | `'square'`, `'original'` | `--mg-grid-crop` | `square`, `original` |
| `defaults.view` | `'grid'`, `'list'` | `--mg-grid-view` | `grid`, `list` |
| `defaults.size` | `1`, `2`, `3` | `--mg-grid-size` | `small`, `medium`, `large` |
| `defaults.backdrop` | `'neutral'`, `'photo'`, `'light'` | `--mg-backdrop` | `neutral`, `photo`, `light` |

Set these six in the config file, not in `custom.css`. Only `--mg-backdrop` works fully from `custom.css`. The other five would apply only once the theme’s script has run, after the page first appears, and not at all without JavaScript.

## Changing tokens in custom.css

Create `custom.css` next to `minimalgallery.config.ts`, and set tokens on `:root`, either inside `@layer theme.user`, where the theme sets its own values, or outside any layer. Either way your value wins, because `custom.css` loads after the theme. The preview updates each time you save. If you create the file while the preview is running, restart the preview once.

### A darker ground and slower controls

```css title="custom.css"
@layer theme.user {
  :root {
    --mg-ground: oklch(0.1 0 0);
    --mg-hud-idle: 4s;
  }
}
```

The ground is the background color of every page. With the photo backdrop, it is also the color each photo’s own color is mixed into. The controls now stay visible for four seconds before they fade.

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

`--mg-row-height` is the medium size. The small and large sizes, which visitors pick with `1` and `3`, are 0.6 and 1.5 times it, so they grow with it. The theme uses 112px on screens narrower than 768px. A value you set on `:root` replaces that on every screen, so set the narrow-screen size again, as above.

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

Behind each photo, the backdrop mixes that much of the photo’s main color into the background, and changes with each photo. Browsers that don’t support CSS container style queries show the neutral backdrop instead.

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

Write class rules outside any layer: a rule inside `@layer theme.user` loses to every block. Outside a layer, your rule wins when its selector is at least as specific as the theme’s, because `custom.css` loads last. Many theme rules depend on the viewer’s state, such as `:root:is([data-fit='cover'], …) .hud`: find the rule in your browser’s inspector and copy its selector. You don’t need `!important`.

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

Visitors can change five settings for themselves. Each choice is saved in their browser and applies on every page of your gallery from then on. Until they choose, they see your default from the config file.

| Setting | Where | Key | Stored as | Your default |
| --- | --- | --- | --- | --- |
| Fit | Fit photo or Fill window, in the HUD | `f` | `mg-fit` | `defaults.fit`, `--mg-fit` |
| Filmstrip | Filmstrip, in the HUD | `s` | `mg-strip` | `defaults.strip`, `--mg-strip` |
| Crop | The crop pair, in the panel header | `t` | `mg-crop` | `defaults.crop`, `--mg-grid-crop` |
| View | The grid and list pair, in the panel header | `v` | `mg-view` | `defaults.view`, `--mg-grid-view` |
| Size | The size buttons, in the panel header | `1` `2` `3` | `mg-size` | `defaults.size`, `--mg-grid-size` |

The browser also remembers whether the information and shortcuts panes are open and where they were dragged. Only you can change the backdrop, the colors, the sizes and the timing. Nothing is sent anywhere: a visitor who clears your site’s data starts again from your defaults. Without JavaScript, the fit, crop and size controls (and the grid and list switch, on album and filter pages) still work, but a choice lasts only until the next page.

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
