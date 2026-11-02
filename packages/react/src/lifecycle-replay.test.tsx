import { createRootRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  Component,
  createContext,
  StrictMode,
  Suspense,
  startTransition,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkbench,
  useWorkbenchContent,
  Workbench,
  type WorkbenchContent,
  type WorkbenchContentEffect,
  type WorkbenchContentLifecycle,
  type WorkbenchInstance,
} from "./index";

const instances: WorkbenchInstance<AnyRouter>[] = [];
interface OwnerConfig {
  lifecycle: WorkbenchContentLifecycle | undefined;
  owner: string;
  show: boolean;
  resource: (effect: WorkbenchContentEffect) => void | Promise<void>;
  second?: WorkbenchContentLifecycle;
  onDuplicate?: (error: Error) => void;
  pending?: Promise<void>;
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

function Owner({ capture }: { capture: (content: WorkbenchContent) => void }) {
  const config = useContext(OwnerContext)!;
  const content = useWorkbenchContent(config.lifecycle);
  useEffect(() => {
    capture(content);
    return content.effect(config.resource);
  }, [content, config.resource, capture]);
  if (config.pending) throw config.pending;
  return <input aria-label="Live editor" />;
}
function SecondOwner({ lifecycle }: { lifecycle: WorkbenchContentLifecycle }) {
  useWorkbenchContent(lifecycle);
  return null;
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
function setup(
  lifecycle: WorkbenchContentLifecycle | undefined,
  resource: OwnerConfig["resource"] = () => {},
  strict = true,
) {
  let content!: WorkbenchContent;
  const capture = (value: WorkbenchContent) => {
    content = value;
  };
  function Tool() {
    const config = useContext(OwnerContext)!;
    if (!config.show) return <p>Owner removed</p>;
    return (
      <>
        <Owner key={config.owner} capture={capture} />
        {config.second && config.onDuplicate && (
          <OwnerErrorBoundary onError={config.onDuplicate}>
            <SecondOwner lifecycle={config.second} />
          </OwnerErrorBoundary>
        )}
      </>
    );
  }
  const root = createRootRoute();
  const onIssue = vi.fn<(issue: unknown) => void>();
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: root, history }),
    onIssue,
    tools: [{ id: "editor", render: () => <Tool /> }],
    layout: {
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
  let config: OwnerConfig = { lifecycle, resource, owner: "A", show: true };
  const element = (value: OwnerConfig) => {
    const child = (
      <OwnerContext.Provider value={value}>
        <Suspense fallback={<p>Pending editor</p>}>
          <Workbench workbench={workbench} />
        </Suspense>
      </OwnerContext.Provider>
    );
    return strict ? <StrictMode>{child}</StrictMode> : child;
  };
  const view = render(element(config));
  const update = (next: Partial<OwnerConfig>) => {
    config = { ...config, ...next };
    view.rerender(element(config));
  };
  return { workbench, view, update, onIssue, getContent: () => content };
}

function approval() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("committed content owners and React effect replay", () => {
  it("reacquires after StrictMode replay and releases every setup once", async () => {
    const signals: AbortSignal[] = [];
    const released = vi.fn<(index: number) => void>();
    const beforeLeave = vi.fn<() => boolean>(() => false);
    const { workbench, view } = setup({ isDirty: () => true, beforeLeave }, ({ signal, defer }) => {
      const index = signals.push(signal) - 1;
      defer(() => released(index));
    });
    await screen.findByRole("textbox", { name: "Live editor" });
    expect(signals).toHaveLength(2);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(released.mock.calls).toEqual([[0]]);
    expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
    expect(beforeLeave).toHaveBeenCalledTimes(1);
    expect(released.mock.calls).toEqual([[0]]);
    await act(async () => {
      await workbench.dispose();
    });
    view.unmount();
    expect(released.mock.calls).toEqual([[0], [1]]);
  });

  it("uses inline latest committed callbacks without replacing owner or resource effects", async () => {
    const request = approval();
    const resource = vi.fn<(effect: WorkbenchContentEffect) => void>();
    const { workbench, update, getContent } = setup(
      {
        isDirty: () => true,
        getCloseRevision: () => 3,
        beforeLeave: () => request.promise,
      },
      resource,
      false,
    );
    await screen.findByRole("textbox", { name: "Live editor" });
    const content = getContent();
    const closing = workbench.close("editor");
    update({
      lifecycle: {
        isDirty: () => true,
        getCloseRevision: () => 3,
        beforeLeave: () => false,
      },
    });
    expect(getContent()).toBe(content);
    expect(resource).toHaveBeenCalledTimes(1);
    request.resolve(true);
    await act(async () => {
      expect(await closing).toMatchObject({ status: "closed" });
    });
  });

  it("reads a changed close callback from the latest committed render", async () => {
    const first = vi.fn<() => boolean>(() => false);
    const second = vi.fn<() => boolean>(() => false);
    const { workbench, update } = setup(
      { isDirty: () => true, beforeLeave: first },
      undefined,
      false,
    );
    await screen.findByRole("textbox", { name: "Live editor" });
    update({ lifecycle: { isDirty: () => true, beforeLeave: second } });
    expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not publish callbacks from a suspended, discarded render", async () => {
    const first = vi.fn<() => boolean>(() => false);
    const uncommitted = vi.fn<() => boolean>(() => true);
    const { workbench, update } = setup(
      { isDirty: () => true, beforeLeave: first },
      undefined,
      false,
    );
    await screen.findByRole("textbox", { name: "Live editor" });
    const never = new Promise<void>(() => {});
    await act(async () => {
      startTransition(() => {
        update({ lifecycle: { isDirty: () => true, beforeLeave: uncommitted }, pending: never });
      });
    });
    expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(uncommitted).not.toHaveBeenCalled();
  });

  it("invalidates approval after withdrawing and declaring an owner again without stopping resources", async () => {
    const request = approval();
    const released = vi.fn<() => void>();
    const lifecycle = {
      isDirty: () => true,
      getCloseRevision: () => 0,
      beforeLeave: () => request.promise,
    };
    const { workbench, update } = setup(lifecycle, ({ defer }) => defer(released), false);
    await screen.findByRole("textbox", { name: "Live editor" });
    const closing = workbench.close("editor");
    update({ lifecycle: undefined });
    update({ lifecycle });
    request.resolve(true);
    expect(await closing).toEqual({ status: "rejected", reason: "changed" });
    expect(released).not.toHaveBeenCalled();
  });

  it("invalidates approval when a keyed editor replaces another editor with the same revision", async () => {
    const request = approval();
    const released = vi.fn<() => void>();
    const { workbench, update } = setup(
      { isDirty: () => true, getCloseRevision: () => 0, beforeLeave: () => request.promise },
      ({ defer }) => defer(released),
      false,
    );
    await screen.findByRole("textbox", { name: "Live editor" });
    const closing = workbench.close("editor");
    update({
      owner: "B",
      lifecycle: { isDirty: () => true, getCloseRevision: () => 0, beforeLeave: () => false },
    });
    request.resolve(true);
    expect(await closing).toEqual({ status: "rejected", reason: "changed" });
    expect(released).toHaveBeenCalledTimes(1);
    expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
  });

  it("refuses a second editing owner while allowing independent resource effects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onDuplicate = vi.fn<(error: Error) => void>();
    const releasedA = vi.fn<() => void>();
    const releasedB = vi.fn<() => void>();
    const { workbench, update, getContent } = setup(
      { isDirty: () => true },
      ({ defer }) => defer(releasedA),
      false,
    );
    await screen.findByRole("textbox", { name: "Live editor" });
    getContent().effect(({ defer }) => defer(releasedB));
    update({ second: {}, onDuplicate });
    expect(screen.getByText("Duplicate owner refused")).toBeDefined();
    expect(onDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Content editor already has a lifecycle owner" }),
    );
    expect(await workbench.close("editor")).toEqual({ status: "rejected", reason: "decision" });
    expect(releasedA).not.toHaveBeenCalled();
    expect(releasedB).not.toHaveBeenCalled();
    await act(async () => {
      await workbench.dispose();
    });
    expect(releasedA).toHaveBeenCalledTimes(1);
    expect(releasedB).toHaveBeenCalledTimes(1);
  });
});
