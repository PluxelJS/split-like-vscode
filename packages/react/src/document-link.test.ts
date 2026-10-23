import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { Actions, DockLocation, Model, type IJsonTabNode, type ILayoutApi } from "flexlayout-react";
import type { DragEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLayoutPolicy,
  createWorkbench,
  type WorkbenchInstance,
  type WorkbenchOptions,
} from "./index";
import { integrationState, type NavigationResult, type OpenDocumentOptions } from "./integration";

const instances: WorkbenchInstance<AnyRouter>[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((workbench) => workbench.dispose()));
  window.history.replaceState(null, "", "/");
});
const nav = (id: string) => ({ to: "/documents/$id" as const, params: { id } });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(
  options: Pick<WorkbenchOptions<AnyRouter>, "layoutPolicy"> = {},
  loader: (id: string) => void | Promise<void> = () => {},
) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    loader: ({ params }) => loader(params.id),
  });
  const routeTree = root.addChildren([route]);
  const workbench = createWorkbench({
    ...options,
    createRouter: (history) => createRouter({ routeTree, history, defaultPendingMinMs: 0 }),
  });
  instances.push(workbench);
  const internal = integrationState(workbench);
  let json: IJsonTabNode | undefined;
  const endDrag = vi.fn<ILayoutApi["endDrag"]>();
  const api = {
    setDragComponent: vi.fn<ILayoutApi["setDragComponent"]>(),
    addTabWithDragAndDrop: vi.fn<ILayoutApi["addTabWithDragAndDrop"]>((_event, tab) => {
      json = tab;
    }),
    endDrag,
  } as unknown as ILayoutApi;
  const detach = internal.documentLinks.attach(() => api);
  const open = async (id: string, placement: OpenDocumentOptions = {}) => {
    const result = await workbench.open(nav(id), placement);
    if (result.status !== "committed") throw new Error(result.status);
    return result.document;
  };
  const action = (target: string, location = DockLocation.CENTER) =>
    Actions.addTab(json!, target, location, -1, true);
  const drop = (target: string, location = DockLocation.CENTER) =>
    internal.modelAction(action(target, location));
  const dragNode = () =>
    Model.fromJson({
      layout: {
        type: "row",
        children: [{ type: "tabset", children: [{ ...json!, type: "tab" }] }],
      },
    }).getNodeById(json!.id!)!;
  return {
    workbench,
    internal,
    open,
    api,
    detach,
    endDrag,
    action,
    drop,
    dragNode,
    getJson: () => json,
  };
}
function dragEvent() {
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Open related document");
  const handle = document.createElement("span");
  button.append(handle);
  return {
    currentTarget: handle,
    defaultPrevented: false,
    preventDefault: vi.fn<DragEvent<HTMLElement>["preventDefault"]>(),
    dataTransfer: { setData: vi.fn<DataTransfer["setData"]>(), effectAllowed: "none" },
    nativeEvent: new Event("dragstart"),
  } as unknown as DragEvent<HTMLElement>;
}

describe("routed document links", () => {
  it("captures immutable options and resolves a deferred URL only on activation", async () => {
    const { workbench, open } = setup();
    const source = await open("A");
    const resolve = vi.fn<() => Promise<ReturnType<typeof nav>>>(async () => nav("B"));
    const onResult = vi.fn<(result: NavigationResult) => void>();
    const options: OpenDocumentOptions = {
      placement: { mode: "tab", source: source.id },
      preview: true,
    };
    const link = workbench.createLink(resolve, options, onResult);
    options.preview = false;
    expect(link.href).toBeUndefined();
    expect(Object.isFrozen(link.options)).toBe(true);
    expect(Object.isFrozen(link.options.placement)).toBe(true);
    const result = await link.open();
    expect(result.status).toBe("committed");
    expect(link.href).toBe("/documents/B");
    expect(workbench.getActiveDocument()?.preview).toBe(true);
    expect(resolve).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result);
  });

  it("cancels native overlays without resolving a deferred destination or admitting a fake tab", async () => {
    const { workbench, open, endDrag, getJson, action } = setup();
    const source = await open("A");
    const resolve = vi.fn<() => Promise<ReturnType<typeof nav>>>(async () => nav("B"));
    const onResult = vi.fn<(result: NavigationResult) => void>();
    const link = workbench.createLink(resolve, {}, onResult);
    link.dragStart(dragEvent());
    expect(getJson()?.name).toBe("Open related document");
    expect(resolve).not.toHaveBeenCalled();
    expect(workbench.getDocuments()).toHaveLength(1);
    link.dragEnd();
    link.dragEnd();
    expect(endDrag).toHaveBeenCalledOnce();
    expect((await workbench.dispatch(action(source.containerId))).status).toBe("rejected");
    expect(resolve).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("admits a native drop only through the route loader as an ordinary foreground document", async () => {
    const gate = deferred();
    const { workbench, internal, open, action, drop, getJson } = setup({}, (id) =>
      id === "B" ? gate.promise : undefined,
    );
    const source = await open("A");
    const onResult = vi.fn<(result: NavigationResult) => void>();
    const link = workbench.createLink(
      nav("B"),
      {
        placement: { mode: "tab", source: source.id },
        preview: true,
        preserveFocus: true,
      },
      onResult,
    );
    expect(link.href).toBe("/documents/B");
    link.dragStart(dragEvent());
    expect((await workbench.dispatch(action(source.containerId))).status).toBe("rejected");
    drop(source.containerId, DockLocation.RIGHT);
    expect(internal.model.getNodeById(getJson()!.id!)).toBeUndefined();
    expect(workbench.getDocuments()).toHaveLength(1);
    gate.resolve();
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    const result = onResult.mock.calls[0]![0];
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error(result.status);
    expect(result.document.preview).toBe(false);
    expect(result.document.containerId).not.toBe(source.containerId);
    expect(workbench.getActiveDocument()?.id).toBe(result.document.id);
  });

  it("checks actual native add topology and rejects root edges and foreign containers", async () => {
    const { workbench, internal, open, dragNode, drop } = setup({
      layoutPolicy: createLayoutPolicy({ maxRows: 1, maxColumns: 1 }),
    });
    const source = await open("A");
    const onResult = vi.fn<(result: NavigationResult) => void>();
    const link = workbench.createLink(nav("B"), {}, onResult);
    link.dragStart(dragEvent());
    const drag = dragNode();
    const target = internal.model.getNodeById(source.containerId)!;
    expect(internal.documentLinks.allowsDrop(drag, target, DockLocation.CENTER)).toBe(true);
    expect(internal.documentLinks.allowsDrop(drag, target, DockLocation.RIGHT)).toBe(false);
    expect(
      internal.documentLinks.allowsDrop(drag, internal.model.getRootRow()!, DockLocation.RIGHT),
    ).toBe(false);
    expect(internal.documentLinks.allowsDrop(drag, drag.getParent()!, DockLocation.CENTER)).toBe(
      false,
    );
    drop(source.containerId, DockLocation.RIGHT);
    expect(onResult).toHaveBeenCalledExactlyOnceWith({
      status: "rejected",
      reason: "layout-policy",
    });
    expect(workbench.getDocuments()).toHaveLength(1);
  });

  it("keeps a reused preview in its original container and returns the ordinary document", async () => {
    const { workbench, open, drop } = setup();
    const source = await open("A");
    const preview = await open("B", { preview: true, location: DockLocation.RIGHT });
    workbench.activate(source.id);
    const onResult = vi.fn<(result: NavigationResult) => void>();
    const link = workbench.createLink(
      nav("B"),
      { placement: { mode: "split", source: source.id }, preview: true },
      onResult,
    );
    link.dragStart(dragEvent());
    drop(source.containerId, DockLocation.BOTTOM);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    const result = onResult.mock.calls[0]![0];
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error(result.status);
    expect(result.document).toMatchObject({
      id: preview.id,
      containerId: preview.containerId,
      preview: false,
    });
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it.each(["source-close", "source-move", "target-close", "unmount"] as const)(
    "invalidates a deferred drop after %s before resolving its route",
    async (change) => {
      const gate = deferred();
      const { workbench, open, drop, detach } = setup();
      const source = await open("A");
      const target = await open("B", { location: DockLocation.RIGHT });
      workbench.activate(source.id);
      const onResult = vi.fn<(result: NavigationResult) => void>();
      const resolve = vi.fn<() => Promise<ReturnType<typeof nav>>>(async () => {
        await gate.promise;
        return nav("C");
      });
      const link = workbench.createLink(
        resolve,
        { placement: { mode: "tab", source: source.id } },
        onResult,
      );
      link.dragStart(dragEvent());
      drop(target.containerId);
      expect(resolve).toHaveBeenCalledOnce();
      if (change === "source-close") await workbench.close(source.id);
      else if (change === "source-move")
        await workbench.dispatch(
          Actions.moveNode(source.id, target.containerId, DockLocation.CENTER, -1),
        );
      else if (change === "target-close") await workbench.close(target.id);
      else detach();
      gate.resolve();
      await vi.waitFor(() =>
        expect(onResult).toHaveBeenCalledExactlyOnceWith({ status: "superseded" }),
      );
      expect(workbench.getDocuments().some((document) => document.href === "/documents/C")).toBe(
        false,
      );
    },
  );

  it.each(["close", "move"] as const)(
    "invalidates a direct drop while its loader waits after source %s",
    async (change) => {
      const gate = deferred();
      const loading = vi.fn<(id: string) => void | Promise<void>>((id) =>
        id === "C" ? gate.promise : undefined,
      );
      const { workbench, open, drop } = setup({}, loading);
      const source = await open("A");
      const target = await open("B", { location: DockLocation.RIGHT });
      const onResult = vi.fn<(result: NavigationResult) => void>();
      const link = workbench.createLink(
        nav("C"),
        { placement: { mode: "tab", source: source.id } },
        onResult,
      );
      link.dragStart(dragEvent());
      drop(target.containerId);
      await vi.waitFor(() => expect(loading).toHaveBeenCalledWith("C"));
      if (change === "close") await workbench.close(source.id);
      else
        await workbench.dispatch(
          Actions.moveNode(source.id, target.containerId, DockLocation.CENTER, -1),
        );
      gate.resolve();
      await vi.waitFor(() =>
        expect(onResult).toHaveBeenCalledExactlyOnceWith({ status: "superseded" }),
      );
      expect(workbench.getDocuments().some((document) => document.href === "/documents/C")).toBe(
        false,
      );
    },
  );

  it("reports a failed resolver once and cleans active native drag on unmount", async () => {
    const { workbench, open, detach, endDrag } = setup();
    await open("A");
    const error = new Error("lookup failed");
    const onResult = vi.fn<(result: NavigationResult) => void>();
    const link = workbench.createLink(
      async () => {
        throw error;
      },
      {},
      onResult,
    );
    const result = await link.open();
    expect(result).toEqual({ status: "failed", stage: "load", error });
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result);
    link.dragStart(dragEvent());
    detach();
    expect(endDrag).toHaveBeenCalledOnce();
    link.dragEnd();
    expect(endDrag).toHaveBeenCalledOnce();
  });
});
