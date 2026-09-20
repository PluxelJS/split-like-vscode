import { describe, expect, it } from "vitest";

import { resolveEditorGroupDropPosition, resolveTabInsertionIndex } from "./editor-drag";

const rect = { bottom: 600, height: 600, left: 0, right: 1000, top: 0, width: 1000 };

describe("editor drag geometry", () => {
  it.each([
    [20, 300, "left"],
    [980, 300, "right"],
    [500, 20, "top"],
    [500, 580, "bottom"],
    [500, 300, "center"],
  ] as const)("maps (%s, %s) to %s", (clientX, clientY, expected) => {
    expect(resolveEditorGroupDropPosition(rect, clientX, clientY)).toBe(expected);
  });

  it("chooses the nearest edge in a corner", () => {
    expect(resolveEditorGroupDropPosition(rect, 20, 80)).toBe("left");
    expect(resolveEditorGroupDropPosition(rect, 120, 20)).toBe("top");
  });

  it("resolves insertion points from tab midpoints", () => {
    const tabs = [
      { left: 0, right: 100 },
      { left: 100, right: 240 },
      { left: 240, right: 320 },
    ];
    expect(resolveTabInsertionIndex(tabs, 30)).toBe(0);
    expect(resolveTabInsertionIndex(tabs, 80)).toBe(1);
    expect(resolveTabInsertionIndex(tabs, 220)).toBe(2);
    expect(resolveTabInsertionIndex(tabs, 400)).toBe(3);
  });
});
