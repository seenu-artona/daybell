# 0003 — Design system in code

- Status: Accepted, Oct 10, 2026
- Decisions: D7, D91, D96, D112

`packages/ui/src/tokens.json` is a copy of the Daybell Design System artifact's tokens. `pnpm --filter
@daybell/ui gen` turns it into Tailwind v4 theme CSS (`theme.css`); a test fails if the two drift. Components
follow shadcn/ui conventions (Tailwind + class-variance-authority, Radix where behaviour is needed) and take all
words as props so text stays in locale files.

The parent shop uses a `studio` colour slot. `ShopFrame` sets it from the studio's brand colour and picks
white or ink text by contrast, so any studio colour stays readable.

Tests check every text/background token pair meets 4.5:1 and run axe on all components.

The font is self-hosted (Fontsource) rather than loaded from Google, so parents' browsers make no third-party
requests (children's privacy). Words use next-intl with en-US and en-CA message files.

**Studio colours.** Any colour a studio picks is normalised (invalid values fall back to the default, never
crash), text on it is chosen by contrast, and a darker "ring" version is derived for focus rings and selected
borders so it reaches 3:1 against white (WCAG 1.4.11).

**Photo protection.** `PhotoTile`'s watermark and save-blocking only deter casual copying; anyone can read an
image URL from the page. So in the parent shop the image passed in must always be the server-made,
watermarked, low-resolution preview. Originals are only ever delivered after purchase.
