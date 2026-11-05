# Migrate to native Worksplit sessions

This guide is for any application consuming the former Workbench API. It covers the breaking
transition to the implementation described by the current [README](../README.md), including
changes that still compile but behave differently. It is not a financial application's task list.
For a fresh integration, start with the README's executable examples instead.

## Establish the installed baseline

Record the consumer's current branch, uncommitted work, actual library checkout and dependency
resolution before changing them. A parent gitlink may point behind the library checkout; do not
accidentally discard newer work while initializing a submodule.

The package version alone does not identify this redesign. Until a registry release contains it,
consume the current source or archives built from it; an older `0.1.0` package is not equivalent.
Follow [installation](../README.md#install) and [native support](navigation-support.md) for the
exact versions and complete corrections. There are two packages:

- `@worksplit/react` owns document/tool coordination and the Workbench view.
- `@worksplit/split-view` is an independent React pane splitter. Install it only when needed.

Remove `@worksplit/core` and the React package's former SplitView imports. Internal sizing
algorithms are no longer a supported package API. Keep one installation of the native peers.
For a source workspace, integrate the complete patches into its existing package-manager setup;
do not create a nested installation. For archives, run the shipped native installer after
installation and its `--check` before building or starting the host. Rebuild declarations and
bundles rather than accepting a successful check against old `dist` output.

## Map old entrypoints to their owners

These names refer to the former Workbench implementation. Apply the rows used by your project;
do not introduce features merely to complete this table.

| Former usage                                        | Current entrypoint and migration decision                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<Workbench workbench={value}>`                     | `<Workbench instance={value}>`; the view borrows the session.                                                                                      |
| `useWorkbenchContent()`                             | `useContent()` borrows the current content handle.                                                                                                 |
| `useWorkbenchContent(lifecycle)`                    | Separate borrowing from `useContentController(controller)`; the latter returns `void` and declares one persistent decision owner.                  |
| `content.effect(setup)`                             | `content.runEffect(setup)`; shared services still belong to the application.                                                                       |
| `start(href)`                                       | `start({ href })`, or `start({ browser })` when attaching the browser. Consume its result.                                                         |
| `connectBrowser()` and separate disconnect          | Browser attachment belongs to `start`; workspace termination ends it. Remove the separate connection lifetime.                                     |
| Top-level `layout` / `snapshot`                     | `initial: { layout }` / `initial: { snapshot }`, mutually exclusive.                                                                               |
| Separate `home` and `homeMode`                      | `home: { href, mode }`.                                                                                                                            |
| `keep(id)`                                          | `keepOpen(id)`, with an asynchronous operation result; this promotes a preview, not a pinned tab.                                                  |
| `snapshot()`                                        | `createSnapshot()` while running; use the returned final snapshot when closing.                                                                    |
| `getLayout()` for ordinary Workbench queries        | Read `model`, content/container queries or a state selector. Serialize only for an explicit snapshot. SplitView's `getLayout()` is a separate API. |
| `newInstance: true`                                 | `reuse: "new"`.                                                                                                                                    |
| `background: true`                                  | `presentation: "background"`; background documents cannot be previews.                                                                             |
| `preserveFocus: true`                               | `presentation: "reveal"`; verify that selecting without requesting content focus matches the old caller's intent.                                  |
| `placement`, top-level `target` / `location`        | Capture `source: ContentHandle`; choose a native `destination` or a resolver such as `beside`. Remove the old execution chain.                     |
| Third `createLink` result callback                  | Put `onResult` in the options object.                                                                                                              |
| `content.executeCommand` / library command registry | Let the application's existing shortcut or command entry call instance operations. No replacement registry is required.                            |
| Tool definition array keyed by instance id          | Use a `tools` record keyed by native `component`, or `resolveTool(definitionKey, tab)`. Definition keys and actual tab ids are different.          |
| SplitView `renderCollapsedPane`                     | `renderCollapsedSash`, with `SplitViewCollapsedSashRenderInfo`; it decorates a restore separator, not pane content.                                |

`ContentInfo` is now the discriminated union of `DocumentInfo` and `ToolInfo`: check `role` to
read document-only fields such as `href`. Code extending the former common interface should
extend the appropriate variant, or use an intersection with the union. SplitView layout outputs
are readonly, including their arrays and pane records; use its handle to resize or change
visibility instead of mutating returned data.

## Recheck behavior that a rename cannot preserve

**Home and startup.** Browser attachment requires an explicit `home`. For an application whose
root is a routed page, configure `home: { mode: "route", href: "/" }`; use `mode: "empty"` for an
empty workspace at that address. Outside browser attachment, a fresh session without `home`
defaults to empty `/`; do not assume the former routed-root startup behavior survives omission.

**Reuse and identity.** The old default reuse behavior navigated a matching document. The current
default is `reuse: "preserve"`, which retains that document's accepted location and state.
Where the caller must navigate an existing match, explicitly request `reuse: "navigate"` and
let its guard decide. `reuse: "new"` creates an independent copy. Default identity now uses the
accepted native path/search; the old `identitySearch` filter has no mechanical replacement.
Declare route `documentKey` only for an actual business identity. Equal keys can coexist after
independent opens or native navigation; do not restore an identity-conflict branch.

**Preview scope.** The former implementation had one preview across the workspace. The current
default scopes replacement to each container. Set `previewScope: "workspace"` if the application's
intended policy is still one preview in the whole workspace; this is separate from open/reuse identity.

**Presentation.** `activate` selects and requests content focus; `reveal` selects without that
focus request; `background` does not select. `activate` itself now returns an asynchronous
result. Its optional `focus` is a callback for that operation, not the former boolean. Remove
old `history` bypass options. Tool focus and active document are separate facts.

**Results.** Replace assumptions about `committed`, `closed`, `rejected`, booleans or returned
documents with `applied`, `denied`, `superseded` and `failed`. Read `value` only for `applied`.
Empty startup is successful with `value.document === null`. Failed operations may already have
effects; cleanup errors do not undo accepted work. Query current live state before a later action.
Native Router calls retain their own result contract, not Worksplit's operation union.

**Approval and handoff.** The former `beforeOutsideScope` veto does not move into
`onOutsideNavigate`. Content guards and `workspaceLeave` decide; `onOutsideNavigate` receives
the browser handoff after approval and termination. The browser has already visited that entry:
do not push it again. Its `cleanup` is completion of cleanup already underway, not permission.
Keep the application's synchronous `beforeunload` policy where required.

**Editing.** Do not mechanically rename `isDirty`, `getCloseRevision` and a boolean `beforeLeave`.
The controller returns actual `LeaveState` and a decision bound to its token. Pending writes may
block departure even without unsaved edits. Token rechecking happens before the native history
write, earlier than loading finishes. If the old resource remains editable during that interval,
pause it before allowing departure and release that request's pause with `request.defer`.
Overlapping requests own independent releases; a finished signal does not mean departure was
denied. Follow the [saved editor](../packages/demo/src/examples/editor.tsx) and its
[business store](../packages/demo/src/examples/editor-store.ts).

## Migrate one real path, then the remaining callers

1. Put creation, `start` and final `dispose` in the host owner. Use `closeWorkspace` for an exit
   that must ask permission; `dispose` is forced teardown. Create a fresh native Router for each
   supplied document history and borrow the host's shared services through native context.
2. Put a single controller above changing route leaves when the content needs editing, saving,
   title or focus ownership. `useContent()` alone claims nothing. An owner transitioning to a
   read-only resource declares `leave: null`; a purely read-only page needs no controller.
3. Separate opening another document from navigating the current one. Keep reading hierarchy
   and fallback destinations in the application, using the real per-document history for
   down/back/forward. A business marker for a source entry is not a second history stack.
4. Use `createLink` for lazy targets and dragging, with a source captured before asynchronous
   lookup. Common business helpers should select targets/options and delegate execution. Remove
   hand-written `link.open` wrappers, fabricated receipts and lookup-after-await source guesses.
5. Use the existing native Model and submit mutations through `dispatch(Actions...)`. Keep
   layout limits and business placement in the host. Adopt default menus first; customization
   retains the actual popup's `onClosed` focus handoff. Remove delayed focus retries and duplicate
   select/maximize/focus chains.
6. Move persistence to v2 snapshots with an appropriate `workspaceId`. Keep storage envelopes,
   throttling and error feedback in the host. Enable `captureSnapshotOnClose` when an exit must
   return the final snapshot; otherwise that result can be `null`. Consume the close/handoff
   snapshot and stop an older writer from overwriting it. An incompatible old layout needs explicit recovery/reset;
   do not discard business drafts as part of a layout reset.

For the `/read/$name` route from the README, a preview link can also support an explicit
background action without a second implementation:

```ts
const link = instance.createLink(
  { to: "/read/$name", params: { name: "Balance" } },
  { source: content, preview: true },
);
const result = await link.open({ presentation: "background" });
if (result.status === "applied") {
  console.log(result.value.document.id, result.value.presentation);
}
```

The explicit background override clears an inherited preview default for this call. It does not
change the link's defaults. An explicit `background` plus `preview: true` remains invalid.
When preserving the old navigate-on-reuse behavior is intentional, request it explicitly:

```ts
await instance.open({ to: "/read/$name", params: { name: "Balance" } }, { reuse: "navigate" });
```

For controlled pane visibility and persisted sizes, use the independent
[SplitView guide](split-view.md). Session startup, tools, menus and browser attachment have
complete runnable examples linked from the [README](../README.md); use those rather than
copying a financial application's policies.

## Accept the actual consumer

Typecheck the consumer and verify its real installed patches/build. Then exercise the paths it
uses in its actual host, including desktop and narrow panes:

- Open, preview promotion, reuse/new copies, native movement and keyboard/menu focus.
- Same-document down/filter/back, browser back/forward, denied navigation and outside handoff.
- Unsaved changes, pending writes, edits during save, refused batch close and shared drafts.
- Slow link/loading followed by newer user intent; background work must not steal the foreground.
- Snapshot reload, first activation of a lazy restored tab, another open and browser Back: preserve
  the exact instance and tab count. Reject malformed/old/wrong-workspace snapshots explicitly.
- Resource cleanup, late acquisitions, hidden tools and retained DOM/scroll/drafts.
- If using SplitView: pointer/keyboard resizing, controlled restore handles and saved expanded sizes.

Run the project's required final verification, remove obsolete APIs/state and update its current
contracts and evidence. Library tests and package examples do not certify a different host.
If a required capability is unsupported, identify the real gap instead of silently dropping it;
repair a demonstrated library defect at its owner rather than bypassing it in the application.

A short task for another repository can now be:

> Migrate this repository to the current Worksplit implementation using `docs/migration.md` in
> the library. Follow this project's working agreements, preserve existing business contracts and
> uncommitted work, and complete the actual-host acceptance relevant to its capabilities. Remove
> obsolete integration layers, report concrete library defects at their owner, and record exact
> installed versions, validation and remaining gaps. Commit, push and merge only within this
> project's authorization.
