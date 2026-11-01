import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { createRootRouteWithContext, createRoute, createRouter } from "@tanstack/react-router";
import { createStore } from "@tanstack/react-store";
import { createSplitLayout, resizeAtSash } from "@worksplit/core";
import {
  createWorkbench,
  createLayoutPolicy,
  Workbench,
  SplitView,
  Pane,
  useWorkbenchContent,
} from "@worksplit/react";
import * as worksplit from "@worksplit/react";
import { Actions, DockLocation, Model, TabGroupNode, TabNode } from "flexlayout-react";
import { createElement } from "react";

assert.equal("useWorkbenchContentLifecycle" in worksplit, false);

for (const value of [Workbench, SplitView, Pane, useWorkbenchContent, HotkeysProvider, useHotkey])
  assert.ok(value);
for (const name of ["core", "react"]) {
  const specifier = "@worksplit/" + name;
  const entry = fileURLToPath(import.meta.resolve(specifier));
  assert.ok(realpathSync(entry).startsWith(join(process.cwd(), "node_modules") + "/"));
  const manifest = JSON.parse(
    readFileSync(new URL(import.meta.resolve(specifier + "/package.json")), "utf8"),
  );
  assert.equal(manifest.exports["."], "./dist/index.js");
  if (name === "react") {
    for (const peer of ["@tanstack/react-store", "@tanstack/react-hotkeys"]) {
      assert.equal(typeof manifest.peerDependencies?.[peer], "string", peer + " must be a peer");
      assert.equal(manifest.dependencies?.[peer], undefined, peer + " must be supplied by the app");
    }
  }
  for (const target of ["index.js", "index.d.ts"]) {
    const file = join(process.cwd(), "node_modules", specifier, "dist", target);
    const source = readFileSync(file, "utf8");
    const referenced = source.match(/[#@] sourceMappingURL=([^\r\n]+)/)?.[1];
    assert.ok(referenced, target + " must reference the enabled source map");
    const mapFile = fileURLToPath(new URL(referenced, pathToFileURL(file)));
    assert.ok(existsSync(mapFile), "Missing public source map: " + mapFile);
    assert.equal(JSON.parse(readFileSync(mapFile, "utf8")).version, 3);
  }
}
const preferences = createStore({ enabled: true });
preferences.setState((state) => ({ ...state, enabled: false }));
assert.equal(preferences.get().enabled, false);
const cssPath = fileURLToPath(import.meta.resolve("@worksplit/react/style.css"));
assert.ok(cssPath.endsWith("/dist/style.css"));
const css = readFileSync(cssPath, "utf8");
assert.ok(css.includes(".worksplit-workbench") && css.includes(".worksplit-sash"));
assert.ok(!css.includes("@import"));
assert.ok(
  readFileSync(new URL(import.meta.resolve("flexlayout-react/style/dark.css")), "utf8").includes(
    ".flexlayout__layout",
  ),
);

const services = { loads: 0 };
const routerRoot = createRootRouteWithContext()();
const route = createRoute({
  getParentRoute: () => routerRoot,
  path: "/documents/$id",
  loader: ({ context, params }) => {
    ++context.services.loads;
    return params.id;
  },
  staticData: { worksplit: { title: "External document", navigationKey: "documents" } },
});
const routeTree = routerRoot.addChildren([route]);
let routers = 0;
const workbench = createWorkbench({
  tools: [{ id: "external-tool", render: ({ id }) => createElement("output", {}, id) }],
  createRouter: (history) => {
    ++routers;
    return createRouter({
      routeTree,
      history,
      context: { services },
      defaultPendingMinMs: 0,
      defaultStaleTime: Infinity,
    });
  },
});
try {
  const first = await workbench.open({ to: "/documents/$id", params: { id: "A" } });
  assert.equal(first.status, "committed", JSON.stringify(first));
  const second = await workbench.open({ to: "/documents/$id", params: { id: "B" } });
  assert.equal(second.status, "committed", JSON.stringify(second));
  assert.equal(workbench.getDocuments().length, 2);
  assert.equal(routers, 3);
  assert.equal(services.loads, 2);
  const a = first.document.id,
    b = second.document.id;
  assert.deepEqual(
    await workbench.dispatch(Actions.addTabToNewGroup(a, "External group", "#3366cc")),
    { status: "applied" },
  );
  let native = Model.fromJson(workbench.getLayout());
  const group = native.getNodeById(a).getParent();
  assert.ok(group instanceof TabGroupNode);
  assert.deepEqual(
    await workbench.dispatch(Actions.moveNode(b, group.getId(), DockLocation.CENTER, -1)),
    { status: "applied" },
  );
  native = Model.fromJson(workbench.getLayout());
  assert.equal(native.getNodeById(b).getParent().getId(), group.getId());
  const activeBeforeTool = workbench.getActiveDocument().id;
  const target = group.getParent().getId();
  assert.deepEqual(
    await workbench.dispatch(
      Actions.addTab(
        {
          type: "tab",
          id: "external-tool",
          name: "Native tool title",
          component: "worksplit.tool",
          config: { app: "external" },
        },
        target,
        DockLocation.CENTER,
        -1,
      ),
    ),
    { status: "applied" },
  );
  const tool = Model.fromJson(workbench.getLayout()).getNodeById("external-tool");
  assert.ok(tool instanceof TabNode);
  assert.equal(tool.getName(), "Native tool title");
  assert.deepEqual(tool.getConfig(), { app: "external" });
  assert.equal(workbench.getActiveDocument().id, activeBeforeTool);
  assert.equal(workbench.getDocument("external-tool"), null);
  assert.equal(routers, 3);
  assert.equal(services.loads, 2);
  const beforeRejected = workbench.getLayout();
  assert.deepEqual(
    await workbench.dispatch(
      Actions.addTab(
        {
          type: "tab",
          id: "unregistered",
          component: "worksplit.tool",
        },
        target,
        DockLocation.CENTER,
        -1,
      ),
    ),
    { status: "rejected" },
  );
  assert.deepEqual(workbench.getLayout(), beforeRejected);
  assert.deepEqual(
    await workbench.dispatch(Actions.updateModelAttributes({ tabEnableFloat: true })),
    { status: "rejected" },
  );
  assert.equal(workbench.snapshot().version, 1);
  const toolClose = await workbench.dispatch(Actions.deleteTab("external-tool"));
  assert.equal(toolClose.status, "closed");
  assert.deepEqual(toolClose.cleanupErrors, []);
  const closed = await workbench.close(a);
  assert.equal(closed.status, "closed");
  assert.deepEqual(closed.cleanupErrors, []);
  assert.equal(workbench.getDocument(a), null);
  assert.equal(workbench.getDocument(b).id, b);
} finally {
  assert.deepEqual(await workbench.dispose(), []);
}
const previewWorkbench = createWorkbench({
  workspaceId: "packed-preview",
  layoutPolicy: createLayoutPolicy({ maxRows: 2, maxColumns: 2, maxTabsets: 4 }),
  createRouter: (history) => createRouter({ routeTree, history, context: { services } }),
});
try {
  const first = await previewWorkbench.open(
    { to: "/documents/$id", params: { id: "Preview-one" }, search: { view: "custom" } },
    { preview: true },
  );
  assert.equal(first.status, "committed");
  assert.equal(first.document.preview, true);
  const preserved = await previewWorkbench.open(
    { to: "/documents/$id", params: { id: "Preview-one" }, search: { view: "reset" } },
    { reuse: "preserve" },
  );
  assert.equal(preserved.status, "committed");
  assert.equal(preserved.document.href, first.document.href);
  assert.equal(preserved.document.id, first.document.id);
  const second = await previewWorkbench.open(
    { to: "/documents/$id", params: { id: "Preview-two" } },
    { preview: true },
  );
  assert.equal(second.status, "committed");
  assert.equal(second.document.preview, true);
  assert.notEqual(second.document.id, first.document.id);
  assert.equal(previewWorkbench.getDocument(first.document.id), null);
  await previewWorkbench.dispatch(
    Actions.updateNodeAttributes(second.document.id, { enableClose: false }),
  );
  const third = await previewWorkbench.open(
    { to: "/documents/$id", params: { id: "Preview-three" } },
    { preview: true },
  );
  assert.equal(third.status, "committed");
  assert.equal(previewWorkbench.getDocument(second.document.id).preview, false);
  assert.equal(third.document.preview, true);
  const restored = createWorkbench({
    workspaceId: "packed-preview",
    snapshot: previewWorkbench.snapshot(),
    layoutPolicy: createLayoutPolicy({ maxRows: 2, maxColumns: 2, maxTabsets: 4 }),
    createRouter: (history) => createRouter({ routeTree, history, context: { services } }),
  });
  try {
    assert.equal(restored.getDocument(third.document.id).preview, true);
    restored.keep(third.document.id);
    assert.equal(restored.getDocument(third.document.id).preview, false);
    assert.notEqual(
      Model.fromJson(restored.getLayout()).getNodeById(third.document.id).isPinned(),
      true,
    );
  } finally {
    assert.deepEqual(await restored.dispose(), []);
  }
} finally {
  assert.deepEqual(await previewWorkbench.dispose(), []);
}
const sized = resizeAtSash(
  createSplitLayout({ panes: [{ id: "left" }, { id: "right" }], containerSize: 600 }),
  0,
  20,
);
assert.equal(
  sized.sizes.reduce((total, value) => total + value, 0),
  600,
);
process.stdout.write(
  "Packed JS, Store/Hotkeys peers, native tool admission, routes, close cleanup, CSS and maps passed\n",
);
