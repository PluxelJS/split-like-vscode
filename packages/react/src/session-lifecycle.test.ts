import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { Actions, DockLocation, TabNode } from "flexlayout-react";
import { describe, expect, it, vi } from "vitest";

import { createWorkbench, type ContentController, type LeaveRequest } from "./index";
import { integrationState } from "./internal";
import type { LeaveDecision } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(
  options: {
    loader?: (id: string) => void | Promise<void>;
    previewScope?: "workspace" | "container";
  } = {},
) {
  const routers: ReturnType<typeof router>[] = [];
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/$id",
    loader: ({ params }) => options.loader?.(params.id),
  });
  const tree = root.addChildren([page]);
  function router(history: RouterHistory) {
    return createRouter({ routeTree: tree, history });
  }
  const instance = createWorkbench({
    createRouter(history) {
      const value = router(history);
      routers.push(value);
      return value;
    },
    workspaceId: "session-tests",
    home: { mode: "empty", href: "/" },
    ...(options.previewScope ? { previewScope: options.previewScope } : {}),
    tools: { notes: { render: () => null } },
  });
  return { instance, routers };
}
function own(
  instance: ReturnType<typeof setup>["instance"],
  id: string,
  controller: ContentController,
) {
  const owner = { controller };
  const internal = integrationState(instance);
  const content = instance.getContent(id)!.handle;
  const unregister = internal.registerController(content, owner);
  return {
    unregister,
    update: (next: ContentController) => internal.updateController(content, owner, next),
  };
}
async function open(
  instance: ReturnType<typeof setup>["instance"],
  id: string,
  options: Parameters<typeof instance.open>[1] = {},
) {
  const result = await instance.open({ to: "/$id", params: { id } }, options);
  if (result.status !== "applied") throw new Error(JSON.stringify(result));
  return result.value.document;
}

describe("single native content owner and transactional operations", () => {
  it("admits tool records before native observers and accepts native generated IDs", async () => {
    const { instance } = setup();
    await instance.start();
    const seen: string[] = [];
    instance.model.addChangeListener((action) => {
      if (action.type !== Actions.ADD_TAB) return;
      const record = instance.getContent(action.data.json.id);
      expect(record?.role).toBe("tool");
      seen.push(record!.id);
    });
    const target = instance.getContainers()[0]?.id ?? instance.model.getRootRow()!.getId();
    expect(
      (
        await instance.dispatch(
          Actions.addTab({ component: "notes" }, target, DockLocation.CENTER, -1),
        )
      ).status,
    ).toBe("applied");
    expect(seen).toHaveLength(1);
    await instance.dispose();
  });

  it("reports native ADD observer failure with its actual admitted content", async () => {
    const { instance } = setup();
    await instance.start();
    const failure = new Error("observer failed after ADD");
    instance.model.addChangeListener((action) => {
      if (action.type === Actions.ADD_TAB) throw failure;
    });
    const result = await instance.open({ to: "/$id", params: { id: "a" } });
    expect(result).toMatchObject({
      status: "failed",
      phase: "commit",
      changes: "some",
      error: failure,
    });
    expect(instance.getDocuments()).toHaveLength(1);
    await instance.dispose();
  });

  it("performs ordinary queries and native naming without serializing the Model", async () => {
    const { instance } = setup();
    await instance.start();
    const doc = await open(instance, "a");
    const serialize = vi.spyOn(instance.model, "toJson");
    const documents = instance.getDocuments();
    const containers = instance.getContainers();
    const context = instance.getContext();
    expect(instance.getDocuments()).toBe(documents);
    expect(instance.getContainers()).toBe(containers);
    expect(instance.getContext()).toBe(context);
    await instance.dispatch(Actions.updateNodeAttributes(doc.id, { name: "Manual title" }));
    expect(instance.getDocument(doc.id)?.title).toBe("Manual title");
    expect(serialize).not.toHaveBeenCalled();
    expect(instance.createSnapshot().layout).toBeDefined();
    expect(serialize).toHaveBeenCalledTimes(1);
    await instance.dispose();
  });

  it("reuses matching accepted documents before running another loader", async () => {
    const loads = vi.fn<() => void>();
    const { instance } = setup({ loader: loads });
    await instance.start();
    const first = await open(instance, "a");
    const second = await open(instance, "a");
    expect(second.handle).toBe(first.handle);
    expect(loads).toHaveBeenCalledTimes(1);
    const copy = await instance.duplicate(first.id);
    expect(copy.status).toBe("applied");
    expect(instance.getDocuments()).toHaveLength(2);
    expect(loads).toHaveBeenCalledTimes(2);
    await instance.dispose();
  });

  it("keeps an old dirty preview replaceable when the new destination rejects admission", async () => {
    const { instance } = setup();
    await instance.start();
    const old = await open(instance, "a", { preview: true });
    own(instance, old.id, {
      leave: {
        getState: () => ({ token: 1, hasUnsavedChanges: true }),
        decide: () => ({ decision: "deny" }),
      },
    });
    // Router error boundaries are accepted pages. A destination rejection is a true failure to admit.
    const result = await instance.open(
      { to: "/$id", params: { id: "b" } },
      { preview: true, destination: () => null },
    );
    expect(result.status).toBe("denied");
    expect(instance.getDocument(old.id)?.preview).toBe(true);
    await instance.dispose();
  });

  it("retains a preview whose noninteractive guard denies, after admitting its replacement", async () => {
    const { instance } = setup();
    await instance.start();
    const old = await open(instance, "a", { preview: true });
    const release = vi.fn<() => void>();
    const decide = vi.fn<(request: LeaveRequest) => LeaveDecision>((request: LeaveRequest) => {
      request.defer(release);
      return { decision: "deny" as const };
    });
    own(instance, old.id, {
      leave: { getState: () => ({ token: 1, hasUnsavedChanges: false }), decide },
    });
    const next = await open(instance, "b", { preview: true });
    expect(instance.getDocument(old.id)?.preview).toBe(false);
    expect(next.preview).toBe(true);
    expect(decide.mock.calls[0]?.[0].reason).toBe("replace-preview");
    expect(release).toHaveBeenCalledTimes(1);
    await instance.dispose();
  });

  it("does not let an older slow preview displace a newer accepted choice", async () => {
    const slow = deferred<void>();
    const { instance } = setup({
      loader: (id) => (id === "slow" ? slow.promise : undefined),
      previewScope: "workspace",
    });
    await instance.start();
    await open(instance, "a");
    const older = instance.open({ to: "/$id", params: { id: "slow" } }, { preview: true });
    const newer = await open(instance, "new", { preview: true });
    slow.resolve();
    expect((await older).status).toBe("superseded");
    expect(instance.getDocument(newer.id)?.preview).toBe(true);
    await instance.dispose();
  });

  it("shares an identical pending close and rejects a different overlapping batch", async () => {
    const { instance } = setup();
    await instance.start();
    const a = await open(instance, "a");
    const b = await open(instance, "b");
    const decision = deferred<{ decision: "allow"; token: number }>();
    own(instance, a.id, {
      leave: {
        getState: () => ({ token: 1, hasUnsavedChanges: true }),
        decide: () => decision.promise,
      },
    });
    const first = instance.close(a.id);
    expect(instance.close(a.id)).toBe(first);
    expect(await instance.close([a.id, b.id])).toMatchObject({ status: "denied", reason: "busy" });
    decision.resolve({ decision: "allow", token: 1 });
    expect((await first).status).toBe("applied");
    await instance.dispose();
  });

  it("rechecks each still-live approval after synchronous native callbacks and cleans partial removals", async () => {
    const { instance } = setup();
    await instance.start();
    const a = await open(instance, "a");
    const b = await open(instance, "b");
    let token = 1;
    const pauses = [0, 0];
    const clean = vi.fn<() => void>();
    for (const [index, doc] of [a, b].entries())
      own(instance, doc.id, {
        leave: {
          getState: () => ({ token: index ? token : 1, hasUnsavedChanges: false }),
          decide(request) {
            pauses[index]!++;
            request.defer(() => {
              pauses[index]!--;
            });
            return { decision: "allow", token: index ? token : 1 };
          },
        },
      });
    a.handle.runEffect((effect) => effect.defer(clean));
    instance.model.addChangeListener((action) => {
      if (action.type === Actions.DELETE_TAB && action.data.node === a.id) token++;
    });
    const result = await instance.close([a.id, b.id]);
    expect(result).toMatchObject({
      status: "failed",
      phase: "commit",
      changes: "some",
      affectedIds: [a.id],
    });
    expect(instance.getContent(a.id)).toBeNull();
    expect(instance.getContent(b.id)).not.toBeNull();
    expect(clean).toHaveBeenCalledTimes(1);
    expect(pauses).toEqual([0, 0]);
    await instance.dispose();
  });

  it("disposal settles a close whose host decision never returns", async () => {
    const { instance } = setup();
    await instance.start();
    const a = await open(instance, "a");
    const cleanup = vi.fn<() => void>();
    own(instance, a.id, {
      leave: {
        getState: () => ({ token: 1, hasUnsavedChanges: true }),
        decide(request) {
          request.defer(cleanup);
          return new Promise(() => {});
        },
      },
    });
    const pending = instance.close(a.id);
    await instance.dispose();
    expect((await pending).status).not.toBe("applied");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("includes pinned content in protected workspace exit", async () => {
    const { instance } = setup();
    await instance.start();
    const a = await open(instance, "a");
    await instance.dispatch(Actions.setTabPinned(a.id, true));
    const decide = vi.fn<() => LeaveDecision>(() => ({ decision: "deny" as const }));
    own(instance, a.id, {
      leave: { getState: () => ({ token: "dirty", hasUnsavedChanges: true }), decide },
    });
    expect((await instance.close(a.id)).status).toBe("denied");
    expect(decide).not.toHaveBeenCalled();
    expect((await instance.closeWorkspace()).status).toBe("denied");
    expect(decide).toHaveBeenCalledOnce();
    await instance.dispose();
  });

  it("rejects snapshots if native save callbacks mutate the layout during export", async () => {
    const { instance } = setup();
    await instance.start();
    const a = await open(instance, "a");
    const node = instance.model.getNodeById(a.id) as TabNode;
    node.setEventListener("save", () => {
      instance.model.doAction(Actions.renameTab(a.id, "Changed during save"));
    });
    expect(() => instance.createSnapshot()).toThrow("changed during snapshot");
    await instance.dispose();
  });
});
