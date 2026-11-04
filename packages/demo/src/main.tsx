import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useRouter,
  useRouterState,
  type AnyRouter,
} from "@tanstack/react-router";
import { createWorkbench, Workbench, useWorkbenchState, useContent } from "@worksplit/react";
import { Actions, DockLocation } from "flexlayout-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  BrowserExample,
  createBrowserWorkbench,
  clearBrowserSnapshot,
  type BrowserInstance,
} from "./examples/browser";
import {
  createLifecycleWorkbench,
  LifecycleExample,
  type LifecycleSession,
} from "./examples/browser-regressions";
import { Editor, EditorDocument } from "./examples/editor";
import { createReadOnlyWorkbench, ReadOnlyExample } from "./examples/read-only";
import { SplitViewExample } from "./examples/split-view";
import { createToolsWorkbench, ToolsExample } from "./examples/tools";

import "flexlayout-react/style/light.css";
import "@worksplit/react/style.css";
import "./public-api.css";

const editorRouters = new Map<string, AnyRouter>();
function EditorRoot() {
  const content = useContent();
  const router = useRouter();
  useEffect(() => {
    editorRouters.set(content.id, router);
    return () => {
      editorRouters.delete(content.id);
    };
  }, [content, router]);
  const resource = useRouterState({
    router,
    select: (state) => {
      const match = state.resolvedLocation
        ? router
            .matchRoutes(state.resolvedLocation)
            .find((value) => value.routeId === editorRoute.id)
        : undefined;
      return match ? String(match.params.name) : null;
    },
  });
  return (
    <EditorDocument resource={resource}>
      <Outlet />
    </EditorDocument>
  );
}
const rootRoute = createRootRoute({ component: EditorRoot });
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/edit/$name",
  component: Editor,
});
const routeTree = rootRoute.addChildren([editorRoute]);
const editor = createWorkbench({
  createRouter: (history) => createRouter({ routeTree, history }),
  home: { mode: "empty", href: "/" },
});
const readOnly = createReadOnlyWorkbench();
const tools = createToolsWorkbench();
const root = createRoot(document.getElementById("root")!);
let nextDraft = 2;
let browserInstance: BrowserInstance | undefined;
let lifecycleSession: LifecycleSession | undefined;
function EditorExample() {
  const activeId = useWorkbenchState(editor, (state) => state.activeDocumentId);
  return (
    <section className="example-body">
      <nav aria-label="Editor example" className="example-toolbar">
        <button
          type="button"
          onClick={() => {
            void editor.open({ to: "/edit/$name", params: { name: `Draft ${nextDraft++}` } });
          }}
        >
          New draft
        </button>
        <button
          type="button"
          disabled={!activeId}
          onClick={() => {
            if (activeId) void editor.duplicate(activeId);
          }}
        >
          Duplicate editor
        </button>
        <button
          type="button"
          disabled={!activeId}
          onClick={() => {
            if (activeId) void editor.save(activeId);
          }}
        >
          Save active
        </button>
        <button
          type="button"
          disabled={!activeId}
          onClick={() => {
            if (activeId) void editor.close(activeId);
          }}
        >
          Close active
        </button>
      </nav>
      <Workbench instance={editor} />
    </section>
  );
}
function resetBrowserLocation() {
  const state = window.history.state;
  window.history.replaceState(
    { ...(state && typeof state === "object" ? state : {}), __TSR_index: 0 },
    "",
    "/",
  );
}
async function startBrowserExample(onOutside: (href: string) => void) {
  await browserInstance?.dispose();
  if (lifecycleSession) {
    await lifecycleSession.dispose();
    lifecycleSession = undefined;
    delete window.worksplitPublic.lifecycle;
    resetBrowserLocation();
  }
  const session = createBrowserWorkbench(onOutside);
  browserInstance = session.instance;
  window.worksplitPublic.browser = browserInstance;
  const result = await session.start();
  if (result.status !== "applied") throw new Error(JSON.stringify(result));
  return session.instance;
}
async function startLifecycleExample() {
  await browserInstance?.dispose();
  browserInstance = undefined;
  delete window.worksplitPublic.browser;
  await lifecycleSession?.dispose();
  resetBrowserLocation();
  const session = createLifecycleWorkbench();
  lifecycleSession = session;
  window.worksplitPublic.lifecycle = session;
  const result = await session.start({
    browser: {
      onOutsideNavigate: ({ href }) => {
        session.outside.push(href);
      },
    },
  });
  if (result.status !== "applied") throw new Error(JSON.stringify(result));
  return session;
}
function App() {
  const [example, setExample] = useState("Read-only");
  const [browserStatus, setBrowserStatus] = useState("");
  const [browserReady, setBrowserReady] = useState(false);
  const [browserView, setBrowserView] = useState<BrowserInstance | null>(null);
  const [lifecycleView, setLifecycleView] = useState<LifecycleSession | null>(null);
  const [starting, setStarting] = useState(false);
  async function choose(name: string) {
    if (name === "Browser history" && !browserReady) {
      setStarting(true);
      setLifecycleView(null);
      try {
        const instance = await startBrowserExample((href) => {
          setBrowserReady(false);
          setBrowserStatus(`Host received ${href}`);
          setExample("Read-only");
        });
        setBrowserView(instance);
        setBrowserReady(true);
      } catch (error) {
        setBrowserStatus(String(error));
      } finally {
        setStarting(false);
      }
    } else if (name === "Lifecycles" && !lifecycleView) {
      setStarting(true);
      setBrowserReady(false);
      setBrowserView(null);
      try {
        setLifecycleView(await startLifecycleExample());
      } catch (error) {
        setBrowserStatus(String(error));
      } finally {
        setStarting(false);
      }
    }
    setExample(name);
  }
  return (
    <main>
      <nav aria-label="Examples" className="example-toolbar">
        {["Read-only", "Editor", "Tools", "SplitView", "Browser history", "Lifecycles"].map(
          (name) => (
            <button
              type="button"
              key={name}
              aria-pressed={example === name}
              disabled={starting}
              onClick={() => {
                void choose(name);
              }}
            >
              {name}
            </button>
          ),
        )}
      </nav>
      {example === "Read-only" ? (
        <ReadOnlyExample instance={readOnly} />
      ) : example === "Editor" ? (
        <EditorExample />
      ) : example === "Tools" ? (
        <ToolsExample instance={tools} />
      ) : example === "SplitView" ? (
        <SplitViewExample />
      ) : example === "Lifecycles" && lifecycleView ? (
        <LifecycleExample session={lifecycleView} />
      ) : example === "Browser history" && browserReady && browserView ? (
        <BrowserExample instance={browserView} />
      ) : (
        <section role="status">
          <p>{browserStatus || "Starting browser history…"}</p>
          <button
            type="button"
            onClick={() => {
              clearBrowserSnapshot();
              void choose(example);
            }}
          >
            Reset saved layout and retry
          </button>
        </section>
      )}
    </main>
  );
}
async function dispose() {
  root.unmount();
  const browserResult = await browserInstance?.dispose();
  const lifecycleResult = await lifecycleSession?.dispose();
  const first = await readOnly.dispose();
  const second = await editor.dispose();
  const third = await tools.dispose();
  if (
    [browserResult, lifecycleResult, first, second, third].some(
      (result) => result && result.status !== "applied",
    )
  )
    throw new Error("Example disposal failed");
}
declare global {
  interface Window {
    worksplitPublic: {
      browser?: BrowserInstance;
      lifecycle?: LifecycleSession;
      native: { Actions: typeof Actions; DockLocation: typeof DockLocation };
      readOnly: typeof readOnly;
      editor: typeof editor;
      tools: typeof tools;
      dispose: typeof dispose;
      editorRouters: typeof editorRouters;
    };
  }
}
window.worksplitPublic = {
  readOnly,
  editor,
  tools,
  dispose,
  editorRouters,
  native: { Actions, DockLocation },
};
async function start() {
  const first = await readOnly.start();
  const second = await editor.start({ href: "/edit/Draft" });
  const third = await tools.start();
  for (const result of [first, second, third]) {
    if (result.status !== "applied") throw new Error(`Example startup: ${result.status}`);
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start().catch((error: unknown) => {
  root.render(<p role="alert">{String(error)}</p>);
  throw error;
});
