import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { Actions } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchSnapshot, type WorkbenchContentLifecycle } from "./index";
import { integrationState } from "./integration";

const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});
const documentNavigation = (id: string, filter = "", source = "S") => ({
  to: "/sources/$source/documents/$id" as const,
  params: { source, id },
  search: { filter },
});

function setup(snapshot?: WorkbenchSnapshot) {
  const load = vi.fn<(id: string) => void>();
  const root = createRootRoute();
  const document = createRoute({
    getParentRoute: () => root,
    path: "/sources/$source/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      filter: typeof search.filter === "string" ? search.filter : "",
    }),
    loader: ({ params }) => {
      load(params.id);
    },
    staticData: { worksplit: { title: "Document" } },
  });
  const alias = createRoute({
    getParentRoute: () => root,
    path: "/alias",
    beforeLoad: () => {
      throw redirect({
        to: "/sources/$source/documents/$id",
        params: { source: "S", id: "B" },
        search: { filter: "" },
      });
    },
  });
  const routeTree = root.addChildren([document, alias]);
  const workbench = createWorkbench({
    createRouter: (history: RouterHistory) =>
      createRouter({ routeTree, history, defaultPendingMinMs: 0, defaultStaleTime: Infinity }),
    ...(snapshot ? { snapshot } : {}),
  });
  disposals.push(() => workbench.dispose());
  const open = async (id: string, preview = false) => {
    const result = await workbench.open(documentNavigation(id), { preview });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error(result.status);
    return result.document.id;
  };
  return { workbench, nav: documentNavigation, open, load };
}

describe("document entrances and replaceable previews", () => {
  it("reveals an existing identity without changing filters or asking its dirty guard", async () => {
    const { workbench, nav, load } = setup();
    const initial = await workbench.open(nav("A", "cash"));
    if (initial.status !== "committed") throw new Error(initial.status);
    const beforeLeave = vi.fn<() => boolean>(() => false);
    integrationState(workbench).register(initial.document.id, { isDirty: () => true, beforeLeave });
    const count = load.mock.calls.length;
    const result = await workbench.open(nav("A"), { reuse: "preserve" });
    expect(result).toMatchObject({
      status: "committed",
      reused: true,
      document: { id: initial.document.id, href: initial.document.href },
    });
    expect(beforeLeave).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(count);
    expect((await workbench.open(nav("A"))).status).toBe("rejected");
    expect(beforeLeave).toHaveBeenCalledTimes(1);
  });

  it("preserves the final redirected target, without replacing a different preview", async () => {
    const { workbench, nav, open } = setup();
    const b = await workbench.open(nav("B", "cash"));
    if (b.status !== "committed") throw new Error(b.status);
    const a = await open("A", true);
    const result = await workbench.open({ to: "/alias" }, { preview: true, reuse: "preserve" });
    expect(result).toMatchObject({
      status: "committed",
      document: { id: b.document.id, href: b.document.href, preview: false },
    });
    expect(workbench.getDocument(a)?.preview).toBe(true);
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("replaces a clean preview with a fresh lifetime and retains ordinary comparisons", async () => {
    const { workbench, open } = setup();
    const permanent = await open("A");
    const b = await open("B", true);
    const disposed = vi.fn<() => void>();
    integrationState(workbench).register(b, { dispose: disposed });
    const c = await open("C", true);
    expect(c).not.toBe(b);
    expect(workbench.getDocument(b)).toBeNull();
    expect(disposed).toHaveBeenCalledOnce();
    expect(workbench.getDocuments().map((d) => d.id)).toEqual([permanent, c]);
    expect(workbench.getDocument(c)?.preview).toBe(true);
    workbench.keep(c);
    expect(workbench.getDocument(c)?.preview).toBe(false);
    await open("D", true);
    expect(workbench.getDocument(c)).not.toBeNull();
    expect((await workbench.close(c)).status).toBe("closed");
  });

  it("automatically keeps dirty and pinned previews instead of discarding them", async () => {
    const { workbench, open } = setup();
    const a = await open("A", true);
    const beforeLeave = vi.fn<() => boolean>(() => false);
    integrationState(workbench).register(a, { isDirty: () => true, beforeLeave });
    const b = await open("B", true);
    expect(workbench.getDocument(a)?.preview).toBe(false);
    expect(beforeLeave).not.toHaveBeenCalled();
    await workbench.dispatch(Actions.setTabPinned(b, true));
    expect(workbench.getDocument(b)?.preview).toBe(false);
    await open("C", true);
    expect(workbench.getDocuments()).toHaveLength(3);
    expect(workbench.getDocuments().filter((d) => d.preview)).toHaveLength(1);
  });

  it("leaves the previous preview intact when admission fails", async () => {
    const { workbench, open, nav } = setup();
    const a = await open("A", true);
    const result = await workbench.open(nav("B"), { preview: true, target: "missing" });
    expect(result.status).toBe("failed");
    expect(workbench.getDocuments()).toMatchObject([{ id: a, preview: true }]);
  });

  it("creates ordinary independent copies and rejects background preview requests", async () => {
    const { workbench, open, nav } = setup();
    const a = await open("A", true);
    const copy = await workbench.duplicate(a);
    expect(copy).toMatchObject({
      status: "committed",
      reused: false,
      document: { preview: false },
    });
    expect(workbench.getDocument(a)?.preview).toBe(true);
    expect(await workbench.duplicate("missing")).toEqual({ status: "rejected", reason: "closed" });
    await expect(workbench.open(nav("B"), { preview: true, background: true })).rejects.toThrow(
      /preview/i,
    );
  });

  it("restores a preview and deduplicates a lazily restored identity with other filters", async () => {
    const first = setup();
    const a = await first.workbench.open(first.nav("A", "cash"), { preview: true });
    if (a.status !== "committed") throw new Error(a.status);
    const snapshot = first.workbench.snapshot();
    const second = setup(snapshot);
    const result = await second.workbench.open(second.nav("A"), { reuse: "preserve" });
    expect(result).toMatchObject({
      status: "committed",
      reused: true,
      document: { id: a.document.id, href: a.document.href, preview: true },
    });
    expect(second.workbench.getDocuments()).toHaveLength(1);
    await second.open("B", true);
    expect(second.workbench.getDocument(a.document.id)).toBeNull();
  });

  it("supplies guarded navigation locations for permitted same-document view changes", async () => {
    const { workbench, open, nav } = setup();
    const a = await open("A");
    const beforeLeave = vi.fn<NonNullable<WorkbenchContentLifecycle["beforeLeave"]>>(
      (reason, context) =>
        reason === "navigate" && context.from?.split("?")[0] === context.to?.split("?")[0],
    );
    integrationState(workbench).register(a, { isDirty: () => true, beforeLeave });
    const result = await workbench.open(nav("A", "cash"));
    expect(result.status).toBe("committed");
    expect(beforeLeave).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({
        id: a,
        from: expect.stringContaining("/documents/A"),
        to: expect.stringContaining("cash"),
      }),
    );
    expect((await workbench.close(a)).status).toBe("rejected");
    expect(beforeLeave).toHaveBeenLastCalledWith("close", expect.objectContaining({ id: a }));
  });
});
