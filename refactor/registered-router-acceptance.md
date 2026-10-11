# Registered Router consumer regression

2026-10-11: the financial application's typed TanStack `Register` exposed a source
consumer error in Worksplit's identity search lookup. This is a type compatibility
correction; runtime identity, routing, document and resource behavior are unchanged.

`packages/react/consumers/registered-router.ts` uses only public imports and registers
two routes with different, closed search schemas. Its independent TypeScript project
selects the package's public `development` export, so it checks the real source against
that host registration without leaking the fixture's `Register` into tests or the demo.
The fixture also verifies that an invalid closed search value remains a type error.
The React package's normal `typecheck` now runs this additional project. The existing
isolated packed consumer registers its actual Router too, covering published types.

Before the fix, from the containing workspace:

```sh
pnpm --filter @worksplit/react exec tsc -p tsconfig.registered-consumer.json --noEmit
```

failed with exit 1:

```text
src/integration.ts(1921,35): error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'AnySchema | { view: "compact" | "full"; pageSize: number; } | { onlyUnclassified: boolean; }'.
```

`identitySearch` intentionally contains runtime field names. A registered route's
closed search type need not have a string index signature. The correction asserts a
`Record<string, unknown>` only at this lookup; it retains the same object and property
access, and adds no runtime conversion, validation or new ownership.

Executed after the fix from the containing financial workspace, using its installed
dependency graph and without installing in this checkout:

| Command                                                               | Result                                                                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @worksplit/core --filter @worksplit/react typecheck`   | Passed, including the isolated registered source consumer                                                                                     |
| `pnpm --filter @worksplit/core --filter @worksplit/react test`        | 5 core and 215 React tests passed (220 total)                                                                                                 |
| `pnpm --filter @worksplit/core --filter @worksplit/react lint`        | Passed                                                                                                                                        |
| `pnpm --filter @worksplit/core --filter @worksplit/react build`       | Passed; JavaScript, CSS and declarations generated                                                                                            |
| `node vendor/split-like-vscode/scripts/check-package-consumer.mjs`    | Fresh archives independently installed; public JavaScript, strict types (default and development conditions), CSS and production build passed |
| `node vendor/split-like-vscode/scripts/check-source-declarations.mjs` | Passed                                                                                                                                        |

The package check retained its temporary consumer at
`/home/ahdg/.var/app/io.github.trumank.CodeStudio/tmp/worksplit-packed-consumer-xJcs3n`.
The suite reported jsdom's unimplemented `window.scrollTo`; builds reported the existing
experimental TypeScript 7 API and packed fixture chunk size notices. All commands above
completed successfully. No lockfile, dependency version, source alias, demo route schema
or browser behavior changed. Browser acceptance was not rerun for this erased type
assertion; the financial application must separately validate its actual migration.
