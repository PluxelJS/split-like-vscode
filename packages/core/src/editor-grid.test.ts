import { describe, expect, it } from "vitest";

import {
  createEditorGridLayout,
  moveEditorGridGroup,
  normalizeEditorGridLayout,
  validateEditorGridLayout,
  type EditorGridLayout,
} from "./editor-grid";

describe("editor grid", () => {
  it("creates a backward-compatible horizontal default layout", () => {
    expect(createEditorGridLayout(["left", "right"])).toEqual({
      children: [
        { node: { groupId: "left", type: "group" } },
        { node: { groupId: "right", type: "group" } },
      ],
      id: "root",
      orientation: "horizontal",
      type: "split",
    });
  });

  it("moves groups into mixed horizontal and vertical splits", () => {
    const initial = createEditorGridLayout(["source", "preview", "terminal"]);
    const moved = moveEditorGridGroup(initial, {
      groupId: "terminal",
      position: "bottom",
      targetGroupId: "preview",
    });

    expect(moved).toEqual({
      children: [
        { node: { groupId: "source", type: "group" } },
        {
          node: {
            children: [
              { node: { groupId: "preview", type: "group" } },
              { node: { groupId: "terminal", type: "group" } },
            ],
            id: "split",
            orientation: "vertical",
            type: "split",
          },
        },
      ],
      id: "root",
      orientation: "horizontal",
      type: "split",
    });
  });

  it("inserts beside a direct target without creating redundant same-axis splits", () => {
    const initial = createEditorGridLayout(["a", "b", "c"]);
    const moved = moveEditorGridGroup(initial, {
      groupId: "c",
      position: "left",
      targetGroupId: "a",
    });

    expect(
      moved?.type === "split"
        ? moved.children.map((child) =>
            child.node.type === "group" ? child.node.groupId : child.node.id,
          )
        : [],
    ).toEqual(["c", "a", "b"]);
  });

  it("sanitizes persisted layouts and appends newly declared groups", () => {
    const restored = normalizeEditorGridLayout(
      {
        children: [
          { node: { groupId: "left", type: "group" }, size: 320 },
          { node: { groupId: "missing", type: "group" } },
          { node: { groupId: "left", type: "group" } },
        ],
        id: "root",
        orientation: "horizontal",
        type: "split",
      },
      ["left", "right"],
    );

    expect(restored).toEqual({
      children: [
        { node: { groupId: "left", type: "group" } },
        { node: { groupId: "right", type: "group" } },
      ],
      id: "root",
      orientation: "horizontal",
      type: "split",
    });
  });

  it("rejects ambiguous authored topology", () => {
    const duplicate = {
      children: [
        { node: { groupId: "main", type: "group" } },
        { node: { groupId: "main", type: "group" } },
      ],
      id: "root",
      orientation: "horizontal",
      type: "split",
    } satisfies EditorGridLayout;

    expect(() => validateEditorGridLayout(duplicate, ["main"])).toThrow(
      'references editor group "main" more than once',
    );
  });
});
