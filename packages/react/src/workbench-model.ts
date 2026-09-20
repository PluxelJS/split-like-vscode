import {
  WORKBENCH_PARTS,
  createSplitSizeSnapshot,
  normalizeEditorGridLayout,
  normalizeEditorArrangement,
  type EditorArrangement,
  type EditorGridLayout,
  type SplitLayout,
  type WorkbenchPart,
  type WorkbenchValue as CoreWorkbenchValue,
  type WorkbenchValueSnapshot as CoreWorkbenchValueSnapshot,
} from "@worksplit/core";

export { WORKBENCH_PARTS } from "@worksplit/core";
export type { WorkbenchPart } from "@worksplit/core";

export type WorkbenchPanelPosition = "bottom" | "right";

export interface WorkbenchValue {
  version: 1;
  activeByPart: Partial<Record<WorkbenchPart, string>>;
  activeEditorTabs: Record<string, string>;
  visibleParts: Record<WorkbenchPart, boolean>;
}

export interface WorkbenchValueSnapshot {
  version: 1;
  activeByPart?: Partial<Record<WorkbenchPart, string>> | undefined;
  activeEditorTabs?: Record<string, string> | undefined;
  visibleParts?: Partial<Record<WorkbenchPart, boolean>> | undefined;
}

export interface WorkbenchAreaSizeSnapshot {
  workbench?: Record<string, number> | undefined;
  center?: Record<string, number> | undefined;
  editorGroups?: Record<string, number> | undefined;
}

export type WorkbenchAreaLayoutId = "workbench" | "center" | "editorGroups";

export interface WorkbenchLayout {
  version: 1;
  value: WorkbenchValueSnapshot;
  panelPosition: WorkbenchPanelPosition;
  areaSizes?: WorkbenchAreaSizeSnapshot;
  /** Recursive editor-group topology. Omitted snapshots restore the legacy horizontal layout. */
  editorLayout?: EditorGridLayout | undefined;
  /** Group temporarily expanded over the editor grid without changing its topology. */
  maximizedEditorGroupId?: string | undefined;
  /** Tab placement and editor topology for the descriptor-based editorTabs API. */
  editorArrangement?: EditorArrangement | undefined;
}

export function readStartupLayout(
  storageKey: string | undefined,
  defaultLayout: WorkbenchLayout | undefined,
  editorGroupIds: readonly string[] = [],
  editorTabIds: readonly string[] = [],
): WorkbenchLayout {
  const fallback = normalizeLayout(
    defaultLayout,
    undefined,
    "bottom",
    editorGroupIds,
    editorTabIds,
  );
  if (!storageKey || typeof window === "undefined") {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return fallback;
    }
    const parsed = JSON.parse(stored) as Partial<WorkbenchLayout>;
    if (parsed.version === 1 && parsed.value) {
      return normalizeLayout(parsed, undefined, "bottom", editorGroupIds, editorTabIds);
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function normalizeLayout(
  layout: Partial<WorkbenchLayout> | undefined,
  defaultValue: WorkbenchValueSnapshot | undefined,
  fallbackPanelPosition: WorkbenchPanelPosition,
  editorGroupIds: readonly string[] = [],
  editorTabIds: readonly string[] = [],
): WorkbenchLayout {
  const editorLayout = layout?.editorLayout
    ? normalizeEditorGridLayout(layout.editorLayout, editorGroupIds)
    : undefined;
  const maximizedEditorGroupId =
    typeof layout?.maximizedEditorGroupId === "string" &&
    editorGroupIds.includes(layout.maximizedEditorGroupId)
      ? layout.maximizedEditorGroupId
      : undefined;
  return {
    panelPosition: isPanelPosition(layout?.panelPosition)
      ? layout.panelPosition
      : fallbackPanelPosition,
    areaSizes: normalizeAreaSizeSnapshot(layout?.areaSizes),
    editorArrangement:
      layout?.editorArrangement && editorTabIds.length > 0
        ? normalizeEditorArrangement(layout.editorArrangement, editorTabIds)
        : undefined,
    editorLayout,
    maximizedEditorGroupId,
    version: 1,
    value: normalizeValueSnapshot(layout?.value ?? defaultValue),
  };
}

export function toCoreValue(value: WorkbenchValue): CoreWorkbenchValue {
  return {
    activeByPart: { ...value.activeByPart },
    version: 1,
    visibleParts: { ...value.visibleParts },
  };
}

export function toCoreValueSnapshot(value: WorkbenchValueSnapshot): CoreWorkbenchValueSnapshot {
  return {
    activeByPart: value.activeByPart ? { ...value.activeByPart } : undefined,
    version: 1,
    visibleParts: value.visibleParts ? { ...value.visibleParts } : undefined,
  };
}

export function toPublicValue(
  value: CoreWorkbenchValue,
  activeEditorTabs: Record<string, string>,
): WorkbenchValue {
  return {
    activeByPart: { ...value.activeByPart },
    activeEditorTabs: { ...activeEditorTabs },
    version: 1,
    visibleParts: { ...value.visibleParts },
  };
}

export function createPublicValueSnapshot(
  value: CoreWorkbenchValue,
  activeEditorTabs: Record<string, string>,
): WorkbenchValueSnapshot {
  return {
    activeByPart: { ...value.activeByPart },
    activeEditorTabs: { ...activeEditorTabs },
    version: 1,
    visibleParts: { ...value.visibleParts },
  };
}

export function normalizeValueSnapshot(
  value: WorkbenchValueSnapshot | undefined,
): WorkbenchValueSnapshot {
  if (!value) {
    return { version: 1 };
  }

  return {
    activeByPart: readPartSnapshot(
      value.activeByPart,
      (item): item is string => typeof item === "string",
    ),
    activeEditorTabs: sanitizeActiveEditorTabs(value.activeEditorTabs),
    version: 1,
    visibleParts: readPartSnapshot(
      value.visibleParts,
      (item): item is boolean => typeof item === "boolean",
    ),
  };
}

export function sameWorkbenchValue(left: CoreWorkbenchValue, right: CoreWorkbenchValue): boolean {
  return WORKBENCH_PARTS.every(
    (part) =>
      left.activeByPart[part] === right.activeByPart[part] &&
      left.visibleParts[part] === right.visibleParts[part],
  );
}

export function sameStringRecord(left: Record<string, string>, right: Record<string, string>) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

export function readCurrentAreaSizes(
  workbenchLayout: SplitLayout | null,
  centerLayout: SplitLayout | null,
  editorGroupsLayout: SplitLayout | null,
  fallback: WorkbenchAreaSizeSnapshot,
): WorkbenchAreaSizeSnapshot {
  return {
    center: centerLayout ? createSplitSizeSnapshot(centerLayout) : fallback.center,
    editorGroups: editorGroupsLayout
      ? createSplitSizeSnapshot(editorGroupsLayout)
      : fallback.editorGroups,
    workbench: workbenchLayout ? createSplitSizeSnapshot(workbenchLayout) : fallback.workbench,
  };
}

export function cloneAreaSizeSnapshot(
  snapshot: WorkbenchAreaSizeSnapshot,
): WorkbenchAreaSizeSnapshot {
  return {
    center: snapshot.center ? { ...snapshot.center } : undefined,
    editorGroups: snapshot.editorGroups ? { ...snapshot.editorGroups } : undefined,
    workbench: snapshot.workbench ? { ...snapshot.workbench } : undefined,
  };
}

function sanitizeActiveEditorTabs(
  value: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const next: Record<string, string> = {};
  for (const [groupId, tabId] of Object.entries(value)) {
    if (typeof tabId === "string") {
      next[groupId] = tabId;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function readPartSnapshot<T>(
  value: Partial<Record<WorkbenchPart, T>> | undefined,
  accepts: (value: unknown) => value is T,
): Partial<Record<WorkbenchPart, T>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const next: Partial<Record<WorkbenchPart, T>> = {};
  for (const part of WORKBENCH_PARTS) {
    const item = value[part];
    if (accepts(item)) {
      next[part] = item;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeAreaSizeSnapshot(
  snapshot: WorkbenchAreaSizeSnapshot | undefined,
): WorkbenchAreaSizeSnapshot {
  if (!snapshot) {
    return {};
  }

  return {
    center: sanitizeSizeRecord(snapshot.center),
    editorGroups: sanitizeSizeRecord(snapshot.editorGroups),
    workbench: sanitizeSizeRecord(snapshot.workbench),
  };
}

function sanitizeSizeRecord(
  value: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isPanelPosition(value: unknown): value is WorkbenchPanelPosition {
  return value === "bottom" || value === "right";
}
