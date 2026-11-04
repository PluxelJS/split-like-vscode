import assert from "node:assert/strict";

import { Actions, Model, TabNode } from "flexlayout-react";

const model = Model.fromJson({
  layout: {
    type: "row",
    children: [
      { type: "tabset", id: "left", children: [{ type: "tab", id: "a", component: "test" }] },
      { type: "tabset", id: "right", children: [{ type: "tab", id: "b", component: "test" }] },
    ],
  },
});
const original = model.getNodeById("b");
assert.ok(original instanceof TabNode);
model.doAction(Actions.addTabToNewGroup("b", "Group", "#3366cc"));
model.doAction(Actions.removeTabFromGroup("b"));
if (process.argv.includes("--probe")) {
  process.stdout.write(JSON.stringify({ retained: model.getNodeById("b") === original }) + "\n");
  process.exit(0);
}
assert.ok(
  model.getNodeById("b") === original,
  "singleton group removal must retain the original native tab",
);
assert.equal(model.getNodeById("right").getSelectedNode(), original);
assert.equal(model.getNodeById("right").getChildren()[0], original);
assert.ok(Model.fromJson(model.toJson()).getNodeById("b") instanceof TabNode);
process.stdout.write(
  "Native singleton group removal retains identity, selection, container and serialization\n",
);
