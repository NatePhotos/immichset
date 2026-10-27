import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../build.mjs';
import { SAVED_CASES } from './golden/saved-cases.mjs';

/* recorded by golden/capture-saved.mjs from the builder as it was before the header, footer, theme and wording
   could be edited */
const want = JSON.parse(readFileSync(new URL('./golden/saved.json', import.meta.url), 'utf8'));

test('a site whose pages were saved but whose header, footer, theme and wording never were builds exactly as before', () => {
  assert.deepEqual(Object.keys(want).sort(), Object.keys(SAVED_CASES).sort());
  for (const [name, [make, opts]] of Object.entries(SAVED_CASES)) {
    const { files, images } = build(make(), opts);
    assert.deepEqual(Object.fromEntries([...files].sort()), want[name].files, name);
    assert.deepEqual([...images].sort(), want[name].images, name);
  }
});
