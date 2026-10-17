#!/usr/bin/env node
/**
 * Load one plugin directory and call an exported function.
 *
 *   node scripts/plugin-load.mjs plugins/ruflo-ai-team src/untrusted.mjs scanStoredText --arg "ignore previous instructions"
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dirArg, moduleArg, exportName, ...rest] = process.argv.slice(2);
if (!dirArg || !moduleArg || !exportName) {
  console.error('Usage: node scripts/plugin-load.mjs <plugin-dir> <module> <export> [--arg text]');
  process.exit(2);
}
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--arg') args.push(rest[++i]);
  else if (rest[i] === '--json') args.push(JSON.parse(rest[++i]));
}

const dir = resolve(dirArg);
const manifestPath = join(dir, '.claude-plugin', 'plugin.json');
let manifest = { name: dirArg, version: null };
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const loaded = await import(pathToFileURL(join(dir, moduleArg)).href);
  const fn = loaded[exportName];
  if (typeof fn !== 'function') {
    throw new Error(`Export ${exportName} is not a function on ${moduleArg}`);
  }
  const result = await fn(...args);
  process.stdout.write(`${JSON.stringify({
    plugin: manifest.name,
    version: manifest.version,
    module: moduleArg,
    export: exportName,
    result,
  }, null, 2)}\n`);
} catch (err) {
  const error = err instanceof Error ? err.message : String(err);
  process.stdout.write(`${JSON.stringify({
    plugin: manifest.name,
    version: manifest.version,
    module: moduleArg,
    export: exportName,
    error,
  }, null, 2)}\n`);
  process.exit(1);
}
