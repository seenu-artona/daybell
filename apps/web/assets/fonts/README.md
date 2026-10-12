# Fonts for printed QR cards

Plus Jakarta Sans Regular and Bold, static TrueType, embedded (subset) in the QR card PDF (ADR 0015). The app's screens
use the variable web font from `@fontsource-variable/plus-jakarta-sans`; PDFs need static fonts.

- Source: https://github.com/tokotype/PlusJakartaSans, `fonts/ttf/` on `master` (downloaded Oct 11, 2026).
- Licence: SIL Open Font License 1.1, in `OFL.txt` next to the fonts.
- Coverage: Latin and accents (Seenu, answer 5). Other characters print as "?".

SHA-256:

```
bd6276d4060e3b1ebc45047469e0bb86b08f301ba681cdf1ceb6245ea10478d2  PlusJakartaSans-Regular.ttf
5f5342ef76862b5b5365d1dff1a667629dfa484e388dd602552f647219c3870f  PlusJakartaSans-Bold.ttf
995c7199cab65954f545996326755daee7b63cc6b42b06c13da1f9502ab08a99  OFL.txt
```
