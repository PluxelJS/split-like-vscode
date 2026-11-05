# Independent SplitView

`@worksplit/split-view` provides `SplitView` and `Pane` with React peers only. It does not own a
Workbench, Router, shared draft or application persistence. Import its CSS separately, as shown
in the [README](../README.md#install).

## Choose sizing and visibility ownership

Each direct `Pane` has a stable, unique `id`. `defaultSize` accepts pixels, percentages or `fr`;
min/max constraints and available space determine the actual size. Horizontal orientation lays
panes out left to right; vertical lays them out top to bottom. Sizes are pixels along that axis.

`defaultSizeById` supplies initial sizes. It is not a controlled sizes prop. Use the ref's
`resizePane(id, size)` or `setPaneSizes(sizeById)` to request changes; the latter merges the supplied
ids, then reallocates within constraints. Neither promises that every requested number can be
realized. `reset()` uses the initial `defaultSizeById` with the current pane defaults and
constraints. It resets sizes, not controlled visibility.

Use `defaultVisible` for component-owned visibility, or pair `visible` with
`onPaneVisibilityChange` for application-owned visibility. In the controlled case, imperative
collapse/expand/toggle calls and separator interactions request a change; the application must
accept it by updating `visible`.

```tsx
const [sidebarVisible, setSidebarVisible] = useState(true);

<SplitView
  onPaneVisibilityChange={({ id, visible }) => {
    if (id === "sidebar") setSidebarVisible(visible);
  }}
>
  <Pane id="sidebar" defaultSize={240} minSize={140} visible={sidebarVisible} keepMounted>
    <Sidebar />
  </Pane>
  <Pane id="content" defaultSize="1fr" minSize={200}>
    <Editor />
  </Pane>
</SplitView>;
```

`keepMounted` preserves hidden content and lets its effects continue. Without it, collapsed content
unmounts. A collapsed pane may occupy `collapsedSize`; that is not its remembered expanded width.
The [complete example](../packages/demo/src/examples/split-view.tsx) wires the controlled callback
and is exercised by both the demo and installed-package browser checks.

## Read layout; change it through the component

`getLayout()` returns `null` before measurement, otherwise the current readonly geometry. The
same projection is supplied to render callbacks and `onLayout`. Its nested pane records, arrays
and maps are readonly; mutating them is not a supported way to resize. This contract does not
require a deep copy or runtime freeze on every pointer movement.

`layout.panes` describes all panes; `layout.items`, `sizes`, `offsets` and `visibleIds` describe
visible panes. `sizeById` includes collapsed panes at their current `collapsedSize`. These values
describe geometry, not a persistence format containing remembered expanded sizes.

`onLayout` reports operations with a `reason` and `phase`. Persist deliberate changes on
`phase === "commit"` rather than writing storage for every pointer movement. It is not an
exhaustive observer of every measurement or prop change: container resize and controlled props
can change geometry without emitting this event. Read `getLayout()` when another application
operation needs the current geometry.

## Preserve expanded sizes when saving

Keep your previously saved expanded sizes and merge only visible panes into them. Save controlled
visibility separately through its application owner. Replacing the entire saved map with an
event's `sizeById` after collapse would replace the old width with `collapsedSize`, often zero.

```ts
import type { SplitViewLayoutEvent } from "@worksplit/split-view";

function rememberExpandedSizes(
  previous: Readonly<Record<string, number>>,
  event: SplitViewLayoutEvent,
): Readonly<Record<string, number>> {
  if (event.phase !== "commit") return previous;
  const next = { ...previous };
  for (const pane of event.layout.panes) {
    if (pane.visible) next[pane.id] = pane.size;
  }
  return next;
}
```

This function updates a host-owned value; the host chooses when and where to store it and when to
remove records for panes its product has retired. Pass the saved map as `defaultSizeById` when
mounting a new SplitView. No second layout tree, snapshot engine or Workbench dependency is needed.

## Customize separators

`renderSash` decorates a normal resize separator. `renderCollapsedSash` decorates a collapsed
pane's restore separator; neither replaces pane content or owns a separate interaction path. The
component retains the separator role and pointer/keyboard behavior. Keep decorations compatible
with those interactions rather than inserting a separate focusable control into the separator.

The former name `renderCollapsedPane` and its `SplitViewCollapsedRenderInfo` type were misleading:
the returned node appears inside the restore separator. Use `renderCollapsedSash` and
`SplitViewCollapsedSashRenderInfo`. Full Workbench migration is covered by the
[migration guide](migration.md).
