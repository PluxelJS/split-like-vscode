import {
  Actions,
  DockLocation,
  RowNode,
  TabSetNode,
  type Model,
  type Node,
} from "flexlayout-react";

import type { DestinationResolver } from "./types";

function collectTabsets(node: Node): TabSetNode[] {
  return node instanceof TabSetNode
    ? [node]
    : node instanceof RowNode
      ? node.getChildren().flatMap(collectTabsets)
      : [];
}

/** Native central containers in layout order; Borders are not automatic split targets. */
export function centralTabsets(model: Model): TabSetNode[] {
  const root = model.getRootRow();
  return root ? collectTabsets(root) : [];
}

/** Native parent order defines beside; host capacity and sizing policies remain separate. */
export function beside(options: { direction: DockLocation; ratio?: number }): DestinationResolver {
  const { direction, ratio } = options;
  if (
    ![DockLocation.LEFT, DockLocation.RIGHT, DockLocation.TOP, DockLocation.BOTTOM].includes(
      direction,
    )
  )
    throw new TypeError("beside requires a native edge direction");
  if (ratio !== undefined && (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1))
    throw new RangeError("Split ratio must be between zero and one");
  return (context) => {
    const { anchor, defaultDestination, canPlace } = context;
    if (!anchor || anchor.getChildren().length === 0)
      return defaultDestination && canPlace(defaultDestination) ? defaultDestination : null;
    let branch: Node = anchor;
    for (let parent = branch.getParent(); parent; parent = branch.getParent()) {
      if (parent instanceof RowNode && parent.getOrientation() === direction.getOrientation()) {
        const siblings = parent.getChildren();
        const index = siblings.indexOf(branch);
        const forward = direction === DockLocation.RIGHT || direction === DockLocation.BOTTOM;
        const candidates = forward
          ? siblings.slice(index + 1)
          : siblings.slice(0, index).toReversed();
        for (const sibling of candidates) {
          for (const target of collectTabsets(sibling)) {
            const destination = { target: target.getId(), location: DockLocation.CENTER };
            if (canPlace(destination)) return destination;
          }
        }
      }
      branch = parent;
    }
    const destination = {
      target: anchor.getId(),
      location: direction,
      ...(ratio === undefined ? {} : { ratio }),
    };
    return canPlace(destination) ? destination : null;
  };
}

/** Compare branches at their shared native split; no parallel geometry or layout state. */
export function isInSplitDirection(
  source: TabSetNode,
  target: TabSetNode,
  direction: DockLocation,
): boolean {
  const sourceBranches = new Map<Node, Node>();
  let branch: Node = source;
  for (let parent = branch.getParent(); parent; parent = branch.getParent()) {
    sourceBranches.set(parent, branch);
    branch = parent;
  }
  branch = target;
  for (let parent = branch.getParent(); parent; parent = branch.getParent()) {
    const sourceBranch = sourceBranches.get(parent);
    if (sourceBranch) {
      if (!(parent instanceof RowNode) || parent.getOrientation() !== direction.getOrientation())
        return false;
      const children = parent.getChildren();
      const order = children.indexOf(branch) - children.indexOf(sourceBranch);
      return direction === DockLocation.BOTTOM || direction === DockLocation.RIGHT
        ? order > 0
        : order < 0;
    }
    branch = parent;
  }
  return false;
}

/** ADD_TAB has no ratio parameter. Adjust only the newly split pair with native weights. */
export function applySplitRatio(
  model: Model,
  destination: TabSetNode,
  added: TabSetNode,
  ratio: number,
) {
  const parent = added.getParent();
  if (!(parent instanceof RowNode) || destination.getParent() !== parent)
    throw new Error("Native split did not produce adjacent Tabsets");
  const total = destination.getWeight() + added.getWeight();
  model.doAction(
    Actions.adjustWeights(
      parent.getId(),
      parent.getChildren().map((child) => {
        if (child === added) return total * ratio;
        if (child === destination) return total * (1 - ratio);
        if (child instanceof RowNode || child instanceof TabSetNode) return child.getWeight();
        throw new Error("Unexpected native split child");
      }),
    ),
  );
}
