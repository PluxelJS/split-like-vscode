/* eslint-disable no-await-in-loop -- Native scenarios and resource teardown deliberately run in order. */
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Actions, BorderNode, DockLocation } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench } from "./index";
import { integrationState } from "./internal";
const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0).toReversed()) await stop();
});
const nav = (id: string) => ({ to: "/documents/$id" as const, params: { id } });
async function setup() {
  const root = createRootRoute();
  const tree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/documents/$id" }),
  ]);
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: tree, history }),
    initial: {
      layout: {
        borders: [{ type: "border", location: "left", show: true, selected: -1, children: [] }],
        layout: { type: "row", children: [] },
      },
    },
  });
  cleanup.push(() => workbench.dispose());
  await workbench.start();
  const internal = integrationState(workbench);
  const element = document.createElement("div");
  document.body.append(element);
  cleanup.push(() => element.remove());
  cleanup.push(internal.bindLayout(() => null, element));
  const border = workbench.model.getNodeById("border_left") as BorderNode;
  const open = async (id: string) => {
    const result = await workbench.open(nav(id));
    if (result.status !== "applied") throw new Error(result.status);
    return result.value.document.id;
  };
  return { workbench, internal, element, border, open };
}
describe("document reveal in native Borders", () => {
  it.each([false, true])(
    "reveals a hidden Border before content focus (collapsed=%s)",
    async (collapsed) => {
      const { workbench, internal, border, open, element } = await setup();
      const id = await open("A");
      await workbench.dispatch(Actions.moveNode(id, border.getId(), DockLocation.CENTER, -1));
      if (collapsed) await workbench.dispatch(Actions.selectTab(id));
      await workbench.dispatch(Actions.updateNodeAttributes(border.getId(), { show: false }));
      const focus = vi.fn<() => void>(() => {
        expect(border.isShowing()).toBe(true);
        expect(border.getSelectedNode()?.getId()).toBe(id);
      });
      const handle = workbench.getContent(id)!.handle;
      internal.bindContentRoot(handle, element);
      internal.registerController(handle, { controller: { leave: null, focus } });
      await workbench.activate(id);
      await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
      expect(workbench.getActiveDocument()?.id).toBe(id);
    },
  );
  it("reveals a separate Border detail while preserving source activity and focus", async () => {
    const { workbench, internal, border, open } = await setup();
    const source = await open("source");
    const detail = await open("detail");
    await workbench.dispatch(Actions.moveNode(detail, border.getId(), DockLocation.CENTER, -1));
    await workbench.dispatch(Actions.updateNodeAttributes(border.getId(), { show: false }));
    await workbench.activate(source);
    internal.focus(source, "content");
    const focus = vi.fn<() => void>();
    internal.registerController(workbench.getContent(detail)!.handle, {
      controller: { leave: null, focus },
    });
    expect(
      (
        await workbench.open(nav("detail"), {
          presentation: "reveal",
          source: workbench.getContent(source)!.handle,
        })
      ).status,
    ).toBe("applied");
    expect(border.isShowing()).toBe(true);
    expect(border.getSelectedNode()?.getId()).toBe(detail);
    expect(workbench.getActiveDocument()?.id).toBe(source);
    expect(workbench.getContext().focusedContentId).toBe(source);
    expect(focus).not.toHaveBeenCalled();
  });
  it("rejects reveal when there is no independent source to preserve", async () => {
    const { workbench, border, open } = await setup();
    const id = await open("A");
    await workbench.dispatch(Actions.moveNode(id, border.getId(), DockLocation.CENTER, -1));
    await workbench.dispatch(Actions.updateNodeAttributes(border.getId(), { show: false }));
    expect(await workbench.open(nav("A"), { presentation: "reveal" })).toMatchObject({
      status: "denied",
      reason: "focus-conflict",
    });
    expect(border.isShowing()).toBe(false);
  });
});
