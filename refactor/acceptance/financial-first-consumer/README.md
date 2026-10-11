# Desktop consumer coordination review · 2026-10-11

Baseline: `df2b6af6804f4ec52a9227160758093ac08a6972` on `refactor/flexlayout-tanstack`.
This review used the financial-review application's real contracts and source as requirements,
but changed only Worksplit and its independent public-package consumer. The financial application
and Pluxel Workbench have **not** been migrated or validated against this revision.

## Delivered behavior

- Explorer `reuse: "preserve"`, native matching of lazy restored document identities and
  `duplicate(id)` without a host URL parser or second document catalog.
- One replaceable preview, new content/Router identity on replacement, explicit keep independent
  of pin, protected previews retained, failed admission preserving old content, and late preview
  requests losing their right to replace content after focus changes.
- Native topology limits shared by drop previews, Action eligibility/dispatch, admission and
  restore. Native candidate Actions include source-empty tidy; no live save listeners fire.
- First-open focus after content registration, maximized-target visibility, cancellation on user
  focus/native interaction/blur/disposal, and rejection of a second live lifecycle owner.
- Navigation decision id/from/to context, with committed new admission distinguished from failures
  inspecting or disposing a retired preview.

Public contracts remain in the [README](../../../README.md) and
[behavior reference](../../../docs/vscode-workbench-behavior.md), not in this evidence file.

## Executed checks

| Check                                   | Result                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                             | 176 passed: core 5, React 171                                                                                                                |
| `pnpm typecheck`                        | core/react/demo and tooling passed                                                                                                           |
| `pnpm lint`                             | passed, zero warnings/errors                                                                                                                 |
| `pnpm build`                            | core/react/demo and source-declaration check passed                                                                                          |
| `pnpm format:check`, `git diff --check` | passed                                                                                                                                       |
| Complete Chromium suite                 | 43 passed, 0 skipped/unexpected/flaky                                                                                                        |
| `pnpm test:package --browser`           | fresh tarballs installed independently; default/development JS runtime and strict type checks, production build and 18 browser checks passed |

The [complete browser result](browser-results.json) and
[packed consumer result](packed-consumer-results.json) record their actual runtimes and assertions.
Logs in this directory retain the final test/type/build/package commands. Historical acceptance
from before this change remains separate.

The packed consumer checks native mouse docking and menu actions at **1440×900** and **1366×768**:
two columns, actual 2×2, rejected extra edge splits, accepted center moves, independent document
lifetime, preserve-location navigation, preview retirement/keep/guarded content, mounted focus and
maximized sibling reveal. Desktop and compact screenshots are retained. The older 390px resize
check is retained as an upstream regression, not a financial product mobile requirement.

Added regression tests first reproduced explicit keep during provisional admission being ignored,
a throwing old-preview dirty getter incorrectly converting a successful admission into a load
failure, and a slow preview retiring foreground content after focus had moved. The fixes are
covered by the final suite. An initial existing close-guard assertion required updating for its new
second context argument; initial lint failures were test mock typing and a moved sequential-dialog
lint annotation, fixed without relaxing the rules.

## Limits

- The public fixture uses local example services. No financial RPC, Source data, drafts or business
  database was opened or changed, and no application build compatibility is claimed.
- Bounds measure the native slicing-tree topology, not pixel alignment. Borders are excluded;
  centrally docked tools still occupy a TabSet. Multi-step move/add batches are refused because
  public Model APIs do not expose all creation defaults for faithful prediction.
- The live Model is unique. Candidate Models are short-lived, without React views, Routers,
  subscriptions or a retained alternative snapshot. This review makes no throughput/heap claim.
- `keep` is not native pin. A fresh preview lifetime intentionally does not preserve the old
  document's React state, draft, scroll or resource identity.
- Upstream TypeScript 7 experimental API and Vite large-chunk warnings remain visible. The jsdom
  scrollTo stub and deliberate route-error tests retain their existing diagnostics.
- No package registry release, production deployment, outer application Router integration,
  database engine validation or performance benchmark was performed.
