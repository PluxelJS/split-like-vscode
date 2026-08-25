export type SplitOrientation = "horizontal" | "vertical";

export {
  createEditorGridLayout,
  moveEditorGridGroup,
  normalizeEditorGridLayout,
  validateEditorGridLayout,
  type EditorGridDirection,
  type EditorGridGroupNode,
  type EditorGridLayout,
  type EditorGridSplitChild,
  type EditorGridSplitNode,
  type MoveEditorGridGroupOptions,
} from "./editor-grid";

export {
  WORKBENCH_PARTS,
  activateWorkbenchView,
  createWorkbenchValue,
  createWorkbenchValueSnapshot,
  getActiveWorkbenchView,
  setWorkbenchPartVisibility,
  toggleWorkbenchPart,
  type WorkbenchPart,
  type WorkbenchValue,
  type WorkbenchValueSnapshot,
  type WorkbenchViewDescriptor,
} from "./workbench";

export type PaneSizeValue = number | `${number}px` | `${number}%` | `${number}fr`;

export type PanePriority = "low" | "normal" | "high" | number;

export interface PaneConstraints {
  id: string;
  minSize?: number | undefined;
  maxSize?: number | undefined;
  defaultSize?: PaneSizeValue | undefined;
  priority?: PanePriority | undefined;
  collapsedSize?: number | undefined;
  visible?: boolean | undefined;
}

export interface ResolvedPane {
  id: string;
  minSize: number;
  maxSize: number;
  collapsedSize: number;
  defaultSize?: PaneSizeValue | undefined;
  priority: number;
  visible: boolean;
}

export interface PaneLayoutItem extends ResolvedPane {
  size: number;
  offset: number;
  visible: true;
}

export interface PaneSnapshot extends ResolvedPane {
  size: number;
  offset: number;
  visible: boolean;
}

export interface SplitLayout {
  containerSize: number;
  contentSize: number;
  items: PaneLayoutItem[];
  panes: PaneSnapshot[];
  sizes: number[];
  offsets: number[];
  sizeById: Record<string, number>;
  visibleIds: string[];
}

export interface CreateSplitLayoutOptions {
  panes: PaneConstraints[];
  containerSize: number;
  sizes?: number[] | undefined;
  sizeById?: Record<string, number | undefined> | undefined;
}

const DEFAULT_MIN_SIZE = 48;
const EPSILON = 0.001;

export function normalizePanes(panes: PaneConstraints[]): ResolvedPane[] {
  return panes.map((pane, index) => {
    const collapsedSize = Math.max(0, finiteNumber(pane.collapsedSize, 0));
    const minSize = finiteNumber(pane.minSize, DEFAULT_MIN_SIZE);
    const maxSize = Math.max(minSize, finiteNumber(pane.maxSize, Number.POSITIVE_INFINITY));

    return {
      id: pane.id,
      minSize,
      maxSize,
      collapsedSize,
      defaultSize: pane.defaultSize,
      priority: resolvePriority(pane.priority, index),
      visible: pane.visible !== false,
    };
  });
}

export function createSplitLayout(options: CreateSplitLayoutOptions): SplitLayout {
  const panes = normalizePanes(options.panes);
  const visiblePanes = panes.filter(isVisiblePane);
  const containerSize = Math.max(0, options.containerSize);
  const sizes =
    options.sizes && options.sizes.length === visiblePanes.length
      ? reconcileSizes(options.sizes, visiblePanes, containerSize)
      : options.sizeById
        ? reconcileSizes(
            resolveInitialSizes(visiblePanes, containerSize).map(
              (size, index) => options.sizeById?.[visiblePanes[index]!.id] ?? size,
            ),
            visiblePanes,
            containerSize,
          )
        : resolveInitialSizes(visiblePanes, containerSize);

  return buildLayout(panes, sizes, containerSize);
}

export function resizeSplitLayout(
  layout: SplitLayout,
  panes: PaneConstraints[],
  containerSize: number,
  proportional = true,
): SplitLayout {
  const resolved = normalizePanes(panes);
  const visiblePanes = resolved.filter(isVisiblePane);
  const nextSize = Math.max(0, containerSize);
  const byId = new Map(layout.panes.map((item) => [item.id, item.size]));
  const previous = visiblePanes.map(
    (pane) => byId.get(pane.id) ?? resolveDefaultSize(pane.defaultSize, nextSize, 1),
  );
  const previousTotal = previous.reduce(sum, 0);
  const scaled =
    proportional && previousTotal > 0
      ? previous.map((size) => (size / previousTotal) * nextSize)
      : previous;

  return buildLayout(resolved, reconcileSizes(scaled, visiblePanes, nextSize), nextSize);
}

export function resizeAtSash(layout: SplitLayout, sashIndex: number, delta: number): SplitLayout {
  if (sashIndex < 0 || sashIndex >= layout.items.length - 1 || delta === 0) {
    return layout;
  }

  const items = layout.items;
  const sizes = layout.sizes.slice();
  const before = reverseRange(0, sashIndex);
  const after = forwardRange(sashIndex + 1, items.length - 1);

  if (delta > 0) {
    const amount = Math.min(
      delta,
      growthCapacity(items, sizes, before),
      shrinkCapacity(items, sizes, after),
    );
    grow(items, sizes, before, amount);
    shrink(items, sizes, after, amount);
  } else {
    const amount = Math.min(
      Math.abs(delta),
      shrinkCapacity(items, sizes, before),
      growthCapacity(items, sizes, after),
    );
    shrink(items, sizes, before, amount);
    grow(items, sizes, after, amount);
  }

  return buildLayout(layout.panes, sizes, layout.containerSize);
}

export function setPaneSize(layout: SplitLayout, paneId: string, size: number): SplitLayout {
  const index = layout.items.findIndex((item) => item.id === paneId);
  if (index === -1) {
    return layout;
  }

  const current = layout.sizes[index]!;
  const item = layout.items[index]!;
  const next = clamp(size, item.minSize, item.maxSize);
  const delta = next - current;
  if (Math.abs(delta) < EPSILON) {
    return layout;
  }

  const sizes = layout.sizes.slice();
  const target = [index];
  const left = reverseRange(0, index - 1);
  const right = forwardRange(index + 1, layout.items.length - 1);

  if (delta > 0) {
    const donors = right.concat(left);
    const amount = Math.min(
      delta,
      growthCapacity(layout.items, sizes, target),
      shrinkCapacity(layout.items, sizes, donors),
    );
    grow(layout.items, sizes, target, amount);
    shrink(layout.items, sizes, donors, amount);
  } else {
    const receivers = right.concat(left);
    const amount = Math.min(
      Math.abs(delta),
      shrinkCapacity(layout.items, sizes, target),
      growthCapacity(layout.items, sizes, receivers),
    );
    shrink(layout.items, sizes, target, amount);
    grow(layout.items, sizes, receivers, amount);
  }

  return buildLayout(layout.panes, sizes, layout.containerSize);
}

export function createSplitSizeSnapshot(layout: SplitLayout): Record<string, number> {
  return Object.fromEntries(layout.panes.map((pane) => [pane.id, pane.size]));
}

export function parsePaneSize(
  value: PaneSizeValue | undefined,
  containerSize: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.endsWith("px")) {
    return Number.parseFloat(trimmed);
  }
  if (trimmed.endsWith("%")) {
    return (Number.parseFloat(trimmed) / 100) * containerSize;
  }
  if (trimmed.endsWith("fr")) {
    return undefined;
  }

  return undefined;
}

function resolveInitialSizes(panes: ResolvedPane[], containerSize: number): number[] {
  const sizes = Array.from<number>({ length: panes.length }).fill(0);
  let fixedTotal = 0;
  let totalFr = 0;

  panes.forEach((pane, index) => {
    const parsed = parsePaneSize(pane.defaultSize, containerSize);
    if (parsed !== undefined) {
      sizes[index] = clamp(parsed, pane.minSize, pane.maxSize);
      fixedTotal += sizes[index]!;
      return;
    }

    totalFr += readFraction(pane.defaultSize);
  });

  const remaining = Math.max(0, containerSize - fixedTotal);
  panes.forEach((pane, index) => {
    if (sizes[index]! > 0) {
      return;
    }
    const fraction = readFraction(pane.defaultSize);
    sizes[index] = totalFr > 0 ? (remaining * fraction) / totalFr : remaining / panes.length;
  });

  return reconcileSizes(sizes, panes, containerSize);
}

function reconcileSizes(
  input: readonly number[],
  panes: readonly ResolvedPane[],
  target: number,
): number[] {
  const sizes = input.map((size, index) =>
    clamp(finiteNumber(size, panes[index]!.minSize), panes[index]!.minSize, panes[index]!.maxSize),
  );
  let delta = target - sizes.reduce(sum, 0);

  if (Math.abs(delta) < EPSILON) {
    return sizes;
  }

  const orderedIndexes = panes
    .map((pane, index) => ({ index, priority: pane.priority }))
    .toSorted((a, b) => b.priority - a.priority)
    .map((item) => item.index);

  if (delta > 0) {
    delta -= grow(panes, sizes, orderedIndexes, delta);
  } else {
    delta += shrink(panes, sizes, orderedIndexes, Math.abs(delta));
  }

  return sizes;
}

function buildLayout(
  panes: readonly ResolvedPane[],
  sizes: readonly number[],
  containerSize: number,
): SplitLayout {
  let offset = 0;
  let visibleIndex = 0;
  const panesWithLayout = panes.map((pane) => {
    if (!pane.visible) {
      return {
        ...pane,
        offset: 0,
        size: pane.collapsedSize,
        visible: false,
      };
    }

    const size = roundSize(sizes[visibleIndex]!);
    visibleIndex += 1;
    const item = { ...pane, size, offset: roundSize(offset), visible: true };
    offset += size;
    return item;
  });
  const items = panesWithLayout.filter(isVisiblePaneLayout);

  return {
    containerSize,
    contentSize: roundSize(offset),
    items,
    offsets: items.map((item) => item.offset),
    panes: panesWithLayout,
    sizeById: Object.fromEntries(panesWithLayout.map((pane) => [pane.id, pane.size])),
    sizes: items.map((item) => item.size),
    visibleIds: items.map((item) => item.id),
  };
}

function resolveDefaultSize(
  value: PaneSizeValue | undefined,
  containerSize: number,
  fallbackFr: number,
): number {
  return parsePaneSize(value, containerSize) ?? containerSize * readFraction(value, fallbackFr);
}

function readFraction(value: PaneSizeValue | undefined, fallback = 1): number {
  if (typeof value === "string" && value.trim().endsWith("fr")) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
  return fallback;
}

function resolvePriority(priority: PanePriority | undefined, index: number): number {
  if (typeof priority === "number") {
    return priority;
  }
  if (priority === "high") {
    return 1000 - index;
  }
  if (priority === "low") {
    return -1000 - index;
  }
  return -index;
}

function growthCapacity(
  items: readonly ResolvedPane[],
  sizes: readonly number[],
  indexes: readonly number[],
): number {
  return indexes.reduce(
    (total, index) => total + Math.max(0, items[index]!.maxSize - sizes[index]!),
    0,
  );
}

function shrinkCapacity(
  items: readonly ResolvedPane[],
  sizes: readonly number[],
  indexes: readonly number[],
): number {
  return indexes.reduce(
    (total, index) => total + Math.max(0, sizes[index]! - items[index]!.minSize),
    0,
  );
}

function grow(
  items: readonly ResolvedPane[],
  sizes: number[],
  indexes: readonly number[],
  amount: number,
): number {
  let remaining = amount;
  for (const index of indexes) {
    if (remaining <= EPSILON) {
      break;
    }
    const available = Math.max(0, items[index]!.maxSize - sizes[index]!);
    const applied = Math.min(available, remaining);
    sizes[index] = sizes[index]! + applied;
    remaining -= applied;
  }
  return amount - remaining;
}

function shrink(
  items: readonly ResolvedPane[],
  sizes: number[],
  indexes: readonly number[],
  amount: number,
): number {
  let remaining = amount;
  for (const index of indexes) {
    if (remaining <= EPSILON) {
      break;
    }
    const available = Math.max(0, sizes[index]! - items[index]!.minSize);
    const applied = Math.min(available, remaining);
    sizes[index] = sizes[index]! - applied;
    remaining -= applied;
  }
  return amount - remaining;
}

function reverseRange(start: number, end: number): number[] {
  const indexes: number[] = [];
  for (let index = end; index >= start; index -= 1) {
    indexes.push(index);
  }
  return indexes;
}

function forwardRange(start: number, end: number): number[] {
  const indexes: number[] = [];
  for (let index = start; index <= end; index += 1) {
    indexes.push(index);
  }
  return indexes;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundSize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sum(total: number, value: number): number {
  return total + value;
}

function isVisiblePane(pane: ResolvedPane): boolean {
  return pane.visible;
}

function isVisiblePaneLayout(pane: PaneSnapshot): pane is PaneLayoutItem {
  return pane.visible;
}
