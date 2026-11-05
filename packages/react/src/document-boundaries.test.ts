import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { Actions } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type LeaveRequest, type WorkbenchSnapshot } from "./index";
import { integrationState } from "./internal";
/* eslint-disable no-await-in-loop -- Native scenarios and resource teardown deliberately run in order. */
import type { LeaveDecision } from "./types";

const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const navigation = (id: string, view = "edit") => ({
  to: "/documents/$id" as const,
  params: { id },
  search: { view },
});
async function setup(
  loader: (id: string) => void | Promise<void> = () => {},
  snapshot?: WorkbenchSnapshot,
) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === "string" ? search.view : "edit",
    }),
    loader: ({ params }) => loader(params.id),
    staticData: {
      worksplit: { title: "Document", documentKey: ({ params }) => String(params.id) },
    },
  });
  const tree = root.addChildren([route]);
  const routers: AnyRouter[] = [];
  const onIssue = vi.fn<() => void>();
  const workbench = createWorkbench({
    workspaceId: "boundaries",
    createRouter: (history) => {
      const router = createRouter({ routeTree: tree, history, defaultPendingMinMs: 0 });
      routers.push(router);
      return router;
    },
    onIssue,
    ...(snapshot ? { initial: { snapshot } } : {}),
  });
  disposals.push(() => workbench.dispose());
  await workbench.start();
  const open = (id: string) => workbench.open(navigation(id), { preview: true });
  return { workbench, open, navigation, routers, onIssue, internal: integrationState(workbench) };
}
describe("preview admission boundaries", () => {
  it.each(["activation", "outside-input"] as const)(
    "does not reclaim foreground after a preview decision waits through later %s",
    async (intent) => {
      const { workbench, open, internal } = await setup();
      const ordinary = await workbench.open(navigation("ordinary"));
      const old = await open("old");
      if (ordinary.status !== "applied" || old.status !== "applied")
        throw new Error("Fixture did not open documents");
      const gate = deferred();
      const decide = vi.fn<() => Promise<LeaveDecision>>(async () => {
        await gate.promise;
        return { decision: "allow" as const, token: 1 };
      });
      internal.registerController(old.value.document.handle, {
        controller: { leave: { getState: () => ({ hasUnsavedChanges: false, token: 1 }), decide } },
      });
      const opening = open("late-preview");
      try {
        await vi.waitFor(() => expect(decide).toHaveBeenCalledOnce());
        if (intent === "activation") await workbench.activate(ordinary.value.document.id);
        else internal.focus(null, "outside", true);
        const active = workbench.getActiveDocument()?.id;
        gate.resolve();
        expect(await opening).toEqual({ status: "superseded" });
        expect(workbench.getActiveDocument()?.id).toBe(active);
        expect(workbench.getDocuments()).toHaveLength(2);
        expect(workbench.getDocument(old.value.document.id)?.preview).toBe(true);
      } finally {
        gate.resolve();
        await opening;
      }
    },
  );
  it("supersedes a slow preview when actual outside focus revokes foreground eligibility", async () => {
    const gate = deferred();
    const { workbench, open, internal } = await setup((id) =>
      id === "B" ? gate.promise : undefined,
    );
    const a = await open("A");
    if (a.status !== "applied") throw new Error(a.status);
    const pending = open("B");
    internal.focus(null, "outside");
    gate.resolve();
    expect(await pending).toEqual({ status: "superseded" });
    expect(workbench.getDocuments()).toMatchObject([{ id: a.value.document.id, preview: true }]);
    expect(workbench.getContext()).toMatchObject({
      activeDocumentId: a.value.document.id,
      focusedContentId: null,
    });
  });
  it("allows an ordinary new copy to finish in the background after foreground intent changes", async () => {
    const gate = deferred();
    const { workbench, open, internal } = await setup((id) =>
      id === "B" ? gate.promise : undefined,
    );
    const a = await open("A");
    if (a.status !== "applied") throw new Error(a.status);
    const pending = workbench.open(navigation("B"), { reuse: "new" });
    internal.focus(null, "outside");
    gate.resolve();
    expect(await pending).toMatchObject({
      status: "applied",
      value: { presentation: "background", document: { preview: false } },
    });
    expect(workbench.getDocument(a.value.document.id)?.preview).toBe(true);
    expect(workbench.getActiveDocument()?.id).toBe(a.value.document.id);
  });
  it("navigates a restored custom identity without admitting a duplicate", async () => {
    const first = await setup();
    const a = await first.open("A");
    if (a.status !== "applied") throw new Error(a.status);
    const second = await setup(undefined, first.workbench.createSnapshot());
    expect(
      await second.workbench.open(second.navigation("A", "compare"), { reuse: "navigate" }),
    ).toMatchObject({
      status: "applied",
      value: {
        reused: true,
        document: { id: a.value.document.id, href: "/documents/A?view=compare" },
      },
    });
    expect(second.workbench.getDocuments()).toHaveLength(1);
  });
  it.each(["loading", "native-observer"] as const)(
    "retains an explicitly kept preview during %s",
    async (phase) => {
      const gate = deferred();
      const { workbench, open } = await setup((id) =>
        phase === "loading" && id === "B" ? gate.promise : undefined,
      );
      const a = await open("A");
      if (a.status !== "applied") throw new Error(a.status);
      if (phase === "native-observer")
        workbench.model.addChangeListener((action) => {
          if (action.type === Actions.ADD_TAB) void workbench.keepOpen(a.value.document.id);
        });
      const pending = open("B");
      if (phase === "loading") await workbench.keepOpen(a.value.document.id);
      gate.resolve();
      expect((await pending).status).toBe("applied");
      expect(workbench.getDocument(a.value.document.id)?.preview).toBe(false);
      expect(workbench.getDocuments()).toHaveLength(2);
    },
  );
  it("returns retiring-preview cleanup failure on the admitted operation without duplicate issue reporting", async () => {
    const { workbench, open, onIssue } = await setup();
    const a = await open("A");
    if (a.status !== "applied") throw new Error(a.status);
    const error = new Error("cleanup failed");
    a.value.document.handle.runEffect((effect) =>
      effect.defer(async () => {
        throw error;
      }),
    );
    expect(await open("B")).toMatchObject({ status: "applied", cleanupErrors: [error] });
    expect(onIssue).not.toHaveBeenCalled();
    expect(workbench.getDocument(a.value.document.id)).toBeNull();
    expect(workbench.getDocuments()).toHaveLength(1);
  });
  it("fails before admission when the retiring guard cannot read its state", async () => {
    const { workbench, open, internal } = await setup();
    const a = await open("A");
    if (a.status !== "applied") throw new Error(a.status);
    const error = new Error("guard read failed");
    internal.registerController(a.value.document.handle, {
      controller: {
        leave: {
          getState() {
            throw error;
          },
          decide: () => ({ decision: "deny" }),
        },
      },
    });
    expect(await open("B")).toMatchObject({ status: "failed", changes: "none", error });
    expect(workbench.getDocuments()).toMatchObject([{ id: a.value.document.id, preview: true }]);
  });
  it("passes native Router search navigation through the same leave context", async () => {
    const { workbench, open, internal, routers } = await setup();
    const a = await open("A");
    if (a.status !== "applied") throw new Error(a.status);
    const decide = vi.fn<(request: LeaveRequest) => LeaveDecision>((request: LeaveRequest) => ({
      decision: "allow" as const,
      token: request.state.token,
    }));
    internal.registerController(a.value.document.handle, {
      controller: { leave: { getState: () => ({ hasUnsavedChanges: true, token: 1 }), decide } },
    });
    await routers[0]!.navigate({ href: "/documents/A?view=compare" });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "navigate",
        content: a.value.document.handle,
        from: expect.objectContaining({ publicHref: "/documents/A?view=edit" }),
        to: expect.objectContaining({ publicHref: "/documents/A?view=compare" }),
      }),
    );
    expect(workbench.getDocument(a.value.document.id)?.href).toBe("/documents/A?view=compare");
  });
});
