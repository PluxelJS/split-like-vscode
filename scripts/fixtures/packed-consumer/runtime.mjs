/* oxlint-disable no-await-in-loop -- Installation, native mutations and acceptance run serially. */
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.self = dom.window;
globalThis.scrollTo = () => {};
const { createRootRoute, createRoute, createRouter } = await import("@tanstack/react-router");
import * as worksplit from "@worksplit/react";
import { nativePackages } from "@worksplit/react/native-dependencies/install.mjs";
import { Pane, SplitView } from "@worksplit/split-view";
import { Actions, DockLocation, Model, TabGroupNode, TabNode } from "flexlayout-react";

for (const name of [
  "useWorkbenchContent",
  "WorkbenchCommand",
  "SplitView",
  "Pane",
  "createSplitLayout",
])
  assert.equal(name in worksplit, false, name + " is removed from the Workbench entry");
for (const value of [
  worksplit.Workbench,
  worksplit.useContent,
  worksplit.useContentController,
  SplitView,
  Pane,
])
  assert.ok(value);
await nativePackages(process.cwd());
for (const name of ["react", "split-view"]) {
  const specifier = "@worksplit/" + name;
  const path = fileURLToPath(import.meta.resolve(specifier));
  assert.ok((await realpath(path)).startsWith(join(process.cwd(), "node_modules") + "/"));
  const manifest = JSON.parse(
    await readFile(fileURLToPath(import.meta.resolve(specifier + "/package.json")), "utf8"),
  );
  assert.equal(manifest.exports["."], "./dist/index.js");
  assert.equal(manifest.dependencies?.["@worksplit/core"], undefined);
  assert.equal(manifest.peerDependencies?.["@tanstack/react-hotkeys"], undefined);
  if (name === "split-view")
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    }))
      assert.ok(["react", "react-dom"].includes(dependency));
  const css = await readFile(fileURLToPath(import.meta.resolve(specifier + "/style.css")), "utf8");
  assert.ok(!css.includes("@import"));
  assert.equal(css.includes(".worksplit-sash"), name === "split-view");
  assert.equal(css.includes(".worksplit-workbench"), name === "react");
}
const root = createRootRoute();
const report = createRoute({
  getParentRoute: () => root,
  path: "/read/$name",
  staticData: { worksplit: { title: "Report" } },
});
const routeTree = root.addChildren([report]);
const instance = worksplit.createWorkbench({
  workspaceId: "packed-runtime",
  createRouter: (history) => createRouter({ history, routeTree, isServer: false }),
  home: { mode: "empty", href: "/" },
});
assert.ok(instance.model instanceof Model);
assert.equal(
  (await instance.open({ to: "/read/$name", params: { name: "Before start" } })).status,
  "denied",
);
assert.equal((await instance.start()).status, "applied");
const first = await instance.open({ to: "/read/$name", params: { name: "A" } });
const second = await instance.open({ to: "/read/$name", params: { name: "B" } });
assert.equal(first.status, "applied");
assert.equal(second.status, "applied");
const a = first.value.document,
  b = second.value.document;
assert.ok(a.node instanceof TabNode);
assert.equal(instance.model.getNodeById(a.id), a.node);
assert.equal(
  (await instance.dispatch(Actions.addTabToNewGroup(a.id, "Published group", "#3366cc"))).status,
  "applied",
);
const group = a.node.getParent();
assert.ok(group instanceof TabGroupNode);
assert.equal(
  (await instance.dispatch(Actions.moveNode(b.id, group.getId(), DockLocation.CENTER, -1))).status,
  "applied",
);
assert.equal((await instance.close(b.id)).status, "applied");
assert.equal(instance.model.getNodeById(a.id), a.node);
assert.equal(
  instance.model.getNodeById(group.getId()),
  group,
  "The shipped singleton group patch is active",
);
const snapshot = instance.createSnapshot();
assert.equal(snapshot.version, 2);
assert.equal((await instance.dispose()).status, "applied");
const restored = worksplit.createWorkbench({
  workspaceId: "packed-runtime",
  createRouter: (history) => createRouter({ history, routeTree, isServer: false }),
  initial: { snapshot },
  home: { mode: "empty", href: "/" },
});
assert.equal((await restored.start()).status, "applied");
assert.equal(restored.getDocuments().length, 1);
assert.equal(restored.getDocuments()[0].href, "/read/A");
assert.equal((await restored.dispose()).status, "applied");
process.stdout.write(
  "Published entries, unique native classes, CSS isolation, explicit start, real Model, group patch, snapshot restore and disposal passed\n",
);

dom.window.close();
