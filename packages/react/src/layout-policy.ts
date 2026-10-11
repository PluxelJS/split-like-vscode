import {
  Actions,
  Model,
  Orientation,
  RowNode,
  TabSetNode,
  type Action,
  type DockLocation,
  type IJsonRowNode,
  type Node,
} from "flexlayout-react";

import { actionsIn } from "./native-layout";

export interface LayoutLimits {
  maxRows?: number;
  maxColumns?: number;
  maxTabsets?: number;
}

export interface LayoutTopology {
  rows: number;
  columns: number;
  tabsets: number;
}

/** A topology constraint, not a native docking permission or content-close decision. */
export interface WorkbenchLayoutPolicy {
  allows(model: Model): boolean;
  allowsAction(model: Model, action: Action): boolean;
  allowsDrop(
    model: Model,
    dragNode: Node,
    target: Node,
    location: DockLocation,
    index?: number,
  ): boolean;
}

/**
 * Measures the main native slicing tree, excluding Borders and sublayouts. A TabSet occupies
 * one cell, including a deliberately retained empty TabSet. Side-by-side children add columns;
 * stacked children add rows. Independent splitters need not be aligned in pixels.
 */
function measure(node: Node): LayoutTopology {
  if (node instanceof TabSetNode) return { rows: 1, columns: 1, tabsets: 1 };
  const result = { rows: 0, columns: 0, tabsets: 0 };
  if (!(node instanceof RowNode)) return result;
  for (const child of node.getChildren()) {
    const size = measure(child);
    result.tabsets += size.tabsets;
    if (node.getOrientation() === Orientation.HORZ) {
      result.columns += size.columns;
      result.rows = Math.max(result.rows, size.rows);
    } else {
      result.rows += size.rows;
      result.columns = Math.max(result.columns, size.columns);
    }
  }
  return result;
}

export function getLayoutTopology(model: Model): LayoutTopology {
  const root = model.getRootRow();
  return root ? measure(root) : { rows: 0, columns: 0, tabsets: 0 };
}

/**
 * Copies native structure without Model.toJson(), which fires every tab's save listener.
 * Materialize inherited empty-container settings because Model exposes no public global
 * attribute snapshot. The candidate has no views, listeners, Routers or retained lifetime.
 */
function topologyCandidate(model: Model): Model {
  const emptyContainers: { id: string; enableDeleteWhenEmpty: boolean }[] = [];
  function rowJson(row: RowNode): IJsonRowNode {
    return {
      ...row.toJson(),
      children: row.getChildren().flatMap((child) => {
        if (child instanceof RowNode) return [rowJson(child)];
        if (!(child instanceof TabSetNode)) return [];
        const empty = child.getChildren().length === 0;
        if (empty)
          emptyContainers.push({
            id: child.getId(),
            enableDeleteWhenEmpty: child.isEnableDeleteWhenEmpty(),
          });
        return [
          {
            ...child.toJson(),
            enableDeleteWhenEmpty: empty ? false : child.isEnableDeleteWhenEmpty(),
            enableClose: child.isEnableClose(),
          },
        ];
      }),
    };
  }
  const root = model.getRootRow();
  if (!root) throw new Error("A layout policy requires a main native layout");
  const candidate = Model.fromJson({
    global: {
      rootOrientationVertical: model.isRootOrientationVertical(),
      tabGroupType: model.getTabGroupType(),
    },
    layout: rowJson(root),
    borders: model.getBorderSet().toJson(),
  });
  // fromJson tidies eagerly. Retain the live empty root placeholder's id while loading, then
  // restore its real cleanup setting before the candidate Action triggers native tidy.
  for (const { id, enableDeleteWhenEmpty } of emptyContainers)
    candidate.doAction(Actions.updateNodeAttributes(id, { enableDeleteWhenEmpty }));
  return candidate;
}

/**
 * Optional desktop limits, for example { maxRows: 2, maxColumns: 2, maxTabsets: 4 }.
 * Native Model Actions perform the candidate move and empty-container tidy; this helper never
 * implements docking. Validate restored Models with allows before retaining their sessions.
 *
 * Action checks cover individual actions and singleton wrappers. Multi-action batches which
 * move/add nodes are refused: public Model APIs cannot copy onCreateTabSet/default inheritance
 * faithfully across subsequent steps. Pure deletion does not increase topology and remains the
 * close coordinator's responsibility (including upstream grouped-tab deletion adaptations).
 * Native drag restrictions and arbitrary host callbacks remain separate checks.
 */
export function createLayoutPolicy(limits: LayoutLimits): WorkbenchLayoutPolicy {
  const { maxRows, maxColumns, maxTabsets } = limits;
  for (const [name, value] of Object.entries({ maxRows, maxColumns, maxTabsets })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
      throw new RangeError(`${name} must be a positive safe integer`);
  }
  const allows = (model: Model): boolean => {
    const size = getLayoutTopology(model);
    return (
      (maxRows === undefined || size.rows <= maxRows) &&
      (maxColumns === undefined || size.columns <= maxColumns) &&
      (maxTabsets === undefined || size.tabsets <= maxTabsets)
    );
  };
  const allowsAction = (model: Model, action: Action): boolean => {
    const leaves = actionsIn(action);
    if (
      leaves.length > 1 &&
      leaves.some((leaf) => leaf.type === Actions.MOVE_NODE || leaf.type === Actions.ADD_TAB)
    )
      return false;
    if (
      leaves.every(
        (leaf) => leaf.type === Actions.DELETE_TAB || leaf.type === Actions.DELETE_TABSET,
      )
    )
      return allows(model);
    const candidate = topologyCandidate(model);
    candidate.doAction(action);
    return allows(candidate);
  };
  return {
    allows,
    allowsAction,
    allowsDrop: (model, dragNode, target, location, index = -1) =>
      allowsAction(model, Actions.moveNode(dragNode.getId(), target.getId(), location, index)),
  };
}
