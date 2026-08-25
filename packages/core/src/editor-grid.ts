export type EditorGridDirection = "bottom" | "left" | "right" | "top";

export interface EditorGridGroupNode {
  type: "group";
  groupId: string;
}

export interface EditorGridSplitChild {
  node: EditorGridLayout;
  /** Last committed size in CSS pixels. Omit to use the child's declared default size. */
  size?: number | undefined;
}

export interface EditorGridSplitNode {
  type: "split";
  /** Stable identity used to retain nested split state across renders and persistence. */
  id: string;
  orientation: "horizontal" | "vertical";
  children: readonly EditorGridSplitChild[];
}

export type EditorGridLayout = EditorGridGroupNode | EditorGridSplitNode;

export interface MoveEditorGridGroupOptions {
  groupId: string;
  targetGroupId: string;
  position: EditorGridDirection;
}

/** Creates the default one-group or horizontal multi-group editor layout. */
export function createEditorGridLayout(groupIds: readonly string[]): EditorGridLayout | undefined {
  const ids = validateGroupIds(groupIds);
  if (ids.length === 0) {
    return undefined;
  }
  if (ids.length === 1) {
    return createGroupNode(ids[0]!);
  }
  return {
    children: ids.map((groupId) => ({ node: createGroupNode(groupId) })),
    id: "root",
    orientation: "horizontal",
    type: "split",
  };
}

/**
 * Validates an authored editor layout. Every declared group must occur exactly once.
 *
 * Persisted or otherwise untrusted input should use `normalizeEditorGridLayout` instead.
 */
export function validateEditorGridLayout(
  layout: EditorGridLayout | undefined,
  groupIds: readonly string[],
): void {
  const ids = validateGroupIds(groupIds);
  if (!layout) {
    if (ids.length > 0) {
      throw new Error("[Worksplit] Editor layout is missing its declared editor groups.");
    }
    return;
  }

  const expectedGroups = new Set(ids);
  const seenGroups = new Set<string>();
  const seenSplits = new Set<string>();
  const ancestors = new Set<object>();

  const visit = (node: EditorGridLayout, path: string): void => {
    if (!node || typeof node !== "object") {
      throw new Error(`[Worksplit] Editor layout node at ${path} must be an object.`);
    }
    if (ancestors.has(node)) {
      throw new Error(`[Worksplit] Editor layout contains a cycle at ${path}.`);
    }
    ancestors.add(node);

    if (node.type === "group") {
      if (!isNonEmptyString(node.groupId)) {
        throw new Error(`[Worksplit] Editor group reference at ${path} must be non-empty.`);
      }
      if (!expectedGroups.has(node.groupId)) {
        throw new Error(
          `[Worksplit] Editor layout references unknown editor group "${node.groupId}".`,
        );
      }
      if (seenGroups.has(node.groupId)) {
        throw new Error(
          `[Worksplit] Editor layout references editor group "${node.groupId}" more than once.`,
        );
      }
      seenGroups.add(node.groupId);
      ancestors.delete(node);
      return;
    }

    if (node.type !== "split") {
      throw new Error(`[Worksplit] Editor layout node at ${path} has an unknown type.`);
    }
    if (!isNonEmptyString(node.id)) {
      throw new Error(`[Worksplit] Editor split id at ${path} must be non-empty.`);
    }
    if (seenSplits.has(node.id)) {
      throw new Error(`[Worksplit] Duplicate editor split id "${node.id}".`);
    }
    if (node.orientation !== "horizontal" && node.orientation !== "vertical") {
      throw new Error(`[Worksplit] Editor split "${node.id}" has an invalid orientation.`);
    }
    if (!Array.isArray(node.children) || node.children.length < 2) {
      throw new Error(`[Worksplit] Editor split "${node.id}" must contain at least two children.`);
    }
    seenSplits.add(node.id);
    node.children.forEach((child, index) => {
      if (!child || typeof child !== "object" || !("node" in child)) {
        throw new Error(
          `[Worksplit] Editor split "${node.id}" child ${index} must contain a node.`,
        );
      }
      if (child.size !== undefined && !isSize(child.size)) {
        throw new Error(
          `[Worksplit] Editor split "${node.id}" child ${index} has an invalid size.`,
        );
      }
      visit(child.node, `${path}.children[${index}].node`);
    });
    ancestors.delete(node);
  };

  visit(layout, "editorLayout");
  const missing = ids.filter((id) => !seenGroups.has(id));
  if (missing.length > 0) {
    throw new Error(
      `[Worksplit] Editor layout is missing editor ${pluralize("group", missing.length)} ${missing
        .map((id) => `"${id}"`)
        .join(", ")}.`,
    );
  }
}

/**
 * Sanitizes an editor layout snapshot and reconciles it with the current group descriptors.
 * Unknown and duplicate group references are dropped; newly declared groups are appended.
 */
export function normalizeEditorGridLayout(
  value: unknown,
  groupIds: readonly string[],
): EditorGridLayout | undefined {
  const ids = validateGroupIds(groupIds);
  const expectedGroups = new Set(ids);
  const seenGroups = new Set<string>();
  const seenSplits = new Set<string>();
  const ancestors = new Set<object>();

  const readNode = (input: unknown): EditorGridLayout | undefined => {
    if (!isRecord(input) || ancestors.has(input)) {
      return undefined;
    }
    ancestors.add(input);

    if (input["type"] === "group") {
      const groupId = input["groupId"];
      ancestors.delete(input);
      if (!isNonEmptyString(groupId) || !expectedGroups.has(groupId) || seenGroups.has(groupId)) {
        return undefined;
      }
      seenGroups.add(groupId);
      return createGroupNode(groupId);
    }

    if (input["type"] !== "split" || !Array.isArray(input["children"])) {
      ancestors.delete(input);
      return undefined;
    }

    const orientation = input["orientation"];
    if (orientation !== "horizontal" && orientation !== "vertical") {
      ancestors.delete(input);
      return undefined;
    }
    const requestedId = isNonEmptyString(input["id"]) ? input["id"] : "split";
    const id = uniqueSplitId(requestedId, seenSplits);
    seenSplits.add(id);
    const children = input["children"].flatMap<EditorGridSplitChild>((candidate) => {
      if (!isRecord(candidate)) {
        return [];
      }
      const node = readNode(candidate["node"]);
      if (!node) {
        return [];
      }
      const size = candidate["size"];
      return [isSize(size) ? { node, size } : { node }];
    });
    ancestors.delete(input);

    if (children.length === 0) {
      seenSplits.delete(id);
      return undefined;
    }
    if (children.length === 1) {
      seenSplits.delete(id);
      return children[0]!.node;
    }
    return { children, id, orientation, type: "split" };
  };

  const restored = readNode(value);
  const missing = ids.filter((id) => !seenGroups.has(id));
  return appendMissingGroups(restored, missing, seenSplits);
}

/**
 * Moves an existing group beside another group. Invalid or already satisfied moves are no-ops.
 */
export function moveEditorGridGroup(
  layout: EditorGridLayout | undefined,
  options: MoveEditorGridGroupOptions,
): EditorGridLayout | undefined {
  if (
    !layout ||
    options.groupId === options.targetGroupId ||
    !containsGroup(layout, options.groupId) ||
    !containsGroup(layout, options.targetGroupId)
  ) {
    return layout;
  }

  const withoutGroup = removeGroup(layout, options.groupId);
  if (!withoutGroup) {
    return layout;
  }
  const splitIds = new Set<string>();
  collectSplitIds(withoutGroup, splitIds);
  const moved = insertGroup(
    withoutGroup,
    createGroupNode(options.groupId),
    options.targetGroupId,
    options.position,
    splitIds,
  );
  return moved ?? layout;
}

function appendMissingGroups(
  layout: EditorGridLayout | undefined,
  missing: readonly string[],
  splitIds: Set<string>,
): EditorGridLayout | undefined {
  if (!layout) {
    return createEditorGridLayout(missing);
  }
  if (missing.length === 0) {
    return layout;
  }

  const added = missing.map((groupId) => ({ node: createGroupNode(groupId) }));
  if (layout.type === "split" && layout.orientation === "horizontal") {
    return { ...layout, children: [...layout.children, ...added] };
  }
  const id = uniqueSplitId("root", splitIds);
  return {
    children: [{ node: layout }, ...added],
    id,
    orientation: "horizontal",
    type: "split",
  };
}

function removeGroup(node: EditorGridLayout, groupId: string): EditorGridLayout | undefined {
  if (node.type === "group") {
    return node.groupId === groupId ? undefined : node;
  }

  let changed = false;
  const children = node.children.flatMap<EditorGridSplitChild>((child) => {
    const next = removeGroup(child.node, groupId);
    if (!next) {
      changed = true;
      return [];
    }
    if (next !== child.node) {
      changed = true;
      return [{ ...child, node: next }];
    }
    return [child];
  });
  if (!changed) {
    return node;
  }
  if (children.length === 1) {
    return children[0]!.node;
  }
  return { ...node, children };
}

function insertGroup(
  node: EditorGridLayout,
  group: EditorGridGroupNode,
  targetGroupId: string,
  position: EditorGridDirection,
  splitIds: Set<string>,
): EditorGridLayout | undefined {
  const orientation = position === "left" || position === "right" ? "horizontal" : "vertical";
  const before = position === "left" || position === "top";

  if (node.type === "group") {
    if (node.groupId !== targetGroupId) {
      return undefined;
    }
    const id = uniqueSplitId("split", splitIds);
    splitIds.add(id);
    const target = { node };
    const inserted = { node: group };
    return {
      children: before ? [inserted, target] : [target, inserted],
      id,
      orientation,
      type: "split",
    };
  }

  const directTargetIndex = node.children.findIndex(
    (child) => child.node.type === "group" && child.node.groupId === targetGroupId,
  );
  if (directTargetIndex >= 0 && node.orientation === orientation) {
    const children = [...node.children];
    children.splice(directTargetIndex + (before ? 0 : 1), 0, { node: group });
    return { ...node, children };
  }

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]!;
    const inserted = insertGroup(child.node, group, targetGroupId, position, splitIds);
    if (!inserted) {
      continue;
    }
    const children = [...node.children];
    children[index] = { ...child, node: inserted };
    return { ...node, children };
  }
  return undefined;
}

function collectSplitIds(node: EditorGridLayout, ids: Set<string>): void {
  if (node.type === "group") {
    return;
  }
  ids.add(node.id);
  node.children.forEach((child) => collectSplitIds(child.node, ids));
}

function containsGroup(node: EditorGridLayout, groupId: string): boolean {
  return node.type === "group"
    ? node.groupId === groupId
    : node.children.some((child) => containsGroup(child.node, groupId));
}

function createGroupNode(groupId: string): EditorGridGroupNode {
  return { groupId, type: "group" };
}

function validateGroupIds(groupIds: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const id of groupIds) {
    if (!isNonEmptyString(id)) {
      throw new Error("[Worksplit] Editor group ids must be non-empty strings.");
    }
    if (seen.has(id)) {
      throw new Error(`[Worksplit] Duplicate editor group id "${id}".`);
    }
    seen.add(id);
  }
  return [...groupIds];
}

function uniqueSplitId(requested: string, ids: ReadonlySet<string>): string {
  if (!ids.has(requested)) {
    return requested;
  }
  let suffix = 2;
  while (ids.has(`${requested}-${suffix}`)) {
    suffix += 1;
  }
  return `${requested}-${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
