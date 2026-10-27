import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../build.mjs';
import { CASES } from './golden/cases.mjs';

/* recorded by golden/capture.mjs from the builder as it was before pages and blocks existed */
const want = JSON.parse(readFileSync(new URL('./golden/legacy.json', import.meta.url), 'utf8'));

test('a site that never saved pages builds exactly as before, file for file and image for image', () => {
  assert.deepEqual(Object.keys(want).sort(), Object.keys(CASES).sort());
  for (const [name, [make, opts]] of Object.entries(CASES)) {
    const { files, images } = build(make(), opts);
    assert.deepEqual(Object.fromEntries([...files].sort()), want[name].files, name);
    assert.deepEqual([...images].sort(), want[name].images, name);
  }
});
