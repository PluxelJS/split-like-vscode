import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { Actions, DockLocation, TabSetNode, type Action } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLayoutPolicy,
  createWorkbench,
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
    internal.registerOwner(a.id, { focus });
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
    internal.registerOwner(b.id, { isDirty: () => true, beforeLeave: () => approved });
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
    internal.registerOwner(a.id, { isDirty: () => true });
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
