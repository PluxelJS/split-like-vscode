import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { Actions, DockLocation, Model } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchOptions } from "./index";
import { integrationState } from "./integration";

const disposals: (() => Promise<unknown>)[] = [];
const centralDocuments: NonNullable<WorkbenchOptions<AnyRouter>["allowDrop"]> = (tabs, target) =>
  tabs.every((tab) => tab.getComponent() !== "worksplit.document" || target.getType() !== "border");
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});
function setup(options: Pick<WorkbenchOptions<AnyRouter>, "layout" | "allowDrop"> = {}) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === "string" ? search.view : "edit",
    }),
    loader: ({ params }) => params.id,
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
    integrationState(workbench).register(a.document.id, {
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
    integrationState(workbench).register(result.document.id, {
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
    integrationState(workbench).register(result.document.id, {
      isDirty: () => true,
      beforeLeave: decision,
      dispose: () => {
        throw new Error("cleanup failed");
      },
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

  it("blocks whole-group deletion and identity rewrites while allowing native layout actions", async () => {
    const { workbench, open } = setup();
    const result = await open("A");
    if (result.status !== "committed") throw new Error("Fixture open failed");
    expect(await workbench.dispatch(Actions.deleteTabset("main"))).toEqual({ status: "rejected" });
    expect(
      await workbench.dispatch(
        Actions.updateNodeAttributes(result.document.id, { component: "other" }),
      ),
    ).toEqual({ status: "rejected" });
    expect(await workbench.dispatch(Actions.setTabPinned(result.document.id, true))).toEqual({
      status: "applied",
    });
    expect(
      await workbench.dispatch(
        Actions.moveNode(result.document.id, "main", DockLocation.RIGHT, -1),
      ),
    ).toEqual({ status: "applied" });
    expect(workbench.getDocument(result.document.id)?.href).toContain("/documents/A");
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

  it("awaits unregister cleanup exactly once through close and idempotent shutdown", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    if (a.status !== "committed") throw new Error("Fixture open failed");
    let finish!: () => void;
    const cleanup = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const unregister = integrationState(workbench).register(a.document.id, { dispose: cleanup });
    unregister();
    unregister();
    const closing = workbench.close(a.document.id);
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
    finish();
    expect(await closing).toEqual({ status: "closed", id: a.document.id, cleanupErrors: [] });
    const disposed = workbench.dispose();
    expect(workbench.dispose()).toBe(disposed);
    expect(await disposed).toEqual([]);
    expect(cleanup).toHaveBeenCalledTimes(1);
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
