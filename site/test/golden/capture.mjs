/* Run once, before build.mjs learns about pages:  node site/test/golden/capture.mjs
   Records what today's builder makes for each case in cases.mjs, so the page-based builder can be held to it.
   It refuses to overwrite: the record must stay what the old builder made. */
import { writeFileSync, existsSync } from 'node:fs';
import { build } from '../../build.mjs';
import { CASES } from './cases.mjs';

const out = new URL('./legacy.json', import.meta.url);
if (existsSync(out)) { console.error('legacy.json already exists and must not change'); process.exit(1); }
const all = {};
for (const [name, [make, opts]] of Object.entries(CASES)) {
  const { files, images } = build(make(), opts);
  all[name] = { files: Object.fromEntries([...files].sort()), images: [...images].sort() };
}
writeFileSync(out, JSON.stringify(all, null, 1) + '\n');
console.log('wrote', out.pathname);
