import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Actions, DockLocation, Model } from "flexlayout-react";
import { createElement, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkbench,
  useWorkbenchContent,
  Workbench,
  type WorkbenchContentLifecycle,
  type WorkbenchOptions,
} from "./index";
import { integrationState } from "./integration";

const disposals: (() => Promise<unknown>)[] = [];
const pendingGates: (() => void)[] = [];
const centralDocuments: NonNullable<WorkbenchOptions<AnyRouter>["allowDrop"]> = (tabs, target) =>
  tabs.every((tab) => tab.getComponent() !== "worksplit.document" || target.getType() !== "border");
afterEach(async () => {
  pendingGates.splice(0).forEach((finish) => finish());
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  pendingGates.push(() => resolve(fallback));
  return { promise, resolve };
}
function setup(
  options: Pick<WorkbenchOptions<AnyRouter>, "layout" | "allowDrop"> = {},
  load: (id: string) => string | Promise<string> = (id) => id,
) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === "string" ? search.view : "edit",
    }),
    loader: ({ params }) => load(params.id),
    staticData: { worksplit: { title: "Document", navigationKey: "documents" } },
  });
  const alias = createRoute({
    getParentRoute: () => root,
    path: "/alias",
    beforeLoad: () => {
      throw redirect({ to: "/documents/$id", params: { id: "B" }, search: { view: "edit" } });
    },
  });
  const tree = root.addChildren([page, alias]);
  const issues = vi.fn<(issue: unknown) => void>();
  const makeRouter = (history: RouterHistory) =>
    createRouter({ routeTree: tree, history, defaultPendingMinMs: 0, defaultStaleTime: Infinity });
  const workbench = createWorkbench({ createRouter: makeRouter, onIssue: issues, ...options });
  disposals.push(() => workbench.dispose());
  const open = (id: string) =>
    workbench.open({ to: "/documents/$id", params: { id }, search: { view: "edit" } });
  return { workbench, open, issues, makeRouter };
}

describe("real Router session coordination", () => {
  it("deduplicates a final redirect without touching dirty source content", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    expect(a.status).toBe("committed");
    expect(b.status).toBe("committed");
    if (a.status !== "committed" || b.status !== "committed") return;
    const decision = vi.fn<() => boolean>(() => false);
    integrationState(workbench).registerOwner(a.document.id, {
      isDirty: () => true,
      beforeLeave: decision,
    });
    workbench.activate(a.document.id);
    const result = await workbench.open({ to: "/alias" });
    expect(result).toMatchObject({
      status: "committed",
      reused: true,
      document: { id: b.document.id },
    });
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(workbench.getDocument(a.document.id)?.href).toContain("/documents/A");
    expect(decision).not.toHaveBeenCalled();
  });

  it("honors a target document decision when requested search differs", async () => {
    const { workbench, open } = setup();
    const result = await open("A");
    if (result.status !== "committed") throw new Error("Fixture open failed");
    integrationState(workbench).registerOwner(result.document.id, {
      isDirty: () => true,
      beforeLeave: () => false,
    });
    const next = await workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "preview" },
    });
    expect(next).toEqual({ status: "rejected", reason: "decision" });
    expect(workbench.getDocument(result.document.id)?.href).toContain("view=edit");
  });

  it("settles concurrent opens, keeps explicit instances and uses active/MRU preference", async () => {
    const { workbench, open } = setup();
    const results = await Promise.all([open("A"), open("A")]);
    expect(results.map((r) => r.status)).toContain("committed");
    expect(workbench.getDocuments()).toHaveLength(1);
    const extra = await workbench.open(
      { to: "/documents/$id", params: { id: "A" }, search: { view: "preview" } },
      { newInstance: true },
    );
    expect(extra.status).toBe("committed");
    const reused = await open("A");
    if (extra.status !== "committed" || reused.status !== "committed")
      throw new Error("Expected commits");
    expect(reused.document.id).toBe(extra.document.id);
  });

  it("reuses pending close, validates route identity, and reports post-removal cleanup failure", async () => {
    const { workbench, open } = setup();
    const result = await open("A");
    if (result.status !== "committed") throw new Error("Fixture open failed");
    let approve!: (value: boolean) => void;
    const decision = vi.fn<() => Promise<boolean>>(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve;
        }),
    );
    integrationState(workbench).registerOwner(result.document.id, {
      isDirty: () => true,
      beforeLeave: decision,
    });
    integrationState(workbench)
      .content(result.document.id)
      .effect(({ defer }) => {
        defer(() => {
          throw new Error("cleanup failed");
        });
      });
    integrationState(workbench).focus(result.document.id, "document");
    const first = workbench.close(result.document.id);
    const second = workbench.close(result.document.id);
    expect(decision).toHaveBeenCalledTimes(1);
    approve(true);
    expect(await first).toMatchObject({ status: "closed", cleanupErrors: [expect.any(Error)] });
    expect(await second).toEqual(await first);
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(workbench.getEditingContext().activeTabId).toBeNull();
    expect(workbench.getEditingContext().focusedTabId).toBeNull();
  });

  it("protects identities and native closeability while passing layout actions", async () => {
    const { workbench, open } = setup();
    const result = await open("A");
    if (result.status !== "committed") throw new Error("Fixture open failed");
    expect(
      await workbench.dispatch(
        Actions.updateNodeAttributes(result.document.id, { component: "other" }),
      ),
    ).toEqual({ status: "rejected" });
    expect(await workbench.dispatch(Actions.setTabPinned(result.document.id, true))).toEqual({
      status: "applied",
    });
    expect(await workbench.close(result.document.id)).toEqual({
      status: "rejected",
      reason: "not-closeable",
    });
    await workbench.dispatch(Actions.setTabPinned(result.document.id, false));
    expect(
      await workbench.dispatch(
        Actions.moveNode(
          result.document.id,
          workbench.getEditingContext().activeGroupId!,
          DockLocation.RIGHT,
          -1,
        ),
      ),
    ).toEqual({ status: "applied" });
    expect(workbench.getDocument(result.document.id)?.href).toContain("/documents/A");
    const parent = integrationState(workbench).model.getNodeById(result.document.id)!.getParent()!;
    expect(await workbench.dispatch(Actions.deleteTabset(parent.getId()))).toMatchObject({
      status: "closed",
    });
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(integrationState(workbench).model.getFirstTabSet()).toBeDefined();
  });

  it("restores lazy background tabs and rejects incompatible content or format", async () => {
    const { workbench, open, makeRouter } = setup();
    await open("A");
    await open("B");
    const snapshot = workbench.snapshot();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    const restored = createWorkbench({ createRouter: factory, snapshot });
    disposals.push(() => restored.dispose());
    expect(factory).toHaveBeenCalledTimes(1); // inert typed URL builder; no loader
    expect(restored.getDocuments()).toHaveLength(2);
    await restored.start("/documents/A?view=edit");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(() =>
      createWorkbench({ createRouter: makeRouter, snapshot: { ...snapshot, version: 2 } }),
    ).toThrow("Incompatible");
    expect(() =>
      createWorkbench({
        createRouter: makeRouter,
        snapshot: {
          ...snapshot,
          layout: {
            global: { tabSetEnableClose: false },
            layout: {
              type: "row",
              children: [
                { type: "tabset", children: [{ type: "tab", id: "unknown", component: "lost" }] },
              ],
            },
          },
        },
      }),
    ).toThrow("Unknown");
  });

  it.each([
    { global: {}, layout: {} },
    { global: {}, layout: { type: "row" } },
    { global: {}, layout: { children: [] } },
    { layout: { type: "row", children: [{ type: "tabset" }] } },
    {
      layout: {
        type: "row",
        children: [{ type: "tabset", children: [{ component: "worksplit.tool", id: "tool" }] }],
      },
    },
  ])("rejects incomplete serialized layouts without rewriting the candidate: %j", (layout) => {
    const { makeRouter } = setup();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    const candidate = { version: 1, workspaceId: "default", layout };
    const before = structuredClone(candidate);
    expect(() => createWorkbench({ createRouter: factory, snapshot: candidate })).toThrow(
      /snapshot.*(type|children)/iu,
    );
    expect(factory).not.toHaveBeenCalled();
    expect(candidate).toEqual(before);
  });

  it("keeps the native navigation pipeline and explicitly reports committed identity conflicts", async () => {
    const { workbench, open, issues } = setup();
    const a = await open("A");
    await open("B");
    if (a.status !== "committed") throw new Error("Fixture open failed");
    const router = integrationState(workbench).documents.get(a.document.id)!.router!;
    await router.navigate({ href: "/alias" });
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(workbench.getDocument(a.document.id)?.href).toContain("/documents/B");
    expect(issues).toHaveBeenCalledWith(
      expect.objectContaining({ code: "native-identity-conflict", id: a.document.id }),
    );
  });

  it("uses the same pure native policy for admission, group moves and snapshot validation", async () => {
    const { workbench, open, makeRouter } = setup({
      allowDrop: centralDocuments,
      layout: {
        global: {
          tabEnableFloat: false,
          tabEnablePopout: false,
          tabSetEnableClose: false,
          tabSetEnableDeleteWhenEmpty: false,
        },
        borders: [{ type: "border", location: "bottom", children: [] }],
        layout: { type: "row", children: [{ type: "tabset", id: "main", children: [] }] },
      },
    });
    const a = await open("A");
    if (a.status !== "committed") throw new Error("Fixture open failed");
    const before = workbench.getLayout();
    expect(
      await workbench.dispatch(
        Actions.moveNode(a.document.id, "border_bottom", DockLocation.CENTER, -1),
      ),
    ).toEqual({ status: "rejected" });
    expect(
      await workbench.dispatch(Actions.moveNode("main", "border_bottom", DockLocation.CENTER, -1)),
    ).toEqual({ status: "rejected" });
    expect(workbench.getLayout()).toEqual(before);
    const b = await workbench.open(
      { to: "/documents/$id", params: { id: "B" }, search: { view: "edit" } },
      { target: "border_bottom" },
    );
    expect(b).toMatchObject({ status: "failed", stage: "load" });
    expect(workbench.getDocuments()).toHaveLength(1);
    const snapshot = workbench.snapshot();
    const invalid = Model.fromJson(snapshot.layout);
    invalid.doAction(Actions.moveNode(a.document.id, "border_bottom", DockLocation.CENTER, -1));
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    expect(() =>
      createWorkbench({
        createRouter: factory,
        snapshot: { ...snapshot, layout: invalid.toJson() },
        allowDrop: centralDocuments,
      }),
    ).toThrow("policy");
    expect(factory).not.toHaveBeenCalled();
  });

  it("awaits stopped effect cleanup exactly once through close and idempotent shutdown", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    if (a.status !== "committed") throw new Error("Fixture open failed");
    let finish!: () => void;
    const disposeResource = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = integrationState(workbench)
      .content(a.document.id)
      .effect(({ defer }) => {
        defer(disposeResource);
      });
    stop();
    stop();
    const closing = workbench.close(a.document.id);
    await Promise.resolve();
    expect(disposeResource).toHaveBeenCalledTimes(1);
    finish();
    expect(await closing).toEqual({ status: "closed", id: a.document.id, cleanupErrors: [] });
    const disposed = workbench.dispose();
    expect(workbench.dispose()).toBe(disposed);
    expect(await disposed).toEqual([]);
    expect(disposeResource).toHaveBeenCalledTimes(1);
  });
});

describe("owned Router teardown failures", () => {
  it("caches shutdown before reentrant cleanup, collects a resolver failure and settles registered async resources", async () => {
    const { makeRouter } = setup();
    const routers: ReturnType<typeof makeRouter>[] = [];
    const resolverError = new Error("Resolver history teardown failed");
    const factory = (history: RouterHistory) => {
      const router = makeRouter(history);
      const destroy = vi.spyOn(router.history, "destroy");
      if (routers.length === 0)
        destroy.mockImplementationOnce(() => {
          throw resolverError;
        });
      routers.push(router);
      return router;
    };
    const resource = deferred<void>(undefined);
    let reentered: Promise<readonly unknown[]> | undefined;
    const disposeResource = vi.fn<() => Promise<void>>(() => {
      reentered = workbench.dispose();
      return resource.promise;
    });
    const isDirty = vi.fn<NonNullable<WorkbenchContentLifecycle["isDirty"]>>(() => true);
    const beforeLeave = vi.fn<NonNullable<WorkbenchContentLifecycle["beforeLeave"]>>(() => false);
    const save = vi.fn<NonNullable<WorkbenchContentLifecycle["save"]>>();
    const lifecycle = { isDirty, beforeLeave, save };
    function ResourceTool() {
      const content = useWorkbenchContent(lifecycle);
      useEffect(() => content.effect(({ defer }) => defer(disposeResource)), [content]);
      return createElement("span", null, "Registered async resource");
    }
    const workbench = createWorkbench({
      createRouter: factory,
      tools: [{ id: "resource", render: () => createElement(ResourceTool) }],
      layout: {
        borders: [
          {
            location: "bottom",
            selected: 0,
            children: [{ id: "resource", component: "worksplit.tool" }],
          },
        ],
        layout: {},
      },
    });
    disposals.push(() => workbench.dispose());
    const opened = await workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "edit" },
    });
    expect(opened.status).toBe("committed");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, 800, 600),
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.stubGlobal("scrollTo", vi.fn<typeof window.scrollTo>());
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        observe = vi.fn<(target: Element) => void>();
        unobserve = vi.fn<(target: Element) => void>();
        disconnect = vi.fn<() => void>();
      },
    );
    render(createElement(Workbench, { workbench }));
    await waitFor(() => expect(screen.queryByText("Registered async resource")).not.toBeNull());
    let shutdown: Promise<readonly unknown[]> | undefined;
    expect(() => {
      shutdown = workbench.dispose();
    }).not.toThrow();
    expect(workbench.dispose()).toBe(shutdown);
    expect(
      await workbench.open({ to: "/documents/$id", params: { id: "B" }, search: { view: "edit" } }),
    ).toEqual({ status: "rejected", reason: "closed" });
    await waitFor(() => expect(disposeResource).toHaveBeenCalledTimes(1));
    expect(reentered).toBe(shutdown);
    expect(routers.map((router) => vi.mocked(router.history.destroy).mock.calls.length)).toEqual([
      1, 1,
    ]);
    let settled = false;
    void shutdown!.then(() => {
      settled = true;
      return undefined;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resource.resolve(undefined);
    expect(await shutdown).toEqual([resolverError]);
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(workbench.dispose()).toBe(shutdown);
    expect(disposeResource).toHaveBeenCalledTimes(1);
    expect(isDirty).not.toHaveBeenCalled();
    expect(beforeLeave).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(routers.map((router) => vi.mocked(router.history.destroy).mock.calls.length)).toEqual([
      1, 1,
    ]);
  });

  it("continues pending, resolver and document cleanup when a provisional Router fails to clear and destroy", async () => {
    const pending = deferred("pending");
    const { makeRouter } = setup({}, (id) => (id === "pending" ? pending.promise : id));
    const routers: ReturnType<typeof makeRouter>[] = [];
    const clearError = new Error("Pending Router cache teardown failed");
    const destroyError = new Error("Pending Router history teardown failed");
    const factory = (history: RouterHistory) => {
      const router = makeRouter(history);
      const clear = vi.spyOn(router, "clearCache");
      const destroy = vi.spyOn(router.history, "destroy");
      if (routers.length === 2) {
        clear.mockImplementationOnce(() => {
          throw clearError;
        });
        destroy.mockImplementationOnce(() => {
          throw destroyError;
        });
      }
      routers.push(router);
      return router;
    };
    const workbench = createWorkbench({ createRouter: factory });
    disposals.push(() => workbench.dispose());
    expect(
      (
        await workbench.open({
          to: "/documents/$id",
          params: { id: "A" },
          search: { view: "edit" },
        })
      ).status,
    ).toBe("committed");
    const opening = workbench.open({
      to: "/documents/$id",
      params: { id: "pending" },
      search: { view: "edit" },
    });
    await vi.waitFor(() => expect(routers[2]?.state.isLoading).toBe(true));
    const shutdown = workbench.dispose();
    expect(workbench.dispose()).toBe(shutdown);
    expect(await shutdown).toEqual([clearError, destroyError]);
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(routers.map((router) => vi.mocked(router.history.destroy).mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
    pending.resolve("late");
    expect(await opening).toEqual({ status: "superseded" });
    expect(routers.map((router) => vi.mocked(router.history.destroy).mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it("reports provisional Router teardown failures without replacing a committed navigation receipt", async () => {
    const { makeRouter } = setup();
    const routers: ReturnType<typeof makeRouter>[] = [];
    const clearError = new Error("Probe cache teardown failed");
    const destroyError = new Error("Probe history teardown failed");
    const issues = vi.fn<NonNullable<WorkbenchOptions<AnyRouter>["onIssue"]>>();
    const factory = (history: RouterHistory) => {
      const router = makeRouter(history);
      const clear = vi.spyOn(router, "clearCache");
      const destroy = vi.spyOn(router.history, "destroy");
      if (routers.length === 2) {
        clear.mockImplementationOnce(() => {
          throw clearError;
        });
        destroy.mockImplementationOnce(() => {
          throw destroyError;
        });
      }
      routers.push(router);
      return router;
    };
    const workbench = createWorkbench({ createRouter: factory, onIssue: issues });
    disposals.push(() => workbench.dispose());
    const a = await workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "edit" },
    });
    if (a.status !== "committed") throw new Error("Fixture admission failed");
    const result = await workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "preview" },
    });
    expect(result).toMatchObject({
      status: "committed",
      reused: true,
      document: { id: a.document.id },
    });
    expect(workbench.getDocument(a.document.id)?.href).toContain("view=preview");
    expect(issues.mock.calls).toEqual([
      [{ code: "operation-failed", error: clearError }],
      [{ code: "operation-failed", error: destroyError }],
    ]);
    expect(vi.mocked(routers[2]!.history.destroy)).toHaveBeenCalledTimes(1);
    expect(await workbench.dispose()).toEqual([]);
    expect(vi.mocked(routers[2]!.history.destroy)).toHaveBeenCalledTimes(1);
  });

  it("collects document abort and cache errors and still destroys history through guarded close", async () => {
    const { makeRouter } = setup();
    const routers: ReturnType<typeof makeRouter>[] = [];
    const clearError = new Error("Document cache teardown failed");
    const abortError = new Error("Document abort failed");
    const issues = vi.fn<NonNullable<WorkbenchOptions<AnyRouter>["onIssue"]>>();
    const factory = (history: RouterHistory) => {
      const router = makeRouter(history);
      vi.spyOn(router.history, "destroy");
      if (routers.length === 1)
        vi.spyOn(router, "clearCache").mockImplementationOnce(() => {
          throw clearError;
        });
      routers.push(router);
      return router;
    };
    const workbench = createWorkbench({ createRouter: factory, onIssue: issues });
    disposals.push(() => workbench.dispose());
    const a = await workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "edit" },
    });
    if (a.status !== "committed") throw new Error("Fixture admission failed");
    const match = routers[1]!.state.matches[0];
    if (!match) throw new Error("Missing actual Router match");
    vi.spyOn(match.abortController, "abort").mockImplementationOnce(() => {
      throw abortError;
    });
    expect(await workbench.close(a.document.id)).toEqual({
      status: "closed",
      id: a.document.id,
      cleanupErrors: [abortError, clearError],
    });
    expect(issues).not.toHaveBeenCalled();
    expect(vi.mocked(routers[1]!.history.destroy)).toHaveBeenCalledTimes(1);
    expect(await workbench.dispose()).toEqual([]);
    expect(vi.mocked(routers[1]!.history.destroy)).toHaveBeenCalledTimes(1);
  });
});

// Native TanStack compile-time navigation contract, through the public package entry.
function navigationTypes() {
  const { workbench } = setup();
  void workbench.open({ to: "/documents/$id", params: { id: "A" }, search: { view: "edit" } });
  // @ts-expect-error missing required route params
  void workbench.open({ to: "/documents/$id" });
  // @ts-expect-error unknown route
  void workbench.open({ to: "/missing" });
  // @ts-expect-error wrong search type
  void workbench.open({ to: "/documents/$id", params: { id: "A" }, search: { view: 42 } });
}
void navigationTypes;
