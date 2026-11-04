import assert from "node:assert/strict";

import { Actions, Model, TabNode } from "flexlayout-react";

const model = Model.fromJson({
  global: { tabEnableClose: false, tabEnableDrag: false, tabSetEnableTabGroups: true },
  layout: {
    type: "row",
    children: [{ type: "tabset", children: [{ type: "tab", id: "actual", component: "tool" }] }],
  },
});
const tab = model.getNodeById("actual");
assert.ok(tab instanceof TabNode);
let saves = 0,
  changes = 0;
tab.setEventListener("save", () => {
  ++saves;
});
model.addChangeListener(() => {
  ++changes;
});
if (process.argv.includes("--baseline")) {
  assert.equal(typeof model.getGlobalAttributes, "undefined");
  model.toJson();
  assert.equal(saves, 1, "Ordinary serialization is observably not a pure global query");
  const detached = Model.fromJson({
    layout: {
      type: "row",
      children: [
        { type: "tabset", children: [{ type: "tab", id: "candidate", component: "tool" }] },
      ],
    },
  }).getNodeById("candidate");
  assert.equal(tab.isEnableClose(), false);
  assert.equal(
    detached.isEnableClose(),
    true,
    "A candidate built without native globals presents different facts to allowDrop",
  );
  process.stdout.write(
    "Unpatched global query counterexample reproduced: no public accessor, toJson fires save, detached defaults diverge\n",
  );
} else {
  const global = model.getGlobalAttributes();
  assert.equal(global.tabEnableClose, false);
  assert.equal(global.tabEnableDrag, false);
  assert.equal(saves, 0);
  assert.equal(changes, 0);
  global.tabEnableClose = true;
  assert.equal(
    model.getGlobalAttributes().tabEnableClose,
    false,
    "Query output must not mutate the native model",
  );
  const detached = Model.fromJson({
    global: model.getGlobalAttributes(),
    layout: {
      type: "row",
      children: [
        { type: "tabset", children: [{ type: "tab", id: "candidate", component: "tool" }] },
      ],
    },
  }).getNodeById("candidate");
  assert.equal(detached.isEnableClose(), tab.isEnableClose());
  assert.equal(detached.isEnableDrag(), tab.isEnableDrag());
  model.doAction(Actions.updateModelAttributes({ tabEnableClose: true }));
  assert.equal(model.getGlobalAttributes().tabEnableClose, true);
  assert.equal(tab.isEnableClose(), true);
  assert.equal(saves, 0);
  assert.equal(changes, 1, "The actual native update is the only observed change");
  process.stdout.write(
    "Detached public global attributes preserve candidate native facts without save events or observer changes\n",
  );
}
