---
"@worksplit/core": major
"@worksplit/react": major
---

# Replace the Workbench engine with FlexLayout and TanStack integration

Breaking: remove Workbench part/value/layout descriptors, editor arrangements/grids, the custom
editor drag engine and their snapshots. Keep independent pane sizing and SplitView.

The React package now provides createWorkbench, real per-document TanStack Routers, guarded
close/navigation, indexed workspace browser history, native FlexLayout Actions and tools, focus,
Hotkeys commands, explicit snapshots and narrow document switching. The demo consumes public
exports. Deduplication applies to workbench.open; native redirect conflicts are reported and both
instances retained. Whole-group close, identity mutation, grouping and popouts are disabled.

Pluxel and other applications need a separate migration; their existing contracts are incompatible.
