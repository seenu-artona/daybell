// Turns tokens.json into Tailwind v4 theme CSS. Shared by the generator and the drift test.
const TYPE_PREFIX = "text";

export function buildThemeCss(tokens) {
  const lines = [];
  const add = (name, value) => lines.push(`  --${name}: ${value};`);

  for (const t of tokens.color.tokens) add(`color-${t.name}`, t.value.toLowerCase());
  for (const [key, stack] of Object.entries(tokens.type.families)) add(`font-${key}`, stack);
  for (const group of tokens.type.groups) {
    for (const s of group.styles) {
      const n = `${TYPE_PREFIX}-${s.name}`;
      add(n, s.fontSize);
      add(`${n}--line-height`, s.lineHeight);
      add(`${n}--font-weight`, s.fontWeight);
      if (s.letterSpacing) add(`${n}--letter-spacing`, s.letterSpacing);
    }
  }
  for (const t of tokens.radius.tokens) add(t.name, t.value);
  for (const t of tokens.shadow.tokens) add(t.name, t.value);
  for (const t of tokens.motion.tokens) {
    if (t.name.startsWith("ease-")) add(t.name, t.value);
  }

  const motion = tokens.motion.tokens
    .filter((t) => t.name.startsWith("duration-"))
    .map((t) => `  --${t.name}: ${t.value};`);

  return [
    "/* GENERATED from tokens.json by scripts/build-theme.mjs. Do not edit by hand. */",
    "@theme {",
    ...lines,
    "  /* Parent shop slot: charcoal by default (D116); ShopFrame overrides with the studio's colour (D117). */",
    "  --color-studio: #1c1c1e;",
    "  --color-on-studio: #ffffff;",
    "  --color-studio-ring: #1c1c1e;",
    "}",
    "",
    "@keyframes daybell-pop {",
    "  from { transform: scale(0.92); opacity: 0; }",
    "  to { transform: none; opacity: 1; }",
    "}",
    "",
    ":root {",
    ...motion,
    "}",
    "",
  ].join("\n");
}
