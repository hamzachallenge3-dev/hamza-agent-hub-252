import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogNames, runPlugin } from '../../scripts/plugin-catalog-run.mjs';

for (const name of catalogNames()) {
  test(`${name} loads and executes`, async () => {
    const row = await runPlugin(name);
    assert.equal(row.ok, true, row.error || 'plugin failed');
    assert.equal(row.plugin, name);
    assert.ok(row.module);
    assert.ok(row.result);
  });
}
