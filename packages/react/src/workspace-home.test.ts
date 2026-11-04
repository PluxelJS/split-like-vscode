import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRouter,
} from "@tanstack/react-router";
import { Actions, DockLocation, TabGroupNode } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench } from "./integration";
import { integrationState } from "./internal";
import type { WorkbenchInstance, WorkbenchOptions, WorkbenchSnapshot } from "./types";

const instances: WorkbenchInstance<AnyRouter>[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  // eslint-disable-next-line no-await-in-loop -- Finish each owned session before tearing down the next.
  for (const instance of instances.splice(0)) await instance.dispose();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  releases.push(() => resolve());
  return { promise, resolve };
}
const nav = (id: string) => ({ to: "/documents/$id" as const, params: { id } });
function setup(
  options: {
    home?: WorkbenchOptions<AnyRouter>["home"];
    snapshot?: WorkbenchSnapshot;
    load?: (id: string) => unknown;
    redirectHome?: boolean;
  } = {},
) {
  const root = createRootRoute();
  const homeLoads = vi.fn<() => void>(() => {});
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    beforeLoad: () => {
      homeLoads();
      if (options.redirectHome !== false) throw redirect(nav("welcome"));
    },
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    loader: ({ params }) => options.load?.(params.id),
  });
  const routeTree = root.addChildren([home, page]);
  const routers: AnyRouter[] = [];
  const workbench = createWorkbench({
    workspaceId: "home",
    home: options.home ?? { mode: "empty", href: "/" },
    ...(options.snapshot ? { initial: { snapshot: options.snapshot } } : {}),
    createRouter: (history) => {
      const router = createRouter({
        routeTree,
        history,
        defaultPendingMs: 10000,
        defaultPendingMinMs: 0,
        defaultStaleTime: Infinity,
      });
      routers.push(router);
      return router;
    },
  });
  instances.push(workbench);
  const open = async (id: string) => {
    const result = await workbench.open(nav(id));
    if (result.status !== "applied") throw new Error(result.status);
    return result.value.document;
  };
  return { workbench, open, homeLoads, routers };
}
const browser = () => ({ browser: { window, onOutsideNavigate: () => {} } });

describe("explicit home and restored document startup", () => {
  it("accepts empty home without constructing a Router and routes ordinary opens", async () => {
    const { workbench, routers, homeLoads, open } = setup();
    expect(await workbench.start()).toMatchObject({
      status: "applied",
      value: { document: null, href: "/" },
    });
    expect(routers).toHaveLength(0);
    const document = await open("A");
    expect(document.href).toBe("/documents/A");
    expect(homeLoads).not.toHaveBeenCalled();
  });

  it("runs the configured route home and its native redirect", async () => {
    const { workbench, homeLoads } = setup({ home: { mode: "route", href: "/" } });
    expect(await workbench.start()).toMatchObject({
      status: "applied",
      value: { document: { href: "/documents/welcome" } },
    });
    expect(homeLoads).toHaveBeenCalledTimes(1);
  });

  it("treats only the complete configured home href as empty", async () => {
    const empty = setup({ home: { mode: "empty", href: "/documents/A" } });
    expect(await empty.workbench.start()).toMatchObject({
      status: "applied",
      value: { document: null },
    });
    const query = setup({ home: { mode: "empty", href: "/documents/A" } });
    expect(await query.workbench.start({ href: "/documents/A?view=detail#section" })).toMatchObject(
      { status: "applied", value: { document: { href: "/documents/A?view=detail#section" } } },
    );
  });

  it("restores the active native selection with one lazy Router and no new tab", async () => {
    const first = setup();
    await first.workbench.start();
    const a = await first.open("A");
    const b = await first.open("B");
    expect(
      (
        await first.workbench.dispatch(
          Actions.moveNode(b.id, a.containerId!, DockLocation.RIGHT, -1),
        )
      ).status,
    ).toBe("applied");
    await first.workbench.activate(b.id);
    const second = setup({ snapshot: first.workbench.createSnapshot() });
    expect(second.routers).toHaveLength(0);
    expect(await second.workbench.start()).toMatchObject({
      status: "applied",
      value: { document: { id: b.id } },
    });
    expect(second.workbench.getDocuments()).toHaveLength(2);
    expect(second.routers).toHaveLength(1);
  });

  it("restores the selected comparison without expanding another copy's collapsed group", async () => {
    const first = setup();
    await first.workbench.start();
    const original = await first.open("A");
    expect(
      (await first.workbench.dispatch(Actions.addTabToNewGroup(original.id, "Original"))).status,
    ).toBe("applied");
    const group = first.workbench.model.getNodeById(original.id)!.getParent()!;
    expect(group).toBeInstanceOf(TabGroupNode);
    const duplicate = await first.workbench.duplicate(original.id);
    if (duplicate.status !== "applied") throw new Error(duplicate.status);
    await first.workbench.dispatch(Actions.updateNodeAttributes(group.getId(), { opened: false }));
    const second = setup({ snapshot: first.workbench.createSnapshot() });
    expect(await second.workbench.start()).toMatchObject({
      status: "applied",
      value: { document: { id: duplicate.value.document.id } },
    });
    expect((second.workbench.model.getNodeById(group.getId()) as TabGroupNode).isOpened()).toBe(
      false,
    );
    expect(second.routers).toHaveLength(1);
    expect(second.workbench.getDocuments()).toHaveLength(2);
  });

  it("gives an explicit deep link priority over the restored selection", async () => {
    const first = setup();
    await first.workbench.start();
    await first.open("A");
    const second = setup({ snapshot: first.workbench.createSnapshot() });
    expect(await second.workbench.start({ href: "/documents/B" })).toMatchObject({
      status: "applied",
      value: { document: { href: "/documents/B" } },
    });
    expect(second.workbench.getDocuments()).toHaveLength(2);
  });

  it("normalizes empty browser home to a retained restored document", async () => {
    const first = setup();
    await first.workbench.start();
    const a = await first.open("A");
    const second = setup({ snapshot: first.workbench.createSnapshot() });
    window.history.replaceState({ __TSR_index: 0 }, "", "/");
    expect(await second.workbench.start(browser())).toMatchObject({
      status: "applied",
      value: { document: { id: a.id } },
    });
    expect(window.location.pathname).toBe("/documents/A");
    expect(second.workbench.getDocuments()).toHaveLength(1);
    expect(second.homeLoads).not.toHaveBeenCalled();
  });

  it("reuses a retained document when traversing an older empty-home anchor", async () => {
    window.history.replaceState({ __TSR_index: 0 }, "", "/");
    const { workbench, open, homeLoads } = setup();
    await workbench.start(browser());
    const a = await open("A");
    window.history.back();
    await vi.waitFor(() => expect(window.history.state["worksplit:home"].index).toBe(0));
    await vi.waitFor(() => expect(window.location.pathname).toBe("/documents/A"));
    expect(workbench.getActiveDocument()?.id).toBe(a.id);
    expect(workbench.getDocuments()).toHaveLength(1);
    expect(homeLoads).not.toHaveBeenCalled();
  });

  it("keeps a truly empty workspace empty after final close and browser Back/Forward", async () => {
    window.history.replaceState({ __TSR_index: 0 }, "", "/");
    const { workbench, open, homeLoads } = setup();
    await workbench.start(browser());
    const a = await open("A");
    expect((await workbench.close(a.id)).status).toBe("applied");
    expect(window.location.pathname).toBe("/");
    window.history.back();
    await vi.waitFor(() => expect(window.history.state["worksplit:home"].index).toBe(0));
    window.history.forward();
    await vi.waitFor(() => expect(window.history.state["worksplit:home"].index).toBe(1));
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(workbench.getActiveDocument()).toBeNull();
    expect(homeLoads).not.toHaveBeenCalled();
  });

  it("shares a pending restored initialization between identical start calls", async () => {
    const first = setup();
    await first.workbench.start();
    const a = await first.open("A");
    const gate = deferred();
    const load = vi.fn<() => Promise<void>>(() => gate.promise);
    const second = setup({ snapshot: first.workbench.createSnapshot(), load });
    const pending = second.workbench.start();
    expect(second.workbench.start()).toBe(pending);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await integrationState(second.workbench).loadDocument(
      second.workbench.getDocument(a.id)!.handle,
    );
    expect(load).toHaveBeenCalledTimes(1);
    gate.resolve();
    expect((await pending).status).toBe("applied");
  });
});
