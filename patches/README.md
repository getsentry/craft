# Dependency patches

`braces@3.0.3.patch` mitigates [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
It rejects AST nesting beyond 100 levels with a `SyntaxError`, before the recursive
walkers run. The limit counts both braces and parentheses; escaped, quoted, and
character-class literals do not count. Both the CLI globbing and build-time
watcher dependency paths use this patch. Run `pnpm test src/__tests__/dependency-security.test.ts`.

`../docs/patches/http-cache-semantics@4.3.0.patch` mitigates
[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp).
Version 4.3.0 still allows client `max-stale` to override cache reuse prohibitions.
The patch shares one reuse guard across `maxAge()`, `evaluateRequest()`,
`timeToLive()` (used directly by Astro), and the stale fallback APIs. Non-storable,
`no-cache`, shared-cookie, shared `proxy-revalidate`, and wildcard-`Vary`
responses cannot gain a lifetime from stale directives. `must-revalidate` keeps
its fresh lifetime but forbids stale extensions. Error fallback also requires
the URL, host, method, and `Vary` variant to match the cached request. Normally expired public
responses retain their stale fallback behavior. Run `pnpm --dir docs test`;
the docs build runs these tests too.

`picomatch@4.0.7.patch` and `picomatch@2.3.2.patch` mitigate
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). Both
versions compile a repeated extglob with one wildcard branch, such as `+(*a)`,
to a nested quantifier that backtracks exponentially. The patch backports the
open upstream fix (micromatch/picomatch#267 and #268 for 2.x). A branch made only
of literals, `?`, `*`, and bracket classes that cannot match `/` absorbs its own
repetition, so `+(P)` compiles as `(P)` and `*(P)` as `(P)?`, with the same
matches. Unlike upstream, the patch checks each compiled bracket class, because
a range such as `[+-0]` includes `/`. Other single-branch wildcard bodies are
literalized, like the existing risky-extglob guard. A branch with a literal `/`
keeps its repetition only when no path segment can hold two `*`s, counting the
last segment of one repeat with the first segment of the next. So `+(src/*/)`
keeps working, while `+(*/*)` and `+(**/a)` (a globstar crosses `/`) are
literalized. In root they
cover the CLI globbing (`micromatch`), `typescript-eslint`, and build-time
watcher paths. Docs keeps identical copies under `../docs/patches/` for Astro. Run
`pnpm test src/__tests__/dependency-security.test.ts` and `pnpm --dir docs test`.

Keep the patches until upstream releases pass these regressions without them.
Version-based scanners can still report locally patched dependencies, especially
`braces` and `picomatch`, which have no upstream fixed release. No advisory is
suppressed.

`textlint-rule-terminology@5.2.16.patch` adds `./terms.jsonc` to the package's
`exports`, so Craft can import its terms list for changelog scope headers
(`src/utils/scopeTerms.ts`). Without it, the `exports` map hides the file from
esbuild and Vite. Drop the patch once upstream exports the file.
