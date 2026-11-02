import { createRootRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Activity, createContext, StrictMode, Suspense, useContext, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, useWorkbenchContent, Workbench, type WorkbenchInstance } from "./index";

const instances: WorkbenchInstance<AnyRouter>[] = [];
interface Scope {
  mode: "visible" | "hidden";
  pending: Promise<void> | undefined;
  acquire: (signal: AbortSignal) => () => void;
  decide: () => boolean;
}
const ScopeContext = createContext<Scope | null>(null);

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
  cleanup();
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Resources() {
  const scope = useContext(ScopeContext)!;
  const content = useWorkbenchContent();
  const acquire = scope.acquire;
  useLayoutEffect(
    () => content.effect(({ signal, defer }) => defer(acquire(signal))),
    [content, acquire],
  );
  if (scope.pending) throw scope.pending;
  return <input aria-label="Resource editor" />;
}
function DocumentRoot() {
  const scope = useContext(ScopeContext)!;
  useWorkbenchContent({
    isDirty: () => true,
    getCloseRevision: () => 0,
    beforeLeave: scope.decide,
  });
  return (
    <>
      <p>Persistent editing owner</p>
      <Activity mode={scope.mode}>
        <Suspense fallback={<p>Resource area suspended</p>}>
          <Resources />
        </Suspense>
      </Activity>
    </>
  );
}
function setup(strict: boolean) {
  const signals: AbortSignal[] = [];
  const released = vi.fn<(index: number) => void>();
  const decide = vi.fn<() => boolean>(() => false);
  const acquire = (signal: AbortSignal) => {
    const index = signals.push(signal) - 1;
    return () => released(index);
  };
  let scope: Scope = { mode: "visible", pending: undefined, acquire, decide };
  const root = createRootRoute();
  const onIssue = vi.fn<(issue: unknown) => void>();
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: root, history }),
    onIssue,
    tools: [{ id: "editor", render: () => <DocumentRoot /> }],
    layout: {
      layout: {
        children: [{ type: "tabset", children: [{ id: "editor", component: "worksplit.tool" }] }],
      },
    },
  });
  instances.push(workbench);
  const element = (value: Scope) => {
    const child = (
      <ScopeContext.Provider value={value}>
        <Workbench workbench={workbench} />
      </ScopeContext.Provider>
    );
    return strict ? <StrictMode>{child}</StrictMode> : child;
  };
  const view = render(element(scope));
  const update = async (next: Partial<Scope>) => {
    scope = { ...scope, ...next };
    await act(async () => view.rerender(element(scope)));
  };
  return { workbench, view, update, signals, released, decide, onIssue };
}

describe("persistent editing owner with hidden resource children", () => {
  it.each([false, true])(
    "keeps dirty close protection during Activity hiding and reacquires on reveal (StrictMode: %s)",
    async (strict) => {
      const { workbench, update, signals, released, decide, onIssue } = setup(strict);
      await screen.findByRole("textbox", { name: "Resource editor" });
      const initial = signals.length;
      const replayReleases = released.mock.calls.length;
      await update({ mode: "hidden" });
      expect(signals.at(-1)?.aborted).toBe(true);
      expect(released).toHaveBeenCalledTimes(replayReleases + 1);
      expect(screen.getByText("Persistent editing owner")).toBeDefined();
      expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
      expect(decide).toHaveBeenCalledTimes(1);
      await update({ mode: "visible" });
      await screen.findByRole("textbox", { name: "Resource editor" });
      expect(signals.length).toBeGreaterThan(initial);
      expect(signals.at(-1)?.aborted).toBe(false);
      expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
      expect(onIssue).not.toHaveBeenCalled();
      await act(async () => {
        await workbench.dispose();
      });
      expect(released).toHaveBeenCalledTimes(signals.length);
    },
  );

  it.each([false, true])(
    "keeps dirty close protection while Suspense cleans and restores child layout effects (StrictMode: %s)",
    async (strict) => {
      const { workbench, update, signals, released, decide, onIssue } = setup(strict);
      await screen.findByRole("textbox", { name: "Resource editor" });
      const initial = signals.length;
      const replayReleases = released.mock.calls.length;
      let resolve!: () => void;
      const pending = new Promise<void>((done) => {
        resolve = done;
      });
      await update({ pending });
      expect(screen.getByText("Resource area suspended")).toBeDefined();
      expect(signals.at(-1)?.aborted).toBe(true);
      expect(released).toHaveBeenCalledTimes(replayReleases + 1);
      expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
      expect(decide).toHaveBeenCalledTimes(1);
      resolve();
      await update({ pending: undefined });
      await screen.findByRole("textbox", { name: "Resource editor" });
      expect(signals.length).toBeGreaterThan(initial);
      expect(signals.at(-1)?.aborted).toBe(false);
      expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
      expect(onIssue).not.toHaveBeenCalled();
      await act(async () => {
        await workbench.dispose();
      });
      expect(released).toHaveBeenCalledTimes(signals.length);
    },
  );
});
