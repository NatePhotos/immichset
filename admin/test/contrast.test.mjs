import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../web/admin-theme.css", import.meta.url), "utf8");
const root = css.match(/:root\s*\{([^}]*)\}/)[1];
const v = {};
for (const m of root.matchAll(/--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) v[m[1]] = m[2];

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const cases = [
  ["muted", "bg", 4.5], ["muted", "card", 4.5], ["muted", "panel", 4.5],
  ["fg", "bg", 7], ["fg", "card", 7],
  ["on-primary", "primary", 4.5],
  ["ok", "ok-bg", 4.5], ["warn", "warn-bg", 4.5], ["bad", "bad-bg", 4.5],
];
for (const [fg, bg, min] of cases) {
  test(`--${fg} on --${bg} is at least ${min}:1`, () => {
    assert.ok(v[fg] && v[bg], `missing --${fg} or --${bg} in :root`);
    const r = ratio(v[fg], v[bg]);
    console.log(`  --${fg} ${v[fg]} on --${bg} ${v[bg]} = ${r.toFixed(2)}`);
    assert.ok(r >= min, `${r.toFixed(2)} < ${min}`);
  });
}
