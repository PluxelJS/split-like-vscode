/* oxlint-disable react/refs -- Stable refs back the imperative workbench action and layout APIs. */
import {
  WORKBENCH_PARTS as CORE_WORKBENCH_PARTS,
  activateWorkbenchView,
  createEditorArrangement,
  createWorkbenchValue,
  getActiveWorkbenchView,
  moveEditorGridGroup,
  moveEditorTab as moveEditorArrangementTab,
  normalizeEditorArrangement,
  normalizeEditorGridLayout,
  setWorkbenchPartVisibility,
  validateEditorGridLayout,
  createSplitSizeSnapshot,
  type EditorGridDirection,
  type EditorGridLayout,
  type EditorArrangement,
  type MoveEditorTabOptions,
  type MoveEditorGridGroupOptions,
  type PaneSizeValue,
  type SplitLayout,
  type WorkbenchPart as CoreWorkbenchPart,
  type WorkbenchValue as CoreWorkbenchValue,
} from "@worksplit/core";
import {
  createElement,
  Fragment,
  isValidElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from "react";

import { beginEditorTabDrag as startEditorTabDrag, type EditorTabDragHandle } from "./editor-drag";
import {
  Pane,
  SplitView,
  type SplitViewCollapsedRenderInfo,
  type SplitViewHandle,
  type SplitViewLayoutEvent,
  type SplitViewPaneVisibilityChange,
} from "./split-view";
import {
  cloneAreaSizeSnapshot,
  createPublicValueSnapshot,
  normalizeLayout,
  readCurrentAreaSizes,
  readStartupLayout,
  sameWorkbenchValue,
  toCoreValue,
  toCoreValueSnapshot,
  toPublicValue,
  type WorkbenchAreaLayoutId,
  type WorkbenchAreaSizeSnapshot,
  type WorkbenchLayout,
  type WorkbenchPanelPosition,
  type WorkbenchPart,
  type WorkbenchValue,
} from "./workbench-model";

export { WORKBENCH_PARTS } from "./workbench-model";
export type {
  WorkbenchAreaLayoutId,
  WorkbenchAreaSizeSnapshot,
  WorkbenchLayout,
  WorkbenchPanelPosition,
  WorkbenchPart,
  WorkbenchValue,
  WorkbenchValueSnapshot,
} from "./workbench-model";

export type WorkbenchEditorLayout = EditorGridLayout;
export type WorkbenchEditorGroupDirection = EditorGridDirection;
export type WorkbenchEditorGroupMoveOptions = MoveEditorGridGroupOptions;
export type WorkbenchEditorArrangement = EditorArrangement;
export type WorkbenchEditorTabMoveOptions = MoveEditorTabOptions;

export type WorkbenchIcon = ReactNode | ElementType<{ className?: string; size?: number }>;

export interface WorkbenchViewSize {
  min?: number;
  max?: number;
  default?: PaneSizeValue;
}

export interface WorkbenchActions {
  activateView(id: string): void;
  activateEditorTab(groupId: string, tabId: string): void;
  moveEditorTab(options: WorkbenchEditorTabMoveOptions): void;
  equalizeEditorGroups(): void;
  hidePart(part: WorkbenchPart): void;
  maximizeEditorGroup(groupId: string): void;
  moveEditorGroup(options: WorkbenchEditorGroupMoveOptions): void;
  showPart(part: WorkbenchPart): void;
  restoreEditorGroups(): void;
  togglePart(part: WorkbenchPart): void;
  toggleView(id: string): void;
  setPanelPosition(position: WorkbenchPanelPosition): void;
  togglePanelPosition(): void;
  toggleEditorGroupMaximized(groupId: string): void;
  resetLayout(): void;
  runCommand(id: string): boolean;
}

export interface WorkbenchViewContentContext {
  actions: WorkbenchActions;
  active: boolean;
  icon: ReactNode;
  part: WorkbenchPart;
  value: WorkbenchValue;
  view: WorkbenchView;
  visible: boolean;
}

export interface WorkbenchView {
  id: string;
  part: WorkbenchPart;
  title?: string;
  order?: number;
  defaultActive?: boolean;
  defaultVisible?: boolean;
  renderContent(context: WorkbenchViewContentContext): ReactNode;
  icon?: WorkbenchIcon;
  activityGroup?: "main" | "footer";
  className?: string;
  meta?: Record<string, unknown>;
}

export interface WorkbenchEditorTabContentContext {
  actions: WorkbenchActions;
  active: boolean;
  group: WorkbenchEditorGroup;
  icon: ReactNode;
  tab: WorkbenchEditorTab;
  value: WorkbenchValue;
}

export interface WorkbenchEditorTab {
  id: string;
  title?: string;
  icon?: WorkbenchIcon;
  renderContent(context: WorkbenchEditorTabContentContext): ReactNode;
  className?: string;
  meta?: Record<string, unknown>;
}

export interface WorkbenchEditorGroup {
  id: string;
  title?: string;
  order?: number;
  defaultActiveTabId?: string;
  showTabs?: boolean;
  tabs: readonly WorkbenchEditorTab[];
  className?: string;
  size?: WorkbenchViewSize;
  meta?: Record<string, unknown>;
}

export interface WorkbenchEditorTabLabelRenderInfo {
  actions: WorkbenchActions;
  active: boolean;
  group: WorkbenchEditorGroup;
  icon: ReactNode;
  tab: WorkbenchEditorTab;
  value: WorkbenchValue;
}

export interface WorkbenchEditorTabRenderInfo extends WorkbenchEditorTabLabelRenderInfo {
  tabProps: ButtonHTMLAttributes<HTMLButtonElement> & {
    "aria-controls": string;
    "aria-selected": boolean;
    "data-worksplit-editor-tab": string;
    id: string;
    role: "tab";
  };
}

export interface WorkbenchEditorTabContextMenuInfo extends WorkbenchEditorTabLabelRenderInfo {
  index: number;
}

export type WorkbenchPartSize = WorkbenchViewSize;

export interface WorkbenchActivityItemRenderInfo {
  actions: WorkbenchActions;
  view: WorkbenchView;
  part: WorkbenchPart;
  active: boolean;
  icon: ReactNode;
  visible: boolean;
  value: WorkbenchValue;
}

export interface WorkbenchPartRenderInfo {
  actions: WorkbenchActions;
  icon: ReactNode;
  part: WorkbenchPart;
  view: WorkbenchView;
  visible: boolean;
  value: WorkbenchValue;
}

export interface WorkbenchCollapsedPartRenderInfo {
  actions: WorkbenchActions;
  icon: ReactNode;
  part: WorkbenchPart;
  view?: WorkbenchView | undefined;
  split: SplitViewCollapsedRenderInfo;
  value: WorkbenchValue;
}

export interface WorkbenchHandle extends WorkbenchActions {
  getValue(): WorkbenchValue;
  getLayout(): WorkbenchLayout;
  restoreLayout(layout: WorkbenchLayout): void;
  getAreaLayout(id: WorkbenchAreaLayoutId): ReturnType<SplitViewHandle["getLayout"]>;
}

export interface WorkbenchCommandContext extends WorkbenchHandle {}

export interface WorkbenchCommand {
  id: string;
  title?: string;
  keybindings?: readonly string[];
  run(context: WorkbenchCommandContext): void;
}

interface WorkbenchBaseProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "defaultValue" | "onChange"
> {
  views?: readonly WorkbenchView[];
  showActivityBar?: boolean | "auto";
  commands?: readonly WorkbenchCommand[];
  defaultLayout?: WorkbenchLayout;
  value?: WorkbenchValue;
  storageKey?: string;
  partSizes?: Partial<Record<WorkbenchPart, WorkbenchPartSize>>;
  centerMinSize?: number;
  editorGroupMinSize?: number;
  onLayout?: (layout: WorkbenchLayout) => void;
  onValueChange?: (value: WorkbenchValue) => void;
  editorArrangement?: WorkbenchEditorArrangement;
  onEditorArrangementChange?: (arrangement: WorkbenchEditorArrangement) => void;
  /** Vetoes the complete candidate before pointer feedback or an imperative tab move. */
  canMoveEditorTab?: (
    options: WorkbenchEditorTabMoveOptions,
    nextArrangement: WorkbenchEditorArrangement,
  ) => boolean;
  renderActivityItem?: (info: WorkbenchActivityItemRenderInfo) => ReactNode;
  renderEditorTabLabel?: (info: WorkbenchEditorTabLabelRenderInfo) => ReactNode;
  renderEditorTab?: (info: WorkbenchEditorTabRenderInfo) => ReactNode;
  onEditorTabContextMenu?: (
    info: WorkbenchEditorTabContextMenuInfo,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  renderPartHeader?: (info: WorkbenchPartRenderInfo) => ReactNode;
  renderCollapsedPart?: (info: WorkbenchCollapsedPartRenderInfo) => ReactNode;
}

export type WorkbenchProps =
  | (WorkbenchBaseProps & {
      editor: ReactNode;
      editorGroups?: never;
      editorTabs?: never;
    })
  | (WorkbenchBaseProps & {
      editor?: never;
      editorGroups: readonly WorkbenchEditorGroup[];
      editorTabs?: never;
    })
  | (WorkbenchBaseProps & {
      editor?: never;
      editorGroups?: never;
      editorTabs: readonly WorkbenchEditorTab[];
    });

interface WorkbenchResolvedView extends Omit<WorkbenchView, "part"> {
  part: CoreWorkbenchPart;
}

const PART_PANE_ID: Record<CoreWorkbenchPart, string> = {
  panel: "workbench:panel",
  primary: "workbench:primary",
  secondary: "workbench:secondary",
};

const PANE_PART = new Map<string, CoreWorkbenchPart>(
  CORE_WORKBENCH_PARTS.map((part) => [PART_PANE_ID[part], part]),
);

const DEFAULT_PART_SIZES: Record<CoreWorkbenchPart, Required<WorkbenchPartSize>> = {
  panel: { default: 220, max: 480, min: 120 },
  primary: { default: 280, max: 560, min: 170 },
  secondary: { default: 320, max: 560, min: 220 },
};

const DEFAULT_WORKBENCH_COMMANDS: readonly WorkbenchCommand[] = [
  {
    id: "workbench.action.toggleSidebarVisibility",
    keybindings: ["mod+b"],
    title: "Toggle Primary Side Bar",
    run: (context) => context.togglePart("primary"),
  },
  {
    id: "workbench.action.togglePanel",
    keybindings: ["mod+j"],
    title: "Toggle Panel",
    run: (context) => context.togglePart("panel"),
  },
  {
    id: "workbench.action.toggleAuxiliaryBar",
    keybindings: ["mod+alt+b"],
    title: "Toggle Secondary Side Bar",
    run: (context) => context.togglePart("secondary"),
  },
  {
    id: "workbench.action.togglePanelPosition",
    keybindings: ["mod+shift+j"],
    title: "Toggle Panel Position",
    run: (context) => context.togglePanelPosition(),
  },
  {
    id: "workbench.action.resetLayout",
    keybindings: ["mod+shift+0"],
    title: "Reset Layout",
    run: (context) => context.resetLayout(),
  },
];

export const Workbench = forwardRef<WorkbenchHandle, WorkbenchProps>(
  function Workbench(props, ref) {
    const {
      showActivityBar = "auto",
      className,
      commands,
      defaultLayout,
      editor,
      editorArrangement: controlledEditorArrangement,
      canMoveEditorTab,
      editorGroups,
      editorTabs,
      centerMinSize = 320,
      editorGroupMinSize = centerMinSize,
      onLayout,
      onEditorArrangementChange,
      onEditorTabContextMenu,
      onValueChange,
      partSizes,
      renderActivityItem,
      renderCollapsedPart,
      renderEditorTab,
      renderEditorTabLabel,
      renderPartHeader,
      value,
      storageKey,
      tabIndex,
      views = [],
      ...rest
    } = props;

    const mainSplitRef = useRef<SplitViewHandle>(null);
    const centerSplitRef = useRef<SplitViewHandle>(null);
    const editorGroupsSplitRef = useRef<SplitViewHandle>(null);
    const publishedLayoutRef = useRef<{ key: string | undefined; value: string } | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const accessibilityId = useId().replaceAll(":", "");
    const orderedViews = useMemo(
      () => orderViews(validateWorkbenchViews(views).map(normalizeView)),
      [views],
    );
    const showActivity =
      showActivityBar === true || (showActivityBar === "auto" && orderedViews.length > 0);
    const descriptorGroups = useMemo(
      () =>
        editorTabs
          ? []
          : validateEditorGroups(orderViews(createEditorGroups(editorGroups, editor))),
      [editor, editorGroups, editorTabs],
    );
    const editorTabCatalog = useMemo(
      () => validateEditorTabCatalog(editorTabs ?? descriptorGroups.flatMap((group) => group.tabs)),
      [descriptorGroups, editorTabs],
    );
    const editorTabIds = useMemo(() => editorTabCatalog.map((tab) => tab.id), [editorTabCatalog]);
    const initialArrangement = useMemo(
      () => createArrangementFromDescriptors(descriptorGroups, editorTabs),
      [descriptorGroups, editorTabs],
    );
    const editorGroupIds = useMemo(
      () => initialArrangement.groups.map((group) => group.id),
      [initialArrangement],
    );
    const defaultLayoutRef = useRef(defaultLayout);
    const initialArrangementRef = useRef(initialArrangement);
    const editorTabIdsRef = useRef(editorTabIds);
    initialArrangementRef.current = initialArrangement;
    editorTabIdsRef.current = editorTabIds;
    const defaultLayoutValidatedRef = useRef(false);
    if (!defaultLayoutValidatedRef.current) {
      if (defaultLayoutRef.current?.editorLayout) {
        validateEditorGridLayout(defaultLayoutRef.current.editorLayout, editorGroupIds);
      }
      defaultLayoutValidatedRef.current = true;
    }
    const startupLayoutRef = useRef<WorkbenchLayout | null>(null);
    startupLayoutRef.current ??= readStartupLayout(
      storageKey,
      defaultLayout,
      editorGroupIds,
      editorTabIds,
    );
    const startupLayout = startupLayoutRef.current;
    const areaSizeSnapshotRef = useRef<WorkbenchAreaSizeSnapshot>(
      startupLayout.areaSizes ? cloneAreaSizeSnapshot(startupLayout.areaSizes) : {},
    );
    const [uncontrolledValue, setUncontrolledValue] = useState(() =>
      createWorkbenchValue(orderedViews, toCoreValueSnapshot(startupLayout.value)),
    );
    const [uncontrolledEditorArrangement, setUncontrolledEditorArrangement] = useState(() =>
      startupLayout.editorArrangement
        ? normalizeEditorArrangement(startupLayout.editorArrangement, editorTabIds)
        : createLegacyStartupArrangement(initialArrangement, startupLayout),
    );
    const [uncontrolledPanelPosition, setUncontrolledPanelPosition] =
      useState<WorkbenchPanelPosition>(startupLayout.panelPosition);
    const [layoutVersion, setLayoutVersion] = useState(0);
    const controlledValue = useMemo(() => (value ? toCoreValue(value) : undefined), [value]);
    const currentValue = controlledValue ?? uncontrolledValue;
    const currentEditorArrangement = useMemo(
      () =>
        controlledEditorArrangement
          ? normalizeEditorArrangement(controlledEditorArrangement, editorTabIds)
          : normalizeEditorArrangement(uncontrolledEditorArrangement, editorTabIds),
      [controlledEditorArrangement, editorTabIds, uncontrolledEditorArrangement],
    );
    const currentActiveEditorTabs = useMemo(
      () => activeTabsFromArrangement(currentEditorArrangement),
      [currentEditorArrangement],
    );
    const orderedEditorGroups = useMemo(
      () => materializeEditorGroups(currentEditorArrangement, editorTabCatalog, descriptorGroups),
      [currentEditorArrangement, descriptorGroups, editorTabCatalog],
    );
    const publicValue = useMemo(
      () => toPublicValue(currentValue, currentActiveEditorTabs),
      [currentActiveEditorTabs, currentValue],
    );
    const currentPanelPosition = uncontrolledPanelPosition;
    const currentValueRef = useRef(currentValue);
    const currentEditorArrangementRef = useRef(currentEditorArrangement);
    const currentPanelPositionRef = useRef(currentPanelPosition);
    const editorLayout = currentEditorArrangement.layout;
    const maximizedEditorGroupId = currentEditorArrangement.maximizedGroupId;
    const editorLayoutRef = useRef(editorLayout);
    const maximizedEditorGroupIdRef = useRef(maximizedEditorGroupId);
    const editorSplitRefs = useRef(new Map<string, SplitViewHandle>());
    const pendingValueRef = useRef<CoreWorkbenchValue | undefined>(undefined);
    const pendingEditorArrangementRef = useRef<EditorArrangement | undefined>(undefined);
    const pendingResetScheduledRef = useRef(false);
    const orderedViewsRef = useRef(orderedViews);
    const orderedEditorGroupsRef = useRef(orderedEditorGroups);
    const controlledValueRef = useRef(value !== undefined);
    const controlledEditorArrangementRef = useRef(controlledEditorArrangement !== undefined);
    const onEditorArrangementChangeRef = useRef(onEditorArrangementChange);
    const canMoveEditorTabRef = useRef(canMoveEditorTab);
    const onValueChangeRef = useRef(onValueChange);
    const onLayoutRef = useRef(onLayout);
    const storageKeyRef = useRef(storageKey);

    currentValueRef.current = currentValue;
    currentEditorArrangementRef.current = currentEditorArrangement;
    currentPanelPositionRef.current = currentPanelPosition;
    editorLayoutRef.current = editorLayout;
    maximizedEditorGroupIdRef.current = maximizedEditorGroupId;
    orderedViewsRef.current = orderedViews;
    orderedEditorGroupsRef.current = orderedEditorGroups;
    controlledValueRef.current = value !== undefined;
    controlledEditorArrangementRef.current = controlledEditorArrangement !== undefined;
    onEditorArrangementChangeRef.current = onEditorArrangementChange;
    canMoveEditorTabRef.current = canMoveEditorTab;
    onValueChangeRef.current = onValueChange;
    onLayoutRef.current = onLayout;
    storageKeyRef.current = storageKey;

    const schedulePendingReset = useCallback(() => {
      if (pendingResetScheduledRef.current) {
        return;
      }
      pendingResetScheduledRef.current = true;
      queueMicrotask(() => {
        pendingResetScheduledRef.current = false;
        pendingValueRef.current = undefined;
        pendingEditorArrangementRef.current = undefined;
      });
    }, []);

    const readActionValue = useCallback(
      () => pendingValueRef.current ?? currentValueRef.current,
      [],
    );
    const readActionEditorArrangement = useCallback(
      () => pendingEditorArrangementRef.current ?? currentEditorArrangementRef.current,
      [],
    );

    const commitValue = useCallback(
      (next: CoreWorkbenchValue) => {
        const previousValue = readActionValue();
        if (sameWorkbenchValue(next, previousValue)) {
          return;
        }
        if (controlledValueRef.current) {
          pendingValueRef.current = next;
          schedulePendingReset();
        } else {
          currentValueRef.current = next;
          setUncontrolledValue(next);
        }
        onValueChangeRef.current?.(
          toPublicValue(next, activeTabsFromArrangement(readActionEditorArrangement())),
        );
      },
      [readActionEditorArrangement, readActionValue, schedulePendingReset],
    );

    const commitEditorArrangement = useCallback(
      (next: EditorArrangement) => {
        const previous = readActionEditorArrangement();
        if (sameEditorArrangement(next, previous)) {
          return;
        }
        if (controlledEditorArrangementRef.current) {
          pendingEditorArrangementRef.current = next;
          schedulePendingReset();
        } else {
          currentEditorArrangementRef.current = next;
          setUncontrolledEditorArrangement(next);
        }
        onEditorArrangementChangeRef.current?.(next);
        onValueChangeRef.current?.(
          toPublicValue(readActionValue(), activeTabsFromArrangement(next)),
        );
      },
      [readActionEditorArrangement, readActionValue, schedulePendingReset],
    );

    const createLayout = useCallback(
      (
        nextValue = currentValueRef.current,
        nextPanelPosition = currentPanelPositionRef.current,
        nextArrangement = currentEditorArrangementRef.current,
      ): WorkbenchLayout => ({
        panelPosition: nextPanelPosition,
        areaSizes: readCurrentAreaSizes(
          mainSplitRef.current?.getLayout() ?? null,
          centerSplitRef.current?.getLayout() ?? null,
          editorGroupsSplitRef.current?.getLayout() ?? null,
          areaSizeSnapshotRef.current,
        ),
        editorArrangement: {
          ...nextArrangement,
          layout: snapshotEditorGridLayout(nextArrangement.layout, editorSplitRefs.current),
        },
        editorLayout: snapshotEditorGridLayout(nextArrangement.layout, editorSplitRefs.current),
        maximizedEditorGroupId: nextArrangement.maximizedGroupId,
        version: 1,
        value: createPublicValueSnapshot(nextValue, activeTabsFromArrangement(nextArrangement)),
      }),
      [],
    );

    const publishLayout = useCallback(
      (nextLayout: WorkbenchLayout, options: { notify?: boolean; persist?: boolean } = {}) => {
        const { notify = true, persist = true } = options;
        const serializedLayout = JSON.stringify(nextLayout);
        const currentStorageKey = storageKeyRef.current;
        const alreadyPersisted =
          publishedLayoutRef.current?.key === currentStorageKey &&
          publishedLayoutRef.current?.value === serializedLayout;
        if (persist && !alreadyPersisted) {
          publishedLayoutRef.current = { key: currentStorageKey, value: serializedLayout };
        }
        if (persist && !alreadyPersisted && currentStorageKey && typeof window !== "undefined") {
          try {
            window.localStorage.setItem(currentStorageKey, serializedLayout);
          } catch {
            // Layout persistence is best-effort and must never break workspace interaction.
          }
        }
        if (notify) {
          onLayoutRef.current?.(nextLayout);
        }
      },
      [],
    );

    const commitPanelPosition = useCallback((position: WorkbenchPanelPosition) => {
      currentPanelPositionRef.current = position;
      setUncontrolledPanelPosition(position);
    }, []);

    useEffect(() => {
      const reconciled = createWorkbenchValue(orderedViews, currentValue);
      if (!sameWorkbenchValue(reconciled, currentValue)) {
        commitValue(reconciled);
      }
    }, [commitValue, currentValue, orderedViews]);

    useEffect(() => {
      const reconciled = normalizeEditorArrangement(currentEditorArrangement, editorTabIds);
      if (!sameEditorArrangement(reconciled, currentEditorArrangement)) {
        commitEditorArrangement(reconciled);
      }
    }, [commitEditorArrangement, currentEditorArrangement, editorTabIds]);

    useEffect(
      () =>
        publishLayout(createLayout(currentValue, currentPanelPosition, currentEditorArrangement)),
      [createLayout, currentEditorArrangement, currentPanelPosition, currentValue, publishLayout],
    );

    const showPart = useCallback(
      (part: WorkbenchPart) =>
        commitValue(setWorkbenchPartVisibility(readActionValue(), part, true)),
      [commitValue, readActionValue],
    );

    const hidePart = useCallback(
      (part: WorkbenchPart) =>
        commitValue(setWorkbenchPartVisibility(readActionValue(), part, false)),
      [commitValue, readActionValue],
    );

    const activateView = useCallback(
      (id: string) =>
        commitValue(activateWorkbenchView(orderedViewsRef.current, readActionValue(), id)),
      [commitValue, readActionValue],
    );

    const toggleView = useCallback(
      (id: string) => {
        const currentViews = orderedViewsRef.current;
        const current = readActionValue();
        const view = currentViews.find((item) => item.id === id);
        if (!view) {
          return;
        }
        const active = current.activeByPart[view.part] === id;
        const visible = current.visibleParts[view.part];
        commitValue(activateWorkbenchView(currentViews, current, id, !(active && visible)));
      },
      [commitValue, readActionValue],
    );

    const togglePart = useCallback(
      (part: WorkbenchPart) => {
        const current = readActionValue();
        commitValue(setWorkbenchPartVisibility(current, part, !current.visibleParts[part]));
      },
      [commitValue, readActionValue],
    );

    const activateEditorTab = useCallback(
      (groupId: string, tabId: string) => {
        const current = readActionEditorArrangement();
        const groupIndex = current.groups.findIndex((group) => group.id === groupId);
        const group = current.groups[groupIndex];
        if (!group?.tabIds.includes(tabId) || group.activeTabId === tabId) {
          return;
        }
        const groups = [...current.groups];
        groups[groupIndex] = { ...group, activeTabId: tabId };
        commitEditorArrangement({ ...current, groups });
      },
      [commitEditorArrangement, readActionEditorArrangement],
    );

    const commitEditorLayout = useCallback(
      (next: EditorGridLayout | undefined) => {
        const current = readActionEditorArrangement();
        if (sameEditorGridLayout(next, current.layout)) {
          return;
        }
        commitEditorArrangement({ ...current, layout: next });
      },
      [commitEditorArrangement, readActionEditorArrangement],
    );

    const moveEditorGroup = useCallback(
      (options: WorkbenchEditorGroupMoveOptions) => {
        commitEditorLayout(moveEditorGridGroup(readActionEditorArrangement().layout, options));
      },
      [commitEditorLayout, readActionEditorArrangement],
    );

    const resolveEditorTabMove = useCallback(
      (options: WorkbenchEditorTabMoveOptions): WorkbenchEditorArrangement | null => {
        const current = readActionEditorArrangement();
        const next = moveEditorArrangementTab(current, options);
        if (
          next === current ||
          (canMoveEditorTabRef.current && !canMoveEditorTabRef.current(options, next))
        ) {
          return null;
        }
        return next;
      },
      [readActionEditorArrangement],
    );

    const moveEditorTab = useCallback(
      (options: WorkbenchEditorTabMoveOptions) => {
        const next = resolveEditorTabMove(options);
        if (next) {
          commitEditorArrangement(next);
        }
      },
      [commitEditorArrangement, resolveEditorTabMove],
    );

    const maximizeEditorGroup = useCallback(
      (groupId: string) => {
        const current = readActionEditorArrangement();
        if (
          current.maximizedGroupId === groupId ||
          !editorLayoutContainsGroup(current.layout, groupId)
        ) {
          return;
        }
        commitEditorArrangement({ ...current, maximizedGroupId: groupId });
      },
      [commitEditorArrangement, readActionEditorArrangement],
    );

    const restoreEditorGroups = useCallback(() => {
      const current = readActionEditorArrangement();
      if (current.maximizedGroupId) {
        commitEditorArrangement({ ...current, maximizedGroupId: undefined });
      }
    }, [commitEditorArrangement, readActionEditorArrangement]);

    const toggleEditorGroupMaximized = useCallback(
      (groupId: string) => {
        if (maximizedEditorGroupIdRef.current === groupId) {
          restoreEditorGroups();
          return;
        }
        maximizeEditorGroup(groupId);
      },
      [maximizeEditorGroup, restoreEditorGroups],
    );

    const equalizeEditorGroups = useCallback(() => {
      for (const split of editorSplitRefs.current.values()) {
        const splitLayout = split.getLayout();
        if (!splitLayout || splitLayout.items.length < 2) {
          continue;
        }
        const size = splitLayout.contentSize / splitLayout.items.length;
        split.setPaneSizes(Object.fromEntries(splitLayout.items.map((item) => [item.id, size])));
      }
    }, []);

    const setPanelPosition = useCallback(
      (position: WorkbenchPanelPosition) => {
        if (position !== currentPanelPositionRef.current) {
          commitPanelPosition(position);
          setLayoutVersion((version) => version + 1);
        }
      },
      [commitPanelPosition],
    );

    const togglePanelPosition = useCallback(() => {
      setPanelPosition(currentPanelPositionRef.current === "bottom" ? "right" : "bottom");
    }, [setPanelPosition]);

    const restoreLayout = useCallback(
      (layout: WorkbenchLayout) => {
        const previousValue = currentValueRef.current;
        const previousPanelPosition = currentPanelPositionRef.current;
        const currentEditorGroupIds = readActionEditorArrangement().groups.map((group) => group.id);
        const normalized = normalizeLayout(
          layout,
          undefined,
          previousPanelPosition,
          currentEditorGroupIds,
          editorTabIdsRef.current,
        );
        areaSizeSnapshotRef.current = cloneAreaSizeSnapshot(normalized.areaSizes ?? {});
        const nextValue = createWorkbenchValue(
          orderedViewsRef.current,
          toCoreValueSnapshot(normalized.value),
        );
        const nextPanelPosition = normalized.panelPosition;
        const nextArrangement = normalized.editorArrangement
          ? normalizeEditorArrangement(normalized.editorArrangement, editorTabIdsRef.current)
          : createLegacyStartupArrangement(initialArrangementRef.current, normalized);

        if (controlledValueRef.current) {
          pendingValueRef.current = nextValue;
          schedulePendingReset();
        } else {
          currentValueRef.current = nextValue;
          if (!sameWorkbenchValue(nextValue, previousValue)) {
            setUncontrolledValue(nextValue);
          }
        }
        if (!sameWorkbenchValue(nextValue, previousValue)) {
          onValueChangeRef.current?.(
            toPublicValue(nextValue, activeTabsFromArrangement(nextArrangement)),
          );
        }
        commitEditorArrangement(nextArrangement);
        currentPanelPositionRef.current = nextPanelPosition;
        if (nextPanelPosition !== previousPanelPosition) {
          setUncontrolledPanelPosition(nextPanelPosition);
        }
        setLayoutVersion((version) => version + 1);
      },
      [commitEditorArrangement, readActionEditorArrangement, schedulePendingReset],
    );

    const resetLayout = useCallback(() => {
      const currentEditorGroupIds = orderedEditorGroupsRef.current.map((group) => group.id);
      restoreLayout(
        normalizeLayout(
          defaultLayoutRef.current,
          undefined,
          "bottom",
          currentEditorGroupIds,
          editorTabIdsRef.current,
        ),
      );
    }, [restoreLayout]);

    const commandRegistry = useMemo(() => createCommandRegistry(commands), [commands]);

    const runCommand = useCallback(
      function executeCommand(id: string): boolean {
        const command = commandRegistry.find((item) => item.id === id);
        if (!command) {
          return false;
        }

        command.run(
          createCommandContext({
            activateEditorTab,
            activateView,
            createLayout,
            equalizeEditorGroups,
            publicValue: toPublicValue(
              currentValueRef.current,
              activeTabsFromArrangement(currentEditorArrangementRef.current),
            ),
            hidePart,
            maximizeEditorGroup,
            moveEditorGroup,
            moveEditorTab,
            resetLayout,
            restoreEditorGroups,
            restoreLayout,
            runCommand: executeCommand,
            setPanelPosition,
            showPart,
            togglePanelPosition,
            toggleEditorGroupMaximized,
            togglePart,
            toggleView,
            centerSplitRef,
            editorGroupsSplitRef,
            mainSplitRef,
          }),
        );
        return true;
      },
      [
        activateEditorTab,
        activateView,
        commandRegistry,
        createLayout,
        equalizeEditorGroups,
        hidePart,
        maximizeEditorGroup,
        moveEditorGroup,
        moveEditorTab,
        resetLayout,
        restoreEditorGroups,
        restoreLayout,
        setPanelPosition,
        showPart,
        togglePanelPosition,
        toggleEditorGroupMaximized,
        togglePart,
        toggleView,
      ],
    );

    useImperativeHandle(
      ref,
      () => ({
        activateEditorTab,
        activateView,
        equalizeEditorGroups,
        getLayout: createLayout,
        getAreaLayout: (id) =>
          readAreaLayout(id, mainSplitRef, centerSplitRef, editorGroupsSplitRef),
        getValue: () =>
          toPublicValue(
            currentValueRef.current,
            activeTabsFromArrangement(currentEditorArrangementRef.current),
          ),
        hidePart,
        maximizeEditorGroup,
        moveEditorGroup,
        moveEditorTab,
        resetLayout,
        restoreEditorGroups,
        restoreLayout,
        runCommand,
        setPanelPosition,
        showPart,
        togglePanelPosition,
        toggleEditorGroupMaximized,
        togglePart,
        toggleView,
      }),
      [
        activateEditorTab,
        activateView,
        createLayout,
        equalizeEditorGroups,
        hidePart,
        maximizeEditorGroup,
        moveEditorGroup,
        moveEditorTab,
        resetLayout,
        restoreEditorGroups,
        restoreLayout,
        runCommand,
        setPanelPosition,
        showPart,
        togglePanelPosition,
        toggleEditorGroupMaximized,
        togglePart,
        toggleView,
      ],
    );

    const actions = useMemo<WorkbenchActions>(
      () => ({
        activateEditorTab,
        activateView,
        equalizeEditorGroups,
        hidePart,
        maximizeEditorGroup,
        moveEditorGroup,
        moveEditorTab,
        resetLayout,
        restoreEditorGroups,
        runCommand,
        setPanelPosition,
        showPart,
        togglePanelPosition,
        toggleEditorGroupMaximized,
        togglePart,
        toggleView,
      }),
      [
        activateEditorTab,
        activateView,
        equalizeEditorGroups,
        hidePart,
        maximizeEditorGroup,
        moveEditorGroup,
        moveEditorTab,
        resetLayout,
        restoreEditorGroups,
        runCommand,
        setPanelPosition,
        showPart,
        togglePanelPosition,
        toggleEditorGroupMaximized,
        togglePart,
        toggleView,
      ],
    );

    const rootClassName = [
      "worksplit-workbench",
      showActivity ? "worksplit-workbench-with-activity" : "",
      `worksplit-workbench-panel-${currentPanelPosition}`,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const handleDocumentKeyDown = useCallback(
      (event: KeyboardEvent) => {
        const root = rootRef.current;
        if (
          !root ||
          !(event.target instanceof Node) ||
          !root.contains(event.target) ||
          event.defaultPrevented ||
          isEditableTarget(event.target)
        ) {
          return;
        }

        const command = commandRegistry.find((item) => {
          return item.keybindings?.some((keybinding) => matchKeybinding(event, keybinding));
        });
        if (!command) {
          return;
        }

        event.preventDefault();
        runCommand(command.id);
      },
      [commandRegistry, runCommand],
    );
    const handleDocumentKeyDownRef = useRef(handleDocumentKeyDown);
    handleDocumentKeyDownRef.current = handleDocumentKeyDown;

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => handleDocumentKeyDownRef.current(event);
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    const editorTabDragRef = useRef<EditorTabDragHandle | null>(null);
    const nextEditorGroupIdRef = useRef(1);
    const suppressEditorTabClickRef = useRef(false);
    const suppressEditorTabClickTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );

    useEffect(() => {
      // Consumer renders can change tab wrappers or geometry without changing placement.
      editorTabDragRef.current?.invalidateGeometry();
    });

    useEffect(
      () => () => {
        editorTabDragRef.current?.cancel();
        clearTimeout(suppressEditorTabClickTimerRef.current);
      },
      [],
    );

    const beginEditorTabDrag = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>, groupId: string, tabId: string) => {
        if (event.button !== 0 || event.defaultPrevented || !rootRef.current) {
          return;
        }
        editorTabDragRef.current?.cancel();
        clearTimeout(suppressEditorTabClickTimerRef.current);
        suppressEditorTabClickRef.current = false;
        const arrangement = readActionEditorArrangement();
        let newGroupId: string;
        do {
          newGroupId = `group-${accessibilityId}-${nextEditorGroupIdRef.current++}`;
        } while (arrangement.groups.some((group) => group.id === newGroupId));
        const tab = orderedEditorGroupsRef.current
          .find((group) => group.id === groupId)
          ?.tabs.find((candidate) => candidate.id === tabId);
        editorTabDragRef.current = startEditorTabDrag(rootRef.current, {
          clientX: event.clientX,
          clientY: event.clientY,
          newGroupId,
          pointerId: event.pointerId,
          sourceGroupId: groupId,
          tabId,
          title: tab?.title ?? tabId,
          readArrangement: readActionEditorArrangement,
          resolveMove: resolveEditorTabMove,
          onDrop: (_options, next) => commitEditorArrangement(next),
          onDragStart: () => {
            suppressEditorTabClickRef.current = true;
          },
          onDragEnd: (dragged) => {
            editorTabDragRef.current = null;
            if (!dragged) {
              suppressEditorTabClickRef.current = false;
            } else {
              suppressEditorTabClickTimerRef.current = setTimeout(() => {
                suppressEditorTabClickRef.current = false;
              }, 0);
            }
          },
        });
      },
      [accessibilityId, commitEditorArrangement, readActionEditorArrangement, resolveEditorTabMove],
    );

    const renderPartPane = (part: CoreWorkbenchPart) => {
      const view = getActiveWorkbenchView(orderedViews, currentValue, part) as
        | WorkbenchResolvedView
        | undefined;
      const partSize = partSizes?.[part];
      const icon = renderWorkbenchIcon(view?.icon, 16);
      const publicView = view ? toPublicView(view) : undefined;
      const sizing = {
        ...DEFAULT_PART_SIZES[part],
        ...partSize,
        default: partSize?.default ?? DEFAULT_PART_SIZES[part].default,
        max: partSize?.max ?? DEFAULT_PART_SIZES[part].max,
        min: partSize?.min ?? DEFAULT_PART_SIZES[part].min,
      };
      const headerInfo = view
        ? {
            actions,
            icon,
            part,
            value: publicValue,
            view: toPublicView(view),
            visible: currentValue.visibleParts[part],
          }
        : null;
      const renderedHeader =
        headerInfo && renderPartHeader ? renderPartHeader(headerInfo) : undefined;
      const header =
        renderedHeader !== undefined
          ? renderedHeader
          : defaultPartHeader(publicView, () => hidePart(part));
      const hasHeader = header !== null;
      const active = view ? currentValue.activeByPart[part] === view.id : false;
      const visible = currentValue.visibleParts[part] && Boolean(view);
      const renderWorkbenchView = (resolvedView: WorkbenchResolvedView, headerNode: ReactNode) => {
        const viewForConsumer = toPublicView(resolvedView);
        return (
          <>
            {headerNode}
            <div className="worksplit-workbench-view">
              {resolvedView.renderContent({
                actions,
                active,
                icon: renderWorkbenchIcon(resolvedView.icon),
                part,
                value: publicValue,
                view: viewForConsumer,
                visible,
              })}
            </div>
          </>
        );
      };

      return (
        <Pane
          id={PART_PANE_ID[part]}
          key={part}
          minSize={sizing.min}
          maxSize={sizing.max}
          defaultSize={sizing.default}
          visible={currentValue.visibleParts[part] && Boolean(view)}
          snap
          className={[
            "worksplit-workbench-part",
            hasHeader ? "" : "worksplit-workbench-part-headerless",
            `worksplit-workbench-${part}`,
            publicView?.className,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {view && renderWorkbenchView(view, header)}
        </Pane>
      );
    };

    const collapsedPartRenderer = (split: SplitViewCollapsedRenderInfo) => {
      const part = PANE_PART.get(split.id);
      if (!part) {
        return null;
      }

      const view = getActiveWorkbenchView(orderedViews, currentValue, part) as
        | WorkbenchResolvedView
        | undefined;
      const publicView = view ? toPublicView(view) : undefined;
      if (renderCollapsedPart) {
        return renderCollapsedPart({
          actions,
          icon: renderWorkbenchIcon(view?.icon),
          part,
          split,
          value: publicValue,
          view: publicView,
        });
      }

      return (
        <span className="worksplit-workbench-collapsed-part">
          {renderWorkbenchIcon(view?.icon)}
        </span>
      );
    };

    const handlePartVisibility = (event: SplitViewPaneVisibilityChange) => {
      const part = PANE_PART.get(event.id);
      if (part) {
        commitValue(setWorkbenchPartVisibility(currentValue, part, event.visible));
      }
    };

    const handleAreaLayout = (area: WorkbenchAreaLayoutId, event: SplitViewLayoutEvent) => {
      if (event.phase === "start") {
        return;
      }
      areaSizeSnapshotRef.current = {
        ...areaSizeSnapshotRef.current,
        [area]: createSplitSizeSnapshot(event.layout),
      };
      publishLayout(
        createLayout(),
        event.phase === "change" ? { persist: false } : { notify: false },
      );
    };

    const handleEditorSplitLayout = (
      splitId: string,
      event: SplitViewLayoutEvent,
      root: boolean,
    ) => {
      if (event.phase === "start") {
        return;
      }
      const next = updateEditorGridSplitSizes(
        editorLayoutRef.current,
        splitId,
        event.layout.sizeById,
      );
      editorLayoutRef.current = next;
      if (event.phase === "commit") {
        const current = readActionEditorArrangement();
        commitEditorArrangement({ ...current, layout: next });
      }
      if (root) {
        areaSizeSnapshotRef.current = {
          ...areaSizeSnapshotRef.current,
          editorGroups: createSplitSizeSnapshot(event.layout),
        };
      }
      publishLayout(
        createLayout(),
        event.phase === "change" ? { persist: false } : { notify: false },
      );
    };

    const renderEditorGroup = (group: WorkbenchEditorGroup) => {
      const activeTabId = currentActiveEditorTabs[group.id];
      const activeTab = group.tabs.find((tab) => tab.id === activeTabId) ?? group.tabs[0];
      const groupIndex = orderedEditorGroups.findIndex((item) => item.id === group.id);
      const showTabs = group.showTabs !== false && group.tabs.length > 0;
      const activeTabIndex = activeTab ? group.tabs.indexOf(activeTab) : -1;
      const activeTabDomId =
        activeTabIndex >= 0
          ? editorTabDomId(accessibilityId, groupIndex, activeTabIndex)
          : undefined;
      const activePanelDomId = editorPanelDomId(accessibilityId, groupIndex);

      return (
        <section
          data-worksplit-editor-group={group.id}
          className={["worksplit-workbench-editor-group", group.className]
            .filter(Boolean)
            .join(" ")}
        >
          {showTabs && (
            <div
              className="worksplit-workbench-editor-tabs"
              data-worksplit-editor-tabs={group.id}
              role="tablist"
            >
              {group.tabs.map((tab, editorTabIndex) => {
                const active = tab.id === activeTab?.id;
                const icon = renderWorkbenchIcon(tab.icon, 14);
                const tabDomId = editorTabDomId(accessibilityId, groupIndex, editorTabIndex);
                const tabInfo = {
                  actions,
                  active,
                  group,
                  icon,
                  tab,
                  value: publicValue,
                };
                const renderedTab = renderEditorTabLabel?.(tabInfo);
                const tabProps: WorkbenchEditorTabRenderInfo["tabProps"] = {
                  "aria-controls": activePanelDomId,
                  "aria-selected": active,
                  className: [
                    "worksplit-workbench-editor-tab",
                    active ? "active" : "",
                    tab.className,
                  ]
                    .filter(Boolean)
                    .join(" "),
                  "data-worksplit-editor-tab": tab.id,
                  id: tabDomId,
                  onClick: () => {
                    if (suppressEditorTabClickRef.current) {
                      suppressEditorTabClickRef.current = false;
                      return;
                    }
                    activateEditorTab(group.id, tab.id);
                  },
                  onContextMenu: (event) => {
                    activateEditorTab(group.id, tab.id);
                    onEditorTabContextMenu?.({ ...tabInfo, index: editorTabIndex }, event);
                  },
                  onKeyDown: (event) => {
                    const nextIndex = nextTabIndex(event.key, editorTabIndex, group.tabs.length);
                    if (nextIndex === null) {
                      return;
                    }
                    event.preventDefault();
                    const nextTab = group.tabs[nextIndex];
                    const nextElement = event.currentTarget
                      .closest("[data-worksplit-editor-tabs]")
                      ?.querySelector<HTMLElement>(
                        `#${editorTabDomId(accessibilityId, groupIndex, nextIndex)}`,
                      );
                    nextElement?.focus();
                    if (nextTab) {
                      activateEditorTab(group.id, nextTab.id);
                    }
                  },
                  onPointerDown: (event) => beginEditorTabDrag(event, group.id, tab.id),
                  role: "tab",
                  tabIndex: active ? 0 : -1,
                  type: "button",
                };
                const fullRenderedTab = renderEditorTab?.({ ...tabInfo, tabProps });
                return (
                  <Fragment key={tab.id}>
                    {fullRenderedTab ?? (
                      <button {...tabProps}>
                        {renderedTab ?? (
                          <>
                            {icon}
                            <span>{tab.title ?? tab.id}</span>
                          </>
                        )}
                      </button>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}
          <div
            aria-labelledby={showTabs ? activeTabDomId : undefined}
            className="worksplit-workbench-editor-content"
            data-worksplit-editor-content={group.id}
            id={showTabs ? activePanelDomId : undefined}
            role={showTabs ? "tabpanel" : undefined}
            tabIndex={showTabs ? 0 : undefined}
          >
            {activeTab?.renderContent({
              actions,
              active: true,
              group,
              icon: renderWorkbenchIcon(activeTab.icon),
              tab: activeTab,
              value: publicValue,
            })}
          </div>
        </section>
      );
    };

    const renderEditorLayoutNode = (node: EditorGridLayout, root = false): ReactNode => {
      if (node.type === "group") {
        const group = orderedEditorGroups.find((item) => item.id === node.groupId);
        return group ? renderEditorGroup(group) : null;
      }

      const containsMaximizedGroup = maximizedEditorGroupId
        ? editorLayoutContainsGroup(node, maximizedEditorGroupId)
        : false;
      const defaultSizeById = Object.fromEntries(
        node.children.flatMap((child) =>
          child.size === undefined ? [] : [[editorGridPaneId(child.node), child.size]],
        ),
      );

      return (
        <SplitView
          key={`editor-split-${node.id}-${layoutVersion}`}
          ref={(handle) => {
            if (handle) {
              editorSplitRefs.current.set(node.id, handle);
            } else {
              editorSplitRefs.current.delete(node.id);
            }
            if (root) {
              editorGroupsSplitRef.current = handle;
            }
          }}
          className={[
            "worksplit-workbench-editor-groups",
            "worksplit-workbench-editor-split",
            containsMaximizedGroup ? "worksplit-workbench-editor-split-maximized" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          defaultSizeById={
            root && Object.keys(defaultSizeById).length === 0
              ? areaSizeSnapshotRef.current.editorGroups
              : defaultSizeById
          }
          orientation={node.orientation}
          onLayout={(event) => handleEditorSplitLayout(node.id, event, root)}
        >
          {node.children.map((child) => {
            const childNode = child.node;
            const group =
              childNode.type === "group"
                ? orderedEditorGroups.find((item) => item.id === childNode.groupId)
                : undefined;
            const onMaximizedPath = maximizedEditorGroupId
              ? editorLayoutContainsGroup(childNode, maximizedEditorGroupId)
              : false;
            const sizing = {
              default: child.size ?? group?.size?.default ?? "1fr",
              max: group?.size?.max,
              min: group?.size?.min ?? editorGroupMinSize,
            };

            return (
              <Pane
                className={[
                  "worksplit-workbench-editor-group-pane",
                  containsMaximizedGroup && onMaximizedPath
                    ? "worksplit-workbench-editor-maximized-branch"
                    : "",
                  containsMaximizedGroup && !onMaximizedPath
                    ? "worksplit-workbench-editor-maximized-hidden"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                defaultSize={sizing.default}
                id={editorGridPaneId(childNode)}
                key={editorGridPaneId(childNode)}
                maxSize={sizing.max}
                minSize={sizing.min}
              >
                {renderEditorLayoutNode(childNode)}
              </Pane>
            );
          })}
        </SplitView>
      );
    };

    const renderEditorArea = () => (
      <div className="worksplit-workbench-editor worksplit-workbench-editor-grid">
        {editorLayout ? renderEditorLayoutNode(editorLayout, true) : null}
      </div>
    );

    return (
      <div
        {...rest}
        ref={rootRef}
        className={rootClassName}
        role="application"
        tabIndex={tabIndex ?? -1}
      >
        {showActivity && (
          <nav aria-label="Workbench views" className="worksplit-workbench-activity">
            {orderedViews.map((view) => {
              const activityCommand =
                typeof view.meta?.["activityCommand"] === "string"
                  ? view.meta["activityCommand"]
                  : "";
              const active = activityCommand
                ? false
                : currentValue.activeByPart[view.part] === view.id;
              const visible = active && currentValue.visibleParts[view.part];
              const activate = () => {
                if (activityCommand) {
                  runCommand(activityCommand);
                  return;
                }
                toggleView(view.id);
              };
              const part = view.part;
              const icon = renderWorkbenchIcon(view.icon);
              const publicView = toPublicView(view);

              return (
                <button
                  aria-label={view.title ?? view.id}
                  aria-pressed={visible}
                  className={[
                    "worksplit-workbench-activity-item",
                    view.activityGroup === "footer" ? "footer" : "",
                    active ? "active" : "",
                    visible ? "visible" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={view.id}
                  onClick={activate}
                  type="button"
                >
                  {renderActivityItem
                    ? renderActivityItem({
                        actions,
                        active,
                        icon,
                        part,
                        value: publicValue,
                        view: publicView,
                        visible,
                      })
                    : (icon ?? <span>{(view.title ?? view.id).slice(0, 1).toUpperCase()}</span>)}
                </button>
              );
            })}
          </nav>
        )}

        <SplitView
          key={`main-${layoutVersion}-${currentPanelPosition}`}
          ref={mainSplitRef}
          className="worksplit-workbench-main"
          defaultSizeById={areaSizeSnapshotRef.current.workbench}
          orientation="horizontal"
          onLayout={(event) => handleAreaLayout("workbench", event)}
          onPaneVisibilityChange={handlePartVisibility}
          renderCollapsedPane={collapsedPartRenderer}
        >
          {renderPartPane("primary")}
          {currentPanelPosition === "right" ? (
            <>
              <Pane id="workbench:editor" minSize={centerMinSize} defaultSize="1fr">
                {renderEditorArea()}
              </Pane>
              {renderPartPane("panel")}
            </>
          ) : (
            <Pane id="workbench:center" minSize={centerMinSize} defaultSize="1fr">
              <SplitView
                key={`editor-${layoutVersion}`}
                ref={centerSplitRef}
                className="worksplit-workbench-editor-stack"
                defaultSizeById={areaSizeSnapshotRef.current.center}
                orientation="vertical"
                onLayout={(event) => handleAreaLayout("center", event)}
                onPaneVisibilityChange={handlePartVisibility}
                renderCollapsedPane={collapsedPartRenderer}
              >
                <Pane id="workbench:editor" minSize={centerMinSize} defaultSize="1fr">
                  {renderEditorArea()}
                </Pane>
                {renderPartPane("panel")}
              </SplitView>
            </Pane>
          )}
          {renderPartPane("secondary")}
        </SplitView>
      </div>
    );
  },
);

function validateEditorTabCatalog(tabs: readonly WorkbenchEditorTab[]): WorkbenchEditorTab[] {
  const ids = new Set<string>();
  for (const tab of tabs) {
    if (!tab.id.trim()) {
      throw new Error("[Worksplit] Editor tab ids must be non-empty strings.");
    }
    if (ids.has(tab.id)) {
      throw new Error(`[Worksplit] Duplicate editor tab id "${tab.id}".`);
    }
    ids.add(tab.id);
  }
  return [...tabs];
}

function createArrangementFromDescriptors(
  groups: readonly WorkbenchEditorGroup[],
  flatTabs: readonly WorkbenchEditorTab[] | undefined,
): EditorArrangement {
  if (flatTabs) {
    return createEditorArrangement({
      groups: flatTabs.length > 0 ? [{ id: "main", tabIds: flatTabs.map((tab) => tab.id) }] : [],
    });
  }
  return createEditorArrangement({
    groups: groups.flatMap((group) =>
      group.tabs.length > 0
        ? [
            {
              activeTabId: group.defaultActiveTabId,
              id: group.id,
              tabIds: group.tabs.map((tab) => tab.id),
            },
          ]
        : [],
    ),
  });
}

function createLegacyStartupArrangement(
  initial: EditorArrangement,
  layout: WorkbenchLayout,
): EditorArrangement {
  const groups = initial.groups.map((group) => {
    const active = layout.value.activeEditorTabs?.[group.id];
    return active && group.tabIds.includes(active) ? { ...group, activeTabId: active } : group;
  });
  const groupIds = groups.map((group) => group.id);
  return {
    groups,
    layout: applyLegacyEditorGroupSizes(
      normalizeEditorGridLayout(layout.editorLayout ?? initial.layout, groupIds),
      layout.areaSizes?.editorGroups,
    ),
    maximizedGroupId: groupIds.includes(layout.maximizedEditorGroupId ?? "")
      ? layout.maximizedEditorGroupId
      : undefined,
  };
}

function activeTabsFromArrangement(arrangement: EditorArrangement): Record<string, string> {
  return Object.fromEntries(
    arrangement.groups.map((group) => [group.id, group.activeTabId] as const),
  );
}

function materializeEditorGroups(
  arrangement: EditorArrangement,
  tabs: readonly WorkbenchEditorTab[],
  descriptors: readonly WorkbenchEditorGroup[],
): WorkbenchEditorGroup[] {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const groupsById = new Map(descriptors.map((group) => [group.id, group]));
  return arrangement.groups.map((state, index) => {
    const descriptor = groupsById.get(state.id);
    return {
      ...descriptor,
      defaultActiveTabId: state.activeTabId,
      id: state.id,
      order: index,
      tabs: state.tabIds.flatMap((tabId) => {
        const tab = tabsById.get(tabId);
        return tab ? [tab] : [];
      }),
    };
  });
}

function sameEditorArrangement(left: EditorArrangement, right: EditorArrangement): boolean {
  return (
    left.maximizedGroupId === right.maximizedGroupId &&
    sameEditorGridLayout(left.layout, right.layout) &&
    left.groups.length === right.groups.length &&
    left.groups.every((group, index) => {
      const other = right.groups[index];
      return (
        other !== undefined &&
        group.id === other.id &&
        group.activeTabId === other.activeTabId &&
        group.tabIds.length === other.tabIds.length &&
        group.tabIds.every((tabId, tabIndex) => tabId === other.tabIds[tabIndex])
      );
    })
  );
}

function normalizeView(view: WorkbenchView): WorkbenchResolvedView {
  return {
    ...view,
    part: view.part,
  };
}

function validateWorkbenchViews(views: readonly WorkbenchView[]): WorkbenchView[] {
  const ids = new Set<string>();
  const defaultByPart = new Map<WorkbenchPart, string>();
  for (const view of views) {
    if (!view.id.trim()) {
      throw new Error("[Worksplit] Workbench view ids must be non-empty strings.");
    }
    if (ids.has(view.id)) {
      throw new Error(`[Worksplit] Duplicate workbench view id "${view.id}".`);
    }
    if (view.defaultActive) {
      const existing = defaultByPart.get(view.part);
      if (existing) {
        throw new Error(
          `[Worksplit] Views "${existing}" and "${view.id}" are both defaultActive in part "${view.part}".`,
        );
      }
      defaultByPart.set(view.part, view.id);
    }
    ids.add(view.id);
  }
  return [...views];
}

function validateEditorGroups(groups: readonly WorkbenchEditorGroup[]): WorkbenchEditorGroup[] {
  const groupIds = new Set<string>();
  for (const group of groups) {
    if (!group.id.trim()) {
      throw new Error("[Worksplit] Editor group ids must be non-empty strings.");
    }
    if (groupIds.has(group.id)) {
      throw new Error(`[Worksplit] Duplicate editor group id "${group.id}".`);
    }
    const tabIds = new Set<string>();
    for (const tab of group.tabs) {
      if (!tab.id.trim()) {
        throw new Error(`[Worksplit] Editor tab ids in group "${group.id}" must be non-empty.`);
      }
      if (tabIds.has(tab.id)) {
        throw new Error(`[Worksplit] Duplicate tab id "${tab.id}" in editor group "${group.id}".`);
      }
      tabIds.add(tab.id);
    }
    if (group.defaultActiveTabId && !tabIds.has(group.defaultActiveTabId)) {
      throw new Error(
        `[Worksplit] Editor group "${group.id}" references missing default tab "${group.defaultActiveTabId}".`,
      );
    }
    validateSize(`Editor group "${group.id}"`, group.size);
    groupIds.add(group.id);
  }
  return [...groups];
}

function validateSize(label: string, size: WorkbenchViewSize | undefined): void {
  if (size?.min !== undefined && size.max !== undefined && size.min > size.max) {
    throw new Error(
      `[Worksplit] ${label} has min size ${size.min} greater than max size ${size.max}.`,
    );
  }
}

function createEditorGroups(
  groups: readonly WorkbenchEditorGroup[] | undefined,
  editor: ReactNode,
): WorkbenchEditorGroup[] {
  if (groups) {
    return groups.map((group) => ({
      ...group,
      tabs: [...group.tabs],
    }));
  }

  return [
    {
      id: "main",
      showTabs: false,
      tabs: [
        {
          id: "editor",
          renderContent: () => editor,
          title: "Editor",
        },
      ],
    },
  ];
}

function toPublicView(view: WorkbenchResolvedView): WorkbenchView {
  return view;
}

function editorGridPaneId(node: EditorGridLayout): string {
  return node.type === "group"
    ? `workbench:editor-group:${node.groupId}`
    : `workbench:editor-split:${node.id}`;
}

function editorLayoutContainsGroup(layout: EditorGridLayout | undefined, groupId: string): boolean {
  if (!layout) {
    return false;
  }
  return layout.type === "group"
    ? layout.groupId === groupId
    : layout.children.some((child) => editorLayoutContainsGroup(child.node, groupId));
}

function updateEditorGridSplitSizes(
  layout: EditorGridLayout | undefined,
  splitId: string,
  sizeById: Readonly<Record<string, number>>,
): EditorGridLayout | undefined {
  if (!layout || layout.type === "group") {
    return layout;
  }
  if (layout.id === splitId) {
    return {
      ...layout,
      children: layout.children.map((child) => ({
        ...child,
        size: sizeById[editorGridPaneId(child.node)] ?? child.size,
      })),
    };
  }
  let changed = false;
  const children = layout.children.map((child) => {
    const node = updateEditorGridSplitSizes(child.node, splitId, sizeById);
    if (node !== child.node) {
      changed = true;
      return { ...child, node: node! };
    }
    return child;
  });
  return changed ? { ...layout, children } : layout;
}

function applyLegacyEditorGroupSizes(
  layout: EditorGridLayout | undefined,
  legacySizes: Readonly<Record<string, number>> | undefined,
): EditorGridLayout | undefined {
  if (!layout || layout.type !== "split" || !legacySizes) {
    return layout;
  }
  return {
    ...layout,
    children: layout.children.map((child) => {
      if (child.size !== undefined) {
        return child;
      }
      const size = legacySizes[editorGridPaneId(child.node)];
      return typeof size === "number" && Number.isFinite(size) && size >= 0
        ? { ...child, size }
        : child;
    }),
  };
}

function snapshotEditorGridLayout(
  layout: EditorGridLayout | undefined,
  splitRefs: ReadonlyMap<string, SplitViewHandle>,
): EditorGridLayout | undefined {
  if (!layout || layout.type === "group") {
    return layout ? { ...layout } : undefined;
  }
  const liveSizes = splitRefs.get(layout.id)?.getLayout()?.sizeById;
  return {
    ...layout,
    children: layout.children.map((child) => ({
      ...child,
      node: snapshotEditorGridLayout(child.node, splitRefs)!,
      size: liveSizes?.[editorGridPaneId(child.node)] ?? child.size,
    })),
  };
}

function sameEditorGridLayout(
  left: EditorGridLayout | undefined,
  right: EditorGridLayout | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  if (left.type === "group" || right.type === "group") {
    return left.type === "group" && right.type === "group" && left.groupId === right.groupId;
  }
  return (
    left.id === right.id &&
    left.orientation === right.orientation &&
    left.children.length === right.children.length &&
    left.children.every((child, index) => {
      const other = right.children[index];
      return (
        other !== undefined &&
        child.size === other.size &&
        sameEditorGridLayout(child.node, other.node)
      );
    })
  );
}

function editorTabDomId(instanceId: string, groupIndex: number, tabIndex: number): string {
  return `worksplit-${instanceId}-group-${groupIndex}-tab-${tabIndex}`;
}

function editorPanelDomId(instanceId: string, groupIndex: number): string {
  return `worksplit-${instanceId}-group-${groupIndex}-panel`;
}

function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  if (key === "ArrowLeft") {
    return (current - 1 + count) % count;
  }
  if (key === "ArrowRight") {
    return (current + 1) % count;
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return count - 1;
  }
  return null;
}

function orderViews<T extends { id: string; order?: number }>(views: readonly T[]): T[] {
  return views.toSorted((left, right) => {
    const order = (left.order ?? 0) - (right.order ?? 0);
    return order === 0 ? left.id.localeCompare(right.id) : order;
  });
}

function defaultPartHeader(view: WorkbenchView | undefined, hide: () => void): ReactNode {
  if (!view) {
    return null;
  }

  return (
    <header className="worksplit-workbench-part-header">
      <span>{view.title ?? view.id}</span>
      <button
        aria-label={`Hide ${view.title ?? view.id}`}
        className="worksplit-workbench-icon-button"
        onClick={hide}
        type="button"
      >
        x
      </button>
    </header>
  );
}

function renderWorkbenchIcon(icon: WorkbenchIcon | undefined, size = 20): ReactNode {
  if (!icon) {
    return null;
  }
  if (isValidElement(icon)) {
    return icon;
  }
  if (isComponentIcon(icon)) {
    return createElement(icon, { size });
  }
  return icon;
}

function isComponentIcon(
  icon: WorkbenchIcon,
): icon is ElementType<{ className?: string; size?: number }> {
  return (
    typeof icon === "function" || (typeof icon === "object" && icon !== null && "$$typeof" in icon)
  );
}

function createCommandContext(options: {
  activateEditorTab: WorkbenchHandle["activateEditorTab"];
  activateView: WorkbenchHandle["activateView"];
  centerSplitRef: RefObject<SplitViewHandle | null>;
  createLayout: WorkbenchHandle["getLayout"];
  editorGroupsSplitRef: RefObject<SplitViewHandle | null>;
  equalizeEditorGroups: WorkbenchHandle["equalizeEditorGroups"];
  hidePart: WorkbenchHandle["hidePart"];
  mainSplitRef: RefObject<SplitViewHandle | null>;
  maximizeEditorGroup: WorkbenchHandle["maximizeEditorGroup"];
  moveEditorGroup: WorkbenchHandle["moveEditorGroup"];
  moveEditorTab: WorkbenchHandle["moveEditorTab"];
  publicValue: WorkbenchValue;
  resetLayout: WorkbenchHandle["resetLayout"];
  restoreEditorGroups: WorkbenchHandle["restoreEditorGroups"];
  restoreLayout: WorkbenchHandle["restoreLayout"];
  runCommand: WorkbenchHandle["runCommand"];
  setPanelPosition: WorkbenchHandle["setPanelPosition"];
  showPart: WorkbenchHandle["showPart"];
  togglePanelPosition: WorkbenchHandle["togglePanelPosition"];
  toggleEditorGroupMaximized: WorkbenchHandle["toggleEditorGroupMaximized"];
  togglePart: WorkbenchHandle["togglePart"];
  toggleView: WorkbenchHandle["toggleView"];
}): WorkbenchCommandContext {
  return {
    activateEditorTab: options.activateEditorTab,
    activateView: options.activateView,
    equalizeEditorGroups: options.equalizeEditorGroups,
    getLayout: options.createLayout,
    getAreaLayout: (id) =>
      readAreaLayout(
        id,
        options.mainSplitRef,
        options.centerSplitRef,
        options.editorGroupsSplitRef,
      ),
    getValue: () => options.publicValue,
    hidePart: options.hidePart,
    maximizeEditorGroup: options.maximizeEditorGroup,
    moveEditorGroup: options.moveEditorGroup,
    moveEditorTab: options.moveEditorTab,
    resetLayout: options.resetLayout,
    restoreEditorGroups: options.restoreEditorGroups,
    restoreLayout: options.restoreLayout,
    runCommand: options.runCommand,
    setPanelPosition: options.setPanelPosition,
    showPart: options.showPart,
    togglePanelPosition: options.togglePanelPosition,
    toggleEditorGroupMaximized: options.toggleEditorGroupMaximized,
    togglePart: options.togglePart,
    toggleView: options.toggleView,
  };
}

function createCommandRegistry(
  commands: readonly WorkbenchCommand[] | undefined,
): WorkbenchCommand[] {
  const registry = new Map<string, WorkbenchCommand>();
  for (const command of DEFAULT_WORKBENCH_COMMANDS) {
    registry.set(command.id, command);
  }
  for (const command of commands ?? []) {
    registry.set(command.id, command);
  }
  return [...registry.values()];
}

function readAreaLayout(
  id: WorkbenchAreaLayoutId,
  mainSplitRef: RefObject<SplitViewHandle | null>,
  centerSplitRef: RefObject<SplitViewHandle | null>,
  editorGroupsSplitRef: RefObject<SplitViewHandle | null>,
): SplitLayout | null {
  if (id === "workbench") {
    return mainSplitRef.current?.getLayout() ?? null;
  }
  if (id === "center") {
    return centerSplitRef.current?.getLayout() ?? null;
  }
  return editorGroupsSplitRef.current?.getLayout() ?? null;
}

interface KeybindingEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

function matchKeybinding(event: KeybindingEvent, keybinding: string): boolean {
  const tokens = keybinding.toLowerCase().split("+");
  const key = tokens.at(-1);
  if (!key) {
    return false;
  }
  const mod = tokens.includes("mod");
  const mac = isMacPlatform();

  return (
    normalizeKey(event.key) === key &&
    event.altKey === tokens.includes("alt") &&
    event.shiftKey === tokens.includes("shift") &&
    event.ctrlKey === (tokens.includes("ctrl") || (mod && !mac)) &&
    event.metaKey === (tokens.includes("meta") || (mod && mac))
  );
}

function normalizeKey(key: string): string {
  if (key === " ") {
    return "space";
  }
  return key.toLowerCase();
}

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}
