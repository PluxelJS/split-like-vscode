import {
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import {
  Actions,
  BorderNode,
  DockLocation,
  Model,
  TabGroupNode,
  TabNode,
  TabSetNode,
  type Action,
  type IJsonModel,
  type Node,
} from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchContentLifecycle, type WorkbenchOptions } from "./index";
import { integrationState } from "./integration";

const disposals: (() => Promise<unknown>)[] = [];
const pendingGates: (() => void)[] = [];
afterEach(async () => {
  pendingGates.splice(0).forEach((finish) => finish());
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  pendingGates.push(() => resolve(fallback));
  return { promise, resolve };
}

function setup(
  options: Partial<Omit<WorkbenchOptions<AnyRouter>, "createRouter">> = {},
  load: (id: string) => string | Promise<string> = (id) => id,
) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === "string" ? search.view : "edit",
    }),
    loader: ({ params }) => load(params.id),
    staticData: { worksplit: { title: "Document", navigationKey: "documents" } },
  });
  const routeTree = root.addChildren([page]);
  const routers: AnyRouter[] = [];
  const makeRouter = (history: RouterHistory) => {
    const router = createRouter({
      routeTree,
      history,
      defaultPendingMinMs: 0,
      defaultStaleTime: Infinity,
    });
    vi.spyOn(router.history, "destroy");
    routers.push(router);
    return router;
  };
  const workbench = createWorkbench({ createRouter: makeRouter, ...options });
  disposals.push(() => workbench.dispose());
  const open = async (id: string, target?: string) => {
    const result = await workbench.open(
      { to: "/documents/$id", params: { id }, search: { view: "edit" } },
      target === undefined ? {} : { target },
    );
    if (result.status !== "committed") throw new Error(`Fixture open failed: ${result.status}`);
    return result.document.id;
  };
  return { workbench, open, makeRouter, routers };
}

type Fixture = ReturnType<typeof setup>;
function native(workbench: Fixture["workbench"]) {
  return Model.fromJson(workbench.getLayout());
}
function tab(workbench: Fixture["workbench"], id: string) {
  const node = native(workbench).getNodeById(id);
  if (!(node instanceof TabNode)) throw new Error(`Missing native tab ${id}`);
  return node;
}
function container(node: Node): TabSetNode | BorderNode {
  let current: Node | undefined = node;
  while (current && !(current instanceof TabSetNode) && !(current instanceof BorderNode))
    current = current.getParent();
  if (!current) throw new Error("Tab has no native container");
  return current as TabSetNode | BorderNode;
}
function tabsets(workbench: Fixture["workbench"]): TabSetNode[] {
  const result: TabSetNode[] = [];
  native(workbench).visitNodes((node) => {
    if (node instanceof TabSetNode) result.push(node);
  });
  return result;
}
function liveRouters(routers: readonly AnyRouter[]) {
  return routers.filter((router) => vi.mocked(router.history.destroy).mock.calls.length === 0);
}
async function group(workbench: Fixture["workbench"], id: string) {
  expect(await workbench.dispatch(Actions.addTabToNewGroup(id, "Research", "#3366cc"))).toEqual({
    status: "applied",
  });
  const parent = tab(workbench, id).getParent();
  if (!(parent instanceof TabGroupNode)) throw new Error("Native group was not created");
  return parent.getId();
}

const withBorder: NonNullable<WorkbenchOptions<AnyRouter>["layout"]> = {
  global: {
    tabEnableFloat: false,
    tabEnablePopout: false,
    tabEnablePin: true,
    tabSetEnableClose: true,
    tabSetEnableDeleteWhenEmpty: false,
  },
  borders: [{ type: "border", location: "bottom", children: [] }],
  layout: {
    type: "row",
    children: [
      { type: "tabset", id: "main", children: [] },
      { type: "tabset", id: "other", children: [] },
    ],
  },
};

describe("native FlexLayout ownership", () => {
  it.each([
    { layout: {} },
    { layout: { type: "row" } },
    {
      borders: [{ type: "border", location: "bottom" }],
      layout: { children: [{ type: "tabset", enableDeleteWhenEmpty: false }] },
    },
  ] satisfies IJsonModel[])(
    "accepts omitted native root and empty children defaults: %j",
    (layout) => {
      const { workbench, makeRouter } = setup({ layout });
      expect(workbench.getLayout().layout.type).toBe("row");
      expect(tabsets(workbench)).toHaveLength(1);
      expect(tabsets(workbench)[0]?.getChildren()).toHaveLength(0);
      const snapshot = workbench.snapshot();
      const restored = createWorkbench({ createRouter: makeRouter, snapshot });
      disposals.push(() => restored.dispose());
      expect(restored.getLayout().layout.id).toBe(snapshot.layout.layout.id);
      expect(tabsets(restored)).toHaveLength(1);
      expect(tabsets(restored)[0]?.getChildren()).toHaveLength(0);
    },
  );

  it("retains generated native document identities across snapshots and actual Router admission", async () => {
    const { workbench, makeRouter } = setup({
      layout: {
        layout: {
          children: [
            {
              type: "tabset",
              children: [
                { component: "worksplit.document", config: { href: "/documents/A?view=edit" } },
              ],
            },
          ],
        },
      },
    });
    const original = workbench.getDocuments()[0];
    expect(original?.id).toBeTruthy();
    expect(workbench.getDocuments()).toHaveLength(1);
    const snapshot = workbench.snapshot();
    const restored = createWorkbench({ createRouter: makeRouter, snapshot });
    disposals.push(() => restored.dispose());
    expect(restored.snapshot()).toEqual(snapshot);
    const result = await restored.start("/documents/A?view=edit");
    expect(result).toMatchObject({
      status: "committed",
      reused: true,
      document: { id: original?.id },
    });
    expect(restored.getDocuments()).toHaveLength(1);
    expect(restored.getDocument(original!.id)?.href).toContain("/documents/A");
  });

  it.each([
    { layout: { type: "tabset", children: [] } },
    { layout: { type: null, children: [] } },
    { layout: [] },
    { layout: { type: "row", children: {} } },
    { layout: { type: "row", children: [{ type: "tabset", children: "tabs" }] } },
    { layout: { children: [{ type: "tabset", children: [[]] }] } },
    { layout: { type: "row", children: [{ type: "unknown" }] } },
    {
      layout: {
        children: [
          { type: "tabset", id: "duplicate", children: [] },
          { type: "tabset", id: "duplicate", children: [] },
        ],
      },
    },
    { layout: { id: "", children: [] } },
    {
      borders: [{ location: "bottom" }],
      layout: {
        children: [
          {
            type: "tabset",
            children: [
              {
                id: "border_bottom",
                component: "worksplit.document",
                config: { href: "/documents/A" },
              },
            ],
          },
        ],
      },
    },
  ])("rejects malformed or conflicting native identities before creating Routers: %j", (layout) => {
    const { makeRouter } = setup();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    expect(() =>
      createWorkbench({ createRouter: factory, layout: layout as unknown as IJsonModel }),
    ).toThrow(/snapshot|duplicate|unique|native/iu);
    expect(factory).not.toHaveBeenCalled();
  });

  it("allows native undefined attribute resets without enabling float or popout content", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    await workbench.dispatch(
      Actions.updateNodeAttributes(a, { enableFloat: false, enablePopout: false }),
    );
    expect(
      await workbench.dispatch(
        // Native updateAttrs supports undefined resets; upstream optional TS fields are narrower.
        Actions.updateNodeAttributes(a, {
          enableFloat: undefined,
          enablePopout: undefined,
        } as unknown as Parameters<typeof Actions.updateNodeAttributes>[1]),
      ),
    ).toEqual({ status: "applied" });
    expect(
      await workbench.dispatch(
        Actions.updateModelAttributes({
          tabEnableFloat: undefined,
          tabEnablePopout: undefined,
        } as unknown as Parameters<typeof Actions.updateModelAttributes>[0]),
      ),
    ).toEqual({ status: "applied" });
    expect(tab(workbench, a).isEnableFloat()).toBe(false);
    expect(tab(workbench, a).isEnablePopout()).toBe(false);
    const before = workbench.getLayout();
    expect(
      await workbench.dispatch(Actions.updateNodeAttributes(a, { enableFloat: true })),
    ).toEqual({ status: "rejected" });
    expect(
      await workbench.dispatch(Actions.updateModelAttributes({ tabEnablePopout: true })),
    ).toEqual({ status: "rejected" });
    expect(workbench.getLayout()).toEqual(before);
  });

  it("rejects children on a native Tab without silently dropping their documents or changing the candidate", () => {
    const { makeRouter } = setup();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    const candidate = {
      layout: {
        children: [
          {
            type: "tabset",
            children: [
              {
                type: "tab",
                id: "A",
                component: "worksplit.document",
                config: { href: "/documents/A" },
                children: [
                  {
                    type: "tab",
                    id: "B",
                    component: "worksplit.document",
                    config: { href: "/documents/B" },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const original = structuredClone(candidate);
    expect(() =>
      createWorkbench({ createRouter: factory, layout: candidate as unknown as IJsonModel }),
    ).toThrow(/children/u);
    expect(factory).not.toHaveBeenCalled();
    expect(candidate).toEqual(original);
  });

  it("preserves a Border document URL when a native tool selection or collapse leaves central B selected", async () => {
    const { workbench, open } = setup({
      tools: [{ id: "inspector", render: () => null }],
      layout: {
        ...withBorder,
        borders: [
          {
            type: "border",
            location: "bottom",
            selected: 0,
            children: [{ type: "tab", id: "inspector", component: "worksplit.tool" }],
          },
        ],
      },
    });
    workbench.connectBrowser();
    const a = await open("A", "main");
    const b = await open("B", "other");
    await workbench.dispatch(Actions.moveNode(a, "border_bottom", DockLocation.CENTER, -1));
    workbench.activate(a);
    await Promise.resolve();
    expect(native(workbench).getActiveTabset()?.getSelectedNode()?.getId()).toBe(b);
    const focusA = vi.fn<() => void>();
    const focusB = vi.fn<() => void>();
    integrationState(workbench).register(a, { focus: focusA });
    integrationState(workbench).register(b, { focus: focusB });
    expect(await workbench.dispatch(Actions.selectTab("inspector"))).toEqual({ status: "applied" });
    expect(
      (native(workbench).getNodeById("border_bottom") as BorderNode).getSelectedNode()?.getId(),
    ).toBe("inspector");
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    await workbench.dispatch(Actions.selectTab("inspector"));
    expect((native(workbench).getNodeById("border_bottom") as BorderNode).getSelected()).toBe(-1);
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    await workbench.dispatch(Actions.selectTab(a));
    await workbench.dispatch(Actions.selectTab(a));
    expect((native(workbench).getNodeById("border_bottom") as BorderNode).getSelected()).toBe(-1);
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    await Promise.resolve();
    expect(focusA).not.toHaveBeenCalled();
    expect(focusB).not.toHaveBeenCalled();
  });

  it("lets native selection and active-tabset interactions own DOM focus while public activation restores it", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    const a = await open("A", "main");
    const b = await open("B", "other");
    const focusA = vi.fn<() => void>();
    const focusB = vi.fn<() => void>();
    integrationState(workbench).register(a, { focus: focusA });
    integrationState(workbench).register(b, { focus: focusB });
    await workbench.dispatch(Actions.selectTab(a));
    await Promise.resolve();
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(focusA).not.toHaveBeenCalled();
    await workbench.dispatch(Actions.setActiveTabset("other"));
    await Promise.resolve();
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(focusB).not.toHaveBeenCalled();
    workbench.activate(a);
    await Promise.resolve();
    expect(focusA).toHaveBeenCalledTimes(1);
    expect(focusB).not.toHaveBeenCalled();
  });

  it.each(["native tool selection", "observed tool focus"] as const)(
    "cancels a queued public focus restoration after %s",
    async (interaction) => {
      const { workbench, open } = setup({
        tools: [{ id: "inspector", render: () => null }],
        layout: {
          ...withBorder,
          borders: [
            {
              type: "border",
              location: "bottom",
              selected: 0,
              children: [{ type: "tab", id: "inspector", component: "worksplit.tool" }],
            },
          ],
        },
      });
      const a = await open("A", "main");
      const focus = vi.fn<() => void>();
      integrationState(workbench).register(a, { focus });
      workbench.activate(a);
      if (interaction === "native tool selection") {
        await workbench.dispatch(Actions.selectTab("inspector"));
      } else {
        integrationState(workbench).focus("inspector", "tool");
      }
      await Promise.resolve();
      expect(workbench.getActiveDocument()?.id).toBe(a);
      expect(focus).not.toHaveBeenCalled();
      workbench.activate(a);
      await Promise.resolve();
      expect(focus).toHaveBeenCalledTimes(1);
    },
  );

  it("retains a Border document URL when a native batch selects only a tool and resizes its Border", async () => {
    const { workbench, open } = setup({
      tools: [{ id: "inspector", render: () => null }],
      layout: {
        ...withBorder,
        borders: [
          {
            type: "border",
            location: "bottom",
            selected: 0,
            children: [{ type: "tab", id: "inspector", component: "worksplit.tool" }],
          },
        ],
      },
    });
    workbench.connectBrowser();
    const a = await open("A", "main");
    const b = await open("B", "other");
    await workbench.dispatch(Actions.moveNode(a, "border_bottom", DockLocation.CENTER, -1));
    workbench.activate(a);
    await Promise.resolve();
    const focus = vi.fn<() => void>();
    integrationState(workbench).register(b, { focus });
    const model = native(workbench);
    const action = Actions.group([
      Actions.selectTab("inspector"),
      Actions.updateNodeAttributes("border_bottom", { size: 222 }),
    ]);
    model.doAction(action);
    expect(await workbench.dispatch(action)).toEqual({ status: "applied" });
    expect(workbench.getLayout()).toEqual(model.toJson());
    expect(native(workbench).getActiveTabset()?.getSelectedNode()?.getId()).toBe(b);
    expect(
      (native(workbench).getNodeById("border_bottom") as BorderNode).getSelectedNode()?.getId(),
    ).toBe("inspector");
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
  });

  it.each([
    ["tab", "scalar"],
    ["tab", "singleton"],
    ["tab", "nested singleton"],
    ["group", "scalar"],
  ] as const)(
    "follows native selection when a %s moves into an already open Border via %s",
    async (kind, wrapper) => {
      const { workbench, open } = setup({
        tools: [{ id: "inspector", render: () => null }],
        layout: {
          ...withBorder,
          borders: [
            {
              type: "border",
              location: "bottom",
              selected: 0,
              children: [{ type: "tab", id: "inspector", component: "worksplit.tool" }],
            },
          ],
        },
      });
      workbench.connectBrowser();
      const a = await open("A", "main");
      const b = await open("B", "main");
      let moving = a;
      if (kind === "group") {
        const c = await open("C", "main");
        moving = await group(workbench, a);
        await workbench.dispatch(Actions.moveNode(c, moving, DockLocation.CENTER, -1));
      }
      workbench.activate(a);
      await Promise.resolve();
      const focus = vi.fn<() => void>();
      integrationState(workbench).register(a, { focus });
      const model = native(workbench);
      const leaf = Actions.moveNode(moving, "border_bottom", DockLocation.CENTER, -1);
      const action =
        wrapper === "scalar"
          ? leaf
          : Actions.group([wrapper === "singleton" ? leaf : Actions.group([leaf])]);
      model.doAction(action);
      expect((model.getNodeById("border_bottom") as BorderNode).getSelectedNode()?.getId()).toBe(
        kind === "tab" ? a : "inspector",
      );
      expect(model.getActiveTabset()?.getSelectedNode()?.getId()).toBe(b);
      const observe = vi.fn<(action: Action) => void>();
      const live = integrationState(workbench).model;
      live.addChangeListener(observe);
      expect(await workbench.dispatch(action)).toEqual({ status: "applied" });
      live.removeChangeListener(observe);
      expect(observe).toHaveBeenCalledTimes(1);
      expect(observe.mock.calls[0]?.[0]).toBe(action);
      expect(workbench.getLayout()).toEqual(model.toJson());
      expect(workbench.getActiveDocument()?.id).toBe(kind === "tab" ? a : b);
      expect(window.location.pathname).toBe(kind === "tab" ? "/documents/A" : "/documents/B");
      await Promise.resolve();
      expect(focus).not.toHaveBeenCalled();
    },
  );

  it.each(["singleton", "nested singleton"] as const)(
    "activates a Border document selected through a %s native GroupAction without replacing its observer action",
    async (wrapper) => {
      const { workbench, open } = setup({ layout: withBorder });
      workbench.connectBrowser();
      await open("A", "main");
      const b = await open("B", "other");
      const c = await open("C", "border_bottom");
      workbench.activate(b);
      await workbench.dispatch(Actions.selectTab(c));
      expect((native(workbench).getNodeById("border_bottom") as BorderNode).getSelected()).toBe(-1);
      expect(workbench.getActiveDocument()?.id).toBe(b);
      const focus = vi.fn<() => void>();
      integrationState(workbench).register(c, { focus });
      const leaf = Actions.selectTab(c);
      const action = Actions.group([wrapper === "singleton" ? leaf : Actions.group([leaf])]);
      const expected = native(workbench);
      expected.doAction(action);
      const observe = vi.fn<(action: Action) => void>();
      const live = integrationState(workbench).model;
      live.addChangeListener(observe);
      expect(await workbench.dispatch(action)).toEqual({ status: "applied" });
      live.removeChangeListener(observe);
      expect(observe).toHaveBeenCalledTimes(1);
      expect(observe.mock.calls[0]?.[0]).toBe(action);
      expect(workbench.getLayout()).toEqual(expected.toJson());
      expect(native(workbench).getActiveTabset()?.getSelectedNode()?.getId()).toBe(b);
      expect(workbench.getActiveDocument()?.id).toBe(c);
      expect(window.location.pathname).toBe("/documents/C");
      await Promise.resolve();
      expect(focus).not.toHaveBeenCalled();
    },
  );

  it.each(["select false", "closed border"] as const)(
    "does not override native Border move visibility (%s)",
    async (mode) => {
      const { workbench, open } = setup({
        tools: [{ id: "inspector", render: () => null }],
        layout: {
          ...withBorder,
          borders: [
            {
              type: "border",
              location: "bottom",
              selected: mode === "select false" ? 0 : -1,
              autoSelectTabWhenClosed: false,
              children: [{ type: "tab", id: "inspector", component: "worksplit.tool" }],
            },
          ],
        },
      });
      const a = await open("A", "main");
      await open("B", "main");
      workbench.activate(a);
      await Promise.resolve();
      const model = native(workbench);
      const action = Actions.moveNode(
        a,
        "border_bottom",
        DockLocation.CENTER,
        -1,
        mode === "select false" ? false : undefined,
      );
      model.doAction(action);
      const selected = (model.getNodeById("border_bottom") as BorderNode)
        .getSelectedNode()
        ?.getId();
      expect(selected).not.toBe(a);
      expect(await workbench.dispatch(action)).toEqual({ status: "applied" });
      expect(workbench.getLayout()).toEqual(model.toJson());
      expect(
        (native(workbench).getNodeById("border_bottom") as BorderNode).getSelectedNode()?.getId(),
      ).toBe(selected);
      expect(workbench.getDocument(a)).not.toBeNull();
    },
  );

  it("lets native tidy remove emptied default containers through repeated edge splits", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    const initial = container(tab(workbench, a)).getId();
    expect(container(tab(workbench, b)).getId()).toBe(initial);
    const routerA = integrationState(workbench).documents.get(a)?.router;
    const routerB = integrationState(workbench).documents.get(b)?.router;
    expect(await workbench.dispatch(Actions.moveNode(a, initial, DockLocation.RIGHT, -1))).toEqual({
      status: "applied",
    });
    for (let iteration = 0; iteration < 8; ++iteration) {
      const moving = iteration % 2 === 0 ? a : b;
      const anchor = iteration % 2 === 0 ? b : a;
      const target = container(tab(workbench, anchor)).getId();
      // eslint-disable-next-line no-await-in-loop -- Each native move determines the next move's live target.
      const result = await workbench.dispatch(
        Actions.moveNode(moving, target, DockLocation.RIGHT, -1),
      );
      expect(result).toEqual({ status: "applied" });
      expect(tabsets(workbench)).toHaveLength(2);
      expect(tabsets(workbench).every((node) => node.getChildren().length === 1)).toBe(true);
    }
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(integrationState(workbench).documents.get(a)?.router).toBe(routerA);
    expect(integrationState(workbench).documents.get(b)?.router).toBe(routerB);
  });

  it("keeps exactly one native empty editor container after closing the last default document and reopens normally", async () => {
    const { workbench, open, routers } = setup();
    const a = await open("A");
    const b = await open("B");
    await workbench.dispatch(
      Actions.moveNode(a, container(tab(workbench, b)).getId(), DockLocation.RIGHT, -1),
    );
    expect(await workbench.close(a)).toMatchObject({ status: "closed" });
    expect(await workbench.close(b)).toMatchObject({ status: "closed" });
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(tabsets(workbench)).toHaveLength(1);
    expect(tabsets(workbench)[0]?.getChildren()).toHaveLength(0);
    expect(liveRouters(routers)).toHaveLength(1); // Inert URL builder; both document routers released.
    const c = await open("C");
    expect(workbench.getActiveDocument()?.id).toBe(c);
    expect(tabsets(workbench)).toHaveLength(1);
    expect(tabsets(workbench)[0]?.getChildren()).toHaveLength(1);
    expect(liveRouters(routers)).toHaveLength(2);
  });

  it("preserves an explicitly configured native empty container while pruning ordinary emptied containers", async () => {
    const { workbench, open } = setup({
      layout: {
        global: { tabEnableFloat: false, tabEnablePopout: false },
        layout: {
          type: "row",
          children: [{ type: "tabset", id: "kept", enableDeleteWhenEmpty: false, children: [] }],
        },
      },
    });
    const a = await open("A", "kept");
    const b = await open("B", "kept");
    await workbench.dispatch(Actions.moveNode(b, "kept", DockLocation.RIGHT, -1));
    const bContainer = container(tab(workbench, b)).getId();
    await workbench.dispatch(Actions.moveNode(a, bContainer, DockLocation.RIGHT, -1));
    const kept = native(workbench).getNodeById("kept");
    expect(kept).toBeInstanceOf(TabSetNode);
    expect(kept?.getChildren()).toHaveLength(0);
    expect(kept?.toJson()).toMatchObject({ enableDeleteWhenEmpty: false });
    expect(tabsets(workbench)).toHaveLength(3);
    expect(tabsets(workbench).filter((node) => node.getChildren().length === 0)).toHaveLength(1);
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("rejects explicit stale native targets without admitting a detached session or retaining its router", async () => {
    const { workbench, open, routers } = setup({
      layout: {
        global: { tabEnableFloat: false, tabEnablePopout: false },
        layout: {
          type: "row",
          children: [
            { type: "tabset", id: "left", children: [] },
            { type: "tabset", id: "right", children: [] },
          ],
        },
      },
    });
    const model = integrationState(workbench).model;
    const liveIds = new Set<string>();
    model.visitNodes((node) => liveIds.add(node.getId()));
    expect(liveIds.has("left")).toBe(false);
    expect(liveIds.has("right")).toBe(false);
    expect(model.getNodeById("left")).toBeInstanceOf(TabSetNode); // Upstream fromJson retains a stale idMap entry.
    const before = workbench.getLayout();
    const result = await workbench.open(
      { to: "/documents/$id", params: { id: "Detached" }, search: { view: "edit" } },
      { target: "left" },
    );
    expect(result).toMatchObject({ status: "failed" });
    expect(workbench.getLayout()).toEqual(before);
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(workbench.getActiveDocument()).toBeNull();
    expect(liveRouters(routers)).toHaveLength(1);
    const valid = await open("A");
    expect(workbench.getDocument(valid)).not.toBeNull();
    expect(tabsets(workbench)).toHaveLength(1);
    expect(liveRouters(routers)).toHaveLength(2);
  });

  it("uses native grouping, pinning, selection and container identities", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    const a = await open("A", "main");
    const b = await open("B", "main");
    const groupId = await group(workbench, a);
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(await workbench.dispatch(Actions.moveNode(b, groupId, DockLocation.CENTER, -1))).toEqual(
      { status: "applied" },
    );
    expect(workbench.getActiveDocument()?.id).toBe(b);
    integrationState(workbench).focus(b, "document");
    expect(workbench.getEditingContext()).toMatchObject({
      activeGroupId: "main",
      activeTabId: b,
      focusedTabId: b,
    });
    expect(container(tab(workbench, b)).getId()).toBe("main");
    expect(await workbench.dispatch(Actions.setTabPinned(b, true))).toEqual({ status: "applied" });
    expect(tab(workbench, b).isPinned()).toBe(true);
    expect(tab(workbench, b).getParent()).toBeInstanceOf(TabSetNode);
    expect(tab(workbench, a).getParent()).toBeInstanceOf(TabGroupNode);
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(
      await workbench.dispatch(Actions.moveNode(groupId, "border_bottom", DockLocation.CENTER, -1)),
    ).toEqual({ status: "applied" });
    workbench.activate(a);
    expect(workbench.getEditingContext().activeGroupId).toBe("border_bottom");
    expect(await workbench.dispatch(Actions.ungroup(groupId))).toEqual({ status: "applied" });
    expect(tab(workbench, a).getParent()).toBeInstanceOf(BorderNode);
    expect(workbench.getDocument(a)?.href).toContain("/documents/A");
    expect(workbench.getDocument(b)?.href).toContain("/documents/B");
  });

  it("synchronizes collapse and grouped selection with the active document and browser URL", async () => {
    const { workbench, open } = setup();
    workbench.connectBrowser();
    const a = await open("A");
    const b = await open("B");
    const c = await open("C");
    const groupId = await group(workbench, a);
    await workbench.dispatch(Actions.moveNode(b, groupId, DockLocation.CENTER, -1));
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(window.location.pathname).toBe("/documents/B");
    expect(
      await workbench.dispatch(Actions.updateNodeAttributes(groupId, { opened: false })),
    ).toEqual({
      status: "applied",
    });
    expect(native(workbench).getActiveTabset()?.getSelectedNode()?.getId()).toBe(c);
    expect(workbench.getActiveDocument()?.id).toBe(c);
    expect(window.location.pathname).toBe("/documents/C");
    workbench.activate(a);
    const parent = tab(workbench, a).getParent();
    expect(parent).toBeInstanceOf(TabGroupNode);
    expect((parent as TabGroupNode).isOpened()).toBe(true);
    expect(tab(workbench, a).isSelected()).toBe(true);
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    expect(workbench.getDocuments()).toHaveLength(3);
  });

  it("uses container-wide MRU when the active grouped member closes", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    const a = await open("A", "main");
    const b = await open("B", "main");
    const c = await open("C", "main");
    const d = await open("D", "other");
    const groupId = await group(workbench, a);
    await workbench.dispatch(Actions.moveNode(b, groupId, DockLocation.CENTER, -1));
    workbench.activate(d);
    workbench.activate(a);
    workbench.activate(c);
    workbench.activate(b);
    expect(await workbench.close(b)).toMatchObject({ status: "closed" });
    expect(workbench.getActiveDocument()?.id).toBe(c);
    expect(workbench.getEditingContext().activeGroupId).toBe("main");
    expect(workbench.getDocument(a)).not.toBeNull();
  });

  it("persists the actual group model and keeps restored document routers lazy", async () => {
    const { workbench, open, makeRouter } = setup();
    const a = await open("A");
    const b = await open("B");
    const containerId = container(tab(workbench, a)).getId();
    const groupId = await group(workbench, a);
    await workbench.dispatch(Actions.moveNode(b, groupId, DockLocation.CENTER, -1));
    await workbench.dispatch(
      Actions.updateNodeAttributes(groupId, {
        name: "Saved group",
        color: "#ab12ef",
        opened: false,
      }),
    );
    const snapshot = workbench.snapshot();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    const restored = createWorkbench({ createRouter: factory, snapshot });
    disposals.push(() => restored.dispose());
    expect(factory).toHaveBeenCalledTimes(1);
    expect(restored.getLayout()).toEqual(snapshot.layout);
    expect(restored.getDocuments()).toHaveLength(2);
    expect(native(restored).getNodeById(groupId)).toBeInstanceOf(TabGroupNode);
    const restoredGroup = native(restored).getNodeById(groupId) as TabGroupNode;
    expect(restoredGroup.getName()).toBe("Saved group");
    expect(restoredGroup.getColor()).toBe("#ab12ef");
    expect(restoredGroup.isOpened()).toBe(false);
    expect(await restored.start("/documents/A?view=edit")).toMatchObject({ status: "committed" });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(restored.getEditingContext().activeGroupId).toBe(containerId);
    expect(tab(restored, a).isSelected()).toBe(true);
  });

  it("validates an entire restored or initial group against the aggregate native docking policy", async () => {
    const { workbench, open, makeRouter } = setup();
    const a = await open("A");
    const b = await open("B");
    const groupId = await group(workbench, a);
    await workbench.dispatch(Actions.moveNode(b, groupId, DockLocation.CENTER, -1));
    const policy = vi.fn<NonNullable<WorkbenchOptions<AnyRouter>["allowDrop"]>>(
      (tabs) => tabs.length === 1,
    );
    const aNode = tab(workbench, a);
    const bNode = tab(workbench, b);
    expect(policy([aNode], container(aNode), DockLocation.CENTER)).toBe(true);
    expect(policy([bNode], container(bNode), DockLocation.CENTER)).toBe(true);
    policy.mockClear();
    const snapshot = workbench.snapshot();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    expect(() => createWorkbench({ createRouter: factory, snapshot, allowDrop: policy })).toThrow(
      "group docking policy",
    );
    expect(() =>
      createWorkbench({ createRouter: factory, layout: snapshot.layout, allowDrop: policy }),
    ).toThrow("group docking policy");
    expect(
      policy.mock.calls.some(
        ([tabs]) =>
          tabs
            .map((node) => node.getId())
            .toSorted()
            .join() === [a, b].toSorted().join(),
      ),
    ).toBe(true);
    expect(factory).not.toHaveBeenCalled();
  });

  it("passes group members and actual native targets through the docking policy", async () => {
    const policy = vi.fn<NonNullable<WorkbenchOptions<AnyRouter>["allowDrop"]>>(
      (tabs, target) =>
        target.getType() !== "border" || tabs.every((node) => node.getName() === "Tool"),
    );
    const { workbench, open, makeRouter } = setup({ layout: withBorder, allowDrop: policy });
    const a = await open("A", "main");
    const b = await open("B", "main");
    const groupId = await group(workbench, a);
    policy.mockClear();
    expect(await workbench.dispatch(Actions.moveNode(b, groupId, DockLocation.CENTER, -1))).toEqual(
      { status: "applied" },
    );
    expect(
      policy.mock.calls.some(
        ([tabs, target, location]) =>
          tabs.length === 1 &&
          tabs[0]?.getId() === b &&
          target instanceof TabGroupNode &&
          target.getId() === groupId &&
          location === DockLocation.CENTER,
      ),
    ).toBe(true);
    policy.mockClear();
    const before = workbench.getLayout();
    expect(
      await workbench.dispatch(Actions.moveNode(groupId, "border_bottom", DockLocation.CENTER, -1)),
    ).toEqual({ status: "rejected" });
    expect(
      policy.mock.calls.some(
        ([tabs, target]) =>
          target instanceof BorderNode &&
          tabs
            .map((node) => node.getId())
            .toSorted()
            .join() === [a, b].toSorted().join(),
      ),
    ).toBe(true);
    expect(workbench.getLayout()).toEqual(before);
    policy.mockClear();
    expect(await workbench.dispatch(Actions.removeTabFromGroup(b))).toEqual({ status: "applied" });
    expect(
      policy.mock.calls.some(
        ([tabs, target]) => tabs[0]?.getId() === b && target.getId() === "main",
      ),
    ).toBe(true);
    expect(await workbench.dispatch(Actions.ungroup(groupId))).toEqual({ status: "applied" });
    expect(tab(workbench, a).getParent()).toBeInstanceOf(TabSetNode);
    const snapshot = workbench.snapshot();
    const invalid = Model.fromJson(snapshot.layout);
    invalid.doAction(Actions.addTabToNewGroup(a, "Invalid"));
    const movedGroup = invalid.getNodeById(a)?.getParent();
    if (!(movedGroup instanceof TabGroupNode)) throw new Error("Missing snapshot group");
    invalid.doAction(
      Actions.moveNode(movedGroup.getId(), "border_bottom", DockLocation.CENTER, -1),
    );
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    expect(() =>
      createWorkbench({
        createRouter: factory,
        snapshot: { ...snapshot, layout: invalid.toJson() },
        allowDrop: policy,
      }),
    ).toThrow("policy");
    expect(factory).not.toHaveBeenCalled();
  });

  it("allows native display attributes and pure batches while rejecting identity and float changes atomically", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    const a = await open("A", "main");
    const b = await open("B", "main");
    expect(
      await workbench.dispatch(
        Actions.group([
          Actions.setTabPinned(a, true),
          Actions.updateNodeAttributes("main", { name: "Editor", minWidth: 180 }),
          Actions.updateModelAttributes({ tabGroupType: "underline" }),
        ]),
      ),
    ).toEqual({ status: "applied" });
    expect(tab(workbench, a).isPinned()).toBe(true);
    expect(native(workbench).getNodeById("main")?.toJson()).toMatchObject({
      name: "Editor",
      minWidth: 180,
    });
    expect(workbench.getLayout().global).toMatchObject({ tabGroupType: "underline" });
    const before = workbench.getLayout();
    const unsafe = [
      Actions.addTab(
        {
          type: "tab",
          id: "rogue",
          component: "worksplit.document",
          config: { href: "/documents/R" },
        },
        "main",
        DockLocation.CENTER,
        -1,
      ),
      Actions.updateNodeAttributes(b, { component: "other" }),
      Actions.updateNodeAttributes(b, { config: { href: "/documents/Other" } }),
      Actions.updateNodeAttributes(b, { id: "other-id" }),
      Actions.updateNodeAttributes(b, { enableFloat: true }),
      Actions.updateModelAttributes({ tabEnablePopout: true }),
      Actions.popoutTab(b, "float"),
      Actions.createSubLayout(
        { type: "row", children: [] },
        { x: 0, y: 0, width: 100, height: 100 },
        "tab",
      ),
      Actions.moveNode("missing", "main", DockLocation.CENTER, -1),
    ];
    const rejected = await Promise.all(
      unsafe.map((action) =>
        workbench.dispatch(Actions.group([Actions.setTabPinned(b, true), action])),
      ),
    );
    expect(rejected).toEqual(unsafe.map(() => ({ status: "rejected" })));
    expect(workbench.getLayout()).toEqual(before);
    expect(workbench.getDocument(b)?.href).toContain("/documents/B");
    expect(
      await workbench.dispatch(
        Actions.group([Actions.deleteTab(a), Actions.setTabPinned(b, true)]),
      ),
    ).toEqual({ status: "rejected" });
    expect(workbench.getLayout()).toEqual(before);
  });

  it("rejects policy-dependent multi-step docking batches before changing the native Model", async () => {
    const policy = vi.fn<NonNullable<WorkbenchOptions<AnyRouter>["allowDrop"]>>(() => true);
    const { workbench, open } = setup({ layout: withBorder, allowDrop: policy });
    const a = await open("A", "main");
    const b = await open("B", "main");
    const before = workbench.getLayout();
    const results = await Promise.all([
      workbench.dispatch(
        Actions.group([
          Actions.moveNode(a, "other", DockLocation.CENTER, -1),
          Actions.moveNode(b, "other", DockLocation.CENTER, -1),
        ]),
      ),
      workbench.dispatch(
        Actions.group([
          Actions.updateNodeAttributes("other", { name: "Changed before drop" }),
          Actions.moveNode(a, "other", DockLocation.CENTER, -1),
        ]),
      ),
    ]);
    expect(results).toEqual([{ status: "rejected" }, { status: "rejected" }]);
    expect(workbench.getLayout()).toEqual(before);
    expect(
      await workbench.dispatch(
        Actions.group([Actions.renameTab(a, "Renamed"), Actions.selectTab(a)]),
      ),
    ).toEqual({ status: "applied" });
    expect(tab(workbench, a).getName()).toBe("Renamed");
    expect(workbench.getActiveDocument()?.id).toBe(a);
  });

  it("rejects floating capabilities even in an initially empty native Model", () => {
    const { makeRouter } = setup();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    expect(() =>
      createWorkbench({
        createRouter: factory,
        layout: { ...withBorder, global: { ...withBorder.global, tabEnableFloat: true } },
      }),
    ).toThrow(/floating|popout/u);
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects legacy popouts and nested sublayout content before creating restored routers", () => {
    const { workbench, makeRouter } = setup();
    const snapshot = workbench.snapshot();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    expect(() =>
      createWorkbench({
        createRouter: factory,
        snapshot: {
          ...snapshot,
          layout: {
            ...snapshot.layout,
            popouts: {
              ghost: { type: "float", layout: { type: "row", children: [] } },
            },
          },
        },
      }),
    ).toThrow(/popouts|sublayouts/u);
    expect(() =>
      createWorkbench({
        createRouter: factory,
        snapshot: {
          ...snapshot,
          layout: {
            global: { tabEnableFloat: false, tabEnablePopout: false },
            layout: {
              type: "row",
              children: [
                {
                  type: "tabset",
                  id: "main",
                  children: [
                    {
                      type: "tab",
                      id: "nested",
                      component: "worksplit.document",
                      config: { href: "/documents/A" },
                      subLayoutId: "ghost",
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
    ).toThrow(/sublayout/u);
    expect(factory).not.toHaveBeenCalled();
  });

  it("keeps native background titles and selections from taking the document URL", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    workbench.connectBrowser();
    const a = await open("A", "main");
    const b = await open("B", "other");
    await open("C", "other");
    workbench.activate(a);
    expect(await workbench.dispatch(Actions.renameTab(b, "Background title"))).toEqual({
      status: "applied",
    });
    expect(tab(workbench, b).getName()).toBe("Background title");
    expect(
      await workbench.dispatch(Actions.updateNodeAttributes("other", { selected: 0 })),
    ).toEqual({ status: "applied" });
    expect((native(workbench).getNodeById("other") as TabSetNode).getSelectedNode()?.getId()).toBe(
      b,
    );
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    const router = integrationState(workbench).documents.get(b)?.router;
    if (!router) throw new Error("Missing background document Router");
    await router.navigate({ href: "/documents/B?view=preview" });
    expect(tab(workbench, b).getName()).toBe("Document");
    expect(workbench.getDocument(b)?.href).toContain("view=preview");
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
  });

  it("projects a pure batch's final native active tabset without replaying an earlier selection", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    workbench.connectBrowser();
    const a = await open("A", "main");
    const b = await open("B", "other");
    expect(
      await workbench.dispatch(
        Actions.group([Actions.selectTab(a), Actions.setActiveTabset("other")]),
      ),
    ).toEqual({ status: "applied" });
    expect(native(workbench).getActiveTabset()?.getId()).toBe("other");
    expect(native(workbench).getActiveTabset()?.getSelectedNode()?.getId()).toBe(b);
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(window.location.pathname).toBe("/documents/B");
  });

  it.each(["central then border", "border then central"] as const)(
    "projects a cross-space batch (%s) from the final native central selection",
    async (order) => {
      const { workbench, open } = setup({ layout: withBorder });
      workbench.connectBrowser();
      const a = await open("A", "main");
      const b = await open("B", "other");
      const c = await open("C", "border_bottom");
      await workbench.dispatch(Actions.selectTab(c)); // Start with the border hidden.
      workbench.activate(order === "central then border" ? a : b);
      const actions =
        order === "central then border"
          ? [Actions.selectTab(a), Actions.selectTab(c)]
          : [Actions.selectTab(c), Actions.setActiveTabset("other")];
      expect(await workbench.dispatch(Actions.group(actions))).toEqual({ status: "applied" });
      const expected = order === "central then border" ? a : b;
      const expectedContainer = order === "central then border" ? "main" : "other";
      expect(native(workbench).getActiveTabset()?.getId()).toBe(expectedContainer);
      expect(native(workbench).getActiveTabset()?.getSelectedNode()?.getId()).toBe(expected);
      expect(
        (native(workbench).getNodeById("border_bottom") as BorderNode).getSelectedNode()?.getId(),
      ).toBe(c);
      expect(workbench.getActiveDocument()?.id).toBe(expected);
      expect(window.location.pathname).toBe(
        order === "central then border" ? "/documents/A" : "/documents/B",
      );
      await workbench.dispatch(Actions.selectTab(c)); // Hide, then explicitly select the border document.
      expect(await workbench.dispatch(Actions.selectTab(c))).toEqual({ status: "applied" });
      expect(workbench.getActiveDocument()?.id).toBe(c);
      expect(window.location.pathname).toBe("/documents/C");
      expect(native(workbench).getActiveTabset()?.getId()).toBe(expectedContainer);
    },
  );

  it("projects the final native move selection after a batch's earlier border selection", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    workbench.connectBrowser();
    const a = await open("A", "main");
    await open("B", "other");
    const c = await open("C", "border_bottom");
    await workbench.dispatch(Actions.selectTab(c));
    workbench.activate(a);
    expect(
      await workbench.dispatch(
        Actions.group([
          Actions.selectTab(c),
          Actions.moveNode(a, "other", DockLocation.CENTER, -1),
        ]),
      ),
    ).toEqual({ status: "applied" });
    expect(native(workbench).getActiveTabset()?.getId()).toBe("other");
    expect(native(workbench).getActiveTabset()?.getSelectedNode()?.getId()).toBe(a);
    expect(
      (native(workbench).getNodeById("border_bottom") as BorderNode).getSelectedNode()?.getId(),
    ).toBe(c);
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    expect(workbench.getEditingContext().activeGroupId).toBe("other");
  });

  it("follows the final native move selection and keeps subsequent background selected attributes local", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    workbench.connectBrowser();
    const a = await open("A", "main");
    const d = await open("D", "main");
    const b = await open("B", "main");
    const c = await open("C", "other");
    const groupId = await group(workbench, c);
    expect(
      await workbench.dispatch(
        Actions.group([
          Actions.selectTab(a),
          Actions.moveNode(b, groupId, DockLocation.CENTER, -1),
        ]),
      ),
    ).toEqual({ status: "applied" });
    expect(native(workbench).getActiveTabset()?.getId()).toBe("other");
    expect(native(workbench).getActiveTabset()?.getSelectedNode()?.getId()).toBe(b);
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(window.location.pathname).toBe("/documents/B");
    expect(await workbench.dispatch(Actions.updateNodeAttributes("main", { selected: 1 }))).toEqual(
      { status: "applied" },
    );
    expect((native(workbench).getNodeById("main") as TabSetNode).getSelectedNode()?.getId()).toBe(
      d,
    );
    expect(native(workbench).getActiveTabset()?.getId()).toBe("other");
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(window.location.pathname).toBe("/documents/B");
    expect(workbench.getDocuments()).toHaveLength(4);
  });
});

describe("registered native tool admission", () => {
  it("preserves native insertion JSON, targets, selection and the original singleton batch", async () => {
    const { workbench, open, routers } = setup({
      layout: withBorder,
      tools: [
        { id: "outline", render: () => null },
        { id: "search", render: () => null },
      ],
    });
    workbench.connectBrowser();
    const a = await open("A", "main");
    await open("B", "other");
    workbench.activate(a);
    const model = integrationState(workbench).model;
    const observer = vi.fn<(action: Action) => void>();
    model.addChangeListener(observer);
    const expected = native(workbench);
    const outline = Actions.addTab(
      {
        id: "outline",
        name: "Application outline",
        component: "worksplit.tool",
        config: { section: "symbols" },
        minWidth: 123,
        borderWidth: 245,
      },
      "main",
      DockLocation.CENTER,
      0,
      false,
    );
    expected.doAction(outline);
    expect(await workbench.dispatch(outline)).toEqual({ status: "applied" });
    expect(workbench.getLayout()).toEqual(expected.toJson());
    expect(observer.mock.calls).toEqual([[outline]]);
    expect((model.getNodeById("main") as TabSetNode).getSelectedNode()?.getId()).toBe(a);

    const search = Actions.group([
      Actions.group([
        Actions.addTab(
          { id: "search", name: "Search", component: "worksplit.tool", config: { query: "A" } },
          "border_bottom",
          DockLocation.CENTER,
          -1,
          true,
        ),
      ]),
    ]);
    expected.doAction(search);
    expect(await workbench.dispatch(search)).toEqual({ status: "applied" });
    expect(workbench.getLayout()).toEqual(expected.toJson());
    expect(observer.mock.calls).toEqual([[outline], [search]]);
    expect((model.getNodeById("border_bottom") as BorderNode).getSelectedNode()?.getId()).toBe(
      "search",
    );
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    expect(liveRouters(routers)).toHaveLength(3);
    model.removeChangeListener(observer);
  });

  it("uses native group insertion and edge docking without introducing another layout controller", async () => {
    const { workbench, open } = setup({
      layout: withBorder,
      tools: [
        { id: "outline", render: () => null },
        { id: "inspector", render: () => null },
      ],
    });
    workbench.connectBrowser();
    const a = await open("A", "main");
    const groupId = await group(workbench, a);
    await workbench.dispatch(Actions.updateNodeAttributes(groupId, { opened: false }));
    const expected = native(workbench);
    const inGroup = Actions.addTab(
      { id: "outline", name: "Outline", component: "worksplit.tool" },
      groupId,
      DockLocation.CENTER,
      0,
      false,
    );
    expected.doAction(inGroup);
    expect(await workbench.dispatch(inGroup)).toEqual({ status: "applied" });
    expect(workbench.getLayout()).toEqual(expected.toJson());
    expect(tab(workbench, "outline").getParent()?.getId()).toBe(groupId);
    const containerAttributes = { id: "inspector-panel", name: "Inspector pane" };
    const creationHook = vi.fn<Parameters<Model["setOnCreateTabSet"]>[0]>(
      () => containerAttributes,
    );
    integrationState(workbench).model.setOnCreateTabSet(creationHook);
    expected.setOnCreateTabSet(() => containerAttributes);
    const edge = Actions.addTab(
      { id: "inspector", name: "Inspector", component: "worksplit.tool", minWidth: 170 },
      "other",
      DockLocation.RIGHT,
      -1,
      true,
    );
    expected.doAction(edge);
    expect(await workbench.dispatch(edge)).toEqual({ status: "applied" });
    expect(workbench.getLayout()).toEqual(expected.toJson());
    expect(container(tab(workbench, "inspector")).getId()).toBe("inspector-panel");
    expect(creationHook).toHaveBeenCalledTimes(1);
    expect(creationHook).toHaveBeenCalledWith(
      integrationState(workbench).model.getNodeById("inspector"),
    );
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
  });

  it("reopens a tool with a new native identity and isolates retained registration and cleanup callbacks", async () => {
    const tool = { id: "outline", render: () => null };
    const { workbench, open, routers } = setup({
      layout: withBorder,
      tools: [tool],
    });
    workbench.connectBrowser();
    const a = await open("A", "main");
    const insert = (target: string, name: string) =>
      Actions.addTab(
        { id: tool.id, name, component: "worksplit.tool" },
        target,
        DockLocation.CENTER,
        -1,
        true,
      );
    expect(await workbench.dispatch(insert("border_bottom", "Outline"))).toEqual({
      status: "applied",
    });
    const internal = integrationState(workbench);
    const originalNode = internal.model.getNodeById("outline");
    const cleanup = vi.fn<() => void>();
    const decision = vi.fn<() => boolean>(() => false);
    let dirty = false;
    const originalLifecycle = { isDirty: () => dirty, beforeLeave: decision, dispose: cleanup };
    const retainedRegister = (lifecycle: WorkbenchContentLifecycle) =>
      internal.register("outline", lifecycle, originalNode);
    const retainedUnregister = retainedRegister(originalLifecycle);
    expect(await workbench.close("outline")).toEqual({
      status: "closed",
      id: "outline",
      cleanupErrors: [],
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(() => retainedRegister({})).toThrow("Cannot register closed content");

    expect(await workbench.dispatch(insert("other", "Reopened outline"))).toEqual({
      status: "applied",
    });
    const reopenedNode = internal.model.getNodeById("outline");
    expect(reopenedNode).toBeInstanceOf(TabNode);
    expect(reopenedNode).not.toBe(originalNode);
    expect(() => retainedRegister({})).toThrow("Cannot register closed content");
    const releaseReopened = internal.register("outline", originalLifecycle, reopenedNode);
    dirty = true;
    retainedUnregister();
    expect(await workbench.close("outline")).toEqual({ status: "rejected", reason: "decision" });
    expect(decision).toHaveBeenCalledWith("close", { id: "outline" });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(internal.model.getNodeById("outline")).toBe(reopenedNode);

    const nextCleanup = vi.fn<() => void>();
    releaseReopened();
    internal.register("outline", { dispose: nextCleanup }, reopenedNode);
    expect(await workbench.close("outline")).toMatchObject({ status: "closed", cleanupErrors: [] });
    expect(nextCleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    expect(liveRouters(routers)).toHaveLength(2);
  });

  it("keeps a removed tool identity reserved until asynchronous close cleanup finishes", async () => {
    const { workbench } = setup({
      layout: withBorder,
      tools: [{ id: "search", render: () => null }],
    });
    const add = Actions.addTab(
      { id: "search", name: "Search", component: "worksplit.tool" },
      "border_bottom",
      DockLocation.CENTER,
      -1,
    );
    expect(await workbench.dispatch(add)).toEqual({ status: "applied" });
    const cleanup = deferred<void>(undefined);
    const dispose = vi.fn<() => Promise<void>>(() => cleanup.promise);
    integrationState(workbench).register("search", { dispose });
    const closing = workbench.close("search");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(integrationState(workbench).model.getNodeById("search")).toBeUndefined();
    expect(await workbench.dispatch(add)).toEqual({ status: "rejected" });
    cleanup.resolve(undefined);
    expect(await closing).toMatchObject({ status: "closed" });
    expect(await workbench.dispatch(add)).toEqual({ status: "applied" });
    const nextCleanup = vi.fn<() => void>();
    integrationState(workbench).register("search", { dispose: nextCleanup });
    expect(await workbench.close("search")).toMatchObject({ status: "closed" });
    expect(nextCleanup).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("applies native closeability to the same close(id) API for tools", async () => {
    const { workbench } = setup({
      layout: withBorder,
      tools: [{ id: "search", render: () => null }],
    });
    expect(
      await workbench.dispatch(
        Actions.addTab(
          { id: "search", name: "Search", component: "worksplit.tool", enableClose: false },
          "border_bottom",
          DockLocation.CENTER,
          -1,
        ),
      ),
    ).toEqual({ status: "applied" });
    const cleanup = vi.fn<() => void>();
    integrationState(workbench).register("search", { dispose: cleanup });
    expect(await workbench.close("search")).toEqual({
      status: "rejected",
      reason: "not-closeable",
    });
    expect(cleanup).not.toHaveBeenCalled();
    expect(
      await workbench.dispatch(Actions.updateNodeAttributes("search", { enableClose: true })),
    ).toEqual({ status: "applied" });
    expect(await workbench.close("search")).toMatchObject({ status: "closed" });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown identities, invalid live targets and new document or window content before native mutation", async () => {
    const { workbench, open, routers } = setup({
      layout: withBorder,
      tools: [{ id: "outline", render: () => null }],
    });
    const a = await open("A", "main");
    const model = integrationState(workbench).model;
    const observer = vi.fn<(action: Action) => void>();
    model.addChangeListener(observer);
    const before = workbench.getLayout();
    const additions = [
      { id: "unknown", component: "worksplit.tool" },
      { component: "worksplit.tool" },
      { id: "outline", component: "worksplit.document", config: { href: "/documents/B" } },
      { id: "outline", component: "worksplit.tool", type: "row" },
      { id: "outline", component: "worksplit.tool", children: [] },
      { id: "outline", component: "worksplit.tool", subLayoutId: "extra" },
      { id: "outline", component: "worksplit.tool", enableFloat: true },
      { id: "outline", component: "worksplit.tool", enablePopout: true },
    ];
    for (const json of additions) {
      // Invalid external JSON deliberately crosses the native TypeScript boundary.
      const action = Actions.addTab(json as never, "main", DockLocation.CENTER, -1);
      // eslint-disable-next-line no-await-in-loop -- Verify each refusal before another insertion can mutate the shared Model.
      expect(await workbench.dispatch(action)).toEqual({ status: "rejected" });
    }
    for (const target of ["missing", a]) {
      expect(
        // eslint-disable-next-line no-await-in-loop -- These target checks share a Model and must run in mutation order.
        await workbench.dispatch(
          Actions.addTab(
            { id: "outline", component: "worksplit.tool" },
            target,
            DockLocation.CENTER,
            -1,
          ),
        ),
      ).toEqual({ status: "rejected" });
    }
    expect(workbench.getLayout()).toEqual(before);
    expect(observer).not.toHaveBeenCalled();
    expect(workbench.getDocuments()).toHaveLength(1);
    expect(liveRouters(routers)).toHaveLength(2);
    model.removeChangeListener(observer);
  });

  it("rejects multiple-resource and mixed insertion batches without partially changing layout", async () => {
    const { workbench, open } = setup({
      layout: withBorder,
      tools: [
        { id: "outline", render: () => null },
        { id: "search", render: () => null },
      ],
    });
    const a = await open("A", "main");
    const outline = Actions.addTab(
      { id: "outline", component: "worksplit.tool" },
      "main",
      DockLocation.CENTER,
      -1,
    );
    const search = Actions.addTab(
      { id: "search", component: "worksplit.tool" },
      "border_bottom",
      DockLocation.CENTER,
      -1,
    );
    const before = workbench.getLayout();
    const observer = vi.fn<(action: Action) => void>();
    integrationState(workbench).model.addChangeListener(observer);
    for (const action of [
      Actions.group([outline, search]),
      Actions.group([outline, Actions.renameTab(a, "Renamed")]),
      Actions.group([outline, Actions.deleteTab(a)]),
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Check each batch refusal before attempting the next mutation on this Model.
      expect(await workbench.dispatch(action)).toEqual({ status: "rejected" });
    }
    expect(workbench.getLayout()).toEqual(before);
    expect(observer).not.toHaveBeenCalled();
    integrationState(workbench).model.removeChangeListener(observer);
  });

  it("explicitly refuses new tool admission with an application docking policy", async () => {
    const allowDrop = vi.fn<NonNullable<WorkbenchOptions<AnyRouter>["allowDrop"]>>(() => true);
    const { workbench, open } = setup({
      layout: withBorder,
      tools: [{ id: "outline", render: () => null }],
      allowDrop,
    });
    await open("A", "main");
    allowDrop.mockClear();
    const before = workbench.getLayout();
    expect(
      await workbench.dispatch(
        Actions.addTab(
          { id: "outline", component: "worksplit.tool" },
          "border_bottom",
          DockLocation.CENTER,
          -1,
        ),
      ),
    ).toEqual({ status: "rejected" });
    expect(allowDrop).not.toHaveBeenCalled();
    expect(workbench.getLayout()).toEqual(before);
    expect(integrationState(workbench).model.getNodeById("outline")).toBeUndefined();
  });

  it("keeps the selected document when provisional admission is rejected by policy", async () => {
    const { workbench, open, routers } = setup({
      layout: withBorder,
      allowDrop: (tabs) =>
        tabs.every(
          (node) => !(node.getConfig() as { href?: string }).href?.startsWith("/documents/D"),
        ),
    });
    workbench.connectBrowser();
    const a = await open("A", "main");
    const b = await open("B", "main");
    const c = await open("C", "main");
    expect(await workbench.dispatch(Actions.selectTab(b))).toEqual({ status: "applied" });
    const target = integrationState(workbench).model.getNodeById("main") as TabSetNode;
    expect(target.getSelected()).toBe(1);
    const observer = vi.fn<(action: Action) => void>();
    integrationState(workbench).model.addChangeListener(observer);
    const result = await workbench.open(
      { to: "/documents/$id", params: { id: "D" }, search: { view: "edit" } },
      { target: "main" },
    );
    expect(result).toMatchObject({ status: "failed", stage: "load" });
    expect(observer.mock.calls.map(([action]) => action.type)).toEqual([
      Actions.ADD_TAB,
      Actions.DELETE_TAB,
    ]);
    expect(target.getSelectedNode()?.getId()).toBe(b);
    expect(workbench.getDocuments().map((document) => document.id)).toEqual([a, b, c]);
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(window.location.pathname).toBe("/documents/B");
    expect(liveRouters(routers)).toHaveLength(4);
    integrationState(workbench).model.removeChangeListener(observer);
  });

  it("preserves the active native container on cross-container refusal and background admission", async () => {
    const { workbench, open } = setup({
      layout: withBorder,
      allowDrop: (tabs) =>
        tabs.every(
          (node) => !(node.getConfig() as { href?: string }).href?.startsWith("/documents/D"),
        ),
    });
    workbench.connectBrowser();
    await open("A", "main");
    const b = await open("B", "main");
    const c = await open("C", "other");
    await workbench.dispatch(Actions.selectTab(b));
    const model = integrationState(workbench).model;
    const focus = vi.fn<() => void>();
    integrationState(workbench).register(b, { focus });
    const before = workbench.getLayout();
    const refusal = await workbench.open(
      { to: "/documents/$id", params: { id: "D" }, search: { view: "edit" } },
      { target: "other" },
    );
    expect(refusal).toMatchObject({ status: "failed", stage: "load" });
    expect(workbench.getLayout()).toEqual(before);
    expect(model.getActiveTabset()?.getId()).toBe("main");
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(window.location.pathname).toBe("/documents/B");

    const background = await workbench.open(
      { to: "/documents/$id", params: { id: "E" }, search: { view: "edit" } },
      { target: "other", background: true },
    );
    expect(background).toMatchObject({ status: "committed" });
    expect(model.getActiveTabset()?.getId()).toBe("main");
    expect((model.getNodeById("main") as TabSetNode).getSelectedNode()?.getId()).toBe(b);
    expect((model.getNodeById("other") as TabSetNode).getSelectedNode()?.getId()).toBe(c);
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(window.location.pathname).toBe("/documents/B");
    expect(focus).not.toHaveBeenCalled();

    const foreground = await workbench.open(
      { to: "/documents/$id", params: { id: "F" }, search: { view: "edit" } },
      { target: "other" },
    );
    if (foreground.status !== "committed") throw new Error("Foreground admission failed");
    expect(model.getActiveTabset()?.getId()).toBe("other");
    expect((model.getNodeById("other") as TabSetNode).getSelectedNode()?.getId()).toBe(
      foreground.document.id,
    );
    expect(workbench.getActiveDocument()?.id).toBe(foreground.document.id);
    expect(window.location.pathname).toBe("/documents/F");
    expect(focus).not.toHaveBeenCalled();
  });

  it("cleans provisional nodes and Router resources when the docking policy throws", async () => {
    const policyError = new Error("Docking policy failed");
    const onIssue = vi.fn<NonNullable<WorkbenchOptions<AnyRouter>["onIssue"]>>();
    const { workbench, open, routers } = setup({
      layout: withBorder,
      onIssue,
      allowDrop: (tabs) => {
        if (
          tabs.some((node) =>
            (node.getConfig() as { href?: string }).href?.startsWith("/documents/D"),
          )
        )
          throw policyError;
        return true;
      },
    });
    workbench.connectBrowser();
    const a = await open("A", "main");
    const before = workbench.getLayout();
    const result = await workbench.open(
      { to: "/documents/$id", params: { id: "D" }, search: { view: "edit" } },
      { target: "other" },
    );
    expect(result).toEqual({ status: "failed", stage: "load", error: policyError });
    expect(onIssue).toHaveBeenCalledWith({ code: "operation-failed", error: policyError });
    expect(workbench.getLayout()).toEqual(before);
    expect(workbench.getDocuments().map((document) => document.id)).toEqual([a]);
    expect(integrationState(workbench).model.getActiveTabset()?.getId()).toBe("main");
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    expect(vi.mocked(routers.at(-1)!.history.destroy)).toHaveBeenCalledTimes(1);
    expect(liveRouters(routers)).toHaveLength(2);
  });

  it("reports a retained provisional node when native cleanup is prevented by a trusted observer", async () => {
    const policyError = new Error("Docking policy failed");
    const cleanupError = new Error("Native deletion was prevented");
    const { workbench, open, routers } = setup({
      layout: withBorder,
      allowDrop: (tabs) => {
        if (
          tabs.some((node) =>
            (node.getConfig() as { href?: string }).href?.startsWith("/documents/D"),
          )
        )
          throw policyError;
        return true;
      },
    });
    await open("A", "main");
    const model = integrationState(workbench).model;
    const observer = {
      onBeforeAction: (action: Action) => {
        if (action.type === Actions.DELETE_TAB) throw cleanupError;
      },
    };
    model.addChangeListener(observer);
    const result = await workbench.open(
      { to: "/documents/$id", params: { id: "D" }, search: { view: "edit" } },
      { target: "other" },
    );
    model.removeChangeListener(observer);
    expect(result).toMatchObject({
      status: "failed",
      stage: "load",
      error: expect.any(AggregateError),
    });
    if (result.status !== "failed" || !(result.error instanceof AggregateError))
      throw new Error("Expected observable cleanup failure");
    expect(result.error.errors).toEqual([
      policyError,
      cleanupError,
      expect.objectContaining({ message: expect.stringContaining("remains in the native layout") }),
    ]);
    const nativeTabs: TabNode[] = [];
    model.visitNodes((node) => {
      if (node instanceof TabNode) nativeTabs.push(node);
    });
    expect(nativeTabs).toHaveLength(2);
    const provisional = nativeTabs.find((node) =>
      (node.getConfig() as { href: string }).href.startsWith("/documents/D"),
    );
    expect(provisional).toBeInstanceOf(TabNode);
    expect(workbench.getDocument(provisional!.getId())).toBeNull();
    expect(vi.mocked(routers.at(-1)!.history.destroy)).toHaveBeenCalledTimes(1);
    model.doAction(Actions.deleteTab(provisional!.getId()));
  });

  it("refuses native idMap entries for already-pruned target containers", async () => {
    const { workbench } = setup({
      tools: [{ id: "outline", render: () => null }],
      layout: {
        layout: {
          children: [
            { type: "tabset", id: "ghost", children: [] },
            {
              type: "tabset",
              id: "main",
              children: [
                {
                  id: "original",
                  component: "worksplit.document",
                  config: { href: "/documents/A" },
                },
              ],
            },
          ],
        },
      },
    });
    const model = integrationState(workbench).model;
    expect(model.getNodeById("ghost")).toBeInstanceOf(TabSetNode);
    expect(tabsets(workbench).map((node) => node.getId())).not.toContain("ghost");
    const observer = vi.fn<(action: Action) => void>();
    model.addChangeListener(observer);
    const before = workbench.getLayout();
    expect(
      await workbench.dispatch(
        Actions.addTab(
          { id: "outline", component: "worksplit.tool" },
          "ghost",
          DockLocation.CENTER,
          -1,
        ),
      ),
    ).toEqual({ status: "rejected" });
    expect(observer).not.toHaveBeenCalled();
    expect(workbench.getLayout()).toEqual(before);
    model.removeChangeListener(observer);
  });

  it("reports rejection when upstream returns a detached pinned tool for a group insertion", async () => {
    const { workbench, open } = setup({
      layout: withBorder,
      tools: [{ id: "outline", render: () => null }],
    });
    workbench.connectBrowser();
    const a = await open("A", "main");
    const groupId = await group(workbench, a);
    const before = workbench.getLayout();
    const action = Actions.addTab(
      { id: "outline", component: "worksplit.tool", pinned: true },
      groupId,
      DockLocation.CENTER,
      -1,
    );
    const upstream = Model.fromJson(before);
    expect(upstream.doAction(action)).toBeInstanceOf(TabNode);
    expect(upstream.getNodeById("outline")).toBeUndefined();
    expect(upstream.toJson()).toEqual(before);
    const observer = vi.fn<(action: Action) => void>();
    integrationState(workbench).model.addChangeListener(observer);
    expect(await workbench.dispatch(action)).toEqual({ status: "rejected" });
    expect(observer.mock.calls).toEqual([[action]]);
    expect(integrationState(workbench).model.getNodeById("outline")).toBeUndefined();
    expect(workbench.getLayout()).toEqual(before);
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    integrationState(workbench).model.removeChangeListener(observer);
  });

  it("rejects document identities reserved by a tool before creating any Router", () => {
    const { makeRouter } = setup();
    const factory = vi.fn<typeof makeRouter>(makeRouter);
    expect(() =>
      createWorkbench({
        createRouter: factory,
        tools: [{ id: "outline", render: () => null }],
        layout: {
          layout: {
            children: [
              {
                type: "tabset",
                children: [
                  {
                    id: "outline",
                    component: "worksplit.document",
                    config: { href: "/documents/A" },
                  },
                ],
              },
            ],
          },
        },
      }),
    ).toThrow(/tool id outline conflicts with a document identity/);
    expect(factory).not.toHaveBeenCalled();
  });

  it("skips tool identities reserved outside the native tree when generating document ids", async () => {
    const originalRandom = crypto.getRandomValues.bind(crypto);
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((value) => {
      if (value instanceof Uint32Array && value.length === 4) {
        value.fill(0);
        return value;
      }
      return originalRandom(value);
    });
    try {
      const prefix = "00000000".repeat(4);
      const reserved = `document-${prefix}-1`;
      const { workbench, open } = setup({ tools: [{ id: reserved, render: () => null }] });
      expect(integrationState(workbench).model.getNodeById(reserved)).toBeUndefined();
      const a = await open("A");
      expect(a).toBe(`document-${prefix}-2`);
      expect(workbench.getDocument(reserved)).toBeNull();
      expect(workbench.getDocument(a)?.href).toContain("/documents/A");
    } finally {
      random.mockRestore();
    }
  });
});

describe("native close coordination", () => {
  it("finishes resource cleanup after a native after-action observer throws following deletion", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const cleanup = vi.fn<() => void>();
    integrationState(workbench).register(a, { dispose: cleanup });
    const router = integrationState(workbench).documents.get(a)?.router;
    if (!router) throw new Error("Missing document Router");
    const destroy = vi.spyOn(router.history, "destroy");
    const observerError = new Error("Native observer failed after removal");
    const listener = {
      onAfterAction: () => {
        throw observerError;
      },
    };
    const model = integrationState(workbench).model;
    model.addChangeListener(listener);
    const result = await workbench.close(a);
    model.removeChangeListener(listener);
    expect(result).toMatchObject({ status: "closed", cleanupErrors: [observerError] });
    expect(native(workbench).getNodeById(a)).toBeUndefined();
    expect(workbench.getDocument(a)).toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    await workbench.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("retains the document and router resources when a native before-action observer prevents deletion", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const cleanup = vi.fn<() => void>();
    integrationState(workbench).register(a, { dispose: cleanup });
    const router = integrationState(workbench).documents.get(a)?.router;
    if (!router) throw new Error("Missing document Router");
    const destroy = vi.spyOn(router.history, "destroy");
    const observerError = new Error("Native observer failed before removal");
    const listener = {
      onBeforeAction: () => {
        throw observerError;
      },
    };
    const model = integrationState(workbench).model;
    model.addChangeListener(listener);
    const result = await workbench.close(a);
    model.removeChangeListener(listener);
    expect(result).toEqual({ status: "failed", error: observerError });
    expect(native(workbench).getNodeById(a)).toBeInstanceOf(TabNode);
    expect(workbench.getDocument(a)).not.toBeNull();
    expect(integrationState(workbench).documents.get(a)?.router).toBe(router);
    expect(destroy).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(await workbench.close(a)).toMatchObject({ status: "closed" });
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("rejects a retained lifecycle registration callback after the native tool closes", async () => {
    const tool = { id: "search", render: () => null };
    const { workbench } = setup({
      tools: [tool],
      layout: {
        ...withBorder,
        borders: [
          {
            type: "border",
            location: "bottom",
            children: [
              {
                type: "tab",
                id: tool.id,
                component: "worksplit.tool",
                name: "Search",
              },
            ],
          },
        ],
      },
    });
    const register = (lifecycle: WorkbenchContentLifecycle) =>
      integrationState(workbench).register(tool.id, lifecycle);
    const cleanup = vi.fn<() => void>();
    const lateCleanup = vi.fn<() => void>();
    const unregister = register({ dispose: cleanup });
    expect(await workbench.dispatch(Actions.deleteTab(tool.id))).toMatchObject({
      status: "closed",
    });
    expect(native(workbench).getNodeById(tool.id)).toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(() => register({ dispose: lateCleanup })).toThrow("Cannot register closed content");
    unregister();
    await workbench.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(lateCleanup).not.toHaveBeenCalled();
  });

  it("closes every collapsed group member through native tabset removal and leaves other containers alive", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    const a = await open("A", "main");
    const b = await open("B", "main");
    const d = await open("D", "other");
    const groupId = await group(workbench, a);
    await workbench.dispatch(Actions.moveNode(b, groupId, DockLocation.CENTER, -1));
    await workbench.dispatch(Actions.updateNodeAttributes(groupId, { opened: false }));
    workbench.activate(d);
    const cleanupA = vi.fn<() => void>();
    const cleanupB = vi.fn<() => void>();
    const cleanupD = vi.fn<() => void>();
    integrationState(workbench).register(a, { dispose: cleanupA });
    integrationState(workbench).register(b, { dispose: cleanupB });
    integrationState(workbench).register(d, { dispose: cleanupD });
    expect(await workbench.dispatch(Actions.deleteTabset("main"))).toMatchObject({
      status: "closed",
      cleanupErrors: [],
    });
    expect(workbench.getDocuments().map((document) => document.id)).toEqual([d]);
    expect(native(workbench).getNodeById(groupId)).toBeUndefined();
    expect(native(workbench).getNodeById("main")).toBeUndefined();
    expect(container(tab(workbench, d)).getId()).toBe("other");
    expect(workbench.getActiveDocument()?.id).toBe(d);
    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).toHaveBeenCalledTimes(1);
    expect(cleanupD).not.toHaveBeenCalled();
  });

  it("preserves a native non-closeable group while closing the tabset's eligible siblings", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    const a = await open("A", "main");
    const b = await open("B", "main");
    const c = await open("C", "main");
    const groupId = await group(workbench, a);
    await workbench.dispatch(Actions.moveNode(b, groupId, DockLocation.CENTER, -1));
    expect(
      await workbench.dispatch(Actions.updateNodeAttributes(a, { enableClose: false })),
    ).toEqual({ status: "applied" });
    const decision = vi.fn<() => boolean>(() => false);
    integrationState(workbench).register(a, { isDirty: () => true, beforeLeave: decision });
    integrationState(workbench).register(b, { isDirty: () => true, beforeLeave: decision });
    expect(native(workbench).getNodeById(groupId)?.isCloseable()).toBe(false);
    expect(await workbench.dispatch(Actions.deleteTabset("main"))).toMatchObject({
      status: "closed",
    });
    expect(workbench.getDocument(c)).toBeNull();
    expect(
      workbench
        .getDocuments()
        .map((document) => document.id)
        .toSorted(),
    ).toEqual([a, b].toSorted());
    expect(native(workbench).getNodeById(groupId)).toBeInstanceOf(TabGroupNode);
    expect(decision).not.toHaveBeenCalled();
  });

  it("rejects dirty group and tabset closes without deleting an earlier approved member", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    const a = await open("A", "main");
    const b = await open("B", "main");
    const groupId = await group(workbench, a);
    await workbench.dispatch(Actions.moveNode(b, groupId, DockLocation.CENTER, -1));
    const approve = vi.fn<() => boolean>(() => true);
    const reject = vi.fn<() => boolean>(() => false);
    const cleanup = vi.fn<() => void>();
    integrationState(workbench).register(a, {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: approve,
      dispose: cleanup,
    });
    integrationState(workbench).register(b, {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: reject,
      dispose: cleanup,
    });
    const before = workbench.getLayout();
    expect(
      await workbench.dispatch(Actions.group([Actions.deleteTab(a), Actions.deleteTab(b)])),
    ).toEqual({ status: "rejected", reason: "decision" });
    expect(workbench.getLayout()).toEqual(before);
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(cleanup).not.toHaveBeenCalled();
    expect(await workbench.dispatch(Actions.deleteTabset("main"))).toEqual({
      status: "rejected",
      reason: "decision",
    });
    expect(workbench.getLayout()).toEqual(before);
    expect(approve).toHaveBeenCalledTimes(2);
    expect(reject).toHaveBeenCalledTimes(2);
  });

  it("lets the application reject edits that arrive during a bulk close decision", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    const approval = deferred(true);
    let editingRevision = 0;
    integrationState(workbench).register(a, {
      isDirty: () => true,
      getCloseRevision: () => editingRevision,
      beforeLeave: () => {
        const expected = editingRevision;
        return approval.promise.then((accepted) => accepted && expected === editingRevision);
      },
    });
    const closing = workbench.dispatch(Actions.group([Actions.deleteTab(a), Actions.deleteTab(b)]));
    ++editingRevision;
    approval.resolve(true);
    expect(await closing).toEqual({ status: "rejected", reason: "decision" });
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("retains an earlier approved document when it changes while another bulk decision is pending", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    let revisionA = 0;
    const approvalB = deferred(true);
    const decideA = vi.fn<() => boolean>(() => true);
    const decideB = vi.fn<() => Promise<boolean>>(() => approvalB.promise);
    const cleanup = vi.fn<() => void>();
    integrationState(workbench).register(a, {
      isDirty: () => true,
      getCloseRevision: () => revisionA,
      beforeLeave: decideA,
      dispose: cleanup,
    });
    integrationState(workbench).register(b, {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: decideB,
      dispose: cleanup,
    });
    const closing = workbench.dispatch(Actions.group([Actions.deleteTab(a), Actions.deleteTab(b)]));
    await vi.waitFor(() => expect(decideB).toHaveBeenCalledTimes(1));
    expect(decideA).toHaveBeenCalledTimes(1);
    ++revisionA;
    approvalB.resolve(true);
    expect(await closing).toEqual({ status: "rejected", reason: "changed" });
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(native(workbench).getNodeById(a)).toBeInstanceOf(TabNode);
    expect(native(workbench).getNodeById(b)).toBeInstanceOf(TabNode);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("requires an application's existing revision for dirty bulk closing before requesting decisions", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    const decide = vi.fn<() => boolean>(() => true);
    integrationState(workbench).register(a, { isDirty: () => true, beforeLeave: decide });
    expect(
      await workbench.dispatch(Actions.group([Actions.deleteTab(a), Actions.deleteTab(b)])),
    ).toEqual({
      status: "rejected",
      reason: "revision-required",
    });
    expect(decide).not.toHaveBeenCalled();
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(await workbench.close(a)).toMatchObject({ status: "closed" });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(workbench.getDocument(b)).not.toBeNull();
  });

  it("retains an approved member whose revision capability is withdrawn while another decision is pending", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    const approvalB = deferred(true);
    const decideA = vi.fn<() => boolean>(() => true);
    const decideB = vi.fn<() => Promise<boolean>>(() => approvalB.promise);
    const cleanup = vi.fn<() => void>();
    const lifecycleA: WorkbenchContentLifecycle = {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: decideA,
      dispose: cleanup,
    };
    integrationState(workbench).register(a, lifecycleA);
    integrationState(workbench).register(b, {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: decideB,
      dispose: cleanup,
    });
    const before = workbench.getLayout();
    const closing = workbench.dispatch(Actions.group([Actions.deleteTab(a), Actions.deleteTab(b)]));
    await vi.waitFor(() => expect(decideB).toHaveBeenCalledTimes(1));
    expect(decideA).toHaveBeenCalledTimes(1);
    delete lifecycleA.getCloseRevision;
    approvalB.resolve(true);
    expect(await closing).toEqual({ status: "rejected", reason: "changed" });
    expect(workbench.getLayout()).toEqual(before);
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(native(workbench).getNodeById(a)).toBeInstanceOf(TabNode);
    expect(native(workbench).getNodeById(b)).toBeInstanceOf(TabNode);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("retains a previously clean document that becomes dirty during another member's decision", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    let dirtyA = false;
    const approvalB = deferred(true);
    const decideA = vi.fn<() => boolean>(() => true);
    const decideB = vi.fn<() => Promise<boolean>>(() => approvalB.promise);
    integrationState(workbench).register(a, { isDirty: () => dirtyA, beforeLeave: decideA });
    integrationState(workbench).register(b, {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: decideB,
    });
    const closing = workbench.dispatch(Actions.group([Actions.deleteTab(a), Actions.deleteTab(b)]));
    await vi.waitFor(() => expect(decideB).toHaveBeenCalledTimes(1));
    dirtyA = true;
    approvalB.resolve(true);
    expect(await closing).toEqual({ status: "rejected", reason: "changed" });
    expect(decideA).not.toHaveBeenCalled();
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("reports a failing application revision getter while retaining the native tabs and resources", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    const error = new Error("Application revision unavailable");
    const decide = vi.fn<() => boolean>(() => true);
    const cleanup = vi.fn<() => void>();
    integrationState(workbench).register(a, {
      isDirty: () => true,
      getCloseRevision: () => {
        throw error;
      },
      beforeLeave: decide,
      dispose: cleanup,
    });
    expect(
      await workbench.dispatch(Actions.group([Actions.deleteTab(a), Actions.deleteTab(b)])),
    ).toEqual({
      status: "failed",
      error,
    });
    expect(decide).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(native(workbench).getNodeById(a)).toBeInstanceOf(TabNode);
  });

  it("invalidates all pending deletes when native navigation changes a member's accepted route", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    const approval = deferred(true);
    integrationState(workbench).register(a, {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: (reason) => (reason === "close" ? approval.promise : true),
    });
    const closing = workbench.dispatch(Actions.group([Actions.deleteTab(a), Actions.deleteTab(b)]));
    const router = integrationState(workbench).documents.get(a)?.router;
    if (!router) throw new Error("Missing document Router");
    await router.navigate({ href: "/documents/A?view=preview" });
    approval.resolve(true);
    expect(await closing).toEqual({ status: "rejected", reason: "changed" });
    expect(workbench.getDocuments()).toHaveLength(2);
    expect(workbench.getDocument(a)?.href).toContain("view=preview");
  });

  it("invalidates tabset deletion when its closeable membership changes during the decision", async () => {
    const { workbench, open } = setup({ layout: withBorder });
    const a = await open("A", "main");
    await open("B", "main");
    const approval = deferred(true);
    integrationState(workbench).register(a, {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: () => approval.promise,
    });
    const closing = workbench.dispatch(Actions.deleteTabset("main"));
    const c = await open("C", "main");
    approval.resolve(true);
    expect(await closing).toEqual({ status: "rejected", reason: "changed" });
    expect(workbench.getDocuments()).toHaveLength(3);
    expect(workbench.getDocument(c)).not.toBeNull();
    expect(native(workbench).getNodeById("main")).toBeInstanceOf(TabSetNode);
  });

  it.each(["pin", "closeability"] as const)(
    "invalidates a pending close when native %s changes",
    async (change) => {
      const { workbench, open } = setup();
      const a = await open("A");
      const approval = deferred(true);
      integrationState(workbench).register(a, {
        isDirty: () => true,
        beforeLeave: () => approval.promise,
      });
      const closing = workbench.close(a);
      expect(
        await workbench.dispatch(
          change === "pin"
            ? Actions.setTabPinned(a, true)
            : Actions.updateNodeAttributes(a, { enableClose: false }),
        ),
      ).toEqual({ status: "applied" });
      approval.resolve(true);
      expect(await closing).toEqual({ status: "rejected", reason: "changed" });
      expect(workbench.getDocument(a)).not.toBeNull();
      expect(native(workbench).getNodeById(a)).toBeInstanceOf(TabNode);
    },
  );

  it("rejects native deletion of non-closeable documents without asking to discard them", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    const decide = vi.fn<() => boolean>(() => false);
    integrationState(workbench).register(a, { isDirty: () => true, beforeLeave: decide });
    integrationState(workbench).register(b, { isDirty: () => true, beforeLeave: decide });
    await workbench.dispatch(Actions.setTabPinned(a, true));
    await workbench.dispatch(Actions.updateNodeAttributes(b, { enableClose: false }));
    expect(await workbench.close(a)).toEqual({ status: "rejected", reason: "not-closeable" });
    expect(await workbench.dispatch(Actions.deleteTab(b))).toEqual({
      status: "rejected",
      reason: "not-closeable",
    });
    expect(decide).not.toHaveBeenCalled();
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("shares duplicate closes, explicitly rejects partial overlaps, and waits for cleanup once", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    const approvalA = deferred(true);
    const approvalB = deferred(true);
    const releaseA = deferred<void>(undefined);
    const releaseB = deferred<void>(undefined);
    const decideA = vi.fn<() => Promise<boolean>>(() => approvalA.promise);
    const decideB = vi.fn<() => Promise<boolean>>(() => approvalB.promise);
    const cleanupA = vi.fn<() => Promise<void>>(() => releaseA.promise);
    const cleanupB = vi.fn<() => Promise<void>>(() => releaseB.promise);
    integrationState(workbench).register(a, {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: decideA,
      dispose: cleanupA,
    });
    integrationState(workbench).register(b, {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: decideB,
      dispose: cleanupB,
    });
    const batch = () => Actions.group([Actions.deleteTab(a), Actions.deleteTab(b)]);
    const first = workbench.dispatch(batch());
    const duplicate = workbench.dispatch(batch());
    const overlap = workbench.close(b);
    expect(decideB).not.toHaveBeenCalled();
    expect(await overlap).toEqual({ status: "rejected", reason: "closing" });
    expect(decideA).toHaveBeenCalledTimes(1);
    approvalA.resolve(true);
    await vi.waitFor(() => expect(decideB).toHaveBeenCalledTimes(1));
    approvalB.resolve(true);
    await vi.waitFor(() => expect(cleanupA).toHaveBeenCalledTimes(1));
    expect(cleanupB).toHaveBeenCalledTimes(1);
    expect(workbench.getDocuments()).toHaveLength(0);
    let settled = false;
    void first.then(() => {
      settled = true;
      return undefined;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseA.resolve(undefined);
    releaseB.resolve(undefined);
    expect(await first).toMatchObject({ status: "closed", cleanupErrors: [] });
    expect(await duplicate).toEqual(await first);
    await workbench.dispose();
    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).toHaveBeenCalledTimes(1);
  });

  it("keeps a late restored loader from resurrecting a removed grouped document", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    const groupId = await group(workbench, a);
    await workbench.dispatch(Actions.moveNode(b, groupId, DockLocation.CENTER, -1));
    const snapshot = workbench.snapshot();
    const gate = deferred("late");
    let loaderFinished = false;
    const { makeRouter } = setup({}, async () => {
      const value = await gate.promise;
      loaderFinished = true;
      return value;
    });
    const restored = createWorkbench({ createRouter: makeRouter, snapshot });
    disposals.push(() => restored.dispose());
    const cleanup = vi.fn<() => void>();
    integrationState(restored).register(a, { dispose: cleanup });
    restored.activate(a);
    await vi.waitFor(() =>
      expect(integrationState(restored).documents.get(a)?.router?.state.isLoading).toBe(true),
    );
    const router = integrationState(restored).documents.get(a)?.router;
    if (!router) throw new Error("Missing pending document Router");
    expect(
      await restored.dispatch(Actions.group([Actions.deleteTab(a), Actions.deleteTab(b)])),
    ).toMatchObject({ status: "closed" });
    expect(restored.getDocuments()).toHaveLength(0);
    gate.resolve("late");
    await vi.waitFor(() => {
      expect(loaderFinished).toBe(true);
      expect(router.state.isLoading).toBe(false);
    });
    expect(restored.getDocument(a)).toBeNull();
    expect(native(restored).getNodeById(a)).toBeUndefined();
    expect(native(restored).getNodeById(groupId)).toBeUndefined();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
