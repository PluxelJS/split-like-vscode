# Worksplit

Worksplit integrates **FlexLayout 0.11** with **TanStack Router, Store and Hotkeys**. FlexLayout owns
layout; each document has a real Router and memory history; Worksplit owns document lifetimes,
activation, guarded closing and the workspace browser history. There is one route definition and
one native Model, with no parallel docking tree or pathname renderer dispatcher.

- `@worksplit/react`: `createWorkbench`, `Workbench`, content lifecycle hooks and independent `SplitView`.
- `@worksplit/core`: the DOM-free pane sizing/resize calculations used by `SplitView`.
- `packages/demo`: the complete internal consumer, using public package exports without source aliases.

This is a breaking replacement of the old Workbench descriptors, arrangement/grid helpers, part
state and snapshots. Pluxel consumes the native Workbench API. Applications that only need independent panes use
`SplitView` without creating a document workspace. See
[behavior and migration](docs/vscode-workbench-behavior.md) and [acceptance evidence](refactor/acceptance.md).

| Task                                         | Start here                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Install in another React application         | [Source checkout](#install-from-source)                                                                               |
| Create a routed workspace                    | [Initialization](#a-complete-routed-workspace)                                                                        |
| Guard edits and own resource cleanup         | [Content decisions](#content-decisions-commands-and-resources)                                                        |
| Customize shell, providers and native Layout | [Host customization](#customize-the-host-with-native-apis)                                                            |
| Use application stores and dynamic shortcuts | [Store and Hotkeys](#host-shortcuts-and-frontend-stores)                                                              |
| Change the integration or assess its limits  | [Architecture](refactor/README.md), [behavior](docs/vscode-workbench-behavior.md), [evidence](refactor/acceptance.md) |

## Install from source

Use the main branch in a separate checkout and build the two library packages:

```sh
git clone --branch main --single-branch \
  https://github.com/PluxelJS/split-like-vscode.git worksplit
cd worksplit
mise install
pnpm install --frozen-lockfile
vp run build
mkdir -p dist
pnpm --filter @worksplit/core pack --out "$PWD/dist/worksplit-core.tgz"
pnpm --filter @worksplit/react pack --out "$PWD/dist/worksplit-react.tgz"
```

Then, in the separate React project's own directory, install both archives and native peers
together. The paths below refer to the checkout above; keep the application's React and React
DOM versions compatible with the package peer dependencies. The pinned native versions are
the ones used for acceptance:

```sh
npm install /absolute/path/to/worksplit/dist/worksplit-core.tgz \
  /absolute/path/to/worksplit/dist/worksplit-react.tgz \
  flexlayout-react@0.11.1 @tanstack/react-router@1.170.42 \
  @tanstack/react-store@0.11.2 @tanstack/react-hotkeys@0.13.0
```

This repository's root is a private workspace, with workspace/catalog dependency manifests.
`pnpm pack` produces installable dependency ranges and distribution exports; both archives are
needed because the React package depends on core. These are local trial packages; no registry
release is required. Install fresh archives after changes, since the installed package is a copy.
React, React DOM, FlexLayout and the TanStack React Router, Store and Hotkeys adapters are required
peers: the host owns their compatible versions and shared React contexts. Their transitive SDK
dependencies remain owned by the upstream packages; `@worksplit/core` is a regular dependency.

Use TypeScript `moduleResolution: "Bundler"`. Import Worksplit's public React entry and CSS,
and import native types, Actions and the selected theme directly from `flexlayout-react`.
Continue with [the complete initialization example](#a-complete-routed-workspace), then
[customize the host](#customize-the-host-with-native-apis). The host supplies its route tree,
services, shell, tools and optional snapshot storage.

For a complete external consumer, see [the isolated fixture](scripts/fixtures/packed-consumer/app.tsx).
It uses public packages, its own shell and real document Routers. `vp run test:package --browser`
independently installs freshly packed archives, checks strict types, builds the fixture, and
drives its production preview. The command prints the retained temporary directory; `npm run dev`
in that directory starts the fixture independently. Its services are application-local examples;
an actual host owns its document loading, saving and resource cleanup.

## Run and verify

```sh
mise install
pnpm install --frozen-lockfile
vp run dev                       # managed by Pitchfork; inspect with pitchfork status demo
vp run check
vp run typecheck
vp run test
vp run build
vp run test:package                # pack, independently install, typecheck and build a consumer
vp fmt --check .
vp exec playwright install chromium
vp run test:browser
vp run test:package --browser       # also drive the independently installed production preview
vp run measure                     # a running demo is required
vp run measure:native              # native grouping, collapse, movement and batch closing
```

Run `vp run hooks:install` after installation. mise supplies tools and the environment; package
scripts expose operations; native Vite tasks own dependencies and caches; hk checks staged files;
Pitchfork owns the development process. `oxlint.config.ts` and `oxfmt.config.ts` keep rule policy
separate from task and build configuration. `vp run verify` runs the full merge gate.

External versions live in the workspace pncat catalogs and are locked by `pnpm-lock.yaml`.
Library source exports use the `development` condition; production consumers use `dist`. Demo
Vite consumes the same package entry. There are no private source aliases in Vite or TypeScript.
The demo document HTTP fixture is a Vite development middleware; production hosting must supply
that endpoint. `build` verifies bundles and declarations, not a production document service.
React consumers use TypeScript's `Bundler` module resolution. FlexLayout 0.11.1's declarations
contain extensionless imports and fail strict `NodeNext` resolution independently of Worksplit;
Worksplit does not replace those upstream types. The DOM-free core package supports `NodeNext`.

The demo has a bottom Inspector and a right-hand Details tool in native FlexLayout Borders.
Click the vertical **Details** tab on the right to expand or collapse it; drag its native splitter
to resize it. Details follows the active document and keeps its own workspace note when hidden
or moved. It starts collapsed with a configured width of 260 px. No Worksplit sidebar API or
second size controller is needed.

Saved layouts restore their own tools and positions. If an older saved demo layout has no Details
tab, uncheck **Restore on refresh** and refresh to use the current default. This does not rewrite
the saved layout. Tool notes, like document drafts, are not persisted by layout snapshots.

## A complete routed workspace

Create one TanStack route tree and a Router factory. The factory must use the supplied memory
history and the same route definition, and may loan shared services through Router context.
Do not supply another browser history to document Routers.
Document `href` values and browser history use the Router's public URL, including its configured
`basepath`, search and hash. Route definitions and typed navigation targets remain route-local;
restored identity matching passes saved URLs through that same Router's location parser.
Initialize this client-side workspace in the browser; server-side Router loading and hydration
are outside the current integration's accepted scope.

```tsx
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
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
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/documents/$id", params: { id: "A" }, replace: true });
  },
});
const routeTree = rootRoute.addChildren([indexRoute, documentRoute]);
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
if (initial.status !== "committed" && initial.status !== "empty") console.error(initial);
// Call after the host has made its own decision to leave the workspace.
async function stopWorkspace() {
  disconnect();
  const cleanupErrors = await workbench.dispose();
  root.unmount();
  if (cleanupErrors.length) console.error(cleanupErrors);
}
```

This example's index route redirects `/` to document A. `start` routes its supplied URL normally;
`/` is not a reserved empty workspace route. The host defines its homepage in the same native
route tree, including any welcome content or redirect.

For a shell homepage with no document, set `home: "/", homeMode: "empty"`. `start(home)`
returns `StartResult`: the usual `NavigationResult`, or `{ status: "empty", href }` when no
saved/live documents exist. With documents, it resumes the active/native-selected document
(or the remaining MRU candidate) and replaces the home entry with that document's URL.
An owned Back/Forward entry at home without a live document hint uses the same rule:
Back to home does not close existing documents. Closing the last document and refreshing its
empty snapshot stays empty. Deep links still open normally; `open` and document-local Router
navigation remain routed even at home. Use the shell entrance for an empty homepage, not a
business `Link` to `/`. The default `homeMode: "route"` preserves the example's redirect.

`createMemoryHistory` is re-exported by TanStack Router; applications that create standalone
Routers may use it directly. Worksplit supplies the history for its own document instances.
The demo shows typed search, nested Outlet, loaders, context, redirects, native blockers and tools.
Router `Link` and `useNavigate` inside a document retain their native relative navigation,
replace and browser-link behavior. Global document entrances use `workbench.open`.

## Document operations and completion

`open(navigation, options)` uses TanStack `NavigateOptions` types. Placement uses native
`target` (TabSet/Border id) and `location` (`DockLocation.CENTER` by default; edges require a
TabSet). Omission captures the active/first central TabSet when the call starts; an implicit preview
placement can use the existing preview container. Reuse takes priority over placement and never
moves an existing identity. Use `newInstance: true` or `duplicate` for an independent comparison.
A topology refusal returns `{ status: "rejected", reason: "layout-policy" }`; an impossible
preserve-focus request returns `reason: "focus-conflict"`. Invalid targets or a custom policy
failure return a load-stage failure; no document is retained.
Container ids belong to the live native layout: empty TabSets can disappear after moving or closing
their last tab, so a previously observed target is not a permanent region id.
The optional topology policy checks the native ADD Action before insertion. The native-node
`allowDrop` callback runs after provisional insertion with `select: false`. Refusal or a thrown
policy removes that provisional node and restores retained selection/active container and weights;
approval then activates a foreground document. A background admission preserves the
existing active container. Model observers can see `ADD_TAB` / `DELETE_TAB` and selection-restoring
Actions; this is not an atomic native transaction. Native tidy can still remove an emptied target.
If a trusted native observer also prevents cleanup, the failure reports the retained provisional id.
`newInstance: true` explicitly permits another instance. `background: true` runs routing without
claiming activation or selecting the destination tab. An empty native TabSet may therefore keep
`selected: -1` until an explicit native selection; a committed background session does not imply
visible content. The most recent foreground open supersedes older foreground opens;
activation separately revokes a pending request's right to take focus or write the URL.

The nearest matched route declaring `staticData.worksplit` owns identity. Its parsed params and
optional `identitySearch` fields determine reuse; other search fields and hash are view state.
Keep these identity values JSON serializable. With no matched metadata, the last matched route
owns identity. Declare metadata on a parent route to keep its nested routes in the same document.
Full requested locations are honored, including when an existing
instance's search/hash must change. `activate(id)` preserves its committed location and restores
its registered synchronous focus callback. Reuse selects the active matching instance, then MRU,
then creation order. Layout position and pin do not enter identity.

Use `reuse: "preserve"` for an explorer/tree entrance that should reveal an already open
identity without changing its filters, hash or draft. The default `reuse: "navigate"` honors the
complete requested location. Redirect resolution still determines the final target; saved lazy
documents are matched through the same route definition without loading every restored tab.

`preview: true` requests the workspace's single replaceable preview. A new identity gets a new
document id and Router, and retires the previous clean preview only after successful admission.
Existing identities are reused first, leaving any different preview alone. Dirty, non-closeable
or already-closing previews are kept as ordinary documents. `keep(id)` keeps a comparison document
without native pinning, so it remains normally closeable. Explicit native pinning also keeps it.
`getDocument(id).preview` and snapshot config expose the state; do not mirror it in a host catalog.
`newInstance: true` always creates an ordinary document. `duplicate(id, { target?, location?, background?, preserveFocus? })`
copies an existing document's committed location into a new ordinary lifetime, without copying drafts. Background preview requests are invalid.
A preview request that loses foreground qualification while loading is superseded rather than
retiring content behind the user's current focus. Retirement cleanup errors are reported separately
from the successful new admission; a committed receipt still does not mean React has painted.

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
Worksplit reports `native-identity-conflict` and keeps both instances. Reloading or restoring an
already accepted ordinary document beside its explicit copy does not create a new conflict.
It does not merge them,
roll back Router internals, or silently discard content. Prefer `open` for cross-document entrances.

The memory-history blocker adapter observes public blocker decisions, because the installed
TanStack memory history can leave native `navigate()` promises pending on refusal. Worksplit's
receipt settles on that refusal. Native navigation promises retain upstream semantics.
`ignoreBlocker` is a native trusted escape hatch; do not use it to bypass content decisions.

## Open a document beside its originating page

Read the source from `useWorkbenchContent().id`, not from whichever tab happens to be active after
an asynchronous handler finishes. `getDocument(id).containerId` projects its current native
TabSet/Border; it does not introduce a second layout registry. For example, using the route tree above:

```tsx
import { DockLocation } from "flexlayout-react";

// In a document component, with the application's typed workbench in scope:
const content = useWorkbenchContent();
async function showRelated(id: string) {
  const source = workbench.getDocument(content.id);
  if (!source) return;
  const result = await workbench.open(
    { to: "/documents/$id", params: { id } },
    { target: source.containerId, location: DockLocation.RIGHT, preserveFocus: true },
  );
  if (result.status !== "committed") console.error(result);
}
```

The route loads before one native ADD places the new document. A failed routing operation or
refused topology check leaves no extra document or split. Router-accepted error pages still follow
the ordinary committed-document contract. The captured target is checked again before admission; a removed
target fails instead of silently choosing a different pane. The same options work with `duplicate`.
`location` remains native FlexLayout geometry, not a Worksplit left/right region abstraction.

Choose the foreground behavior explicitly:

| Open option           | Result                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Default               | Select/reveal the target, activate it, publish its URL, request its registered content focus.                     |
| `preserveFocus: true` | Select/reveal the target in another container while keeping the source active document, URL and actual DOM focus. |
| `background: true`    | Admit without selecting or activating; the target need not become visible.                                        |

`preserveFocus` and `background` are mutually exclusive. Preserving focus requires an existing
active source and a separately visible target: replacing the source's selection in its own container
fails, as does navigating that source to a different URL. Replacing another currently focused
content (including a tool) in its own container also conflicts with preserving real DOM focus. `reuse: "preserve"` can reveal an existing
identity without changing its URL. A preserved source preview becomes ordinary retained content
when a new preview opens. Maximization exits when needed to show both panes. If the user changes
focus while a normal open is loading, it loses foreground eligibility; the library does not restore
old focus or override the user's new selection. A preview request is superseded instead.

Preservation means the DOM focus at invocation. Clicking a normal button focuses that button;
Worksplit does not invent a previous input caret. An editor's own toolbar or local keyboard command
can retain its input using ordinary React/browser behavior. HeroUI menus, popovers and modal focus
scopes keep their component-owned focus rules; document coordination does not replace them.

The application chooses preferred neighbors, whether an existing detail pane should be reused,
and what to do when its configured split limit is reached. Handle `reason: "layout-policy"` before trying an alternative existing container; loader errors
or refused dirty decisions are not capacity failures. `canDispatch` checks native Actions, not a future routed document;
a MOVE of the last source tab is not a valid capacity prediction for adding a new document.
Avoid opening then moving a new document merely to implement a side-open button. Layout changes to
existing content still use ordinary native Actions through `dispatch`.

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
The hook defers effect cleanup by one microtask. React StrictMode's cleanup/setup replay of the
same content and stable lifecycle cancels that pending cleanup; a replacement lifecycle releases
the old registration before registering the new one. A genuinely live second owner still throws.
This protects content registration, not the lifetime of the entire Workbench instance. Keep the
instance under an explicit project owner, as in the example above. Never permanently `dispose()`
an instance in a simulated React cleanup and then reuse it; an effect that owns an instance must
create a fresh one for each setup and dispose that setup's instance on teardown.

The imperative `useWorkbenchContent().register(lifecycle)` returns an immediate registration cleanup;
it throws for removed/replaced content or a second live owner. Register one stable lifecycle per
content; compose business editor resources inside that owner instead of overwriting the registration. A rejected registration has not transferred resource
ownership, so the caller still releases any resources it acquired.

`beforeLeave(reason, { id, from?, to? })` receives the content id and, for document navigation,
the current and requested locations. Use this to permit view-only search changes that preserve a
draft while protecting a real resource transition. Close supplies the document's current `from`
(or just the id for a tool). The application still validates its own business editing revision.

Tools may register guarded closing and disposal resources; they need no Router to be dirty.
Save callbacks apply to document operations; focus callbacks also apply to explicit tool activation. Use native `enableClose: false`
when a tool should only hide. At shutdown, dispose the instance and then unmount the React root
to end component effects and binding subscriptions.
`dispose` releases the instance directly; it does not run dirty decisions or save drafts.
The host owns its leave policy before shutdown, browser refresh or page close. Worksplit's route
blockers do not install a `beforeunload` prompt.
Lifecycle cleanup must not await the owning instance's `dispose()`, which is waiting for that cleanup.

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
For `target: "document"`, the target is the active document even when invoked from another content
instance. For `target: "focused"`, `useWorkbenchContent().executeCommand(id)` preserves the
originating content id through React portals; a direct instance call uses the last focused content
unless `contentId` is supplied. To save a particular document independently of activation, call
`workbench.save(documentId)` explicitly. Applications own background task policies and shared services.

### Host shortcuts and frontend stores

`commands[].hotkey` is a convenience binding configured when creating the instance. For runtime
remapping, recording, enabled state, sequences or full native options, import TanStack Hotkeys
hooks directly and call `workbench.executeCommand(id)`. Omit that command's built-in `hotkey` so
there is one binding. The application owns keyboard preferences and their optional storage;
Worksplit still captures the command target before asynchronous execution.

For a workbench with a document `save` command whose execute callback calls `workbench.save(id)`,
the host can bind it from its own native Store:

```tsx
import { HotkeysProvider, useHotkey, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { createStore, useStore } from "@tanstack/react-store";

const shortcutPreferences = createStore({
  saveKey: "Mod+S" as UseHotkeyDefinition["hotkey"],
  enabled: true,
  ignoreInputs: false,
});

function ApplicationShortcuts() {
  const settings = useStore(shortcutPreferences, (state) => state);
  useHotkey(
    settings.saveKey,
    () => {
      void workbench.executeCommand("save").catch(console.error);
    },
    { enabled: settings.enabled, ignoreInputs: settings.ignoreInputs },
  );
  return null;
}

root.render(
  <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true } }}>
    <div style={{ height: "100dvh" }}>
      <ApplicationShortcuts />
      <Workbench workbench={workbench} />
    </div>
  </HotkeysProvider>,
);
// Apply a user's preference without recreating Workbench or its document Routers:
shortcutPreferences.setState((state) => ({ ...state, saveKey: "Mod+Shift+S" }));
```

This native hook is host-wide; use its native `target` option to scope it to a host element.
Provider defaults follow upstream precedence: hook and per-definition options override them.
Workbench's convenience bindings supply their own input policy and `stopPropagation: false`;
full input/event/target control belongs in the host hook. FlexLayout's tab-strip keyboard controls
use `native.keyMap`, independently of document command bindings.
See the upstream [Hotkeys guide](https://tanstack.com/hotkeys/latest/docs/framework/react/guides/hotkeys)
for recorder, conflict, sequence and option behavior.

The frontend can use `createStore` / `useStore` for its own preferences, theme, services and data.
That Store is application-owned; `useWorkbenchState(workbench, selector)` reads coordination state.
Keep document/layout writes in Worksplit operations and native Actions. There is no Worksplit
Store facade, generic data store or duplicate shortcut registry. The
[independent consumer](scripts/fixtures/packed-consumer/app.tsx) exercises both native APIs.

## Native layout, tools, focus and persistence

Use native FlexLayout JSON. Document tabs use component `worksplit.document` with `config.href`;
tool tabs use component `worksplit.tool`, with an id matching a `tools` renderer registration
or an application `resolveTool(tab)` result.
The native tab's `name` owns its title; a tool registration contains only `id` and `render`.
Native optional fields in `layout` initializers retain their defaults: empty container `children`, contextual root/Border
types and tab types may be omitted. Document ids may be generated by FlexLayout and are retained
in snapshots; tool ids must match their registrations. Explicit malformed fields are rejected.
Tools have no Router and never replace the document URL, including when moved to the center.
A global tool uses one id; explicit multiple tools use distinct registrations/ids.

For application-defined tools whose identities come from native tab config, provide
`resolveTool(tab): WorkbenchTool | undefined`. Static `tools` registrations take precedence.
The resolver receives detached native tab JSON during restore and `ADD_TAB` admission; return
an `{ id, render }` definition with exactly the requested id, or `undefined` to reject an unknown
tool. Keep this resolver pure: candidate validation can call it repeatedly without committing a tab.
Use native `Actions.addTab` to open a resolved tool and `close(id)` to close it through normal
lifecycle guards. Closing releases its resolved definition; reopening resolves it again.
Snapshots preserve the native tab config, name, position and selection. Resolved tool config is
immutable while open; close and reopen to change its identity. Display attributes remain editable.
An application `allowDrop` policy also applies to new tools, evaluated against a detached candidate
model before the live layout changes. Do not assume nodes passed to the policy belong to the live model.
Native Border tab selection collapses or expands content; removing a tool is a separate operation.
Empty Borders auto-hide when `borderEnableAutoHide` is enabled.
Empty central TabSets use FlexLayout's default cleanup. Moving the last tab out removes the source
TabSet; closing all central content leaves one native empty root placeholder. Worksplit does not
keep a fixed left/right or `main` container alive. Set native `enableDeleteWhenEmpty: false` on a
specific TabSet only when the application intentionally needs that empty space; disabling native
TabSet close also prevents its empty cleanup.

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
collapsed TabGroup expands it through a native Action. The native tab name retains user renames
through snapshot restoration, Router reloads and view-state navigation within the same identity.
Route metadata supplies the initial title and applies its default again only when the document
changes identity (route owner, params or declared `identitySearch` fields).

Pure layout `Actions.group` batches are supported. A batch with one leaf Action has the same
document selection/move behavior as that Action, including nested singleton batches. The original
batch still reaches native Model observers. When a multi-action batch changes or explicitly requests
central document/TabSet selection, document activation follows the selected document of the final
central active TabSet. A Border/tool-only selection batch preserves the last document and URL
when that central selection is unchanged.
Worksplit does not reconstruct cross-space focus from intermediate Actions. A single
`Actions.selectTab` (or its singleton batch) can explicitly activate a Border document. Selecting a
tool preserves the document URL. Moving an active document that remains selected preserves its URL. Whole-group
moves retain native destination selection, which can leave the moved members hidden.

`deleteTabset` and batches containing only
deletions go through guarded closing. TabSet close preserves its non-closeable direct children,
including an entire TabGroup if any member cannot close. A pure `deleteTab` batch requires all
its targets to be closeable; otherwise none are removed. Mixed layout/deletion
batches are rejected; they do not apply layout changes before asking to discard content. The
installed version needs a narrow leaf-deletion adaptation for grouped TabSet close; see the
[coordination boundary](docs/vscode-workbench-behavior.md#coordination-boundary).

Optional structural limits are supplied once when creating the workspace:

```tsx
import { createLayoutPolicy, createWorkbench } from "@worksplit/react";
const workbench = createWorkbench({
  createRouter: createRouterForHistory,
  layoutPolicy: createLayoutPolicy({ maxRows: 2, maxColumns: 2, maxTabsets: 4 }),
});
// Use the very same native Action for a menu's eligibility and its invocation.
const allowed = workbench.canDispatch(action);
if (allowed) await workbench.dispatch(action);
```

`createLayoutPolicy` measures native central TabSet topology; Borders are excluded. Side-by-side
children add columns and stacked children add rows, including retained empty TabSets. This is a
structural limit, not pixel alignment of independent splitters. `getLayoutTopology(model)` exposes
the same read-only measurement. Limits are opt-in positive integers; the library has no default
2×2 product policy. A restore violating the policy is rejected for the host to explicitly convert.

Native drop previews, program Actions, new document admission and restoration share the policy.
Move checks run the actual native Action and empty-container tidy on a short-lived native candidate,
without firing live content save callbacks, mounting views or retaining another layout owner.
`canDispatch` is synchronous eligibility, not a dirty-close approval or a reservation: use the
returned dispatch/close receipt. Native restriction checks and `allowDrop` still apply separately.
A bounded workspace rejects batches containing multiple Actions with a move/add; public Model APIs
cannot faithfully clone new-TabSet callbacks across later steps. Submit these operations individually.
Normal native callbacks are trusted host extensions and must not mutate coordinator-owned state.

`allowDrop(tabs, target, location)` applies to all members of a moved group, native preview,
program moves, initial admission and restoration. It is a trusted pure policy: do not mutate
native nodes/Model. A TabGroup target is checked as the actual native node and against its containing
TabSet or Border, so grouping does not bypass a container policy. When supplied, a multi-step batch
containing movement or grouping is rejected:
native batches offer no per-step policy hook, and later steps can depend on earlier layout changes.
Submit those operations individually. Without this policy, native pure layout batches stay native.

Worksplit protects node identity, document component/config and document lifetimes. New routed
documents use `open`. An already registered tool can enter or re-enter through a single
`dispatch(Actions.addTab(...))`, with its registered id and `component: "worksplit.tool"`.
Native JSON owns its name, config and display options; a live or closing id cannot be inserted
again. `close(id)` guards both documents and tools. Reopening a removed tool creates fresh content;
hiding or moving it retains existing content. Registrations are fixed for the instance lifetime.
With `allowDrop`, tool insertion is rejected before mutation: the installed public native API
cannot create an uncommitted TabNode for that policy. Existing tool moves and hide/show still work.
Multi-leaf batches containing insertion, arbitrary content insertion and Model replacement/undo
are outside this boundary. Floating, popouts and sublayouts remain disabled, including initial/restored JSON.
Other native display and sizing attributes remain available through their native Actions.
Native attribute updates may reset values with `undefined`, including the disabled float/popout
flags. Under `exactOptionalPropertyTypes`, the upstream Action types do not accept explicit
`undefined` resets; Worksplit retains those types and the native runtime behavior.

`getLayout()` returns a detached native snapshot. Ordinary content gets its identity and lifecycle
registration, not the mutable Model. `Workbench.native` uses the upstream `ILayoutProps` presentation
and interaction options, including context/overflow menus, drag rendering, resize options and
`onModelChange`. Worksplit supplies `model`, `factory` and `onAction`; external tab insertion and
multi-window options are excluded. These native slots intentionally expose native nodes and
`getModel()`: they are trusted extensions, and layout/content mutations must use `dispatch`. `onModelChange`
is an observer, not another layout owner. The React binding reports exceptions from
`native.onModelChange` through `onIssue`. Other native Model/Node observers remain trusted upstream
code; their mutations and callback failures are not sandboxed or rolled back.
TypeScript readonly declarations cannot isolate those child references. Route hooks similarly
expose the native Router; keep workspace ownership rules when using its escape hatches.

FlexLayout exposes `onContextMenu` and menu helpers, rather than installing a context menu itself.
The [demo](packages/demo/src/main.tsx) uses `ContextMenuBuilder` through `native.onContextMenu`,
then renders the native `PopupMenu` declaratively in the application tree. Pass the builder an
`onAction` callback that submits to `workbench.dispatch`
and handles its receipt; the upstream default callback would call `Model.doAction` directly and
bypass dirty decisions. Worksplit adds no parallel menu API. Native bulk menu actions enumerate
the visible strip tabs, so collapsed group members are not targets of “close others/right/all”.
Whole-Tabset close covers hidden members too. Border groups are valid native layout nodes;
the upstream standard Border menu does not offer group creation/membership commands.

For provider-based UI libraries such as Mantine, render the menu under the application's providers.
`PopupMenu` uses a portal, which preserves React context; `showPopupMenu` creates a separate React
root, which does not inherit those providers. Keep one transient menu in shell state, prevent the
context event from bubbling to the enclosing TabSet, and supply `returnFocusTo` for point anchors.
Dismiss it when its target disappears; unmounting the shell must also remove the menu. The demo
shows this ownership without introducing a Worksplit menu controller.

Style native menu CSS from the host theme, or use `PopupMenu.renderItem` for ordinary items. Call
its `api.select()` / `api.close()` and preserve the native menu's accessibility contract. Builder
entries can also contain interactive `content` (group picker, rename and color controls): do not
wrap those controls inside another clickable menu item or let menu arrow keys consume text input.
A host using a wholly Mantine-rendered menu can directly submit the same native Actions for those
controls; keep the native node as the state authority and do not invent a second menu/action DSL.
Use `native.onShowOverflowMenu` for overflow presentation and the supplied `onSelect` callback
for its selection semantics. `canDispatch` is a preflight, never a substitute for the receipt.

Pinning applies to individual central tabs, not TabGroups or Border tabs. Pinning a grouped tab
moves it out of that group into the native pinned run. It also promotes a preview to a regular
document. A product must not label a separate application lock as native group pinning.

`getEditingContext()` distinguishes active document/group, focused document/tool/shell, and
window focus. Tools and shell focus preserve the active document. `useWorkbenchState(instance,
selector)` is a typed read-only TanStack Store subscription; combine its revision/active id with
`getDocument` for navigation projections. The demo Inspector updates its marker without changing
tool selection or stealing navigation focus. Mounted content stays mounted through native moves,
pin, maximize, selection and Border collapse. Hidden effects continue until content is removed.
Native tab selection and keyboard navigation own DOM focus; Worksplit coordinates the document
and URL without invoking content focus. Explicit `open`/`activate` restore the registered focus
callback, retaining a pending request until first content registration when needed. A newer
activation, native selection/move, observed focus, window blur or disposal supersedes it. Activating
a document in another central TabSet transfers native maximization to that group, keeping the
target visible without changing the split topology.

`activate(id, { focus?, history? })` also reveals an existing tool, expanding its hidden Border or
collapsed TabGroup and transferring central maximization when necessary. A tool preserves the
active document and browser URL; `history` only applies to documents. The boolean return says
whether live content was found and revealed, not whether its deferred focus callback has run.
Missing/closed content and disposed workspaces return `false`. To reopen a closed registered tool,
first use native `dispatch(Actions.addTab(...))`, then activate its id. The original focus request
never transfers to a new tool instance that happens to reuse that id.

Content uses FlexLayout's scroll container and `enableScrollbars` attributes; its wrapper adds no
overflow clipping. Non-Router render failures use FlexLayout's per-tab error boundary and Retry;
route failures keep TanStack's error boundary. Desktop layout rendering follows native Model
updates, including its imperative adjusting-resize path. The Layout binding does not subscribe
to catalogue revisions for rendering.

Workbench is a desktop docking workspace. Available viewport space, content and open pane count
matter more than physical screen inches. FlexLayout responds to its container size; resizing
preserves the native layout, selection and maximize choice. Applications and users explicitly
maximize a TabSet with `dispatch(Actions.maximizeToggle(tabSetId))`, or use its native control.
Snapshots retain that actual native choice.

Applications own small-window navigation and presentation. The demo compacts its sidebar with
application CSS while retaining native docking. Phone layouts and touch docking are outside the
current acceptance scope; they do not add a mobile mode or another layout policy to Worksplit.

Persistence is optional and explicit: save `snapshot()` through application storage and pass the
parsed candidate as `snapshot` to `createWorkbench`, with the same `workspaceId`. Restore then
calls `start(addressBarPath)`. The versioned snapshot contains native JSON and document URLs;
it contains no Router, credentials, drafts or React state. Invalid structure, unknown components,
duplicate ids, incompatible versions/workspace and forbidden docking fail without repair or
dropped records. Saved node types and container `children` arrays must be explicit, as emitted by
`snapshot()`; initialization defaults do not repair an incomplete saved Model. Provide an explicit
reset/conversion. Hidden restored documents do not load
until first displayed with native render-on-demand defaults; visible groups may each load their
selected document. Disabling native render-on-demand mounts and loads hidden content too. Browser
history is workspace-local and indexed; the containing host must handle entries outside this workspace.
See the [behavior contract](docs/vscode-workbench-behavior.md) for the history rules and limits.

## Customize the host with native APIs

Omit `navigation` to put Workbench inside an application-owned shell, menu and navigation tree.
Standard root DOM props (`className`, `style`, `id`, ARIA attributes and event handlers) let the
host style and identify the binding directly. Library styles provide sizing, not a dark theme;
import the desired FlexLayout theme and supply application CSS. `empty` and
`native.onTabSetPlaceHolder` control empty content, with the native callback taking precedence.

The following replaces the render call in the initialization example above:

```tsx
import type { ILayoutApi } from "flexlayout-react";
import { createRef } from "react";

const layoutRef = createRef<ILayoutApi>();
root.render(
  <section style={{ height: "100dvh", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
    <header>
      <button
        onClick={() => {
          const document = workbench.getActiveDocument();
          if (document) layoutRef.current?.editTabName(document.id);
        }}
      >
        Rename active tab
      </button>
    </header>
    <Workbench
      id="application-dock"
      aria-label="Document workspace"
      className="application-dock"
      style={{ background: "transparent" }}
      workbench={workbench}
      layoutRef={layoutRef}
      native={{
        onRenderTab(node, values) {
          values.leading = (
            <span aria-hidden="true">{node.getComponent() === "worksplit.tool" ? "⚙" : "▤"}</span>
          );
        },
        onTabSetPlaceHolder: () => <p>Choose a document from the application menu.</p>,
      }}
    />
  </section>,
);
```

`layoutRef` receives the actual upstream `ILayoutApi`; there is no Worksplit handle or method
adapter. Rename, redraw, DOM access, drag presentation and moving existing tabs use that API.
Owned mutations pass through the guarded dispatcher. Consequently native `addTabToTabSet` /
`addTabToActiveTabSet` return `undefined` even when a registered tool is admitted, and native drag
`onDrop` does not receive the created node. Use `await dispatch(Actions.addTab(...))` for an
insertion receipt, and `close`/`dispatch` for asynchronous close completion.

Native `icons`, `i18nTranslator`, `keyMap`, `classNameMapper`, tab/TabSet rendering, menus,
drag rendering and resize props stay native. Worksplit owns `model`, `factory`, `onAction` and
document admission; HTML external-tab insertion and multi-window options are excluded. Native
callbacks borrow trusted nodes/Model rather than copies. Keep their mutation path in `dispatch`.
Native `Model.setOnCreateTabSet` can supply defaults for future containers, and native change
listeners can observe the Model; install them once from a native callback and remove borrowed
listeners at host shutdown. These hooks remain upstream APIs. Do not directly call `Model.doAction`,
replace the coordinator's `setOnAllowDrop` policy or replace/undo the Model, which would bypass
document lifetimes. Initial shared defaults belong in native `layout.global` JSON. FlexLayout
0.11.1 itself does not call the creation hook for every kind of split (notably whole TabGroups).

Shared React providers can surround Workbench. Per-document providers belong in the Router's
native `Wrap` / `InnerWrap` options and can use `useWorkbenchContent()` there; visible document
chrome belongs in a root route around `Outlet`. A tool's `render` can reuse those ordinary React
components. Router context, loaders, pending/error UI and route hooks remain application-owned.
This supplies service injection and customized content without another factory protocol.

[`vp run test:package`](scripts/check-package-consumer.mjs) verifies tarballs in an independent
installed consumer using public exports, strict route types, native ref/slots and a customized
React shell. It complements the demo and browser checks; it is a controlled consumer fixture,
not evidence that Pluxel or a second production application has been migrated.
Add `--browser` to exercise the compiled consumer in Chromium and retain desktop/narrow screenshots
and its results in `refactor/acceptance`. The checker retains its independent installation directory
for inspection; remove that printed temporary directory when the evidence is no longer needed.

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
