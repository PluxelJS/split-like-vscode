import { createRootRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  Component,
  createContext,
  StrictMode,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkbench,
  useWorkbenchContent,
  useWorkbenchContentLifecycle,
  Workbench,
  type WorkbenchContentLifecycle,
  type WorkbenchInstance,
} from "./index";

const instances: WorkbenchInstance<AnyRouter>[] = [];
interface OwnerConfig {
  lifecycle: WorkbenchContentLifecycle;
  owner: string;
  show: boolean;
  manual?: boolean;
  second?: WorkbenchContentLifecycle;
  onDuplicate?: (error: Error) => void;
}
const OwnerContext = createContext<OwnerConfig | null>(null);

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

function HookOwner({ lifecycle }: { lifecycle: WorkbenchContentLifecycle }) {
  const stable = useMemo(() => lifecycle, [lifecycle]);
  useWorkbenchContentLifecycle(stable);
  return <input aria-label="Live editor" />;
}
function ManualOwner({ lifecycle }: { lifecycle: WorkbenchContentLifecycle }) {
  const content = useWorkbenchContent();
  useEffect(() => content.register(lifecycle), [content, lifecycle]);
  return <input aria-label="Manual editor" />;
}
class OwnerErrorBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? <p>Duplicate owner refused</p> : this.props.children;
  }
}
function Tool() {
  const config = useContext(OwnerContext)!;
  if (!config.show) return <p>Owner removed</p>;
  const Owner = config.manual ? ManualOwner : HookOwner;
  return (
    <>
      <Owner key={config.owner} lifecycle={config.lifecycle} />
      {config.second && config.onDuplicate && (
        <OwnerErrorBoundary onError={config.onDuplicate}>
          <HookOwner lifecycle={config.second} />
        </OwnerErrorBoundary>
      )}
    </>
  );
}
function TestWorkbench({
  workbench,
  config,
}: {
  workbench: WorkbenchInstance<AnyRouter>;
  config: OwnerConfig;
}) {
  const value = useMemo(() => config, [config]);
  return (
    <OwnerContext.Provider value={value}>
      <Workbench workbench={workbench} />
    </OwnerContext.Provider>
  );
}
function setup(lifecycle: WorkbenchContentLifecycle, strict = true) {
  const root = createRootRoute();
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: root, history }),
    tools: [{ id: "editor", render: () => <Tool /> }],
    layout: {
      global: { tabEnableFloat: false, tabEnablePopout: false },
      layout: {
        children: [
          {
            type: "tabset",
            children: [{ id: "editor", component: "worksplit.tool", name: "Editor" }],
          },
        ],
      },
    },
  });
  instances.push(workbench);
  let config: OwnerConfig = { lifecycle, owner: "A", show: true, manual: false };
  const element = () => {
    const child = <TestWorkbench workbench={workbench} config={config} />;
    return strict ? <StrictMode>{child}</StrictMode> : child;
  };
  const view = render(element());
  const update = (next: Partial<typeof config>) => {
    config = { ...config, ...next };
    view.rerender(element());
  };
  return { workbench, view, update };
}

describe("content lifecycle effect replay", () => {
  it("keeps a stable memoized owner alive through StrictMode replay and disposes once at shutdown", async () => {
    const dispose = vi.fn<() => void>();
    const beforeLeave = vi.fn<() => boolean>(() => false);
    const { workbench, view } = setup({ dispose, isDirty: () => true, beforeLeave });
    await screen.findByRole("textbox", { name: "Live editor" });
    expect(dispose).not.toHaveBeenCalled();
    expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
    expect(beforeLeave).toHaveBeenCalledTimes(1);
    await act(async () => {
      await workbench.dispose();
    });
    view.unmount();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("unregisters a genuine unmount on the next microtask", async () => {
    const dispose = vi.fn<() => void>();
    const { view, workbench } = setup({ dispose });
    await screen.findByRole("textbox", { name: "Live editor" });
    view.unmount();
    expect(dispose).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
    await workbench.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("reconnects the same lifecycle across a content-local component replacement", async () => {
    const dispose = vi.fn<() => void>();
    const { update, view } = setup({ dispose });
    await screen.findByRole("textbox", { name: "Live editor" });
    update({ owner: "B" });
    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();
    view.unmount();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("still refuses a second live hook without taking its resources", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dispose = vi.fn<() => void>();
    const rejectedDispose = vi.fn<() => void>();
    const onDuplicate = vi.fn<(error: Error) => void>();
    const { workbench, update } = setup({ dispose, isDirty: () => true });
    await screen.findByRole("textbox", { name: "Live editor" });
    update({ second: { dispose: rejectedDispose }, onDuplicate });
    expect(screen.getByText("Duplicate owner refused")).toBeDefined();
    expect(onDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Content editor already has a lifecycle owner" }),
    );
    expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
    expect(dispose).not.toHaveBeenCalled();
    expect(rejectedDispose).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "releases changed owners before registration (component replacement: %s)",
    async (replaceComponent) => {
      const disposeA = vi.fn<() => void>();
      const disposeB = vi.fn<() => void>();
      const { update, view } = setup({ dispose: disposeA });
      await screen.findByRole("textbox", { name: "Live editor" });
      update({ lifecycle: { dispose: disposeB }, ...(replaceComponent ? { owner: "B" } : {}) });
      expect(disposeA).toHaveBeenCalledTimes(1);
      expect(disposeB).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(disposeA).toHaveBeenCalledTimes(1);
      expect(disposeB).not.toHaveBeenCalled();
      view.unmount();
      await Promise.resolve();
      expect(disposeB).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["before", "after"] as const)(
    "cleans up once when content closes %s queued hook teardown",
    async (order) => {
      const dispose = vi.fn<() => void>();
      const { workbench, update } = setup({ dispose });
      await screen.findByRole("textbox", { name: "Live editor" });
      await act(async () => {
        if (order === "before") await workbench.close("editor");
        else {
          update({ show: false });
          await workbench.close("editor");
        }
      });
      await Promise.resolve();
      expect(dispose).toHaveBeenCalledTimes(1);
      await workbench.dispose();
      expect(dispose).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps explicit registration cleanup immediate", async () => {
    const oldDispose = vi.fn<() => void>();
    const dispose = vi.fn<() => void>();
    const { update } = setup({ dispose: oldDispose }, false);
    await screen.findByRole("textbox", { name: "Live editor" });
    update({ show: false });
    await Promise.resolve();
    update({ show: true, manual: true, lifecycle: { dispose } });
    await screen.findByRole("textbox", { name: "Manual editor" });
    update({ show: false });
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
