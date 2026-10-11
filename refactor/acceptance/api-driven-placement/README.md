# Programmatic document placement · 2026-10-11

Baseline: `3ba56d5f12b1e625b2eae49785733af2f16a53a0`, following the
[first financial consumer review](../financial-first-consumer/README.md).
The financial application and Pluxel remain unmigrated. These are library and independent public
package consumer checks, not application acceptance.

## Delivered behavior

- `open`/`duplicate` accept native `DockLocation` and a native target, admitting directly with one
  ADD instead of opening then moving. Default targets are captured at invocation and revalidated
  by live node identity after asynchronous loading. Existing identities retain their placement.
- `WorkbenchDocument.containerId` projects its current TabSet/Border, including native TabGroups.
- `preserveFocus` reveals a separate document while keeping source activation, browser URL and
  actual DOM focus. It differs from background admission, which does not select visible content.
- Maximize exits when needed for visible side-by-side content; a preserved source preview is kept,
  not retired. Foreground eligibility still expires when the user moves focus during loading.
- `rejected/layout-policy` distinguishes capacity refusal from loader/guard failures;
  `rejected/focus-conflict` exposes impossible preservation requests without hidden fallback.
- Native ADD topology preflight prevents rejected over-limit splits from mutating the live layout.
  Custom native-node policy refusal removes provisional content/new empty containers and restores
  surviving weights, selection and active container. This is not a general atomic transaction.

Public behavior is documented in the [README](../../../README.md#open-a-document-beside-its-originating-page)
and [behavior contract](../../../docs/vscode-workbench-behavior.md#programmatic-document-placement).

## Executed checks

| Check                                            | Result                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                      | 198 passed: core 5, React 193, including 22 placement regressions.                                              |
| `pnpm typecheck`                                 | Library, demo and tooling passed.                                                                               |
| `pnpm lint` / `pnpm build` / `pnpm format:check` | Passed, including declaration checks; lint has no warnings/errors.                                              |
| Complete demo Chromium                           | 43 passed, 0 skipped/unexpected/flaky.                                                                          |
| Independent public tarball consumer              | Runtime under default/development conditions, strict TypeScript, production build and 25 browser checks passed. |

Command logs and JSON results are in this directory. The consumer drives both **1440×900** and
**1366×768**, forms real two-column and 2×2 layouts, and retains earlier native drag regression
checks. Page-owned buttons and an input-local keyboard shortcut exercise the new API. Keyboard
opening preserves real textarea selection/caret and scroll; ordinary button clicks preserve that
button's real focus, not a fabricated old caret. Both preserve source activation and browser URL.
The consumer also checks normal foreground side-open, maximizing then revealing beside the source,
source-preview retention, full-grid refusal without layout/document changes, and a slow loader
completing after the user focuses another pane. A real focused Inspector input remains visible and
focused when same-container admission is refused, and when a separate document pane is revealed.

Unit regressions additionally cover pruned targets, same-container/source-navigation conflicts,
navigation guards, reuse history replacement, explicit preview placement, duplicate placement,
protection of focused tools, unchanged visible-source reuse, and refusal under native create-container defaults that retain empty or non-closeable containers.
A minimal native reproduction showed that ADD-right then DELETE alone halves the old source
weight; the regression compares the complete layout after compensation.

The first browser attempt passed the original checks and new desktop flow, then reused a URL
whose only difference was its hash. Chromium correctly treated this as same-document navigation,
so the fixture still had five documents when the next test expected two. The test now uses a new
entry pathname to force a real page reload. No library behavior was changed to accommodate it.
The first attempt log is retained separately. An initial test-local name-shadow lint error was
fixed without changing lint rules. The added tool browser check initially assumed Border JSON
persisted an id; native Border ids are derived from location. The assertion now uses that native
contract. Its failed attempt is retained; the final package command passes the complete suite.

## Limits

No financial RPC, database, HeroUI v3 overlay integration, production workload, package registry
release or upstream push was tested here. Actual menus/modals and business drafts still need the
financial migration's browser acceptance. No performance improvement is claimed.

Trusted native observers can mutate or throw during cleanup, and native tidy can remove an empty
placeholder's identity; this is not Model rollback. Borders accept CENTER admission only.
`canDispatch(MOVE_NODE)` is not a capacity preflight for a future document, because moving a last
tab can remove its source group. Applications handle the structured open result to choose their
own existing-pane fallback; the library has no business layout workflow language or `canOpen` API.

The upstream small-window regression remains an upstream regression, not a financial mobile
requirement. Existing TypeScript experimental API and Vite large-chunk diagnostics remain visible.
