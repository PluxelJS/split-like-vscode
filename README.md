# Worksplit

A small split-view workspace library inspired by VS Code and the `johnwalley/allotment` layout model.

This repo is intentionally split into DOM-free core logic and a React binding:

- `packages/demo`: Vite 8 + React 19 demo with nested editor/workspace panes.
- `@worksplit/core`: pane constraints, preferred sizes, proportional resize, sash drag math, value snapshots.
- `@worksplit/react`: React components, ResizeObserver integration, pointer handling, CSS.

pnpm workspaces manage package linking. Turbo coordinates package task graphs and local caching. The
root package stays as the workspace orchestration layer; demo dependencies belong in the demo
package.

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
import { useRef } from "react";
import { Pane, SplitView, type SplitViewHandle } from "@worksplit/react";
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

### Workbench

```tsx
import { Workbench, type WorkbenchEditorGroup, type WorkbenchView } from "@worksplit/react";
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
];

export function Workspace() {
  return (
    <Workbench
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
id. The center area is either an `editor` node or descriptor-based `editorGroups` with tabs.
Runtime
`WorkbenchValue` is complete, while `WorkbenchValueSnapshot` stays partial for persistence and
initialization. Render slots receive a stable `actions` object, so common UI does not need an
imperative ref.

Workbench actions compose against the latest pending state, so multiple actions issued in one
event are applied atomically. Action objects remain stable when consumers recreate equivalent
`views` or `editorGroups` descriptors during render. Duplicate ids, conflicting defaults, and
invalid size constraints fail fast with contextual errors.
