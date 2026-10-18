# Dependency security patches

`braces@3.0.3.patch` mitigates [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
It rejects AST nesting beyond 100 levels with a `SyntaxError`, before the recursive
walkers run. The limit counts both braces and parentheses; escaped, quoted, and
character-class literals do not count. Both the CLI globbing and build-time
watcher dependency paths use this patch. Run `pnpm test src/__tests__/dependency-security.test.ts`.

`../docs/patches/http-cache-semantics@4.3.0.patch` mitigates
[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp).
Version 4.3.0 still allows client `max-stale` to override cache reuse prohibitions.
The patch makes `evaluateRequest()` require revalidation for non-storable,
`no-cache`, shared-cookie, and shared `proxy-revalidate` responses. Normally
expired public responses can still use `max-stale`. Run `pnpm --dir docs test`;
the docs build runs these tests too.

Keep the patches until upstream releases pass these regressions without them.
Version-based scanners can still report locally patched dependencies, especially
`braces`, which has no upstream fixed release. Neither advisory is suppressed.
