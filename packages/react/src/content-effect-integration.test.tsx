import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Actions, DockLocation } from "flexlayout-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, Workbench, type WorkbenchInstance, type WorkbenchOptions } from "./index";
import { integrationState } from "./internal";

const instances: Pick<WorkbenchInstance<AnyRouter>, "dispose">[] = [];
const finishPending: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 700),
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
  vi.stubGlobal("scrollTo", vi.fn<typeof window.scrollTo>());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  finishPending.splice(0).forEach((finish) => finish());
  cleanup();
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  finishPending.push(resolve);
  return { promise, resolve, reject };
}
async function setup(options: Pick<WorkbenchOptions<AnyRouter>, "onIssue"> = {}) {
  const root = createRootRoute();
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: root, history }),
    tools: { editor: { render: () => <p>Real native tool</p> } },
    initial: {
      layout: {
        layout: {
          children: [
            {
              id: "main",
              type: "tabset",
              enableDeleteWhenEmpty: false,
              children: [{ id: "editor", component: "editor", name: "Editor" }],
            },
          ],
        },
      },
    },
    ...options,
  });
  instances.push(workbench);
  await workbench.start();
  const internal = integrationState(workbench);
  return { workbench, internal, content: workbench.getContent("editor")!.handle };
}

describe("content effects through close, disposal and native receipts", () => {
  it.each(["close", "dispose"] as const)(
    "publishes no removed document to readers during %s cleanup",
    async (operation) => {
      const root = createRootRoute();
      const page = createRoute({ getParentRoute: () => root, path: "/document" });
      const workbench = createWorkbench({
        createRouter: (history) => createRouter({ routeTree: root.addChildren([page]), history }),
      });
      instances.push(workbench);
      await workbench.start();
      const opened = await workbench.open({ to: "/document" });
      if (opened.status !== "applied") throw new Error(opened.status);
      const id = opened.value.document.id;
      const observed: unknown[] = [];
      workbench.getContent(id)!.handle.runEffect(({ defer }) => {
        defer(() => {
          observed.push(
            workbench.getDocument(id),
            workbench.getDocuments(),
            workbench.getActiveDocument(),
          );
        });
      });
      const result = operation === "close" ? await workbench.close(id) : await workbench.dispose();
      expect(result).toEqual(
        operation === "close"
          ? { status: "applied", value: { closedIds: [id] }, cleanupErrors: [] }
          : { status: "applied", value: undefined, cleanupErrors: [] },
      );
      expect(observed).toEqual([null, [], null]);
    },
  );

  it("keeps effects through refused and canceled closing, then returns cleanup failures without reporting twice", async () => {
    const onIssue = vi.fn<(issue: unknown) => void>();
    const { workbench, internal, content } = await setup({ onIssue });
    let allow = false;
    const release = vi.fn<() => void>();
    const cleanupError = new Error("release failed");
    let signal!: AbortSignal;
    internal.registerController(content, {
      controller: {
        leave: {
          getState: () => ({ hasUnsavedChanges: true, token: 1 }),
          decide: () => (allow ? { decision: "allow", token: 1 } : { decision: "deny" }),
        },
      },
    });
    content.runEffect((effect) => {
      signal = effect.signal;
      effect.defer(release);
      effect.defer(() => {
        throw cleanupError;
      });
    });
    expect(await workbench.close("editor")).toEqual({ status: "denied", reason: "decision" });
    const controller = new AbortController();
    controller.abort();
    expect(await workbench.close("editor", { signal: controller.signal })).toEqual({
      status: "superseded",
    });
    expect(signal.aborted).toBe(false);
    expect(release).not.toHaveBeenCalled();
    allow = true;
    expect(await workbench.close("editor")).toEqual({
      status: "applied",
      value: { closedIds: ["editor"] },
      cleanupErrors: [cleanupError],
    });
    expect(signal.aborted).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(onIssue).not.toHaveBeenCalled();
  });

  it("lets close claim unreported stop cleanup while a later dispose only waits", async () => {
    const onIssue = vi.fn<(issue: unknown) => void>();
    const { workbench, content } = await setup({ onIssue });
    const gate = deferred();
    const failure = new Error("slow stop failed");
    const release = vi.fn<() => Promise<void>>(() => gate.promise);
    const stop = content.runEffect(({ defer }) => defer(release));
    stop();
    stop();
    const closing = workbench.close("editor");
    await vi.waitFor(() => expect(workbench.getContent("editor")).toBeNull());
    const disposing = workbench.dispose();
    expect(workbench.dispose()).toBe(disposing);
    gate.reject(failure);
    expect(await closing).toEqual({
      status: "applied",
      value: { closedIds: ["editor"] },
      cleanupErrors: [failure],
    });
    expect(await disposing).toEqual({ status: "applied", value: undefined, cleanupErrors: [] });
    expect(release).toHaveBeenCalledTimes(1);
    expect(onIssue).not.toHaveBeenCalled();
  });

  it("does not replay a stop failure already reported before close", async () => {
    const onIssue = vi.fn<(issue: unknown) => void>();
    const { workbench, content } = await setup({ onIssue });
    const failure = new Error("unowned stop failed");
    content.runEffect(({ defer }) =>
      defer(() => {
        throw failure;
      }),
    )();
    await vi.waitFor(() =>
      expect(onIssue).toHaveBeenCalledExactlyOnceWith({
        code: "operation-failed",
        id: "editor",
        error: failure,
      }),
    );
    expect(await workbench.close("editor")).toEqual({
      status: "applied",
      value: { closedIds: ["editor"] },
      cleanupErrors: [],
    });
    expect(onIssue).toHaveBeenCalledTimes(1);
  });

  it("fixes close's waiting set before abort listeners can defer late work", async () => {
    const onIssue = vi.fn<(issue: unknown) => void>();
    const { workbench, content } = await setup({ onIssue });
    const known = deferred();
    const late = deferred();
    const lateFailure = new Error("late release failed");
    const lateCleanup = vi.fn<() => Promise<void>>(() => late.promise);
    const stop = content.runEffect(({ signal, defer }) => {
      defer(() => known.promise);
      signal.addEventListener("abort", () => {
        stop();
        defer(lateCleanup);
      });
    });
    const closing = workbench.close("editor");
    await vi.waitFor(() => expect(lateCleanup).toHaveBeenCalledTimes(1));
    known.resolve();
    expect(await closing).toEqual({
      status: "applied",
      value: { closedIds: ["editor"] },
      cleanupErrors: [],
    });
    expect(onIssue).not.toHaveBeenCalled();
    late.reject(lateFailure);
    await vi.waitFor(() =>
      expect(onIssue).toHaveBeenCalledExactlyOnceWith({
        code: "operation-failed",
        id: "editor",
        error: lateFailure,
      }),
    );
  });

  it("releases late setup resources after close and never attaches them to the reopened id", async () => {
    const onIssue = vi.fn<(issue: unknown) => void>();
    const { workbench, content } = await setup({ onIssue });
    const acquired = deferred();
    const failure = new Error("late setup failed");
    const released = vi.fn<() => void>();
    let signal!: AbortSignal;
    content.runEffect(async (effect) => {
      signal = effect.signal;
      await acquired.promise;
      effect.defer(released);
      throw failure;
    });
    expect(await workbench.close("editor")).toMatchObject({ status: "applied", cleanupErrors: [] });
    expect(signal.aborted).toBe(true);
    expect(
      await workbench.dispatch(
        Actions.addTab({ id: "editor", component: "editor" }, "main", DockLocation.CENTER, -1),
      ),
    ).toEqual({ status: "applied", value: undefined, cleanupErrors: [] });
    const fresh = workbench.getContent("editor")!.handle;
    expect(fresh).not.toBe(content);
    const rejectedSetup = vi.fn<() => void>();
    expect(() => content.runEffect(rejectedSetup)).toThrow(/Content instance has ended/);
    expect(rejectedSetup).not.toHaveBeenCalled();
    acquired.resolve();
    await vi.waitFor(() =>
      expect(onIssue).toHaveBeenCalledExactlyOnceWith({
        code: "operation-failed",
        id: "editor",
        error: failure,
      }),
    );
    expect(released).toHaveBeenCalledTimes(1);
    expect(await workbench.close("editor")).toMatchObject({ status: "applied", cleanupErrors: [] });
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("consumes a coalesced real native close receipt once", async () => {
    const onIssue = vi.fn<(issue: unknown) => void>();
    const { workbench, internal, content } = await setup({ onIssue });
    const decision = deferred();
    const failure = new Error("native decision failed");
    const released = vi.fn<() => void>();
    internal.registerController(content, {
      controller: {
        leave: {
          getState: () => ({ hasUnsavedChanges: true, token: 1 }),
          decide: async () => {
            await decision.promise;
            return { decision: "allow", token: 1 };
          },
        },
      },
    });
    content.runEffect(({ defer }) => defer(released));
    render(<Workbench instance={workbench} />);
    const button = await waitFor(() => {
      const close = document.querySelector<HTMLElement>(
        '#flexlayout-tabbutton-editor [title="Close"]',
      );
      expect(close).not.toBeNull();
      return close!;
    });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      decision.reject(failure);
    });
    await vi.waitFor(() =>
      expect(onIssue).toHaveBeenCalledExactlyOnceWith({ code: "operation-failed", error: failure }),
    );
    expect(released).not.toHaveBeenCalled();
    expect(internal.model.getNodeById("editor")).toBeDefined();
  });

  it("reports unowned failures by default and a throwing reporter cannot interrupt release", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { content } = await setup();
    const failure = new Error("setup failed");
    const release = vi.fn<() => void>();
    content.runEffect(({ defer }) => {
      defer(release);
      throw failure;
    });
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(log).toHaveBeenCalledWith("Worksplit issue", failure);
    const reporterFailure = new Error("reporter failed");
    const reporter = vi.fn<(issue: unknown) => void>(() => {
      throw reporterFailure;
    });
    const other = await setup({ onIssue: reporter });
    const first = vi.fn<() => void>();
    const second = vi.fn<() => void>();
    const stop = other.content.runEffect(({ defer }) => {
      defer(first);
      defer(() => {
        throw failure;
      });
      defer(second);
    });
    stop();
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(second).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Worksplit issue reporter failed", reporterFailure, failure);
    expect(await other.workbench.close("editor")).toMatchObject({
      status: "applied",
      cleanupErrors: [],
    });
  });
});
