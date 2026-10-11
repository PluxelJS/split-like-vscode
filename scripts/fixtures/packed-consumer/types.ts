import {
  createSplitLayout,
  resizeAtSash,
  type PaneConstraints,
  type SplitLayout,
} from "@worksplit/core";
import {
  type NavigationResult,
  type CloseResult,
  type WorkbenchSnapshot,
  type OpenDocumentOptions,
  type WorkbenchTool,
  type WorkbenchDocument,
  type WorkbenchEditingContext,
} from "@worksplit/react";
import { Model, type IJsonModel } from "flexlayout-react";

import { workbench } from "./app.js";

export async function routeAndReceiptTypes() {
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
