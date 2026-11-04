# Workbench behavior

Worksplit preserves the useful editor-workbench behaviors while using native FlexLayout,
Router and React contracts. This is the current behavioral contract; [architecture](architecture.md)
explains ownership and [README](../README.md) shows the public entrypoints.

## Documents, tools and presentation

A native tab is either one routed document or one registered tool. Each document owns a fresh
native Router/history and resource lifetime. Equal URLs can identify reusable content, but
`reuse: "new"` and duplicate produce independent native tabs and histories. A tool renders by
its native component definition; resolution receives the saved tab data and does not rewrite a
business definition into a fabricated document. Unknown tool definitions fail restore.

Default document identity uses the accepted native `pathname` and `searchStr`; the hash does
not participate. This does not equate omitted query values with explicit defaults or compare
business search objects. If the Router has not resolved `/report` and `/report?mode=default` to
the same native path/search, they remain distinct. Route metadata `documentKey` can explicitly
choose business identity from the accepted match's params/search. Equal identity still does not
share Router, history or controller between separate document instances.

| Operation                      | Selection / focus                                | Lifetime                                   |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------ |
| `open` with default `activate` | Select destination and request content focus     | Reuse matching accepted identity or create |
| `presentation: "reveal"`       | Select destination, preserve content focus       | Same admission and guard checks            |
| `presentation: "background"`   | Preserve selection and focus                     | Ordinary tab only, never preview           |
| `duplicate(id)`                | Default activate; options may reveal/background  | Fresh document from accepted URL           |
| `activate(id)`                 | Reveal native container and focus after mounting | Retain content and Router                  |
| Native selection               | Native tab-strip keyboard behavior               | Retain content and Router                  |
| Tool focus                     | Preserve active document and document URL        | Retain tool and its subscriptions          |

Duplicate uses the copied document as its default placement source, even when another pane is
active. Explicit `source` or `destination` options override that default through the same placement
and admission checks as open.

`reuse: "preserve"` keeps the matched document's accepted location and container.
`reuse: "navigate"` runs the target document's native guard before changing its location.
Placement is evaluated from actual containers, source, preview and MRU with `canPlace` available
to the host. A bounded financial 2×2 arrangement is an application policy, not a library default.
`beside({ direction, ratio? })` uses native edge geometry and will not invent hidden slots.

Preview replacement asks the actual old preview owner before removal. A preview becomes ordinary
on explicit `keepOpen`, manual edit protection or native pin as specified by admission. Preview
scope can be per container or workspace. Background opens cannot create or replace previews.
A refused replacement leaves the old preview, native layout and resources intact.

## Native actions and names

The live `instance.model` is the unique layout authority. Use `dispatch` for mutations and
`canDispatch` to check exact supported actions. Native grouped Actions preserve object identity,
order and one native commit. Tab/group movement and resizing do not request a new document load
or duplicate content. A native group that becomes singleton remains the same group under the
supported FlexLayout correction. The last empty native root remains a valid workspace.

Float/popout and attributes that would circumvent content ownership are unsupported. Malformed
or unsupported batches are rejected before removal. Closing expands the actual leaf tabs of
TabSets, Borders and TabGroups, including collapsed groups. Explicit invalid ids are denied;
a valid close range with no closeable members succeeds with an empty result. Pinned and native
non-closeable tabs remain protected by their native flags.

Native `name` is the final visible/accessibility title. Automatic candidates come from the
committed controller, route metadata or tool definition, then location fallback. A native rename
or explicit `name` attribute write records manual ownership even if the text equals the current
automatic candidate. Later route/controller changes cannot overwrite it. Snapshot stores that
ownership bit and native name; it does not store another shadow title. Duplicate starts in
automatic mode. Native rename is enabled by the default Worksplit layout; hosts may turn off
`tabEnableRename` through the original native flag.

## Default and custom menus

The library supplies native-context menus for tabs, groups, TabSets and Borders. Document tabs
support keep-open, duplicate, pin, rename, native grouping, split right/down, maximize and protected
close/others/right. Group menus keep native rename/color/collapse/ungroup controls and add protected
close. Tools receive applicable native items. Splitting moves the original tab; a single leaf
cannot manufacture another content instance through split and is disabled.
An existing Border TabGroup retains collapse/expand, ungroup and remove-member actions after
move or restore. These use native Actions and current dispatch admission even though the native
menu helper limits its default group controls to enabled TabSets.

Right-click and native keyboard menu requests share one session. A session captures the actual
node/parent identity and anchor; removal or replacement invalidates it. `menus.transform` receives
native menu entries. A chosen callback is held until the renderer has removed its popup and
finished returning focus. `onClose` requests that transition; `onClosed` acknowledges completion.
A late acknowledgement from an invalidated session cannot execute its action. The default
PopupMenu is rendered in the existing React tree and retains Router/application providers.

Host dialogs may take focus after that completion without a later menu cleanup stealing it.
Custom renderers need no command framework and must keep exactly this close-completion protocol.
The [runnable custom renderer](../packages/demo/src/examples/menus.tsx) implements it.

## Links and drag/drop

`createLink` supports immediate or lazy typed navigation. Immediate href is usable by a real
anchor; normal modifier-key behavior remains the host's anchor behavior. Use a separate drag
handle when ordinary document text should remain selectable. Creating or canceling a link does
not call a lazy resolver; one real click/drop reports one result.

The native Layout performs hit testing and drag imagery. Worksplit consumes its final add
intent with the exact TabSet/Border/TabGroup, DockLocation and insertion index. The detached
native descriptor is never admitted as fake content. Default drops activate an ordinary tab;
explicit preview/presentation choices still follow ordinary validation. A delayed resolver/drop
loses eligibility when its source handle/container, destination instance/order, group openness,
or view binding changes. Canceling native overlays releases document drag ownership even while
content cleanup is still pending. No late dragleave may poison the next native drag counter.

## Editing approval and saving

One persistent `useContentController` owns leave decisions; other components only borrow
`useContent`. Approved state consists of a content/owner lifetime and business token, not a URL
or copied dirty bit. A real native transaction owns its own approval through the full blocker
chain and the final `beforeCommit` recheck. Reload, invalidate, loader redirect, retry, overlap,
refusal and provider unmount must all settle the native caller. The exact supported correction
and regressions are documented in [navigation support](navigation-support.md).

Save is application-owned. `save(id)` calls the controller capability captured for that content;
absence is an explicit denial. The editor example captures the saved draft/revision before the
async write, commits only the confirmed written basis, and leaves a later edit dirty. Failed
writes do not manufacture a saved state. Leave requests register their own pause release with
`defer`; a later blocker refusal releases an approved request's pause without clearing unsaved
facts. Concurrent requests do not release one another's ownership.

Batch close approves all current members before removal. Changed tokens, owner replacement,
new members in a range, source movement or cancellation prevent stale approval from closing
new content. Already committed removals and cleanup errors are represented accurately if a
commit-stage error occurs; there is no after-the-fact reconstruction of a removed editor.

## Focus, visibility and cleanup

Active document, active container, focused content and window focus are separate queries.
Native chrome focus does not arbitrarily cancel a valid content request. Later content pointer
or keyboard input, or focus in another content or outside the workspace, invalidates an older
delayed focus request. Automatic focus return to the source is not a new input intent. Focusing a tool preserves the
active document. Native keyboard selection keeps tab-strip focus; explicit activate/open can
focus content after mount. The native optional key map, including F6 when configured, is passed
through, not replaced by library shortcuts.

Tab movement/grouping, inactive tabs, native Border hiding and resize preserve mounted content,
input/scroll state and content resources. React effect dependencies still control their own
cleanup; Suspense/Activity behavior does not give permission to omit the persistent editing owner.
Queries never serialize layout or force content remount. During native adjusting operations the
view preserves native render optimization instead of adding a parent render for every revision.

Close ends content resources after approved native removal. `dispose` stops pending routes,
focus, drag and browser attachment before waiting for cleanup. A late setup result is cleaned
without resurrecting content. See [resource lifetimes](resource-lifetimes.md) for cleanup ordering,
error ownership and the exact settlement boundary.

## Browser entries and restore

Browser attachment is explicit at `start({ browser })` and unique per Window. Each accepted
entry refers to the real document/history entry, including duplicate documents and equal hrefs.
Rejected traversal leaves accepted state intact and native callers settle; external entries
require the protected workspace decision, then transfer the actual href/state and cleanup to
the host. Initial deep-link acceptance is part of startup; an invalid or canceled startup never
silently opens a second workspace.

Version 2 snapshots contain native layout, accepted locations and stable workspace identity.
Restore validates unknown JSON before creating Router/content lifetimes. Unsupported versions,
malformed configuration, unresolved tools and invalid topology fail explicitly. There is no
legacy converter. The host decides how to show reset/recovery and where to store shared drafts;
layout restore does not imply restoration of business data or remote capabilities.

The demo and packed consumer share read-only, real editor and custom tool/menu sources. Desktop
and narrow-window browser acceptance is separate from native Model/Router tests. External hosts,
financial split-layout acceptance and performance comparisons require their own evidence; a
successful unit suite is not a substitute for those boundaries.
