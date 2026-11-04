import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import {
  Actions,
  BorderNode,
  DockLocation,
  TabNode,
  type IJsonTabNode,
  type Action,
} from "flexlayout-react";
import { afterEach, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchInstance, type WorkbenchOptions } from "./index";
import { integrationState } from "./internal";

const instances: WorkbenchInstance<AnyRouter>[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((workbench) => workbench.dispose()));
  vi.restoreAllMocks();
});
const tab = {
  id: "extension:east:events",
  component: "extension:events",
  name: "Events",
  config: { owner: "east", entry: "events", region: "bottom" },
};
function resolveTool(key: string, value: Readonly<IJsonTabNode>) {
  const config = value.config as typeof tab.config | undefined;
  return key === tab.component &&
    value.id === tab.id &&
    config?.owner === "east" &&
    config.entry === "events" &&
    config.region === "bottom"
    ? { render: () => null }
    : undefined;
}
function setup(options: Partial<WorkbenchOptions<AnyRouter>> = {}, created?: () => void) {
  const root = createRootRoute();
  const routeTree = root.addChildren([createRoute({ getParentRoute: () => root, path: "/$id" })]);
  const workbench = createWorkbench({
    createRouter: (history) => {
      created?.();
      return createRouter({ routeTree, history });
    },
    workspaceId: "resolved-tools",
    initial: {
      layout: {
        borders: [{ type: "border", location: "bottom", selected: -1, children: [] }],
        layout: { type: "row", children: [{ type: "tabset", id: "main", children: [] }] },
      },
    },
    resolveTool,
    ...options,
  });
  instances.push(workbench);
  return workbench;
}
const staticRender = () => null;
const add = () => Actions.addTab(tab, "border_bottom", DockLocation.CENTER, -1, true);
it("resolves native tools without a Router, guards close, releases and resolves again on reopen", async () => {
  const resolver = vi.fn<typeof resolveTool>(resolveTool);
  const created = vi.fn<() => void>();
  const workbench = setup({ resolveTool: resolver }, created);
  await workbench.start();
  expect(created).not.toHaveBeenCalled();
  expect(await workbench.dispatch(add())).toMatchObject({ status: "applied" });
  expect(created).not.toHaveBeenCalled();
  const opened = await workbench.open({ to: "/$id", params: { id: "A" } });
  expect(opened.status).toBe("applied");
  const document = workbench.getActiveDocument();
  expect(workbench.getDocuments()).toHaveLength(1);
  const internal = integrationState(workbench);
  const dispose = vi.fn<() => void>();
  const beforeLeave = vi.fn<() => Promise<boolean>>(async () => false);
  const content = workbench.getContent(tab.id)!.handle;
  internal.registerController(content, {
    controller: {
      leave: {
        getState: () => ({ hasUnsavedChanges: true, token: 0 }),
        decide: async () =>
          (await beforeLeave()) ? { decision: "allow", token: 0 } : { decision: "deny" },
      },
    },
  });
  content.runEffect(({ defer }) => {
    defer(dispose);
  });
  expect(await workbench.close(tab.id)).toMatchObject({ status: "denied", reason: "decision" });
  expect(workbench.getContent(tab.id)?.role).toBe("tool");
  expect(dispose).not.toHaveBeenCalled();
  beforeLeave.mockResolvedValue(true);
  expect(await workbench.close(tab.id)).toMatchObject({ status: "applied", cleanupErrors: [] });
  expect(dispose).toHaveBeenCalledOnce();
  expect(workbench.getContent(tab.id)).toBeNull();
  resolver.mockClear();
  expect(await workbench.dispatch(add())).toMatchObject({ status: "applied" });
  expect(resolver).toHaveBeenCalledWith(tab.component, expect.objectContaining({ id: tab.id }));
  expect(workbench.getDocuments()).toHaveLength(1);
  expect(workbench.getActiveDocument()).toEqual(document);
});
it("restores native tool positions/config and refuses unknown definitions", async () => {
  const first = setup();
  await first.start();
  await first.dispatch(add());
  await first.dispatch(Actions.renameTab(tab.id, "My events"));
  const snapshot = first.createSnapshot();
  const restored = setup({ initial: { snapshot } });
  expect(restored.model.toJson().borders).toEqual(first.model.toJson().borders);
  expect(restored.getContent(tab.id)?.role).toBe("tool");
  expect(() => setup({ initial: { snapshot }, resolveTool: () => undefined })).toThrow(
    "Unknown tool definition",
  );
  const mismatched = structuredClone(snapshot);
  (mismatched.layout.borders![0]!.children![0]! as IJsonTabNode).component = "unknown:definition";
  expect(() => setup({ initial: { snapshot: mismatched } })).toThrow("Unknown tool definition");
  await restored.start();
  const before = restored.model.toJson();
  expect(
    await restored.dispatch(Actions.updateNodeAttributes(tab.id, { config: { owner: "west" } })),
  ).toMatchObject({ status: "denied" });
  expect(restored.model.toJson()).toEqual(before);
});
it("uses static definitions first and isolates resolver input from persisted configuration", async () => {
  const resolver = vi.fn<NonNullable<WorkbenchOptions<AnyRouter>["resolveTool"]>>((_key, input) => {
    (input.config as typeof tab.config).owner = "changed";
    return { render: () => null };
  });
  const staticWorkbench = setup({
    tools: { [tab.component]: { render: staticRender } },
    resolveTool: resolver,
  });
  await staticWorkbench.start();
  await staticWorkbench.dispatch(add());
  expect(resolver).not.toHaveBeenCalled();
  const record = integrationState(staticWorkbench).getRecord(tab.id);
  expect(record?.role === "tool" && record.definition.render).toBe(staticRender);
  const dynamic = setup({ resolveTool: resolver });
  await dynamic.start();
  await dynamic.dispatch(add());
  expect((dynamic.model.getNodeById(tab.id) as TabNode).getConfig()).toEqual(tab.config);
  expect(tab.config.owner).toBe("east");
});
it("keeps rejected candidates out of the live Model and content records", async () => {
  const workbench = setup({ allowDrop: () => false });
  await workbench.start();
  const observer = vi.fn<(action: Action) => void>();
  workbench.model.addChangeListener(observer);
  const before = workbench.model.toJson();
  expect(workbench.canDispatch(add())).toBe(false);
  expect(await workbench.dispatch(add())).toMatchObject({ status: "denied" });
  expect(workbench.model.toJson()).toEqual(before);
  expect(workbench.getContent(tab.id)).toBeNull();
  expect(observer).not.toHaveBeenCalled();
});
it.each([true, false])(
  "preflights tool admission without save/change side effects (allowed=%s)",
  async (allowed) => {
    const policy = vi.fn<() => boolean>(() => allowed);
    const workbench = setup({
      initial: {
        layout: {
          global: { tabEnableClose: false },
          borders: [
            {
              type: "border",
              location: "bottom",
              selected: -1,
              config: { area: "tools" },
              children: [],
            },
          ],
          layout: { type: "row", children: [{ type: "tabset", id: "main", children: [] }] },
        },
      },
      allowDrop: (tabs, target) => {
        if (tabs[0]?.getId() !== tab.id) return true;
        expect(tabs[0]?.getConfig()).toEqual(tab.config);
        expect(tabs[0]?.isEnableClose()).toBe(false);
        expect(target).toBeInstanceOf(BorderNode);
        if (!(target instanceof BorderNode)) throw new Error("Expected the tools Border");
        expect(target.getConfig()).toEqual({ area: "tools" });
        return policy();
      },
    });
    await workbench.start();
    const opened = await workbench.open({ to: "/$id", params: { id: "A" } });
    if (opened.status !== "applied") throw new Error(opened.status);
    const model = workbench.model;
    const save = vi.fn<() => void>();
    const change = vi.fn<() => void>();
    model.getNodeById(opened.value.document.id)!.setEventListener("save", save);
    model.addChangeListener(change);
    expect(workbench.canDispatch(add())).toBe(allowed);
    expect(save).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    expect(model.getNodeById(tab.id)).toBeUndefined();
    expect(policy).toHaveBeenCalledOnce();
    workbench.createSnapshot();
    expect(save).toHaveBeenCalledOnce();
  },
);
it("keeps candidate global inheritance current after direct native global actions", async () => {
  let enableClose = true;
  const workbench = setup({
    allowDrop: (tabs) => {
      expect(tabs[0]!.isEnableClose()).toBe(enableClose);
      return true;
    },
  });
  await workbench.start();
  expect(workbench.canDispatch(add())).toBe(true);
  enableClose = false;
  workbench.model.doAction(Actions.updateModelAttributes({ tabEnableClose: false }));
  expect(workbench.canDispatch(add())).toBe(true);
  enableClose = true;
  workbench.model.doAction(Actions.updateModelAttributes({ tabEnableClose: true }));
  expect(workbench.canDispatch(add())).toBe(true);
});
