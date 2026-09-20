import { describe, expect, it } from "vitest";

import {
  createEditorArrangement,
  moveEditorTab,
  normalizeEditorArrangement,
  validateEditorArrangement,
  type EditorArrangement,
  type EditorGridDirection,
  type EditorGridLayout,
} from "./index";

function createTwoGroupArrangement(): EditorArrangement {
  return createEditorArrangement({
    groups: [
      { activeTabId: "b", id: "left", tabIds: ["a", "b", "c"] },
      { activeTabId: "d", id: "right", tabIds: ["d", "e"] },
    ],
  });
}

describe("editor arrangement", () => {
  it("creates a complete arrangement and selects omitted active tabs", () => {
    expect(
      createEditorArrangement({
        groups: [
          { id: "left", tabIds: ["a", "b"] },
          { activeTabId: "c", id: "right", tabIds: ["c"] },
        ],
        maximizedGroupId: "right",
      }),
    ).toEqual({
      groups: [
        { activeTabId: "a", id: "left", tabIds: ["a", "b"] },
        { activeTabId: "c", id: "right", tabIds: ["c"] },
      ],
      layout: {
        children: [
          { node: { groupId: "left", type: "group" } },
          { node: { groupId: "right", type: "group" } },
        ],
        id: "root",
        orientation: "horizontal",
        type: "split",
      },
      maximizedGroupId: "right",
    });
  });

  it("requires tab ids to be globally unique", () => {
    expect(() =>
      createEditorArrangement({
        groups: [
          { id: "left", tabIds: ["same"] },
          { id: "right", tabIds: ["same"] },
        ],
      }),
    ).toThrow('Duplicate editor tab id "same"');
  });

  it("rejects empty groups, invalid active tabs, and invalid maximized groups", () => {
    expect(() => createEditorArrangement({ groups: [{ id: "left", tabIds: [] }] })).toThrow(
      'group "left" must contain a tab',
    );
    expect(() =>
      createEditorArrangement({
        groups: [{ activeTabId: "missing", id: "left", tabIds: ["a"] }],
      }),
    ).toThrow('group "left" has an invalid active tab');
    expect(() =>
      createEditorArrangement({
        groups: [{ id: "left", tabIds: ["a"] }],
        maximizedGroupId: "missing",
      }),
    ).toThrow('Maximized editor group "missing" does not exist');
  });

  it("normalizes untrusted groups, tabs, active state, and topology", () => {
    const normalized = normalizeEditorArrangement(
      {
        groups: [
          {
            activeTabId: "missing",
            id: "left",
            tabIds: ["a", "unknown", "a"],
          },
          { activeTabId: "b", id: "right", tabIds: ["b"] },
          { activeTabId: "c", id: "right", tabIds: ["c"] },
          { id: "empty", tabIds: ["unknown"] },
        ],
        layout: {
          children: [
            { node: { groupId: "right", type: "group" } },
            { node: { groupId: "empty", type: "group" } },
          ],
          id: "root",
          orientation: "horizontal",
          type: "split",
        },
        maximizedGroupId: "empty",
      },
      ["a", "b", "c"],
    );

    expect(normalized).toEqual({
      groups: [
        { activeTabId: "a", id: "left", tabIds: ["a", "c"] },
        { activeTabId: "b", id: "right", tabIds: ["b"] },
      ],
      layout: {
        children: [
          { node: { groupId: "right", type: "group" } },
          { node: { groupId: "left", type: "group" } },
        ],
        id: "root",
        orientation: "horizontal",
        type: "split",
      },
      maximizedGroupId: undefined,
    });
    expect(() => validateEditorArrangement(normalized)).not.toThrow();
  });

  it("creates a default group for available tabs when no snapshot group survives", () => {
    expect(normalizeEditorArrangement({}, ["a", "b"], "workspace")).toEqual({
      groups: [{ activeTabId: "a", id: "workspace", tabIds: ["a", "b"] }],
      layout: { groupId: "workspace", type: "group" },
      maximizedGroupId: undefined,
    });
    expect(normalizeEditorArrangement({}, [])).toEqual({
      groups: [],
      layout: undefined,
      maximizedGroupId: undefined,
    });
  });

  it("reorders a tab within one group using its final insertion index", () => {
    const arrangement = createTwoGroupArrangement();
    const moved = moveEditorTab(arrangement, {
      sourceGroupId: "left",
      tabId: "a",
      target: { groupId: "left", index: 2, kind: "tab-strip" },
    });

    expect(moved.groups[0]).toEqual({
      activeTabId: "b",
      id: "left",
      tabIds: ["b", "c", "a"],
    });
    expect(moved.layout).toBe(arrangement.layout);
  });

  it("moves a tab across groups and activates it in the target", () => {
    const arrangement = createTwoGroupArrangement();
    const moved = moveEditorTab(arrangement, {
      sourceGroupId: "left",
      tabId: "a",
      target: { groupId: "right", index: 1, kind: "tab-strip" },
    });

    expect(moved.groups).toEqual([
      { activeTabId: "b", id: "left", tabIds: ["b", "c"] },
      { activeTabId: "a", id: "right", tabIds: ["d", "a", "e"] },
    ]);
  });

  it("chooses the next tab, then the previous tab, when moving the active tab", () => {
    const arrangement = createTwoGroupArrangement();
    const middleMoved = moveEditorTab(arrangement, {
      sourceGroupId: "left",
      tabId: "b",
      target: { groupId: "right", index: 0, kind: "tab-strip" },
    });
    expect(middleMoved.groups[0]?.activeTabId).toBe("c");

    const lastActive = createEditorArrangement({
      groups: [
        { activeTabId: "c", id: "left", tabIds: ["a", "c"] },
        { id: "right", tabIds: ["d"] },
      ],
    });
    const lastMoved = moveEditorTab(lastActive, {
      sourceGroupId: "left",
      tabId: "c",
      target: { groupId: "right", index: 1, kind: "tab-strip" },
    });
    expect(lastMoved.groups[0]?.activeTabId).toBe("a");
  });

  it("removes an emptied group and collapses its parent split", () => {
    const arrangement = createEditorArrangement({
      groups: [
        { id: "left", tabIds: ["a"] },
        { id: "top", tabIds: ["b"] },
        { id: "bottom", tabIds: ["c"] },
      ],
      layout: {
        children: [
          { node: { groupId: "left", type: "group" } },
          {
            node: {
              children: [
                { node: { groupId: "top", type: "group" } },
                { node: { groupId: "bottom", type: "group" } },
              ],
              id: "stack",
              orientation: "vertical",
              type: "split",
            },
          },
        ],
        id: "root",
        orientation: "horizontal",
        type: "split",
      },
      maximizedGroupId: "bottom",
    });
    const moved = moveEditorTab(arrangement, {
      sourceGroupId: "bottom",
      tabId: "c",
      target: { groupId: "left", index: 1, kind: "tab-strip" },
    });

    expect(moved.groups.map((group) => group.id)).toEqual(["left", "top"]);
    expect(moved.layout).toEqual({
      children: [
        { node: { groupId: "left", type: "group" } },
        { node: { groupId: "top", type: "group" } },
      ],
      id: "root",
      orientation: "horizontal",
      type: "split",
    });
    expect(moved.maximizedGroupId).toBeUndefined();
  });

  for (const position of ["left", "right", "top", "bottom"] as const) {
    it(`splits ${position} and moves the tab into a new active group`, () => {
      const arrangement = createTwoGroupArrangement();
      const moved = moveEditorTab(arrangement, {
        sourceGroupId: "left",
        tabId: "a",
        target: {
          kind: "split",
          newGroupId: `split-${position}`,
          position,
          targetGroupId: "right",
        },
      });

      expect(moved.groups.at(-1)).toEqual({
        activeTabId: "a",
        id: `split-${position}`,
        tabIds: ["a"],
      });
      const expectedOrientation =
        position === "left" || position === "right" ? "horizontal" : "vertical";
      expect(findCommonParentOrientation(moved.layout, "right", `split-${position}`)).toBe(
        expectedOrientation,
      );
      expect(() => validateEditorArrangement(moved)).not.toThrow();
    });
  }

  it("can split a tab from its own non-empty group", () => {
    const arrangement = createTwoGroupArrangement();
    const moved = moveEditorTab(arrangement, {
      sourceGroupId: "left",
      tabId: "a",
      target: {
        kind: "split",
        newGroupId: "new-left",
        position: "left",
        targetGroupId: "left",
      },
    });

    expect(moved.groups[0]).toEqual({ activeTabId: "b", id: "left", tabIds: ["b", "c"] });
    expect(moved.layout?.type === "split" ? moved.layout.children[0]?.node : undefined).toEqual({
      groupId: "new-left",
      type: "group",
    });
  });

  it("returns the same arrangement for invalid and already-satisfied moves", () => {
    const arrangement = createTwoGroupArrangement();
    const invalidMoves = [
      {
        sourceGroupId: "missing",
        tabId: "a",
        target: { groupId: "right", index: 0, kind: "tab-strip" as const },
      },
      {
        sourceGroupId: "left",
        tabId: "missing",
        target: { groupId: "right", index: 0, kind: "tab-strip" as const },
      },
      {
        sourceGroupId: "left",
        tabId: "a",
        target: { groupId: "missing", index: 0, kind: "tab-strip" as const },
      },
      {
        sourceGroupId: "left",
        tabId: "a",
        target: { groupId: "left", index: 0, kind: "tab-strip" as const },
      },
      {
        sourceGroupId: "left",
        tabId: "a",
        target: { groupId: "right", index: 99, kind: "tab-strip" as const },
      },
      {
        sourceGroupId: "left",
        tabId: "a",
        target: {
          kind: "split" as const,
          newGroupId: "right",
          position: "left" as EditorGridDirection,
          targetGroupId: "right",
        },
      },
    ];
    for (const options of invalidMoves) {
      expect(moveEditorTab(arrangement, options)).toBe(arrangement);
    }

    const single = createEditorArrangement({ groups: [{ id: "main", tabIds: ["only"] }] });
    expect(
      moveEditorTab(single, {
        sourceGroupId: "main",
        tabId: "only",
        target: {
          kind: "split",
          newGroupId: "new",
          position: "right",
          targetGroupId: "main",
        },
      }),
    ).toBe(single);
  });

  it("returns invalid source arrangements unchanged instead of compounding corruption", () => {
    const invalid = {
      groups: [
        { activeTabId: "same", id: "left", tabIds: ["same"] },
        { activeTabId: "same", id: "right", tabIds: ["same"] },
      ],
      layout: {
        children: [
          { node: { groupId: "left", type: "group" as const } },
          { node: { groupId: "right", type: "group" as const } },
        ],
        id: "root",
        orientation: "horizontal" as const,
        type: "split" as const,
      },
    } satisfies EditorArrangement;
    expect(
      moveEditorTab(invalid, {
        sourceGroupId: "left",
        tabId: "same",
        target: { groupId: "right", index: 0, kind: "tab-strip" },
      }),
    ).toBe(invalid);
  });
});

function findCommonParentOrientation(
  layout: EditorGridLayout | undefined,
  firstGroupId: string,
  secondGroupId: string,
): "horizontal" | "vertical" | undefined {
  if (!layout || layout.type === "group") {
    return undefined;
  }
  for (const child of layout.children) {
    const nested = findCommonParentOrientation(child.node, firstGroupId, secondGroupId);
    if (nested) {
      return nested;
    }
  }
  return containsGroup(layout, firstGroupId) && containsGroup(layout, secondGroupId)
    ? layout.orientation
    : undefined;
}

function containsGroup(layout: EditorGridLayout, groupId: string): boolean {
  return layout.type === "group"
    ? layout.groupId === groupId
    : layout.children.some((child) => containsGroup(child.node, groupId));
}
