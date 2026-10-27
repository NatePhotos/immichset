/* Run once, before build.mjs learns about the header, footer, theme and wording:
     node site/test/golden/capture-saved.mjs
   Records what today's builder makes for each case in saved-cases.mjs. It refuses to overwrite. */
import { writeFileSync, existsSync } from 'node:fs';
import { build } from '../../build.mjs';
import { SAVED_CASES } from './saved-cases.mjs';

const out = new URL('./saved.json', import.meta.url);
if (existsSync(out)) { console.error('saved.json already exists and must not change'); process.exit(1); }
const all = {};
for (const [name, [make, opts]] of Object.entries(SAVED_CASES)) {
  const { files, images } = build(make(), opts);
  all[name] = { files: Object.fromEntries([...files].sort()), images: [...images].sort() };
}
writeFileSync(out, JSON.stringify(all, null, 1) + '\n');
console.log('wrote', out.pathname);
