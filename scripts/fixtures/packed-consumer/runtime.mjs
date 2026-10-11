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
  Workbench,
  SplitView,
  Pane,
  useWorkbenchContentLifecycle,
} from "@worksplit/react";
import { Actions, DockLocation, Model, TabGroupNode, TabNode } from "flexlayout-react";
import { createElement } from "react";

for (const value of [
  Workbench,
  SplitView,
  Pane,
  useWorkbenchContentLifecycle,
  HotkeysProvider,
  useHotkey,
])
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
