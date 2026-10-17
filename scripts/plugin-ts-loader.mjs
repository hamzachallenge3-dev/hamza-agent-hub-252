/**
 * Resolve extensionless plugin imports, `.js` specifiers that are TypeScript
 * sources, and `.tsx` views. Transpile with TypeScript so parameter
 * properties and JSX load. Node's strip-only mode rejects both.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tsPackage = [
  fileURLToPath(new URL('../node_modules/typescript/package.json', import.meta.url)),
  '/tmp/ruflo-plugin-deps/node_modules/typescript/package.json',
].find((path) => existsSync(path));

const ts = tsPackage ? createRequire(tsPackage)('typescript') : null;

const EXT = /\.(?:mjs|cjs|js|ts|tsx|mts|cts|json|node)$/;

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!relative || !context.parentURL) return nextResolve(specifier, context);
  const parent = fileURLToPath(context.parentURL);
  const base = join(dirname(parent), specifier);
  const candidates = [];
  if (specifier.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`, base);
  else if (!EXT.test(specifier)) {
    candidates.push(
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mts`,
      `${base}.mjs`,
      `${base}.js`,
      `${base}.cjs`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
      join(base, 'index.mjs'),
      join(base, 'index.js'),
    );
  }
  for (const file of candidates) {
    if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!ts || !url.startsWith('file:') || !/\.tsx?$/.test(new URL(url).pathname)) {
    return nextLoad(url, context);
  }
  const source = readFileSync(fileURLToPath(url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
      jsxFragmentFactory: 'Fragment',
    },
    fileName: url.endsWith('.tsx') ? 'mod.tsx' : 'mod.ts',
  });
  return { format: 'module', source: output.outputText, shortCircuit: true };
}
