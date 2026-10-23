import {
  Actions,
  DockLocation,
  RowNode,
  TabSetNode,
  type Model,
  type Node,
} from "flexlayout-react";

export type DocumentPlacement =
  | { mode: "tab"; source?: string }
  | { mode: "split"; source?: string; direction?: DockLocation; ratio?: number };

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
