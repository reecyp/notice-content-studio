/**
 * Lets Node import the TypeScript in lib/ and app/ the way the bundler does.
 *
 * Three gaps to close. Node strips types happily but still wants an extension
 * on a relative specifier, while the source is written for
 * `moduleResolution: bundler` and carries none. `@/` is tsconfig's alias for
 * the project root, which Node knows nothing about. And Next ships subpaths
 * like `next/server` that only the bundler resolves extensionless.
 *
 * Only the check scripts need this; nothing ships with it.
 */
const ROOT = new URL('../', import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const target = new URL(specifier.slice(2), ROOT);
    for (const candidate of [`${target.href}.ts`, `${target.href}.tsx`, target.href]) {
      try {
        return await next(candidate, context);
      } catch {
        // Try the next extension.
      }
    }
  }
  if (specifier.startsWith('next/') && !/\.[a-z]+$/i.test(specifier)) {
    try {
      return await next(`${specifier}.js`, context);
    } catch {
      // Fall through: some subpaths do resolve on their own.
    }
  }
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context);
    } catch {
      // Not a .ts file after all, so fall through to Node's own answer.
    }
  }
  return next(specifier, context);
}
