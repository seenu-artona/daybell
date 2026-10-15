# Daybell image worker: DRM tools layer (ADR 0034)

This Lambda layer holds two programs the image worker runs to package a parent's large view for DRM (D158). Daybell
doesn't change either; both are run as separate programs (never linked into Daybell's code).

| File | What | Licence | Source |
|---|---|---|---|
| `bin/ffmpeg` | FFmpeg 7.0.2, static build for Linux arm64 with libx264 (John Van Sickle's build, as published in release `b6.1.1` of github.com/eugeneware/ffmpeg-static) | GPL v3 or later (`FFMPEG-LICENSE-GPL-3.0.txt`; the build's components in `FFMPEG-BUILD-README.txt`) | https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz and https://johnvansickle.com/ffmpeg/ |
| `bin/packager` | Shaka Packager 3.9.3 for Linux arm64 (npm package `shaka-packager@3.9.3`) | BSD 3-Clause (`SHAKA-PACKAGER-LICENSE.txt`) | https://github.com/shaka-project/shaka-packager/releases/tag/v3.9.3 |

Every file is pinned by SHA-256 in `apps/image-worker/layer/build-layer.mjs` and, for the two programs, again in
`packages/image-pipeline/src/drm.ts`, which checks them before each first use.

**Before production (ADR 0034, C13):** a legal check of distributing a GPL ffmpeg in our own Lambda layer and of H.264
(MPEG LA / Via LA) licensing for encoding parents' large views.
