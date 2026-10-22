import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  Activity,
  createContext,
  StrictMode,
  Suspense,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkbench,
  useWorkbenchContentLifecycle,
  Workbench,
  type WorkbenchContentLifecycle,
  type WorkbenchInstance,
} from "./index";

const instances: WorkbenchInstance<AnyRouter>[] = [];
const resizeObservers = new Map<ResizeObserver, ResizeObserverCallback>();
interface Scope {
  id: string;
  lifecycle: WorkbenchContentLifecycle;
  read: () => void;
}
const ScopeContext = createContext<Scope | null>(null);

beforeEach(() => {
  resizeObservers.clear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 700),
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
  vi.stubGlobal("scrollTo", vi.fn<typeof window.scrollTo>());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeObservers.set(this, callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        resizeObservers.delete(this);
      }
    },
  );
});
afterEach(async () => {
  cleanup();
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Editor() {
  const scope = useContext(ScopeContext)!;
  useWorkbenchContentLifecycle(scope.lifecycle);
  scope.read();
  return <input aria-label={`Editor ${scope.id}`} />;
}

function Scoped({ scope, children }: { scope: Scope; children: ReactNode }) {
  const value = useMemo(() => scope, [scope]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

async function setup(strict = true) {
  const errors: Error[] = [];
  const root = createRootRoute({
    errorComponent: ({ error }) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      errors.push(failure);
      return <p role="alert">{failure.message}</p>;
    },
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    component: Editor,
  });
  const workbench = createWorkbench({
    createRouter: (history) =>
      createRouter({
        routeTree: root.addChildren([page]),
        history,
        defaultPendingMs: 0,
        defaultPendingMinMs: 0,
      }),
  });
  instances.push(workbench);
  const result = await workbench.open({ to: "/documents/$id", params: { id: "A" } });
  if (result.status !== "committed") {
    throw new Error(`Open failed: ${result.status}`, {
      cause: result.status === "failed" ? result.error : result,
    });
  }
  const disposeA = vi.fn<() => void>();
  const disposeB = vi.fn<() => void>();
  const lifeA = { dispose: disposeA, isDirty: () => true, beforeLeave: () => false };
  const lifeB = { dispose: disposeB, isDirty: () => true, beforeLeave: () => false };
  let scope: Scope = { id: "A", lifecycle: lifeA, read: () => undefined };
  let providerKey = "A";
  let mode: "visible" | "hidden" = "visible";
  const wrap = (children: ReactNode) => (strict ? <StrictMode>{children}</StrictMode> : children);
  const element = () =>
    wrap(
      <Activity mode={mode}>
        <Scoped key={providerKey} scope={scope}>
          <Suspense fallback={<p>Editor suspended</p>}>
            <Workbench workbench={workbench} />
          </Suspense>
        </Scoped>
      </Activity>,
    );
  const view = render(element());
  await screen.findByRole("textbox", { name: "Editor A" });
  return {
    workbench,
    id: result.document.id,
    errors,
    disposeA,
    disposeB,
    unmount: () => view.unmount(),
    async remountScope() {
      providerKey = "B";
      scope = { id: "B", lifecycle: lifeB, read: () => undefined };
      await act(async () => view.rerender(element()));
    },
    async setMode(next: typeof mode) {
      mode = next;
      await act(async () => view.rerender(element()));
      if (mode === "visible") {
        await act(async () => {
          resizeObservers.forEach((callback, observer) => callback([], observer));
        });
      }
    },
    async suspend() {
      let resolve!: () => void;
      const pending = new Promise<void>((done) => {
        resolve = done;
      });
      scope = {
        ...scope,
        read: () => {
          throw pending;
        },
      };
      await act(async () => view.rerender(element()));
      return async () => {
        scope = { ...scope, read: () => undefined };
        await act(async () => {
          resolve();
          view.rerender(element());
        });
      };
    },
  };
}

describe("lifecycle ownership through router reconnection", () => {
  it.each([false, true])(
    "refuses an overlapping owner when a keyed scope remounts the same instance (StrictMode: %s)",
    async (strict) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { errors, remountScope, disposeA, disposeB, workbench, id } = await setup(strict);
      await remountScope();
      // A new Content context cannot claim another context's still-pending registration.
      // The project owner must end its old instance before starting a new scoped one.
      expect(errors.length).toBeGreaterThan(0);
      errors.forEach((error) => {
        expect(error.message).toBe(`Content ${id} already has a lifecycle owner`);
      });
      expect(screen.queryByRole("textbox", { name: "Editor B" })).toBeNull();
      expect(disposeA).toHaveBeenCalledTimes(1);
      expect(disposeB).not.toHaveBeenCalled();
      await workbench.dispose();
      expect(disposeA).toHaveBeenCalledTimes(1);
      expect(disposeB).not.toHaveBeenCalled();
    },
  );

  it("reconnects the same document owner after Activity hides and reveals it", async () => {
    const { errors, setMode, workbench, id } = await setup();
    await setMode("hidden");
    await setMode("visible");
    expect(errors).toEqual([]);
    expect(await screen.findByRole("textbox", { name: "Editor A" })).toBeDefined();
    expect(await workbench.close(id)).toEqual({ status: "rejected", reason: "decision" });
  });

  it("reconnects the same document owner after its route suspends and resolves", async () => {
    const { errors, suspend, workbench, id } = await setup();
    const resolve = await suspend();
    await resolve();
    expect(errors).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Editor A" })).toBeDefined();
    expect(await workbench.close(id)).toEqual({ status: "rejected", reason: "decision" });
  });

  it("starts a fresh scoped instance after the project owner disposes and unmounts the old one", async () => {
    const previous = await setup();
    await act(async () => {
      await previous.workbench.dispose();
    });
    previous.unmount();
    const next = await setup();
    expect(previous.errors).toEqual([]);
    expect(next.errors).toEqual([]);
    expect(previous.disposeA).toHaveBeenCalledTimes(1);
    expect(next.disposeA).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Editor A" })).toBeDefined();
    expect(await next.workbench.close(next.id)).toEqual({ status: "rejected", reason: "decision" });
  });
});
