/* eslint-disable no-await-in-loop -- Native scenarios and resource teardown deliberately run in order. */
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Actions, BorderNode, DockLocation, TabGroupNode } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench } from "./index";
import { integrationState } from "./internal";

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0).toReversed()) await stop();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
async function setup(browser = false) {
  const root = createRootRoute();
  const tree = root.addChildren([createRoute({ getParentRoute: () => root, path: "/$id" })]);
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: tree, history }),
    home: { mode: "empty", href: "/" },
    tools: { inspector: { render: () => null } },
    initial: {
      layout: {
        borders: [
          {
            type: "border",
            location: "right",
            show: false,
            selected: -1,
            children: [{ type: "tab", id: "inspector", name: "Inspector", component: "inspector" }],
          },
        ],
        layout: { type: "row", children: [] },
      },
    },
  });
  cleanup.push(() => workbench.dispose());
  await workbench.start(browser ? { browser: { window, onOutsideNavigate: () => {} } } : {});
  const internal = integrationState(workbench);
  const element = document.createElement("div");
  document.body.append(element);
  cleanup.push(() => element.remove());
  cleanup.push(internal.bindLayout(() => null, element));
  internal.bindContentRoot(workbench.getContent("inspector")!.handle, element);
  return { workbench, internal, element };
}
describe("explicit tool activation", () => {
  it("cancels a scheduled native frame when the content closes before paint", async () => {
    const { workbench, internal } = await setup();
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(123);
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const focus = vi.fn<() => void>();
    internal.registerController(workbench.getContent("inspector")!.handle, {
      controller: { leave: null, focus },
    });
    await workbench.activate("inspector");
    expect(cancel).not.toHaveBeenCalled();
    await workbench.close("inspector");
    expect(cancel).toHaveBeenCalledWith(123);
    expect(focus).not.toHaveBeenCalled();
  });
  it("reveals hidden tools and focuses them without changing the document or browser history", async () => {
    const { workbench, internal } = await setup(true);
    const opened = await workbench.open({ to: "/$id", params: { id: "A" } });
    if (opened.status !== "applied") throw new Error(opened.status);
    const location = window.location.href;
    const state = window.history.state;
    const focus = vi.fn<() => void>(() => {
      const border = workbench.model.getNodeById("border_right") as BorderNode;
      expect(border.isShowing()).toBe(true);
      expect(border.getSelectedNode()?.getId()).toBe("inspector");
    });
    internal.registerController(workbench.getContent("inspector")!.handle, {
      controller: { leave: null, focus },
    });
    expect((await workbench.activate("inspector")).status).toBe("applied");
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(workbench.getActiveDocument()?.id).toBe(opened.value.document.id);
    expect(window.location.href).toBe(location);
    expect(window.history.state).toEqual(state);
  });
  it("expands a collapsed tool group and transfers central maximization without replacing its lifetime", async () => {
    const { workbench } = await setup();
    const opened = await workbench.open({ to: "/$id", params: { id: "A" } });
    if (opened.status !== "applied") throw new Error(opened.status);
    const main = opened.value.document.containerId!;
    const handle = workbench.getContent("inspector")!.handle;
    const release = vi.fn<() => void>();
    handle.runEffect((effect) => effect.defer(release));
    expect(
      (await workbench.dispatch(Actions.moveNode("inspector", main, DockLocation.RIGHT, -1)))
        .status,
    ).toBe("applied");
    await workbench.dispatch(Actions.addTabToNewGroup("inspector", "Tools", "blue"));
    const group = workbench.model.getNodeById("inspector")!.getParent() as TabGroupNode;
    const target = group.getParent()!.getId();
    await workbench.dispatch(Actions.updateNodeAttributes(group.getId(), { opened: false }));
    await workbench.dispatch(Actions.maximizeToggle(main));
    expect((await workbench.activate("inspector")).status).toBe("applied");
    expect(group.isOpened()).toBe(true);
    expect(workbench.model.getMaximizedTabset()?.getId()).toBe(target);
    expect(workbench.getContent("inspector")!.handle).toBe(handle);
    expect(release).not.toHaveBeenCalled();
  });
  it("does not transfer an old focus request or controller registration to a reopened ID", async () => {
    const { workbench, internal, element } = await setup();
    const old = workbench.getContent("inspector")!.handle;
    const focus = vi.fn<() => void>();
    const unregister = internal.registerController(old, { controller: { leave: null, focus } });
    await workbench.activate("inspector");
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
    unregister();
    await workbench.activate("inspector");
    await workbench.close("inspector");
    focus.mockClear();
    expect((await workbench.activate("inspector")).status).toBe("denied");
    await workbench.dispatch(
      Actions.addTab(
        { id: "inspector", component: "inspector" },
        "border_right",
        DockLocation.CENTER,
        -1,
      ),
    );
    const current = workbench.getContent("inspector")!.handle;
    expect(current).not.toBe(old);
    internal.bindContentRoot(current, element);
    internal.registerController(current, { controller: { leave: null, focus } });
    expect(() => internal.registerController(old, { controller: { leave: null, focus } })).toThrow(
      "ended content",
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(focus).not.toHaveBeenCalled();
    expect(workbench.getDocuments()).toEqual([]);
  });
});
