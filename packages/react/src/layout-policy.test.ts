import {
  Actions,
  DockLocation,
  Model,
  type IJsonModel,
  type IJsonTabSetNode,
} from "flexlayout-react";
import { describe, expect, it, vi } from "vitest";

import { createLayoutPolicy, getLayoutTopology } from "./layout-policy";

function tabset(id: string, tabs = [id]): IJsonTabSetNode {
  return {
    type: "tabset",
    id,
    children: tabs.map((tab) => ({ type: "tab", id: `tab-${tab}`, name: tab, component: "test" })),
  };
}

function grid(global: IJsonModel["global"] = {}): Model {
  return Model.fromJson({
    global,
    borders: [{ location: "right", children: [{ id: "tool", name: "Tool", component: "tool" }] }],
    layout: {
      type: "row",
      children: [
        { type: "row", children: [tabset("a", ["a", "extra"]), tabset("b")] },
        { type: "row", children: [tabset("c"), tabset("d")] },
      ],
    },
  });
}

const policy = createLayoutPolicy({ maxRows: 2, maxColumns: 2, maxTabsets: 4 });

describe("native layout topology policy", () => {
  it("measures both root orientations and excludes Border tools", () => {
    for (const rootOrientationVertical of [false, true]) {
      const model = grid({ rootOrientationVertical });
      expect(getLayoutTopology(model)).toEqual({ rows: 2, columns: 2, tabsets: 4 });
      expect(policy.allows(model)).toBe(true);
      expect(
        policy.allowsAction(
          model,
          Actions.moveNode("tab-extra", "border_right", DockLocation.CENTER, -1),
        ),
      ).toBe(true);
      expect(
        policy.allowsAction(model, Actions.moveNode("tool", "a", DockLocation.RIGHT, -1)),
      ).toBe(false);
    }
  });

  it("rejects a third column or row independently of the total tabset cap", () => {
    const model = Model.fromJson({
      layout: { children: [tabset("a", ["a", "extra"]), tabset("b")] },
    });
    expect(
      policy.allowsAction(model, Actions.moveNode("tab-extra", "b", DockLocation.RIGHT, -1)),
    ).toBe(false);
    expect(
      policy.allowsAction(model, Actions.moveNode("tab-extra", "b", DockLocation.BOTTOM, -1)),
    ).toBe(true);
    model.doAction(Actions.updateModelAttributes({ rootOrientationVertical: true }));
    expect(getLayoutTopology(model)).toEqual({ rows: 2, columns: 1, tabsets: 2 });
    expect(
      policy.allowsAction(model, Actions.moveNode("tab-extra", "b", DockLocation.BOTTOM, -1)),
    ).toBe(false);
    expect(
      policy.allowsAction(model, Actions.moveNode("tab-extra", "b", DockLocation.RIGHT, -1)),
    ).toBe(true);
  });

  it("allows reordering and merging into existing groups at the limit", () => {
    const model = grid();
    expect(
      policy.allowsAction(model, Actions.moveNode("tab-extra", "a", DockLocation.CENTER, 0)),
    ).toBe(true);
    expect(
      policy.allowsAction(model, Actions.moveNode("tab-extra", "d", DockLocation.CENTER, 0)),
    ).toBe(true);
    expect(policy.allowsAction(model, Actions.moveNode("a", "d", DockLocation.CENTER, -1))).toBe(
      true,
    );
    expect(
      policy.allowsAction(model, Actions.moveNode("tab-extra", "d", DockLocation.BOTTOM, -1)),
    ).toBe(false);
  });

  it("uses native tidy when moving the last tab or whole TabSet", () => {
    const model = grid();
    for (const source of ["tab-b", "b"]) {
      const action = Actions.moveNode(source, "a", DockLocation.TOP, -1);
      expect(policy.allowsAction(model, action)).toBe(true);
      const candidate = Model.fromJson(model.toJson());
      candidate.doAction(action);
      expect(getLayoutTopology(candidate)).toEqual({ rows: 2, columns: 2, tabsets: 4 });
    }
    expect(policy.allowsAction(model, Actions.moveNode("tab-b", "c", DockLocation.TOP, -1))).toBe(
      false,
    );
  });

  it("preserves explicit and inherited empty-TabSet retention", () => {
    for (const global of [{ tabSetEnableDeleteWhenEmpty: false }, { tabSetEnableClose: false }]) {
      const model = grid(global);
      expect(policy.allowsAction(model, Actions.moveNode("tab-b", "a", DockLocation.TOP, -1))).toBe(
        false,
      );
    }
    const model = grid();
    model.doAction(Actions.updateNodeAttributes("b", { enableDeleteWhenEmpty: false }));
    expect(policy.allowsAction(model, Actions.moveNode("tab-b", "a", DockLocation.TOP, -1))).toBe(
      false,
    );
  });

  it("moves collapsed native TabGroups using the group as the source", () => {
    const model = grid();
    model.doAction(Actions.addTabToNewGroup("tab-b", "Group"));
    const group = model.getNodeById("tab-b")!.getParent()!;
    model.doAction(Actions.updateNodeAttributes(group.getId(), { opened: false }));
    expect(
      policy.allowsAction(model, Actions.moveNode(group.getId(), "a", DockLocation.TOP, -1)),
    ).toBe(true);
    expect(
      policy.allowsAction(model, Actions.moveNode(group.getId(), "c", DockLocation.TOP, -1)),
    ).toBe(false);
  });

  it("matches drop previews to exact native Actions without touching live listeners", () => {
    const model = grid();
    const save = vi.fn<() => void>();
    const changed = vi.fn<() => void>();
    model.getNodeById("tab-a")!.setEventListener("save", save);
    model.addChangeListener(changed);
    const before = model.getRootRow()!.toJson();
    expect(
      policy.allowsDrop(model, model.getNodeById("b")!, model.getNodeById("a")!, DockLocation.TOP),
    ).toBe(true);
    expect(
      policy.allowsDrop(
        model,
        model.getNodeById("tab-extra")!,
        model.getNodeById("a")!,
        DockLocation.TOP,
      ),
    ).toBe(false);
    expect(model.getRootRow()!.toJson()).toEqual(before);
    expect(save).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("checks insertion before mutation, including a fifth central tool", () => {
    const model = grid();
    const target = model.getNodeById("a")!.getId();
    const add = (location: DockLocation) =>
      Actions.addTab({ id: "new", name: "New", component: "tool" }, target, location, -1);
    expect(policy.allowsAction(model, add(DockLocation.CENTER))).toBe(true);
    expect(policy.allowsAction(model, add(DockLocation.RIGHT))).toBe(false);
    expect(model.getNodeById("new")).toBeUndefined();
  });

  it("validates restored native Models with configurable limits", () => {
    const model = Model.fromJson({ layout: { children: [tabset("a"), tabset("b"), tabset("c")] } });
    expect(policy.allows(model)).toBe(false);
    expect(createLayoutPolicy({ maxColumns: 3, maxTabsets: 3 }).allows(model)).toBe(true);
    expect(createLayoutPolicy({ maxTabsets: 2 }).allows(model)).toBe(false);
    expect(createLayoutPolicy({}).allows(model)).toBe(true);
  });

  it("counts the native final placeholder and deliberately retained empty groups", () => {
    const model = Model.fromJson({ layout: { children: [] } });
    expect(getLayoutTopology(model)).toEqual({ rows: 1, columns: 1, tabsets: 1 });
    expect(policy.allows(model)).toBe(true);
    const target = model.getFirstTabSet()!.getId();
    const one = createLayoutPolicy({ maxTabsets: 1 });
    for (const location of [DockLocation.CENTER, DockLocation.RIGHT])
      expect(
        one.allowsAction(
          model,
          Actions.addTab({ id: "new", component: "tool" }, target, location, -1),
        ),
      ).toBe(true);
    expect(model.getFirstTabSet()!.getId()).toBe(target);
  });

  it("supports singleton wrappers and refuses multi-step movements with unknowable creation callbacks", () => {
    const model = grid();
    const action = Actions.moveNode("tab-b", "a", DockLocation.TOP, -1);
    expect(policy.allowsAction(model, Actions.group([Actions.group([action])]))).toBe(true);
    expect(
      policy.allowsAction(
        model,
        Actions.group([action, Actions.moveNode("tab-b", "a", DockLocation.CENTER, -1)]),
      ),
    ).toBe(false);
    model.doAction(Actions.addTabToNewGroup("tab-b", "Group"));
    expect(policy.allowsAction(model, Actions.deleteTabset("b"))).toBe(true);
  });

  it.each([0, -1, 1.5, Infinity, NaN])("rejects invalid limits %s", (maxRows) => {
    expect(() => createLayoutPolicy({ maxRows })).toThrow(RangeError);
  });
});
