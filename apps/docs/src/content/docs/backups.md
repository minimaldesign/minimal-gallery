---
title: Backups
description: What to back up in a gallery folder, how to restore it, and how to keep the gallery in git if you want to, with or without the original photos.
---

The gallery folder on your computer is the only complete copy of your gallery. The published site holds resized copies, not your originals, and none of the files the site is built from. Back up the folder the way you back up the rest of your photos.

## What to back up

The whole gallery folder. What matters in it:

| File or folder | What it holds |
| --- | --- |
| `photos/` | Your original photos, one folder per album, with their sidecars: the `.md` files that hold titles and captions, and each album’s `_album.md`. |
| `.minimalgallery/manifest/` | One file per photo, with what the pipeline read from it and the date it was added to the gallery, which the feeds use. The date cannot be recovered from the photo. On a Mac this folder is hidden: press Command-Shift-period in Finder to see it. |
| `minimalgallery.config.ts`, `custom.css` | Your settings and your style changes. |
| `.env` | With photo storage, its access key. Back it up somewhere private, since anyone with it can change your photo storage. |

Two folders can be left out, since they are made again when needed: `node_modules`, which `npm install` restores, and `dist`, which every build writes. In repo mode, `public/_mg` holds the resized photos, which the pipeline can make again from the originals; keeping it in the backup saves that time.

Time Machine, a backup app, or an external disk all work. A folder synced by iCloud Drive or Dropbox works too, but `node_modules` holds tens of thousands of small files: leave it out of the sync if your service lets you.

## Restoring

Copy the gallery folder back, then in Terminal, in that folder:

```sh
npm install
npm run admin
```

## Published versions

Cloudflare keeps every version you publish, and `npx wrangler rollback` in the gallery folder puts the previous one back. That is a record of the site, not a backup: it holds no originals and none of the gallery folder.

## Keeping the gallery in git

You do not need git to use minimal gallery, and the scaffold does not set it up. If you already use git, a repository of the gallery gives you a history of every change and a copy on GitHub or another git host. Create it in the gallery folder the usual way (`git init`, then commit and push).

### Why the originals stay out

The `.gitignore` the scaffold writes keeps the original photos out of the repository and keeps their sidecars in:

```txt title=".gitignore"
photos/**
!photos/**/
!photos/**/*.md
!photos/**/*.json
!photos/**/*.xmp
!photos/**/*.XMP
```

Git is not made for large files, and full-size originals soon outgrow what git hosts accept:

- **Size.** GitHub recommends keeping a repository under 1 GB and rejects any file over 100 MiB. A few hundred originals from a recent camera pass 1 GB, and a large TIFF passes 100 MiB on its own.
- **History.** Git keeps every version of every file forever. Re-export a photo after an edit and the repository holds both versions, even after you delete one.
- **Privacy.** In a public repository, anyone can download your full-resolution files.

So the repository holds what the gallery is made of, without the originals: the sidecars, the manifests, the settings and, in repo mode, the resized copies. It is not a backup of your photos. Keep backing up the gallery folder as above.

### Keeping the originals in git anyway

In a private repository that you use as a backup, you can keep the originals too. Delete the six `photos` lines above from `.gitignore`, then add the photos and commit:

```sh
git add photos
git commit -m "Add the original photos"
```

The repository then grows by the full size of every photo you add, and of every new version of one. If your originals add up to more than about 1 GB, use a backup app instead, or a git extension made for large files, such as Git LFS.

`.env` stays out of git either way: the `.gitignore` ignores it, and it should never be committed.
