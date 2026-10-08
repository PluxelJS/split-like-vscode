# VS Code Workbench Behavior Contract

This document records the behavior patterns this workspace layout library should follow when it
models a VS Code-like workbench. The goal is not API compatibility with VS Code or Allotment. The
goal is to copy the interaction semantics that make a workbench feel predictable under repeated
use.

## Reference Model

- VS Code separates low-level split layout from workbench concepts. This project follows the same
  shape: `@worksplit/core` owns framework-free layout and workbench state, while
  `@worksplit/react` owns DOM interaction and rendering.
- VS Code `SplitView` supports snap views. A snap-capable view does not disappear the moment it
  reaches minimum size. This project keeps the pane clamped at `minSize` first, then treats a
  continued inward drag as hide intent only after a short delay.
- VS Code stores visibility and size separately. A hidden view keeps a remembered size and can be
  restored without losing the user's previous intent.

Primary source for the split/sash behavior:
https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/splitview/splitview.ts

## Parts And Views

Workbench layout is organized around parts:

- `primary`
- `secondary`
- `panel`
- editor area

Views are registered into parts. A part has one active view, and visibility belongs to the part.
This matches how VS Code activity bar entries switch side bar containers while the side bar itself
can be shown or hidden. The core and React APIs both use the same part names.

Implemented API:

- `WorkbenchView.part`
- `Workbench.partSizes`
- `WorkbenchView.renderContent`
- `WorkbenchView.defaultActive`
- `WorkbenchView.defaultVisible`
- `WorkbenchView.activityGroup`
- `WorkbenchEditorGroup`
- `WorkbenchEditorTab`
- `WorkbenchIcon`
- `WorkbenchActions`
- `WorkbenchPartSize`
- `WorkbenchHandle.activateView`
- `WorkbenchHandle.activateEditorTab`
- `WorkbenchHandle.moveEditorGroup`
- `WorkbenchHandle.equalizeEditorGroups`
- `WorkbenchHandle.maximizeEditorGroup`
- `WorkbenchHandle.restoreEditorGroups`
- `WorkbenchHandle.toggleEditorGroupMaximized`
- `WorkbenchHandle.toggleView`
- `WorkbenchHandle.showPart`
- `WorkbenchHandle.hidePart`
- `WorkbenchHandle.resetLayout`
- `WorkbenchHandle.setPanelPosition`
- `WorkbenchHandle.togglePanelPosition`
- `WorkbenchHandle.runCommand`
- `WorkbenchHandle.getLayout`
- `WorkbenchHandle.restoreLayout`
- `WorkbenchHandle.getAreaLayout`
- versioned `WorkbenchValue`

## Sash Resize

Visible sashes resize adjacent visible panes. Resizing respects:

- minimum size
- maximum size
- priority-based redistribution in core
- proportional container resize
- keyboard arrows

Sash double-click resets preferred sizes only for normal visible sashes. Hidden boundary sashes do
not treat double-click or click as restore commands.

## Snap Collapse

Snap collapse is opt-in at pane level:

```tsx
<Pane id="explorer" minSize={180} defaultSize={280} snap />
```

Workbench part panes enable `snap` by default. Editor panes do not snap by default.

Collapse behavior:

- Dragging toward a snap pane's minimum size clamps at `minSize`.
- The pane stays visible and stable at `minSize`; it does not keep shrinking visually.
- If the user keeps dragging inward while the pane is already at `minSize`, a collapse timer starts.
- The pane collapses only if the inward drag remains active for `snapCollapseDelay`.
- Default `snapCollapseDelay` is 320 ms.
- `snapThreshold` is a small pointer-pressure tolerance beyond `minSize` before the timer starts.
- Default `snapThreshold` is 2 px.
- The size from the beginning of the snap drag is cached before collapse.

This creates a deliberate "detent": reaching the minimum is resize intent; holding continued
inward pressure is hide intent.

## Hidden Boundary Restore

Hidden panes render a boundary sash at their previous edge. This boundary is not a button.

Restore behavior:

- Click does not restore a hidden pane.
- Dragging the hidden boundary outward restores the pane.
- Restore starts only after a small reveal threshold to avoid accidental pointer jitter.
- After restore, the dragged distance becomes the pane size.
- Keyboard restoration uses the directional arrow that points outward from the hidden boundary.
- Activity bar and command handles can still show/hide views directly.

This keeps the same mental model as VS Code: the activity bar is for commands and view activation;
the sash is for spatial layout.

## Activity Bar

Activity items are view commands:

- Clicking an inactive item activates its view and shows its part.
- Clicking the active visible item hides its part.
- The active item remains distinguishable even if the part is hidden.
- Footer items are supported with `activityGroup: "footer"` for settings/account-like entries.
- Consumers can replace item rendering through `renderActivityItem`.

## Editor Area

The editor area supports three inputs:

- `editor` for simple single-node usage
- `editorGroups` for static application-authored groups with tabs
- `editorTabs` for a flat content catalog whose placement is owned by an editor arrangement

The inputs are mutually exclusive. `editor` is a convenience path for a single editor surface.
`editorGroups` remains compatible with authored layouts. `editorTabs` is the user-driven model: the
application owns tab descriptors and lifecycle, while Worksplit owns placement and topology.

Each editor group owns its active tab. Without an authored `editorLayout`, multiple groups are
rendered as a horizontal split inside the center area for backward compatibility. An editor layout
can instead form an arbitrary recursive grid of horizontal and vertical split nodes.

Editor layout nodes are a discriminated union:

- group leaves reference one `WorkbenchEditorGroup.id`
- split nodes have a stable id, an orientation, and at least two children
- each split child may retain its last committed size in CSS pixels

Every declared editor group occurs exactly once. Authored invalid layouts fail fast. Persisted
layouts are treated as untrusted snapshots: malformed nodes are removed, duplicate references are
deduplicated, single-child splits are collapsed, and newly declared groups are appended. Moving a
group beside a direct target in a split with the same orientation inserts it into that split instead
of creating redundant nesting.

The workbench owns only spatial topology. Group descriptors, tabs, documents, sessions, and their
lifecycle remain consumer-owned. The editor-grid actions therefore rearrange existing groups and do
not synthesize or clone application content.

With `editorTabs`, one editor arrangement is the runtime owner of group ids, tab order, active tabs,
recursive topology, and maximized group. A tab id occurs exactly once. Pointer dragging supports
reordering within a tab strip, moving between strips, and splitting at the four edges of an editor
group. Moving the last tab out removes the empty group and collapses redundant split nodes. Invalid
or already-satisfied moves are no-ops. `moveEditorTab` is available on actions and the imperative
handle; `editorArrangement` / `onEditorArrangementChange` expose the controlled form.

`canMoveEditorTab(options, nextArrangement)` gates both pointer feedback and imperative tab moves
before pending placement, callbacks, or persistence. Its complete core candidate already removes
an emptied source group. Rejected or already-satisfied moves display no accepted drop indicator.
The policy does not normalize authored/controlled layouts; those remain consumer-owned.

Pointer feedback uses an imperative DOM layer rather than Workbench React state. One animation
frame consumes the latest point; cached group, content, strip, and tab rectangles refresh after
scroll, resize, or a consumer render. Rectangle reads finish before feedback writes. Strips show
insertion lines, center content shows a full-area overlay, and accepted edges show half-area
overlays. Edge entry uses the outer tenth of content; an accepted edge remains selected within one
third. Neither placement nor active content changes before release. Release reads fresh geometry
and the latest hit point and policy; Escape, pointer cancellation, blur, replacement, and unmount
cancel. Every completion or cancellation releases listeners, frames, observer ownership, and
feedback. A hit-test or policy failure also cleans up before being rethrown.

The default renderer supplies linked tab/tabpanel semantics and keyboard navigation. A complete
replacement can use `renderEditorTab`, which receives the required `tabProps`. Tab wrappers may
contain independent menu buttons; arrow/Home/End navigation finds sibling tabs through the group
tab strip and keeps activation and keyboard focus together. Applications may use
that slot or `onEditorTabContextMenu` to compose a product menu, but close, pin, dirty-document, and
other lifecycle rules remain application-owned.

Maximizing a group temporarily expands the branch leading to it and hides sibling branches without
changing the topology or unmounting sibling DOM. Equalization acts independently at every split
node. `getAreaLayout("editorGroups")` continues to expose the root editor split for compatibility;
nested split sizes are represented by `WorkbenchLayout.editorLayout`.

## Persistence

Workbench layout is serializable:

- `activeByPart`
- `activeEditorTabs`
- `visibleParts`
- `panelPosition`
- workbench area pane sizes
- center split pane sizes
- editor group split pane sizes
- recursive editor layout topology and nested split sizes
- editor arrangement group membership, tab order, active tabs, and topology
- maximized editor group
- schema `version`

Runtime `WorkbenchValue` is normalized and complete. `WorkbenchValueSnapshot` is the partial shape
used for persistence and initial values.

The React `Workbench` can persist this state with `storageKey`. Stored layouts must use the
current `WorkbenchLayout` shape.

## Panel Position

The panel can be positioned at the bottom or on the right:

- `defaultLayout.panelPosition` sets the uncontrolled initial position.
- `togglePanelPosition` mirrors the common workbench command shape.
- Changing position remounts the relevant split view so pane-id size snapshots can be applied
  cleanly to the new topology.

## Commands And Keybindings

Workbench commands are app-level actions. Built-in commands:

- `workbench.action.toggleSidebarVisibility`: `mod+b`
- `workbench.action.togglePanel`: `mod+j`
- `workbench.action.toggleAuxiliaryBar`: `mod+alt+b`
- `workbench.action.togglePanelPosition`: `mod+shift+j`
- `workbench.action.resetLayout`: `mod+shift+0`

`mod` maps to Ctrl on Windows/Linux and Meta on macOS. Keybindings are handled on the workbench
root through React event bubbling. Editable targets are ignored so text editing is not hijacked.
Consumers can append commands with the `commands` prop and run commands through the imperative
handle.

## Injection Points

The library should expose behavior hooks without hard-coding product UI:

- `renderSash`
- `renderCollapsedPane`
- `renderActivityItem`
- `renderEditorTab`
- `renderPartHeader`
- `renderCollapsedPart`
- `onEditorTabContextMenu`

Injected content must not change the sash role. The sash remains the interaction target.

## Accessibility

Current contract:

- Sashes use `role="separator"`.
- Orientation is mapped to ARIA orientation.
- Visible sashes support keyboard resize with arrow keys.
- Hidden boundary sashes support directional keyboard restore.
- Activity items expose `aria-pressed`.
- Editor tabs use roving focus, arrow/Home/End navigation, and linked `tab`/`tabpanel` semantics.

Future work:

- expose command labels for custom keybinding systems
- add roving focus for activity bar groups

## Backlog For Further VS Code Alignment

- zen/focus modes
- primary side bar position left/right
- secondary side bar independent activity targets
- hover affordances and delayed sash activation for dense UIs
- view container badges and contextual menus
