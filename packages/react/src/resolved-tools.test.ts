import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { Actions, DockLocation, TabNode, type IJsonTabNode, type Action } from "flexlayout-react";
import { afterEach, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchInstance, type WorkbenchOptions } from "./index";
import { integrationState } from "./integration";

const instances: WorkbenchInstance<AnyRouter>[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((workbench) => workbench.dispose()));
  vi.restoreAllMocks();
});
const tab = {
  id: "extension:east:events",
  component: "worksplit.tool",
  name: "Events",
  config: { owner: "east", entry: "events", region: "bottom" },
};
function resolveTool(value: Readonly<IJsonTabNode>) {
  const config = value.config as typeof tab.config | undefined;
  return value.id === tab.id &&
    config?.owner === "east" &&
    config.entry === "events" &&
    config.region === "bottom"
    ? { id: value.id, render: () => null }
    : undefined;
}
function setup(options: Partial<WorkbenchOptions<AnyRouter>> = {}) {
  const root = createRootRoute();
  const routeTree = root.addChildren([createRoute({ getParentRoute: () => root, path: "/$id" })]);
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree, history }),
    layout: {
      borders: [{ type: "border", location: "bottom", selected: -1, children: [] }],
      layout: { type: "row", children: [{ type: "tabset", id: "main", children: [] }] },
    },
    resolveTool,
    ...options,
  });
  instances.push(workbench);
  return workbench;
}
const staticRender = () => null;
const add = () => Actions.addTab(tab, "border_bottom", DockLocation.CENTER, -1, true);
it("resolves fresh native tools without creating a Router, guards close, releases and resolves again on reopen", async () => {
  const resolver = vi.fn<typeof resolveTool>(resolveTool);
  const workbench = setup({ resolveTool: resolver });
  const opened = await workbench.open({ to: "/$id", params: { id: "A" } });
  expect(opened.status).toBe("committed");
  const document = workbench.getActiveDocument();
  expect(await workbench.dispatch(add())).toEqual({ status: "applied" });
  expect(workbench.getDocuments()).toHaveLength(1);
  expect(workbench.getActiveDocument()).toEqual(document);
  const internal = integrationState(workbench);
  const dispose = vi.fn<() => void>();
  const beforeLeave = vi.fn<() => Promise<boolean>>(async () => false);
  internal.register(tab.id, { isDirty: () => true, beforeLeave, dispose });
  expect(await workbench.close(tab.id)).toMatchObject({ status: "rejected", reason: "decision" });
  expect(internal.tools.has(tab.id)).toBe(true);
  expect(dispose).not.toHaveBeenCalled();
  beforeLeave.mockResolvedValue(true);
  expect(await workbench.close(tab.id)).toMatchObject({ status: "closed", cleanupErrors: [] });
  expect(dispose).toHaveBeenCalledOnce();
  expect(internal.tools.has(tab.id)).toBe(false);
  resolver.mockClear();
  expect(await workbench.dispatch(add())).toEqual({ status: "applied" });
  expect(resolver).toHaveBeenCalled();
  expect(workbench.getDocuments()).toHaveLength(1);
});
it("restores native tool positions/config and refuses unknown or mismatched definitions", async () => {
  const first = setup();
  await first.dispatch(add());
  await first.dispatch(Actions.renameTab(tab.id, "My events"));
  const snapshot = first.snapshot();
  const restored = setup({ snapshot });
  expect(restored.getLayout().borders).toEqual(first.getLayout().borders);
  expect(integrationState(restored).tools.has(tab.id)).toBe(true);
  expect(() => setup({ snapshot, resolveTool: () => undefined })).toThrow(
    "Unknown Worksplit content",
  );
  expect(() =>
    setup({ snapshot, resolveTool: () => ({ id: "wrong", render: () => null }) }),
  ).toThrow("declared id");
  const before = restored.getLayout();
  expect(
    await restored.dispatch(Actions.updateNodeAttributes(tab.id, { config: { owner: "west" } })),
  ).toEqual({ status: "rejected" });
  expect(restored.getLayout()).toEqual(before);
});
it("uses static tools first and isolates resolver input from the persisted definition", async () => {
  const resolver = vi.fn<NonNullable<WorkbenchOptions<AnyRouter>["resolveTool"]>>((input) => {
    (input.config as typeof tab.config).owner = "changed";
    return { id: input.id!, render: () => null };
  });
  const staticWorkbench = setup({
    tools: [{ id: tab.id, render: staticRender }],
    resolveTool: resolver,
  });
  await staticWorkbench.dispatch(add());
  expect(resolver).not.toHaveBeenCalled();
  expect(integrationState(staticWorkbench).tools.get(tab.id)?.render).toBe(staticRender);
  const dynamic = setup({ resolveTool: resolver });
  await dynamic.dispatch(add());
  expect((integrationState(dynamic).model.getNodeById(tab.id) as TabNode).getConfig()).toEqual(
    tab.config,
  );
  expect(tab.config.owner).toBe("east");
});
it("keeps rejected candidates out of the live model and renderer registry", async () => {
  const workbench = setup({ allowDrop: () => false });
  const internal = integrationState(workbench);
  const observer = vi.fn<(action: Action) => void>();
  internal.model.addChangeListener(observer);
  const before = workbench.getLayout();
  expect(workbench.canDispatch(add())).toBe(false);
  expect(await workbench.dispatch(add())).toEqual({ status: "rejected" });
  expect(workbench.getLayout()).toEqual(before);
  expect(internal.tools.has(tab.id)).toBe(false);
  expect(observer).not.toHaveBeenCalled();
});
