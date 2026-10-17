/**
 * Hub source imports TypeScript as `.js`. Rewrite those relative
 * specifiers to `.ts` so Node can load the package with type stripping.
 */
export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || '';
  if (specifier.startsWith('.') && specifier.endsWith('.js') && parent.includes('/hub/hamza-agent-hub/')) {
    try {
      return await nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    } catch {
      return nextResolve(specifier, context);
    }
  }
  return nextResolve(specifier, context);
}
