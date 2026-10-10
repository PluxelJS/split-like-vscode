# Worksplit

A small split-view workspace library inspired by VS Code and the `johnwalley/allotment` layout model.

This repo is intentionally split into DOM-free core logic and a React binding:

- `packages/demo`: Vite 8 + React 19 demo with nested editor/workspace panes.
- `@worksplit/core`: pane constraints, preferred sizes, proportional resize, sash drag math, recursive
  editor-grid topology, and value snapshots.
- `@worksplit/react`: React components, ResizeObserver integration, pointer handling, CSS.

pnpm workspaces manage package linking. Turbo coordinates package task graphs and local caching. The
root package stays as the workspace orchestration layer; demo dependencies belong in the demo
package.

External dependencies are managed by pncat in the root `pnpm-workspace.yaml` catalogs.
Use `pnpm catalog:add <package>` to add dependencies and `pnpm catalog:detect` to report
uncatalogized declarations. Detection is advisory and does not fail CI. Normal versions use caret ranges; published React peer ranges retain their
broader compatibility contract. The catalogs also make this checkout independently installable
when its library packages are included in a parent workspace. The parent must provide the
same catalog names used by those package manifests.

The VS Code-like behavior contract is tracked in
[docs/vscode-workbench-behavior.md](./docs/vscode-workbench-behavior.md).

## Run

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the library demo on port `5174`.

## Scripts

```sh
pnpm lint
pnpm format
pnpm test
pnpm typecheck
pnpm build
```

`build`, `test`, `typecheck`, and `lint` are Turbo-backed. `format` stays a whole-repo write operation.

## Example

### SplitView

```tsx
import { Pane, SplitView, type SplitViewHandle } from "@worksplit/react";
import { useRef } from "react";

import "@worksplit/react/style.css";

export function Workspace() {
  const workspace = useRef<SplitViewHandle>(null);

  return (
    <SplitView ref={workspace} orientation="horizontal">
      <Pane id="explorer" minSize={180} defaultSize={260}>
        <button onClick={() => workspace.current?.collapsePane("explorer")}>Explorer</button>
      </Pane>
      <Pane id="editor" minSize={320} defaultSize="1fr">
        Editor
      </Pane>
      <Pane id="assistant" minSize={220} defaultSize={320}>
        Assistant
      </Pane>
    </SplitView>
  );
}
```

`onLayout` is the single layout lifecycle event. Its `phase` is `start`, `change`, or `commit`, and
its `reason` identifies pointer, keyboard, visibility, reset, or imperative work. Persistence
should only consume `commit` events so pointer movement never performs synchronous storage writes.

### Preserving pane content

A collapsed pane unmounts its content by default. Opt into `keepMounted` for forms,
tabs, or other stateful content:

```tsx
<Pane id="inspector" keepMounted visible={inspectorVisible}>
  <Inspector />
</Pane>
```

This mounts content even when initially collapsed. Hidden content uses `display: none`,
`hidden`, `inert`, and `aria-hidden`; it does not participate in the split layout.
React state, DOM values, and scroll positions survive collapse and expansion. Effects
and subscriptions continue running; applications still own background-work policies
and focus restoration. Removing the pane or remounting the SplitView ends its lifetime.
This option does not move content between containers or manage responsive overlays.

### Workbench

```tsx
import {
  Workbench,
  type WorkbenchEditorGroup,
  type WorkbenchLayout,
  type WorkbenchView,
} from "@worksplit/react";

import "@worksplit/react/style.css";

const views: WorkbenchView[] = [
  {
    id: "explorer",
    part: "primary",
    title: "Explorer",
    renderContent: () => <Explorer />,
  },
  {
    id: "terminal",
    part: "panel",
    title: "Terminal",
    renderContent: () => <Terminal />,
  },
];

const editorGroups: WorkbenchEditorGroup[] = [
  {
    id: "main",
    tabs: [
      { id: "app", title: "App.tsx", renderContent: () => <AppFile /> },
      { id: "split-view", title: "SplitView.tsx", renderContent: () => <SplitViewFile /> },
    ],
  },
  {
    id: "preview",
    size: { default: 360, min: 260 },
    tabs: [{ id: "preview", title: "Preview", renderContent: () => <Preview /> }],
  },
  {
    id: "terminal",
    tabs: [{ id: "terminal", title: "Terminal", renderContent: () => <Terminal /> }],
  },
];

const defaultLayout: WorkbenchLayout = {
  version: 1,
  panelPosition: "bottom",
  value: { version: 1 },
  editorLayout: {
    type: "split",
    id: "root",
    orientation: "horizontal",
    children: [
      { node: { type: "group", groupId: "main" } },
      {
        node: {
          type: "split",
          id: "preview-stack",
          orientation: "vertical",
          children: [
            { node: { type: "group", groupId: "preview" } },
            { node: { type: "group", groupId: "terminal" } },
          ],
        },
      },
    ],
  },
};

export function Workspace() {
  return (
    <Workbench
      defaultLayout={defaultLayout}
      editorGroups={editorGroups}
      partSizes={{
        panel: { default: 220, min: 140, max: 360 },
        primary: { default: 260, min: 180, max: 420 },
      }}
      renderPartHeader={({ actions, part, view }) => (
        <Header title={view.title} onClose={() => actions.hidePart(part)} />
      )}
      storageKey="workspace-layout"
      views={views}
    />
  );
}
```

Workbench state is controlled with `value` / `onValueChange`; uncontrolled initialization uses one
versioned `defaultLayout`. Layout changes emit through `onLayout`, with area sizes stored by pane
id. The center area is an `editor` node, static descriptor-based `editorGroups`, or a flat
`editorTabs` catalog backed by a mutable editor arrangement. Runtime
`WorkbenchValue` is complete, while `WorkbenchValueSnapshot` stays partial for persistence and
initialization. Render slots receive a stable `actions` object, so common UI does not need an
imperative ref.

Workbench actions compose against the latest pending state, so multiple actions issued in one
event are applied atomically. Action objects remain stable when consumers recreate equivalent
`views` or `editorGroups` descriptors during render. Duplicate ids, conflicting defaults, and
invalid size constraints fail fast with contextual errors.

`defaultLayout.editorLayout` describes an optional recursive editor grid. Omitting it preserves the
legacy behavior: one group renders directly and multiple groups form one horizontal split. Split
nodes have stable ids and may contain horizontal or vertical child splits. Every declared editor
group must occur exactly once in an authored layout.

The grid owns spatial state, not application content. `moveEditorGroup` can reposition an existing
group, while creation and deletion of group descriptors remain the consumer's responsibility:

```tsx
renderEditorTabLabel={({ actions, group, tab }) => (
  <button
    onDoubleClick={() => actions.toggleEditorGroupMaximized(group.id)}
    onClick={() => actions.activateEditorTab(group.id, tab.id)}
  >
    {tab.title}
  </button>
)}
```

`moveEditorGroup`, `equalizeEditorGroups`, `maximizeEditorGroup`, `restoreEditorGroups`, and
`toggleEditorGroupMaximized` are available on both render-slot actions and `WorkbenchHandle`.
Maximizing is non-destructive: the topology and committed sash sizes stay intact, and sibling group
DOM remains mounted.

For user-driven editor placement, pass a flat tab catalog and initialize
`defaultLayout.editorArrangement`. Worksplit then owns tab order, active tabs, group topology,
pointer drop targets, empty-group removal, and persistence. The application continues to own tab
content and lifecycle:

```tsx
const editorTabs: WorkbenchEditorTab[] = [
  { id: "ledger", title: "Ledger", renderContent: () => <Ledger /> },
  { id: "review", title: "Review", renderContent: () => <Review /> },
];

<Workbench
  defaultLayout={{
    version: 1,
    panelPosition: "bottom",
    value: { version: 1 },
    editorArrangement: {
      groups: [{ id: "main", tabIds: ["ledger", "review"], activeTabId: "ledger" }],
      layout: { type: "group", groupId: "main" },
    },
  }}
  editorTabs={editorTabs}
  renderEditorTab={({ tab, tabProps }) => <button {...tabProps}>{tab.title}</button>}
  storageKey="workspace-layout"
/>;
```

Dragging a tab within a strip reorders it; dragging across strips moves it; dropping at an editor
edge creates a left, right, top, or bottom split. Moving the final tab out removes its empty group
and collapses redundant split nodes. `moveEditorTab` exposes the same operation through render-slot
actions and `WorkbenchHandle`. `editorArrangement` / `onEditorArrangementChange` provide controlled
ownership when an application needs it. `renderEditorTab` receives the complete accessible
`tabProps`; `onEditorTabContextMenu` is available when the application only needs a menu hook.
Worksplit intentionally does not define close, pin, dirty-document, or product menu semantics.

For an empty workspace, keep the catalog API and provide `editor` as fallback content:

```tsx
<Workbench editorTabs={editorTabs} editor={<EmptyWorkspace />} />
```

When `editorTabs` is empty, this renders the fallback in the scrollable editor area without creating
a tab or group: `getEditingContext()` reports null editor ids. Once tabs exist, only their layout
is rendered. Passing only `editor` still uses the simple single-editor surface.

`Workbench` also owns the last active editor independently of DOM focus. Read it synchronously
through `handle.getEditingContext()`, or project the final committed context into application UI:

```tsx
import { Workbench, type WorkbenchEditingContext } from "@worksplit/react";

<Workbench
  editorTabs={editorTabs}
  onEditingContextChange={(context: WorkbenchEditingContext) => {
    // Use context.activeTabId for routing and contextual commands.
    // context.focusedArea describes DOM focus without clearing that editor.
    updateEditorContext(context);
  }}
/>;
```

The callback runs in a layout effect after the final React commit and skips unchanged contexts.
Synchronous actions may read the getter immediately. Sidebars, portals mounted into a workbench
part, and window blur retain the active editor. See the [editing-context contract](docs/vscode-workbench-behavior.md#editing-context) for controlled arrangements and styling hooks.

`canMoveEditorTab(options, nextArrangement)` lets the application reject a complete tab-move
candidate before either pointer feedback or imperative submission. The candidate includes removal
of an empty source group. Returning `false` displays a blocked drag ghost and suppresses the drop
indicator, arrangement/value callbacks, and persistence for that move. Core no-ops, including a
sole tab dropped on its own edge, also produce no accepted indicator or arrangement change. This
policy gates tab moves; consumers still own authored and controlled arrangements.

Dragging uses a separate DOM feedback layer, with pointer updates coalesced into animation frames
and cached group/content/tab rectangles invalidated by scroll, resize, and consumer renders.
Tab-strip targets show an insertion line, content-center targets show the full content area, and
edge targets show the proposed half. An edge starts within the outer tenth and remains selected
within one third while its candidate is accepted. Tab placement and active content stay in place
until release, which refreshes geometry, the hit point, and the policy. Escape, pointer cancellation,
window blur, a replacement gesture, and unmount cancel the gesture; completion, cancellation, and
callback failures release listeners, scheduled frames, observers, and feedback. Callback failures
are rethrown after cleanup.
