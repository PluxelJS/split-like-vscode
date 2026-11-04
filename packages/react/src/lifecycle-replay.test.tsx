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
  useContent,
  useContentController,
  Workbench,
  type ContentHandle,
  type ContentEffect,
  type ContentController,
  type WorkbenchInstance,
} from "./index";

const instances: WorkbenchInstance<AnyRouter>[] = [];
interface OwnerConfig {
  lifecycle: ContentController | undefined;
  owner: string;
  show: boolean;
  resource: (effect: ContentEffect) => void | Promise<void>;
  second?: ContentController;
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
  // eslint-disable-next-line no-await-in-loop -- Finish each owned session before tearing down the next.
  for (const instance of instances.splice(0)) await instance.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Owner({ capture }: { capture: (content: ContentHandle) => void }) {
  const config = useContext(OwnerContext)!;
  const content = useContent();
  useEffect(() => {
    capture(content);
    return content.runEffect(config.resource);
  }, [content, config.resource, capture]);
  return (
    <>
      {config.lifecycle && <Declaration controller={config.lifecycle} pending={config.pending} />}
      <input aria-label="Live editor" />
    </>
  );
}
function Declaration({
  controller,
  pending,
}: {
  controller: ContentController;
  pending?: Promise<void> | undefined;
}) {
  useContentController(controller);
  if (pending) throw pending;
  return null;
}
function SecondOwner({ lifecycle }: { lifecycle: ContentController }) {
  return <Declaration controller={lifecycle} />;
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
async function setup(
  lifecycle: ContentController | undefined,
  resource: OwnerConfig["resource"] = () => {},
  strict = true,
) {
  let content!: ContentHandle;
  const capture = (value: ContentHandle) => {
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
    tools: { editor: { render: () => <Tool /> } },
    initial: {
      layout: {
        layout: {
          type: "row",
          children: [
            {
              type: "tabset",
              children: [{ type: "tab", id: "editor", component: "editor", name: "Editor" }],
            },
          ],
        },
      },
    },
  });
  instances.push(workbench);
  await workbench.start();
  let config: OwnerConfig = { lifecycle, resource, owner: "A", show: true };
  const element = (value: OwnerConfig) => {
    const child = (
      <OwnerContext.Provider value={value}>
        <Suspense fallback={<p>Pending editor</p>}>
          <Workbench instance={workbench} />
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

function guard(decide: () => boolean | Promise<boolean>, token = 0): ContentController {
  return {
    leave: {
      getState: () => ({ hasUnsavedChanges: true, token }),
      decide: async () => ((await decide()) ? { decision: "allow", token } : { decision: "deny" }),
    },
  };
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
    const { workbench, view } = await setup(guard(beforeLeave), ({ signal, defer }) => {
      const index = signals.push(signal) - 1;
      defer(() => released(index));
    });
    await screen.findByRole("textbox", { name: "Live editor" });
    expect(signals).toHaveLength(2);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(released.mock.calls).toEqual([[0]]);
    expect(await workbench.close("editor")).toEqual({ status: "denied", reason: "decision" });
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
    const resource = vi.fn<(effect: ContentEffect) => void>();
    const { workbench, update, getContent } = await setup(
      guard(() => request.promise, 3),
      resource,
      false,
    );
    await screen.findByRole("textbox", { name: "Live editor" });
    const content = getContent();
    const closing = workbench.close("editor");
    update({
      lifecycle: guard(() => false, 3),
    });
    expect(getContent()).toBe(content);
    expect(resource).toHaveBeenCalledTimes(1);
    request.resolve(true);
    await act(async () => {
      expect(await closing).toMatchObject({ status: "applied" });
    });
  });

  it("reads a changed close callback from the latest committed render", async () => {
    const first = vi.fn<() => boolean>(() => false);
    const second = vi.fn<() => boolean>(() => false);
    const { workbench, update } = await setup(guard(first), undefined, false);
    await screen.findByRole("textbox", { name: "Live editor" });
    update({ lifecycle: guard(second) });
    expect(await workbench.close("editor")).toEqual({ status: "denied", reason: "decision" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not publish callbacks from a suspended, discarded render", async () => {
    const first = vi.fn<() => boolean>(() => false);
    const uncommitted = vi.fn<() => boolean>(() => true);
    const { workbench, update } = await setup(guard(first), undefined, false);
    await screen.findByRole("textbox", { name: "Live editor" });
    const never = new Promise<void>(() => {});
    await act(async () => {
      startTransition(() => {
        update({ lifecycle: guard(uncommitted), pending: never });
      });
    });
    expect(await workbench.close("editor")).toEqual({ status: "denied", reason: "decision" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(uncommitted).not.toHaveBeenCalled();
  });

  it("invalidates approval after withdrawing and declaring an owner again without stopping resources", async () => {
    const request = approval();
    const released = vi.fn<() => void>();
    const lifecycle = guard(() => request.promise);
    const { workbench, update } = await setup(lifecycle, ({ defer }) => defer(released), false);
    await screen.findByRole("textbox", { name: "Live editor" });
    const closing = workbench.close("editor");
    update({ lifecycle: undefined });
    update({ lifecycle });
    request.resolve(true);
    expect(await closing).toMatchObject({ status: "denied" });
    expect(released).not.toHaveBeenCalled();
  });

  it("invalidates approval when a keyed editor replaces another editor with the same revision", async () => {
    const request = approval();
    const released = vi.fn<() => void>();
    const { workbench, update } = await setup(
      guard(() => request.promise),
      ({ defer }) => defer(released),
      false,
    );
    await screen.findByRole("textbox", { name: "Live editor" });
    const closing = workbench.close("editor");
    update({
      owner: "B",
      lifecycle: guard(() => false),
    });
    request.resolve(true);
    expect(await closing).toMatchObject({ status: "denied" });
    expect(released).toHaveBeenCalledTimes(1);
    expect(await workbench.close("editor")).toEqual({ status: "denied", reason: "decision" });
  });

  it("refuses a second editing owner while allowing independent resource effects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onDuplicate = vi.fn<(error: Error) => void>();
    const releasedA = vi.fn<() => void>();
    const releasedB = vi.fn<() => void>();
    const { workbench, update, getContent } = await setup(
      guard(() => false),
      ({ defer }) => defer(releasedA),
      false,
    );
    await screen.findByRole("textbox", { name: "Live editor" });
    getContent().runEffect(({ defer }) => defer(releasedB));
    update({ second: { leave: null }, onDuplicate });
    expect(screen.getByText("Duplicate owner refused")).toBeDefined();
    expect(onDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Content already has a controller owner" }),
    );
    expect(await workbench.close("editor")).toEqual({ status: "denied", reason: "decision" });
    expect(releasedA).not.toHaveBeenCalled();
    expect(releasedB).not.toHaveBeenCalled();
    await act(async () => {
      await workbench.dispose();
    });
    expect(releasedA).toHaveBeenCalledTimes(1);
    expect(releasedB).toHaveBeenCalledTimes(1);
  });
});
