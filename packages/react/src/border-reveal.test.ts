import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { Actions, BorderNode, DockLocation } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchInstance } from "./index";
import { integrationState } from "./integration";

const instances: WorkbenchInstance<AnyRouter>[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});
const nav = (id: string) => ({ to: "/documents/$id" as const, params: { id } });
function setup() {
  const root = createRootRoute();
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/documents/$id" }),
  ]);
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree, history }),
    layout: {
      borders: [{ type: "border", location: "left", show: true, selected: -1, children: [] }],
      layout: { type: "row", children: [{ type: "tabset", id: "main", children: [] }] },
    },
  });
  instances.push(workbench);
  const internal = integrationState(workbench);
  const border = internal.model.getNodeById("border_left") as BorderNode;
  const open = async (id: string) => {
    const result = await workbench.open(nav(id));
    if (result.status !== "committed") throw new Error(result.status);
    return result.document.id;
  };
  return { workbench, internal, border, open };
}

describe("document reveal in native Borders", () => {
  it.each([false, true])(
    "activation reveals a hidden Border before content focus (collapsed=%s)",
    async (collapsed) => {
      const { workbench, internal, border, open } = setup();
      const id = await open("A");
      await workbench.dispatch(Actions.moveNode(id, border.getId(), DockLocation.CENTER, -1));
      if (collapsed) await workbench.dispatch(Actions.selectTab(id));
      await workbench.dispatch(Actions.updateNodeAttributes(border.getId(), { show: false }));
      const focus = vi.fn<() => void>(() => {
        expect(border.isShowing()).toBe(true);
        expect(border.getSelectedNode()?.getId()).toBe(id);
      });
      internal.registerOwner(id, { focus });
      workbench.activate(id);
      await Promise.resolve();
      expect(border.isShowing()).toBe(true);
      expect(border.getSelectedNode()?.getId()).toBe(id);
      expect(focus).toHaveBeenCalledOnce();
      expect(workbench.getActiveDocument()?.id).toBe(id);
    },
  );

  it("preserved reveal shows an existing Border detail without activating it or stealing source focus", async () => {
    const { workbench, internal, border, open } = setup();
    const source = await open("source");
    const detail = await open("detail");
    await workbench.dispatch(Actions.moveNode(detail, border.getId(), DockLocation.CENTER, -1));
    await workbench.dispatch(Actions.updateNodeAttributes(border.getId(), { show: false }));
    workbench.activate(source, { focus: false });
    internal.focus(source, "document");
    const focus = vi.fn<() => void>();
    internal.registerOwner(detail, { focus });
    expect((await workbench.open(nav("detail"), { preserveFocus: true })).status).toBe("committed");
    await Promise.resolve();
    expect(border.isShowing()).toBe(true);
    expect(border.getSelectedNode()?.getId()).toBe(detail);
    expect(workbench.getActiveDocument()?.id).toBe(source);
    expect(workbench.getEditingContext().focusedTabId).toBe(source);
    expect(focus).not.toHaveBeenCalled();
  });

  it("preserved reuse also reveals its own already selected Border document", async () => {
    const { workbench, border, open } = setup();
    const id = await open("A");
    await workbench.dispatch(Actions.moveNode(id, border.getId(), DockLocation.CENTER, -1));
    await workbench.dispatch(Actions.updateNodeAttributes(border.getId(), { show: false }));
    expect((await workbench.open(nav("A"), { preserveFocus: true })).status).toBe("committed");
    expect(border.isShowing()).toBe(true);
    expect(border.getSelectedNode()?.getId()).toBe(id);
  });
});
