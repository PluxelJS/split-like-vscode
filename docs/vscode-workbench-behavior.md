# Workbench behavior

Current Worksplit uses one native FlexLayout Model and one TanStack Router per document. This page
owns behavior rules; [README](../README.md) owns installation and API use.
[Content API acceptance](../refactor/API_REFINEMENT_VALIDATION.md) records the API replacement and
actual host checks; [historical acceptance](../refactor/acceptance.md) retains earlier scenarios and measurements.

## State owners

| Fact                                                                     | Owner                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------ |
| Layout tree, TabGroups, selection, dimensions, pin and maximize          | FlexLayout Model                                       |
| Route matching, hooks, accepted location, loaders and errors             | Each document Router                                   |
| Tab/Router lifetimes, most recent document, MRU and pending coordination | Worksplit (including replaceable previews)             |
| Dirty revisions, saves, shared services/cache and business subscriptions | Application                                            |
| DOM/window focus                                                         | Browser, observed by Worksplit                         |
| Address/history                                                          | Browser; one Worksplit coordinator for its owned scope |
| Persistence                                                              | Explicit application storage of a validated snapshot   |

Tool position does not change its role. A tool focused or docked centrally preserves the last
active document and its URL. A document docked in Border remains a routed document. Native moves,
grouping, pin, selection, maximize and collapse retain mounted content lifetimes.
Native hidden content keeps running. React effect cleanup, manual stop and content close end the corresponding resource effect.
Explicit `activate(id)` reveals either document or tool content and may invoke its registered focus
callback. Tool activation preserves the document/URL. Its pending focus belongs to the actual native
tab instance, so closing and reopening a tool with the same id cannot inherit an obsolete request.
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
| Background or preserve-focus open                              | None until activation                                                 |
| Close active document                                          | Same-group MRU, then other MRU; replace successor/home URL            |
| Back/forward                                                   | Consume owned indexed entry; never push again                         |
| Refused traversal                                              | Native history.go back to accepted position; preserve forward entries |

Entries carry a scope token, monotonic index and optional instance hint. Reloading an owned entry
retains its scope; full document navigation to an entry without the marker establishes a new
scope. Entries outside it require the containing host to handle `history-outside-scope` and
leave/unmount the workspace. This release does not integrate an outer application Router or
invent cross-application history. Hint ids are not recycled after closing restored tabs. An
unavailable hint opens by URL; closed drafts are not restored.

At startup, matching restored comparison instances prefer the native active TabSet's selected
document when no active session or MRU exists yet. Another copy's collapsed group stays collapsed;
the address still determines the candidate documents, and a different URL routes normally.

With opt-in `homeMode: "empty"`, `start(home)` and an owned home traversal without a live
hint accept an empty workspace when no documents remain. Existing documents instead resume
active/native-selected/MRU content and normalize that home entry to its URL. Back to home
never closes all documents. Ordinary document routing and the default `homeMode: "route"`
are unchanged. `StartResult` includes `empty`; document `NavigationResult` does not.

A new history traversal supersedes earlier pending traversals. New open requests while a
traversal/rollback is physically pending return history-busy; user activation can cancel the
traversal and queues its replace until rollback completes. A rejected traversal does not use
replace to disguise a damaged stack. Program focus restoration never starts a history write.

## Coordination boundary

Open uses real Router loading before final identity admission. Redirect conflicts reuse the
accepted target, leave the source alive, and respect the target's dirty decision when its view
state differs. The nearest route with Worksplit metadata determines identity; when none declares
metadata, the last matched route owns identity. Native nested
routes continue to match/render through Router, not a second route table.

Native Link/navigate is scoped to its document Router. It can commit a duplicate identity;
native-identity-conflict reports this and both instances stay alive. Reloading or restoring
accepted ordinary and explicit-copy owners does not create a new conflict. No automatic merge or
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
explicit document activation expands its collapsed native group before selecting it, and
transfers maximization when another central TabSet would otherwise hide the target. Native tab
names retain user renames during lazy snapshot restoration, Router reloads and same-identity
query/hash navigation. Accepting a different route owner, params or declared `identitySearch`
fields applies the new owner's route metadata title; no parallel label store is maintained.

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
Explicit document activation and preserve-focus reveal also show a hidden native Border that
contains the target, including an already selected document; selection alone cannot reveal it.

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

Interactive content removal uses the close coordinator, including native whole-Tabset closing and
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
editing owner replacement, application revision changes or committed route changes invalidate older approval. Closed reports
cleanup errors after removal. Each content effect releases registered resources once; close/dispose
wait for their fixed set of registered cleanup and earlier in-flight stop tasks. A node is never recreated to pretend failed cleanup did not
happen. Shared application services outlive individual document Routers.

`dispose` is the host's explicit shutdown operation. It closes admission without running dirty
decisions or saves, settles its fixed cleanup set and returns collected errors; repeated calls share
its completion. Router cleanup attempts abort, cache release and history destruction even when
one stage fails, and failures do not prevent the remaining content from being released.
Browser refresh/page close and the host's decision to leave are application-owned; Worksplit
does not install a beforeunload approval policy. A content effect establishes ownership before setup. Refused close leaves effects running; setup
failure stops its effect and releases resources already deferred. Programmatic close/dispatch/dispose
return errors, native UI reports its receipt once, and unowned background failures use `onIssue` or
the default console diagnostic. Later waiters do not receive a second copy of an already owned error.

Command targets are captured before awaiting execution. A `document` command uses the active
document. A `focused` command uses the supplied content id or last focused content;
the content hook supplies its originating id even through portals. Changing focus afterwards
does not retarget an accepted command. Application callbacks still own their async work and saves.

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

## Host integration boundaries

The host supplies compatible peers, providers and presentation through the public
[initialization](../README.md#a-complete-routed-workspace) and
[host customization](../README.md#customize-the-host-with-native-apis) contracts.
Editing context records document/tool/shell focus separately from active document/group and window focus.

Pluxel Shell uses WorkspaceSession and native Worksplit document/tool instances; Report Template
Studio uses the same integration. Plugin identity, remote renderers, RPC, editing revisions, shared
drafts and retain/release protocols remain application owned. Content resource effects replace
application-owned generic registration bags. The library demo and packed consumer validate public
integration boundaries; Shell and Studio still require their own business and runtime evidence.
Historical acceptance records retain their original scope and do not prove the current API batch.

## Explorer reuse, previews and bounded workspaces

Explorer entrances may use `reuse: "preserve"`: reuse reveals the final matching identity without
changing its committed location. Ordinary `open` continues to honor complete requested URLs.
Unloaded restored documents participate in identity lookup through native route matching, without
running their loaders. This is not another document registry or a pathname renderer dispatcher.

There is at most one replaceable workspace preview. `preview: true` admits a fresh document
lifetime before retiring the previous clean preview. Failed admission leaves the old preview
intact; an already existing target is reused without replacing a different preview. Dirty,
non-closeable or closing content becomes ordinary retained content. Explicit `keep` and native
pinning end preview eligibility; keep does not make the native tab non-closeable. Copies are
ordinary documents and preview requests cannot be background opens. Losing foreground eligibility
while loading supersedes a preview request. Cleanup errors after retirement cannot turn a successful
new admission into a load failure. Preview is persisted in the one Worksplit snapshot, not a host
boolean or a business state machine.

`layoutPolicy: createLayoutPolicy(...)` limits central native topology; `canDispatch` lets menus
check the same Action they dispatch. Drag admission uses the same complete candidate, including
native source-group removal after its final tab moves. Borders do not count. The optional helper
uses a short-lived native Model for prediction without retaining a second layout, triggering live
save listeners or reimplementing tidy. The authoritative Model remains unique. Unsupported
multi-step docking batches are refused, not partly applied. Snapshot conversion and choosing
product-specific detail placement remain host responsibilities.

One content has one editing owner and multiple independent resource effects. Declaring a second
editing owner throws; it does not take ownership of resources. Effect admission happens before setup,
so a stale handle cannot acquire a resource through a rejected effect. Navigation decisions receive `{ id, from, to }`, while
close supplies id and an optional document location. This permits business owners to distinguish
view changes from resource replacement without bypassing guarded closing. Explicit first-open
focus waits for registration and is cancelled when real user interaction or disposal supersedes it.

## Programmatic document placement

`open` and `duplicate` accept native `target` and `location`. A new document is routed, deduplicated
and admitted with one native ADD at that location. Existing identities keep their current placement.
The default container is captured at invocation and checked for live node identity before admission;
a removed target fails, while a successful identity reuse does not depend on that old placement.
`WorkbenchDocument.containerId` is a read-only projection of the current TabSet/Border, including
when its tab is nested inside a native TabGroup. Edge insertion requires a central TabSet.

The topology policy preflights ADD before live insertion; a refused candidate returns
`rejected/layout-policy`. An impossible preserve-focus request returns `rejected/focus-conflict`. A subsequent native-node policy refusal
removes the provisional content and restores surviving container weights and selection. Observers
still see native actions; callbacks which mutate or throw during cleanup are trusted host code,
not a general transaction boundary. The library does not maintain a replacement Model for rollback.

`preserveFocus` reveals a separately visible document without transferring the source's active
document, browser URL or DOM focus. It excludes `background`, which does not request visibility.
An absent source, a different target in the source container, or a request to change the source's
own URL is a conflict, not permission to hide it or silently activate something else. The same
visibility check protects currently focused tools/content from replacement in their own container. Reusing the
same source unchanged is harmless. Maximization is removed when necessary to display both panes,
and a source preview is kept rather than retired by the newly admitted preview.

Normal open loses its foreground rights after intervening focus changes and may admit in the
background at the captured container. Preview requests instead become superseded. Neither case
restores an old focus or routes into the newly active pane merely because its loader finished later.
Business-specific adjacency and capacity fallback belong to the application; they use these
operations and existing native Actions, without a second focus queue or document registry.

## React effects, replay and hidden children

`useWorkbenchContent(lifecycle?)` declares the single editing owner after commit and reads the latest
committed callbacks. A new callback object does not replace ownership. Withdrawing, re-declaring
or remounting the owner invalidates prior close approval. Discarded renders do not publish callbacks.
Resource effects remain independent of that owner.

`content.effect(setup)` uses native `signal` and `defer`; React dependency lists stay in native
`useEffect` or `useLayoutEffect`. StrictMode cleanup ends that setup and a later setup acquires
again. Old async results are immediately released when registered with their ended context.
Activation, native movement and Border hiding do not themselves stop an effect.

Keep the editing owner in a persistent root and place Activity/Suspense resource children below it.
Activity cleans child effects when hidden; Suspense cleans hidden layout effects. Child resources
reacquire when React restores them, while the root still refuses dirty closing. Continuing commands
while Activity has deactivated the entire editing owner is outside the supported boundary.

After approved native removal or disposal starts, effect admission closes and the operation fixes
its cleanup waiting set before abort listeners or cleanup execute. Later `defer` registrations are
cleaned immediately and report independently without extending that set. Pending setup Promises do
not automatically join it. Stop is synchronous and idempotent; it starts settlement without being a
completion receipt. See [resource lifetimes](resource-lifetimes.md) for error ownership and protocol
completion. The host separately owns its Workbench instance, history connection and shared services.
