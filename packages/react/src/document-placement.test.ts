import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { Actions, DockLocation, TabSetNode, type Action } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLayoutPolicy,
  createWorkbench,
  getLayoutTopology,
  type OpenDocumentOptions,
  type WorkbenchInstance,
  type WorkbenchOptions,
} from "./index";
import { integrationState } from "./integration";

const instances: WorkbenchInstance<AnyRouter>[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((w) => w.dispose()));
  window.history.replaceState(null, "", "/");
});
const nav = (id: string, view = "edit") => ({
  to: "/documents/$id" as const,
  params: { id },
  search: { view },
});

function setup(
  options: Pick<WorkbenchOptions<AnyRouter>, "layoutPolicy" | "allowDrop" | "tools"> = {},
  loader: (id: string) => void | Promise<void> = () => {},
) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    validateSearch: (s: Record<string, unknown>) => ({
      view: typeof s.view === "string" ? s.view : "edit",
    }),
    loader: ({ params }) => loader(params.id),
  });
  const routeTree = root.addChildren([route]);
  const workbench = createWorkbench({
    ...options,
    createRouter: (history) => createRouter({ routeTree, history, defaultPendingMinMs: 0 }),
  });
  instances.push(workbench);
  const open = async (id: string, placement: OpenDocumentOptions = {}) => {
    const result = await workbench.open(nav(id), placement);
    if (result.status !== "committed") throw new Error(result.status);
    return result.document;
  };
  return { workbench, open, internal: integrationState(workbench) };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("routed document placement", () => {
  it("uses native tab admission, then reuses a split without resizing or creating another pane", async () => {
    const { workbench, open, internal } = setup();
    const a = await open("A", { placement: { mode: "tab" } });
    const b = await open("B", { placement: { mode: "split", source: a.id } });
    expect(getLayoutTopology(internal.model)).toEqual({ rows: 2, columns: 1, tabsets: 2 });
    const source = internal.model.getNodeById(a.containerId) as TabSetNode;
    const detail = internal.model.getNodeById(b.containerId) as TabSetNode;
    expect(detail.getWeight() / (source.getWeight() + detail.getWeight())).toBeCloseTo(0.35);
    const weights = [source.getWeight(), detail.getWeight()];
    workbench.activate(a.id);
    const c = await open("C", {
      placement: { mode: "split", source: a.id, direction: DockLocation.RIGHT, ratio: 0.2 },
      preserveFocus: true,
    });
    expect(c.containerId).toBe(b.containerId);
    expect(getLayoutTopology(internal.model)).toEqual({ rows: 2, columns: 1, tabsets: 2 });
    expect([source.getWeight(), detail.getWeight()]).toEqual(weights);
    expect(workbench.getActiveDocument()?.id).toBe(a.id);
    const tab = await open("D", { placement: { mode: "tab", source: b.id } });
    expect(tab.containerId).toBe(b.containerId);
  });

  it("falls back through native layout policy without repeating the route load", async () => {
    const loader = vi.fn<(id: string) => void>();
    const { workbench, open, internal } = setup(
      { layoutPolicy: createLayoutPolicy({ maxRows: 1, maxColumns: 2 }) },
      loader,
    );
    const a = await open("A");
    const b = await open("B", { placement: { mode: "split", source: a.id, ratio: 0.4 } });
    expect(loader.mock.calls.filter(([id]) => id === "B")).toHaveLength(1);
    expect(getLayoutTopology(internal.model)).toEqual({ rows: 1, columns: 2, tabsets: 2 });
    const source = internal.model.getNodeById(a.containerId) as TabSetNode;
    const detail = internal.model.getNodeById(b.containerId) as TabSetNode;
    expect(detail.getWeight() / (source.getWeight() + detail.getWeight())).toBeCloseTo(0.4);
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("prefers a safe preview over MRU within the requested direction, retaining dirty content", async () => {
    const { workbench, open, internal } = setup();
    const a = await open("A");
    const preview = await open("B", { preview: true, location: DockLocation.RIGHT });
    internal.register(preview.id, { isDirty: () => true });
    const recent = await open("C", { target: preview.containerId, location: DockLocation.BOTTOM });
    workbench.activate(a.id);
    const next = await open("D", {
      preview: true,
      placement: { mode: "split", source: a.id, direction: DockLocation.RIGHT },
    });
    expect(next.containerId).toBe(preview.containerId);
    expect(next.containerId).not.toBe(recent.containerId);
    expect(workbench.getDocument(preview.id)?.preview).toBe(false);
    expect(getLayoutTopology(internal.model).tabsets).toBe(3);
  });

  it("honors direction with three panes instead of always reusing the most recent pane", async () => {
    const { workbench, open, internal } = setup({
      layoutPolicy: createLayoutPolicy({ maxRows: 2, maxColumns: 2, maxTabsets: 4 }),
    });
    const a = await open("A");
    const right = await open("B", { target: a.containerId, location: DockLocation.RIGHT });
    const below = await open("C", { target: a.containerId, location: DockLocation.BOTTOM });
    workbench.activate(right.id);
    workbench.activate(a.id);
    const lower = await open("D", {
      placement: { mode: "split", source: a.id },
      preserveFocus: true,
    });
    expect(lower.containerId).toBe(below.containerId);
    const next = await open("E", {
      placement: { mode: "split", source: a.id, direction: DockLocation.RIGHT },
      preserveFocus: true,
    });
    expect(next.containerId).toBe(right.containerId);
    expect(getLayoutTopology(internal.model)).toEqual({ rows: 2, columns: 2, tabsets: 3 });
  });

  it("adds a directional fourth pane within the native limit", async () => {
    const loader = vi.fn<(id: string) => void>();
    const { workbench, open, internal } = setup(
      { layoutPolicy: createLayoutPolicy({ maxRows: 2, maxColumns: 2, maxTabsets: 4 }) },
      loader,
    );
    const a = await open("A");
    const right = await open("B", { target: a.containerId, location: DockLocation.RIGHT });
    const lowerLeft = await open("C", { target: a.containerId, location: DockLocation.BOTTOM });
    workbench.activate(right.id);
    const next = await open("D", {
      placement: { mode: "split", source: right.id, ratio: 0.4 },
      preserveFocus: true,
    });
    expect(loader.mock.calls.filter(([id]) => id === "D")).toHaveLength(1);
    expect(getLayoutTopology(internal.model)).toEqual({ rows: 2, columns: 2, tabsets: 4 });
    expect([a.containerId, right.containerId, lowerLeft.containerId]).not.toContain(
      next.containerId,
    );
    const source = internal.model.getNodeById(right.containerId) as TabSetNode;
    const detail = internal.model.getNodeById(next.containerId) as TabSetNode;
    expect(detail.getWeight() / (source.getWeight() + detail.getWeight())).toBeCloseTo(0.4);
    expect(workbench.getActiveDocument()?.id).toBe(right.id);
  });

  it("safely reuses a pane when the native limit rejects both split directions", async () => {
    const loader = vi.fn<(id: string) => void>();
    const { workbench, open, internal } = setup(
      { layoutPolicy: createLayoutPolicy({ maxRows: 2, maxColumns: 2, maxTabsets: 3 }) },
      loader,
    );
    const a = await open("A");
    const right = await open("B", { target: a.containerId, location: DockLocation.RIGHT });
    const lowerLeft = await open("C", { target: a.containerId, location: DockLocation.BOTTOM });
    workbench.activate(right.id);
    const next = await open("D", {
      placement: { mode: "split", source: right.id, ratio: 0.4 },
      preserveFocus: true,
    });
    expect(loader.mock.calls.filter(([id]) => id === "D")).toHaveLength(1);
    expect(getLayoutTopology(internal.model)).toEqual({ rows: 2, columns: 2, tabsets: 3 });
    expect(next.containerId).toBe(lowerLeft.containerId);
    expect(workbench.getActiveDocument()?.id).toBe(right.id);
  });

  it("uses direction with four panes and falls back safely without creating a fifth", async () => {
    const { workbench, open, internal } = setup({
      layoutPolicy: createLayoutPolicy({ maxRows: 2, maxColumns: 2, maxTabsets: 4 }),
    });
    const a = await open("A");
    const upperRight = await open("B", { target: a.containerId, location: DockLocation.RIGHT });
    const lowerLeft = await open("C", { target: a.containerId, location: DockLocation.BOTTOM });
    const lowerRight = await open("D", {
      target: upperRight.containerId,
      location: DockLocation.BOTTOM,
    });
    workbench.activate(lowerLeft.id);
    workbench.activate(lowerRight.id);
    const above = await open("E", {
      placement: { mode: "split", source: lowerRight.id, direction: DockLocation.TOP },
      preserveFocus: true,
    });
    expect(above.containerId).toBe(upperRight.containerId);
    const fallback = await open("F", {
      placement: { mode: "split", source: lowerRight.id, direction: DockLocation.BOTTOM },
      preserveFocus: true,
    });
    expect(fallback.containerId).toBe(lowerLeft.containerId);
    expect(getLayoutTopology(internal.model)).toEqual({ rows: 2, columns: 2, tabsets: 4 });
  });

  it("rejects a split when the only other pane contains the focused tool", async () => {
    const { workbench, open, internal } = setup({
      tools: [{ id: "inspector", render: () => null }],
    });
    const a = await open("A");
    const b = await open("B", { location: DockLocation.RIGHT });
    workbench.activate(a.id);
    await workbench.dispatch(
      Actions.addTab(
        { id: "inspector", component: "worksplit.tool" },
        b.containerId,
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    internal.focus("inspector", "tool");
    const before = workbench.snapshot();
    expect(await workbench.open(nav("C"), { placement: { mode: "split", source: a.id } })).toEqual({
      status: "rejected",
      reason: "focus-conflict",
    });
    expect(
      await workbench.open(nav("D"), {
        placement: { mode: "split", source: "inspector" },
        preserveFocus: true,
      }),
    ).toEqual({ status: "rejected", reason: "focus-conflict" });
    expect(workbench.snapshot()).toEqual(before);
  });

  it.each(["move", "close"] as const)(
    "does not admit a delayed document after its placement source is %s",
    async (change) => {
      const gate = deferred();
      const { workbench, open } = setup({}, (id) => (id === "C" ? gate.promise : undefined));
      const a = await open("A");
      const b = await open("B", { location: DockLocation.RIGHT });
      const pending = workbench.open(nav("C"), { placement: { mode: "split", source: a.id } });
      if (change === "move")
        await workbench.dispatch(Actions.moveNode(a.id, b.containerId, DockLocation.CENTER, -1));
      else await workbench.close(a.id);
      gate.resolve();
      expect(await pending).toEqual({ status: "superseded" });
      expect(workbench.getDocuments().some((document) => document.href.includes("/C"))).toBe(false);
    },
  );

  it("rejects mixed placement options before loading", async () => {
    const loader = vi.fn<(id: string) => void>();
    const { workbench, open } = setup({}, loader);
    const a = await open("A");
    const before = workbench.snapshot();
    expect(
      await workbench.open(nav("B"), {
        placement: { mode: "split", source: a.id },
        target: a.containerId,
      }),
    ).toMatchObject({ status: "failed", stage: "load" });
    expect(loader.mock.calls.filter(([id]) => id === "B")).toHaveLength(0);
    expect(workbench.snapshot()).toEqual(before);
  });

  it("admits directly beside the captured document with one native insertion and projects its container", async () => {
    const { workbench, open, internal } = setup();
    const a = await open("A");
    const observe = vi.fn<(action: Action) => void>();
    internal.model.addChangeListener(observe);
    const b = await open("B", { target: a.containerId, location: DockLocation.RIGHT });
    expect(b.containerId).not.toBe(a.containerId);
    expect(observe.mock.calls.filter(([action]) => action.type === Actions.ADD_TAB)).toHaveLength(
      1,
    );
    expect(observe.mock.calls.filter(([action]) => action.type === Actions.MOVE_NODE)).toHaveLength(
      0,
    );
    await workbench.dispatch(Actions.addTabToNewGroup(b.id, "Group", "red"));
    expect(workbench.getDocument(b.id)?.containerId).toBe(b.containerId);
  });

  it("rejects over-limit admission before native mutation or preview promotion", async () => {
    const { workbench, open } = setup({ layoutPolicy: createLayoutPolicy({ maxColumns: 1 }) });
    const a = await open("A", { preview: true });
    const before = workbench.snapshot();
    expect(await workbench.open(nav("B"), { preview: true, location: DockLocation.RIGHT })).toEqual(
      { status: "rejected", reason: "layout-policy" },
    );
    expect(workbench.snapshot()).toEqual(before);
    expect(workbench.getDocument(a.id)?.preview).toBe(true);
  });

  it.each(["ordinary", "retained", "non-closeable"] as const)(
    "restores native weights and containers after custom policy rejects a %s split",
    async (defaults) => {
      let reject = false;
      const { workbench, open, internal } = setup({
        allowDrop: (_tabs, _target, location) => !(reject && location === DockLocation.RIGHT),
      });
      const a = await open("A");
      await open("B", { location: DockLocation.RIGHT });
      if (defaults === "retained")
        internal.model.setOnCreateTabSet(() => ({ enableDeleteWhenEmpty: false }));
      if (defaults === "non-closeable")
        internal.model.setOnCreateTabSet(() => ({ enableClose: false }));
      const before = workbench.getLayout();
      reject = true;
      const result = await workbench.open(nav("C"), {
        target: a.containerId,
        location: DockLocation.RIGHT,
      });
      expect(result.status).toBe("failed");
      expect(workbench.getLayout()).toEqual(before);
      expect(workbench.getDocuments()).toHaveLength(2);
    },
  );

  it("captures default placement before loading rather than following a later active group", async () => {
    const gate = deferred();
    const { workbench, open } = setup({}, (id) => (id === "C" ? gate.promise : undefined));
    const a = await open("A");
    const b = await open("B", { location: DockLocation.RIGHT });
    workbench.activate(a.id);
    const pending = workbench.open(nav("C"));
    workbench.activate(b.id);
    gate.resolve();
    expect(await pending).toMatchObject({
      status: "committed",
      document: { containerId: a.containerId },
    });
    expect(workbench.getActiveDocument()?.id).toBe(b.id);
  });

  it("fails if the captured target was removed while loading", async () => {
    const gate = deferred();
    const { workbench, open } = setup({}, (id) => (id === "C" ? gate.promise : undefined));
    const a = await open("A");
    await open("B", { location: DockLocation.RIGHT });
    workbench.activate(a.id);
    const pending = workbench.open(nav("C"));
    await workbench.close(a.id);
    gate.resolve();
    expect((await pending).status).toBe("failed");
    expect(workbench.getDocuments()).toHaveLength(1);
  });

  it("reuses existing identity without relocating it, despite a different requested edge", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B", { location: DockLocation.RIGHT });
    const result = await workbench.open(nav("A"), {
      target: b.containerId,
      location: DockLocation.BOTTOM,
    });
    expect(result).toMatchObject({
      status: "committed",
      reused: true,
      document: { id: a.id, containerId: a.containerId },
    });
    expect(workbench.getLayout().layout.children).toHaveLength(2);
  });

  it("reveals a separate document while retaining source URL, active document and focus eligibility", async () => {
    const { workbench, open, internal } = setup();
    workbench.connectBrowser();
    const a = await open("A", { preview: true });
    const focus = vi.fn<() => void>();
    internal.register(a.id, { focus });
    await Promise.resolve();
    focus.mockClear();
    await workbench.dispatch(Actions.maximizeToggle(a.containerId));
    const href = window.location.href;
    const b = await open("B", { location: DockLocation.RIGHT, preserveFocus: true, preview: true });
    expect(workbench.getActiveDocument()?.id).toBe(a.id);
    expect(window.location.href).toBe(href);
    expect(workbench.getDocument(a.id)?.preview).toBe(false);
    expect(internal.model.getMaximizedTabset()).toBeUndefined();
    expect(internal.model.getActiveTabset()?.getId()).toBe(a.containerId);
    expect(
      (internal.model.getNodeById(b.containerId) as TabSetNode).getSelectedNode()?.getId(),
    ).toBe(b.id);
    expect(focus).not.toHaveBeenCalled();
  });

  it("rejects same-container and source-navigation focus conflicts but permits preserved reuse", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    expect(await workbench.open(nav("B"), { preserveFocus: true })).toEqual({
      status: "rejected",
      reason: "focus-conflict",
    });
    expect(await workbench.open(nav("A", "compare"), { preserveFocus: true })).toEqual({
      status: "rejected",
      reason: "focus-conflict",
    });
    expect(
      await workbench.open(nav("A", "compare"), { preserveFocus: true, reuse: "preserve" }),
    ).toMatchObject({ status: "committed", document: { id: a.id, href: a.href } });
    expect(workbench.getDocuments()).toHaveLength(1);
  });

  it("does not restore prior source or selection after a preserveFocus request loses foreground eligibility", async () => {
    const gate = deferred();
    const { workbench, open, internal } = setup({}, (id) =>
      id === "C" ? gate.promise : undefined,
    );
    const a = await open("A");
    const b = await open("B", { location: DockLocation.RIGHT });
    workbench.activate(a.id);
    const pending = workbench.open(nav("C"), { target: b.containerId, preserveFocus: true });
    workbench.activate(b.id);
    gate.resolve();
    expect((await pending).status).toBe("committed");
    expect(workbench.getActiveDocument()?.id).toBe(b.id);
    expect(
      (internal.model.getNodeById(b.containerId) as TabSetNode).getSelectedNode()?.getId(),
    ).toBe(b.id);
  });

  it("retains replacement history semantics when revealing an exact existing document", async () => {
    const { workbench, open } = setup();
    workbench.connectBrowser();
    await open("A");
    await open("B");
    const entries = window.history.length;
    expect((await workbench.open(nav("A"))).status).toBe("committed");
    expect(window.history.length).toBe(entries);
    expect(window.location.pathname).toBe("/documents/A");
  });

  it("keeps both selections and source URL when a separate target refuses navigation", async () => {
    const { workbench, open, internal } = setup();
    workbench.connectBrowser();
    const a = await open("A");
    const b = await open("B", { location: DockLocation.RIGHT });
    const d = await open("D");
    workbench.activate(a.id);
    let approved = false;
    internal.register(b.id, { isDirty: () => true, beforeLeave: () => approved });
    const before = workbench.getLayout();
    const href = window.location.href;
    expect(await workbench.open(nav("B", "compare"), { preserveFocus: true })).toEqual({
      status: "rejected",
      reason: "decision",
    });
    expect(workbench.getLayout()).toEqual(before);
    expect(workbench.getActiveDocument()?.id).toBe(a.id);
    expect(
      (internal.model.getNodeById(b.containerId) as TabSetNode).getSelectedNode()?.getId(),
    ).toBe(d.id);
    expect(window.location.href).toBe(href);
    approved = true;
    expect((await workbench.open(nav("B", "compare"), { preserveFocus: true })).status).toBe(
      "committed",
    );
    expect(
      (internal.model.getNodeById(b.containerId) as TabSetNode).getSelectedNode()?.getId(),
    ).toBe(b.id);
    expect(workbench.getActiveDocument()?.id).toBe(a.id);
    expect(window.location.href).toBe(href);
  });

  it("rejects preserveFocus without a source or in combination with background", async () => {
    const { workbench, open } = setup();
    expect(await workbench.open(nav("A"), { preserveFocus: true })).toEqual({
      status: "rejected",
      reason: "focus-conflict",
    });
    await open("A");
    expect(await workbench.open(nav("B"), { preserveFocus: true, background: true })).toEqual({
      status: "rejected",
      reason: "focus-conflict",
    });
    expect(workbench.getDocuments()).toHaveLength(1);
  });

  it("uses the active container for an explicit center preview instead of inheriting the previous preview placement", async () => {
    const { workbench, open, internal } = setup();
    const a = await open("A", { preview: true });
    internal.register(a.id, { isDirty: () => true });
    const b = await open("B", { location: DockLocation.RIGHT });
    const c = await open("C", { preview: true, location: DockLocation.CENTER });
    expect(c.containerId).toBe(b.containerId);
    expect(workbench.getDocument(a.id)?.preview).toBe(false);
  });

  it.each(["new", "existing", "source"] as const)(
    "refuses %s center revelation that would hide a focused tool",
    async (kind) => {
      const { workbench, open, internal } = setup({
        tools: [{ id: "inspector", render: () => null }],
      });
      const a = await open("A");
      const b = await open("B", { location: DockLocation.RIGHT });
      workbench.activate(a.id);
      const target = kind === "source" ? a.containerId : b.containerId;
      await workbench.dispatch(
        Actions.addTab(
          { id: "inspector", component: "worksplit.tool" },
          target,
          DockLocation.CENTER,
          -1,
          true,
        ),
      );
      internal.focus("inspector", "tool");
      const before = workbench.getLayout();
      const id = kind === "new" ? "C" : kind === "existing" ? "B" : "A";
      expect(await workbench.open(nav(id), { target, preserveFocus: true })).toEqual({
        status: "rejected",
        reason: "focus-conflict",
      });
      expect(workbench.getLayout()).toEqual(before);
      expect(workbench.getEditingContext()).toMatchObject({
        activeTabId: a.id,
        focusedTabId: "inspector",
        focusedArea: "tool",
      });
    },
  );

  it("allows a separate edge pane while preserving a tool's selected content", async () => {
    const { workbench, open, internal } = setup({
      tools: [{ id: "inspector", render: () => null }],
    });
    const a = await open("A");
    const b = await open("B", { location: DockLocation.RIGHT });
    workbench.activate(a.id);
    await workbench.dispatch(
      Actions.addTab(
        { id: "inspector", component: "worksplit.tool" },
        b.containerId,
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    internal.focus("inspector", "tool");
    const c = await open("C", {
      target: b.containerId,
      location: DockLocation.RIGHT,
      preserveFocus: true,
    });
    expect(c.containerId).not.toBe(b.containerId);
    expect(
      (internal.model.getNodeById(b.containerId) as TabSetNode).getSelectedNode()?.getId(),
    ).toBe("inspector");
    expect(workbench.getEditingContext()).toMatchObject({
      activeTabId: a.id,
      focusedTabId: "inspector",
      focusedArea: "tool",
    });
  });

  it("reveals the source itself when a selected tool obscures it and focus is in the shell", async () => {
    const { workbench, open, internal } = setup({
      tools: [{ id: "inspector", render: () => null }],
    });
    const a = await open("A");
    await workbench.dispatch(
      Actions.addTab(
        { id: "inspector", component: "worksplit.tool" },
        a.containerId,
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    internal.focus(null, "shell");
    expect((await workbench.open(nav("A"), { preserveFocus: true })).status).toBe("committed");
    expect(
      (internal.model.getNodeById(a.containerId) as TabSetNode).getSelectedNode()?.getId(),
    ).toBe(a.id);
    expect(workbench.getEditingContext()).toMatchObject({
      activeTabId: a.id,
      focusedArea: "shell",
    });
  });

  it("keeps maximization unchanged when preserved source reuse is already visible", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    await workbench.dispatch(Actions.maximizeToggle(a.containerId));
    const before = workbench.getLayout();
    expect((await workbench.open(nav("A"), { preserveFocus: true })).status).toBe("committed");
    expect(workbench.getLayout()).toEqual(before);
  });

  it("duplicates into a visible separate pane without activating the copy", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const result = await workbench.duplicate(a.id, {
      location: DockLocation.BOTTOM,
      preserveFocus: true,
    });
    expect(result).toMatchObject({ status: "committed", reused: false });
    expect(workbench.getActiveDocument()?.id).toBe(a.id);
    expect(workbench.getDocuments()).toHaveLength(2);
  });
});
