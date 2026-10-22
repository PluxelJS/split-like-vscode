import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import {
  Actions,
  DockLocation,
  GroupAction,
  Model,
  TabGroupNode,
  TabNode,
  TabSetNode,
  type Action,
} from "flexlayout-react";
import { afterEach, describe, expect, it } from "vitest";

import { createWorkbench, type NavigationResult } from "./index";
import { integrationState } from "./integration";
import { actionsIn } from "./native-layout";

const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
  window.history.replaceState(null, "", "/");
});

function committed(result: NavigationResult) {
  if (result.status === "failed") throw result.error;
  expect(result.status).toBe("committed");
  if (result.status !== "committed") throw new Error(`Document was ${result.status}`);
  return result.document;
}

async function setup() {
  const root = createRootRoute();
  const document = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    loader: ({ params }) => ({ id: params.id }),
    staticData: { worksplit: { title: "Document" } },
  });
  const routeTree = root.addChildren([document]);
  const workbench = createWorkbench({
    createRouter: (history: RouterHistory) =>
      createRouter({ routeTree, history, defaultPendingMinMs: 0 }),
  });
  disposals.push(() => workbench.dispose());
  const a = committed(await workbench.open({ href: "/documents/A" }));
  const b = committed(
    await workbench.open(
      { href: "/documents/B" },
      { target: a.containerId, location: DockLocation.RIGHT },
    ),
  );
  const internal = integrationState(workbench);
  const draft = {
    revision: 7,
    title: "Unsaved poll",
    choices: [{ id: "first", label: "First choice", selected: true }],
    options: { roleIds: ["staff"], closesAt: "2026-12-31T00:00:00Z" },
  };
  const lifetime = { decisions: 0, saves: 0, disposals: 0 };
  internal.register(b.id, {
    isDirty: () => true,
    getCloseRevision: () => draft.revision,
    beforeLeave: () => {
      lifetime.decisions += 1;
      return false;
    },
    save: () => {
      lifetime.saves += 1;
    },
    dispose: () => {
      lifetime.disposals += 1;
    },
  });
  return { workbench, a, b, internal, model: internal.model, draft, lifetime };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
async function group({ workbench, model, b }: Fixture) {
  expect(await workbench.dispatch(Actions.addTabToNewGroup(b.id, "Research", "#3366cc"))).toEqual({
    status: "applied",
  });
  const parent = model.getNodeById(b.id)?.getParent();
  if (!(parent instanceof TabGroupNode)) throw new Error("Expected native group");
  return parent;
}

describe("native singleton group removal", () => {
  it("keeps the sole grouped tab in an unwrapped native Model and its idMap", () => {
    const model = Model.fromJson({
      layout: {
        type: "row",
        children: [
          { type: "tabset", id: "set-a", children: [{ type: "tab", id: "a", component: "test" }] },
          { type: "tabset", id: "set-b", children: [{ type: "tab", id: "b", component: "test" }] },
        ],
      },
    });
    const originalTab = model.getNodeById("b");
    model.doAction(Actions.addTabToNewGroup("b", "Research", "#3366cc"));
    model.doAction(Actions.removeTabFromGroup("b"));

    expect(model.getNodeById("b")).toBeDefined();
    expect(model.getNodeById("b")).toBe(originalTab);
    const tabset = model.getNodeById("set-b") as TabSetNode;
    expect(tabset.getChildren()).toEqual([originalTab]);
    expect(tabset.getSelectedNode()).toBe(originalTab);
    expect(model.getActiveTabset()).toBe(tabset);
    expect(Model.fromJson(model.toJson()).getNodeById("b")).toBeInstanceOf(TabNode);
  });

  it.each([DockLocation.RIGHT, DockLocation.BOTTOM])(
    "retains a dirty document, its Router and native container after docking %s",
    async (location) => {
      const fixture = await setup();
      const { workbench, model, internal, a, b, draft, lifetime } = fixture;
      const originalTab = model.getNodeById(b.id);
      const originalRouter = internal.documents.get(b.id)?.router;
      const originalDraft = structuredClone(draft);
      expect(await workbench.dispatch(Actions.moveNode(b.id, a.containerId, location, -1))).toEqual(
        {
          status: "applied",
        },
      );
      const containerId = workbench.getDocument(b.id)!.containerId;
      const nativeGroup = await group(fixture);

      expect(await workbench.dispatch(Actions.removeTabFromGroup(b.id))).toEqual({
        status: "applied",
      });
      expect(internal.model).toBe(model);
      expect(model.getNodeById(b.id)).toBe(originalTab);
      expect(model.getNodeById(b.id)?.getParent()).toBe(model.getNodeById(containerId));
      expect(model.getNodeById(containerId)).toBeInstanceOf(TabSetNode);
      expect(model.getNodeById(nativeGroup.getId())).toBeUndefined();
      expect(Model.fromJson(workbench.getLayout()).getNodeById(b.id)).toBeInstanceOf(TabNode);
      expect(workbench.getDocuments()).toHaveLength(2);
      expect(workbench.getActiveDocument()?.id).toBe(b.id);
      expect(internal.documents.get(b.id)?.router).toBe(originalRouter);
      expect(draft).toEqual(originalDraft);
      expect(lifetime).toEqual({ decisions: 0, saves: 0, disposals: 0 });

      await workbench.save(b.id);
      expect(lifetime.saves).toBe(1);
      expect(await workbench.close(b.id)).toEqual({ status: "rejected", reason: "decision" });
      expect(lifetime.decisions).toBe(1);
      expect(lifetime.disposals).toBe(0);
      expect(workbench.getDocument(b.id)?.containerId).toBe(containerId);
    },
  );

  it("reveals and selects the removed tab when its singleton group was collapsed", async () => {
    const fixture = await setup();
    const { workbench, model, b } = fixture;
    const nativeGroup = await group(fixture);
    expect(
      await workbench.dispatch(
        Actions.updateNodeAttributes(nativeGroup.getId(), { opened: false }),
      ),
    ).toEqual({ status: "applied" });
    expect((model.getNodeById(b.containerId) as TabSetNode).getSelectedNode()).toBeUndefined();

    expect(await workbench.dispatch(Actions.removeTabFromGroup(b.id))).toEqual({
      status: "applied",
    });
    expect((model.getNodeById(b.containerId) as TabSetNode).getSelectedNode()?.getId()).toBe(b.id);
    expect(workbench.getActiveDocument()?.id).toBe(b.id);
  });

  it("selects the removed singleton while retaining an independently active sibling", async () => {
    const fixture = await setup();
    const { workbench, model, b } = fixture;
    await group(fixture);
    const c = committed(await workbench.open({ href: "/documents/C" }, { target: b.containerId }));
    expect(workbench.getActiveDocument()?.id).toBe(c.id);

    expect(await workbench.dispatch(Actions.removeTabFromGroup(b.id))).toEqual({
      status: "applied",
    });
    const tabset = model.getNodeById(b.containerId) as TabSetNode;
    expect(tabset.getChildren().map((child) => child.getId())).toEqual([b.id, c.id]);
    expect(tabset.getSelectedNode()?.getId()).toBe(b.id);
    expect(workbench.getActiveDocument()?.id).toBe(b.id);
    expect(workbench.getDocument(c.id)?.id).toBe(c.id);
  });

  it("executes nested native batches once while retaining their original Action instances", async () => {
    const fixture = await setup();
    const { workbench, model, a, b, lifetime } = fixture;
    await group(fixture);
    const rename = Actions.renameTab(a.id, "Retained A");
    const pin = Actions.setTabPinned(a.id, true);
    const remove = Actions.removeTabFromGroup(b.id);
    const nested = Actions.group([rename, Actions.group([remove, pin])]);
    const observed: Action[] = [];
    model.addChangeListener((action) => observed.push(action));

    expect(await workbench.dispatch(nested)).toEqual({ status: "applied" });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBeInstanceOf(GroupAction);
    expect(observed[0]).toBe(nested);
    const leaves = actionsIn(observed[0]!);
    expect(leaves).toContain(rename);
    expect(leaves).toContain(pin);
    expect(leaves).toContain(remove);
    expect((model.getNodeById(a.id) as TabNode).getName()).toBe("Retained A");
    expect((model.getNodeById(a.id) as TabNode).isPinned()).toBe(true);
    expect(model.getNodeById(b.id)?.getParent()).toBe(model.getNodeById(b.containerId));
    expect(lifetime).toEqual({ decisions: 0, saves: 0, disposals: 0 });
  });

  it("preserves native multi-member removal and its original batch identity", async () => {
    const fixture = await setup();
    const { workbench, model, b } = fixture;
    const nativeGroup = await group(fixture);
    const c = committed(await workbench.open({ href: "/documents/C" }, { target: b.containerId }));
    expect(
      await workbench.dispatch(
        Actions.moveNode(c.id, nativeGroup.getId(), DockLocation.CENTER, -1),
      ),
    ).toEqual({ status: "applied" });
    const original = Actions.group([Actions.group([Actions.removeTabFromGroup(b.id)])]);
    const observed: Action[] = [];
    model.addChangeListener((action) => observed.push(action));

    expect(await workbench.dispatch(original)).toEqual({ status: "applied" });
    expect(observed).toEqual([original]);
    expect(observed[0]).toBe(original);
    expect(
      model
        .getNodeById(nativeGroup.getId())
        ?.getChildren()
        .map((child) => child.getId()),
    ).toEqual([c.id]);
    expect(model.getNodeById(b.id)?.getParent()).toBe(model.getNodeById(b.containerId));
    expect(workbench.getActiveDocument()?.id).toBe(b.id);
  });

  it("retains a group that becomes singleton during the native batch", async () => {
    const fixture = await setup();
    const { workbench, model, a, b, draft, lifetime } = fixture;
    const nativeGroup = await group(fixture);
    const c = committed(await workbench.open({ href: "/documents/C" }, { target: b.containerId }));
    expect(
      await workbench.dispatch(
        Actions.moveNode(c.id, nativeGroup.getId(), DockLocation.CENTER, -1),
      ),
    ).toEqual({ status: "applied" });
    const originalTab = model.getNodeById(b.id);
    const originalDraft = structuredClone(draft);

    expect(
      await workbench.dispatch(
        Actions.group([
          Actions.moveNode(c.id, a.containerId, DockLocation.CENTER, -1),
          Actions.group([Actions.removeTabFromGroup(b.id)]),
        ]),
      ),
    ).toEqual({ status: "applied" });
    expect(model.getNodeById(b.id)).toBeDefined();
    expect(model.getNodeById(b.id)).toBe(originalTab);
    expect(model.getNodeById(b.id)?.getParent()).toBe(model.getNodeById(b.containerId));
    expect(workbench.getDocuments()).toHaveLength(3);
    expect(workbench.getActiveDocument()?.id).toBe(b.id);
    expect(draft).toEqual(originalDraft);
    expect(lifetime).toEqual({ decisions: 0, saves: 0, disposals: 0 });
  });
});
