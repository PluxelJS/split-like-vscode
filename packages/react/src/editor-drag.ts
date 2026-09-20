import type { EditorGridDirection } from "@worksplit/core";

export interface EditorDropRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

export type EditorGroupDropPosition = EditorGridDirection | "center";

export function resolveEditorGroupDropPosition(
  rect: EditorDropRect,
  clientX: number,
  clientY: number,
  edgeRatio = 0.24,
): EditorGroupDropPosition {
  if (rect.width <= 0 || rect.height <= 0) {
    return "center";
  }

  const distances: readonly [EditorGridDirection, number][] = [
    ["left", (clientX - rect.left) / rect.width],
    ["right", (rect.right - clientX) / rect.width],
    ["top", (clientY - rect.top) / rect.height],
    ["bottom", (rect.bottom - clientY) / rect.height],
  ];
  const nearest = distances.toSorted((left, right) => left[1] - right[1])[0];
  return nearest && nearest[1] <= edgeRatio ? nearest[0] : "center";
}

export function resolveTabInsertionIndex(
  tabs: readonly Pick<DOMRect, "left" | "right">[],
  clientX: number,
): number {
  const index = tabs.findIndex((tab) => clientX < tab.left + (tab.right - tab.left) / 2);
  return index < 0 ? tabs.length : index;
}
