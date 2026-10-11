import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type AnyRouter,
} from "@tanstack/react-router";
import { Actions, DockLocation } from "flexlayout-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkbench,
  type WorkbenchInstance,
  type WorkbenchOptions,
  type WorkbenchSnapshot,
} from "./index";
import { integrationState } from "./integration";

const instances: WorkbenchInstance<AnyRouter>[] = [];
const releaseGates: (() => void)[] = [];
beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(async () => {
  releaseGates.splice(0).forEach((release) => release());
  await Promise.all(instances.splice(0).map((w) => w.dispose()));
  window.history.replaceState(null, "", "/");
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  releaseGates.push(resolve);
  return { promise, resolve };
}
const nav = (id: string) => ({ to: "/documents/$id" as const, params: { id } });
function setup(
  options: Pick<WorkbenchOptions<AnyRouter>, "homeMode" | "home" | "workspaceId"> = {
    homeMode: "empty",
  },
  load: (id: string) => void | Promise<void> = () => {},
  snapshot?: WorkbenchSnapshot,
) {
  const root = createRootRoute();
  const homeLoads = vi.fn<() => void>();
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    beforeLoad: () => {
      homeLoads();
      throw redirect(nav("welcome"));
    },
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    loader: ({ params }) => load(params.id),
  });
  const routeTree = root.addChildren([home, page]);
  const onIssue = vi.fn<(issue: unknown) => void>();
  const workbench = createWorkbench({
    ...options,
    ...(snapshot ? { snapshot } : {}),
    createRouter: (history) => createRouter({ routeTree, history, defaultPendingMinMs: 0 }),
    onIssue,
  });
  instances.push(workbench);
  const open = async (id: string) => {
    const result = await workbench.open(nav(id));
    if (result.status !== "committed") throw new Error(result.status);
    return result.document;
  };
  return { workbench, open, homeLoads, onIssue, internal: integrationState(workbench) };
}
async function traverse(delta: number) {
  const popped = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  window.history.go(delta);
  await popped;
}

describe("document-free workspace home", () => {
  it("accepts empty home without routing and leaves ordinary open routing unchanged", async () => {
    const { workbench, homeLoads } = setup();
    workbench.connectBrowser();
    expect(await workbench.start("/")).toEqual({ status: "empty", href: "/" });
    expect(workbench.getDocuments()).toEqual([]);
    expect(homeLoads).not.toHaveBeenCalled();
    const result = await workbench.open({ to: "/" });
    expect(result).toMatchObject({ status: "committed", document: { href: "/documents/welcome" } });
    expect(homeLoads).toHaveBeenCalledTimes(1);
  });

  it("keeps the default homepage route and redirect semantics", async () => {
    const { workbench, homeLoads } = setup({});
    expect(await workbench.start("/")).toMatchObject({
      status: "committed",
      document: { href: "/documents/welcome" },
    });
    expect(homeLoads).toHaveBeenCalledTimes(1);
  });

  it("matches the configured home exactly and routes other addresses normally", async () => {
    const { workbench } = setup({ homeMode: "empty", home: "/workspace" });
    expect(await workbench.start("/workspace")).toEqual({ status: "empty", href: "/workspace" });
    expect((await workbench.start("/")).status).toBe("committed");
  });

  it("normalizes an old empty home history anchor to the active retained document", async () => {
    const { workbench, open, homeLoads } = setup();
    workbench.connectBrowser();
    await workbench.start("/");
    const a = await open("A");
    await traverse(-1);
    await vi.waitFor(() => expect(window.location.pathname).toBe("/documents/A"));
    expect(workbench.getDocuments()).toMatchObject([{ id: a.id }]);
    expect(workbench.getActiveDocument()?.id).toBe(a.id);
    expect(homeLoads).not.toHaveBeenCalled();
    await traverse(1);
    await vi.waitFor(() => expect(window.location.pathname).toBe("/documents/A"));
    expect(workbench.getDocuments()).toHaveLength(1);
  });

  it("preserves true emptiness through closing the final tab and Back/Forward", async () => {
    const { workbench, open, homeLoads } = setup();
    workbench.connectBrowser();
    await workbench.start("/");
    const a = await open("A");
    await workbench.close(a.id);
    expect(window.location.pathname).toBe("/");
    await traverse(-1);
    await vi.waitFor(() => expect(workbench.getDocuments()).toHaveLength(0));
    await traverse(1);
    await vi.waitFor(() => expect(workbench.getActiveDocument()).toBeNull());
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(homeLoads).not.toHaveBeenCalled();
    expect(await workbench.start("/")).toEqual({ status: "empty", href: "/" });
  });

  it("restores the native selected document at home without manufacturing another tab", async () => {
    const first = setup();
    const a = await first.open("A");
    const b = await first.open("B");
    await first.workbench.dispatch(Actions.moveNode(b.id, a.containerId, DockLocation.RIGHT, -1));
    first.workbench.activate(b.id);
    const second = setup(undefined, undefined, first.workbench.snapshot());
    second.workbench.connectBrowser();
    expect(await second.workbench.start("/")).toMatchObject({
      status: "committed",
      reused: true,
      document: { id: b.id },
    });
    expect(window.location.pathname).toBe("/documents/B");
    expect(second.workbench.getDocuments()).toHaveLength(2);
    expect(second.homeLoads).not.toHaveBeenCalled();
  });

  it("revokes an older foreground admission but allows an explicitly background admission to settle", async () => {
    const gate = deferred();
    const { workbench } = setup(undefined, () => gate.promise);
    const foreground = workbench.open(nav("A"));
    const background = workbench.open(nav("B"), { background: true });
    expect(await workbench.start("/")).toEqual({ status: "empty", href: "/" });
    gate.resolve();
    expect(await foreground).toEqual({ status: "superseded" });
    expect(await background).toMatchObject({
      status: "committed",
      document: { href: "/documents/B" },
    });
    expect(workbench.getActiveDocument()).toBeNull();
    expect(workbench.getDocuments()).toHaveLength(1);
  });

  it("does not steal tool or shell focus after a restored home target finishes loading", async () => {
    const first = setup();
    const a = await first.open("A");
    const gate = deferred();
    const second = setup(undefined, () => gate.promise, first.workbench.snapshot());
    const starting = second.workbench.start("/");
    second.internal.focus(null, "shell");
    gate.resolve();
    expect(await starting).toEqual({ status: "superseded" });
    expect(second.workbench.getEditingContext()).toMatchObject({
      activeTabId: null,
      focusedArea: "shell",
    });
    expect(second.workbench.getDocuments()).toMatchObject([{ id: a.id }]);
  });

  it("does not overwrite a newer foreground navigation while restored home is loading", async () => {
    const first = setup();
    await first.open("A");
    const gate = deferred();
    const second = setup(
      undefined,
      (id) => (id === "A" ? gate.promise : undefined),
      first.workbench.snapshot(),
    );
    second.workbench.connectBrowser();
    const starting = second.workbench.start("/");
    const b = await second.open("B");
    gate.resolve();
    expect(await starting).toEqual({ status: "superseded" });
    expect(second.workbench.getActiveDocument()?.id).toBe(b.id);
    expect(window.location.pathname).toBe("/documents/B");
  });

  it("refuses startup while history traversal owns an outstanding target", async () => {
    const gate = deferred();
    let slow = false;
    const { workbench, open } = setup(undefined, (id) =>
      slow && id === "A" ? gate.promise : undefined,
    );
    workbench.connectBrowser();
    await workbench.start("/");
    const a = await open("A");
    await open("B");
    await workbench.close(a.id);
    slow = true;
    await traverse(-1);
    expect(await workbench.start("/")).toEqual({ status: "rejected", reason: "history-busy" });
    gate.resolve();
    await vi.waitFor(() => expect(workbench.getActiveDocument()?.href).toBe("/documents/A"));
  });

  it("honors a live document hint even when its routed address equals the configured home", async () => {
    const { workbench, open } = setup({ homeMode: "empty", home: "/documents/A" });
    workbench.connectBrowser();
    expect(await workbench.start("/documents/A")).toEqual({
      status: "empty",
      href: "/documents/A",
    });
    const a = await open("A");
    await open("B");
    await traverse(-1);
    await vi.waitFor(() => expect(workbench.getActiveDocument()?.id).toBe(a.id));
    expect(window.location.pathname).toBe("/documents/A");
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("awaits a restored Router already loading through its visible content binding", async () => {
    const first = setup();
    const a = await first.open("A");
    const gate = deferred();
    const second = setup(undefined, () => gate.promise, first.workbench.snapshot());
    const loading = second.internal.loadDocument(a.id);
    let settled = false;
    const starting = second.workbench.start("/").then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve();
    await loading;
    expect(await starting).toMatchObject({
      status: "committed",
      reused: true,
      document: { id: a.id },
    });
  });

  it("does not handle home entries outside its owned history scope", async () => {
    const { workbench, open, onIssue, homeLoads } = setup();
    workbench.connectBrowser();
    await workbench.start("/");
    const a = await open("A");
    window.history.pushState(
      { "worksplit:default": { scope: "another-workspace", index: 0 } },
      "",
      "/",
    );
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    expect(onIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: "history-outside-scope" }),
    );
    expect(workbench.getActiveDocument()?.id).toBe(a.id);
    expect(homeLoads).not.toHaveBeenCalled();
  });
});
