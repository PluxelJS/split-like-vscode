import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import {
  createWorkbench,
  useContent,
  useContentController,
  useWorkbenchState,
  type ContentController,
  type DocumentInfo,
  type OpenOptions,
  type ToolInfo,
  type WorkbenchSnapshot,
} from "@worksplit/react";
import { type PaneProps, type SplitViewHandle } from "@worksplit/split-view";
import { Model, type IJsonModel } from "flexlayout-react";

const root = createRootRoute();
const route = createRoute({
  getParentRoute: () => root,
  path: "/read/$name",
  validateSearch: (input: Record<string, unknown>) => ({
    mode: input.mode === "compact" ? ("compact" as const) : ("full" as const),
  }),
});
const routeTree = root.addChildren([route]);
const instance = createWorkbench({
  createRouter: (history) => createRouter({ history, routeTree }),
});
export async function contracts() {
  await instance.start();
  const result = await instance.open({
    to: "/read/$name",
    params: { name: "A" },
    search: { mode: "compact" },
  });
  // @ts-expect-error Unknown paths do not enter the application's route tree.
  await instance.open({ to: "/unknown" });
  // @ts-expect-error Params retain the native Router schema.
  await instance.open({ to: "/read/$name", params: { wrong: "A" } });
  // @ts-expect-error Search retains the native Router union.
  await instance.open({ to: "/read/$name", params: { name: "A" }, search: { mode: "wrong" } });
  // @ts-expect-error Background cannot create a preview.
  const invalid: OpenOptions = { presentation: "background", preview: true };
  void invalid;
  if (result.status === "applied") {
    const content = instance.getContent(result.value.document.id);
    if (content?.role === "document") {
      const document: DocumentInfo = content;
      const href: string = content.href;
      void [document, href];
    } else if (content?.role === "tool") {
      const tool: ToolInfo = content;
      // @ts-expect-error Tools do not acquire document navigation fields.
      void content.href;
      void tool;
    }
    const snapshot: WorkbenchSnapshot = instance.createSnapshot();
    const native: IJsonModel = snapshot.layout;
    const model: Model = instance.model;
    void [native, model];
    await instance.duplicate(result.value.document.id);
    await instance.close(result.value.document.id);
  }
}
export function Controller({ controller }: { controller: ContentController }) {
  const content = useContent();
  useContentController(controller);
  useWorkbenchState(instance, (state) => {
    // @ts-expect-error The library owns its readonly coordination state.
    state.activeDocumentId = null;
    return state.activeDocumentId;
  });
  return content.id;
}
export function splitTypes(pane: PaneProps, handle: SplitViewHandle) {
  handle.resizePane(pane.id, 180);
  const layout = handle.getLayout();
  if (layout) {
    // @ts-expect-error Geometry is owned by SplitView; callers use props or handle operations.
    layout.containerSize = 800;
    // @ts-expect-error The exposed arrays cannot reorder the internal layout.
    layout.items.splice(0, 1);
    // @ts-expect-error Pane snapshots are readonly at the field level.
    layout.panes[0]!.size = 180;
    // @ts-expect-error Named geometry cannot be mutated in place.
    layout.sizeById[pane.id] = 180;
  }
  return layout;
}
