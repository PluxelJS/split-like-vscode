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
instances retained.

Use FlexLayout's own Actions, JSON types, TabGroups, presentation options and menu builders.
Native grouping/collapse/metadata, ordinary attributes and pure layout batches are supported;
whole-Tabset and pure deletion batches use guarded closing, preserving pin and non-closeable tabs.
Batch selection follows the final central active TabSet's selected document; a single native
`selectTab` can explicitly activate a Border document. Tool selection keeps the document URL.
Dirty members of a multi-content close provide `getCloseRevision` from application editing state;
otherwise the request rejects with `revision-required` before decisions. Tokens are rechecked after
all approvals, and dirty tools follow the same rule. Worksplit does not manage editing versions.
Model/factory/lifetime ownership and document identity stay protected. Mixed layout/deletion batches
and multi-step movement/grouping batches with an application docking policy are explicitly rejected.
Float, popout, sublayout and arbitrary Model replacement remain outside this workspace contract.
The React binding reports `native.onModelChange` exceptions; other native observers remain trusted
upstream code without sandboxing or rollback.

Pluxel and other applications need a separate migration; their existing contracts are incompatible.
