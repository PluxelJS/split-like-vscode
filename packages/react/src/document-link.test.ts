import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import {
  Actions,
  DockLocation,
  Model,
  DropInfo,
  Rect,
  TabSetNode,
  type Node,
  type IJsonTabNode,
  type ILayoutApi,
} from "flexlayout-react";
import type { DragEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLayoutPolicy,
  createWorkbench,
  type WorkbenchInstance,
  type WorkbenchOptions,
} from "./index";
import { beside, type OpenResult, type OpenOptions } from "./index";
import { integrationState } from "./internal";

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
async function setup(
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
  const dropHook = vi.spyOn(Model.prototype, "setOnAllowDrop");
  const workbench = createWorkbench({
    ...options,
    onIssue: vi.fn<() => void>(),
    home: { mode: "empty", href: "/" },
    createRouter: (history) => createRouter({ routeTree, history, defaultPendingMinMs: 0 }),
  });
  const allows = dropHook.mock.calls.at(-1)![0];
  dropHook.mockRestore();
  instances.push(workbench);
  expect((await workbench.start()).status).toBe("applied");
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
  const detach = internal.bindLayout(() => api, document.body);
  const allowsDrop = (drag: Node, target: Node, location: DockLocation) =>
    allows(drag, new DropInfo(target as TabSetNode, new Rect(0, 0, 800, 500), location, -1, ""));
  const open = async (id: string, placement: OpenOptions = {}) => {
    const result = await workbench.open(nav(id), placement);
    if (result.status !== "applied") throw new Error(result.status);
    return result.value.document;
  };
  const action = (target: string, location = DockLocation.CENTER) =>
    Actions.addTab(json!, target, location, -1, true);
  const drop = (target: string, location = DockLocation.CENTER) => {
    allowsDrop(dragNode(), workbench.model.getNodeById(target)!, location);
    internal.modelAction(action(target, location));
  };
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
    allowsDrop,
    getJson: () => json,
  };
}
function dragEvent() {
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Open related document");
  const handle = document.createElement("span");
  button.append(handle);
  return {
    currentTarget: button,
    defaultPrevented: false,
    preventDefault: vi.fn<DragEvent<HTMLElement>["preventDefault"]>(),
    dataTransfer: { setData: vi.fn<DataTransfer["setData"]>(), effectAllowed: "none" },
    nativeEvent: new Event("dragstart"),
  } as unknown as DragEvent<HTMLElement>;
}

describe("routed document links", () => {
  it("ends native dragging while disposal waits for content cleanup", async () => {
    const { workbench, open, endDrag } = await setup();
    const source = await open("A");
    const cleanup = deferred();
    const release = vi.fn<() => Promise<void>>(() => cleanup.promise);
    const content = source.handle;
    content.runEffect(({ defer }) => defer(release));
    const link = workbench.createLink(nav("B"));
    link.dragStart(dragEvent());

    let settled = false;
    const disposing = workbench.dispose().then((errors) => {
      settled = true;
      return errors;
    });
    try {
      expect(endDrag).toHaveBeenCalledTimes(2);
      expect(release).toHaveBeenCalledOnce();
      expect(await link.open()).toEqual({ status: "denied", reason: "not-ready" });
      expect(settled).toBe(false);
      expect(() => content.runEffect(() => {})).toThrow("Content instance has ended");
      link.dragEnd(dragEvent());
      expect(endDrag).toHaveBeenCalledTimes(2);
    } finally {
      cleanup.resolve();
      expect((await disposing).status).toBe("applied");
    }
  });

  it("captures immutable options and resolves a deferred URL only on activation", async () => {
    const { workbench, open } = await setup();
    const source = await open("A");
    const resolve = vi.fn<() => Promise<ReturnType<typeof nav>>>(async () => nav("B"));
    const onResult = vi.fn<(result: OpenResult) => void>();
    const options: OpenOptions & { onResult: (result: OpenResult) => void } = {
      onResult,
      source: source.handle,
      preview: true,
    };
    const link = workbench.createLink(resolve, options);
    options.preview = false;
    expect(link.href).toBeUndefined();
    const result = await link.open();
    expect(result.status).toBe("applied");
    expect(link.href).toBe("/documents/B");
    expect(workbench.getActiveDocument()?.preview).toBe(true);
    expect(resolve).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result);
  });

  it("cancels native overlays without resolving a deferred destination or admitting a fake tab", async () => {
    const { workbench, open, endDrag, getJson, action } = await setup();
    const source = await open("A");
    const resolve = vi.fn<() => Promise<ReturnType<typeof nav>>>(async () => nav("B"));
    const onResult = vi.fn<(result: OpenResult) => void>();
    const link = workbench.createLink(resolve, { onResult });
    link.dragStart(dragEvent());
    expect(getJson()?.name).toBe("Open related document");
    expect(resolve).not.toHaveBeenCalled();
    expect(workbench.getDocuments()).toHaveLength(1);
    link.dragEnd(dragEvent());
    link.dragEnd(dragEvent());
    expect(endDrag).toHaveBeenCalledOnce();
    expect((await workbench.dispatch(action(source.containerId!))).status).toBe("denied");
    expect(resolve).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("admits a native drop only through the route loader with explicit reveal/preview options retained", async () => {
    const gate = deferred();
    const { workbench, internal, open, action, drop, getJson } = await setup({}, (id) =>
      id === "B" ? gate.promise : undefined,
    );
    const source = await open("A");
    const onResult = vi.fn<(result: OpenResult) => void>();
    const link = workbench.createLink(nav("B"), {
      source: source.handle,
      preview: true,
      presentation: "reveal",
      onResult,
    });
    expect(link.href).toBe("/documents/B");
    link.dragStart(dragEvent());
    expect((await workbench.dispatch(action(source.containerId!))).status).toBe("denied");
    drop(source.containerId!, DockLocation.RIGHT);
    expect(internal.model.getNodeById(getJson()!.id!)).toBeUndefined();
    expect(workbench.getDocuments()).toHaveLength(1);
    gate.resolve();
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    const result = onResult.mock.calls[0]![0];
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error(result.status);
    expect(result.value.document.preview).toBe(true);
    expect(result.value.document.containerId).not.toBe(source.containerId!);
    expect(workbench.getActiveDocument()?.id).toBe(source.id);
  });

  it("checks actual native add topology and rejects root edges and foreign containers", async () => {
    const { workbench, internal, open, dragNode, drop, allowsDrop } = await setup({
      layoutPolicy: createLayoutPolicy({ maxRows: 1, maxColumns: 1 }),
    });
    const source = await open("A");
    const onResult = vi.fn<(result: OpenResult) => void>();
    const link = workbench.createLink(nav("B"), { onResult });
    link.dragStart(dragEvent());
    const drag = dragNode();
    const target = internal.model.getNodeById(source.containerId!)!;
    expect(allowsDrop(drag, target, DockLocation.CENTER)).toBe(true);
    expect(allowsDrop(drag, target, DockLocation.RIGHT)).toBe(false);
    expect(allowsDrop(drag, internal.model.getRootRow()!, DockLocation.RIGHT)).toBe(false);
    expect(allowsDrop(drag, drag.getParent()!, DockLocation.CENTER)).toBe(false);
    drop(source.containerId!, DockLocation.RIGHT);
    expect(onResult).toHaveBeenCalledExactlyOnceWith({
      status: "denied",
      reason: "layout-policy",
    });
    expect(workbench.getDocuments()).toHaveLength(1);
  });

  it("keeps a reused preview in its original container and returns the ordinary document", async () => {
    const { workbench, open, drop } = await setup();
    const source = await open("A");
    const preview = await open("B", {
      preview: true,
      destination: beside({ direction: DockLocation.RIGHT }),
    });
    await workbench.activate(source.id);
    const onResult = vi.fn<(result: OpenResult) => void>();
    const link = workbench.createLink(nav("B"), {
      source: source.handle,
      destination: beside({ direction: DockLocation.RIGHT }),
      preview: true,
      onResult,
    });
    link.dragStart(dragEvent());
    drop(source.containerId!, DockLocation.BOTTOM);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledOnce());
    const result = onResult.mock.calls[0]![0];
    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error(result.status);
    expect(result.value.document).toMatchObject({
      id: preview.id,
      containerId: preview.containerId,
      preview: true,
    });
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it.each(["source-close", "source-move", "target-close", "unmount"] as const)(
    "invalidates a deferred drop after %s before resolving its route",
    async (change) => {
      const gate = deferred();
      const { workbench, open, drop, detach } = await setup();
      const source = await open("A");
      const target = await open("B", { destination: beside({ direction: DockLocation.RIGHT }) });
      await workbench.activate(source.id);
      const onResult = vi.fn<(result: OpenResult) => void>();
      const resolve = vi.fn<() => Promise<ReturnType<typeof nav>>>(async () => {
        await gate.promise;
        return nav("C");
      });
      const link = workbench.createLink(resolve, { source: source.handle, onResult });
      link.dragStart(dragEvent());
      drop(target.containerId!);
      expect(resolve).toHaveBeenCalledOnce();
      if (change === "source-close") await workbench.close(source.id);
      else if (change === "source-move")
        await workbench.dispatch(
          Actions.moveNode(source.id, target.containerId!, DockLocation.CENTER, -1),
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
      const { workbench, open, drop } = await setup({}, loading);
      const source = await open("A");
      const target = await open("B", { destination: beside({ direction: DockLocation.RIGHT }) });
      const onResult = vi.fn<(result: OpenResult) => void>();
      const link = workbench.createLink(nav("C"), { source: source.handle, onResult });
      link.dragStart(dragEvent());
      drop(target.containerId!);
      await vi.waitFor(() => expect(loading).toHaveBeenCalledWith("C"));
      if (change === "close") await workbench.close(source.id);
      else
        await workbench.dispatch(
          Actions.moveNode(source.id, target.containerId!, DockLocation.CENTER, -1),
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
    const { workbench, open, detach, endDrag } = await setup();
    await open("A");
    const error = new Error("lookup failed");
    const onResult = vi.fn<(result: OpenResult) => void>();
    const link = workbench.createLink(
      async () => {
        throw error;
      },
      { onResult },
    );
    const result = await link.open();
    expect(result).toMatchObject({ status: "failed", phase: "prepare", changes: "none", error });
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result);
    link.dragStart(dragEvent());
    detach();
    expect(endDrag).toHaveBeenCalledOnce();
    link.dragEnd(dragEvent());
    expect(endDrag).toHaveBeenCalledOnce();
  });
});
