import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { Actions, DockLocation, DropInfo, Model, Rect, TabSetNode } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLayoutPolicy,
  createWorkbench,
  getLayoutTopology,
  type WorkbenchSnapshot,
} from "./index";
import { integrationState } from "./integration";

const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
  vi.restoreAllMocks();
});

function setup(maxTabsets = 4, snapshot?: WorkbenchSnapshot) {
  const root = createRootRoute();
  const document = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    staticData: { worksplit: { title: "Document" } },
  });
  const routeTree = root.addChildren([document]);
  const workbench = createWorkbench({
    createRouter: (history: RouterHistory) => createRouter({ routeTree, history }),
    layoutPolicy: createLayoutPolicy({ maxRows: 2, maxColumns: 2, maxTabsets }),
    ...(snapshot ? { snapshot } : {}),
  });
  disposals.push(() => workbench.dispose());
  const open = async (id: string) => {
    const result = await workbench.open({ to: "/documents/$id", params: { id } });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error(result.status);
    return result.document.id;
  };
  return { workbench, open, model: integrationState(workbench).model };
}

describe("Workbench layout policy integration", () => {
  it("uses the same policy for native previews, menu eligibility and dispatch", async () => {
    const installDrop = vi.spyOn(Model.prototype, "setOnAllowDrop");
    const { workbench, open, model } = setup(2);
    const nativeDrop = installDrop.mock.calls[0]![0];
    const a = await open("A");
    const b = await open("B");
    const c = await open("C");
    const original = model.getNodeById(a)!.getParent()!;
    const split = Actions.moveNode(b, original.getId(), DockLocation.RIGHT, -1);
    expect(workbench.canDispatch(split)).toBe(true);
    expect(await workbench.dispatch(split)).toEqual({ status: "applied" });
    const target = model.getNodeById(b)!.getParent()!;
    if (!(target instanceof TabSetNode)) throw new Error("Expected native TabSet");
    const save = vi.fn<() => void>();
    const changed = vi.fn<() => void>();
    model.getNodeById(a)!.setEventListener("save", save);
    model.addChangeListener(changed);
    const denied = Actions.moveNode(c, target.getId(), DockLocation.BOTTOM, -1);
    expect(
      nativeDrop(
        model.getNodeById(c)!,
        new DropInfo(target, new Rect(0, 0, 1, 1), DockLocation.BOTTOM, -1, ""),
      ),
    ).toBe(false);
    expect(workbench.canDispatch(denied)).toBe(false);
    expect(await workbench.dispatch(denied)).toEqual({ status: "rejected" });
    expect(save).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    const reorder = Actions.moveNode(c, original.getId(), DockLocation.CENTER, 0);
    if (!(original instanceof TabSetNode)) throw new Error("Expected original TabSet");
    expect(
      nativeDrop(
        model.getNodeById(c)!,
        new DropInfo(original, new Rect(0, 0, 1, 1), DockLocation.CENTER, 0, ""),
      ),
    ).toBe(true);
    expect(workbench.canDispatch(reorder)).toBe(true);
    expect(await workbench.dispatch(reorder)).toEqual({ status: "applied" });
    expect(getLayoutTopology(model)).toEqual({ rows: 1, columns: 2, tabsets: 2 });
  });

  it("admits another document at the group limit and restores only conforming snapshots", async () => {
    const { workbench, open, model } = setup(2);
    const a = await open("A");
    const b = await open("B");
    expect(
      await workbench.dispatch(
        Actions.moveNode(b, model.getNodeById(a)!.getParent()!.getId(), DockLocation.RIGHT, -1),
      ),
    ).toEqual({ status: "applied" });
    await open("C");
    expect(workbench.getDocuments()).toHaveLength(3);
    expect(getLayoutTopology(model).tabsets).toBe(2);
    const snapshot = workbench.snapshot();
    const restored = setup(2, snapshot);
    expect(restored.workbench.getDocuments()).toHaveLength(3);
    expect(getLayoutTopology(restored.model).tabsets).toBe(2);
    expect(() => setup(1, snapshot)).toThrow("Snapshot violates layout policy");
  });

  it("allows moving the final member at the limit after native empty-group cleanup", async () => {
    const { workbench, open, model } = setup(2);
    const a = await open("A");
    const b = await open("B");
    const target = model.getNodeById(a)!.getParent()!.getId();
    await workbench.dispatch(Actions.moveNode(b, target, DockLocation.RIGHT, -1));
    const moveLast = Actions.moveNode(b, target, DockLocation.BOTTOM, -1);
    expect(workbench.canDispatch(moveLast)).toBe(true);
    expect(await workbench.dispatch(moveLast)).toEqual({ status: "applied" });
    expect(getLayoutTopology(model)).toEqual({ rows: 2, columns: 1, tabsets: 2 });
  });
});
