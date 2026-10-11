import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  type RouterHistory,
} from "@tanstack/react-router";
import { createStore, useStore } from "@tanstack/react-store";
import {
  createWorkbench,
  createLayoutPolicy,
  Workbench,
  useWorkbenchState,
  useWorkbenchContent,
  useWorkbenchContentLifecycle,
  type WorkbenchContentLifecycle,
  type WorkbenchProps,
  type WorkbenchSnapshot,
} from "@worksplit/react";
import {
  Actions,
  DockLocation,
  TabSetNode,
  type IJsonModel,
  type ILayoutApi,
  type ILayoutProps,
  type Model,
} from "flexlayout-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";

import "flexlayout-react/style/dark.css";
import "@worksplit/react/style.css";
import "./app.css";

const services = {
  name: "External services via Router.Wrap",
  metrics: createStore({
    loads: 0,
    saves: 0,
    routersCreated: 0,
    liveRouters: 0,
    editorMounts: 0,
    editorUnmounts: 0,
    subscriptions: 0,
    disposals: 0,
    providerMounts: 0,
    providerUnmounts: 0,
    providers: 0,
    pendingSaveId: "",
    lastSavedId: "",
    lastLeave: "",
  }),
};
const keyboardPreferences = createStore({
  saveKey: "Mod+S" as "Mod+S" | "Mod+Shift+S",
  enabled: true,
  ignoreInputs: false,
});
const ServiceContext = createContext<{
  services: typeof services;
  documentId: string;
  token: string;
} | null>(null);
let nextProviderToken = 0;
const issues = createStore<string[]>([]);
const rootRoute = createRootRouteWithContext<{ services: typeof services }>()({
  component: Outlet,
});
const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$id",
  validateSearch: (search: Record<string, unknown>) => ({
    view: typeof search.view === "string" ? search.view : "edit",
  }),
  loader: async ({ context, params }) => {
    if (params.id.startsWith("Slow-")) await new Promise((done) => setTimeout(done, 300));
    context.services.metrics.setState((state) => ({ ...state, loads: state.loads + 1 }));
    return { id: params.id, text: "Draft for document " + params.id };
  },
  staticData: {
    worksplit: {
      title: "Published document",
      navigationKey: "documents",
    },
  },
  component: Editor,
});
const routeTree = rootRoute.addChildren([documentRoute]);
const boundedScenario = window.location.hash === "#bounded";
const layout: IJsonModel = {
  global: {
    tabEnableFloat: false,
    tabEnablePopout: false,
    tabEnablePin: true,
    tabEnableRename: true,
    tabSetEnableTabGroups: true,
  },
  borders: [
    {
      type: "border",
      location: "bottom",
      selected: 0,
      children: [
        {
          type: "tab",
          id: "inspector",
          name: "Native Inspector title",
          component: "worksplit.tool",
        },
      ],
    },
  ],
  layout: {
    type: "row",
    children: [
      { type: "tabset", id: "left", name: "Writing", enableDeleteWhenEmpty: false, children: [] },
      ...(boundedScenario
        ? []
        : [
            {
              type: "tabset" as const,
              id: "right",
              name: "Reference",
              enableDeleteWhenEmpty: false,
              children: [],
            },
          ]),
    ],
  },
};
const createRouterForHistory = (history: RouterHistory) => {
  services.metrics.setState((state) => ({
    ...state,
    routersCreated: state.routersCreated + 1,
    liveRouters: state.liveRouters + 1,
  }));
  const destroy = history.destroy;
  let released = false;
  history.destroy = () => {
    if (!released) {
      released = true;
      services.metrics.setState((state) => ({ ...state, liveRouters: state.liveRouters - 1 }));
    }
    destroy.call(history);
  };
  return createRouter({
    routeTree,
    history,
    context: { services },
    defaultPendingMinMs: 0,
    defaultStaleTime: Infinity,
    Wrap: ServiceProvider,
  });
};
export const workbench = createWorkbench({
  createRouter: createRouterForHistory,
  layout,
  layoutPolicy: createLayoutPolicy({ maxRows: 2, maxColumns: 2, maxTabsets: 4 }),
  tools: [
    { id: "inspector", render: ({ id }) => <Tool id={id} /> },
    { id: "outline", render: ({ id }) => <Tool id={id} /> },
  ],
  commands: [
    {
      id: "save",
      target: "document",
      execute: async ({ id }): Promise<void> => {
        services.metrics.setState((state) => ({ ...state, pendingSaveId: id }));
        await new Promise((resolve) => setTimeout(resolve, 200));
        try {
          await workbench.save(id);
        } finally {
          services.metrics.setState((state) => ({ ...state, pendingSaveId: "" }));
        }
      },
    },
  ],
  onIssue: ({ code, error }) => issues.setState((state) => [...state, code + ": " + String(error)]),
});

declare global {
  interface Window {
    packedConsumer?: {
      workbench: typeof workbench;
      Actions: typeof Actions;
      DockLocation: typeof DockLocation;
      getLayoutApi: () => ILayoutApi | null;
      getMetrics: () => ReturnType<typeof services.metrics.get>;
      getPreferences: () => ReturnType<typeof keyboardPreferences.get>;
    };
  }
}

function ServiceProvider({ children }: { children: ReactNode }) {
  const { id } = useWorkbenchContent();
  const [token] = useState(() => "provider-" + ++nextProviderToken);
  const value = useMemo(() => ({ services, documentId: id, token }), [id, token]);
  useEffect(() => {
    services.metrics.setState((state) => ({
      ...state,
      providerMounts: state.providerMounts + 1,
      providers: state.providers + 1,
    }));
    return () =>
      services.metrics.setState((state) => ({
        ...state,
        providerUnmounts: state.providerUnmounts + 1,
        providers: state.providers - 1,
      }));
  }, []);
  return <ServiceContext.Provider value={value}>{children}</ServiceContext.Provider>;
}

function Editor() {
  const content = useWorkbenchContent();
  const inherited = useContext(ServiceContext);
  if (inherited?.services !== services || inherited.documentId !== content.id)
    throw new Error("Router.Wrap did not supply the application provider");
  const data = documentRoute.useLoaderData();
  const input = useRef<HTMLTextAreaElement>(null);
  const dirty = useRef(false);
  const revision = useRef(0);
  const release = useRef<(() => void) | null>(null);
  const [saveReceipt, setSaveReceipt] = useState(services.metrics.get().saves);
  const [navigation, setNavigation] = useState("");
  const [placement, setPlacement] = useState("");
  const detailSequence = useRef(0);
  const openDetail = (location: typeof DockLocation.RIGHT, preserveFocus: boolean) => {
    const source = workbench.getDocument(content.id);
    if (!source?.containerId) throw new Error("The originating document has no native container");
    setPlacement("opening");
    void workbench
      .open(
        {
          to: "/documents/$id",
          params: { id: `${data.id}-detail-${++detailSequence.current}` },
          search: { view: "edit" },
        },
        { target: source.containerId, location, preserveFocus, preview: true },
      )
      .then((result) =>
        setPlacement(
          result.status === "rejected" ? `${result.status}:${result.reason}` : result.status,
        ),
      )
      .catch((error: unknown) => setPlacement(String(error)));
  };
  useHotkey("Alt+Shift+ArrowRight", () => openDetail(DockLocation.RIGHT, true), {
    target: input,
    ignoreInputs: false,
  });
  useEffect(() => {
    const subscription = services.metrics.subscribe((state) => setSaveReceipt(state.saves));
    services.metrics.setState((state) => ({
      ...state,
      editorMounts: state.editorMounts + 1,
      subscriptions: state.subscriptions + 1,
    }));
    let disposed = false;
    release.current = () => {
      if (disposed) return;
      disposed = true;
      subscription.unsubscribe();
      services.metrics.setState((state) => ({
        ...state,
        subscriptions: state.subscriptions - 1,
        disposals: state.disposals + 1,
      }));
    };
    return () => {
      release.current?.();
      services.metrics.setState((state) => ({
        ...state,
        editorUnmounts: state.editorUnmounts + 1,
      }));
    };
  }, []);
  const lifecycle = useMemo<WorkbenchContentLifecycle>(
    () => ({
      isDirty: () => dirty.current,
      getCloseRevision: () => revision.current,
      beforeLeave: (reason, context) => {
        services.metrics.setState((state) => ({
          ...state,
          lastLeave: JSON.stringify({ reason, ...context }),
        }));
        return !dirty.current || window.confirm("Discard this unsaved draft?");
      },
      focus: () => input.current?.focus(),
      save: () => {
        dirty.current = false;
        services.metrics.setState((state) => ({
          ...state,
          saves: state.saves + 1,
          lastSavedId: content.id,
        }));
      },
      dispose: () => release.current?.(),
    }),
    [content.id],
  );
  useWorkbenchContentLifecycle(lifecycle);
  return (
    <article className="editor" data-document-id={content.id}>
      <h2>Document {data.id}</h2>
      <div className="document-placement" role="group" aria-label={`Document ${data.id} actions`}>
        <button type="button" onClick={() => workbench.keep(content.id)}>
          Keep this document
        </button>
        <button type="button" onClick={() => openDetail(DockLocation.RIGHT, true)}>
          Show detail right
        </button>
        <button type="button" onClick={() => openDetail(DockLocation.BOTTOM, true)}>
          Show detail below
        </button>
        <button type="button" onClick={() => openDetail(DockLocation.RIGHT, false)}>
          Focus detail right
        </button>
        <button type="button" onClick={() => openDetail(DockLocation.BOTTOM, false)}>
          Focus detail below
        </button>
        <button
          type="button"
          onClick={() => {
            setPlacement("opening");
            void workbench
              .open({
                to: "/documents/$id",
                params: { id: `Slow-${data.id}` },
                search: { view: "edit" },
              })
              .then((result) => setPlacement(result.status));
          }}
        >
          Open delayed detail
        </button>
        <output aria-label={`Detail placement ${data.id}`}>{placement}</output>
      </div>
      <p data-router-wrap data-document-id={content.id} data-provider-token={inherited.token}>
        {inherited.services.name}
      </p>
      <textarea
        ref={input}
        aria-label={"Draft " + data.id}
        defaultValue={data.text}
        onChange={() => {
          dirty.current = true;
          ++revision.current;
        }}
      />
      <button
        type="button"
        onClick={() => {
          void content.executeCommand("save");
        }}
      >
        Save document
      </button>
      <Link to="/documents/$id" params={{ id: data.id }} search={{ view: "preview" }}>
        Preview with native Link
      </Link>
      <button
        type="button"
        onClick={() => {
          void workbench
            .open({ to: "/documents/$id", params: { id: data.id }, search: { view: "preview" } })
            .then((result) => setNavigation(result.status));
        }}
      >
        Preview through workbench
      </button>
      <output aria-label={"Document navigation " + data.id}>{navigation}</output>
      <output aria-label={"Save receipt " + data.id}>{saveReceipt}</output>
    </article>
  );
}

function Tool({ id }: { id: string }) {
  return (
    <article className="tool">
      <h2>{id === "inspector" ? "Inspector" : "Outline"}</h2>
      <textarea
        aria-label={id + " note"}
        defaultValue="A native tool, with its title owned by FlexLayout JSON."
      />
    </article>
  );
}

const renderTab: NonNullable<ILayoutProps["onRenderTab"]> = (_node, values) => {
  values.leading = (
    <span className="consumer-icon" aria-hidden="true">
      ◇
    </span>
  );
};
const renderTabSet: NonNullable<ILayoutProps["onRenderTabSet"]> = (node, values) => {
  values.leading = (
    <span className="consumer-header">
      {node instanceof TabSetNode ? node.getName() || "Editors" : "Tools"} · native slot
    </span>
  );
  if (node instanceof TabSetNode)
    values.stickyButtons.push(
      <button
        key="native-maximize"
        type="button"
        onClick={() => {
          void workbench.dispatch(Actions.maximizeToggle(node.getId()));
        }}
      >
        Maximize group
      </button>,
    );
};
const renderEmpty = () => <p className="editor">Application native empty group</p>;

function App() {
  const active = useWorkbenchState(workbench, (state) => state.activeDocumentId);
  const metrics = useStore(services.metrics, (state) => state);
  const reported = useStore(issues, (state) => state);
  const shortcuts = useStore(keyboardPreferences, (state) => state);
  useHotkey(
    shortcuts.saveKey,
    () => {
      void workbench
        .executeCommand("save")
        .catch((error: unknown) => issues.setState((state) => [...state, String(error)]));
    },
    { enabled: shortcuts.enabled, ignoreInputs: shortcuts.ignoreInputs },
  );
  const layoutApi = useRef<ILayoutApi>(null);
  const nativeModel = useRef<Model | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading public package workspace");
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  useEffect(() => {
    window.packedConsumer = {
      workbench,
      Actions,
      DockLocation,
      getLayoutApi: () => layoutApi.current,
      getMetrics: () => services.metrics.get(),
      getPreferences: () => keyboardPreferences.get(),
    };
    setReady(!!layoutApi.current?.getRootDiv());
    return () => {
      delete window.packedConsumer;
    };
  }, []);
  const native = useMemo<NonNullable<WorkbenchProps["native"]>>(
    () => ({
      icons: { close: <span aria-hidden="true">×</span> },
      onRenderTab: renderTab,
      onRenderTabSet: (node, values) => {
        nativeModel.current = node.getModel();
        renderTabSet(node, values);
      },
      onModelChange: (model, action) => {
        nativeModel.current = model;
        setStatus(action.type);
      },
      onTabSetPlaceHolder: renderEmpty,
    }),
    [],
  );
  const nativeSlotTypes: Pick<ILayoutProps, "onRenderTab" | "onRenderTabSet"> = native;
  void nativeSlotTypes;
  const run = (operation: () => Promise<unknown>) => {
    void operation()
      .then((result) => setStatus(JSON.stringify(result)))
      .catch((error: unknown) => setStatus(String(error)));
  };
  return (
    <>
      <header>
        <h1>Published Worksplit consumer</h1>
        <p>Application context, native chrome and document sessions</p>
      </header>
      <Workbench
        workbench={workbench}
        className="packed-workspace"
        aria-label="Published consumer workspace"
        data-consumer="tarball"
        style={{
          height: "calc(100dvh - 88px)",
          gridTemplateColumns: "220px minmax(0, 1fr)",
          background: "#121c24",
        }}
        layoutRef={layoutApi}
        native={native}
        navigation={
          <>
            <fieldset className="keyboard-preferences">
              <legend>Application keyboard preferences</legend>
              <label>
                Save shortcut
                <select
                  aria-label="Save shortcut"
                  value={shortcuts.saveKey}
                  onChange={(event) => {
                    const saveKey = event.target.value;
                    if (saveKey === "Mod+S" || saveKey === "Mod+Shift+S")
                      keyboardPreferences.setState((state) => ({ ...state, saveKey }));
                  }}
                >
                  <option value="Mod+S">Mod+S</option>
                  <option value="Mod+Shift+S">Mod+Shift+S</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  aria-label="Enable save shortcut"
                  checked={shortcuts.enabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    keyboardPreferences.setState((state) => ({ ...state, enabled }));
                  }}
                />
                Enable save shortcut
              </label>
              <label>
                <input
                  type="checkbox"
                  aria-label="Ignore shortcuts in inputs"
                  checked={shortcuts.ignoreInputs}
                  onChange={(event) => {
                    const ignoreInputs = event.target.checked;
                    keyboardPreferences.setState((state) => ({ ...state, ignoreInputs }));
                  }}
                />
                Ignore shortcuts in inputs
              </label>
              <output aria-label="Shortcut preference">
                {shortcuts.saveKey} · {shortcuts.enabled ? "enabled" : "disabled"} ·{" "}
                {shortcuts.ignoreInputs ? "inputs ignored" : "inputs allowed"}
              </output>
              <output aria-label="Save command receipt">
                {metrics.pendingSaveId
                  ? "Saving " + metrics.pendingSaveId
                  : metrics.lastSavedId
                    ? "Saved " + metrics.lastSavedId
                    : "No saves yet"}
              </output>
            </fieldset>
            <button
              type="button"
              onClick={() =>
                run(() =>
                  workbench.open({
                    to: "/documents/$id",
                    params: { id: "A" },
                    search: { view: "edit" },
                  }),
                )
              }
            >
              Open A
            </button>
            <button
              type="button"
              onClick={() =>
                run(() =>
                  workbench.open({
                    to: "/documents/$id",
                    params: { id: "B" },
                    search: { view: "edit" },
                  }),
                )
              }
            >
              Open B
            </button>
            <details className="document-actions">
              <summary>Document and layout actions</summary>
              <button
                type="button"
                onClick={() =>
                  run(() =>
                    workbench.open(
                      { to: "/documents/$id", params: { id: "A" }, search: { view: "edit" } },
                      { reuse: "preserve" },
                    ),
                  )
                }
              >
                Reveal A preserving filters
              </button>
              {["C", "D", "E", "F"].map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    run(() =>
                      workbench.open(
                        { to: "/documents/$id", params: { id }, search: { view: "edit" } },
                        { preview: true },
                      ),
                    )
                  }
                >
                  Preview {id}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (active) workbench.keep(active);
                }}
              >
                Keep active document
              </button>
              <button
                type="button"
                onClick={() =>
                  run(async () => {
                    const document = workbench.getActiveDocument();
                    if (!document) throw new Error("An active document is required");
                    return workbench.duplicate(document.id);
                  })
                }
              >
                Duplicate active document
              </button>
              {(["bottom", "right"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() =>
                    run(async () => {
                      const document = workbench.getActiveDocument();
                      const target = workbench.getEditingContext().activeGroupId;
                      if (!document || !target)
                        throw new Error("An active document group is required");
                      return workbench.dispatch(
                        Actions.moveNode(
                          document.id,
                          target,
                          side === "bottom" ? DockLocation.BOTTOM : DockLocation.RIGHT,
                          -1,
                        ),
                      );
                    })
                  }
                >
                  Split active {side}
                </button>
              ))}
            </details>
            <button
              type="button"
              onClick={() => {
                if (active) layoutApi.current?.editTabName(active);
              }}
            >
              Rename native tab
            </button>
            <button type="button" onClick={() => layoutApi.current?.redraw()}>
              Redraw native Layout
            </button>
            <button
              type="button"
              onClick={() =>
                run(async () => {
                  const target = nativeModel.current?.getActiveTabset()?.getId();
                  if (!target) throw new Error("Native active tabset is unavailable");
                  return workbench.dispatch(
                    Actions.addTab(
                      {
                        type: "tab",
                        id: "outline",
                        name: "Native Outline title",
                        component: "worksplit.tool",
                      },
                      target,
                      DockLocation.CENTER,
                      -1,
                    ),
                  );
                })
              }
            >
              Add registered Outline tool
            </button>
            <button type="button" onClick={() => setSnapshot(workbench.snapshot())}>
              Capture native snapshot
            </button>
            <output aria-label="Native Layout ref">
              {ready ? "Native Layout API ready" : "Waiting for native Layout"}
            </output>
            <output aria-label="Loader and save counts">
              {metrics.loads} loads · {metrics.saves} saves
            </output>
            <output aria-label="Operation status">{status}</output>
            <output aria-label="Issues">{reported.join("\n") || "No issues"}</output>
            {snapshot && (
              <pre aria-label="Native snapshot">{JSON.stringify(snapshot.layout, null, 2)}</pre>
            )}
          </>
        }
      />
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true } }}>
    <App />
  </HotkeysProvider>,
);
const disconnect = workbench.connectBrowser();
void (async () => {
  const href = window.location.pathname.startsWith("/documents/")
    ? window.location.pathname + window.location.search
    : "/documents/A?view=edit";
  const initial = await workbench.start(href);
  if (initial.status !== "committed") throw new Error("Initial document failed: " + initial.status);
  const second = await workbench.open(
    { to: "/documents/$id", params: { id: "B" }, search: { view: "edit" } },
    { target: boundedScenario ? "left" : "right" },
  );
  if (second.status !== "committed") throw new Error("Reference document failed: " + second.status);
  workbench.activate(initial.document.id, { focus: false });
})().catch((error: unknown) => issues.setState((state) => [...state, String(error)]));
window.addEventListener(
  "pagehide",
  () => {
    disconnect();
    void workbench.dispose().finally(() => root.unmount());
  },
  { once: true },
);
