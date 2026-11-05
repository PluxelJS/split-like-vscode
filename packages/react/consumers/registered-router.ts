import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { createWorkbench, type DocumentInfo, type ToolInfo } from "@worksplit/react";

const root = createRootRoute();
const documents = createRoute({
  getParentRoute: () => root,
  path: "/documents/$id",
  validateSearch: (input: Record<string, unknown>) => ({
    view: input.view === "compact" ? ("compact" as const) : ("full" as const),
    pageSize: typeof input.pageSize === "number" ? input.pageSize : 100,
  }),
  staticData: {
    worksplit: {
      title: "Document",
      documentKey: ({ params, search }) => `${params.id}:${search.view}`,
    },
  },
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

const link = workbench.createLink({
  to: "/documents/$id",
  params: { id: "link" },
  search: { view: "compact", pageSize: 50 },
});
void link.open({ reuse: "navigate" });
// @ts-expect-error Paths still belong to the registered route tree.
void workbench.createLink({ to: "/unregistered" });
void workbench.open({
  to: "/rules",
  search: { onlyUnclassified: false },
  // @ts-expect-error Only the library can associate approval with a native request.
  ignoreBlocker: true,
});
void workbench.open(
  { to: "/rules", search: { onlyUnclassified: true } },
  {
    presentation: "background",
    // @ts-expect-error A background document cannot become the replaceable preview.
    preview: true,
  },
);

const content = workbench.getContent("current");
if (content?.role === "document") {
  const document: DocumentInfo = content;
  const href: string = content.href;
  void [document, href];
} else if (content) {
  const tool: ToolInfo = content;
  void tool;
  // @ts-expect-error Tools have no routed document location.
  void content.href;
}
void workbench.activate("current").then((result) => {
  if (result.status === "applied" && result.value.role === "document") {
    const document: DocumentInfo = result.value;
    const preview: boolean = result.value.preview;
    void [document, preview];
  }
  return undefined;
});
void workbench.open(
  { to: "/rules", search: { onlyUnclassified: true } },
  {
    destination: ({ source, defaultDestination }) => {
      if (source?.role === "document") {
        const document: DocumentInfo = source;
        const navigationKey: string | null = source.navigationKey;
        void [document, navigationKey];
      } else if (source) {
        const tool: ToolInfo = source;
        void tool;
        // @ts-expect-error A tool source cannot have document preview state.
        void source.preview;
      }
      return defaultDestination;
    },
  },
);
