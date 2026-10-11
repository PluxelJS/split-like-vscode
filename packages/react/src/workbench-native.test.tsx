import {
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Actions, DockLocation, Layout, Model, type ILayoutProps } from "flexlayout-react";
import { useMemo, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkbench,
  Workbench,
  useWorkbenchContent,
  useWorkbenchContentLifecycle,
  type WorkbenchOptions,
} from "./index";

const disposals: (() => Promise<unknown>)[] = [];
beforeEach(() => {
  // jsdom has no layout. Give the native measuring pass nonempty geometry so real portals mount.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 800, 600),
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn<(target: Element) => void>();
      unobserve = vi.fn<(target: Element) => void>();
      disconnect = vi.fn<() => void>();
    },
  );
  vi.stubGlobal("scrollTo", vi.fn<typeof window.scrollTo>());
  vi.stubGlobal(
    "matchMedia",
    vi.fn<(query: string) => MediaQueryList>((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn<MediaQueryList["addListener"]>(),
      removeListener: vi.fn<MediaQueryList["removeListener"]>(),
      addEventListener: vi.fn<MediaQueryList["addEventListener"]>(),
      removeEventListener: vi.fn<MediaQueryList["removeEventListener"]>(),
      dispatchEvent: vi.fn<(event: Event) => boolean>(() => false),
    })),
  );
});
afterEach(async () => {
  cleanup();
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Editor() {
  const { id } = useWorkbenchContent();
  const input = useRef<HTMLInputElement>(null);
  const lifecycle = useMemo(() => ({ focus: () => input.current?.focus() }), []);
  useWorkbenchContentLifecycle(lifecycle);
  return (
    <input ref={input} aria-label={`Editor ${id}`} data-testid={`editor-${id}`} defaultValue={id} />
  );
}

function fixture(options: Pick<WorkbenchOptions<AnyRouter>, "layout" | "tools"> = {}) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    component: Editor,
  });
  const tree = root.addChildren([page]);
  const routers: AnyRouter[] = [];
  const factory = (history: RouterHistory) => {
    const router = createRouter({
      routeTree: tree,
      history,
      defaultPendingMinMs: 0,
      defaultStaleTime: Infinity,
    });
    routers.push(router);
    return router;
  };
  const workbench = createWorkbench({ createRouter: factory, ...options });
  workbench.connectBrowser();
  disposals.push(() => workbench.dispose());
  const open = async (id: string) => {
    const result = await workbench.open({ to: "/documents/$id", params: { id } });
    if (result.status !== "committed") throw new Error(`Document failed to open: ${result.status}`);
    return result.document.id;
  };
  return { workbench, routers, open };
}

function nativeTabButton(id: string): HTMLElement {
  const button = document.getElementById(`flexlayout-tabbutton-${id}`);
  if (!button) throw new Error(`Native tab button is missing: ${id}`);
  return button;
}

async function splitFixture() {
  const { workbench, routers, open } = fixture();
  const a = await open("A");
  const b = await open("B");
  const c = await open("C");
  const target = Model.fromJson(workbench.getLayout()).getNodeById(a)?.getParent()?.getId();
  if (!target) throw new Error("Document has no native target");
  await workbench.dispatch(Actions.moveNode(c, target, DockLocation.RIGHT, -1));
  return { workbench, routers, a, b, c };
}

describe("native React interaction", () => {
  it("keeps native Enter and tabset navigation focus on the strip until native activation enters content", async () => {
    const { workbench, a, b, c } = await splitFixture();
    render(
      <Workbench
        workbench={workbench}
        native={{ keyMap: { focusNextTabset: "Ctrl+Alt+ArrowRight" } }}
      />,
    );
    await screen.findByTestId(`editor-${c}`);
    const buttonA = nativeTabButton(a);
    const buttonB = nativeTabButton(b);
    const buttonC = nativeTabButton(c);
    act(() => buttonA.focus());
    fireEvent.keyDown(buttonA, { key: "Enter" });
    await screen.findByTestId(`editor-${a}`);
    await act(async () => undefined);
    expect(workbench.getActiveDocument()?.id).toBe(a);
    expect(window.location.pathname).toBe("/documents/A");
    expect(document.activeElement).toBe(buttonA);
    fireEvent.keyDown(buttonA, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttonB);
    expect(workbench.getActiveDocument()?.id).toBe(a);
    fireEvent.keyDown(buttonB, { key: "Enter" });
    await act(async () => undefined);
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(document.activeElement).toBe(buttonB);
    fireEvent.keyDown(buttonB, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByTestId(`editor-${b}`));
    act(() => buttonB.focus());
    fireEvent.keyDown(buttonB, { key: "ArrowRight", ctrlKey: true, altKey: true });
    await act(async () => undefined);
    expect(workbench.getActiveDocument()?.id).toBe(c);
    expect(window.location.pathname).toBe("/documents/C");
    expect(document.activeElement).toBe(buttonC);
  });

  it("preserves the native adjusting resize path without extra host-driven tabset renders", async () => {
    const { workbench, b, c } = await splitFixture();
    const observed = vi.fn<NonNullable<ILayoutProps["onRenderTabSet"]>>();
    const view = render(<Workbench workbench={workbench} native={{ onRenderTabSet: observed }} />);
    await screen.findByTestId(`editor-${b}`);
    await screen.findByTestId(`editor-${c}`);
    await act(async () => undefined);
    const snapshot = workbench.getLayout();
    const raw = Model.fromJson(snapshot);
    const row = raw.getRootRow();
    if (!row) throw new Error("Native layout has no root row");
    const action = Actions.adjustWeights(row.getId(), [40, 60]).setAdjusting(true);
    observed.mockClear();
    await act(async () => {
      await workbench.dispatch(action);
    });
    const integratedRenders = observed.mock.calls.length;
    raw.doAction(action);
    expect(workbench.getLayout()).toEqual(raw.toJson());
    view.unmount();
    const baseline = vi.fn<NonNullable<ILayoutProps["onRenderTabSet"]>>();
    const nativeModel = Model.fromJson(snapshot);
    render(
      <Layout
        model={nativeModel}
        factory={(node) => <input aria-label={node.getId()} />}
        invalidateTabContentOnParentRender={false}
        onRenderTabSet={baseline}
      />,
    );
    await act(async () => undefined);
    baseline.mockClear();
    act(() => nativeModel.doAction(action));
    expect(baseline).not.toHaveBeenCalled();
    expect(integratedRenders).toBe(baseline.mock.calls.length);
  });

  it("uses native tab error isolation and Retry without recreating a sibling document Router", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let recovered = false;
    function RecoveringTool() {
      if (!recovered) throw new Error("Tool unavailable");
      return <button type="button">Tool recovered</button>;
    }
    const { workbench, open, routers } = fixture({
      tools: [{ id: "inspector", title: "Inspector", render: () => <RecoveringTool /> }],
      layout: {
        borders: [
          {
            type: "border",
            location: "bottom",
            selected: 0,
            children: [
              { type: "tab", id: "inspector", name: "Inspector", component: "worksplit.tool" },
            ],
          },
        ],
        layout: { type: "row", children: [] },
      },
    });
    const a = await open("A");
    render(<Workbench workbench={workbench} />);
    const editor = await screen.findByTestId(`editor-${a}`);
    const originalRouters = [...routers];
    expect(screen.getByRole("alert")).toBeDefined();
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.change(editor, { target: { value: "Sibling draft survives" } });
    expect((editor as HTMLInputElement).value).toBe("Sibling draft survives");
    recovered = true;
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Tool recovered" })).toBeDefined(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId(`editor-${a}`)).toBe(editor);
    expect((editor as HTMLInputElement).value).toBe("Sibling draft survives");
    expect(nativeTabButton("inspector")).toBeDefined();
    expect(workbench.getDocuments()).toHaveLength(1);
    expect(routers).toEqual(originalRouters);
  });
});
