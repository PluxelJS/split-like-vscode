import {
  BorderNode,
  GroupAction,
  TabGroupNode,
  TabNode,
  TabSetNode,
  type Action,
  type Node,
} from "flexlayout-react";

/** Public native parent links; getTabContainer is internal in FlexLayout 0.11. */
export function tabContainer(node: Node | undefined): TabSetNode | BorderNode | undefined {
  while (node && !(node instanceof TabSetNode) && !(node instanceof BorderNode))
    node = node.getParent();
  return node;
}

/** Includes collapsed groups. Native getTabNodes deliberately lists only visible strip tabs. */
export function tabsIn(node: Node): TabNode[] {
  return node instanceof TabNode ? [node] : node.getChildren().flatMap(tabsIn);
}

export function actionsIn(action: Action): Action[] {
  return action instanceof GroupAction ? action.actions.flatMap(actionsIn) : [action];
}

/** Activating an existing hidden document uses native group expansion, then native selection. */
export function closedGroup(node: Node): TabGroupNode | undefined {
  const parent = node.getParent();
  return parent instanceof TabGroupNode && !parent.isOpened() ? parent : undefined;
}
