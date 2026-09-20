import {
  createEditorGridLayout,
  insertEditorGridGroup,
  normalizeEditorGridLayout,
  removeEditorGridGroup,
  validateEditorGridLayout,
  type EditorGridDirection,
  type EditorGridLayout,
} from "./editor-grid";

export interface EditorArrangementGroup {
  id: string;
  tabIds: readonly string[];
  activeTabId: string;
}

export interface EditorArrangement {
  groups: readonly EditorArrangementGroup[];
  layout?: EditorGridLayout | undefined;
  maximizedGroupId?: string | undefined;
}

export interface EditorArrangementGroupInput {
  id: string;
  tabIds: readonly string[];
  activeTabId?: string | undefined;
}

export interface CreateEditorArrangementOptions {
  groups: readonly EditorArrangementGroupInput[];
  layout?: EditorGridLayout | undefined;
  maximizedGroupId?: string | undefined;
}

export type EditorTabDropTarget =
  | {
      kind: "tab-strip";
      groupId: string;
      /** Final insertion index after the source tab has been removed. */
      index: number;
    }
  | {
      kind: "split";
      targetGroupId: string;
      position: EditorGridDirection;
      newGroupId: string;
    };

export interface MoveEditorTabOptions {
  sourceGroupId: string;
  tabId: string;
  target: EditorTabDropTarget;
}

/** Creates a validated arrangement and fills omitted active tabs from each group's first tab. */
export function createEditorArrangement(
  options: CreateEditorArrangementOptions,
): EditorArrangement {
  const groups = options.groups.map((group) => ({
    activeTabId: group.activeTabId ?? group.tabIds[0] ?? "",
    id: group.id,
    tabIds: [...group.tabIds],
  }));
  const arrangement: EditorArrangement = {
    groups,
    layout: options.layout ?? createEditorGridLayout(groups.map((group) => group.id)),
    maximizedGroupId: options.maximizedGroupId,
  };
  validateEditorArrangement(arrangement);
  return arrangement;
}

/**
 * Reconciles an untrusted snapshot with the currently available tabs.
 * Unknown and duplicate tabs are removed; missing tabs are appended to the first surviving group.
 */
export function normalizeEditorArrangement(
  value: unknown,
  availableTabIds: readonly string[],
  defaultGroupId = "main",
): EditorArrangement {
  const available = validateAvailableTabIds(availableTabIds);
  if (!isNonEmptyString(defaultGroupId)) {
    throw new Error("[Worksplit] Default editor group id must be a non-empty string.");
  }

  const input = isRecord(value) ? value : {};
  const seenGroupIds = new Set<string>();
  const seenTabIds = new Set<string>();
  const groups = (
    Array.isArray(input["groups"]) ? input["groups"] : []
  ).flatMap<EditorArrangementGroup>((candidate) => {
    if (!isRecord(candidate)) {
      return [];
    }
    const id = candidate["id"];
    if (!isNonEmptyString(id) || seenGroupIds.has(id)) {
      return [];
    }
    seenGroupIds.add(id);
    const tabIds = (Array.isArray(candidate["tabIds"]) ? candidate["tabIds"] : []).flatMap(
      (tabId) => {
        if (!isNonEmptyString(tabId) || !available.has(tabId) || seenTabIds.has(tabId)) {
          return [];
        }
        seenTabIds.add(tabId);
        return [tabId];
      },
    );
    if (tabIds.length === 0) {
      return [];
    }
    const requestedActive = candidate["activeTabId"];
    return [
      {
        activeTabId:
          isNonEmptyString(requestedActive) && tabIds.includes(requestedActive)
            ? requestedActive
            : tabIds[0]!,
        id,
        tabIds,
      },
    ];
  });

  const missing = availableTabIds.filter((tabId) => !seenTabIds.has(tabId));
  if (missing.length > 0) {
    if (groups.length === 0) {
      groups.push({ activeTabId: missing[0]!, id: defaultGroupId, tabIds: [...missing] });
    } else {
      const first = groups[0]!;
      groups[0] = { ...first, tabIds: [...first.tabIds, ...missing] };
    }
  }

  const groupIds = groups.map((group) => group.id);
  const layout = normalizeEditorGridLayout(input["layout"], groupIds);
  const maximizedGroupId = input["maximizedGroupId"];
  return {
    groups,
    layout,
    maximizedGroupId:
      isNonEmptyString(maximizedGroupId) && groupIds.includes(maximizedGroupId)
        ? maximizedGroupId
        : undefined,
  };
}

/** Validates the complete runtime invariant, including globally unique tab ids. */
export function validateEditorArrangement(arrangement: EditorArrangement): void {
  const groupIds = new Set<string>();
  const tabIds = new Set<string>();
  for (const group of arrangement.groups) {
    if (!isNonEmptyString(group.id)) {
      throw new Error("[Worksplit] Editor arrangement group ids must be non-empty strings.");
    }
    if (groupIds.has(group.id)) {
      throw new Error(`[Worksplit] Duplicate editor arrangement group id "${group.id}".`);
    }
    if (group.tabIds.length === 0) {
      throw new Error(`[Worksplit] Editor arrangement group "${group.id}" must contain a tab.`);
    }
    for (const tabId of group.tabIds) {
      if (!isNonEmptyString(tabId)) {
        throw new Error("[Worksplit] Editor tab ids must be non-empty strings.");
      }
      if (tabIds.has(tabId)) {
        throw new Error(`[Worksplit] Duplicate editor tab id "${tabId}".`);
      }
      tabIds.add(tabId);
    }
    if (!group.tabIds.includes(group.activeTabId)) {
      throw new Error(
        `[Worksplit] Editor arrangement group "${group.id}" has an invalid active tab.`,
      );
    }
    groupIds.add(group.id);
  }

  validateEditorGridLayout(
    arrangement.layout,
    arrangement.groups.map((group) => group.id),
  );
  if (arrangement.maximizedGroupId && !groupIds.has(arrangement.maximizedGroupId)) {
    throw new Error(
      `[Worksplit] Maximized editor group "${arrangement.maximizedGroupId}" does not exist.`,
    );
  }
}

/** Moves a tab and its spatial state atomically. Invalid or already-satisfied moves are no-ops. */
export function moveEditorTab(
  arrangement: EditorArrangement,
  options: MoveEditorTabOptions,
): EditorArrangement {
  if (!isValidArrangement(arrangement)) {
    return arrangement;
  }
  const sourceIndex = arrangement.groups.findIndex((group) => group.id === options.sourceGroupId);
  if (sourceIndex < 0) {
    return arrangement;
  }
  const source = arrangement.groups[sourceIndex]!;
  const sourceTabIndex = source.tabIds.indexOf(options.tabId);
  if (sourceTabIndex < 0) {
    return arrangement;
  }

  if (options.target.kind === "tab-strip") {
    return moveToTabStrip(arrangement, sourceIndex, sourceTabIndex, options.tabId, options.target);
  }
  return moveToSplit(arrangement, sourceIndex, sourceTabIndex, options.tabId, options.target);
}

function moveToTabStrip(
  arrangement: EditorArrangement,
  sourceIndex: number,
  sourceTabIndex: number,
  tabId: string,
  target: Extract<EditorTabDropTarget, { kind: "tab-strip" }>,
): EditorArrangement {
  const targetIndex = arrangement.groups.findIndex((group) => group.id === target.groupId);
  if (targetIndex < 0 || !Number.isInteger(target.index)) {
    return arrangement;
  }
  const source = arrangement.groups[sourceIndex]!;
  const targetGroup = arrangement.groups[targetIndex]!;
  const sameGroup = sourceIndex === targetIndex;
  const maxIndex = sameGroup ? source.tabIds.length - 1 : targetGroup.tabIds.length;
  if (target.index < 0 || target.index > maxIndex) {
    return arrangement;
  }

  if (sameGroup) {
    const tabIds = source.tabIds.filter((_, index) => index !== sourceTabIndex);
    tabIds.splice(target.index, 0, tabId);
    if (sameStrings(tabIds, source.tabIds)) {
      return arrangement;
    }
    const groups = [...arrangement.groups];
    groups[sourceIndex] = { ...source, tabIds };
    return { ...arrangement, groups };
  }

  const nextSource = removeTab(source, sourceTabIndex);
  const targetTabIds = [...targetGroup.tabIds];
  targetTabIds.splice(target.index, 0, tabId);
  const nextTarget = { ...targetGroup, activeTabId: tabId, tabIds: targetTabIds };
  const groups = arrangement.groups.flatMap((group, index) => {
    if (index === sourceIndex) {
      return nextSource ? [nextSource] : [];
    }
    return index === targetIndex ? [nextTarget] : [group];
  });
  const sourceRemoved = !nextSource;
  return {
    ...arrangement,
    groups,
    layout: sourceRemoved
      ? removeEditorGridGroup(arrangement.layout, source.id)
      : arrangement.layout,
    maximizedGroupId:
      sourceRemoved && arrangement.maximizedGroupId === source.id
        ? undefined
        : arrangement.maximizedGroupId,
  };
}

function moveToSplit(
  arrangement: EditorArrangement,
  sourceIndex: number,
  sourceTabIndex: number,
  tabId: string,
  target: Extract<EditorTabDropTarget, { kind: "split" }>,
): EditorArrangement {
  const targetIndex = arrangement.groups.findIndex((group) => group.id === target.targetGroupId);
  if (
    targetIndex < 0 ||
    !isNonEmptyString(target.newGroupId) ||
    !isEditorGridDirection(target.position) ||
    arrangement.groups.some((group) => group.id === target.newGroupId)
  ) {
    return arrangement;
  }
  const source = arrangement.groups[sourceIndex]!;
  if (source.id === target.targetGroupId && source.tabIds.length === 1) {
    return arrangement;
  }

  const nextSource = removeTab(source, sourceTabIndex);
  let layout = arrangement.layout;
  if (!nextSource) {
    layout = removeEditorGridGroup(layout, source.id);
  }
  layout = insertEditorGridGroup(layout, {
    groupId: target.newGroupId,
    position: target.position,
    targetGroupId: target.targetGroupId,
  });
  if (layout === arrangement.layout) {
    return arrangement;
  }

  const groups = arrangement.groups.flatMap((group, index) => {
    if (index === sourceIndex) {
      return nextSource ? [nextSource] : [];
    }
    return [group];
  });
  groups.push({
    activeTabId: tabId,
    id: target.newGroupId,
    tabIds: [tabId],
  });
  return {
    ...arrangement,
    groups,
    layout,
    maximizedGroupId:
      !nextSource && arrangement.maximizedGroupId === source.id
        ? undefined
        : arrangement.maximizedGroupId,
  };
}

function removeTab(
  group: EditorArrangementGroup,
  tabIndex: number,
): EditorArrangementGroup | undefined {
  const tabIds = group.tabIds.filter((_, index) => index !== tabIndex);
  if (tabIds.length === 0) {
    return undefined;
  }
  const activeTabId =
    group.activeTabId === group.tabIds[tabIndex]
      ? (tabIds[Math.min(tabIndex, tabIds.length - 1)] ?? tabIds[0]!)
      : group.activeTabId;
  return { ...group, activeTabId, tabIds };
}

function validateAvailableTabIds(tabIds: readonly string[]): Set<string> {
  const seen = new Set<string>();
  for (const tabId of tabIds) {
    if (!isNonEmptyString(tabId)) {
      throw new Error("[Worksplit] Available editor tab ids must be non-empty strings.");
    }
    if (seen.has(tabId)) {
      throw new Error(`[Worksplit] Duplicate available editor tab id "${tabId}".`);
    }
    seen.add(tabId);
  }
  return seen;
}

function isValidArrangement(arrangement: EditorArrangement): boolean {
  try {
    validateEditorArrangement(arrangement);
    return true;
  } catch {
    return false;
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isEditorGridDirection(value: unknown): value is EditorGridDirection {
  return value === "bottom" || value === "left" || value === "right" || value === "top";
}
