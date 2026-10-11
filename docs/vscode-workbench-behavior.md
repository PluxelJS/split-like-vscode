# Workbench behavior and migration

Current Worksplit uses one native FlexLayout Model and one TanStack Router per document. This page
owns behavior rules; [README](../README.md) owns installation and API use, and
[acceptance](../refactor/acceptance.md) records the tested versions/scenarios.

## State owners

| Fact                                                                     | Owner                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------ |
| Layout tree, TabGroups, selection, dimensions, pin and maximize          | FlexLayout Model                                       |
| Route matching, hooks, accepted location, loaders and errors             | Each document Router                                   |
| Tab/Router lifetimes, most recent document, MRU and pending coordination | Worksplit                                              |
| Dirty revisions, saves, shared services/cache and business subscriptions | Application                                            |
| DOM/window focus                                                         | Browser, observed by Worksplit                         |
| Address/history                                                          | Browser; one Worksplit coordinator for its owned scope |
| Persistence                                                              | Explicit application storage of a validated snapshot   |

Tool position does not change its role. A tool focused or docked centrally preserves the last
active document and its URL. A document docked in Border remains a routed document. Native moves,
grouping, pin, selection, maximize and collapse retain mounted content lifetimes.
Hidden content keeps running; close and resource registration teardown end its lifetime.
Empty central TabSets follow native cleanup by default. An edge split that moves the last tab
removes its empty source, while the final empty main root still gets one native placeholder.
There are no permanent left/right/main region ids. Explicit native `enableDeleteWhenEmpty: false`
or disabling TabSet close intentionally retains empty containers. Opening into a pruned target
fails without retaining a document; admission checks the live tree, including the upstream initial
`fromJson` case where a pruned node may still be in `getNodeById` until the next Action.

## Browser history

| Operation                                                      | History effect                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| New foreground document, changed document location             | Push after accepted routing                                           |
| Explicit Router replace                                        | Replace                                                               |
| Activate an existing document / focus another visible document | Replace                                                               |
| Same canonical location                                        | No push                                                               |
| Tool focus, size, pin, Border switching                        | None (new document activation follows activation rules)               |
| Background navigation                                          | None until activation                                                 |
| Close active document                                          | Same-group MRU, then other MRU; replace successor/home URL            |
| Back/forward                                                   | Consume owned indexed entry; never push again                         |
| Refused traversal                                              | Native history.go back to accepted position; preserve forward entries |

Entries carry a scope token, monotonic index and optional instance hint. Reloading an owned entry
retains its scope; full document navigation to an entry without the marker establishes a new
scope. Entries outside it require the containing host to handle `history-outside-scope` and
leave/unmount the workspace. This release does not integrate an outer application Router or
invent cross-application history. Hint ids are not recycled after closing restored tabs. An
unavailable hint opens by URL; closed drafts are not restored.

A new history traversal supersedes earlier pending traversals. New open requests while a
traversal/rollback is physically pending return history-busy; user activation can cancel the
traversal and queues its replace until rollback completes. A rejected traversal does not use
replace to disguise a damaged stack. Program focus restoration never starts a history write.

## Coordination boundary

Open uses real Router loading before final identity admission. Redirect conflicts reuse the
accepted target, leave the source alive, and respect the target's dirty decision when its view
state differs. The nearest route with Worksplit metadata determines identity. Native nested
routes continue to match/render through Router, not a second route table.

Native Link/navigate is scoped to its document Router. It can commit a duplicate identity;
native-identity-conflict reports this and both instances stay alive. No automatic merge or
rollback follows. This differs from the original design recommendation for every navigation
entrance: pre-commit final redirect deduplication is confined to open because native Router loads
commit matches before the resolved notification. The integration does not copy that pipeline.

The installed memory-history blocker does not reliably complete a native navigate Promise on
refusal. Worksplit observes public blocker outcomes and settles its receipt, without patching
Router internals. Native callers keep the upstream Promise behavior. Late work may continue;
operation/session checks prevent it from claiming the URL or resurrecting a closed tab.

Native `Actions` and JSON retain layout ownership. TabGroups can be authored, restored, created,
moved, renamed, colored, collapsed and ungrouped without a Worksplit group abstraction. The
containing TabSet/Border remains the editing group; the TabGroup is its strip organization. An
explicit document activation expands its collapsed native group before selecting it. Tab renames
are presentation changes; Router acceptance can subsequently apply a route metadata title.

A native batch with one leaf Action has the same document selection/move behavior as that Action,
even when nested; Model execution and observer notifications retain the original batch.
After a multi-action `Actions.group` changes the central selection or explicitly selects a central
document/active TabSet, document activation and URL coordination use its final central selected
document. A Border/tool-only selection batch keeps the last document when the central selection
is unchanged. Intermediate Actions do not establish a separate cross-space focus history. A
single `Actions.selectTab`, including its singleton batch, can explicitly activate a Border document.
Selecting tools or collapsing a Border preserves the active document and URL. Moving the active document preserves that owner
when it remains natively selected; whole-group moves use native destination selection. For example,
moving a group into an expanded Border can leave its previously selected tool visible instead.

Native selection coordinates the session and URL without calling content focus. Tab strip Enter,
arrow navigation and native focus-next-TabSet keep their native focus behavior. Explicit Worksplit
open/activate restore registered content focus, with an epoch check that cancels queued restoration
after newer native selection or observed focus.

Ordinary node/model attributes and pure layout `Actions.group` batches are supported. Node ids,
document components/config and lifetime admission remain protected. Opening routed documents uses
`open`; a single native `ADD_TAB` may admit an absent, already registered tool without a custom
insertion API. Its native JSON owns title/config/display, and it never becomes a document URL
owner. `close(id)` covers both content roles. Reopening creates a fresh native node and lifecycle;
retained callbacks from the removed node cannot register against its replacement. Tool IDs are
reserved even while absent, so they cannot collide with authored or generated document IDs.
With `allowDrop`, tool admission is rejected before mutation because the upstream public API
cannot construct a provisional TabNode for policy evaluation. Arbitrary insertion, multi-leaf
insertion batches, Model replacement/undo, floating/popouts and sublayouts are rejected.
Native presentation and interaction slots expose native objects as trusted application extensions;
they must dispatch Actions through Worksplit. Native container-creation defaults and read-only
observers can be installed directly on the borrowed Model; they do not replace its owned drop
policy or bypass guarded content mutations. There is
no second menu, layout tree or equivalent Action API.

Native JSON defaults remain available for omitted container children, contextual root/Border types,
tab types and generated document ids. Explicit malformed fields still fail. Attribute reset with
undefined follows native runtime semantics; upstream Action types with exactOptionalPropertyTypes
are narrower, and Worksplit does not replace them.

The React binding catches exceptions from the trusted `native.onModelChange` observer and reports
them through `onIssue`, without undoing the native Action. Other native Model/Node observers remain
trusted upstream code. Worksplit does not sandbox their mutations or roll back callback failures.

The same native-node `allowDrop` policy checks each member for preview/moves and validates
document admission/restoration. Document admission creates a provisional native tab without
selecting it; policy refusal or a thrown callback removes it and restores retained selection and
the previous active TabSet. Background approval preserves that active container too. Model
observers can still see insertion/deletion/restoration Actions, and native tidy can remove an empty
target. This is not a native atomic admission transaction or a second layout simulation. Cleanup
failures report a retained provisional id rather than claiming successful refusal/rollback.
With that policy, multi-step movement/grouping batches are rejected before
mutation. The installed Model only invokes its drop hook for previews; it has no per-step Action
veto inside a native batch. Worksplit neither simulates a second layout nor guesses whether later
steps will still satisfy a state-dependent policy. Submit those operations individually.

Every document removal uses the close coordinator, including native whole-Tabset closing and
pure deletion batches. All affected decisions finish before removal. Identical pending requests
share a decision; overlapping requests are rejected with `closing`. Approval is invalidated when
route content, lifecycle, affected membership, application close revision or closeability changes.
For multiple content instances, dirty members must provide `getCloseRevision`, a getter for the
application's existing string/number editing revision. Missing getters reject the whole request
with `revision-required` before dialogs. Worksplit compares batch-start tokens after all decisions;
it does not increment versions or manage edits. A member becoming dirty also invalidates approval.
This covers editing an earlier approved member while a later decision waits. Single close keeps
the application's `beforeLeave` revision check. Dirty tools use the same close rule without a Router.
Pin and `enableClose: false` remain native protections; single close returns `not-closeable`,
and group close preserves those
members. Native whole-TabSet close preserves a non-closeable direct child as a unit: if one
TabGroup member cannot close, the other members of that group remain too and receive no decisions.
Pure `deleteTab` batches reject the entire request if any explicit target cannot close. Mixed
layout/deletion batches are rejected without partial layout changes.

FlexLayout 0.11.1 `Model.applyDeleteTabset` calls `delete()` on direct children. A closeable
TabGroup has no such method, so the native operation throws `TypeError: child.delete is not a
function`. Worksplit performs approved leaf `deleteTab` Actions first, then the native TabSet
deletion; empty groups and the root placeholder are maintained by FlexLayout. This is a narrow
resource-removal adaptation, without an upstream patch or docking algorithm.

The application can build menus directly with upstream `ContextMenuBuilder/showPopupMenu` and
an `onAction` callback into `dispatch`. The upstream default would mutate the Model directly.
Native “close others/right/all” menus target only visible strip tabs; folded members remain alive.
Whole-Tabset closing includes folded members. Border TabGroups are supported in the native Model,
while its standard Border menu omits group commands. The demo provides the menu wiring.

Dirty approval belongs to application content. Repeated closes share its pending decision;
registered lifecycle or committed route changes invalidate older approval. Closed reports
cleanup errors after removal. Ending a registration disposes its resources once; close/dispose
wait for relevant in-flight cleanup. A node is never recreated to pretend failed cleanup did not
happen. Shared application services outlive individual document Routers.

Docking targets desktop workspaces. FlexLayout owns container resize, weights, overflow and native
maximize. Worksplit does not introduce a viewport breakpoint, document selector or automatic
maximize. Resize and binding mount/unmount preserve the actual native layout; snapshot records its
actual maximize choice. User controls and explicit native Actions select presentation changes.
Applications own navigation CSS and any alternative small-screen interface. Demo small-window
acceptance checks layout/resource retention and explicit native controls, not phone or touch docking.

The content wrapper leaves scrolling to FlexLayout and its native enableScrollbars attributes.
FlexLayout isolates non-Router render failures per tab and provides Retry; TanStack handles route
failures. Desktop Workbench does not subscribe to the catalogue revision for rendering, preserving
native adjusting-resize behavior.

## Breaking changes for later Pluxel migration

The old Workbench component name remains, with an instance from createWorkbench, optional
navigation/empty content, native Layout props, native `layoutRef` and standard root DOM props.
Its prior value/layout/editor/view props and Worksplit imperative ref contract are removed.
Tool registrations contain only `id` and `render`; native JSON `name` supplies their titles.
Use native providers, presentation slots and the upstream `ILayoutApi` as documented in
[host customization](../README.md#customize-the-host-with-native-apis), including its intercepted
insertion-return limitation. Editing context now records document/tool/shell focus
separately from active document/group and window focus.

Removed public contracts include WorkbenchValue, WorkbenchLayout, WorkbenchHandle, WorkbenchView,
WorkbenchEditorArrangement, recursive editor-grid/arrangement helpers, WORKBENCH_PARTS and the
custom editor drag engine. Old snapshots are not read or migrated at startup. Provide a one-time
explicit conversion/reset when migrating actual local data. SplitView, Pane, pane sizing and
independent Pane Kit uses remain.

Pluxel's future work must replace split/view.tsx conversions, its manual
WorkbenchDocumentRenderer.tsx pathname matching, and separate Shell/grid close/address controllers
with this integration. Plugin identity, remote renderers, RPC, dirty/save decisions, shared
services and dynamic availability remain Pluxel owned. This branch changes no Pluxel source,
dependency or recorded submodule pointer. A second application has not been inspected or accepted;
internal demo success is not evidence of cross-application compatibility.
