import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useRouter,
  useRouterState,
  type AnyRouter,
} from "@tanstack/react-router";
import {
  Workbench,
  createWorkbench,
  useContent,
  useContentController,
  useWorkbenchState,
  type StartOptions,
} from "@worksplit/react";
import { useEffect, useRef, useState } from "react";

import { Editor, EditorDocument } from "./editor";

/** A real routed editor used by the demo and the installed-package browser checks. */
export function createLifecycleWorkbench() {
  const routers = new Map<string, AnyRouter>();
  const activeResources = new Map<string, AbortSignal>();
  const releasedResources: string[] = [];
  const loads: { key: string; signal: AbortSignal }[] = [];
  const gates = new Map<string, { promise: Promise<void>; finish(): void }>();
  const issues: unknown[] = [];
  const outside: string[] = [];
  function gate(key: string) {
    let value = gates.get(key);
    if (!value) {
      let finish!: () => void;
      const promise = new Promise<void>((resolve) => {
        finish = resolve;
      });
      value = { promise, finish };
      gates.set(key, value);
    }
    return value;
  }
  function Root() {
    const content = useContent();
    const router = useRouter();
    const accepted = useRouterState({ router, select: (state) => state.resolvedLocation });
    const resource = accepted
      ? router
          .matchRoutes(accepted)
          .find((match) => match.routeId === documentRoute.id || match.routeId === renderFailure.id)
          ?.params.name
      : undefined;
    useEffect(() => {
      routers.set(content.id, router);
      const stop = content.runEffect(({ signal, defer }) => {
        activeResources.set(content.id, signal);
        defer(() => {
          activeResources.delete(content.id);
          releasedResources.push(content.id);
        });
      });
      return () => {
        routers.delete(content.id);
        stop();
      };
    }, [content, router]);
    return (
      <EditorDocument resource={typeof resource === "string" ? resource : null}>
        <Outlet />
      </EditorDocument>
    );
  }
  function Document() {
    const { name } = documentRoute.useParams();
    return (
      <section
        className="lifecycle-document"
        data-resource={name}
        style={{ height: "100%", overflow: "auto" }}
      >
        <nav aria-label={`Routes for ${name}`}>
          <Link to="/lab/$name" params={{ name }} search={{ delay: `slow-${name}` }}>
            Slow {name}
          </Link>{" "}
          <Link to="/lab/$name" params={{ name }} search={{ fail: true }}>
            Fail loader {name}
          </Link>{" "}
          <Link to="/render-error/$name" params={{ name }}>
            Fail render {name}
          </Link>
        </nav>
        <Editor />
        <div aria-label={`Long content ${name}`} style={{ minHeight: 1200, padding: 16 }}>
          Scrollable resource {name}
        </div>
      </section>
    );
  }
  function Inspector() {
    const content = useContent();
    const input = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState("");
    useContentController({ leave: null, focus: () => input.current?.focus() });
    useEffect(
      () =>
        content.runEffect(({ signal, defer }) => {
          activeResources.set(content.id, signal);
          defer(() => {
            activeResources.delete(content.id);
            releasedResources.push(content.id);
          });
        }),
      [content],
    );
    return (
      <label>
        Lifecycle tool
        <input
          ref={input}
          aria-label="Lifecycle tool"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
      </label>
    );
  }
  const root = createRootRoute({ component: Root });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Open an editor to exercise its content lifetime.</p>,
  });
  const documentRoute = createRoute({
    getParentRoute: () => root,
    path: "/lab/$name",
    validateSearch: (search: Record<string, unknown>) => ({
      ...(typeof search.delay === "string" ? { delay: search.delay } : {}),
      ...(search.fail === true ? { fail: true } : {}),
      ...(typeof search.view === "string" ? { view: search.view } : {}),
    }),
    loaderDeps: ({ search }) => search,
    loader: async ({ deps, abortController }) => {
      if (deps.delay) {
        loads.push({ key: deps.delay, signal: abortController.signal });
        await gate(deps.delay).promise;
      }
      if (deps.fail) throw new Error("Requested loader failure");
      return "loaded";
    },
    component: Document,
    staticData: {
      worksplit: { title: "Lifecycle editor", documentKey: ({ params }) => String(params.name) },
    },
  });
  const alias = createRoute({
    getParentRoute: () => root,
    path: "/alias/$name",
    beforeLoad: ({ params }) => {
      throw redirect({ to: "/lab/$name", params: { name: params.name } });
    },
  });
  const renderFailure = createRoute({
    getParentRoute: () => root,
    path: "/render-error/$name",
    component: () => {
      throw new Error("Requested renderer failure");
    },
  });
  const routeTree = root.addChildren([home, documentRoute, alias, renderFailure]);
  const instance = createWorkbench({
    createRouter: (history) =>
      createRouter({
        routeTree,
        history,
        defaultPendingMs: 0,
        defaultPendingMinMs: 0,
        defaultPendingComponent: () => <p role="status">Lifecycle route pending</p>,
        defaultErrorComponent: ({ error }) => <p role="alert">Lifecycle error: {String(error)}</p>,
      }),
    workspaceId: "lifecycle-example",
    home: { mode: "empty", href: "/" },
    initial: {
      layout: {
        global: { tabSetEnableCloseButton: true },
        borders: [
          {
            type: "border",
            location: "right",
            selected: 0,
            size: 240,
            children: [
              { type: "tab", id: "lifecycle-tool", component: "inspector", name: "Lifecycle tool" },
            ],
          },
        ],
        layout: { type: "row", children: [{ type: "tabset", id: "lifecycle-main", children: [] }] },
      },
    },
    tools: { inspector: { render: () => <Inspector /> } },
    onIssue: (issue) => {
      issues.push(issue);
    },
  });
  return {
    instance,
    routers,
    activeResources,
    releasedResources,
    loads,
    issues,
    outside,
    release(key: string) {
      gate(key).finish();
    },
    start(options: StartOptions = {}) {
      return instance.start(options);
    },
    async dispose() {
      for (const value of gates.values()) value.finish();
      return instance.dispose();
    },
  };
}
export type LifecycleSession = ReturnType<typeof createLifecycleWorkbench>;
export function LifecycleExample({ session }: { session: LifecycleSession }) {
  const active = useWorkbenchState(session.instance, (state) => state.activeDocumentId);
  return (
    <section className="example-body">
      <nav className="example-toolbar" aria-label="Lifecycle example">
        {["A", "B", "C"].map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              void session.instance.open({ to: "/lab/$name", params: { name } });
            }}
          >
            Open lifecycle {name}
          </button>
        ))}
        <button
          type="button"
          disabled={!active}
          onClick={() => {
            if (active) void session.instance.save(active);
          }}
        >
          Save lifecycle
        </button>
        <button
          type="button"
          disabled={!active}
          onClick={() => {
            if (active) void session.instance.close(active);
          }}
        >
          Close lifecycle
        </button>
        <button
          type="button"
          onClick={() => {
            void session.instance.close(session.instance.getDocuments().map((doc) => doc.id));
          }}
        >
          Close lifecycle documents
        </button>
        <button
          type="button"
          onClick={() => {
            for (const load of session.loads) session.release(load.key);
          }}
        >
          Finish pending loaders
        </button>
      </nav>
      <Workbench
        instance={session.instance}
        native={{ keyMap: { focusTabToggle: "F6", focusNextTabset: "Ctrl+Alt+ArrowRight" } }}
      />
    </section>
  );
}
