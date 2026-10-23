# Product

<!-- impeccable:product-schema 1 -->

Source: the approved v2 plan and the Phase 0 brief from the orchestrator. Yann was not interviewed for this file; every line marked “(inferred)” is an inference from those documents and is open for correction in review round 1.

## Platform

web

## Stack

Prototype: plain static HTML and CSS on mCSS, no bundler, a small Node build script. Product: an Astro 7.4 integration plus a local Node pipeline, theme CSS on mCSS.

## Users

Photo enthusiasts with some technical ability who want to publish their own photographs on free hosting, shown full, uncropped and large. The design target is a photographer at a desktop or laptop screen, often a large one; the gallery’s visitors are the people that photographer sends a link to. Phone visitors must get a decent experience, not an identical one.

## Product Purpose

minimalgallery v2 is a static site generator for photographers: drop folders of photos, get a gallery organized from file metadata (EXIF date, camera, lens, exposure, keywords, place), published to a free static host. Success: a visitor opens a link and sees the photo before anything else, moves through an album as fast as a native photo app, and can browse by any metadata value without a server.

## Positioning

Every value in a photo’s metadata is a static, linkable facet page, and the viewer feels like a native app while being plain HTML pages with tiny progressive enhancements. Existing Astro photo themes are a lightbox over a folder; hosted apps need a server.

## Operating Context

Owner workflow: Lightroom export into folders, a browser admin or CLI for ingest, publish to Cloudflare Pages. Visitor context: a link opened on a desktop browser (Chrome, Safari 26, Firefox 148) or a phone. The successor to minimalgallery 0.8 (2005, PHP), whose single photo, thumb grid and sortable list views are discarded.

## Capabilities and Constraints

- Photos are shown whole: no cropping in thumbs or in the viewer.
- Zero JavaScript is needed to view a photo; enhancements stay under 6 KB.
- Cross-document view transitions, Speculation Rules prerender, anchor positioning, popover, dialog and scroll-driven animation are the native building blocks; each must degrade to plain navigation.
- One theme ships in v2. Its user-facing tokens are registered with `@property` so a settings UI can be generated later.
- Demo content: the photos in `examples/demo/photos/` (Yann’s own, about 700 by 465 px JPEGs, albums colors, motion, shapes).

## Brand Commitments

- Name: minimal gallery (two words in copy; the package and domain stay minimalgallery). Domain minimalgallery.net is itself a demo gallery.
- Theme CSS is built on mCSS (Yann’s framework).
- The photo is the page; browsing is a layer over it; metadata is navigation. (From the plan.)

## Evidence on Hand

Real photographs with real EXIF in `examples/demo/photos/`. No testimonials, user counts or benchmarks exist; none may be invented.

## Product Principles

- The photograph leads every view; interface yields to it.
- Metadata is navigation: every value is a link.
- Native platform features first, scripts only as enhancement.
- Desktop is the design target; the phone is a first-class reader, not a second layout.
- Settings are tokens: anything a user may change is a typed custom property. (inferred)

## Accessibility & Inclusion

Keyboard navigation for every action, visible focus, `prefers-reduced-motion` respected, alt text from titles. (inferred: WCAG 2.2 AA as the target)
