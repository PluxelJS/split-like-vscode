import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useBlocker,
  type RouterHistory,
} from "@tanstack/react-router";
import { createStore, useStore } from "@tanstack/react-store";
import {
  createWorkbench,
  Workbench,
  useWorkbenchContent,
  useWorkbenchContentLifecycle,
  useWorkbenchState,
  type NavigationResult,
  type WorkbenchContentLifecycle,
  type WorkbenchInstance,
} from "@worksplit/react";
import { Actions, DockLocation, type IJsonModel } from "flexlayout-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";

import "flexlayout-react/style/dark.css";
import "@worksplit/react/style.css";
import "./styles.css";

const metrics = {
  requests: 0,
  renders: 0,
  mounts: 0,
  unmounts: 0,
  subscriptions: 0,
  routersCreated: 0,
  liveRouters: 0,
  disposed: 0,
};
const subscribers = new Set<() => void>();
const histories = new Set<RouterHistory>();
function readMetrics() {
  return {
    ...metrics,
    historySubscriptions: [...histories].reduce(
      (total, history) => total + history.subscribers.size,
      0,
    ),
  };
}
const service = {
  subscribe(listener: () => void) {
    subscribers.add(listener);
    ++metrics.subscriptions;
    return () => {
      subscribers.delete(listener);
      --metrics.subscriptions;
    };
  },
};
type Decision = {
  requestId: number;
  id: string;
  reason: string;
  resolve: (allow: boolean) => void;
};
const decisions = createStore<Decision[]>([]);
const messages = createStore<{ id: number; text: string }[]>([]);
let nextMessage = 0;
let nextDecision = 0;
function message(text: string) {
  messages.setState((values) => [...values.slice(-9), { id: ++nextMessage, text }]);
}
function confirmLeave(id: string, reason: string) {
  return new Promise<boolean>((resolve) =>
    decisions.setState((values) => [...values, { requestId: ++nextDecision, id, reason, resolve }]),
  );
}

const rootRoute = createRootRouteWithContext<{ service: typeof service }>()({
  component: Outlet,
  errorComponent: ({ error }) => <div role="alert">Route failed: {String(error)}</div>,
});
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <div className="document-page">
      <h1>Welcome to Worksplit</h1>
      <p>Open two documents from the workspace navigation.</p>
    </div>
  ),
  staticData: { worksplit: { title: "Welcome", navigationKey: "home" } },
});
const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$id",
  validateSearch: (search: Record<string, unknown>) => ({
    view: typeof search.view === "string" ? search.view : "edit",
    delay: typeof search.delay === "number" ? search.delay : 0,
  }),
  loaderDeps: ({ search }) => ({ delay: search.delay }),
  loader: async ({ params, deps, abortController }) => {
    ++metrics.requests;
    if (params.id === "error") throw new Error("Deliberate loader failure");
    const response = await fetch(
      `/api/documents/${encodeURIComponent(params.id)}?delay=${deps.delay}`,
      { signal: abortController.signal },
    );
    if (!response.ok) throw new Error(`Document request failed: ${response.status}`);
    return (await response.json()) as { id: string; text: string };
  },
  remountDeps: ({ params }) => params.id,
  component: DocumentPage,
  staticData: { worksplit: { title: "Document", navigationKey: "documents" } },
});
const detailsRoute = createRoute({
  getParentRoute: () => documentRoute,
  path: "/details",
  component: () => (
    <p data-testid="nested-route">Nested Outlet for {documentRoute.useParams().id}</p>
  ),
});
const aliasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/alias-b",
  beforeLoad: () => {
    throw redirect({
      to: "/documents/$id",
      params: { id: "B" },
      search: { view: "edit", delay: 0 },
    });
  },
});
const brokenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/broken",
  component: () => {
    throw new Error("Deliberate renderer failure");
  },
  staticData: { worksplit: { title: "Broken", navigationKey: "errors" } },
});
const routeTree = rootRoute.addChildren([
  homeRoute,
  documentRoute.addChildren([detailsRoute]),
  aliasRoute,
  brokenRoute,
]);
function makeRouter(history: RouterHistory) {
  histories.add(history);
  ++metrics.routersCreated;
  ++metrics.liveRouters;
  const destroy = history.destroy.bind(history);
  let live = true;
  history.destroy = () => {
    if (live) {
      live = false;
      --metrics.liveRouters;
      histories.delete(history);
    }
    destroy();
  };
  return createRouter({
    routeTree,
    history,
    context: { service },
    defaultStaleTime: Infinity,
    defaultPendingMinMs: 0,
    defaultPendingMs: 50,
    scrollRestoration: false,
  });
}
type DemoRouter = ReturnType<typeof makeRouter>;
declare module "@tanstack/react-router" {
  interface Register {
    router: DemoRouter;
  }
}

function DocumentPage() {
  useEffect(() => {
    ++metrics.renders;
  });
  const { id } = documentRoute.useParams();
  const search = documentRoute.useSearch();
  const data = documentRoute.useLoaderData();
  const { service: shared } = documentRoute.useRouteContext();
  const content = useWorkbenchContent();
  const [draft, setDraft] = useState("");
  const [guard, setGuard] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const editing = useRef({ version: 0, saved: "", draft: "" });
  useEffect(() => {
    ++metrics.mounts;
    const off = shared.subscribe(() => {});
    return () => {
      ++metrics.unmounts;
      off();
    };
  }, [shared]);
  useBlocker({ shouldBlockFn: () => guard, enableBeforeUnload: false });
  const lifecycle = useMemo<WorkbenchContentLifecycle>(
    () => ({
      isDirty: () => editing.current.draft !== editing.current.saved,
      beforeLeave: async (reason) => {
        const version = editing.current.version;
        const allowed = await confirmLeave(id, reason);
        return allowed && version === editing.current.version;
      },
      focus: () => input.current?.focus({ preventScroll: true }),
      save: async () => {
        const version = editing.current.version;
        const text = editing.current.draft;
        await new Promise((resolve) => setTimeout(resolve, 60));
        if (id === "save-error") throw new Error("Deliberate save failure");
        if (version === editing.current.version) {
          editing.current.saved = text;
          message(`Saved ${id}`);
        }
      },
      dispose: () => {
        ++metrics.disposed;
      },
    }),
    [id],
  );
  useWorkbenchContentLifecycle(lifecycle);
  return (
    <section className="document-page" data-testid={`document-${id}`}>
      <header>
        <span className="eyebrow">ROUTED DOCUMENT</span>
        <h1>Document {id}</h1>
        <p>
          {data.text} View: <strong>{search.view}</strong>
        </p>
      </header>
      <div className="document-actions">
        <Link
          from={documentRoute.fullPath}
          to="."
          search={(previous) => ({
            ...previous,
            view: previous.view === "edit" ? "preview" : "edit",
          })}
        >
          Change view
        </Link>
        <Link from={documentRoute.fullPath} to="./details" search={(previous) => previous}>
          Details
        </Link>
        <Link to="/alias-b">Native redirect to B</Link>
        <button
          onClick={() =>
            void workbench.save(content.id).catch((error: unknown) => message(String(error)))
          }
        >
          Save
        </button>
        <button
          onClick={() =>
            void workbench
              .close(content.id)
              .then((result) => message(`Close ${id}: ${result.status}`))
          }
        >
          Close document
        </button>
      </div>
      <label className="draft-label">
        Draft {id}
        <textarea
          ref={input}
          aria-label={`Draft ${id}`}
          value={draft}
          onChange={(event) => {
            const value = event.target.value;
            editing.current.draft = value;
            ++editing.current.version;
            setDraft(value);
          }}
          placeholder="Type here; state survives docking and hiding."
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={guard}
          onChange={(event) => setGuard(event.target.checked)}
        />{" "}
        Native Router blocker
      </label>
      <div className="document-scroll" data-testid={`scroll-${id}`}>
        {Array.from({ length: 65 }, (_, index) => (
          <p key={index}>
            Line {index + 1}: {id} keeps its own input, scroll position, subscriptions and route
            context.
          </p>
        ))}
      </div>
      <div className="document-actions">
        <Link from={documentRoute.fullPath} to="." search={{ view: "slow", delay: 900 }}>
          Slow view
        </Link>
        <Link from={documentRoute.fullPath} to="." search={{ view: "fast", delay: 0 }}>
          Fast view
        </Link>
      </div>
      <Outlet />
    </section>
  );
}
function Inspector() {
  const content = useWorkbenchContent();
  const [menu, setMenu] = useState(false);
  const active = useWorkbenchState(workbench, (state) =>
    state.activeDocumentId ? workbench.getDocument(state.activeDocumentId)?.href : null,
  );
  const [sample, setSample] = useState(readMetrics);
  useEffect(() => {
    const timer = setInterval(() => setSample(readMetrics()), 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="inspector">
      <div>
        <span className="eyebrow">GLOBAL TOOL</span>
        <h2>Inspector</h2>
        <p data-testid="inspector-active">Active document: {active ?? "none"}</p>
        <input aria-label="Inspector note" placeholder="Tool input survives hiding and moving" />
        <button onClick={() => setMenu(true)}>Tool menu</button>
        {menu &&
          createPortal(
            <div role="menu" className="tool-menu">
              <button
                role="menuitem"
                onClick={() => {
                  void content.executeCommand("tool-context");
                  setMenu(false);
                }}
              >
                Run tool command
              </button>
            </div>,
            document.body,
          )}
      </div>
      <pre data-testid="metrics">{JSON.stringify(sample, null, 2)}</pre>
    </section>
  );
}
const layout: IJsonModel = {
  global: {
    tabEnablePin: true,
    tabEnableRename: false,
    tabEnableFloat: false,
    tabEnablePopout: false,
    tabSetEnableDeleteWhenEmpty: false,
    tabSetEnableClose: false,
    borderEnableAutoHide: true,
    tabSetMinWidth: 120,
    tabSetMinHeight: 140,
  },
  borders: [
    {
      type: "border",
      location: "bottom",
      size: 195,
      selected: 0,
      children: [
        {
          type: "tab",
          id: "inspector",
          name: "Inspector",
          component: "worksplit.tool",
          enableClose: false,
          enableFloat: false,
          enablePopout: false,
        },
      ],
    },
  ],
  layout: {
    type: "row",
    children: [
      { type: "tabset", id: "left", weight: 50, children: [] },
      { type: "tabset", id: "right", weight: 50, children: [] },
    ],
  },
};
let initialSnapshot: unknown;
let startupError: unknown;
if (localStorage.getItem("worksplit.demo.restore") === "true") {
  try {
    const saved = localStorage.getItem("worksplit.demo.layout");
    if (saved) initialSnapshot = JSON.parse(saved);
  } catch (error) {
    startupError = error;
  }
}
function buildWorkbench(): WorkbenchInstance<DemoRouter> {
  return createWorkbench({
    createRouter: makeRouter,
    layout,
    tools: [{ id: "inspector", title: "Inspector", render: () => <Inspector /> }],
    workspaceId: "demo",
    ...(initialSnapshot === undefined ? {} : { snapshot: initialSnapshot }),
    commands: [
      {
        id: "tool-context",
        target: "focused",
        execute: ({ id }) => message(`Tool command: ${id}`),
      },
      {
        id: "save",
        target: "document",
        hotkey: "Mod+S",
        ignoreInputs: false,
        execute: ({ id }) => workbench.save(id),
      },
      {
        id: "close",
        target: "document",
        hotkey: "Alt+W",
        execute: async ({ id }) => {
          const result = await workbench.close(id);
          message(`Close: ${result.status}`);
        },
      },
    ],
    onIssue: ({ code, error }) => message(`${code}: ${String(error)}`),
  });
}
let workbench!: WorkbenchInstance<DemoRouter>;
try {
  workbench = buildWorkbench();
} catch (error) {
  startupError = error;
}
function report(result: NavigationResult) {
  message(
    `Navigation: ${result.status}${result.status === "rejected" ? ` (${result.reason})` : ""}`,
  );
}
function open(id: string, target?: string, delay = 0) {
  return workbench
    .open(
      { to: "/documents/$id", params: { id }, search: { view: "edit", delay } },
      target ? { target } : {},
    )
    .then((result) => {
      report(result);
      return result;
    });
}
function Navigation() {
  useWorkbenchState(workbench, (state) => `${state.activeDocumentId}:${state.revision}`);
  const active = workbench.getActiveDocument();
  const docs = workbench.getDocuments();
  return (
    <>
      <div className="brand">
        <span className="brand-mark">W</span>
        <strong>Worksplit</strong>
      </div>
      <span className="eyebrow nav-caption" data-testid="navigation-owner">
        {active?.navigationKey ?? "workspace"}
      </span>
      <button aria-label="A Document A" onClick={() => void open("A", "left")}>
        <span>A</span>
        <span>Document A</span>
      </button>
      <button aria-label="B Document B" onClick={() => void open("B", "right")}>
        <span>B</span>
        <span>Document B</span>
      </button>
      <button aria-label="◷ Slow document" onClick={() => void open("slow", "left", 1200)}>
        <span>◷</span>
        <span>Slow document</span>
      </button>
      <button
        aria-label="↪ Redirect to B"
        onClick={() => void workbench.open({ to: "/alias-b" }).then(report)}
      >
        <span>↪</span>
        <span>Redirect to B</span>
      </button>
      <button aria-label="! Loader error" onClick={() => void open("error")}>
        <span>!</span>
        <span>Loader error</span>
      </button>
      <button
        aria-label="× Renderer error"
        onClick={() => void workbench.open({ to: "/broken" }).then(report)}
      >
        <span>×</span>
        <span>Renderer error</span>
      </button>
      <div className="nav-documents">
        <span className="eyebrow nav-caption">OPEN DOCUMENTS</span>
        {docs.map((doc) => (
          <button
            key={doc.id}
            data-active={doc.id === active?.id}
            onClick={() => workbench.activate(doc.id)}
            title={doc.href}
          >
            <span>▤</span>
            <span>{doc.href.split("?")[0]}</span>
          </button>
        ))}
      </div>
    </>
  );
}
const nativePresentation: NonNullable<import("@worksplit/react").WorkbenchProps["native"]> = {
  onRenderTab(node, values) {
    const doc = workbench.getDocument(node.getId());
    if (doc)
      values.content = (
        <span data-testid={`tab-${doc.id}`}>
          {doc.href.split("?")[0]?.replace("/documents/", "") || "Welcome"}
        </span>
      );
  },
};
function App() {
  const pending = useStore(decisions, (state) => state);
  const notices = useStore(messages, (state) => state);
  const [restore, setRestore] = useState(localStorage.getItem("worksplit.demo.restore") === "true");
  const active = useWorkbenchState(workbench, (state) => state.activeDocumentId);
  useEffect(() => {
    const disconnect = workbench.connectBrowser();
    void workbench
      .start(location.pathname + location.search + location.hash)
      .then(async (result) => {
        report(result);
        if (location.pathname === "/" && initialSnapshot === undefined) {
          await open("A", "left");
          await open("B", "right");
        }
        return result;
      });
    return disconnect;
  }, []);
  const decide = (candidate: Decision, allowed: boolean) => {
    candidate.resolve(allowed);
    decisions.setState((state) => state.filter((item) => item !== candidate));
  };
  return (
    <div className="app">
      <header className="topbar">
        <strong>WORKSPLIT / ROUTE WORKSPACE</strong>
        <span>FlexLayout + TanStack</span>
      </header>
      <div className="toolbar">
        <button
          onClick={() => active && void workbench.dispatch(Actions.setTabPinned(active, true))}
        >
          Pin
        </button>
        <button
          onClick={() =>
            active &&
            void workbench.dispatch(Actions.moveNode(active, "right", DockLocation.CENTER, -1))
          }
        >
          Move right
        </button>
        <button
          onClick={() =>
            active &&
            void workbench.dispatch(
              Actions.moveNode(active, "border_bottom", DockLocation.CENTER, -1),
            )
          }
        >
          Move to Border
        </button>
        <button
          onClick={() =>
            active &&
            void workbench.dispatch(Actions.moveNode(active, "left", DockLocation.CENTER, -1))
          }
        >
          Move to main
        </button>
        <button onClick={() => void workbench.dispatch(Actions.selectTab("inspector"))}>
          Toggle Inspector
        </button>
        <button
          onClick={() =>
            active &&
            void workbench.dispatch(
              Actions.maximizeToggle(workbench.getEditingContext().activeGroupId!),
            )
          }
        >
          Focus group
        </button>
        <button
          onClick={() => {
            localStorage.setItem("worksplit.demo.layout", JSON.stringify(workbench.snapshot()));
            message("Layout saved");
          }}
        >
          Save layout
        </button>
        <label>
          <input
            type="checkbox"
            checked={restore}
            onChange={(event) => {
              setRestore(event.target.checked);
              localStorage.setItem("worksplit.demo.restore", String(event.target.checked));
            }}
          />{" "}
          Restore on refresh
        </label>
      </div>
      <main>
        <Workbench
          workbench={workbench}
          native={nativePresentation}
          navigation={<Navigation />}
          empty={
            <div>
              <h2>Your workspace</h2>
              <p>Open a routed document from the navigation.</p>
            </div>
          }
        />
      </main>
      <footer>
        <span data-testid="active-location">
          {workbench.getActiveDocument()?.href ?? "No active document"}
        </span>
        <output data-testid="last-result">{notices.at(-1)?.text ?? "Ready"}</output>
      </footer>
      {pending.length > 0 && (
        <div role="dialog" aria-label="Unsaved changes" className="decision">
          {pending.map((candidate) => (
            <section key={candidate.requestId} data-decision={candidate.reason}>
              <strong>Unsaved {candidate.id}</strong>
              <p>
                Allow {candidate.reason}? Editing while this decision is pending invalidates
                approval.
              </p>
              <button onClick={() => decide(candidate, true)}>Discard and continue</button>
              <button onClick={() => decide(candidate, false)}>Keep editing</button>
            </section>
          ))}
        </div>
      )}
      <details className="diagnostics">
        <summary>Operation log</summary>
        {notices.map((notice) => (
          <p key={notice.id}>{notice.text}</p>
        ))}
      </details>
    </div>
  );
}
if (startupError) {
  createRoot(document.getElementById("root")!).render(
    <div role="alert">
      <h1>Saved layout is unavailable</h1>
      <pre>{String(startupError)}</pre>
      <button
        onClick={() => {
          localStorage.removeItem("worksplit.demo.layout");
          localStorage.removeItem("worksplit.demo.restore");
          location.reload();
        }}
      >
        Reset saved layout
      </button>
    </div>,
  );
} else createRoot(document.getElementById("root")!).render(<App />);
// Browser acceptance uses this observable demo fixture; all operations are public package calls.
Object.assign(window, {
  worksplitDemo: {
    workbench,
    metrics,
    getMetrics: readMetrics,
    open,
    decisions,
    messages,
    Actions,
    DockLocation,
  },
});
