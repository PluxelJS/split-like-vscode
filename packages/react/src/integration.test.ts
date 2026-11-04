import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Actions, BorderNode, DockLocation, Model } from "flexlayout-react";
import { createElement, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkbench,
  useContent,
  useContentController,
  Workbench,
  type ContentController,
  type DisposeResult,
  type WorkbenchOptions,
} from "./index";
import { integrationState } from "./internal";

const disposals: (() => Promise<unknown>)[] = [];
const pendingGates: (() => void)[] = [];
const centralDocuments: NonNullable<WorkbenchOptions<AnyRouter>["allowDrop"]> = (tabs, target) =>
  tabs.every((tab) => tab.getComponent() !== "worksplit:document" || target.getType() !== "border");
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
  options: Pick<WorkbenchOptions<AnyRouter>, "initial" | "allowDrop"> = {},
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
    staticData: {
      worksplit: {
        title: "Document",
        navigationKey: "documents",
        documentKey: ({ params }) => String(params.id),
      },
    },
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
  const workbench = createWorkbench({
    createRouter: makeRouter,
    onIssue: issues,
    workspaceId: "integration",
    ...options,
  });
  disposals.push(() => workbench.dispose());
  const started = workbench.start();
  const open = async (id: string) => {
    await started;
    return workbench.open({ to: "/documents/$id", params: { id }, search: { view: "edit" } });
  };
  return { workbench, open, issues, makeRouter };
}

describe("real Router session coordination", () => {
  it("deduplicates a final redirect without touching dirty source content", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    expect(a.status).toBe("applied");
    expect(b.status).toBe("applied");
    if (a.status !== "applied" || b.status !== "applied") throw new Error("Fixture opens failed");
    const decision = vi.fn<() => boolean>(() => false);
    integrationState(workbench).registerController(a.value.document.handle, {
      controller: {
        leave: {
          getState: () => ({ hasUnsavedChanges: true, token: 0 }),
          decide: () => (decision() ? { decision: "allow", token: 0 } : { decision: "deny" }),
        },
      },
    });
    await workbench.activate(a.value.document.id);
    const result = await workbench.open({ to: "/alias" });
    expect(result).toMatchObject({
      status: "applied",
      value: { reused: true, document: { id: b.value.document.id } },
    });
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(workbench.getDocument(a.value.document.id)?.href).toContain("/documents/A");
    expect(decision).not.toHaveBeenCalled();
  });

  it("honors a target document decision when requested search differs", async () => {
    const { workbench, open } = setup();
    const result = await open("A");
    if (result.status !== "applied") throw new Error("Fixture open failed");
    integrationState(workbench).registerController(result.value.document.handle, {
      controller: {
        leave: {
          getState: () => ({ hasUnsavedChanges: true, token: 0 }),
          decide: () => ({ decision: "deny" }),
        },
      },
    });
    const next = await workbench.open(
      {
        to: "/documents/$id",
        params: { id: "A" },
        search: { view: "preview" },
      },
      { reuse: "navigate" },
    );
    expect(next).toEqual({ status: "denied", reason: "decision" });
    expect(workbench.getDocument(result.value.document.id)?.href).toContain("view=edit");
  });

  it("settles concurrent opens, keeps explicit instances and uses active/MRU preference", async () => {
    const { workbench, open } = setup();
    const results = await Promise.all([open("A"), open("A")]);
    expect(results.map((r) => r.status)).toContain("applied");
    expect(workbench.getDocuments()).toHaveLength(1);
    const extra = await workbench.open(
      { to: "/documents/$id", params: { id: "A" }, search: { view: "preview" } },
      { reuse: "new" },
    );
    expect(extra.status).toBe("applied");
    const reused = await open("A");
    if (extra.status !== "applied" || reused.status !== "applied")
      throw new Error("Expected commits");
    expect(reused.value.document.id).toBe(extra.value.document.id);
  });

  it("reuses pending close, validates route identity, and reports post-removal cleanup failure", async () => {
    const { workbench, open } = setup();
    const result = await open("A");
    if (result.status !== "applied") throw new Error("Fixture open failed");
    let approve!: (value: boolean) => void;
    const decision = vi.fn<() => Promise<boolean>>(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve;
        }),
    );
    integrationState(workbench).registerController(result.value.document.handle, {
      controller: {
        leave: {
          getState: () => ({ hasUnsavedChanges: true, token: 0 }),
          decide: async () =>
            (await decision()) ? { decision: "allow", token: 0 } : { decision: "deny" },
        },
      },
    });
    result.value.document.handle.runEffect(({ defer }) => {
      defer(() => {
        throw new Error("cleanup failed");
      });
    });
    integrationState(workbench).focus(result.value.document.id, "content");
    const first = workbench.close(result.value.document.id);
    const second = workbench.close(result.value.document.id);
    expect(decision).toHaveBeenCalledTimes(1);
    approve(true);
    expect(await first).toMatchObject({ status: "applied", cleanupErrors: [expect.any(Error)] });
    expect(await second).toEqual(await first);
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(workbench.getContext().activeDocumentId).toBeNull();
    expect(workbench.getContext().focusedContentId).toBeNull();
  });

  it("protects identities and native closeability while passing layout actions", async () => {
    const { workbench, open } = setup();
    const result = await open("A");
    if (result.status !== "applied") throw new Error("Fixture open failed");
    expect(
      await workbench.dispatch(
        Actions.updateNodeAttributes(result.value.document.id, { component: "other" }),
      ),
    ).toMatchObject({ status: "denied" });
    expect(
      await workbench.dispatch(Actions.setTabPinned(result.value.document.id, true)),
    ).toMatchObject({
      status: "applied",
    });
    expect(await workbench.close(result.value.document.id)).toEqual({
      status: "denied",
      reason: "not-closeable",
    });
    await workbench.dispatch(Actions.setTabPinned(result.value.document.id, false));
    expect(
      await workbench.dispatch(
        Actions.moveNode(
          result.value.document.id,
          workbench.getContext().activeContainerId!,
          DockLocation.RIGHT,
          -1,
        ),
      ),
    ).toMatchObject({ status: "applied" });
    expect(workbench.getDocument(result.value.document.id)?.href).toContain("/documents/A");
    const parent = integrationState(workbench)
      .model.getNodeById(result.value.document.id)!
      .getParent()!;
    expect(await workbench.dispatch(Actions.deleteTabset(parent.getId()))).toMatchObject({
      status: "applied",
    });
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(integrationState(workbench).model.getFirstTabSet()).toBeDefined();
  });

  it("restores lazy background tabs and rejects incompatible content or format", async () => {
    const { workbench, open, makeRouter } = setup();
    await open("A");
    await open("B");
    const snapshot = workbench.createSnapshot();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    const restored = createWorkbench({
      createRouter: factory,
      workspaceId: snapshot.workspaceId,
      initial: { snapshot },
    });
    disposals.push(() => restored.dispose());
    expect(factory).not.toHaveBeenCalled(); // Inactive restored records do not construct Routers.
    expect(restored.getDocuments()).toHaveLength(2);
    await restored.start({ href: "/documents/A?view=edit" });
    expect(
      factory.mock.results.filter(
        (result) => result.type === "return" && !result.value.history.signal?.aborted,
      ),
    ).toHaveLength(1);
    expect(() =>
      createWorkbench({
        createRouter: makeRouter,
        workspaceId: snapshot.workspaceId,
        initial: { snapshot: { ...snapshot, version: 1 } },
      }),
    ).toThrow("Incompatible");
    expect(() =>
      createWorkbench({
        createRouter: makeRouter,
        workspaceId: snapshot.workspaceId,
        initial: {
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
        children: [{ type: "tabset", children: [{ component: "resource", id: "tool" }] }],
      },
    },
  ])("rejects incomplete serialized layouts without rewriting the candidate: %j", (layout) => {
    const { makeRouter } = setup();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    const candidate = { version: 2, workspaceId: "integration", layout };
    const before = structuredClone(candidate);
    expect(() =>
      createWorkbench({
        createRouter: factory,
        workspaceId: candidate.workspaceId,
        initial: { snapshot: candidate },
      }),
    ).toThrow(/snapshot|native node/iu);
    expect(factory).not.toHaveBeenCalled();
    expect(candidate).toEqual(before);
  });

  it("keeps native navigation independent of reuse identity collisions", async () => {
    const { workbench, open, issues } = setup();
    const a = await open("A");
    await open("B");
    if (a.status !== "applied") throw new Error("Fixture open failed");
    const record = integrationState(workbench).getRecord(a.value.document.id)!;
    if (record.role !== "document") throw new Error("Expected document");
    const router = record.runtime!.router;
    await router.navigate({ href: "/alias" });
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(workbench.getDocument(a.value.document.id)?.href).toContain("/documents/B");
    expect(issues).not.toHaveBeenCalled();
  });

  it("uses native admission policy for tabs/groups and an explicit restored-layout validator", async () => {
    const { workbench, open, makeRouter } = setup({
      allowDrop: centralDocuments,
      initial: {
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
      },
    });
    const a = await open("A");
    if (a.status !== "applied") throw new Error("Fixture open failed");
    const before = workbench.model.toJson();
    expect(
      await workbench.dispatch(
        Actions.moveNode(a.value.document.id, "border_bottom", DockLocation.CENTER, -1),
      ),
    ).toMatchObject({ status: "denied" });
    expect(
      await workbench.dispatch(Actions.moveNode("main", "border_bottom", DockLocation.CENTER, -1)),
    ).toMatchObject({ status: "denied" });
    expect(workbench.model.toJson()).toEqual(before);
    const b = await workbench.open(
      { to: "/documents/$id", params: { id: "B" }, search: { view: "edit" } },
      { destination: { target: "border_bottom", location: DockLocation.CENTER } },
    );
    expect(b).toMatchObject({ status: "denied", reason: "layout-policy" });
    expect(workbench.getDocuments()).toHaveLength(1);
    const snapshot = workbench.createSnapshot();
    const invalid = Model.fromJson(snapshot.layout);
    invalid.doAction(
      Actions.moveNode(a.value.document.id, "border_bottom", DockLocation.CENTER, -1),
    );
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    expect(() =>
      createWorkbench({
        createRouter: factory,
        workspaceId: snapshot.workspaceId,
        initial: { snapshot: { ...snapshot, layout: invalid.toJson() } },
        layoutPolicy: {
          allows: (model) => {
            let allowed = true;
            model.visitNodes((node) => {
              if (node instanceof BorderNode && node.getChildren().length) allowed = false;
            });
            return allowed;
          },
          allowsAction: () => true,
          allowsDrop: () => true,
        },
      }),
    ).toThrow("policy");
    expect(factory).not.toHaveBeenCalled();
  });

  it("awaits stopped effect cleanup exactly once through close and idempotent shutdown", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    if (a.status !== "applied") throw new Error("Fixture open failed");
    let finish!: () => void;
    const disposeResource = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = a.value.document.handle.runEffect(({ defer }) => {
      defer(disposeResource);
    });
    stop();
    stop();
    const closing = workbench.close(a.value.document.id);
    await Promise.resolve();
    expect(disposeResource).toHaveBeenCalledTimes(1);
    finish();
    expect(await closing).toEqual({
      status: "applied",
      value: { closedIds: [a.value.document.id] },
      cleanupErrors: [],
    });
    const disposed = workbench.dispose();
    expect(workbench.dispose()).toBe(disposed);
    expect(await disposed).toEqual({ status: "applied", value: undefined, cleanupErrors: [] });
    expect(disposeResource).toHaveBeenCalledTimes(1);
  });
});

describe("owned Router teardown failures", () => {
  it("caches shutdown before reentrant cleanup, collects an admitted Router failure and settles registered async resources", async () => {
    const { makeRouter } = setup();
    const routers: ReturnType<typeof makeRouter>[] = [];
    const historyError = new Error("Admitted history teardown failed");
    const factory = (history: RouterHistory) => {
      const router = makeRouter(history);
      const destroyNative = router.history.destroy.bind(router.history);
      const destroy = vi.spyOn(router.history, "destroy");
      if (routers.length === 0)
        destroy.mockImplementationOnce(() => {
          destroyNative();
          throw historyError;
        });
      routers.push(router);
      return router;
    };
    const resource = deferred<void>(undefined);
    let reentered: Promise<DisposeResult> | undefined;
    const disposeResource = vi.fn<() => Promise<void>>(() => {
      reentered = workbench.dispose();
      return resource.promise;
    });
    const getState = vi.fn<() => { hasUnsavedChanges: boolean; token: number }>(() => ({
      hasUnsavedChanges: true,
      token: 0,
    }));
    const decide = vi.fn<() => { decision: "deny" }>(() => ({ decision: "deny" }));
    const save = vi.fn<NonNullable<ContentController["save"]>>();
    const controller: ContentController = { leave: { getState, decide }, save };
    function ResourceTool() {
      const content = useContent();
      useContentController(controller);
      useEffect(() => content.runEffect(({ defer }) => defer(disposeResource)), [content]);
      return createElement("span", null, "Registered async resource");
    }
    const workbench = createWorkbench({
      createRouter: factory,
      tools: { resource: { render: () => createElement(ResourceTool) } },
      initial: {
        layout: {
          borders: [
            {
              type: "border",
              location: "bottom",
              selected: 0,
              children: [{ type: "tab", id: "resource", component: "resource" }],
            },
          ],
          layout: { type: "row", children: [] },
        },
      },
    });
    disposals.push(() => workbench.dispose());
    await workbench.start();
    const opened = await workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "edit" },
    });
    expect(opened.status).toBe("applied");
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
    render(createElement(Workbench, { instance: workbench }));
    await waitFor(() => expect(screen.queryByText("Registered async resource")).not.toBeNull());
    let shutdown: Promise<DisposeResult> | undefined;
    expect(() => {
      shutdown = workbench.dispose();
    }).not.toThrow();
    expect(workbench.dispose()).toBe(shutdown);
    expect(
      await workbench.open({ to: "/documents/$id", params: { id: "B" }, search: { view: "edit" } }),
    ).toEqual({ status: "denied", reason: "not-ready" });
    await waitFor(() => expect(disposeResource).toHaveBeenCalledTimes(1));
    expect(reentered).toBe(shutdown);
    expect(routers.map((router) => vi.mocked(router.history.destroy).mock.calls.length)).toEqual([
      1,
    ]);
    let settled = false;
    void shutdown!.then(() => {
      settled = true;
      return undefined;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resource.resolve(undefined);
    expect(await shutdown).toMatchObject({ status: "applied", cleanupErrors: [historyError] });
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(workbench.dispose()).toBe(shutdown);
    expect(disposeResource).toHaveBeenCalledTimes(1);
    expect(getState).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(routers.map((router) => vi.mocked(router.history.destroy).mock.calls.length)).toEqual([
      1,
    ]);
  });

  it("continues pending and admitted document cleanup when a provisional Router fails to clear and destroy", async () => {
    const pending = deferred("pending");
    const { makeRouter } = setup({}, (id) => (id === "pending" ? pending.promise : id));
    const routers: ReturnType<typeof makeRouter>[] = [];
    const clearError = new Error("Pending Router cache teardown failed");
    const destroyError = new Error("Pending Router history teardown failed");
    const factory = (history: RouterHistory) => {
      const router = makeRouter(history);
      const clear = vi.spyOn(router, "clearCache");
      const destroyNative = router.history.destroy.bind(router.history);
      const destroy = vi.spyOn(router.history, "destroy");
      if (routers.length === 1) {
        clear.mockImplementationOnce(() => {
          throw clearError;
        });
        destroy.mockImplementationOnce(() => {
          destroyNative();
          throw destroyError;
        });
      }
      routers.push(router);
      return router;
    };
    const workbench = createWorkbench({ createRouter: factory });
    disposals.push(() => workbench.dispose());
    await workbench.start();
    expect(
      (
        await workbench.open({
          to: "/documents/$id",
          params: { id: "A" },
          search: { view: "edit" },
        })
      ).status,
    ).toBe("applied");
    const opening = workbench.open({
      to: "/documents/$id",
      params: { id: "pending" },
      search: { view: "edit" },
    });
    await vi.waitFor(() => expect(routers[1]?.state.isLoading).toBe(true));
    const shutdown = workbench.dispose();
    expect(workbench.dispose()).toBe(shutdown);
    expect(await shutdown).toMatchObject({
      status: "applied",
      cleanupErrors: [destroyError, clearError],
    });
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(routers.map((router) => vi.mocked(router.history.destroy).mock.calls.length)).toEqual([
      1, 1,
    ]);
    pending.resolve("late");
    expect(await opening).toEqual({ status: "superseded" });
    expect(routers.map((router) => vi.mocked(router.history.destroy).mock.calls.length)).toEqual([
      1, 1,
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
      const destroyNative = router.history.destroy.bind(router.history);
      const destroy = vi.spyOn(router.history, "destroy");
      if (routers.length === 1) {
        clear.mockImplementationOnce(() => {
          throw clearError;
        });
        destroy.mockImplementationOnce(() => {
          destroyNative();
          throw destroyError;
        });
      }
      routers.push(router);
      return router;
    };
    const workbench = createWorkbench({ createRouter: factory, onIssue: issues });
    disposals.push(() => workbench.dispose());
    await workbench.start();
    const a = await workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "edit" },
    });
    if (a.status !== "applied") throw new Error("Fixture admission failed");
    const result = await workbench.open(
      {
        to: "/documents/$id",
        params: { id: "A" },
        search: { view: "preview" },
      },
      { reuse: "navigate" },
    );
    expect(result).toMatchObject({
      status: "applied",
      value: { reused: true, document: { id: a.value.document.id } },
    });
    expect(workbench.getDocument(a.value.document.id)?.href).toContain("view=preview");
    expect(issues.mock.calls).toEqual([
      [{ code: "operation-failed", error: destroyError }],
      [{ code: "operation-failed", error: clearError }],
    ]);
    expect(vi.mocked(routers[1]!.history.destroy)).toHaveBeenCalledTimes(1);
    expect(await workbench.dispose()).toEqual({
      status: "applied",
      value: undefined,
      cleanupErrors: [],
    });
    expect(vi.mocked(routers[1]!.history.destroy)).toHaveBeenCalledTimes(1);
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
      if (routers.length === 0)
        vi.spyOn(router, "clearCache").mockImplementationOnce(() => {
          throw clearError;
        });
      routers.push(router);
      return router;
    };
    const workbench = createWorkbench({ createRouter: factory, onIssue: issues });
    disposals.push(() => workbench.dispose());
    await workbench.start();
    const a = await workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "edit" },
    });
    if (a.status !== "applied") throw new Error("Fixture admission failed");
    const match = routers[0]!.state.matches[0];
    if (!match) throw new Error("Missing actual Router match");
    vi.spyOn(match.abortController, "abort").mockImplementationOnce(() => {
      throw abortError;
    });
    expect(await workbench.close(a.value.document.id)).toMatchObject({
      status: "applied",
      value: { closedIds: [a.value.document.id] },
      cleanupErrors: [abortError, clearError],
    });
    expect(issues).not.toHaveBeenCalled();
    expect(vi.mocked(routers[0]!.history.destroy)).toHaveBeenCalledTimes(1);
    expect(await workbench.dispose()).toEqual({
      status: "applied",
      value: undefined,
      cleanupErrors: [],
    });
    expect(vi.mocked(routers[0]!.history.destroy)).toHaveBeenCalledTimes(1);
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
