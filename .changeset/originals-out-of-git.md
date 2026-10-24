---
'@minimalgallery/pipeline': minor
'minimalgallery': minor
'create-minimalgallery': minor
---

Git publishing leaves the original photos out of the repository.

- New galleries ignore every file under `photos/` except the sidecars (`.md`, `.json`, `.xmp`) and `_album.md`. `minimalgallery publish --git` commits the same files, whatever `.gitignore` says, and never the pipeline’s cache. To commit the originals too, set `"minimalgallery": { "commitOriginals": true }` in `package.json` and delete the `photos` lines from `.gitignore`; `doctor` then counts them in the repository size.
- A gallery that already tracks its originals keeps them tracked: publish commits their edits and deletions, adds no new ones, and prints the commands to stop tracking them. History is never rewritten.
- A clone without the originals publishes the same site. The pipeline prunes a manifest only when its photo was deleted from the folder that had it, recorded in `.minimalgallery/cache/seen.json`; a photo whose original was never in the folder is absent and keeps its manifest, derivatives and place in its album, even when the album folder is missing. `ProcessSummary.absent` lists those photos, `sync`, `publish`, `watch` and `mg-pipeline` count them, and `doctor` reports them (`DoctorReport.absent`) instead of calling them orphans. `DoctorReport` also gains `commitOriginals` and `repo.originals`.
- `changedFiles` is replaced by `gitChanges` and `selectChanges` in the `minimalgallery` package’s exports.
