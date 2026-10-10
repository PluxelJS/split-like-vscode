# Workbench behavior and migration

Current Worksplit uses one native FlexLayout Model and one TanStack Router per document. This page
owns behavior rules; [README](../README.md) owns installation and API use, and
[acceptance](../refactor/acceptance.md) records the tested versions/scenarios.

## State owners

| Fact                                                                     | Owner                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------ |
| Layout tree, selection, dimensions, pin and maximize                     | FlexLayout Model                                       |
| Route matching, hooks, accepted location, loaders and errors             | Each document Router                                   |
| Tab/Router lifetimes, most recent document, MRU and pending coordination | Worksplit                                              |
| Dirty revisions, saves, shared services/cache and business subscriptions | Application                                            |
| DOM/window focus                                                         | Browser, observed by Worksplit                         |
| Address/history                                                          | Browser; one Worksplit coordinator for its owned scope |
| Persistence                                                              | Explicit application storage of a validated snapshot   |

Tool position does not change its role. A tool focused or docked centrally preserves the last
active document and its URL. A document docked in Border remains a routed document. Native moves,
pin, selection, maximize and Border collapse retain mounted inputs, scroll and subscriptions.
Hidden content keeps running; close and resource registration teardown end its lifetime.

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

Every individual document removal uses the close coordinator. Whole-Tabset closing is disabled in authored
and restored JSON and rejected as an Action. Grouping, arbitrary node insertion/configuration,
floating/popouts and Action batches are also rejected. Pure supported layout Actions keep their
native meaning. The same native-node allowDrop policy checks each member for preview/moves and
validates admission/restoration; no secondary layout algorithm repairs forbidden layouts.

Dirty approval belongs to application content. Repeated closes share its pending decision;
registered lifecycle or committed route changes invalidate older approval. Closed reports
cleanup errors after removal. Ending a registration disposes its resources once; close/dispose
wait for relevant in-flight cleanup. A node is never recreated to pretend failed cleanup did not
happen. Shared application services outlive individual document Routers.

Narrow mode temporarily maximizes the active central native group and adds a document selector.
Widening restores the desktop maximize choice; snapshots preserve that choice, not narrow mode.
It does not introduce separate mobile layout preferences. Native Border collapse/dimensions remain.

## Breaking changes for later Pluxel migration

The old Workbench component name remains, but its props are now `{ workbench, navigation?, empty?,
native? }`, with an instance from createWorkbench. Its prior value/layout/editor/view props and
imperative ref contract are removed. Editing context now records document/tool/shell focus
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
