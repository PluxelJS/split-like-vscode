import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import {
  createWorkbench,
  useContent,
  useContentController,
  useWorkbenchState,
  type ContentController,
  type OpenOptions,
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
  return handle.getLayout();
}
