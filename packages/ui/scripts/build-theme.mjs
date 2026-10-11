import { readFileSync, writeFileSync } from "node:fs";
import { buildThemeCss } from "./theme.mjs";

const tokensUrl = new URL("../src/tokens.json", import.meta.url);
const outUrl = new URL("../src/theme.css", import.meta.url);
const tokens = JSON.parse(readFileSync(tokensUrl, "utf8"));
writeFileSync(outUrl, buildThemeCss(tokens));
console.warn("theme.css written");
