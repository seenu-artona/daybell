# Watermark font

Plus Jakarta Sans Bold, static TrueType, copied from `apps/web/assets/fonts` (ADR 0015) for the watermark the image
worker tiles over parents' previews (D60; ADR 0016). The worker bundles this file; sharp renders the text with it, so
no system font is needed.

- Source: https://github.com/tokotype/PlusJakartaSans, `fonts/ttf/` on `master` (downloaded Oct 11, 2026).
- Licence: SIL Open Font License 1.1, in `OFL.txt` next to the font.
- Coverage: Latin and accents. A test checks the file's hash.

SHA-256:

```
5f5342ef76862b5b5365d1dff1a667629dfa484e388dd602552f647219c3870f  PlusJakartaSans-Bold.ttf
995c7199cab65954f545996326755daee7b63cc6b42b06c13da1f9502ab08a99  OFL.txt
```
