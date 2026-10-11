import {
  createSplitLayout,
  resizeAtSash,
  type PaneConstraints,
  type SplitLayout,
} from "@worksplit/core";
import {
  useWorkbenchState,
  type NavigationResult,
  type CloseResult,
  type WorkbenchSnapshot,
  type OpenDocumentOptions,
  type WorkbenchTool,
  type WorkbenchDocument,
  type WorkbenchEditingContext,
  type WorkbenchProps,
} from "@worksplit/react";
import { DockLocation, Model, type IJsonModel } from "flexlayout-react";

import { workbench } from "./app.js";

export async function routeAndReceiptTypes() {
  const fakeInstance = {
    activate() {},
    getDocument() {
      return null;
    },
    executeCommand: async () => {},
    getEditingContext() {
      return {
        activeGroupId: null,
        activeTabId: null,
        focusedArea: null,
        focusedTabId: null,
        windowFocused: true,
      };
    },
  };
  const fakeProps: WorkbenchProps = {
    // @ts-expect-error Rendering requires a real Worksplit instance, not an API-shaped object.
    workbench: fakeInstance,
  };
  void fakeProps;
  const previewOptions: OpenDocumentOptions = { preview: true, reuse: "preserve" };
  void previewOptions;
  const besideOptions: OpenDocumentOptions = {
    location: DockLocation.RIGHT,
    preserveFocus: true,
  };
  void besideOptions;
  const options: OpenDocumentOptions = { newInstance: true, background: true };
  const navigation: NavigationResult = await workbench.open(
    { to: "/documents/$id", params: { id: "Typed" }, search: { view: "edit" } },
    options,
  );
  await workbench.open({
    to: "/documents/$id",
    // @ts-expect-error Params must follow the application's actual TanStack route tree.
    params: { wrong: "Typed" },
    search: { view: "edit" },
  });
  // @ts-expect-error Unknown application route paths are rejected statically.
  await workbench.open({ to: "/undeclared" });
  if (navigation.status === "committed") {
    const document: WorkbenchDocument = navigation.document;
    const containerId: string | null = document.containerId;
    void containerId;
    const preview: boolean = document.preview;
    void preview;
    workbench.keep(document.id);
    await workbench.duplicate(document.id, { location: DockLocation.RIGHT, preserveFocus: true });
    const closed: CloseResult = await workbench.close(document.id);
    if (closed.status === "closed") {
      const cleanupErrors: readonly unknown[] = closed.cleanupErrors;
      void cleanupErrors;
    } else if (closed.status === "rejected") {
      const reason: "decision" | "changed" | "closing" | "not-closeable" | "revision-required" =
        closed.reason;
      void reason;
    } else if (closed.status === "failed") {
      const error: unknown = closed.error;
      void error;
    }
  } else if (navigation.status === "failed") {
    const stage: "load" | "navigate" = navigation.stage;
    void stage;
  }
  const snapshot: WorkbenchSnapshot = workbench.snapshot();
  const nativeJson: IJsonModel = snapshot.layout;
  const context: WorkbenchEditingContext = workbench.getEditingContext();
  const renderer: WorkbenchTool = { id: "external", render: ({ id }) => id };
  const panes: PaneConstraints[] = [{ id: "left" }, { id: "right" }];
  const sized: SplitLayout = resizeAtSash(createSplitLayout({ panes, containerSize: 600 }), 0, 20);
  return { model: Model.fromJson(nativeJson), context, renderer, sized };
}

export function useReadonlyWorkbenchProjection() {
  return useWorkbenchState(workbench, (state) => {
    // @ts-expect-error The selector cannot replace the document owner.
    state.activeDocumentId = null;
    // @ts-expect-error Layout/catalogue invalidation is owned by Worksplit.
    state.revision += 1;
    // @ts-expect-error Focus state is observed by Worksplit.
    state.focusedTabId = null;
    // @ts-expect-error Focus state is observed by Worksplit.
    state.focusedArea = null;
    // @ts-expect-error Window focus state is observed by Worksplit.
    state.windowFocused = false;
    return state.activeDocumentId;
  });
}
