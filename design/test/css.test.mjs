import { test } from "node:test";
import assert from "node:assert/strict";
import { compileCustomCss, SCOPE, CSS_LIMIT } from "../css.mjs";

const ok = (src) => { const r = compileCustomCss(src); assert.equal(r.error, null, JSON.stringify(r.error)); return r.css; };
const bad = (src, re) => {
  const r = compileCustomCss(src);
  assert.ok(r.error, `should be rejected: ${JSON.stringify(src).slice(0, 80)}`);
  assert.equal(r.css, "");
  assert.ok(Number.isInteger(r.error.line) && Number.isInteger(r.error.col));
  if (re) assert.match(r.error.message, re);
};

test("empty input compiles to nothing", () => { assert.equal(ok(""), ""); assert.equal(ok("  /* nothing */  "), ""); });

test("every selector is scoped to the gallery", () => {
  assert.equal(ok(".cell{border-radius:8px}"), `${SCOPE} .cell{border-radius:8px}`);
  assert.equal(ok("a:hover,a:focus-visible{color:var(--accent)}"), `${SCOPE} a:hover,${SCOPE} a:focus-visible{color:var(--accent)}`);
  assert.equal(ok("h1::after{content:\"·\"}"), `${SCOPE} h1::after{content:"·"}`);
  assert.equal(ok(".a > .b + .c{margin:0}"), `${SCOPE} .a > .b + .c{margin:0}`);
});

test("html, body, :root and :scope become the gallery root", () => {
  assert.equal(ok(":scope{--page-bg:#000}"), `${SCOPE}{--page-bg:#000}`);
  assert.equal(ok(":root{--gap:4px}"), `${SCOPE}{--gap:4px}`);
  assert.equal(ok("body .htitle{color:red}"), `${SCOPE} .htitle{color:red}`);
  assert.equal(ok("html{color:red}"), `${SCOPE}{color:red}`);
});

test("media and supports rules pass, with scoped contents", () => {
  assert.equal(ok("@media (max-width:700px){.hwrap{height:48px}}"), `@media (max-width:700px){${SCOPE} .hwrap{height:48px}}`);
  assert.match(ok("@supports (display:grid){.a{display:grid}}"), /^@supports \(display:grid\)\{/);
  assert.match(ok("@media (min-aspect-ratio:16/9) and (pointer:coarse){.a{top:0}}"), /^@media /);
});

test("allowed values: gradients, env(), colours, important, custom properties", () => {
  ok(".a{background:linear-gradient(180deg,rgba(0,0,0,.2),#fff)}");
  ok(".a{padding-top:env(safe-area-inset-top)}");
  ok(".a{width:calc(100% - 2*var(--gap))}");
  ok(".a{color:red!important}");
  assert.match(ok(".a{color:red !important}"), /red!important/);
  ok(":scope{--x:1px;--Y:#abc}");
  ok("[data-x] .a, [aria-hidden=true] .b{opacity:.5}");
  ok(".a:nth-child(2n+1):not(.b){top:-5px}");
});

test("rejects every way of loading something", () => {
  for (const src of [
    '@import "x.css";', "@import url(x);", "@IMPORT 'x';", "@font-face{src:url(x)}",
    ".a{background:url(https://x/y.png)}", ".a{background:URL(x)}", ".a{background:u\\72l(x)}", "@\\69mport 'x';",
    ".a{background:ur/**/l(x)}", ".a{background:image-set('a' 1x)}", ".a{background:-webkit-image-set('a' 1x)}",
    ".a{background:cross-fade(a,b)}", ".a{background:element(#x)}", ".a{width:attr(data-x)}", ".a{background:paint(x)}", ".a{content:src(x)}",
  ]) bad(src);
});

test("rejects script and legacy tricks", () => {
  for (const src of [
    ".a{behavior:url(x.htc)}", ".a{-moz-binding:x}", ".a{width:expression(alert(1))}", ".a{filter:progid:DXImageTransform}",
    ".a{background:javascript}", "</style><script>alert(1)</script>", '.a{content:"</style>"}',
  ]) bad(src);
});

test("rejects broken or dangerous structure", () => {
  bad("/* never closed"); bad('.a{content:"never closed}'); bad(".a{color:red"); bad(".a{width:calc(1px}");
  bad(".a{.b{color:red}}", /nested|separate/i); bad("@media (min-width:1px){@media (max-width:9px){.a{top:0}}}");
  for (const at of ["@keyframes x{from{top:0}}", "@namespace x;", "@charset 'x';", "@layer a{}", "@page{}", "@property --x{}", "@container (min-width:1px){}"]) bad(at, /not allowed|needs/i);
  bad(".a{position:fixed}", /fixed/); bad(".a{position:FIXED !important}", /fixed/);
  bad('input[value^="a"]{color:red}', /attribute/i); bad(".a:has(.b){color:red}"); bad(".a :root{color:red}");
  bad(":scope .a :scope{color:red}"); bad(".a:is(:root){color:red}"); bad("..a{}");
  bad(":scope{--x:url(a)}"); bad(":scope{--x:{}}"); bad(".a{color:#12}"); bad(".a{width:1pt}", /unit/i);
});

test("rejects bad input and size limits", () => {
  bad(null); bad(5); bad(".a{color:red\u0000}");
  bad("x".repeat(CSS_LIMIT + 1), /limited/);
  bad(Array.from({ length: 1001 }, () => ".a{top:0}").join(""), /Too many/);
});

test("errors carry a line and column", () => {
  const r = compileCustomCss(".ok{top:0}\n.a{background:url(x)}");
  assert.equal(r.error.line, 2);
  assert.ok(r.error.col > 1);
});

test("fuzz: output never contains anything that loads or escapes", () => {
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const bases = [".cell{border-radius:8px;opacity:.5}", ":scope{--a:#fff;--b:1px}", "@media (max-width:700px){.hwrap{height:48px}}",
    "a:hover{color:red!important}", ".x::after{content:\"hi\"}", "h1,h2{margin:0 auto}"];
  const frags = ["url(", "@import", "<", "\\", "(", ")", "{", "}", ";", ":", "expression", "@font-face", "/*", "*/", "position:fixed;",
    "image-set(", "src(", "behavior:", "'", '"', "javascript", "!important", "[value^=a]", ":has(", "@keyframes x"];
  let accepted = 0, rejected = 0;
  for (let n = 0; n < 3000; n++) {
    let s = bases[rnd(bases.length)] + bases[rnd(bases.length)];
    for (let k = rnd(3); k >= 0; k--) { const at = rnd(s.length + 1); s = s.slice(0, at) + frags[rnd(frags.length)] + s.slice(at); }
    const r = compileCustomCss(s);
    if (r.error) { rejected++; assert.equal(r.css, ""); continue; }
    accepted++;
    assert.doesNotMatch(r.css.replace(/"[^"]*"|'[^']*'/g, '""'), /\burl\(|@import|<|\\|expression\s*\(|@font-face|(?<![\w-])position:fixed|\bimage-set|\bsrc\(/i, `${JSON.stringify(s)} -> ${r.css}`);
  }
  assert.ok(accepted > 100 && rejected > 100, `fuzzer is not exercising both paths (accepted ${accepted}, rejected ${rejected})`);
});

test("a different scope can be given, for website blocks", () => {
  assert.equal(compileCustomCss("p{color:red}", { scope: "#b-x1" }).css, "#b-x1 p{color:red}");
  assert.equal(compileCustomCss(":root{--a:1}", { scope: "#b-x1" }).css, "#b-x1{--a:1}");
  assert.equal(compileCustomCss("a:is(.x,.y){color:red}", { scope: "#b-x1" }).css, "#b-x1 a:is(.x,.y){color:red}");
  assert.equal(compileCustomCss("p{color:red}").css, `${SCOPE} p{color:red}`, "the gallery scope is still the default");
});

test("block scope: a sibling combinator right after the root cannot reach the following blocks", () => {
  const scope = "#b-x";
  for (const src of [":root ~ *{display:none}", ":scope + *{color:red}", "html ~ p{color:red}", "body + div{color:red}", ":root:hover ~ *{color:red}"]) {
    const r = compileCustomCss(src, { scope });
    assert.ok(r.error, src); assert.equal(r.css, ""); assert.match(r.error.message, /outside this block/);
    assert.ok(Number.isInteger(r.error.line) && Number.isInteger(r.error.col));
  }
  assert.equal(compileCustomCss(":root > p{color:red}", { scope }).css, "#b-x > p{color:red}");
  assert.equal(compileCustomCss(":root p ~ p{color:red}", { scope }).css, "#b-x p ~ p{color:red}");
  assert.equal(compileCustomCss("p + p{color:red}", { scope }).css, "#b-x p + p{color:red}");
  assert.equal(compileCustomCss(":root{color:red}", { scope }).css, "#b-x{color:red}");
});

test("gallery scope is unchanged: sibling combinators after the root still compile", () => {
  assert.equal(compileCustomCss(":root ~ p{color:red}").error, null);
});
