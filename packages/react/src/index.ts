export {
  Pane,
  SplitView,
  type PaneProps,
  type SplitViewCollapsedRenderInfo,
  type SplitViewHandle,
  type SplitViewLayoutEvent,
  type SplitViewLayoutReason,
  type SplitViewLayoutPhase,
  type SplitViewPaneVisibilityChange,
  type SplitViewProps,
  type SplitViewSashRenderInfo,
} from "./split-view";
export type { PaneSizeValue, SplitLayout, SplitOrientation } from "@worksplit/core";
export {
  createWorkbench,
  WorkbenchInstance,
  type WorkbenchOptions,
  type WorkbenchEditingContext,
  type WorkbenchCommand,
  type NavigationResult,
  type CloseResult,
  type WorkbenchDocument,
  type WorkbenchState,
  type WorkbenchTool,
  type WorkbenchContentLifecycle,
  type WorkbenchSnapshot,
  type WorkbenchRouteMetadata,
  type OpenDocumentOptions,
} from "./integration";
export {
  Workbench,
  useWorkbenchState,
  useWorkbenchContent,
  useWorkbenchContentLifecycle,
  type WorkbenchProps,
} from "./workbench";
