/* eslint-disable no-await-in-loop -- Native scenarios and resource teardown deliberately run in order. */
import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import {
  Actions,
  BorderNode,
  DockLocation,
  TabGroupNode,
  TabNode,
  TabSetNode,
  type Action,
  type IJsonModel,
} from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLayoutPolicy,
  createWorkbench,
  type ContentController,
  type LeaveDecision,
  type WorkbenchInstance,
  type WorkbenchOptions,
} from "./index";
import { integrationState } from "./internal";
import { tabContainer, tabsIn } from "./native-layout";

const instances: WorkbenchInstance<AnyRouter>[] = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.dispose();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const empty: IJsonModel = { layout: { type: "row", children: [] } };
const withBorder: IJsonModel = {
  borders: [{ type: "border", location: "bottom", selected: -1, children: [] }],
  layout: {
    type: "row",
    children: [
      { type: "tabset", id: "main", enableDeleteWhenEmpty: false, children: [] },
      { type: "tabset", id: "other", enableDeleteWhenEmpty: false, children: [] },
    ],
  },
};
function fixture(options: Partial<WorkbenchOptions<AnyRouter>> = {}) {
  const root = createRootRoute();
  const tree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/documents/$id" }),
  ]);
  const routers: AnyRouter[] = [];
  const create = (history: Parameters<WorkbenchOptions<AnyRouter>["createRouter"]>[0]) => {
    const router = createRouter({ routeTree: tree, history });
    routers.push(router);
    return router;
  };
  const instance = createWorkbench({
    workspaceId: "native-layout-tests",
    home: { mode: "empty", href: "/" },
    createRouter: create,
    ...options,
  });
  instances.push(instance);
  const own = (id: string, controller: ContentController) => {
    const internal = integrationState(instance),
      handle = instance.getContent(id)!.handle,
      owner = { controller };
    return {
      unregister: internal.registerController(handle, owner),
      update: (next: ContentController) => internal.updateController(handle, owner, next),
    };
  };
  const open = async (id: string, target?: string) => {
    const result = await instance.open(
      { to: "/documents/$id", params: { id } },
      target ? { destination: { target, location: DockLocation.CENTER } } : {},
    );
    if (result.status !== "applied") throw new Error(JSON.stringify(result));
    return result.value.document;
  };
  return { instance, own, open, routers, create };
}
async function setup(options: Partial<WorkbenchOptions<AnyRouter>> = {}, browser = false) {
  const value = fixture(options);
  await value.instance.start(browser ? { browser: { window, onOutsideNavigate: () => {} } } : {});
  return value;
}
async function group(instance: WorkbenchInstance<AnyRouter>, id: string) {
  expect(
    (await instance.dispatch(Actions.addTabToNewGroup(id, "Research", "#3366cc"))).status,
  ).toBe("applied");
  const node = instance.model.getNodeById(id)?.getParent();
  if (!(node instanceof TabGroupNode)) throw new Error("Expected native group");
  return node;
}
const add = (id = "notes") =>
  Actions.addTab({ id, component: "notes" }, "main", DockLocation.CENTER, -1);
const allow: ContentController = {
  leave: {
    getState: () => ({ hasUnsavedChanges: true, token: 1 }),
    decide: () => ({ decision: "allow", token: 1 }),
  },
};

describe("the single native Model", () => {
  it.each([
    { layout: {} },
    { layout: { type: "row" } },
    {
      borders: [{ type: "border", location: "bottom" }],
      layout: { children: [{ type: "tabset", enableDeleteWhenEmpty: false }] },
    },
  ] satisfies IJsonModel[])(
    "accepts native omitted defaults and exports only after start: %j",
    async (layout) => {
      const { instance } = fixture({ initial: { layout } });
      expect(() => instance.createSnapshot()).toThrow("running");
      await instance.start();
      expect(instance.model.getRootRow()).toBeDefined();
      expect(instance.getContainers().filter((item) => item.kind === "tabset")).toHaveLength(1);
      const snapshot = instance.createSnapshot();
      const restored = fixture({ initial: { snapshot } });
      expect(restored.routers).toHaveLength(0);
      await restored.instance.start();
      expect(restored.instance.model.getRootRow()!.getId()).toBe(snapshot.layout.layout.id);
      expect(
        restored.instance.getContainers().filter((item) => item.kind === "tabset"),
      ).toHaveLength(1);
    },
  );
  it("preserves generated native identities and lazy restored grouped documents", async () => {
    const { instance, open } = await setup();
    const a = await open("A"),
      b = await open("B");
    const nativeGroup = await group(instance, a.id);
    await instance.dispatch(Actions.moveNode(b.id, nativeGroup.getId(), DockLocation.CENTER, -1));
    await instance.dispatch(
      Actions.updateNodeAttributes(nativeGroup.getId(), {
        name: "Saved",
        color: "#ab12ef",
        opened: false,
      }),
    );
    const snapshot = instance.createSnapshot();
    const restored = fixture({ initial: { snapshot } });
    expect(restored.routers).toHaveLength(0);
    expect(restored.instance.getDocuments().map((doc) => doc.id)).toEqual([a.id, b.id]);
    expect(restored.instance.model.getNodeById(nativeGroup.getId())?.toJson()).toMatchObject({
      name: "Saved",
      opened: false,
    });
    await restored.instance.start();
    expect(restored.routers).toHaveLength(1);
    expect(restored.instance.getDocument(a.id)?.handle).not.toBe(a.handle);
  });
  it.each([
    { layout: { type: "tabset", children: [] } },
    { layout: [] },
    { layout: { children: {} } },
    { layout: { children: [{ type: "unknown" }] } },
    {
      layout: {
        children: [
          { type: "tabset", id: "same" },
          { type: "tabset", id: "same" },
        ],
      },
    },
    { layout: { id: "", children: [] } },
    { global: { tabEnableFloat: true }, ...empty },
    { ...empty, popouts: { ghost: {} } },
    { ...empty, subLayouts: { ghost: {} } },
    {
      layout: {
        children: [
          {
            type: "tabset",
            children: [
              {
                component: "worksplit:document",
                children: [],
                config: { worksplit: { href: "/documents/A" } },
              },
            ],
          },
        ],
      },
    },
    {
      borders: [{ location: "bottom" }],
      layout: {
        children: [{ type: "tabset", children: [{ id: "border_bottom", component: "notes" }] }],
      },
    },
  ])("rejects malformed, conflicting or unsupported input before any Router: %j", (layout) => {
    const create = vi.fn<WorkbenchOptions<AnyRouter>["createRouter"]>();
    expect(() =>
      createWorkbench({
        createRouter: create,
        tools: { notes: { render: () => null } },
        initial: { layout: layout as unknown as IJsonModel },
      }),
    ).toThrow(/native|unsupported|Floating|Popouts|Invalid/iu);
    expect(create).not.toHaveBeenCalled();
  });
  it("allows native false/undefined capability resets while rejecting float/popout enabling atomically", async () => {
    const { instance, open } = await setup();
    const a = await open("A");
    expect(
      (
        await instance.dispatch(
          Actions.updateNodeAttributes(a.id, { enableFloat: false, enablePopout: false }),
        )
      ).status,
    ).toBe("applied");
    expect(
      (
        await instance.dispatch(
          Actions.updateNodeAttributes(a.id, {
            enableFloat: undefined,
            enablePopout: undefined,
          } as unknown as Parameters<typeof Actions.updateNodeAttributes>[1]),
        )
      ).status,
    ).toBe("applied");
    expect(
      (
        await instance.dispatch(
          Actions.updateModelAttributes({
            tabEnableFloat: undefined,
            tabEnablePopout: undefined,
          } as unknown as Parameters<typeof Actions.updateModelAttributes>[0]),
        )
      ).status,
    ).toBe("applied");
    expect(Boolean(a.node.isEnableFloat())).toBe(false);
    expect(Boolean(a.node.isEnablePopout())).toBe(false);
    const before = instance.createSnapshot();
    expect(
      (await instance.dispatch(Actions.updateNodeAttributes(a.id, { enableFloat: true }))).status,
    ).toBe("denied");
    expect(
      (await instance.dispatch(Actions.updateModelAttributes({ tabEnablePopout: true }))).status,
    ).toBe("denied");
    expect(instance.createSnapshot()).toEqual(before);
  });
  it("lets native tidy prune ordinary empty containers and preserves an explicitly retained one", async () => {
    const { instance, open } = await setup();
    const a = await open("A"),
      b = await open("B");
    const nodes = [a.node, b.node];
    for (const edge of [DockLocation.RIGHT, DockLocation.BOTTOM, DockLocation.LEFT]) {
      await instance.dispatch(
        Actions.moveNode(b.id, instance.getDocument(a.id)!.containerId!, edge, -1),
      );
      expect(instance.getContainers().filter((item) => item.kind === "tabset")).toHaveLength(2);
    }
    expect(instance.getDocument(a.id)?.node).toBe(nodes[0]);
    expect(instance.getDocument(b.id)?.node).toBe(nodes[1]);
    await instance.close([a.id, b.id]);
    expect(instance.getContainers()).toHaveLength(1);
    expect(instance.getContainers()[0]?.tabIds).toEqual([]);
    expect((await open("C")).node).toBeInstanceOf(TabNode);
    const retained = await setup({ initial: { layout: withBorder } });
    const c = await retained.open("C", "main");
    await retained.instance.close(c.id);
    expect(retained.instance.model.getNodeById("main")).toBeInstanceOf(TabSetNode);
  });
  it("does not admit a stale target after its final member was removed", async () => {
    const { instance, open } = await setup();
    const a = await open("A"),
      b = await open("B");
    await instance.dispatch(Actions.moveNode(b.id, a.containerId!, DockLocation.RIGHT, -1));
    const stale = instance.getDocument(b.id)!.containerId!;
    await instance.close(b.id);
    expect(instance.model.getNodeById(stale)).toBeUndefined();
    const count = instance.getDocuments().length;
    expect(
      (
        await instance.open(
          { href: "/documents/C" },
          { destination: { target: stale, location: DockLocation.CENTER } },
        )
      ).status,
    ).toBe("denied");
    expect(instance.getDocuments()).toHaveLength(count);
  });
  it("keeps background naming and selected attributes local while native grouped collapse changes active selection", async () => {
    const { instance, open } = await setup({ initial: { layout: withBorder } }, true);
    const a = await open("A", "main"),
      b = await open("B", "other"),
      c = await open("C", "other");
    await instance.activate(a.id);
    await instance.dispatch(Actions.renameTab(b.id, "Background"));
    await instance.dispatch(Actions.updateNodeAttributes("other", { selected: 0 }));
    expect(instance.getActiveDocument()?.id).toBe(a.id);
    expect(window.location.pathname).toBe("/documents/A");
    const nativeGroup = await group(instance, b.id);
    await instance.activate(b.id);
    await instance.dispatch(Actions.updateNodeAttributes(nativeGroup.getId(), { opened: false }));
    expect(instance.model.getActiveTabset()?.getSelectedNode()?.getId()).toBe(c.id);
    expect(instance.getActiveDocument()?.id).toBe(c.id);
    expect(window.location.pathname).toBe("/documents/C");
    await instance.activate(b.id);
    expect(nativeGroup.isOpened()).toBe(true);
    expect(b.node.isSelected()).toBe(true);
  });
  it("keeps a Border document URL during tool selection and collapse", async () => {
    const { instance, open } = await setup(
      { initial: { layout: withBorder }, tools: { notes: { render: () => null } } },
      true,
    );
    await open("A", "main");
    const b = await open("B", "border_bottom");
    await instance.dispatch(
      Actions.addTab(
        { id: "notes", component: "notes" },
        "border_bottom",
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    expect(instance.getActiveDocument()?.id).toBe(b.id);
    expect(window.location.pathname).toBe("/documents/B");
    await instance.dispatch(
      Actions.group([Actions.selectTab("notes"), Actions.adjustBorderSplit("border_bottom", 220)]),
    );
    expect(instance.getActiveDocument()?.id).toBe(b.id);
    expect(window.location.pathname).toBe("/documents/B");
  });
  it.each(["scalar", "singleton", "nested singleton"] as const)(
    "follows a real Border selection through a %s Action without replacing it",
    async (wrapper) => {
      const { instance, open } = await setup({ initial: { layout: withBorder } }, true);
      const a = await open("A", "main"),
        b = await open("B", "border_bottom");
      await instance.dispatch(Actions.selectTab(b.id));
      await instance.activate(a.id);
      const leaf = Actions.selectTab(b.id),
        action =
          wrapper === "scalar"
            ? leaf
            : Actions.group([wrapper === "singleton" ? leaf : Actions.group([leaf])]);
      const seen: Action[] = [];
      instance.model.addChangeListener((value) => seen.push(value));
      expect((await instance.dispatch(action)).status).toBe("applied");
      expect(seen).toEqual([action]);
      expect(seen[0]).toBe(action);
      expect(instance.getActiveDocument()?.id).toBe(b.id);
      expect(window.location.pathname).toBe("/documents/B");
    },
  );
  it("uses a pure batch final active Tabset and does not replay an earlier selection", async () => {
    const { instance, open } = await setup({ initial: { layout: withBorder } }, true);
    const a = await open("A", "main"),
      b = await open("B", "other");
    const action = Actions.group([Actions.selectTab(a.id), Actions.setActiveTabset("other")]);
    const seen: Action[] = [];
    instance.model.addChangeListener((value) => seen.push(value));
    expect((await instance.dispatch(action)).status).toBe("applied");
    expect(seen).toEqual([action]);
    expect(instance.getActiveDocument()?.id).toBe(b.id);
    expect(window.location.pathname).toBe("/documents/B");
  });
  it("keeps native Border move visibility and selects only when the original Action selects", async () => {
    const { instance, open } = await setup({
      initial: { layout: withBorder },
      tools: { notes: { render: () => null } },
    });
    const a = await open("A", "main");
    await open("B", "main");
    await instance.dispatch(
      Actions.addTab(
        { id: "notes", component: "notes" },
        "border_bottom",
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    await instance.dispatch(
      Actions.moveNode(a.id, "border_bottom", DockLocation.CENTER, -1, false),
    );
    expect(
      (instance.model.getNodeById("border_bottom") as BorderNode).getSelectedNode()?.getId(),
    ).toBe("notes");
    await instance.dispatch(Actions.moveNode(a.id, "main", DockLocation.CENTER, -1));
    await instance.dispatch(Actions.moveNode(a.id, "border_bottom", DockLocation.CENTER, -1, true));
    expect(instance.getActiveDocument()?.id).toBe(a.id);
  });
  it("preflights native display batches completely before mutation and refuses resource-mixed batches", async () => {
    const { instance, open } = await setup();
    const a = await open("A"),
      b = await open("B");
    const action = Actions.group([
      Actions.renameTab(a.id, "A custom"),
      Actions.setTabPinned(b.id, true),
    ]);
    expect((await instance.dispatch(action)).status).toBe("applied");
    expect(a.node.getName()).toBe("A custom");
    expect(b.node.isPinned()).toBe(true);
    const before = instance.createSnapshot();
    const unsafe = [
      Actions.updateNodeAttributes(a.id, { id: "changed" }),
      Actions.updateNodeAttributes(a.id, { component: "rogue" }),
      Actions.updateNodeAttributes(a.id, { config: { worksplit: { href: "/rogue" } } }),
      Actions.popoutTab(a.id, "float"),
      Actions.deleteTab(a.id),
    ];
    for (const leaf of unsafe)
      expect(
        (await instance.dispatch(Actions.group([Actions.renameTab(a.id, "Must not happen"), leaf])))
          .status,
      ).toBe("denied");
    expect(instance.createSnapshot()).toEqual(before);
  });
  it("applies batched native chrome visibility without serializing or changing content activity", async () => {
    const { instance, open } = await setup({ initial: { layout: withBorder } });
    const a = await open("A", "main");
    const saved = vi.fn<() => void>();
    a.node.setEventListener("save", saved);
    const action = Actions.group([
      Actions.updateNodeAttributes("border_bottom", { show: false }),
      Actions.updateNodeAttributes("main", { name: "Focused", minWidth: 180 }),
    ]);
    expect((await instance.dispatch(action)).status).toBe("applied");
    expect((instance.model.getNodeById("border_bottom") as BorderNode).isShowing()).toBe(false);
    expect(instance.getActiveDocument()?.id).toBe(a.id);
    expect(saved).not.toHaveBeenCalled();
  });
  it("refuses policy-dependent multi-step docking without mutating or saving the Model", async () => {
    const { instance, open } = await setup({
      initial: { layout: withBorder },
      layoutPolicy: createLayoutPolicy({ maxTabsets: 4 }),
    });
    const a = await open("A", "main"),
      b = await open("B", "main");
    const save = vi.fn<() => void>();
    a.node.setEventListener("save", save);
    const observed = vi.fn<() => void>();
    instance.model.addChangeListener(observed);
    const action = Actions.group([
      Actions.moveNode(a.id, "other", DockLocation.CENTER, -1),
      Actions.moveNode(b.id, "other", DockLocation.CENTER, -1),
    ]);
    expect(instance.canDispatch(action)).toBe(false);
    expect((await instance.dispatch(action)).status).toBe("denied");
    expect(save).not.toHaveBeenCalled();
    expect(observed).not.toHaveBeenCalled();
  });
});

describe("native tool admission and record lifetime", () => {
  it("preserves native JSON, explicit IDs and singleton Action identity without constructing Routers", async () => {
    const { instance, routers } = await setup({
      initial: { layout: withBorder },
      tools: { notes: { render: () => null } },
    });
    const leaf = Actions.addTab(
      {
        id: "notes",
        component: "notes",
        name: "Notes",
        config: { section: "symbols" },
        minWidth: 123,
        borderWidth: 245,
      },
      "border_bottom",
      DockLocation.CENTER,
      -1,
      true,
    );
    const action = Actions.group([Actions.group([leaf])]);
    const seen: Action[] = [];
    instance.model.addChangeListener((value) => seen.push(value));
    expect((await instance.dispatch(action)).status).toBe("applied");
    expect(instance.getContent("notes")?.node.toJson()).toMatchObject(leaf.data.json);
    expect(seen).toEqual([action]);
    expect(seen[0]).toBe(action);
    expect(routers).toHaveLength(0);
  });
  it("honors native select=false when admitting a tool into a closed empty Border", async () => {
    const { instance, open } = await setup({
      initial: { layout: withBorder },
      tools: { notes: { render: () => null } },
    });
    const a = await open("A", "main");
    expect(
      (
        await instance.dispatch(
          Actions.addTab(
            { id: "notes", component: "notes" },
            "border_bottom",
            DockLocation.CENTER,
            -1,
            false,
          ),
        )
      ).status,
    ).toBe("applied");
    const border = instance.model.getNodeById("border_bottom") as BorderNode;
    expect(border.getSelectedNode()).toBeUndefined();
    expect(instance.getContent("notes")?.node.getParent()).toBe(border);
    expect(instance.getContext().source).toBe(a.handle);
    await instance.dispatch(Actions.selectTab("notes"));
    expect(instance.getContext().source).toBe(instance.getContent("notes")!.handle);
    expect(instance.getActiveDocument()?.handle).toBe(a.handle);
  });
  it("uses native creation hooks, groups and edge docking for tools", async () => {
    const { instance, open } = await setup({ tools: { notes: { render: () => null } } });
    const a = await open("A");
    const nativeGroup = await group(instance, a.id);
    const hook = vi.fn<() => { minWidth: number }>(() => ({ minWidth: 321 }));
    instance.model.setOnCreateTabSet(hook);
    expect(
      (
        await instance.dispatch(
          Actions.addTab(
            { id: "notes", component: "notes" },
            nativeGroup.getId(),
            DockLocation.CENTER,
            -1,
          ),
        )
      ).status,
    ).toBe("applied");
    expect(instance.getContent("notes")?.node.getParent()).toBe(nativeGroup);
    expect(
      (await instance.dispatch(Actions.moveNode("notes", a.containerId!, DockLocation.RIGHT, -1)))
        .status,
    ).toBe("applied");
    expect(tabContainer(instance.getContent("notes")!.node)?.toJson()).toMatchObject({
      minWidth: 321,
    });
    expect(hook).toHaveBeenCalledOnce();
  });
  it("invalidates a removed tool handle before async cleanup and isolates a reopened same ID", async () => {
    const cleanup = deferred<void>();
    const { instance } = await setup({
      initial: { layout: withBorder },
      tools: { notes: { render: () => null } },
    });
    const admit = () =>
      instance.dispatch(
        Actions.addTab({ id: "notes", component: "notes" }, "main", DockLocation.CENTER, -1),
      );
    await admit();
    const old = instance.getContent("notes")!.handle;
    old.runEffect(({ defer }) => defer(() => cleanup.promise));
    const closing = instance.close(old.id);
    await vi.waitFor(() => expect(instance.getContent(old.id)).toBeNull());
    expect(() => old.runEffect(() => {})).toThrow("Content instance has ended");
    await admit();
    const current = instance.getContent(old.id)!.handle;
    expect(current).not.toBe(old);
    const released = vi.fn<() => void>();
    current.runEffect(({ defer }) => defer(released));
    cleanup.resolve();
    await closing;
    expect(instance.getContent(current.id)?.handle).toBe(current);
    expect(released).not.toHaveBeenCalled();
  });
  it("rejects unregistered, document, malformed, pinned-in-group and floating ADDs before observers", async () => {
    const { instance, open } = await setup({ tools: { notes: { render: () => null } } });
    const a = await open("A");
    const nativeGroup = await group(instance, a.id);
    const observed = vi.fn<() => void>();
    instance.model.addChangeListener(observed);
    const invalid = [
      Actions.addTab({ component: "unknown" }, a.containerId!, DockLocation.CENTER, -1),
      Actions.addTab(
        { component: "worksplit:document", config: { worksplit: { href: "/documents/B" } } },
        a.containerId!,
        DockLocation.CENTER,
        -1,
      ),
      Actions.addTab(
        { component: "notes", enableFloat: true },
        a.containerId!,
        DockLocation.CENTER,
        -1,
      ),
      Actions.addTab(
        { component: "notes", pinned: true },
        nativeGroup.getId(),
        DockLocation.CENTER,
        -1,
      ),
      Actions.addTab(
        { component: "notes", children: [] } as never,
        a.containerId!,
        DockLocation.CENTER,
        -1,
      ),
      Actions.addTab({ component: "notes" }, "missing", DockLocation.CENTER, -1),
    ];
    for (const action of invalid) expect((await instance.dispatch(action)).status).toBe("denied");
    expect(observed).not.toHaveBeenCalled();
  });
  it("rejects multiple ADD and mixed insertion batches without partial admission", async () => {
    const { instance } = await setup({
      initial: { layout: withBorder },
      tools: { notes: { render: () => null } },
    });
    expect((await instance.dispatch(Actions.group([add("one"), add("two")]))).status).toBe(
      "denied",
    );
    expect(
      (
        await instance.dispatch(
          Actions.group([Actions.updateNodeAttributes("main", { name: "Changed" }), add("one")]),
        )
      ).status,
    ).toBe("denied");
    expect(instance.getContent("one")).toBeNull();
    expect(instance.model.getNodeById("main")?.toJson()).not.toMatchObject({ name: "Changed" });
  });
  it("checks docking policy on detached nodes without save/change side effects and leaves no rejected record", async () => {
    const failure = new Error("policy");
    let throwing = false;
    const policy = vi.fn<() => boolean>(() => {
      if (throwing) throw failure;
      return false;
    });
    const { instance } = await setup({
      initial: { layout: withBorder },
      tools: { notes: { render: () => null } },
      allowDrop: policy,
    });
    const observed = vi.fn<() => void>();
    instance.model.addChangeListener(observed);
    expect(instance.canDispatch(add())).toBe(false);
    expect((await instance.dispatch(add())).status).toBe("denied");
    throwing = true;
    expect((await instance.dispatch(add())).status).toBe("denied");
    expect(instance.getContent("notes")).toBeNull();
    expect(observed).not.toHaveBeenCalled();
    expect(instance.model.getNodeById("notes")).toBeUndefined();
  });
});

describe("native close ranges and complete approval", () => {
  it.each(["before", "after"] as const)(
    "reports a native %s observer failure with actual removal and cleanup",
    async (when) => {
      const { instance, open, routers } = await setup();
      const a = await open("A");
      const cleanup = vi.fn<() => void>();
      a.handle.runEffect(({ defer }) => defer(cleanup));
      const failure = new Error("native observer");
      const listener = {
        [when === "before" ? "onBeforeAction" : "onAfterAction"]: (action: Action) => {
          if (action.type === Actions.DELETE_TAB) throw failure;
        },
      };
      instance.model.addChangeListener(listener);
      expect(await instance.close(a.id)).toMatchObject({
        status: "failed",
        error: failure,
        changes: when === "before" ? "none" : "some",
        affectedIds: when === "before" ? [] : [a.id],
      });
      expect(instance.getDocument(a.id) === null).toBe(when === "after");
      expect(cleanup).toHaveBeenCalledTimes(when === "after" ? 1 : 0);
      expect(routers.at(-1)!.history.signal.aborted).toBe(when === "after");
      instance.model.removeChangeListener(listener);
    },
  );
  it("closes collapsed group leaves through a native tabset request and leaves other containers alive", async () => {
    const { instance, open } = await setup({ initial: { layout: withBorder } });
    const a = await open("A", "main"),
      b = await open("B", "main"),
      c = await open("C", "other");
    const nativeGroup = await group(instance, a.id);
    await instance.dispatch(Actions.moveNode(b.id, nativeGroup.getId(), DockLocation.CENTER, -1));
    await instance.dispatch(Actions.updateNodeAttributes(nativeGroup.getId(), { opened: false }));
    const cleanup = vi.fn<() => void>();
    a.handle.runEffect(({ defer }) => defer(cleanup));
    b.handle.runEffect(({ defer }) => defer(cleanup));
    expect((await instance.dispatch(Actions.deleteTabset("main"))).status).toBe("applied");
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(instance.getDocuments().map((doc) => doc.id)).toEqual([c.id]);
  });
  it("preserves a non-closeable native group while deleting eligible siblings", async () => {
    const { instance, open } = await setup();
    const a = await open("A"),
      b = await open("B"),
      c = await open("C");
    const nativeGroup = await group(instance, a.id);
    await instance.dispatch(Actions.moveNode(b.id, nativeGroup.getId(), DockLocation.CENTER, -1));
    await instance.dispatch(Actions.updateNodeAttributes(a.id, { enableClose: false }));
    expect((await instance.dispatch(Actions.deleteTabset(a.containerId!))).status).toBe("applied");
    expect(instance.getDocument(c.id)).toBeNull();
    expect(tabsIn(nativeGroup).map((tab) => tab.getId())).toEqual([a.id, b.id]);
  });
  it("rechecks native tabset membership before deleting any approved member", async () => {
    const pending = deferred<LeaveDecision>();
    const { instance, open, own } = await setup();
    const a = await open("A");
    const decide = vi.fn<() => typeof pending.promise>(() => pending.promise);
    own(a.id, { leave: { getState: () => ({ token: 1, hasUnsavedChanges: true }), decide } });
    const closing = instance.dispatch(Actions.deleteTabset(a.containerId!));
    await vi.waitFor(() => expect(decide).toHaveBeenCalledOnce());
    const b = await open("B");
    pending.resolve({ decision: "allow", token: 1 });
    expect((await closing).status).toBe("denied");
    expect(instance.getDocument(a.id)).not.toBeNull();
    expect(instance.getDocument(b.id)).not.toBeNull();
  });
  it("does not delete newly admitted content after waiting for removed tab cleanup", async () => {
    const pending = deferred<void>();
    const { instance, open } = await setup({ initial: { layout: withBorder } });
    const a = await open("A", "main");
    const cleanup = vi.fn<() => typeof pending.promise>(() => pending.promise);
    a.handle.runEffect(({ defer }) => defer(cleanup));
    const closing = instance.dispatch(Actions.deleteTabset("main"));
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    const b = await open("B", "main");
    pending.resolve();
    expect((await closing).status).toBe("applied");
    expect(instance.getDocument(b.id)).not.toBeNull();
    expect(b.node.getParent()?.getId()).toBe("main");
  });
  it("filters pinned and non-closeable members from ranges but refuses their explicit close", async () => {
    const { instance, open, own } = await setup();
    const a = await open("A"),
      b = await open("B"),
      c = await open("C");
    await instance.dispatch(Actions.setTabPinned(a.id, true));
    await instance.dispatch(Actions.updateNodeAttributes(b.id, { enableClose: false }));
    const decide = vi.fn<() => LeaveDecision>(() => ({ decision: "allow" as const, token: 1 }));
    own(a.id, { leave: { getState: () => ({ token: 1, hasUnsavedChanges: true }), decide } });
    expect((await instance.close(a.id)).status).toBe("denied");
    expect((await instance.dispatch(Actions.deleteTab(b.id))).status).toBe("denied");
    expect(decide).not.toHaveBeenCalled();
    const target = instance.model.getNodeById(c.containerId!) as TabSetNode;
    expect(await instance.close({ scope: "all", target })).toMatchObject({
      status: "applied",
      value: { closedIds: [c.id] },
    });
    expect(instance.getDocuments()).toHaveLength(2);
  });
  it("does not delete an earlier approved member when another dirty member denies", async () => {
    const { instance, open, own } = await setup();
    const a = await open("A"),
      b = await open("B");
    own(a.id, allow);
    own(b.id, {
      leave: {
        getState: () => ({ hasUnsavedChanges: true, token: 2 }),
        decide: () => ({ decision: "deny" }),
      },
    });
    const cleanup = vi.fn<() => void>();
    a.handle.runEffect(({ defer }) => defer(cleanup));
    expect(await instance.close([a.id, b.id])).toMatchObject({
      status: "denied",
      reason: "decision",
    });
    expect(instance.getDocuments()).toHaveLength(2);
    expect(cleanup).not.toHaveBeenCalled();
  });
  it.each(["dirty revision", "clean becomes dirty", "owner withdrawn"] as const)(
    "rechecks earlier approval after another dialog: %s",
    async (change) => {
      const pending = deferred<LeaveDecision>();
      const { instance, open, own } = await setup();
      const a = await open("A"),
        b = await open("B");
      let revision = 1;
      const owner = own(a.id, {
        leave: {
          getState: () => ({
            token: revision,
            hasUnsavedChanges: change !== "clean becomes dirty" || revision > 1,
          }),
          decide: (request) => ({ decision: "allow", token: request.state.token }),
        },
      });
      const decideB = vi.fn<() => typeof pending.promise>(() => pending.promise);
      own(b.id, {
        leave: { getState: () => ({ token: 1, hasUnsavedChanges: true }), decide: decideB },
      });
      const closing = instance.close([a.id, b.id]);
      await vi.waitFor(() => expect(decideB).toHaveBeenCalledOnce());
      if (change === "owner withdrawn") owner.unregister();
      else revision++;
      pending.resolve({ decision: "allow", token: 1 });
      expect((await closing).status).toBe("denied");
      expect(instance.getDocuments()).toHaveLength(2);
    },
  );
  it("reports a failing application state getter without deleting native tabs or resources", async () => {
    const { instance, open, own } = await setup();
    const a = await open("A");
    const error = new Error("state getter");
    const cleanup = vi.fn<() => void>();
    a.handle.runEffect(({ defer }) => defer(cleanup));
    own(a.id, {
      leave: {
        getState: () => {
          throw error;
        },
        decide: () => ({ decision: "allow", token: 1 }),
      },
    });
    expect(await instance.close(a.id)).toMatchObject({
      status: "failed",
      phase: "prepare",
      changes: "none",
      error,
    });
    expect(instance.getDocument(a.id)).not.toBeNull();
    expect(cleanup).not.toHaveBeenCalled();
  });
  it.each(["membership", "pin", "closeability", "native navigation"] as const)(
    "rechecks close range after pending approval: %s",
    async (change) => {
      const pending = deferred<LeaveDecision>();
      const { instance, open, own } = await setup();
      const a = await open("A"),
        b = await open("B");
      const decide = vi.fn<() => typeof pending.promise>(() => pending.promise);
      own(a.id, {
        leave: {
          getState: () => ({ token: 1, hasUnsavedChanges: true }),
          decide: (request) =>
            request.reason === "navigate" ? { decision: "allow", token: 1 } : decide(),
        },
      });
      const target = instance.model.getNodeById(a.containerId!) as TabSetNode;
      const closing = instance.close({ scope: "all", target });
      await vi.waitFor(() => expect(decide).toHaveBeenCalledOnce());
      if (change === "membership") await open("C");
      else if (change === "pin") await instance.dispatch(Actions.setTabPinned(b.id, true));
      else if (change === "closeability")
        await instance.dispatch(Actions.updateNodeAttributes(b.id, { enableClose: false }));
      else {
        const record = integrationState(instance).getRecord(a.id);
        if (record?.role !== "document") throw new Error("Expected document");
        await record.runtime!.router.navigate({ href: "/documents/A?view=preview" });
      }
      pending.resolve({ decision: "allow", token: 1 });
      expect((await closing).status).toBe("denied");
      expect(instance.getDocument(a.id)).not.toBeNull();
      expect(instance.getDocument(b.id)).not.toBeNull();
    },
  );
  it("shares duplicate batches, refuses overlaps, and owns async cleanup exactly once", async () => {
    const pending = deferred<LeaveDecision>(),
      cleanup = deferred<void>();
    const { instance, open, own } = await setup();
    const a = await open("A"),
      b = await open("B"),
      c = await open("C");
    own(a.id, {
      leave: {
        getState: () => ({ token: 1, hasUnsavedChanges: true }),
        decide: () => pending.promise,
      },
    });
    const stop = vi.fn<() => typeof cleanup.promise>(() => cleanup.promise);
    a.handle.runEffect(({ defer }) => defer(stop));
    const first = instance.close([a.id, b.id]);
    expect(instance.close([a.id, b.id])).toBe(first);
    expect(await instance.close([b.id, c.id])).toMatchObject({ status: "denied", reason: "busy" });
    pending.resolve({ decision: "allow", token: 1 });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(instance.getDocument(a.id)).toBeNull();
    cleanup.resolve();
    expect((await first).status).toBe("applied");
    expect(instance.getDocuments()).toHaveLength(1);
  });
  it("keeps a late restored Router loader from resurrecting a removed grouped record", async () => {
    const { instance, open } = await setup();
    const a = await open("A"),
      b = await open("B");
    await group(instance, a.id);
    await instance.activate(b.id);
    const snapshot = instance.createSnapshot();
    const pending = deferred<void>();
    const entered = vi.fn<() => void>();
    const root = createRootRoute();
    const tree = root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/documents/$id",
        loader: ({ params }) => {
          if (params.id === "A") {
            entered();
            return pending.promise;
          }
        },
      }),
    ]);
    const restored = await setup({
      initial: { snapshot },
      createRouter: (history) => createRouter({ routeTree: tree, history }),
    });
    const handle = restored.instance.getContent(a.id)!.handle;
    const loading = integrationState(restored.instance).loadDocument(handle);
    await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
    await restored.instance.close(a.id);
    pending.resolve();
    await loading;
    expect(restored.instance.getDocument(a.id)).toBeNull();
    expect(restored.instance.getDocument(b.id)).not.toBeNull();
  });
});
