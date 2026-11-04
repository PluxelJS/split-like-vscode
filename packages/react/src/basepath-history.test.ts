import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocumentRecord } from "./content-record";
import { createWorkbench } from "./integration";
import { integrationState } from "./internal";
import type { WorkbenchSnapshot } from "./types";

const basepath = "/__pluxel/workbench";
const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  // eslint-disable-next-line no-await-in-loop -- Finish each owned session before tearing down the next.
  for (const dispose of disposals.splice(0)) await dispose();
});
function setup(snapshot?: WorkbenchSnapshot) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === "string" ? search.view : "edit",
    }),
    staticData: {
      worksplit: { title: "Document", documentKey: ({ params }) => `document:${params.id}` },
    },
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
  const create = (history: RouterHistory) =>
    createRouter({
      routeTree: tree,
      basepath,
      history,
      defaultPendingMinMs: 0,
      defaultStaleTime: Infinity,
    });
  const workbench = createWorkbench({
    createRouter: create,
    workspaceId: "basepath",
    home: { mode: "empty", href: `${basepath}/` },
    ...(snapshot ? { initial: { snapshot } } : {}),
  });
  disposals.push(() => workbench.dispose());
  const router = (id: string): AnyRouter =>
    (integrationState(workbench).getRecord(id) as DocumentRecord).runtime!.router;
  return { workbench, router };
}
const url = () => window.location.pathname + window.location.search + window.location.hash;
const nav = (id: string, view = "edit", hash = "") => ({
  to: "/documents/$id" as const,
  params: { id },
  search: { view },
  hash,
});

describe("public document URLs under a native Router basepath", () => {
  it("keeps params, search and hash through native navigation, redirects and browser back", async () => {
    const initial = `${basepath}/documents/A?view=edit#first`;
    window.history.replaceState({ __TSR_index: 0 }, "", initial);
    const { workbench, router } = setup();
    const started = await workbench.start({ browser: { window, onOutsideNavigate: () => {} } });
    if (started.status !== "applied" || !started.value.document) throw new Error(started.status);
    const opened = started.value.document;
    expect(opened.href).toBe(initial);
    const reused = await workbench.open(nav("A", "edit", "first"));
    expect(reused).toMatchObject({
      status: "applied",
      value: { reused: true, document: { id: opened.id, href: initial } },
    });
    const nativeRouter = router(opened.id);
    await nativeRouter.navigate(nav("A", "preview", "details"));
    const native = `${basepath}/documents/A?view=preview#details`;
    expect(nativeRouter.state.location.href).toBe("/documents/A?view=preview#details");
    expect(workbench.getDocument(opened.id)?.href).toBe(native);
    expect(url()).toBe(native);
    const redirected = await workbench.open({ to: "/alias" });
    expect(redirected).toMatchObject({
      status: "applied",
      value: { document: { href: `${basepath}/documents/B?view=preview#summary` } },
    });
    window.history.back();
    await vi.waitFor(() =>
      expect(workbench.getActiveDocument()).toMatchObject({ id: opened.id, href: native }),
    );
    expect(url()).toBe(native);
    window.history.back();
    await vi.waitFor(() => expect(workbench.getActiveDocument()?.href).toBe(initial));
    expect(url()).toBe(initial);
  });

  it.each([false, true])(
    "publishes native search acceptance only while its document is active (switch=%s)",
    async (switchDocument) => {
      window.history.replaceState({ __TSR_index: 0 }, "", `${basepath}/`);
      const { workbench, router } = setup();
      await workbench.start({ browser: { window, onOutsideNavigate: () => {} } });
      const first = await workbench.open(nav("A"));
      const second = await workbench.open(nav("B"));
      if (first.status !== "applied" || second.status !== "applied")
        throw new Error("Documents were not accepted");
      await workbench.activate(first.value.document.id);
      const firstRouter = router(first.value.document.id);
      const off = firstRouter.subscribe("onBeforeLoad", () => {
        void workbench.activate(
          switchDocument ? second.value.document.id : first.value.document.id,
        );
      });
      await firstRouter.navigate(nav("A", "preview"));
      off();
      expect(workbench.getDocument(first.value.document.id)?.href).toBe(
        `${basepath}/documents/A?view=preview`,
      );
      expect(url()).toBe(
        `${basepath}/documents/${switchDocument ? "B?view=edit" : "A?view=preview"}`,
      );
    },
  );

  it("restores business identity and uses explicit navigate reuse to replace view conditions", async () => {
    const first = setup();
    await first.workbench.start();
    const opened = await first.workbench.open(nav("A", "edit", "first"));
    if (opened.status !== "applied") throw new Error(opened.status);
    const second = setup(first.workbench.createSnapshot());
    await second.workbench.start();
    const reused = await second.workbench.open(nav("A", "preview", "details"), {
      reuse: "navigate",
    });
    expect(reused).toMatchObject({
      status: "applied",
      value: {
        reused: true,
        document: {
          id: opened.value.document.id,
          href: `${basepath}/documents/A?view=preview#details`,
        },
      },
    });
    expect(second.workbench.getDocuments()).toHaveLength(1);
  });
});
