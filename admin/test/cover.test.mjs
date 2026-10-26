import test from 'node:test';
import assert from 'node:assert/strict';
import { coverVersion } from '../cover.mjs';

test('the cover address changes when the cover is swapped, and stays put when it is not', () => {
  const none = () => null;
  const a = { cover_asset_id: 'aaaaaaaa-1111', cover_file: null }, b = { cover_asset_id: 'bbbbbbbb-2222', cover_file: null };
  assert.notEqual(coverVersion(a, none), coverVersion(b, none), 'a different Immich photo');
  assert.equal(coverVersion(a, none), coverVersion({ ...a }, none), 'the same photo gives the same address');
  const up = { cover_asset_id: 'aaaaaaaa-1111', cover_file: 'c1.jpg' };
  assert.notEqual(coverVersion(up, () => 1000), coverVersion(up, () => 2000), 'the same file name, replaced');
  assert.notEqual(coverVersion(up, () => 1000), coverVersion(a, none), 'an upload beats the Immich photo');
  assert.equal(coverVersion({ cover_asset_id: null, cover_file: null }, none), '', 'no chosen cover: nothing to version');
  assert.equal(coverVersion({ cover_asset_id: 'x', cover_file: 'gone.jpg' }, none), 'ax', 'a missing file falls back to the photo');
});
