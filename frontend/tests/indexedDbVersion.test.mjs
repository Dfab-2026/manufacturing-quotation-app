import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('draft database does not request a fixed lower IndexedDB version', () => {
  assert.doesNotMatch(source, /indexedDB\.open\(ACTIVE_DRAFT_DB\s*,\s*2\s*\)/);
  assert.match(source, /indexedDB\.open\(ACTIVE_DRAFT_DB\)/);
});

test('missing stores are repaired with a forward-only dynamic upgrade', () => {
  assert.match(source, /Math\.max\(db\.version \+ 1, 2\)/);
  assert.match(source, /ensureDraftDatabaseStores\(upgradeRequest\.result\)/);
});
