/* oxlint-disable no-await-in-loop -- Installation, native mutations and acceptance run serially. */
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "getComputedStyle",
  "MutationObserver",
]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: name === "getComputedStyle" ? dom.window[name].bind(dom.window) : dom.window[name],
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
dom.window.ResizeObserver = globalThis.ResizeObserver;
dom.window.HTMLElement.prototype.getBoundingClientRect = () =>
  new dom.window.DOMRect(0, 0, 800, 500);
dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
const { act, createElement, createRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Layout, Model } = await import("flexlayout-react");
const { nativePackages } = await import("./native-dependencies/install.mjs");
const packages = await nativePackages(process.cwd());
for (const value of packages.values()) {
  assert.ok(
    (await realpath(value.directory)).startsWith(join(process.cwd(), "node_modules") + "/"),
    "Native modules must resolve inside the independent install",
  );
}
const css = await readFile(
  fileURLToPath(import.meta.resolve("flexlayout-react/style/dark.css")),
  "utf8",
);
assert.ok(css.includes(".flexlayout__layout"));
const model = () =>
  Model.fromJson({
    layout: {
      type: "row",
      children: [
        { type: "tabset", children: [{ type: "tab", name: "Document", component: "test" }] },
      ],
    },
  });
const first = createRef();
const second = createRef();
const firstModel = model();
const secondModel = model();
const seenModels = new Set();
const factory = (node) => {
  seenModels.add(node.getModel());
  return createElement("p", null, "Document");
};
const root = createRoot(document.getElementById("root"));
try {
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(Layout, { ref: first, model: firstModel, factory }),
        createElement(Layout, { ref: second, model: secondModel, factory }),
      ),
    ),
  );
  assert.equal(
    typeof first.current.endDrag,
    "function",
    "The public native ref must expose endDrag",
  );
  assert.equal(typeof second.current.endDrag, "function");
  const firstRoot = first.current.getRootDiv();
  await act(async () => {
    first.current.addTabWithDragAndDrop(new dom.window.Event("dragstart"), {
      type: "tab",
      name: "New",
      component: "test",
    });
    firstRoot.dispatchEvent(
      new dom.window.MouseEvent("dragenter", { bubbles: true, clientX: 100, clientY: 100 }),
    );
  });
  assert.equal(
    firstRoot.querySelectorAll(".flexlayout__outline_rect").length,
    1,
    "A real native drag must create its outline",
  );
  await act(async () => second.current.endDrag());
  assert.equal(
    firstRoot.querySelectorAll(".flexlayout__outline_rect").length,
    1,
    "Another Layout cannot cancel this drag",
  );
  await act(async () => first.current.endDrag());
  assert.equal(
    firstRoot.querySelectorAll(".flexlayout__outline_rect").length,
    0,
    "The owning Layout clears its native drag overlay",
  );
  await act(async () => first.current.endDrag());
  await act(async () => {
    firstRoot.dispatchEvent(new dom.window.MouseEvent("dragleave", { bubbles: true }));
    first.current.addTabWithDragAndDrop(new dom.window.Event("dragstart"), {
      type: "tab",
      name: "After cancellation",
      component: "test",
    });
    firstRoot.dispatchEvent(
      new dom.window.MouseEvent("dragenter", { bubbles: true, clientX: 100, clientY: 100 }),
    );
  });
  assert.equal(
    firstRoot.querySelectorAll(".flexlayout__outline_rect").length,
    1,
    "A late dragleave after cancellation cannot suppress the next native drag",
  );
  await act(async () => first.current.endDrag());
  for (const value of seenModels) assert.ok(value === firstModel || value === secondModel);
  process.stdout.write(
    JSON.stringify(
      {
        versions: Object.fromEntries(
          [...packages].map(([name, value]) => [name, value.manifest.version]),
        ),
        checks: [
          "single native dependency graph",
          "public CSS",
          "real Layout public endDrag",
          "independent Layout ownership",
          "idempotent drag release",
          "late dragleave followed by a new drag",
        ],
        environment:
          "Node client conditions + JSDOM; browser interaction is a separate acceptance boundary",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
