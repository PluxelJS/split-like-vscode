import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { Actions, DockLocation, TabSetNode } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beside,
  createLayoutPolicy,
  createWorkbench,
  getLayoutTopology,
  type ContentController,
  type OpenOptions,
  type WorkbenchInstance,
  type WorkbenchOptions,
} from "./index";
import { integrationState } from "./internal";
/* eslint-disable no-await-in-loop -- Native scenarios and resource teardown deliberately run in order. */
import type { LeaveDecision } from "./types";

const instances: WorkbenchInstance<AnyRouter>[] = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.dispose();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const nav = (id: string) => ({ to: "/documents/$id" as const, params: { id } });
async function setup(
  settings: Pick<WorkbenchOptions<AnyRouter>, "layoutPolicy" | "allowDrop" | "tools"> = {},
  loader: (id: string) => void | Promise<void> = () => {},
) {
  const root = createRootRoute();
  const tree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: "/documents/$id",
      loader: ({ params }) => loader(params.id),
    }),
  ]);
  const workbench = createWorkbench({
    ...settings,
    createRouter: (history) => createRouter({ routeTree: tree, history, defaultPendingMinMs: 0 }),
  });
  instances.push(workbench);
  await workbench.start();
  const open = async (id: string, options: OpenOptions = {}) => {
    const result = await workbench.open(nav(id), options);
    if (result.status !== "applied") throw new Error(JSON.stringify(result));
    return result.value.document;
  };
  const own = (id: string, controller: ContentController) =>
    integrationState(workbench).registerController(workbench.getContent(id)!.handle, {
      controller,
    });
  return { workbench, open, own };
}

describe("native document destinations and presentation", () => {
  it("creates a requested split ratio, then reuses its nearest native sibling without resizing", async () => {
    const { workbench, open } = await setup();
    const a = await open("A");
    const b = await open("B", {
      source: a.handle,
      destination: beside({ direction: DockLocation.BOTTOM, ratio: 0.35 }),
    });
    const source = workbench.model.getNodeById(a.containerId!) as TabSetNode,
      detail = workbench.model.getNodeById(b.containerId!) as TabSetNode;
    expect(detail.getWeight() / (source.getWeight() + detail.getWeight())).toBeCloseTo(0.35);
    const weights = [source.getWeight(), detail.getWeight()];
    await workbench.activate(a.id);
    const c = await open("C", {
      source: a.handle,
      presentation: "reveal",
      destination: beside({ direction: DockLocation.BOTTOM, ratio: 0.2 }),
    });
    expect(c.containerId).toBe(b.containerId);
    expect(getLayoutTopology(workbench.model)).toEqual({ rows: 2, columns: 1, tabsets: 2 });
    expect([source.getWeight(), detail.getWeight()]).toEqual(weights);
    expect(workbench.getActiveDocument()?.id).toBe(a.id);
  });
  it("honors actual native branch order rather than MRU when resolving beside", async () => {
    const { workbench, open } = await setup();
    const a = await open("A");
    const b = await open("B", {
      source: a.handle,
      destination: { target: a.containerId!, location: DockLocation.RIGHT },
    });
    const c = await open("C", {
      source: b.handle,
      destination: { target: b.containerId!, location: DockLocation.RIGHT },
    });
    await workbench.activate(c.id);
    await workbench.activate(a.id);
    const result = await open("D", {
      source: a.handle,
      destination: beside({ direction: DockLocation.RIGHT }),
    });
    expect(result.containerId).toBe(b.containerId);
    expect(getLayoutTopology(workbench.model).tabsets).toBe(3);
  });
  it("keeps a dirty preview in the selected sibling and never uses dirtiness as spatial ordering", async () => {
    const { workbench, open, own } = await setup();
    const a = await open("A");
    const b = await open("B", {
      source: a.handle,
      preview: true,
      destination: beside({ direction: DockLocation.RIGHT }),
    });
    const decide = vi.fn<() => LeaveDecision>(() => ({ decision: "deny" as const }));
    own(b.id, { leave: { getState: () => ({ hasUnsavedChanges: true, token: 7 }), decide } });
    const c = await open("C", {
      source: a.handle,
      preview: true,
      destination: beside({ direction: DockLocation.RIGHT }),
    });
    expect(c.containerId).toBe(b.containerId);
    expect(workbench.getDocument(b.id)?.preview).toBe(false);
    expect(decide).not.toHaveBeenCalled();
  });
  it("lets a host resolver fall back after native policy refusal with one loader execution", async () => {
    const loads = vi.fn<() => void>();
    const { open } = await setup({ layoutPolicy: createLayoutPolicy({ maxTabsets: 1 }) }, loads);
    const a = await open("A");
    loads.mockClear();
    const result = await open("B", {
      source: a.handle,
      destination: (context) =>
        beside({ direction: DockLocation.RIGHT })(context) ?? context.defaultDestination,
    });
    expect(result.containerId).toBe(a.containerId);
    expect(loads).toHaveBeenCalledOnce();
  });
  it("refuses a policy-limited split without adding nodes or promoting the existing preview", async () => {
    const { workbench, open } = await setup({
      layoutPolicy: createLayoutPolicy({ maxTabsets: 1 }),
    });
    await open("A", { preview: true });
    const before = workbench.createSnapshot();
    expect(
      await workbench.open(nav("B"), {
        preview: true,
        destination: beside({ direction: DockLocation.RIGHT }),
      }),
    ).toMatchObject({ status: "denied", reason: "layout-policy" });
    expect(workbench.createSnapshot()).toEqual(before);
  });
  it.each(["move", "close"] as const)(
    "does not follow a captured source after it is %s during loading",
    async (operation) => {
      const slow = deferred();
      const { workbench, open } = await setup({}, (id) =>
        id === "slow" ? slow.promise : undefined,
      );
      const a = await open("A");
      const b = await open("B", {
        destination: { target: a.containerId!, location: DockLocation.RIGHT },
      });
      const pending = workbench.open(nav("slow"), {
        source: a.handle,
        destination: beside({ direction: DockLocation.BOTTOM }),
      });
      if (operation === "move")
        await workbench.dispatch(Actions.moveNode(a.id, b.containerId!, DockLocation.CENTER, -1));
      else await workbench.close(a.id);
      slow.resolve();
      expect((await pending).status).toBe("superseded");
      expect(workbench.getDocuments().some((doc) => doc.href.includes("slow"))).toBe(false);
    },
  );
  it("admits a direct edge document with a single native ADD and retains native identity", async () => {
    const { workbench, open } = await setup();
    const a = await open("A");
    const original = a.node;
    const actions: string[] = [];
    workbench.model.addChangeListener((action) => actions.push(action.type));
    const b = await open("B", {
      destination: { target: a.containerId!, location: DockLocation.RIGHT },
    });
    expect(actions.filter((type) => type === Actions.ADD_TAB)).toHaveLength(1);
    expect(actions).not.toContain(Actions.MOVE_NODE);
    expect(workbench.getDocument(a.id)?.node).toBe(original);
    expect(b.containerId).not.toBe(a.containerId);
  });
  it("captures default placement before loading and admits only in background after activity changes", async () => {
    const slow = deferred();
    const { workbench, open } = await setup({}, (id) => (id === "slow" ? slow.promise : undefined));
    const a = await open("A");
    const b = await open("B", {
      destination: { target: a.containerId!, location: DockLocation.RIGHT },
    });
    await workbench.activate(a.id);
    const pending = workbench.open(nav("slow"));
    await workbench.activate(b.id);
    slow.resolve();
    const result = await pending;
    expect(result).toMatchObject({
      status: "applied",
      value: { presentation: "background", document: { containerId: a.containerId } },
    });
    expect(workbench.getActiveDocument()?.id).toBe(b.id);
    expect(a.node.isSelected()).toBe(true);
  });
  it("rejects a removed explicit target and changed explicit insertion index before admission", async () => {
    const slow = deferred();
    const { workbench, open } = await setup({}, (id) => (id === "slow" ? slow.promise : undefined));
    const a = await open("A");
    const b = await open("B", {
      destination: { target: a.containerId!, location: DockLocation.RIGHT },
    });
    const pending = workbench.open(nav("slow"), {
      source: a.handle,
      destination: { target: b.containerId!, location: DockLocation.CENTER, index: 0 },
    });
    await workbench.close(b.id);
    slow.resolve();
    expect((await pending).status).toBe("superseded");
    expect(workbench.getDocuments()).toHaveLength(1);
  });
  it("reuses an accepted identity before evaluating a new placement resolver", async () => {
    const { open } = await setup();
    const a = await open("A");
    const placement = vi.fn<() => null>(() => null);
    const reused = await open("A", { destination: placement });
    expect(reused.handle).toBe(a.handle);
    expect(placement).not.toHaveBeenCalled();
  });
  it("reveals a separate copy without replacing source activity or actual focus", async () => {
    const { workbench, open } = await setup();
    const a = await open("A");
    integrationState(workbench).focus(a.id, "content");
    const result = await workbench.duplicate(a.id, {
      source: a.handle,
      presentation: "reveal",
      destination: beside({ direction: DockLocation.RIGHT }),
    });
    expect(result).toMatchObject({
      status: "applied",
      value: { reused: false, presentation: "reveal" },
    });
    expect(workbench.getActiveDocument()?.handle).toBe(a.handle);
    expect(workbench.getContext().focusedContentId).toBe(a.id);
    expect(workbench.getDocuments()).toHaveLength(2);
  });
  it("refuses reveal without an independent source, in the source container, or under maximization", async () => {
    const { workbench, open } = await setup();
    expect((await workbench.open(nav("A"), { presentation: "reveal" })).status).toBe("denied");
    const a = await open("A");
    const b = await open("B", { destination: beside({ direction: DockLocation.RIGHT }) });
    await workbench.activate(a.id);
    expect(await workbench.open(nav("A"), { presentation: "reveal" })).toMatchObject({
      status: "denied",
      reason: "focus-conflict",
    });
    await workbench.dispatch(Actions.maximizeToggle(a.containerId!));
    expect(
      await workbench.open(nav("B"), { source: a.handle, presentation: "reveal" }),
    ).toMatchObject({ status: "denied", reason: "focus-conflict" });
    expect(workbench.model.getMaximizedTabset()?.getId()).toBe(a.containerId);
    expect(workbench.getDocument(b.id)).not.toBeNull();
  });
  it("does not reclaim source or selection when reveal loses foreground eligibility", async () => {
    const slow = deferred();
    const { workbench, open } = await setup({}, (id) => (id === "slow" ? slow.promise : undefined));
    const a = await open("A");
    const b = await open("B", { destination: beside({ direction: DockLocation.RIGHT }) });
    await workbench.activate(a.id);
    const pending = workbench.open(nav("slow"), {
      source: a.handle,
      presentation: "reveal",
      destination: beside({ direction: DockLocation.RIGHT }),
    });
    await workbench.activate(b.id);
    slow.resolve();
    expect((await pending).status).toBe("superseded");
    expect(workbench.getActiveDocument()?.id).toBe(b.id);
    expect(workbench.getDocuments()).toHaveLength(2);
  });
  it("rejects background into an empty or new split while preserving the existing selection", async () => {
    const { workbench, open } = await setup();
    const a = await open("A");
    expect(
      (
        await workbench.open(nav("B"), {
          presentation: "background",
          destination: beside({ direction: DockLocation.RIGHT }),
        })
      ).status,
    ).toBe("denied");
    expect(workbench.getActiveDocument()?.id).toBe(a.id);
    expect(a.node.isSelected()).toBe(true);
  });
  it("uses the currently captured container for a center preview with container-scoped replacement", async () => {
    const { workbench, open } = await setup();
    const a = await open("A", { preview: true });
    const b = await open("B", { destination: beside({ direction: DockLocation.RIGHT }) });
    const c = await open("C", { preview: true });
    expect(c.containerId).toBe(b.containerId);
    expect(workbench.getDocument(a.id)?.preview).toBe(true);
  });
  it("allows an independent edge pane from a focused tool without hiding or focusing the tool", async () => {
    const { workbench, open } = await setup({ tools: { inspector: { render: () => null } } });
    const a = await open("A");
    await workbench.dispatch(
      Actions.addTab(
        { id: "inspector", component: "inspector" },
        a.containerId!,
        DockLocation.CENTER,
        -1,
      ),
    );
    const tool = workbench.getContent("inspector")!;
    integrationState(workbench).focus(tool.id, "content");
    expect(
      (await workbench.open(nav("B"), { source: tool.handle, presentation: "reveal" })).status,
    ).toBe("denied");
    const b = await open("B", {
      source: tool.handle,
      presentation: "reveal",
      destination: beside({ direction: DockLocation.RIGHT }),
    });
    expect(b.containerId).not.toBe(tool.containerId);
    expect(tool.node.isSelected()).toBe(true);
    expect(workbench.getContext().source).toBe(tool.handle);
  });
});
