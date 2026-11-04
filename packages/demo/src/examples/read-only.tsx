import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { createWorkbench, useWorkbenchState, Workbench } from "@worksplit/react";
import { useState } from "react";

const rootRoute = createRootRoute({ component: Outlet });
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <section style={{ padding: 20 }}>
      <h1>Read-only workspace</h1>
      <p>Choose a report above to open a document.</p>
    </section>
  ),
  staticData: { worksplit: { title: "Welcome", navigationKey: "reports" } },
});
const reportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/read/$name",
  component: Report,
  staticData: { worksplit: { title: "Report", navigationKey: "reports" } },
});
const routeTree = rootRoute.addChildren([homeRoute, reportRoute]);

export function createReadOnlyRouter(history: RouterHistory) {
  return createRouter({ routeTree, history });
}

function Report() {
  const { name } = reportRoute.useParams();
  return (
    <section style={{ padding: 20, overflow: "auto", height: "100%", boxSizing: "border-box" }}>
      <h1>{name}</h1>
      <p>This document has its own native Router and memory history.</p>
      <Link to="/read/$name" params={{ name: name === "Balance" ? "Results" : "Balance" }}>
        Read the other report in this document
      </Link>
    </section>
  );
}

/** Bootstrap explicitly: await instance.start(); render <ReadOnlyExample instance={instance} />;
 * on application teardown await instance.dispose(). React does not own the workspace lifetime. */
export function createReadOnlyWorkbench() {
  return createWorkbench({
    createRouter: createReadOnlyRouter,
    home: { mode: "empty", href: "/" },
  });
}
export type ReadOnlyInstance = ReturnType<typeof createReadOnlyWorkbench>;

export function ReadOnlyExample({ instance }: { instance: ReadOnlyInstance }) {
  const count = useWorkbenchState(instance, () => instance.getDocuments().length);
  const [outcome, setOutcome] = useState("");
  const link = instance.createLink(
    { to: "/read/$name", params: { name: "Balance" } },
    {
      onResult: (result) => setOutcome(result.status),
    },
  );
  return (
    <section style={{ height: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
      <nav
        aria-label="Reports"
        style={{ padding: 12, display: "flex", alignItems: "center", gap: 12 }}
      >
        <a
          href={link.href}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            void link.open();
          }}
        >
          Balance
        </a>
        <button
          type="button"
          draggable
          aria-label="Drag Balance report"
          onDragStart={link.dragStart}
          onDragEnd={link.dragEnd}
          onClick={() => {
            void link.open();
          }}
        >
          ⠿
        </button>
        <button
          type="button"
          onClick={() => {
            void instance
              .open({ to: "/read/$name", params: { name: "Results" } })
              .then((result) => setOutcome(result.status));
          }}
        >
          Open results
        </button>
        <output aria-live="polite">
          {count} document(s) {outcome}
        </output>
      </nav>
      <Workbench instance={instance} native={{ keyMap: { focusTabToggle: "F6" } }} />
    </section>
  );
}
