---
'@minimalgallery/pipeline': patch
---

Photos encode about 30% faster by default: the pipeline starts a third as many workers as the computer has cores, each with two or three libvips threads, instead of one single-threaded worker per core. Measured on an 11-core M3 Pro: 96 phone photos (12 MP) in 63 s instead of 91 s, 241 small photos in 6.9 s instead of 8.7 s. `--concurrency` and `--threads` still override it.
