import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Actions, BorderNode, DockLocation, Model, TabGroupNode } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench } from "./index";
import { integrationState } from "./integration";

const instances: ReturnType<typeof setup>["workbench"][] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

function setup() {
  const root = createRootRoute();
  const routeTree = root.addChildren([createRoute({ getParentRoute: () => root, path: "/$id" })]);
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree, history }),
    tools: [{ id: "inspector", render: () => null }],
    layout: {
      borders: [
        {
          type: "border",
          location: "right",
          show: false,
          selected: -1,
          children: [
            { type: "tab", id: "inspector", name: "Inspector", component: "worksplit.tool" },
          ],
        },
      ],
      layout: { type: "row", children: [{ type: "tabset", id: "main", children: [] }] },
    },
  });
  return { workbench, internal: integrationState(workbench) };
}

describe("explicit tool activation", () => {
  it("cancels the scheduled native frame when closing before a hidden window can paint", async () => {
    const { workbench, internal } = setup();
    instances.push(workbench);
    vi.spyOn(internal.model.getNodeById("inspector")!, "getWindow").mockReturnValue(window);
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(123);
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const focus = vi.fn<() => void>();
    internal.register("inspector", { focus });
    workbench.activate("inspector");
    expect(cancel).not.toHaveBeenCalled();
    await workbench.close("inspector");
    expect(cancel).toHaveBeenCalledWith(123);
    expect(focus).not.toHaveBeenCalled();
  });
  it("reveals hidden tools and focuses them without changing the document or browser history", async () => {
    const { workbench, internal } = setup();
    instances.push(workbench);
    workbench.connectBrowser();
    const opened = await workbench.open({ to: "/$id", params: { id: "A" } });
    if (opened.status !== "committed") throw new Error(opened.status);
    const location = window.location.href;
    const history = window.history.state;
    const focus = vi.fn<() => void>(() => {
      const model = Model.fromJson(workbench.getLayout());
      const border = model.getNodeById("border_right") as BorderNode;
      expect(border.isShowing()).toBe(true);
      expect(border.getSelectedNode()?.getId()).toBe("inspector");
    });
    internal.register("inspector", { focus });
    expect(workbench.activate("inspector")).toBe(true);
    await Promise.resolve();
    expect(focus).toHaveBeenCalledOnce();
    expect(workbench.getActiveDocument()?.id).toBe(opened.document.id);
    expect(window.location.href).toBe(location);
    expect(window.history.state).toEqual(history);
  });

  it("expands a collapsed native group in a maximized sibling and retains its contents", async () => {
    const { workbench, internal } = setup();
    instances.push(workbench);
    const opened = await workbench.open({ to: "/$id", params: { id: "A" } });
    if (opened.status !== "committed") throw new Error(opened.status);
    const main = opened.document.containerId;
    expect(
      await workbench.dispatch(Actions.moveNode("inspector", main, DockLocation.RIGHT, -1)),
    ).toEqual({ status: "applied" });
    await workbench.dispatch(Actions.addTabToNewGroup("inspector", "Tools", "blue"));
    const group = internal.model.getNodeById("inspector")!.getParent() as TabGroupNode;
    const container = group.getParent()!.getId();
    await workbench.dispatch(Actions.updateNodeAttributes(group.getId(), { opened: false }));
    await workbench.dispatch(Actions.maximizeToggle(main));
    const dispose = vi.fn<() => void>();
    internal.register("inspector", { dispose });
    expect(workbench.activate("inspector", { focus: false })).toBe(true);
    expect(group.isOpened()).toBe(true);
    expect(internal.model.getMaximizedTabset()?.getId()).toBe(container);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("defers focus until registration, and cannot transfer a closed tool's request to its replacement", async () => {
    const { workbench, internal } = setup();
    instances.push(workbench);
    expect(workbench.activate("inspector")).toBe(true);
    const focus = vi.fn<() => void>();
    const unregister = internal.register("inspector", { focus });
    await Promise.resolve();
    expect(focus).toHaveBeenCalledOnce();
    unregister();
    workbench.activate("inspector");
    await workbench.close("inspector");
    focus.mockClear();
    expect(workbench.activate("inspector")).toBe(false);
    await workbench.dispatch(
      Actions.addTab(
        { id: "inspector", component: "worksplit.tool" },
        "border_right",
        DockLocation.CENTER,
        -1,
      ),
    );
    internal.register("inspector", { focus });
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
    expect(workbench.getDocuments()).toEqual([]);
    expect(workbench.activate("missing")).toBe(false);
  });
});
