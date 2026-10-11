# Migration readiness: empty home and StrictMode

2026-10-11. Follow-up to the [document placement acceptance](../api-driven-placement/README.md).
This phase adds opt-in document-free home handling and protects content lifecycle registration
against React effect replay. Default homepage routing and native document Router behavior remain intact.

## Results

- `pnpm test`: 220 tests pass (core 5, React 215), including 13 new empty-home and 9 lifecycle-replay tests. See [tests](tests.txt).
- `pnpm lint`, `pnpm typecheck`, `pnpm build`: pass. Build includes source declaration checks. See [lint](lint.txt), [types](typecheck.txt), [build](build.txt).
- Full demo Chromium: 43 pass, zero skipped/unexpected/flaky. See [browser log](browser.txt) and [JSON](browser-results.json). `pnpm format:check` also passes ([log](format.txt)).
- Fresh `pnpm test:package --browser`: JS in both resolution conditions, strict consumer types, production build and 28 browser checks pass. See [command](package.txt) and [results](packed-consumer-results.json).
- Packed production browser verifies empty startup, final close, real Back/Forward, empty refresh, existing-document home normalization and snapshot/native selection with lazy hidden documents.
- The same fresh tarball also runs in a separate Vite development server under real React StrictMode. Effects mount 4 times and clean up 2 times; content lifecycle disposal remains zero during replay. Dirty close refusal keeps it zero, actual close raises it to one, host dispose to two, repeated dispose leaves two. No console/page errors.
- The locked native Router [hash probe](hash-codec-probe.mjs) round-trips 1,000 UUID account filters in a 45,012-character fragment. [Output](hash-codec-probe.txt) records normalization and invalid-input checks. This is a design probe, not financial app/browser acceptance.

[Empty-home restore](packed-consumer-empty-home-restored.png) and [StrictMode](packed-consumer-strict-mode.png) screenshots supplement the machine assertions. Other screenshots repeat the existing packed-consumer cases against this package.

The [initial build failure](build-first-attempt.txt) exposed the demo's `NavigationResult`-only reporter receiving the new `StartResult`; the startup now handles `empty` explicitly. The final complete build passed. Warnings from experimental tooling and known bundle size remain visible.

## Boundaries

The lifecycle hook buffers content registration only. Hosts must still own their Workbench instance and must not reuse it after permanent dispose during a StrictMode cleanup. Explicit registration cleanup remains immediate.

The financial app, its HeroUI overlays, legacy snapshot converter, actual 1,000-account browser flow, RPC resources and business write recovery have not been migrated or validated here. No production performance claim, database compatibility claim, or new mobile product scope follows from this fixture.

Text logs retain output content with trailing whitespace normalized for Git.
