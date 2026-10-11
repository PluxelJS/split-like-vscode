import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  type AnyRouter,
  type ErrorComponentProps,
  type RouterHistory,
} from "@tanstack/react-router";
import { createStore, useStore } from "@tanstack/react-store";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createWorkbench,
  Workbench,
  useWorkbenchContent,
  type WorkbenchCommand,
  type WorkbenchContentLifecycle,
  type WorkbenchProps,
} from "@worksplit/react";
import {
  Actions,
  DockLocation,
  I18nLabel,
  TabSetNode,
  type Action,
  type ILayoutApi,
  type ILayoutProps,
  type ITabSetAttributes,
  type Model,
  type TabNode,
} from "flexlayout-react";
import { createContext, createRef, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HostTheme = createContext("day");
const SessionContext = createContext<{ id: string; token: number } | null>(null);
const disposals: (() => Promise<unknown>)[] = [];

beforeEach(() => {
  // jsdom has no layout; nonempty geometry lets native FlexLayout mount its real portals.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 900, 650),
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(650);
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      observe = vi.fn<(element: Element) => void>();
      unobserve = vi.fn<(element: Element) => void>();
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
      dispatchEvent: vi.fn<MediaQueryList["dispatchEvent"]>(() => false),
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

function consumerShell(theme: string, props: WorkbenchProps) {
  return (
    <HostTheme.Provider value={theme}>
      <section aria-label="Application shell">
        <header>Application commands</header>
        <nav aria-label="Application navigation">Application areas</nav>
        <Workbench {...props} />
        <footer>Application status</footer>
      </section>
    </HostTheme.Provider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const session = useContext(SessionContext);
  const theme = useContext(HostTheme);
  if (!session) throw new Error("The application session provider is missing");
  return (
    <section
      data-testid={`frame-${session.id}`}
      data-provider-token={session.token}
      data-theme={theme}
    >
      {children}
    </section>
  );
}

function Pending() {
  const session = useContext(SessionContext);
  return <p role="status">Application pending {session?.id}</p>;
}

function RouteError({ error }: ErrorComponentProps) {
  const session = useContext(SessionContext);
  const theme = useContext(HostTheme);
  return (
    <p role="alert">
      Application error {session?.id}: {error instanceof Error ? error.message : String(error)} (
      {theme})
    </p>
  );
}

function fixture(withTool = false, commands: readonly WorkbenchCommand[] = []) {
  const routers: AnyRouter[] = [];
  const resources = new Set<string>();
  const contents = new Map<
    string,
    {
      content: ReturnType<typeof useWorkbenchContent>;
      lifecycle: WorkbenchContentLifecycle;
      unregister: () => void;
    }
  >();
  const disposed = vi.fn<(id: string) => void>();
  const saved = vi.fn<(id: string) => void>();
  let allowLeave = false;
  let toolUnavailable = false;
  let nextToken = 0;
  let finishSlow!: () => void;
  const slow = new Promise<void>((resolve) => {
    finishSlow = resolve;
  });
  const decide = vi.fn<(id: string, reason: "close" | "navigate") => boolean>(() => allowLeave);

  function SessionProvider({ children }: { children: ReactNode }) {
    const { id } = useWorkbenchContent();
    const [session] = useState(() => ({ id, token: ++nextToken }));
    return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
  }

  function Editor({ label }: { label: string }) {
    if (label === "tool" && toolUnavailable) throw new Error("Application tool unavailable");
    const content = useWorkbenchContent();
    const input = useRef<HTMLInputElement>(null);
    const revision = useRef(0);
    const lifecycle = useMemo<WorkbenchContentLifecycle>(
      () => ({
        isDirty: () => Boolean(input.current?.value),
        getCloseRevision: () => revision.current,
        beforeLeave: (reason) => decide(content.id, reason),
        focus: () => input.current?.focus({ preventScroll: true }),
        save: () => saved(content.id),
        dispose: () => disposed(content.id),
      }),
      [content],
    );
    useEffect(() => {
      resources.add(content.id);
      return () => {
        resources.delete(content.id);
      };
    }, [content]);
    useEffect(() => {
      const unregister = content.register(lifecycle);
      contents.set(content.id, { content, lifecycle, unregister });
      return unregister;
    }, [content, lifecycle]);
    return (
      <input
        ref={input}
        aria-label={`Editor ${label}`}
        defaultValue=""
        onChange={() => ++revision.current}
      />
    );
  }

  function DocumentPage() {
    const { name } = page.useParams();
    const { service } = root.useRouteContext();
    return (
      <>
        <p>Borrowed service: {service.name}</p>
        <Editor label={name} />
        <Link from={page.fullPath} to="." search={{ view: "slow" }}>
          Slow {name}
        </Link>
        <Link from={page.fullPath} to="." search={{ view: "error" }}>
          Fail {name}
        </Link>
      </>
    );
  }

  const root = createRootRouteWithContext<{ service: { name: string } }>()({
    component: () => (
      <Frame>
        <Outlet />
      </Frame>
    ),
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$name",
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === "string" ? search.view : "edit",
    }),
    loaderDeps: ({ search }) => ({ view: search.view }),
    loader: async ({ deps }) => {
      if (deps.view === "slow") await slow;
      if (deps.view === "error") throw new Error("Application loader failure");
      return deps.view;
    },
    component: DocumentPage,
    staticData: { worksplit: { title: "Application document" } },
  });
  const tree = root.addChildren([page]);
  const service = { name: "host-owned" };
  const createDocumentRouter = (history: RouterHistory) => {
    const router = createRouter({
      routeTree: tree,
      history,
      context: { service },
      Wrap: SessionProvider,
      defaultPendingComponent: Pending,
      defaultErrorComponent: RouteError,
      defaultPendingMs: 0,
      defaultPendingMinMs: 0,
      defaultStaleTime: Infinity,
    });
    routers.push(router);
    return router;
  };
  const workbench = createWorkbench({
    createRouter: createDocumentRouter,
    commands,
    layout: {
      global: { tabEnableRename: true, tabSetEnableCloseButton: true },
      borders: withTool
        ? [
            {
              type: "border",
              location: "bottom",
              selected: 0,
              children: [
                { type: "tab", id: "helper", name: "Helper", component: "worksplit.tool" },
              ],
            },
          ]
        : [],
      layout: { type: "row", children: [] },
    },
    tools: withTool
      ? [
          {
            id: "helper",
            render: () => (
              <SessionProvider>
                <Frame>
                  <Editor label="tool" />
                </Frame>
              </SessionProvider>
            ),
          },
        ]
      : [],
  });
  workbench.connectBrowser();
  disposals.push(() => workbench.dispose());
  const open = async (name: string) => {
    const result = await workbench.open({
      to: "/documents/$name",
      params: { name },
      search: { view: "edit" },
    });
    if (result.status !== "committed") throw new Error(`Open failed: ${result.status}`);
    return result.document.id;
  };
  return {
    workbench,
    open,
    routers,
    resources,
    contents,
    disposed,
    saved,
    decide,
    finishSlow,
    failTool: () => {
      toolUnavailable = true;
    },
    recoverTool: () => {
      toolUnavailable = false;
    },
    approve: () => {
      allowLeave = true;
    },
    reject: () => {
      allowLeave = false;
    },
  };
}

async function openPair(commands: readonly WorkbenchCommand[] = []) {
  const consumer = fixture(true, commands);
  const a = await consumer.open("A");
  const b = await consumer.open("B");
  const source = consumer.workbench.getEditingContext().activeGroupId;
  if (!source) throw new Error("The application document has no native TabSet");
  await consumer.workbench.dispatch(Actions.moveNode(b, source, DockLocation.RIGHT, -1));
  return { ...consumer, a, b };
}

function pressSave(target: HTMLElement, shiftKey = false) {
  const options = {
    key: shiftKey ? "S" : "s",
    code: "KeyS",
    ctrlKey: true,
    shiftKey,
    bubbles: true,
    cancelable: true,
  };
  const event = new KeyboardEvent("keydown", options);
  fireEvent(target, event);
  fireEvent.keyUp(target, options);
  return event;
}

describe("public React customization", () => {
  it("inherits native host HotkeysProvider defaults for built-in command bindings and unregisters them", async () => {
    const execute = vi.fn<WorkbenchCommand["execute"]>();
    const consumer = fixture(false, [{ id: "save", hotkey: "Mod+S", target: "document", execute }]);
    const props: WorkbenchProps = {
      workbench: consumer.workbench,
      "aria-label": "Keyboard workspace",
      tabIndex: -1,
      empty: null,
    };
    const shell = (enabled: boolean, preventDefault: boolean) => (
      <HotkeysProvider defaultOptions={{ hotkey: { enabled, preventDefault, platform: "linux" } }}>
        {consumerShell("day", props)}
      </HotkeysProvider>
    );
    const view = render(shell(false, true));
    await act(async () => {
      await consumer.open("A");
    });
    const editor = await screen.findByLabelText("Editor A");
    const workspace = screen.getByLabelText("Keyboard workspace");
    act(() => workspace.focus());
    expect(pressSave(workspace).defaultPrevented).toBe(false);
    expect(execute).not.toHaveBeenCalled();

    view.rerender(shell(true, false));
    expect(pressSave(workspace).defaultPrevented).toBe(false);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0]?.[0].id).toBe(consumer.workbench.getActiveDocument()?.id);

    view.rerender(shell(true, true));
    expect(pressSave(workspace).defaultPrevented).toBe(true);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    // Worksplit's command input policy and native root target remain explicit per binding.
    expect(pressSave(editor).defaultPrevented).toBe(false);
    expect(pressSave(screen.getByText("Application commands")).defaultPrevented).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(pressSave(workspace).defaultPrevented).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("uses the host's native Store and hotkey hook for dynamic bindings, captured command targets and cleanup", async () => {
    const preferences = createStore({
      binding: "Mod+S" as "Mod+S" | "Mod+Shift+S",
      enabled: true,
      ignoreInputs: false,
    });
    let finishFirst!: () => void;
    const firstCommand = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let pendingFirst = true;
    const started = vi.fn<(id: string) => void>();
    const failed = vi.fn<(error: unknown) => void>();
    const commands: readonly WorkbenchCommand[] = [
      {
        id: "save",
        target: "document",
        execute: async ({ id }): Promise<void> => {
          started(id);
          if (pendingFirst) {
            pendingFirst = false;
            await firstCommand;
          }
          await consumer.workbench.save(id);
        },
      },
    ];
    const catalogue = commands.map((command) => ({ ...command }));
    const consumer = await openPair(commands);

    function Application() {
      const preferencesNow = useStore(preferences, (state) => state);
      const target = useRef<HTMLDivElement>(null);
      useHotkey(
        preferencesNow.binding,
        () => {
          void consumer.workbench.executeCommand("save").catch(failed);
        },
        {
          target,
          enabled: preferencesNow.enabled,
          ignoreInputs: preferencesNow.ignoreInputs,
        },
      );
      return (
        <div ref={target}>
          <output aria-label="Application shortcut">
            {preferencesNow.binding} · {preferencesNow.enabled ? "enabled" : "disabled"} ·{" "}
            {preferencesNow.ignoreInputs ? "inputs ignored" : "inputs allowed"}
          </output>
          <button type="button">Application shortcut target</button>
          {consumerShell("day", { workbench: consumer.workbench, empty: null })}
        </div>
      );
    }

    const view = render(
      <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true, platform: "linux" } }}>
        <Application />
      </HotkeysProvider>,
    );
    const editorA = await screen.findByLabelText("Editor A");
    const editorB = await screen.findByLabelText("Editor B");
    const target = screen.getByRole("button", { name: "Application shortcut target" });
    const tokenA = screen.getByTestId(`frame-${consumer.a}`).getAttribute("data-provider-token");
    const routers = [...consumer.routers];

    act(() => consumer.workbench.activate(consumer.a));
    expect(pressSave(editorA).defaultPrevented).toBe(true);
    expect(started.mock.calls).toEqual([[consumer.a]]);
    expect(consumer.saved).not.toHaveBeenCalled();
    act(() => consumer.workbench.activate(consumer.b));
    await act(async () => finishFirst());
    await waitFor(() => expect(consumer.saved.mock.calls).toEqual([[consumer.a]]));
    expect(consumer.workbench.getActiveDocument()?.id).toBe(consumer.b);
    expect(pressSave(editorB).defaultPrevented).toBe(true);
    await waitFor(() => expect(consumer.saved.mock.calls).toEqual([[consumer.a], [consumer.b]]));
    expect(started).toHaveBeenCalledTimes(2);

    act(() => preferences.setState((state) => ({ ...state, binding: "Mod+Shift+S" })));
    expect(screen.getByLabelText("Application shortcut").textContent).toBe(
      "Mod+Shift+S · enabled · inputs allowed",
    );
    expect(pressSave(editorB).defaultPrevented).toBe(false);
    expect(started).toHaveBeenCalledTimes(2);
    expect(pressSave(editorB, true).defaultPrevented).toBe(true);
    await waitFor(() => expect(consumer.saved).toHaveBeenCalledTimes(3));

    act(() => preferences.setState((state) => ({ ...state, enabled: false })));
    expect(screen.getByLabelText("Application shortcut").textContent).toContain("disabled");
    expect(pressSave(editorB, true).defaultPrevented).toBe(false);
    expect(started).toHaveBeenCalledTimes(3);
    act(() => preferences.setState((state) => ({ ...state, enabled: true, ignoreInputs: true })));
    expect(screen.getByLabelText("Application shortcut").textContent).toBe(
      "Mod+Shift+S · enabled · inputs ignored",
    );
    expect(pressSave(editorB, true).defaultPrevented).toBe(false);
    expect(started).toHaveBeenCalledTimes(3);
    act(() => target.focus());
    expect(pressSave(target, true).defaultPrevented).toBe(true);
    await waitFor(() => expect(consumer.saved).toHaveBeenCalledTimes(4));
    expect(started.mock.calls).toEqual([[consumer.a], [consumer.b], [consumer.b], [consumer.b]]);
    expect(commands).toEqual(catalogue);
    expect(commands[0]?.hotkey).toBeUndefined();
    expect(screen.getByLabelText("Editor A")).toBe(editorA);
    expect(screen.getByLabelText("Editor B")).toBe(editorB);
    expect(screen.getByTestId(`frame-${consumer.a}`).getAttribute("data-provider-token")).toBe(
      tokenA,
    );
    expect(consumer.resources).toEqual(new Set([consumer.a, consumer.b, "helper"]));
    expect(consumer.routers).toEqual(routers);
    expect(failed).not.toHaveBeenCalled();

    view.unmount();
    expect(pressSave(target, true).defaultPrevented).toBe(false);
    expect(started).toHaveBeenCalledTimes(4);
  });

  it("owns shell DOM and native placeholders, render slots, icons, and the direct Layout ref", async () => {
    const { workbench, open, routers } = fixture();
    const layoutRef = createRef<ILayoutApi>();
    const click = vi.fn<() => void>();
    const slotClick = vi.fn<() => void>();
    const contextMenu = vi.fn<NonNullable<ILayoutProps["onContextMenu"]>>();
    render(
      consumerShell("day", {
        workbench,
        layoutRef,
        id: "consumer-workbench",
        className: "consumer-surface",
        style: { backgroundColor: "rgb(242, 243, 245)", height: 650 },
        "aria-label": "Application workspace",
        "aria-describedby": "host-description",
        onClick: click,
        empty: null,
        native: {
          onTabSetPlaceHolder: () => <p>Application empty workspace</p>,
          onRenderTab: (node, values) => {
            values.leading = <span data-testid={`leading-${node.getId()}`}>APP</span>;
            values.content = <span>{node.getName()}</span>;
          },
          onRenderTabSet: (_node, values) => {
            values.buttons.push(
              <button key="application-action" type="button" onClick={slotClick}>
                Application tabset action
              </button>,
            );
          },
          icons: { close: <span data-testid="application-close-icon">×</span> },
          onContextMenu: contextMenu,
        },
      }),
    );
    const host = screen.getByLabelText("Application workspace");
    expect(host.id).toBe("consumer-workbench");
    expect(host.classList.contains("consumer-surface")).toBe(true);
    expect(host.classList.contains("worksplit-workbench")).toBe(true);
    expect(host.style.backgroundColor).toBe("rgb(242, 243, 245)");
    expect(host.getAttribute("aria-describedby")).toBe("host-description");
    await screen.findByText("Application empty workspace");
    expect(host.querySelector(".worksplit-navigation")).toBeNull();
    expect(host.querySelector(".worksplit-empty")).toBeNull();
    expect(screen.queryByText("Open a document to begin.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Application tabset action" }));
    expect(slotClick).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    await act(async () => {
      await open("A");
    });
    const editor = await screen.findByLabelText("Editor A");
    const id = workbench.getActiveDocument()!.id;
    expect(screen.getAllByTestId(`leading-${id}`).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("application-close-icon").length).toBeGreaterThan(0);
    const tab = document.getElementById(`flexlayout-tabbutton-${id}`)!;
    fireEvent.contextMenu(tab);
    expect(contextMenu.mock.calls[0]?.[0].getId()).toBe(id);
    const nativeRoot = layoutRef.current?.getRootDiv();
    expect(nativeRoot instanceof HTMLDivElement).toBe(true);
    expect(host.contains(nativeRoot!)).toBe(true);
    const originalRouters = [...routers];
    act(() => layoutRef.current!.editTabName(id));
    const rename = await screen.findByRole("textbox", { name: "Rename tab" });
    fireEvent.change(rename, { target: { value: "Named through FlexLayout" } });
    fireEvent.keyDown(rename, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(workbench.getDocument(id)?.title).toBe("Named through FlexLayout"));
    act(() => layoutRef.current!.redraw());
    expect(screen.getByLabelText("Editor A")).toBe(editor);
    expect(routers).toEqual(originalRouters);
  });

  it("uses native Model creation hooks and removable change listeners through borrowed nodes", async () => {
    const { workbench, open } = fixture();
    const a = await open("A");
    const b = await open("B");
    const source = workbench.getEditingContext().activeGroupId;
    if (!source) throw new Error("The application document has no native TabSet");
    let model: Model | undefined;
    const created = vi.fn<(node?: TabNode) => ITabSetAttributes>((node) => ({
      name: `Application area ${node?.getId() ?? "empty"}`,
      enableMaximize: false,
      enableCloseButton: true,
    }));
    const changed = vi.fn<(action: Action) => void>();
    render(
      consumerShell("day", {
        workbench,
        empty: null,
        native: {
          onRenderTabSet: (node) => {
            if (model) return;
            model = node.getModel();
            model.setOnCreateTabSet(created);
            model.addChangeListener(changed);
          },
        },
      }),
    );
    const editorB = await screen.findByLabelText("Editor B");
    await act(async () => {
      expect(await workbench.dispatch(Actions.moveNode(a, source, DockLocation.RIGHT, -1))).toEqual(
        {
          status: "applied",
        },
      );
    });
    const editorA = await screen.findByLabelText("Editor A");
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0]?.[0]?.getId()).toBe(a);
    const tabset = model!.getNodeById(a)?.getParent();
    if (!(tabset instanceof TabSetNode))
      throw new Error("The split did not create a native TabSet");
    expect(tabset.getName()).toBe(`Application area ${a}`);
    expect(tabset.isEnableMaximize()).toBe(false);
    expect(tabset.isEnableCloseButton()).toBe(true);
    expect(changed.mock.calls.map(([action]) => action.type)).toContain(Actions.MOVE_NODE);
    expect(await screen.findByRole("tablist", { name: `Application area ${a}` })).toBeDefined();
    model!.removeChangeListener(changed);
    changed.mockClear();
    await act(async () => {
      expect(
        await workbench.dispatch(Actions.moveNode(a, source, DockLocation.CENTER, -1)),
      ).toEqual({
        status: "applied",
      });
    });
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Editor A")).toBe(editorA);
    expect(screen.getByLabelText("Editor B")).toBe(editorB);
    expect(workbench.getDocument(b)).toBeDefined();
  });

  it("keeps Router providers, live host context, editors and lifecycles across native moves and guarded deletes", async () => {
    const consumer = await openPair();
    const { workbench, a, b } = consumer;
    const props = { workbench, className: "consumer-surface", empty: null };
    const view = render(consumerShell("day", props));
    const editorA = await screen.findByLabelText("Editor A");
    const editorB = await screen.findByLabelText("Editor B");
    const tool = await screen.findByLabelText("Editor tool");
    const frameA = screen.getByTestId(`frame-${a}`);
    const tokenA = frameA.getAttribute("data-provider-token");
    const tokenB = screen.getByTestId(`frame-${b}`).getAttribute("data-provider-token");
    const originalRouters = [...consumer.routers];
    fireEvent.change(editorA, { target: { value: "Retained application draft" } });
    view.rerender(consumerShell("night", props));
    expect(frameA.getAttribute("data-theme")).toBe("night");
    expect(screen.getByTestId("frame-helper").getAttribute("data-theme")).toBe("night");
    const destination = workbench.getEditingContext().activeGroupId;
    if (!destination) throw new Error("The selected document has no native TabSet");
    await act(async () => {
      expect(
        await workbench.dispatch(Actions.moveNode(a, destination, DockLocation.CENTER, -1)),
      ).toEqual({ status: "applied" });
    });
    expect(screen.getByLabelText("Editor A")).toBe(editorA);
    expect(screen.getByLabelText("Editor B")).toBe(editorB);
    expect(screen.getByLabelText("Editor tool")).toBe(tool);
    expect((editorA as HTMLInputElement).value).toBe("Retained application draft");
    expect(frameA.getAttribute("data-provider-token")).toBe(tokenA);
    expect(screen.getByTestId(`frame-${b}`).getAttribute("data-provider-token")).toBe(tokenB);
    expect(consumer.resources).toEqual(new Set([a, b, "helper"]));
    expect(consumer.disposed).not.toHaveBeenCalled();
    expect(consumer.routers).toEqual(originalRouters);
    await act(async () => {
      expect(await workbench.dispatch(Actions.deleteTab(a))).toMatchObject({
        status: "rejected",
        reason: "decision",
      });
    });
    expect(consumer.decide).toHaveBeenCalledWith(a, "close");
    expect(screen.getByLabelText("Editor A")).toBe(editorA);
    consumer.approve();
    await act(async () => {
      expect(await workbench.dispatch(Actions.deleteTab(a))).toMatchObject({
        status: "closed",
        id: a,
        cleanupErrors: [],
      });
    });
    await waitFor(() => expect(screen.queryByLabelText("Editor A")).toBeNull());
    expect(consumer.disposed.mock.calls.filter(([id]) => id === a)).toHaveLength(1);
    expect(consumer.resources).toEqual(new Set([b, "helper"]));
    expect(screen.getByLabelText("Editor B")).toBe(editorB);
    expect(screen.getByTestId(`frame-${b}`).getAttribute("data-provider-token")).toBe(tokenB);
  });

  it("uses application Router pending and error components without replacing a sibling provider or Router", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consumer = await openPair();
    render(consumerShell("night", { workbench: consumer.workbench, empty: null }));
    await screen.findByLabelText("Editor A");
    const editorB = await screen.findByLabelText("Editor B");
    const tokenB = screen.getByTestId(`frame-${consumer.b}`).getAttribute("data-provider-token");
    const originalRouters = [...consumer.routers];
    fireEvent.click(screen.getByRole("link", { name: "Slow A" }));
    const pending = await screen.findByRole("status");
    expect(pending.textContent).toContain(`Application pending ${consumer.a}`);
    expect(screen.getByLabelText("Editor B")).toBe(editorB);
    await act(async () => consumer.finishSlow());
    await screen.findByLabelText("Editor A");
    fireEvent.click(screen.getByRole("link", { name: "Fail A" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain(`Application error ${consumer.a}`);
    expect(error.textContent).toContain("Application loader failure (night)");
    expect(screen.getByLabelText("Editor B")).toBe(editorB);
    expect(screen.getByTestId(`frame-${consumer.b}`).getAttribute("data-provider-token")).toBe(
      tokenB,
    );
    expect(consumer.routers).toEqual(originalRouters);
    expect(consumer.disposed.mock.calls.filter(([id]) => id === consumer.b)).toHaveLength(0);
  });

  it("uses native error translation and Retry while preserving the application's sibling content", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consumer = fixture(true);
    const a = await consumer.open("A");
    consumer.failTool();
    render(
      consumerShell("night", {
        workbench: consumer.workbench,
        empty: null,
        native: {
          i18nTranslator: (key) => {
            if (key === I18nLabel.Error_rendering_component) return "Application tool failed";
            if (key === I18nLabel.Error_rendering_component_retry) return "Retry application tool";
            return key;
          },
        },
      }),
    );
    const editorA = await screen.findByLabelText("Editor A");
    const frameA = screen.getByTestId(`frame-${a}`);
    const tokenA = frameA.getAttribute("data-provider-token");
    const originalRouters = [...consumer.routers];
    expect(screen.getByRole("alert").textContent).toContain("Application tool failed");
    fireEvent.change(editorA, { target: { value: "Application draft survives Retry" } });
    consumer.recoverTool();
    fireEvent.click(screen.getByRole("button", { name: "Retry application tool" }));
    await screen.findByLabelText("Editor tool");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Editor A")).toBe(editorA);
    expect((editorA as HTMLInputElement).value).toBe("Application draft survives Retry");
    expect(frameA.getAttribute("data-provider-token")).toBe(tokenA);
    expect(screen.getByTestId("frame-helper").getAttribute("data-theme")).toBe("night");
    expect(consumer.resources).toEqual(new Set([a, "helper"]));
    expect(consumer.routers).toEqual(originalRouters);
    expect(consumer.disposed).not.toHaveBeenCalled();
  });

  it("keeps old public registration callbacks from replacing a reopened tool's current lifecycle", async () => {
    const consumer = fixture(true);
    await consumer.open("A");
    render(consumerShell("day", { workbench: consumer.workbench, empty: null }));
    const editorA = await screen.findByLabelText("Editor A");
    const oldTool = await screen.findByLabelText("Editor tool");
    const old = consumer.contents.get("helper")!;
    fireEvent.change(oldTool, { target: { value: "Old tool draft" } });
    await act(async () => {
      expect(await consumer.workbench.dispatch(Actions.deleteTab("helper"))).toMatchObject({
        status: "rejected",
        reason: "decision",
      });
    });
    consumer.approve();
    await act(async () => {
      expect(await consumer.workbench.dispatch(Actions.deleteTab("helper"))).toMatchObject({
        status: "closed",
        id: "helper",
      });
    });
    await waitFor(() => expect(screen.queryByLabelText("Editor tool")).toBeNull());
    expect(oldTool.isConnected).toBe(false);
    const target = consumer.workbench.getEditingContext().activeGroupId;
    if (!target) throw new Error("The application document has no native target");
    await act(async () => {
      expect(
        await consumer.workbench.dispatch(
          Actions.addTab(
            { id: "helper", name: "Reopened helper", component: "worksplit.tool" },
            target,
            DockLocation.CENTER,
            -1,
          ),
        ),
      ).toEqual({ status: "applied" });
    });
    const fresh = await screen.findByLabelText("Editor tool");
    expect(fresh).not.toBe(oldTool);
    expect(consumer.contents.get("helper")!.content).not.toBe(old.content);
    fireEvent.change(fresh, { target: { value: "Fresh tool draft" } });
    consumer.reject();
    const lateDispose = vi.fn<() => void>();
    const lateDecision = vi.fn<() => boolean>(() => true);
    const rejectedLifecycle = {
      isDirty: () => false,
      beforeLeave: lateDecision,
      dispose: lateDispose,
    };
    expect(() => old.content.register(rejectedLifecycle)).toThrow(
      "Cannot register closed content helper",
    );
    expect(lateDispose).not.toHaveBeenCalled();
    // A failed registration leaves its resource ownership with the application.
    rejectedLifecycle.dispose();
    expect(lateDispose).toHaveBeenCalledTimes(1);
    await act(async () => {
      old.unregister();
    });
    await act(async () => {
      expect(await consumer.workbench.dispatch(Actions.deleteTab("helper"))).toMatchObject({
        status: "rejected",
        reason: "decision",
      });
    });
    expect(lateDecision).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Editor tool")).toBe(fresh);
    expect((fresh as HTMLInputElement).value).toBe("Fresh tool draft");
    expect(screen.getByLabelText("Editor A")).toBe(editorA);
    expect(consumer.disposed.mock.calls.filter(([id]) => id === "helper")).toHaveLength(1);

    // Even reusing a lifecycle object cannot make the old node's unregister own the new node.
    const current = consumer.contents.get("helper")!;
    Object.assign(old.lifecycle, current.lifecycle);
    await act(async () => {
      current.unregister();
      current.content.register(old.lifecycle);
      old.unregister();
    });
    await act(async () => {
      expect(await consumer.workbench.dispatch(Actions.deleteTab("helper"))).toMatchObject({
        status: "rejected",
        reason: "decision",
      });
    });
    expect(screen.getByLabelText("Editor tool")).toBe(fresh);
  });
});
