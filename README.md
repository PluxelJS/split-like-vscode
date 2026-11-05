# Worksplit

Worksplit coordinates independent document Routers and native FlexLayout tabs. The library owns
opening, preview replacement, closing, default menus, focus, browser history and content cleanup.
Your application owns saving, shared drafts, services, reading hierarchy and layout policy.

There are two packages:

- `@worksplit/react`: `createWorkbench`, `Workbench`, content controllers and resource effects.
- `@worksplit/split-view`: independent `SplitView` / `Pane`, sizing and separator interactions.

`@worksplit/core`, the old Workbench API and the React package's SplitView exports are removed.
There is no required Hotkeys provider or command registry. Import native Router, Model, Actions,
Layout props and refs from their upstream packages.

## Install

This refactor has not been published by this task. Use the verified tarballs built from this
checkout until a release is authorized; an older registry package with the same version is not
the implementation described here. `pnpm build`, then `pnpm --dir packages/react pack` and
`pnpm --dir packages/split-view pack` produce the two local archives.

The supported native combination is exact: `@tanstack/react-router@1.170.46`, its
`@tanstack/router-core@1.171.39` / `@tanstack/history@1.162.5`, and `flexlayout-react@0.11.1`.
These upstream releases require the correction distributed **inside the Worksplit package**.
An equal version number alone does not provide the corrected behavior.

```sh
npm install /path/to/worksplit-react-0.1.0.tgz react react-dom @tanstack/react-store \
  @tanstack/react-router@1.170.46 flexlayout-react@0.11.1
node node_modules/@worksplit/react/native-dependencies/install.mjs
```

Before a host build or start, run the same entry with `--check [consumer-directory]`. It verifies
the exact installed versions, unique native peers and every required patched file without writing.
Missing corrections or changed files fail the check even when package version numbers match.

Run that installer after dependency installation in development and CI, before type checking or
bundling. It checks exact versions, unique peer resolution and every upstream file hash before
changing anything. It atomically replaces files without modifying shared package-store hardlinks;
repeating it is safe. Unknown versions or modified files fail explicitly. It requires no registry
access. Package-manager-native patches can also be used, but must carry the same complete patch
set and pass the same regression. See [native support](docs/navigation-support.md) for the
reproduction, supported formats and removal conditions.

Use one React, React DOM, Router and FlexLayout installation. Choose a native FlexLayout theme
and load the Workbench CSS separately:

```tsx
import "flexlayout-react/style/light.css";
import "@worksplit/react/style.css";
```

For an independent pane splitter:

```sh
npm install /path/to/worksplit-split-view-0.1.0.tgz react react-dom
```

```tsx
import { Pane, SplitView } from "@worksplit/split-view";

import "@worksplit/split-view/style.css";

<SplitView>
  <Pane id="navigation" defaultSize={240} minSize={140}>
    Navigation
  </Pane>
  <Pane id="content" defaultSize="1fr" minSize={200}>
    Content
  </Pane>
</SplitView>;
```

This package neither installs nor loads Router, FlexLayout or Workbench. Its sizing algorithms
are internal; public layout and pane types support its props, events and ref.

## Start a read-only workspace

Create one native Router per supplied history. The factory must return a fresh Router; place
shared services in native Router context or `Wrap` / `InnerWrap`, without creating another owner.

```tsx
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { createWorkbench, Workbench } from "@worksplit/react";
import { createRoot } from "react-dom/client";

const rootRoute = createRootRoute({ component: Outlet });
const reportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/read/$name",
  component: Report,
  staticData: { worksplit: { title: "Report", navigationKey: "reports" } },
});
const routeTree = rootRoute.addChildren([reportRoute]);
function Report() {
  return <h1>{reportRoute.useParams().name}</h1>;
}
const instance = createWorkbench({
  createRouter: (history) => createRouter({ routeTree, history }),
  home: { mode: "empty", href: "/" },
});
const started = await instance.start();
if (started.status !== "applied") throw new Error(`Startup: ${started.status}`);
const root = createRoot(document.getElementById("root")!);
root.render(<Workbench instance={instance} />);
await instance.open({ to: "/read/$name", params: { name: "Balance" } });
// Application teardown: root.unmount(); await instance.dispose();
```

A read-only page needs no controller. `start()` and `dispose()` are application lifetime
operations, never render side effects. A view can unmount and remount while its instance lives;
only one view may bind the instance at a time. `dispose()` is forced teardown, not a save prompt.
Use `closeWorkspace()` first when leaving must be approved.

The [read-only example](packages/demo/src/examples/read-only.tsx),
[complete saved editor](packages/demo/src/examples/editor.tsx),
[editor store](packages/demo/src/examples/editor-store.ts),
[tools](packages/demo/src/examples/tools.tsx) and
[custom menu](packages/demo/src/examples/menus.tsx) are executable sources shared by the demo and
independently installed package consumer. They are also exercised together by the public React
and real browser acceptance. The editor uses actual localStorage persistence, save failure,
saved-copy revision checks, editing during a save, and per-request pause/release; it does not
hide that protocol behind a placeholder.

## Open, select and close

`open` takes native typed navigation and separate presentation options. Native `Link` /
`router.navigate` navigate **inside the current document**. Worksplit `open` chooses or creates
a document; it does not replace the application's route tree.

```tsx
import { beside } from "@worksplit/react";
import { DockLocation } from "flexlayout-react";

await instance.open({ to: "/read/$name", params: { name: "Balance" } }, { preview: true });
await instance.open(
  { to: "/read/$name", params: { name: "Results" } },
  {
    destination: beside({ direction: DockLocation.RIGHT }),
    presentation: "reveal",
  },
);
const active = instance.getActiveDocument();
if (active) {
  await instance.keepOpen(active.id);
  await instance.duplicate(active.id);
  await instance.save(active.id);
  await instance.close(active.id);
}
```

`activate` selects and requests content focus; `reveal` selects without taking content focus;
`background` creates an ordinary tab without selecting it and cannot be a preview.
`reuse: "preserve"` is the default and retains an existing document's accepted location;
`"navigate"` navigates that document through its guard; `"new"` creates an independent instance.
Default identity uses the accepted native path/search; route metadata `documentKey` can
explicitly choose business identity. See the [identity rules](docs/vscode-workbench-behavior.md#documents-tools-and-presentation)
for hash and default-query boundaries.

A page-originated action should pass the borrowed `useContent()` handle as `source`. Capture the
source before awaiting a lookup. `createLink` does that for lazy navigation and native dragging;
its `href`, `open`, `dragStart` and `dragEnd` support a real link and a separate drag handle. A
canceled drag does not run the resolver. A drop keeps the native container/group/border and index,
and invalidates admission if its source, destination ordering or Layout binding changes.

An open captures its source and foreground intent once, including time spent in a lazy link
resolver or preview decision. Later user intent prevents the older request from taking selection
or focus: an ordinary open may finish in the background at its still-valid destination; a stale
preview or reveal is superseded. An unrelated background open does not cancel browser traversal.
Use `onResult` when a link owns feedback; without it, native drops report failures and cleanup
errors through `onIssue`. An explicit `link.open()` caller owns its returned receipt.

Every asynchronous operation settles to `applied`, `denied`, `superseded` or `failed`.
Read `value` only for `applied`; it records what this operation committed. While cleanup waits,
a later operation may change or end that content; query current live state before follow-up work.
`cleanupErrors` describe cleanup after that operation. Failure
identifies `prepare` / `commit`, whether changes occurred, and affected ids. An accepted router
error page is still an accepted location; it is not a transport failure or a reason to roll back.

## Editing and resources

`useContent()` borrows a content handle. `useContentController({ leave, save, focus, title })`
registers the one persistent owner of editing decisions. Always declare `leave`, including
`leave: null` when the accepted page is read-only. Put the owner above changing route leaves,
so an edit → read-only transition can explicitly withdraw protection after commit. Hiding a
protected owner must not silently make a dirty document closeable.

A guard supplies synchronous `{ hasUnsavedChanges, token }` and decides a request against its
captured state. Approval returns the exact current token; after the full native blocker chain,
the library checks the token, owner, content lifetime and navigation receipt again at the real
commit. Never infer approval from an href. Saving remains a business operation: only a confirmed
write of the current basis may mark a draft saved. `request.defer` releases a pause acquired by
that request on every completion path. Overlapping requests each acquire/release their own
pause; see the complete editor source.

Use `content.runEffect` inside a React effect for content-owned requests/subscriptions. It
provides one AbortSignal and `defer` cleanup; late-acquired resources are still released. Content
close waits for cleanup registered at its settlement boundary. Shared services and background
jobs belong to the host. See [resource lifetimes](docs/resource-lifetimes.md).

## Native layout and menus

`instance.model` is the only native Model. Read it directly; submit mutations through
`instance.dispatch(Actions...)` so removal, placement policy and content protection are checked.
`Workbench` passes its `native` props to the real Layout and exposes the native `layoutRef`.
Direct raw mutation is not an alternate supported execution path. Unsupported float/popout
operations are rejected. [Behavior](docs/vscode-workbench-behavior.md) details the admitted scope.

Default context menus include preview promotion, duplicate, pin, rename, groups, split,
maximize and protected close ranges. Right-click and native keyboard menus work without an
application menu builder. `menus.transform` edits native `PopupMenuEntry[]`. A custom renderer
receives native PopupMenu props plus `open` and `onClosed`; it calls `onClosed` after the actual
popup disappears and its focus-return cleanup finishes. Only then does the library execute the
selected action. This keeps dialogs and navigation from losing focus to a late menu cleanup.
The default menu stays in the same React provider tree.

Financial 2×2 limits, min sizes, reading hierarchy and sidebar policy belong to the host.
`createLayoutPolicy` and `beside` are small native geometry helpers, not a second layout tree.
Keyboard shortcuts can call captured instance operations from any application shortcut library;
Worksplit has no general command/plugin registry.

## Browser history and snapshots

Only one workspace may attach to a browser window:

```tsx
await instance.start({
  browser: {
    onOutsideNavigate({ href, state, snapshot, cleanup }) {
      // The host now owns the actual browser entry and may render its destination.
      renderHostDestination(href, state);
      if (snapshot) persistLayout(snapshot);
      void cleanup;
    },
  },
});
```

Each document still has its own native memory history. Browser entries store an opaque reference
to the document entry; equal URLs, duplicate documents and redirects do not share approval.
Native back/forward/go, push/replace, initial deep links and outside handoff are covered by the
[history support contract](docs/navigation-support.md). Do not construct a second browser Router.

`createSnapshot()` explicitly exports version 2 layout/location state. Restore through
`initial: { snapshot: unknown }`; invalid versions, malformed entries or unsupported layouts
fail before content creation. There is no old snapshot converter. A snapshot contains no live
Router, controller or draft. Without an explicit `workspaceId`, restore inherits the validated
snapshot identity; an explicitly supplied ID must match. A fresh session generates an ID when
none is supplied. Project hosts can provide their stable project identity to reject another
project's snapshot. The host chooses storage and throttling, using `snapshotRevision`
when it needs to observe persistent changes; ordinary queries do not serialize the Model.
`captureSnapshotOnClose` obtains the final protected exit snapshot after decisions and before
removal. See the [browser/history example](packages/demo/src/examples/browser.tsx).

## Develop and verify

Read [design principles](docs/design-principles.md), [architecture](docs/architecture.md), then
[behavior](docs/vscode-workbench-behavior.md) or [resource lifetimes](docs/resource-lifetimes.md).
Remaining migration scope is tracked in [proposals](docs/proposals/README.md).

```sh
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm typecheck
pnpm test:browser
pnpm test:package
pnpm verify
```

Use the declared mise / Vite+ toolchain and pncat catalogs. Vite Task retains build caches.
Tests and installation gates run serially. `test:package` packs both public packages, installs
outside the workspace, runs the shipped native installer and the same Router/browser examples,
then proves SplitView can install alone. `test:native` independently reproduces the unpatched
upstream defects and runs corrected ESM/CJS/types/browser regressions. Generated artifacts,
JSON, screenshots and traces belong under ignored `test-results/` or the parent `.artifacts/`.

The package and demo acceptance does not certify an external Pluxel Shell/Studio migration or
the financial host. Their actual status and remaining acceptance are reported separately.
