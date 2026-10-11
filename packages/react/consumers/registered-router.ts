import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { createWorkbench } from "@worksplit/react";

const root = createRootRoute();
const documents = createRoute({
  getParentRoute: () => root,
  path: "/documents/$id",
  validateSearch: (input: Record<string, unknown>) => ({
    view: input.view === "compact" ? ("compact" as const) : ("full" as const),
    pageSize: typeof input.pageSize === "number" ? input.pageSize : 100,
  }),
  staticData: { worksplit: { title: "Document", identitySearch: ["view"] } },
});
const rules = createRoute({
  getParentRoute: () => root,
  path: "/rules",
  validateSearch: (input: Record<string, unknown>) => ({
    onlyUnclassified: input.onlyUnclassified !== false,
  }),
  staticData: { worksplit: { title: "Rules" } },
});
const routeTree = root.addChildren([documents, rules]);
const createRegisteredRouter = (history: RouterHistory) => createRouter({ routeTree, history });

// Compile in its own project: consumers may register a closed, heterogeneous search
// schema without changing the demo's route types or the library's ordinary test project.
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRegisteredRouter>;
  }
}

const workbench = createWorkbench({ createRouter: createRegisteredRouter });
void workbench.open({
  to: "/documents/$id",
  params: { id: "registered" },
  search: { view: "compact", pageSize: 100 },
});
void workbench.open({ to: "/rules", search: { onlyUnclassified: true } });

// Public navigation remains typed after the implementation accepts the registered schema.
void workbench.open({
  to: "/documents/$id",
  params: { id: "registered" },
  // @ts-expect-error Registered search retains its closed view union.
  search: { view: "invalid", pageSize: 100 },
});
