# Worksplit

Worksplit integrates **FlexLayout 0.11** with **TanStack Router, Store and Hotkeys**. FlexLayout owns
layout; each document has a real Router and memory history; Worksplit owns document lifetimes,
activation, guarded closing and the workspace browser history. There is one route definition and
one native Model, with no parallel docking tree or pathname renderer dispatcher.

- `@worksplit/react`: `createWorkbench`, `Workbench`, content lifecycle hooks and independent `SplitView`.
- `@worksplit/core`: the DOM-free pane sizing/resize calculations used by `SplitView`.
- `packages/demo`: the complete internal consumer, using public package exports without source aliases.

This is a breaking replacement of the old Workbench descriptors, arrangement/grid helpers, part
state and snapshots. Pluxel and the second application have **not** been migrated. See
[behavior and migration](docs/vscode-workbench-behavior.md) and [acceptance evidence](refactor/acceptance.md).

## Run and verify

```sh
pnpm install --frozen-lockfile
pnpm dev                         # http://localhost:5188
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm exec playwright install chromium
pnpm test:browser
pnpm measure                     # a running demo is required
```

External versions live in the workspace pncat catalogs and are locked by `pnpm-lock.yaml`.
Library source exports use the `development` condition; production consumers use `dist`. Demo
Vite consumes the same package entry. There are no private source aliases in Vite or TypeScript.
The demo document HTTP fixture is a Vite development middleware; production hosting must supply
that endpoint. `build` verifies bundles and declarations, not a production document service.

## A complete routed workspace

Create one TanStack route tree and a Router factory. The factory must use the supplied memory
history and the same route definition, and may loan shared services through Router context.
Do not supply another browser history to document Routers.

```tsx
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { createWorkbench, Workbench } from "@worksplit/react";
import { createRoot } from "react-dom/client";

import "flexlayout-react/style/dark.css";
import "@worksplit/react/style.css";

const rootRoute = createRootRoute({ component: Outlet });
const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$id",
  component: () => <h1>Document {documentRoute.useParams().id}</h1>,
  staticData: { worksplit: { title: "Document", navigationKey: "documents" } },
});
const routeTree = rootRoute.addChildren([documentRoute]);
const workbench = createWorkbench({
  createRouter: (history) => createRouter({ routeTree, history }),
  workspaceId: "my-workspace",
  onIssue: ({ code, error }) => console.error(code, error),
});
const root = createRoot(document.getElementById("root")!);
root.render(
  <div style={{ height: "100dvh" }}>
    <Workbench
      workbench={workbench}
      navigation={
        <button
          onClick={async () => {
            const result = await workbench.open({ to: "/documents/$id", params: { id: "A" } });
            if (result.status !== "committed") console.error(result);
          }}
        >
          Document A
        </button>
      }
    />
  </div>,
);
const disconnect = workbench.connectBrowser();
const initial = await workbench.start(location.pathname + location.search + location.hash);
if (initial.status !== "committed") console.error(initial);
// At host shutdown: dispose first so registered async cleanup is settled, then unmount.
// disconnect(); await workbench.dispose(); root.unmount();
```

`createMemoryHistory` is re-exported by TanStack Router; applications that create standalone
Routers may use it directly. Worksplit supplies the history for its own document instances.
The demo shows typed search, nested Outlet, loaders, context, redirects, native blockers and tools.
Router `Link` and `useNavigate` inside a document retain their native relative navigation,
replace and browser-link behavior. Global document entrances use `workbench.open`.

## Document operations and completion

`open(navigation, { target?, newInstance?, background? })` uses TanStack `NavigateOptions` types.
`target` is a native Tabset or Border id, not a Worksplit region. Omission uses the active/first
central Tabset. Invalid targets or policies return a load-stage failure; no document is retained.
`newInstance: true` explicitly permits another instance. `background: true` runs routing without
claiming activation. The most recent foreground open supersedes older foreground opens;
activation separately revokes a pending request's right to take focus or write the URL.

The nearest matched route declaring `staticData.worksplit` owns identity. Its parsed params and
optional `identitySearch` fields determine reuse; other search fields and hash are view state.
Keep these identity values JSON serializable. Nested routes without their own metadata remain
in the parent document. Full requested locations are honored, including when an existing
instance's search/hash must change. `activate(id)` preserves its committed location and restores
its registered synchronous focus callback. Reuse selects the active matching instance, then MRU,
then creation order. Layout position and pin do not enter identity.

`open` resolves to `committed`, `rejected` (with a reason), `superseded`, or `failed` (with the
original error and stage). A commit means Router/session/Model admission, not completion of
React painting or business saves. Router-accepted loader errors remain committed error pages.
Invalid programming inputs can throw; route and operation failures are available in the receipt
and `onIssue`. Native Router error boundaries retain their original errors.

**Deduplication is guaranteed at `open`, not at native document navigation.** A speculative real
Router resolves redirect targets before admission, leaving the source intact. Exact existing
URLs avoid loaders. A changed existing URL may run a speculative loader and then the live
Router loader; these are read operations and must be safe to repeat. Shared data caching belongs
to the application. Ordinary Link/navigate can commit a duplicate identity after redirect;
Worksplit reports `native-identity-conflict` and keeps both instances. It does not merge them,
roll back Router internals, or silently discard content. Prefer `open` for cross-document entrances.

The memory-history blocker adapter observes public blocker decisions, because the installed
TanStack memory history can leave native `navigate()` promises pending on refusal. Worksplit's
receipt settles on that refusal. Native navigation promises retain upstream semantics.
`ignoreBlocker` is a native trusted escape hatch; do not use it to bypass content decisions.

## Content decisions, commands and resources

Register a stable lifecycle with `useWorkbenchContentLifecycle`. `isDirty` is read for content
closing and document route-leave decisions. Dirty content without `beforeLeave` is refused.
A clean document or tool closes directly.
The application validates its own editing revision and save receipt before returning approval:

```tsx
const lifecycle = useMemo(
  () => ({
    isDirty: () => draft.current.text !== draft.current.saved,
    getCloseRevision: () => draft.current.version,
    beforeLeave: async () => {
      const version = draft.current.version;
      return (await askToDiscard()) && version === draft.current.version;
    },
    focus: () => input.current?.focus({ preventScroll: true }),
    save: async () => {
      /* save and validate the application's current revision */
    },
    dispose: async () => {
      await releaseDocumentResources();
    },
  }),
  [],
);
useWorkbenchContentLifecycle(lifecycle);
```

This fragment belongs inside a routed component; `draft`, `input`, confirmation and business
resources are application owned. The executable demo implements it without a second controller.
The registration ends on route/content unmount; cleanup runs once, and its failures are reported.
Keep `lifecycle` stable to avoid ending resources on every render. `getCloseRevision` reads an
application-owned string/number that changes with its edits; Worksplit neither generates nor
persists it. When closing multiple content instances, every dirty member needs this getter or
the request returns `rejected` with `revision-required` before any decisions. Tokens are captured
before the batch and checked again after all decisions, so edits to an earlier approved member
invalidate the whole request while a later dialog waits. A member that becomes dirty also
invalidates approval. For single close, `beforeLeave` still validates its own editing revision.

Tools may register guarded closing and disposal resources; they need no Router to be dirty.
Save and document focus callbacks apply to document operations. Use native `enableClose: false`
when a tool should only hide. At shutdown, dispose the instance and then unmount the React root
to end component effects and binding subscriptions.

`close(id)` shares a pending decision for that instance and rechecks committed route content and
registration before removal. Native pin and `enableClose: false` are respected; `close` does not
force-remove those tabs. New editing invalidates approval through the application callback;
new route content invalidates it in the library. Native whole-Tabset and pure deletion batches
use the same coordinator: decisions finish before any member is removed. Identical pending requests
share the decision; overlapping requests return `rejected` with reason `closing`. Membership or
closeability changes during a decision invalidate approval. `closed` includes `cleanupErrors`, so post-removal
cleanup failure never masquerades as refusal or restores a discarded instance. Closing a
background document does not take focus; active close selects same-group MRU, then other MRU,
then the configured home URL with an empty editing context. Late navigation cannot revive closed
instances. Disposal is idempotent, rejects new operations, releases subscriptions and returns
cleanup errors. Some pending loader work can continue; ignoring its result is not cancellation.

Commands have an id, `document` or `focused` target, optional TanStack hotkey, and one execute
callback. Toolbar/menu calls and shortcuts share `executeCommand`; target identity is captured
before async execution. Inputs are ignored by default. Opt into `ignoreInputs: false` for an
intentional editor command such as save, and respect content handlers that stop propagation.
`useWorkbenchContent().executeCommand(id)` retains an originating tool/document context through
React portals. Applications own background task policies and shared services.

## Native layout, tools, focus and persistence

Use native FlexLayout JSON. Document tabs use component `worksplit.document` with `config.href`;
tool tabs use component `worksplit.tool`, with an id matching a `tools` renderer registration.
Tools have no Router and never replace the document URL, including when moved to the center.
A global tool uses one id; explicit multiple tools use distinct registrations/ids.
Native Border tab selection collapses or expands content; removing a tool is a separate operation.
Empty Borders auto-hide when `borderEnableAutoHide` is enabled.

Import `Actions`, `DockLocation`, native JSON types and menu helpers directly from `flexlayout-react`.
`dispatch(Actions...)` keeps their native meaning: selection, movement, pin, maximize, weights,
Border sizing/mode, TabGroup creation/membership/ungrouping, and ordinary node/model attributes.
For example, a native display option needs no Worksplit-specific counterpart:

```tsx
import { Actions } from "flexlayout-react";

const result = await workbench.dispatch(
  Actions.updateModelAttributes({ tabSetEnableTabWrap: true }),
);
if (result.status !== "applied") console.error(result);
```

Group names, colors and collapse state stay in the native Model. TabSets and Borders can contain
native TabGroups, including in snapshots. `getEditingContext().activeGroupId` identifies the
containing TabSet or Border, rather than a TabGroup inside its strip. Activating a document in a
collapsed TabGroup expands it through a native Action. Renaming a tab changes its displayed title;
a later accepted Router location may apply its route metadata title again.

Pure layout `Actions.group` batches are supported. When a batch changes or explicitly requests
selection, document activation follows the selected document of the final central active TabSet.
Worksplit does not reconstruct cross-space focus from intermediate Actions. A single
`Actions.selectTab` can explicitly activate a Border document. Selecting a tool preserves the
document URL.

`deleteTabset` and batches containing only
deletions go through guarded closing. TabSet close preserves its non-closeable direct children,
including an entire TabGroup if any member cannot close. A pure `deleteTab` batch requires all
its targets to be closeable; otherwise none are removed. Mixed layout/deletion
batches are rejected; they do not apply layout changes before asking to discard content. The
installed version needs a narrow leaf-deletion adaptation for grouped TabSet close; see the
[coordination boundary](docs/vscode-workbench-behavior.md#coordination-boundary).

`allowDrop(tabs, target, location)` applies to all members of a moved group, native preview,
program moves, initial admission and restoration. It is a trusted pure policy: do not mutate
native nodes/Model. A TabGroup target is checked as the actual native node and against its containing
TabSet or Border, so grouping does not bypass a container policy. When supplied, a multi-step batch
containing movement or grouping is rejected:
native batches offer no per-step policy hook, and later steps can depend on earlier layout changes.
Submit those operations individually. Without this policy, native pure layout batches stay native.

Worksplit protects node identity, document component/config and document lifetimes. New routed
documents use `open`; arbitrary node insertion and Model replacement/undo are outside this
boundary. Floating, popouts and sublayouts remain disabled, including initial/restored JSON.
Other native display and sizing attributes remain available through their native Actions.

`getLayout()` returns a detached native snapshot. Ordinary content gets its identity and lifecycle
registration, not the mutable Model. `Workbench.native` uses the upstream `ILayoutProps` presentation
and interaction options, including context/overflow menus, drag rendering, resize options and
`onModelChange`. Worksplit supplies `model`, `factory` and `onAction`; external tab insertion and
multi-window options are excluded. These native slots intentionally expose native nodes and
`getModel()`: they are trusted extensions and must not mutate the owned Model. `onModelChange`
is an observer, not another layout owner. The React binding reports exceptions from
`native.onModelChange` through `onIssue`. Other native Model/Node observers remain trusted upstream
code; their mutations and callback failures are not sandboxed or rolled back.
TypeScript readonly declarations cannot isolate those child references. Route hooks similarly
expose the native Router; keep workspace ownership rules when using its escape hatches.

FlexLayout exposes `onContextMenu` and menu helpers, rather than installing a context menu itself.
The [demo](packages/demo/src/main.tsx) uses `ContextMenuBuilder` and `showPopupMenu` directly through
`native.onContextMenu`. Pass the builder an `onAction` callback that submits to `workbench.dispatch`
and handles its receipt; the upstream default callback would call `Model.doAction` directly and
bypass dirty decisions. Worksplit adds no parallel menu API. Native bulk menu actions enumerate
the visible strip tabs, so collapsed group members are not targets of “close others/right/all”.
Whole-Tabset close covers hidden members too. Border groups are valid native layout nodes;
the upstream standard Border menu does not offer group creation/membership commands.

`getEditingContext()` distinguishes active document/group, focused document/tool/shell, and
window focus. Tools and shell focus preserve the active document. `useWorkbenchState(instance,
selector)` is a typed read-only TanStack Store subscription; combine its revision/active id with
`getDocument` for navigation projections. The demo Inspector updates its marker without changing
tool selection or stealing navigation focus. Mounted content stays mounted through native moves,
pin, maximize, selection and Border collapse. Hidden effects continue until content is removed.

Below 640 px the React binding offers a document selector and temporarily maximizes the active
native central Tabset. On wider screens it restores the prior desktop maximize preference;
snapshots omit that temporary adjustment. Border size and collapse choices stay native.

Persistence is optional and explicit: save `snapshot()` through application storage and pass the
parsed candidate as `snapshot` to `createWorkbench`, with the same `workspaceId`. Restore then
calls `start(addressBarPath)`. The versioned snapshot contains native JSON and document URLs;
it contains no Router, credentials, drafts or React state. Invalid structure, unknown components,
duplicate ids, incompatible versions/workspace and forbidden docking fail without repair or
dropped records. Provide an explicit reset/conversion. Hidden restored documents do not load
until first displayed; visible groups may each load their selected document. Browser history
is workspace-local and indexed; the containing host must handle entries outside this workspace.
See the [behavior contract](docs/vscode-workbench-behavior.md) for the history rules and limits.

## Independent SplitView

```tsx
import { Pane, SplitView } from "@worksplit/react";

import "@worksplit/react/style.css";

<SplitView orientation="horizontal">
  <Pane id="list" minSize={180} defaultSize={260}>
    List
  </Pane>
  <Pane id="editor" defaultSize="1fr">
    Editor
  </Pane>
</SplitView>;
```

`Pane keepMounted` retains DOM/state while hidden; the default unmounts collapsed content.
`onLayout` reports start/change/commit phases and resize/visibility reasons. Persist committed
sizes only. Independent pane sizing, pointer/keyboard sashes and their tests remain in the core
and React packages; they are not Workbench's docking engine.
