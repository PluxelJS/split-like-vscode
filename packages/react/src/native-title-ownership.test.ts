import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { Actions, Model, TabNode } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchInstance, type WorkbenchSnapshot } from "./index";

const instances: WorkbenchInstance<AnyRouter>[] = [];
const finishLoads: (() => void)[] = [];
afterEach(async () => {
  finishLoads.splice(0).forEach((finish) => finish());
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

function setup({
  snapshot,
  load = () => {},
  redirectLegacy = false,
}: {
  snapshot?: WorkbenchSnapshot;
  load?: () => void | Promise<void>;
  redirectLegacy?: boolean;
} = {}) {
  const root = createRootRoute();
  const document = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === "string" ? search.view : "edit",
      entry: typeof search.entry === "string" ? search.entry : "main",
    }),
    loader: load,
    staticData: {
      worksplit: {
        title: "Document",
        documentKey: ({ params, search }) => JSON.stringify([params.id, search.entry]),
      },
    },
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    staticData: { worksplit: { title: "Settings" } },
  });
  const legacy = createRoute({
    getParentRoute: () => root,
    path: "/legacy",
    staticData: { worksplit: { title: "Legacy document" } },
    beforeLoad: () => {
      if (redirectLegacy)
        throw redirect({
          to: "/documents/$id",
          params: { id: "A" },
          search: { view: "edit", entry: "main" },
        });
    },
  });
  const routeTree = root.addChildren([document, settings, legacy]);
  const routers: AnyRouter[] = [];
  const onIssue = vi.fn<(issue: unknown) => void>();
  const workbench = createWorkbench({
    createRouter: (history: RouterHistory) => {
      const router = createRouter({ routeTree, history, defaultPendingMinMs: 0 });
      routers.push(router);
      return router;
    },
    onIssue,
    workspaceId: "titles",
    ...(snapshot ? { initial: { snapshot } } : {}),
  });
  instances.push(workbench);
  const open = async (id: string, view = "edit") => {
    await workbench.start();
    const result = await workbench.open(
      {
        to: "/documents/$id",
        params: { id },
        search: { view, entry: "main" },
      },
      { reuse: "navigate" },
    );
    if (result.status !== "applied") throw new Error(`Fixture open: ${result.status}`);
    return result.value;
  };
  return { workbench, routers, open, onIssue };
}

describe("native document title ownership", () => {
  it("reloads an accepted ordinary owner beside its explicit copy without a new conflict", async () => {
    const first = setup();
    const a = (await first.open("A")).document;
    expect((await first.workbench.duplicate(a.id)).status).toBe("applied");
    await first.routers[1]!.invalidate();
    expect(first.onIssue).not.toHaveBeenCalled();
    expect(first.workbench.getDocuments()).toHaveLength(2);
  });

  it("lazily restores an accepted ordinary owner beside its explicit copy without a new conflict", async () => {
    const first = setup();
    const a = (await first.open("A")).document;
    expect((await first.workbench.duplicate(a.id)).status).toBe("applied");
    const restored = setup({ snapshot: first.workbench.createSnapshot() });
    await restored.workbench.start({ href: a.href });
    await restored.workbench.activate(a.id);
    expect(await restored.open("A")).toMatchObject({ reused: true });
    expect(restored.onIssue).not.toHaveBeenCalled();
    expect(restored.workbench.getDocuments()).toHaveLength(2);
  });

  it("keeps native renames across coordinated and native view-state navigation and reloading", async () => {
    const { workbench, open, routers, onIssue } = setup();
    const first = await open("A");
    const router = routers.at(-1)!;
    const id = first.document.id;
    expect(first.document.title).toBe("Document");
    expect(await workbench.dispatch(Actions.renameTab(id, "Studio A"))).toMatchObject({
      status: "applied",
    });
    const reused = await open("A", "preview");
    expect(reused).toMatchObject({
      reused: true,
      document: { id, title: "Studio A", href: "/documents/A?view=preview&entry=main" },
    });
    await router.navigate({ href: "/documents/A?view=compare&entry=main#diagram" });
    expect(workbench.getDocument(id)).toMatchObject({
      title: "Studio A",
      href: "/documents/A?view=compare&entry=main#diagram",
    });
    await router.invalidate();
    expect(workbench.getDocument(id)?.title).toBe("Studio A");
    expect(
      (Model.fromJson(workbench.createSnapshot().layout).getNodeById(id) as TabNode).getName(),
    ).toBe("Studio A");
    expect(onIssue).not.toHaveBeenCalled();
  });

  it("restores native active and lazy background names without deriving a second label source", async () => {
    const first = setup();
    const a = (await first.open("A")).document;
    const b = (await first.open("B")).document;
    await first.workbench.dispatch(Actions.renameTab(a.id, "Studio A"));
    await first.workbench.dispatch(Actions.renameTab(b.id, "Studio B"));
    await first.workbench.activate(a.id);
    const restored = setup({ snapshot: first.workbench.createSnapshot() });
    expect(restored.routers).toHaveLength(0); // Restored inactive documents have no Router yet.
    expect(restored.workbench.getDocuments()).toMatchObject([
      { id: a.id, title: "Studio A" },
      { id: b.id, title: "Studio B" },
    ]);
    expect(await restored.workbench.start({ href: a.href })).toMatchObject({
      status: "applied",
      value: { document: { id: a.id, title: "Studio A" } },
    });
    expect(restored.routers.filter((router) => !router.history.signal?.aborted)).toHaveLength(1);
    expect(await restored.open("B")).toMatchObject({
      reused: true,
      document: { id: b.id, title: "Studio B" },
    });
    expect(restored.workbench.getDocuments()).toMatchObject([
      { id: a.id, title: "Studio A" },
      { id: b.id, title: "Studio B" },
    ]);
  });

  it("retains manual titles across params, reuse-key and route changes; new copies start automatic", async () => {
    const { workbench, open, routers } = setup();
    const id = (await open("A")).document.id;
    const router = routers.at(-1)!;
    await workbench.dispatch(Actions.renameTab(id, "Studio A"));
    await router.navigate({ href: "/documents/B?view=edit&entry=main" });
    expect(workbench.getDocument(id)).toMatchObject({
      title: "Studio A",
      href: "/documents/B?view=edit&entry=main",
    });
    await workbench.dispatch(Actions.renameTab(id, "Studio B"));
    await router.navigate({ href: "/documents/B?view=edit&entry=outline" });
    expect(workbench.getDocument(id)?.title).toBe("Studio B");
    await workbench.dispatch(Actions.renameTab(id, "Outline B"));
    await router.navigate({ href: "/documents/B?view=preview&entry=outline#details" });
    expect(workbench.getDocument(id)?.title).toBe("Outline B");
    await router.navigate({ href: "/settings" });
    expect(workbench.getDocument(id)).toMatchObject({ title: "Outline B", href: "/settings" });
    expect(workbench.getDocuments()).toHaveLength(1);
    expect(await workbench.duplicate(id)).toMatchObject({
      status: "applied",
      value: { document: { title: "Settings" } },
    });
  });

  it("preserves restored manual ownership when a restored URL redirects", async () => {
    const first = setup();
    await first.workbench.start();
    const opened = await first.workbench.open({ to: "/legacy" });
    if (opened.status !== "applied") throw new Error(opened.status);
    await first.workbench.dispatch(Actions.renameTab(opened.value.document.id, "Legacy draft"));
    const restored = setup({ snapshot: first.workbench.createSnapshot(), redirectLegacy: true });
    expect(await restored.workbench.start({ href: "/legacy" })).toMatchObject({
      status: "applied",
      value: {
        document: {
          id: opened.value.document.id,
          title: "Legacy draft",
          href: "/documents/A?view=edit&entry=main",
        },
      },
    });
  });

  it("preserves a native name edited while a restored document is still loading", async () => {
    const first = setup();
    const original = (await first.open("A")).document;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    finishLoads.push(() => finish());
    const restored = setup({ snapshot: first.workbench.createSnapshot(), load: () => gate });
    const startup = restored.workbench.start({ href: original.href });
    await vi.waitUntil(() => restored.routers.some((router) => router.state.isLoading));
    restored.workbench.model.doAction(Actions.renameTab(original.id, "Edited while loading"));
    finish();
    expect(await startup).toMatchObject({
      status: "applied",
      value: { document: { id: original.id, title: "Edited while loading" } },
    });
  });
});
