import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { Actions, DockLocation } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkbench,
  type ContentController,
  type LeaveDecision,
  type OpenOptions,
  type OpenPolicy,
  type OpenPolicyContext,
  type ReadingSize,
  type RouteMetadataContext,
  type WorkbenchInstance,
  type WorkbenchRouteMetadata,
} from "./index";
import { integrationState } from "./internal";

const instances: WorkbenchInstance<AnyRouter>[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

const nav = (id: string) => ({ to: "/documents/$id" as const, params: { id } });
const current: OpenPolicy = (context) =>
  context.defaultDestination
    ? { destination: context.defaultDestination, presentation: context.presentation }
    : null;
const preserveSource: OpenPolicy = (context) => {
  const destination = context.defaultDestination;
  if (!destination) return null;
  return {
    destination,
    presentation: context.canPlace(destination, "reveal") ? "reveal" : "activate",
  };
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(
  openPolicy: OpenPolicy,
  loader: (id: string) => unknown = () => undefined,
  readingSize: WorkbenchRouteMetadata["readingSize"] = { minWidth: 400, preferredWidth: 600 },
) {
  const root = createRootRoute({
    staticData: { worksplit: { readingSize: { minWidth: 320, preferredWidth: 480 } } },
  });
  const tree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: "/documents/$id",
      loader: ({ params }) => loader(params.id),
      staticData: { worksplit: { readingSize } },
    }),
  ]);
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: tree, history, defaultPendingMinMs: 0 }),
    openPolicy,
    previewScope: "workspace",
  });
  instances.push(workbench);
  await workbench.start();
  const open = async (id: string, options: OpenOptions = {}) => {
    const result = await workbench.open(nav(id), options);
    if (result.status !== "applied") throw new Error(JSON.stringify(result));
    return result.value.document;
  };
  const own = (id: string, controller: ContentController) => {
    const owner = { controller };
    integrationState(workbench).registerController(workbench.getContent(id)!.handle, owner);
    return owner;
  };
  return { workbench, open, own };
}

describe("one-shot opening policy", () => {
  it("activates a narrow inspection in the source pane without navigating its dirty source", async () => {
    const loads = vi.fn<(id: string) => void>();
    const policy = vi.fn<OpenPolicy>((context) =>
      context.defaultDestination
        ? { destination: context.defaultDestination, presentation: "activate" }
        : null,
    );
    const { workbench, open, own } = await setup(policy, loads);
    const source = await open("source");
    const decide = vi.fn<() => LeaveDecision>(() => ({ decision: "deny" as const }));
    own(source.id, {
      leave: { getState: () => ({ hasUnsavedChanges: true, token: 7 }), decide },
    });
    loads.mockClear();
    const detail = await open("detail", {
      source: source.handle,
      intent: "inspect",
      presentation: "reveal",
      preview: true,
    });
    expect(detail.containerId).toBe(source.containerId);
    expect(detail.preview).toBe(true);
    expect(workbench.getActiveDocument()?.id).toBe(detail.id);
    expect(workbench.getDocument(source.id)?.href).toContain("source");
    expect(decide).not.toHaveBeenCalled();
    expect(loads).toHaveBeenCalledExactlyOnceWith("detail");
    expect(policy.mock.lastCall?.[0]).toMatchObject({
      intent: "inspect",
      presentation: "reveal",
      preview: true,
      target: { readingSize: { minWidth: 400, preferredWidth: 600 }, existing: null },
    });
  });

  it("reuses a same-pane inspection and reveals a separate existing target without moving it", async () => {
    const { workbench, open } = await setup(preserveSource);
    const source = await open("source");
    const detail = await open("detail");
    const same = await open("detail", {
      source: source.handle,
      intent: "inspect",
      presentation: "reveal",
    });
    expect(same.id).toBe(detail.id);
    expect(workbench.getActiveDocument()?.id).toBe(detail.id);
    const separate = await open("separate", {
      source: source.handle,
      destination: { target: source.containerId!, location: DockLocation.RIGHT },
    });
    await workbench.activate(source.id);
    const before = workbench.model.getNodeById(separate.containerId!);
    await workbench.dispatch(
      Actions.updateNodeAttributes(separate.containerId!, { enableDrop: false }),
    );
    const result = await workbench.open(nav("separate"), {
      source: source.handle,
      intent: "inspect",
      presentation: "reveal",
    });
    expect(result).toMatchObject({
      status: "applied",
      value: { reused: true, presentation: "reveal" },
    });
    expect(workbench.getActiveDocument()?.id).toBe(source.id);
    expect(workbench.getDocument(separate.id)?.containerId).toBe(separate.containerId);
    expect(workbench.model.getNodeById(separate.containerId!)).toBe(before);
    await workbench.dispatch(Actions.maximizeToggle(source.containerId!));
    expect(
      await workbench.open(nav("separate"), {
        source: source.handle,
        intent: "inspect",
        presentation: "reveal",
      }),
    ).toMatchObject({ status: "applied", value: { reused: true, presentation: "activate" } });
    expect(workbench.getActiveDocument()?.id).toBe(separate.id);
  });

  it("publishes content-owned reading needs with route fallback and stable projections", async () => {
    const contexts: OpenPolicyContext[] = [];
    const { workbench, open, own } = await setup((context) => {
      contexts.push(context);
      return current(context);
    });
    const source = await open("source");
    expect(source.readingSize).toEqual({ minWidth: 400, preferredWidth: 600 });
    const owner = own(source.id, {
      leave: null,
      readingSize: { minWidth: 440, preferredWidth: 920, minHeight: 280 },
    });
    const published = workbench.getDocument(source.id);
    expect(published?.readingSize).toEqual({ minWidth: 440, preferredWidth: 920, minHeight: 280 });
    integrationState(workbench).updateController(source.handle, owner, {
      leave: null,
      readingSize: { minWidth: 440, preferredWidth: 920, minHeight: 280 },
    });
    expect(workbench.getDocument(source.id)).toBe(published);
    await open("detail", { source: source.handle, intent: "inspect" });
    expect(contexts.at(-1)?.source?.readingSize?.preferredWidth).toBe(920);
    expect(contexts.at(-1)?.target.readingSize?.preferredWidth).toBe(600);
    integrationState(workbench).updateController(source.handle, owner, { leave: null });
    expect(workbench.getDocument(source.id)?.readingSize).toEqual({
      minWidth: 400,
      preferredWidth: 600,
    });
    expect(() =>
      integrationState(workbench).updateController(source.handle, owner, {
        leave: null,
        readingSize: { minWidth: 440, preferredWidth: 300 },
      }),
    ).toThrow(TypeError);
  });

  it("lets explicit destinations and link overrides bypass automatic policy", async () => {
    const policy = vi.fn<OpenPolicy>(current);
    const { workbench, open } = await setup(policy);
    const source = await open("source");
    policy.mockClear();
    const link = workbench.createLink(nav("detail"), {
      source: source.handle,
      intent: "inspect",
      presentation: "reveal",
      preview: true,
    });
    const result = await link.open({
      destination: { target: source.containerId!, location: DockLocation.BOTTOM },
      presentation: "activate",
    });
    expect(result).toMatchObject({ status: "applied", value: { presentation: "activate" } });
    if (result.status !== "applied") throw new Error("Explicit opening failed");
    expect(result.value.document.containerId).not.toBe(source.containerId);
    expect(policy).not.toHaveBeenCalled();
    const resolver = vi.fn<() => null>(() => null);
    expect((await workbench.open(nav("detail"), { destination: resolver })).status).toBe("applied");
    expect(resolver).not.toHaveBeenCalled();
    expect(policy).not.toHaveBeenCalled();
  });

  it("resolves query-dependent reading needs before first render and rejects invalid needs", async () => {
    const policy = vi.fn<OpenPolicy>(current);
    const size = vi.fn<(context: RouteMetadataContext) => ReadingSize>(
      ({ params, search, location }) => ({
        minWidth: params.id === "invalid" ? 0 : 400,
        preferredWidth: search.full === true && location.pathname.endsWith("wide") ? 1040 : 600,
      }),
    );
    const { workbench, open } = await setup(policy, () => undefined, size);
    const source = await open("source", { preview: true });
    const result = await workbench.open(
      {
        to: "/documents/$id",
        params: { id: "wide" },
        search: { full: true },
      },
      { source: source.handle, intent: "inspect" },
    );
    expect(result.status).toBe("applied");
    expect(policy.mock.lastCall?.[0].target).toMatchObject({
      existing: null,
      readingSize: { minWidth: 400, preferredWidth: 1040 },
    });
    expect(size).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { id: "wide" },
        search: { full: true },
      }),
    );
    const before = workbench.getDocuments().length;
    expect(await workbench.open(nav("invalid"), { preview: true })).toMatchObject({
      status: "failed",
      phase: "prepare",
      changes: "none",
    });
    expect(workbench.getDocuments()).toHaveLength(before);
    expect(workbench.getDocument(source.id)?.preview).toBe(true);
  });

  it.each(["focus", "move", "close"] as const)(
    "does not promote a delayed inspection after source %s changes",
    async (change) => {
      const slow = deferred();
      const { workbench, open } = await setup(
        (context) =>
          context.defaultDestination
            ? { destination: context.defaultDestination, presentation: "activate" }
            : null,
        (id) => (id === "slow" ? slow.promise : undefined),
      );
      const source = await open("source");
      const other = await open("other", {
        destination: { target: source.containerId!, location: DockLocation.RIGHT },
      });
      await workbench.activate(source.id);
      const pending = workbench.open(nav("slow"), {
        source: source.handle,
        intent: "inspect",
        presentation: "reveal",
        preview: true,
      });
      if (change === "focus") await workbench.activate(other.id);
      else if (change === "move")
        await workbench.dispatch(
          Actions.moveNode(source.id, other.containerId!, DockLocation.CENTER, -1),
        );
      else await workbench.close(source.id);
      slow.resolve();
      expect(await pending).toMatchObject({ status: "superseded" });
      expect(workbench.getDocuments().some((doc) => doc.href.includes("slow"))).toBe(false);
    },
  );

  it("cannot turn a late ordinary request back into a foreground activation", async () => {
    const slow = deferred();
    const { workbench, open } = await setup(
      (context) =>
        context.defaultDestination
          ? { destination: context.defaultDestination, presentation: "activate" }
          : null,
      (id) => (id === "slow" ? slow.promise : undefined),
    );
    const source = await open("source");
    const other = await open("other", {
      destination: { target: source.containerId!, location: DockLocation.RIGHT },
    });
    await workbench.activate(source.id);
    const pending = workbench.open(nav("slow"), { source: source.handle });
    await workbench.activate(other.id);
    slow.resolve();
    expect(await pending).toMatchObject({
      status: "applied",
      value: { presentation: "background", document: { containerId: source.containerId } },
    });
    expect(workbench.getActiveDocument()?.id).toBe(other.id);
  });

  it("keeps a resolved narrow inspection stale while preview replacement approval waits", async () => {
    const entered = deferred();
    const approved = deferred();
    const { workbench, open, own } = await setup((context) =>
      context.defaultDestination
        ? { destination: context.defaultDestination, presentation: "activate" }
        : null,
    );
    const source = await open("source");
    const previous = await open("previous", {
      preview: true,
      destination: { target: source.containerId!, location: DockLocation.RIGHT },
    });
    own(previous.id, {
      leave: {
        getState: () => ({ hasUnsavedChanges: false, token: 3 }),
        decide: async ({ state }) => {
          entered.resolve();
          await approved.promise;
          return { decision: "allow", token: state.token };
        },
      },
    });
    await workbench.activate(source.id);
    const pending = workbench.open(nav("next"), {
      source: source.handle,
      intent: "inspect",
      presentation: "reveal",
      preview: true,
    });
    try {
      await entered.promise;
      await workbench.activate(previous.id);
    } finally {
      approved.resolve();
    }
    expect(await pending).toMatchObject({ status: "superseded" });
    expect(workbench.getActiveDocument()?.id).toBe(previous.id);
    expect(workbench.getDocument(previous.id)?.preview).toBe(true);
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("does not commit an approved split after its available width becomes insufficient", async () => {
    const entered = deferred();
    const approved = deferred();
    const loads = vi.fn<(id: string) => void>();
    let availableWidth = 1200;
    const policy = vi.fn<OpenPolicy>((context) => {
      if (context.intent !== "inspect") return current(context);
      if (!context.anchor || !context.defaultDestination) return null;
      const minimum =
        (context.source?.readingSize?.minWidth ?? 400) +
        (context.target.readingSize?.minWidth ?? 400) +
        6;
      return availableWidth >= minimum
        ? {
            destination: {
              target: context.anchor.getId(),
              location: DockLocation.RIGHT,
              ratio: 600 / (availableWidth - 6),
            },
            presentation: "reveal",
          }
        : { destination: context.defaultDestination, presentation: "activate" };
    });
    const { workbench, open, own } = await setup(policy, loads);
    const source = await open("source");
    const previous = await open("previous", {
      preview: true,
      destination: { target: source.containerId!, location: DockLocation.RIGHT },
    });
    own(previous.id, {
      leave: {
        getState: () => ({ hasUnsavedChanges: false, token: 5 }),
        decide: async ({ state }) => {
          entered.resolve();
          await approved.promise;
          return { decision: "allow", token: state.token };
        },
      },
    });
    await workbench.activate(source.id);
    const before = workbench.createSnapshot();
    loads.mockClear();
    const pending = workbench.open(nav("next"), {
      source: source.handle,
      intent: "inspect",
      presentation: "reveal",
      preview: true,
    });
    try {
      await entered.promise;
      expect(policy.mock.results.at(-1)?.value?.destination.location).toBe(DockLocation.RIGHT);
      availableWidth = 600;
    } finally {
      approved.resolve();
    }
    expect(await pending).toMatchObject({ status: "superseded" });
    expect(workbench.createSnapshot()).toEqual(before);
    expect(workbench.getDocument(previous.id)?.preview).toBe(true);
    expect(workbench.getActiveDocument()?.id).toBe(source.id);
    expect(loads).toHaveBeenCalledExactlyOnceWith("next");
  });
});
