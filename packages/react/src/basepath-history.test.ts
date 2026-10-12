import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchSnapshot } from "./index";

const basepath = "/__pluxel/workbench";
const disposals: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
  window.history.replaceState(null, "", "/");
});

function setup(snapshot?: WorkbenchSnapshot) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === "string" ? search.view : "edit",
    }),
    staticData: { worksplit: { title: "Document" } },
  });
  const alias = createRoute({
    getParentRoute: () => root,
    path: "/alias",
    beforeLoad: () => {
      throw redirect({
        to: "/documents/$id",
        params: { id: "B" },
        search: { view: "preview" },
        hash: "summary",
      });
    },
  });
  const tree = root.addChildren([page, alias]);
  const routers: AnyRouter[] = [];
  const create = (history: RouterHistory) => {
    const router = createRouter({
      routeTree: tree,
      basepath,
      history,
      defaultPendingMinMs: 0,
      defaultStaleTime: Infinity,
    });
    routers.push(router);
    return router;
  };
  const workbench = createWorkbench({ createRouter: create, snapshot });
  disposals.push(() => workbench.dispose());
  return { workbench, routers };
}

describe("public document URLs under a Router basepath", () => {
  it("keeps params, search and hash through native navigation, redirects and browser back", async () => {
    const initial = `${basepath}/documents/A?view=edit#first`;
    window.history.replaceState(null, "", initial);
    const { workbench, routers } = setup();
    workbench.connectBrowser();
    const opened = await workbench.start(initial);
    if (opened.status !== "committed") throw new Error(opened.status);
    expect(opened.document.href).toBe(initial);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(initial);

    const reused = await workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "edit" },
      hash: "first",
    });
    expect(reused).toMatchObject({
      status: "committed",
      reused: true,
      document: { id: opened.document.id, href: initial },
    });

    const router = routers.at(-1)!;
    await router.navigate({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "preview" },
      hash: "details",
    });
    const native = `${basepath}/documents/A?view=preview#details`;
    expect(router.state.location.href).toBe("/documents/A?view=preview#details");
    expect(workbench.getDocument(opened.document.id)?.href).toBe(native);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(native);

    const redirected = await workbench.open({ to: "/alias" });
    if (redirected.status !== "committed") throw new Error(redirected.status);
    expect(redirected.document.href).toBe(`${basepath}/documents/B?view=preview#summary`);
    window.history.back();
    await vi.waitFor(() => {
      expect(workbench.getActiveDocument()?.id).toBe(opened.document.id);
      expect(workbench.getActiveDocument()?.href).toBe(native);
      expect(window.location.pathname + window.location.search + window.location.hash).toBe(native);
    });
    window.history.back();
    await vi.waitFor(() => {
      expect(workbench.getActiveDocument()?.href).toBe(initial);
      expect(window.location.pathname + window.location.search + window.location.hash).toBe(
        initial,
      );
    });
  });

  it("retains a lazily restored identity when the requested view conditions change", async () => {
    const first = setup();
    const opened = await first.workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "edit" },
      hash: "first",
    });
    if (opened.status !== "committed") throw new Error(opened.status);
    expect(opened.document.href).toBe(`${basepath}/documents/A?view=edit#first`);
    const second = setup(first.workbench.snapshot());
    const reused = await second.workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "preview" },
      hash: "details",
    });
    expect(reused).toMatchObject({
      status: "committed",
      reused: true,
      document: {
        id: opened.document.id,
        href: `${basepath}/documents/A?view=preview#details`,
      },
    });
    expect(second.workbench.getDocuments()).toHaveLength(1);
  });
});
