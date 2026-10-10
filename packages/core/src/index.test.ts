import { describe, expect, it } from "vitest";

import {
  createSplitLayout,
  resizeAtSash,
  resizeSplitLayout,
  setPaneSize,
  createSplitSizeSnapshot,
} from "./index";

describe("@worksplit/core", () => {
  it("resolves fixed, percentage, and fraction sizes", () => {
    const layout = createSplitLayout({
      containerSize: 1000,
      panes: [
        { id: "left", defaultSize: 200, minSize: 120 },
        { id: "center", defaultSize: "2fr", minSize: 200 },
        { id: "right", defaultSize: "25%", minSize: 100 },
      ],
    });

    expect(layout.sizes).toEqual([200, 550, 250]);
    expect(layout.offsets).toEqual([0, 200, 750]);
  });

  it("moves drag delta across adjacent panes and respects constraints", () => {
    const layout = createSplitLayout({
      containerSize: 900,
      panes: [
        { id: "a", defaultSize: 300, minSize: 200, maxSize: 320 },
        { id: "b", defaultSize: 300, minSize: 260 },
        { id: "c", defaultSize: 300, minSize: 120 },
      ],
    });

    const resized = resizeAtSash(layout, 0, 100);
    expect(resized.sizes).toEqual([320, 280, 300]);
  });

  it("preserves proportions when the container changes size", () => {
    const layout = createSplitLayout({
      containerSize: 800,
      panes: [
        { id: "a", defaultSize: 200, minSize: 100 },
        { id: "b", defaultSize: 600, minSize: 100 },
      ],
    });

    const resized = resizeSplitLayout(
      layout,
      [
        { id: "a", minSize: 100 },
        { id: "b", minSize: 100 },
      ],
      1000,
    );
    expect(resized.sizes).toEqual([250, 750]);
  });

  it("sets edge pane sizes by redistributing space to available neighbors", () => {
    const layout = createSplitLayout({
      containerSize: 900,
      panes: [
        { id: "left", defaultSize: 250, minSize: 160 },
        { id: "center", defaultSize: 350, minSize: 220 },
        { id: "right", defaultSize: 300, minSize: 180 },
      ],
    });

    expect(setPaneSize(layout, "right", 380).sizes).toEqual([250, 270, 380]);
    expect(setPaneSize(layout, "left", 180).sizes).toEqual([180, 420, 300]);
  });

  it("keeps hidden panes in the layout snapshot without assigning visible space", () => {
    const layout = createSplitLayout({
      containerSize: 900,
      panes: [
        { id: "left", defaultSize: 240, minSize: 160 },
        { id: "editor", defaultSize: "1fr", minSize: 300 },
        { id: "panel", defaultSize: 260, minSize: 120, visible: false },
      ],
    });

    expect(layout.visibleIds).toEqual(["left", "editor"]);
    expect(layout.sizes).toEqual([240, 660]);
    expect(layout.panes.map((pane) => [pane.id, pane.visible, pane.size])).toEqual([
      ["left", true, 240],
      ["editor", true, 660],
      ["panel", false, 0],
    ]);
    expect(createSplitSizeSnapshot(layout)).toEqual({ editor: 660, left: 240, panel: 0 });
  });
});
