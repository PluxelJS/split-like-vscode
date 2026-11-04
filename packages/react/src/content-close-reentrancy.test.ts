import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { Actions } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkbench,
  type ContentEffect,
  type DisposeResult,
  type WorkbenchInstance,
} from "./index";
import { integrationState } from "./internal";

const instances: Pick<WorkbenchInstance<AnyRouter>, "dispose">[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

async function setup() {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: "/document" });
  const routeTree = root.addChildren([page]);
  const failure = new Error("document Router teardown failed");
  const destroys: ReturnType<typeof vi.fn<() => void>>[] = [];
  const onIssue = vi.fn<(issue: unknown) => void>();
  const workbench = createWorkbench({
    createRouter: (history) => {
      const index = destroys.length;
      const destroy = history.destroy.bind(history);
      const release = vi.fn<() => void>(() => {
        destroy();
        if (index === 0) throw failure;
      });
      history.destroy = release;
      destroys.push(release);
      return createRouter({ routeTree, history });
    },
    onIssue,
  });
  instances.push(workbench);
  await workbench.start();
  return { workbench, failure, destroys, onIssue, internal: integrationState(workbench) };
}

describe("content close and disposal reentrancy", () => {
  it.each(["same-content", "other-content"] as const)(
    "keeps a reentrant late defer out of the frozen cleanup order (%s)",
    async (scope) => {
      const root = createRootRoute();
      const onIssue = vi.fn<(issue: unknown) => void>();
      const workbench = createWorkbench({
        createRouter: (history) => createRouter({ routeTree: root, history }),
        tools: { a: { render: () => null }, b: { render: () => null } },
        initial: {
          layout: {
            layout: {
              type: "row",
              children: [
                {
                  type: "tabset",
                  children: ["a", "b"].map((id) => ({ id, component: id })),
                },
              ],
            },
          },
        },
        onIssue,
      });
      instances.push(workbench);
      await workbench.start();
      let context!: ContentEffect;
      let finishLate!: () => void;
      const late = new Promise<void>((resolve) => {
        finishLate = resolve;
      });
      const lateFailure = new Error("late cleanup failed");
      const knownCleanup = vi.fn<() => void>();
      workbench.getContent("a")!.handle.runEffect(({ signal }) => {
        signal.addEventListener("abort", () => {
          context.defer(async () => {
            await late;
            throw lateFailure;
          });
        });
      });
      workbench.getContent(scope === "same-content" ? "a" : "b")!.handle.runEffect((effect) => {
        context = effect;
        effect.defer(knownCleanup);
      });
      const closing = workbench.dispatch(
        Actions.group([Actions.deleteTab("a"), Actions.deleteTab("b")]),
      );
      try {
        const outcome = await Promise.race([
          closing,
          new Promise<"pending">((resolve) => {
            setTimeout(() => resolve("pending"), 0);
          }),
        ]);
        expect(knownCleanup).toHaveBeenCalledOnce();
        expect(outcome).toEqual({ status: "applied", value: undefined, cleanupErrors: [] });
        expect(onIssue).not.toHaveBeenCalled();
      } finally {
        finishLate();
        await closing;
      }
      await vi.waitFor(() =>
        expect(onIssue).toHaveBeenCalledExactlyOnceWith({
          code: "operation-failed",
          id: scope === "same-content" ? "a" : "b",
          error: lateFailure,
        }),
      );
    },
  );

  it("gives close sole ownership of document teardown when an effect cleanup starts disposal", async () => {
    const { workbench, failure, destroys, onIssue } = await setup();
    const opened = await workbench.open({ to: "/document" });
    if (opened.status !== "applied") throw new Error(opened.status);
    let shutdown: Promise<DisposeResult> | undefined;
    const cleanup = vi.fn<() => void>(() => {
      // Start shutdown without waiting on the close operation that contains this cleanup.
      shutdown = workbench.dispose();
    });
    opened.value.document.handle.runEffect(({ defer }) => defer(cleanup));

    expect(await workbench.close(opened.value.document.id)).toEqual({
      status: "applied",
      value: { closedIds: [opened.value.document.id] },
      cleanupErrors: [failure],
    });
    expect(shutdown).toBeDefined();
    expect(await shutdown).toEqual({ status: "applied", value: undefined, cleanupErrors: [] });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroys).toHaveLength(1);
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledOnce();
    expect(onIssue).not.toHaveBeenCalled();
  });

  it("gives disposal sole ownership when a native removal observer starts it before close releases sessions", async () => {
    const { workbench, failure, destroys, onIssue } = await setup();
    const opened = await workbench.open({ to: "/document" });
    if (opened.status !== "applied") throw new Error(opened.status);
    let shutdown: Promise<DisposeResult> | undefined;
    workbench.model.addChangeListener((action) => {
      if (action.type === Actions.DELETE_TAB) shutdown = workbench.dispose();
    });

    expect(await workbench.close(opened.value.document.id)).toEqual({
      status: "applied",
      value: { closedIds: [opened.value.document.id] },
      cleanupErrors: [],
    });
    expect(shutdown).toBeDefined();
    expect(await shutdown).toEqual({
      status: "applied",
      value: undefined,
      cleanupErrors: [failure],
    });
    expect(destroys).toHaveLength(1);
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledOnce();
    expect(onIssue).not.toHaveBeenCalled();
  });
});
