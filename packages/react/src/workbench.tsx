import {
  WORKBENCH_PARTS as CORE_WORKBENCH_PARTS,
  activateWorkbenchView,
  createWorkbenchValue,
  getActiveWorkbenchView,
  moveEditorGridGroup,
  normalizeEditorGridLayout,
  setWorkbenchPartVisibility,
  validateEditorGridLayout,
  createSplitSizeSnapshot,
  type EditorGridDirection,
  type EditorGridLayout,
  type MoveEditorGridGroupOptions,
  type PaneSizeValue,
  type SplitLayout,
  type WorkbenchPart as CoreWorkbenchPart,
  type WorkbenchValue as CoreWorkbenchValue,
} from "@worksplit/core";
import {
  createElement,
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
  type HTMLAttributes,
  type RefObject,
  type ReactNode,
} from "react";

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
  sameStringRecord,
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

export type WorkbenchIcon = ReactNode | ElementType<{ className?: string; size?: number }>;

export interface WorkbenchViewSize {
  min?: number;
  max?: number;
  default?: PaneSizeValue;
}

export interface WorkbenchActions {
  activateView(id: string): void;
  activateEditorTab(groupId: string, tabId: string): void;
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
  renderActivityItem?: (info: WorkbenchActivityItemRenderInfo) => ReactNode;
  renderEditorTabLabel?: (info: WorkbenchEditorTabLabelRenderInfo) => ReactNode;
  renderPartHeader?: (info: WorkbenchPartRenderInfo) => ReactNode;
  renderCollapsedPart?: (info: WorkbenchCollapsedPartRenderInfo) => ReactNode;
}

export type WorkbenchProps =
  | (WorkbenchBaseProps & {
      editor: ReactNode;
      editorGroups?: never;
    })
  | (WorkbenchBaseProps & {
      editor?: never;
      editorGroups: readonly WorkbenchEditorGroup[];
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
      editorGroups,
      centerMinSize = 320,
      editorGroupMinSize = centerMinSize,
      onLayout,
      onValueChange,
      partSizes,
      renderActivityItem,
      renderCollapsedPart,
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
    const orderedEditorGroups = useMemo(
      () => validateEditorGroups(orderViews(createEditorGroups(editorGroups, editor))),
      [editor, editorGroups],
    );
    const editorGroupIds = useMemo(
      () => orderedEditorGroups.map((group) => group.id),
      [orderedEditorGroups],
    );
    const defaultLayoutRef = useRef(defaultLayout);
    const defaultLayoutValidatedRef = useRef(false);
    if (!defaultLayoutValidatedRef.current) {
      if (defaultLayoutRef.current?.editorLayout) {
        validateEditorGridLayout(defaultLayoutRef.current.editorLayout, editorGroupIds);
      }
      defaultLayoutValidatedRef.current = true;
    }
    const startupLayoutRef = useRef<WorkbenchLayout | null>(null);
    startupLayoutRef.current ??= readStartupLayout(storageKey, defaultLayout, editorGroupIds);
    const startupLayout = startupLayoutRef.current;
    const areaSizeSnapshotRef = useRef<WorkbenchAreaSizeSnapshot>(
      startupLayout.areaSizes ? cloneAreaSizeSnapshot(startupLayout.areaSizes) : {},
    );
    const [uncontrolledValue, setUncontrolledValue] = useState(() =>
      createWorkbenchValue(orderedViews, toCoreValueSnapshot(startupLayout.value)),
    );
    const [uncontrolledActiveEditorTabs, setUncontrolledActiveEditorTabs] = useState(() =>
      createActiveEditorTabs(orderedEditorGroups, startupLayout.value.activeEditorTabs),
    );
    const [uncontrolledPanelPosition, setUncontrolledPanelPosition] =
      useState<WorkbenchPanelPosition>(startupLayout.panelPosition);
    const [editorLayout, setEditorLayout] = useState<EditorGridLayout | undefined>(() =>
      applyLegacyEditorGroupSizes(
        normalizeEditorGridLayout(startupLayout.editorLayout, editorGroupIds),
        startupLayout.areaSizes?.editorGroups,
      ),
    );
    const [maximizedEditorGroupId, setMaximizedEditorGroupId] = useState<string | undefined>(
      startupLayout.maximizedEditorGroupId,
    );
    const [layoutVersion, setLayoutVersion] = useState(0);
    const controlledValue = useMemo(() => (value ? toCoreValue(value) : undefined), [value]);
    const currentValue = controlledValue ?? uncontrolledValue;
    const currentActiveEditorTabs = useMemo(
      () =>
        createActiveEditorTabs(
          orderedEditorGroups,
          value?.activeEditorTabs ?? uncontrolledActiveEditorTabs,
        ),
      [orderedEditorGroups, uncontrolledActiveEditorTabs, value?.activeEditorTabs],
    );
    const publicValue = useMemo(
      () => toPublicValue(currentValue, currentActiveEditorTabs),
      [currentActiveEditorTabs, currentValue],
    );
    const currentPanelPosition = uncontrolledPanelPosition;
    const currentValueRef = useRef(currentValue);
    const currentActiveEditorTabsRef = useRef(currentActiveEditorTabs);
    const currentPanelPositionRef = useRef(currentPanelPosition);
    const editorLayoutRef = useRef(editorLayout);
    const maximizedEditorGroupIdRef = useRef(maximizedEditorGroupId);
    const editorSplitRefs = useRef(new Map<string, SplitViewHandle>());
    const pendingValueRef = useRef<CoreWorkbenchValue | undefined>(undefined);
    const pendingActiveEditorTabsRef = useRef<Record<string, string> | undefined>(undefined);
    const pendingResetScheduledRef = useRef(false);
    const orderedViewsRef = useRef(orderedViews);
    const orderedEditorGroupsRef = useRef(orderedEditorGroups);
    const controlledValueRef = useRef(value !== undefined);
    const onValueChangeRef = useRef(onValueChange);
    const onLayoutRef = useRef(onLayout);
    const storageKeyRef = useRef(storageKey);
    const declaredEditorGroupsRef = useRef(editorGroups !== undefined);

    currentValueRef.current = currentValue;
    currentActiveEditorTabsRef.current = currentActiveEditorTabs;
    currentPanelPositionRef.current = currentPanelPosition;
    editorLayoutRef.current = editorLayout;
    maximizedEditorGroupIdRef.current = maximizedEditorGroupId;
    orderedViewsRef.current = orderedViews;
    orderedEditorGroupsRef.current = orderedEditorGroups;
    controlledValueRef.current = value !== undefined;
    onValueChangeRef.current = onValueChange;
    onLayoutRef.current = onLayout;
    storageKeyRef.current = storageKey;
    declaredEditorGroupsRef.current = editorGroups !== undefined;

    const schedulePendingReset = useCallback(() => {
      if (pendingResetScheduledRef.current) {
        return;
      }
      pendingResetScheduledRef.current = true;
      queueMicrotask(() => {
        pendingResetScheduledRef.current = false;
        pendingValueRef.current = undefined;
        pendingActiveEditorTabsRef.current = undefined;
      });
    }, []);

    const readActionValue = useCallback(
      () => pendingValueRef.current ?? currentValueRef.current,
      [],
    );
    const readActionEditorTabs = useCallback(
      () => pendingActiveEditorTabsRef.current ?? currentActiveEditorTabsRef.current,
      [],
    );

    const commitValue = useCallback(
      (next: CoreWorkbenchValue, nextActiveEditorTabs = readActionEditorTabs()) => {
        const previousValue = readActionValue();
        const previousActiveEditorTabs = readActionEditorTabs();
        if (
          sameWorkbenchValue(next, previousValue) &&
          sameStringRecord(nextActiveEditorTabs, previousActiveEditorTabs)
        ) {
          return;
        }
        if (controlledValueRef.current) {
          pendingValueRef.current = next;
          pendingActiveEditorTabsRef.current = nextActiveEditorTabs;
          schedulePendingReset();
        } else {
          currentValueRef.current = next;
          currentActiveEditorTabsRef.current = nextActiveEditorTabs;
          setUncontrolledValue(next);
        }
        onValueChangeRef.current?.(toPublicValue(next, nextActiveEditorTabs));
      },
      [readActionEditorTabs, readActionValue, schedulePendingReset],
    );

    const commitActiveEditorTabs = useCallback(
      (next: Record<string, string>) => {
        if (sameStringRecord(next, readActionEditorTabs())) {
          return;
        }
        const actionValue = readActionValue();
        if (controlledValueRef.current) {
          pendingActiveEditorTabsRef.current = next;
          schedulePendingReset();
        } else {
          currentActiveEditorTabsRef.current = next;
          setUncontrolledActiveEditorTabs(next);
        }
        onValueChangeRef.current?.(toPublicValue(actionValue, next));
      },
      [readActionEditorTabs, readActionValue, schedulePendingReset],
    );

    const createLayout = useCallback(
      (
        nextValue = currentValueRef.current,
        nextPanelPosition = currentPanelPositionRef.current,
        nextActiveEditorTabs = currentActiveEditorTabsRef.current,
      ): WorkbenchLayout => ({
        panelPosition: nextPanelPosition,
        areaSizes: readCurrentAreaSizes(
          mainSplitRef.current?.getLayout() ?? null,
          centerSplitRef.current?.getLayout() ?? null,
          editorGroupsSplitRef.current?.getLayout() ?? null,
          areaSizeSnapshotRef.current,
        ),
        editorLayout: declaredEditorGroupsRef.current
          ? snapshotEditorGridLayout(editorLayoutRef.current, editorSplitRefs.current)
          : undefined,
        maximizedEditorGroupId: declaredEditorGroupsRef.current
          ? maximizedEditorGroupIdRef.current
          : undefined,
        version: 1,
        value: createPublicValueSnapshot(nextValue, nextActiveEditorTabs),
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
      const reconciled = createActiveEditorTabs(orderedEditorGroups, currentActiveEditorTabs);
      if (!sameStringRecord(reconciled, currentActiveEditorTabs)) {
        commitActiveEditorTabs(reconciled);
      }
    }, [commitActiveEditorTabs, currentActiveEditorTabs, orderedEditorGroups]);

    useEffect(() => {
      const reconciled = normalizeEditorGridLayout(editorLayoutRef.current, editorGroupIds);
      if (!sameEditorGridLayout(reconciled, editorLayoutRef.current)) {
        editorLayoutRef.current = reconciled;
        setEditorLayout(reconciled);
      }
      const maximized = maximizedEditorGroupIdRef.current;
      if (maximized && !editorGroupIds.includes(maximized)) {
        maximizedEditorGroupIdRef.current = undefined;
        setMaximizedEditorGroupId(undefined);
      }
    }, [editorGroupIds]);

    useEffect(
      () => publishLayout(createLayout()),
      [
        createLayout,
        currentActiveEditorTabs,
        currentPanelPosition,
        currentValue,
        editorLayout,
        layoutVersion,
        maximizedEditorGroupId,
        publishLayout,
      ],
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
        const group = orderedEditorGroupsRef.current.find((item) => item.id === groupId);
        if (!group?.tabs.some((tab) => tab.id === tabId)) {
          return;
        }
        commitActiveEditorTabs({ ...readActionEditorTabs(), [groupId]: tabId });
      },
      [commitActiveEditorTabs, readActionEditorTabs],
    );

    const commitEditorLayout = useCallback((next: EditorGridLayout | undefined) => {
      if (sameEditorGridLayout(next, editorLayoutRef.current)) {
        return;
      }
      editorLayoutRef.current = next;
      setEditorLayout(next);
    }, []);

    const moveEditorGroup = useCallback(
      (options: WorkbenchEditorGroupMoveOptions) => {
        commitEditorLayout(moveEditorGridGroup(editorLayoutRef.current, options));
      },
      [commitEditorLayout],
    );

    const maximizeEditorGroup = useCallback((groupId: string) => {
      if (
        maximizedEditorGroupIdRef.current === groupId ||
        !editorLayoutContainsGroup(editorLayoutRef.current, groupId)
      ) {
        return;
      }
      maximizedEditorGroupIdRef.current = groupId;
      setMaximizedEditorGroupId(groupId);
    }, []);

    const restoreEditorGroups = useCallback(() => {
      if (!maximizedEditorGroupIdRef.current) {
        return;
      }
      maximizedEditorGroupIdRef.current = undefined;
      setMaximizedEditorGroupId(undefined);
    }, []);

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
        const previousActiveEditorTabs = currentActiveEditorTabsRef.current;
        const previousPanelPosition = currentPanelPositionRef.current;
        const currentEditorGroupIds = orderedEditorGroupsRef.current.map((group) => group.id);
        const normalized = normalizeLayout(
          layout,
          undefined,
          previousPanelPosition,
          currentEditorGroupIds,
        );
        areaSizeSnapshotRef.current = cloneAreaSizeSnapshot(normalized.areaSizes ?? {});
        const nextValue = createWorkbenchValue(
          orderedViewsRef.current,
          toCoreValueSnapshot(normalized.value),
        );
        const nextActiveEditorTabs = createActiveEditorTabs(
          orderedEditorGroupsRef.current,
          normalized.value.activeEditorTabs,
        );
        const nextPanelPosition = normalized.panelPosition;
        const nextEditorLayout = applyLegacyEditorGroupSizes(
          normalizeEditorGridLayout(normalized.editorLayout, currentEditorGroupIds),
          normalized.areaSizes?.editorGroups,
        );
        const nextMaximizedEditorGroupId = normalized.maximizedEditorGroupId;

        if (controlledValueRef.current) {
          pendingValueRef.current = nextValue;
          pendingActiveEditorTabsRef.current = nextActiveEditorTabs;
          schedulePendingReset();
        } else {
          currentValueRef.current = nextValue;
          currentActiveEditorTabsRef.current = nextActiveEditorTabs;
          if (!sameWorkbenchValue(nextValue, previousValue)) {
            setUncontrolledValue(nextValue);
          }
          if (!sameStringRecord(nextActiveEditorTabs, previousActiveEditorTabs)) {
            setUncontrolledActiveEditorTabs(nextActiveEditorTabs);
          }
        }
        if (
          !sameWorkbenchValue(nextValue, previousValue) ||
          !sameStringRecord(nextActiveEditorTabs, previousActiveEditorTabs)
        ) {
          onValueChangeRef.current?.(toPublicValue(nextValue, nextActiveEditorTabs));
        }
        currentPanelPositionRef.current = nextPanelPosition;
        if (nextPanelPosition !== previousPanelPosition) {
          setUncontrolledPanelPosition(nextPanelPosition);
        }
        editorLayoutRef.current = nextEditorLayout;
        maximizedEditorGroupIdRef.current = nextMaximizedEditorGroupId;
        setEditorLayout(nextEditorLayout);
        setMaximizedEditorGroupId(nextMaximizedEditorGroupId);
        setLayoutVersion((version) => version + 1);
      },
      [schedulePendingReset],
    );

    const resetLayout = useCallback(() => {
      const currentEditorGroupIds = orderedEditorGroupsRef.current.map((group) => group.id);
      restoreLayout(
        normalizeLayout(defaultLayoutRef.current, undefined, "bottom", currentEditorGroupIds),
      );
    }, [restoreLayout]);

    const commandRegistry = useMemo(() => createCommandRegistry(commands), [commands]);

    const runCommand = useCallback(
      (id: string): boolean => {
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
            publicValue: toPublicValue(currentValueRef.current, currentActiveEditorTabsRef.current),
            hidePart,
            maximizeEditorGroup,
            moveEditorGroup,
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
        getValue: () => toPublicValue(currentValueRef.current, currentActiveEditorTabsRef.current),
        hidePart,
        maximizeEditorGroup,
        moveEditorGroup,
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
        setEditorLayout(next);
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
          className={["worksplit-workbench-editor-group", group.className]
            .filter(Boolean)
            .join(" ")}
        >
          {showTabs && (
            <div className="worksplit-workbench-editor-tabs" role="tablist">
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

                return (
                  <button
                    aria-controls={activePanelDomId}
                    aria-selected={active}
                    className={[
                      "worksplit-workbench-editor-tab",
                      active ? "active" : "",
                      tab.className,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    id={tabDomId}
                    key={tab.id}
                    onClick={() => activateEditorTab(group.id, tab.id)}
                    onKeyDown={(event) => {
                      const nextIndex = nextTabIndex(event.key, editorTabIndex, group.tabs.length);
                      if (nextIndex === null) {
                        return;
                      }
                      event.preventDefault();
                      const nextTab = group.tabs[nextIndex];
                      const nextElement =
                        event.currentTarget.parentElement?.querySelector<HTMLElement>(
                          `#${editorTabDomId(accessibilityId, groupIndex, nextIndex)}`,
                        );
                      nextElement?.focus();
                      if (nextTab) {
                        activateEditorTab(group.id, nextTab.id);
                      }
                    }}
                    role="tab"
                    tabIndex={active ? 0 : -1}
                    type="button"
                  >
                    {renderedTab ?? (
                      <>
                        {icon}
                        <span>{tab.title ?? tab.id}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div
            aria-labelledby={showTabs ? activeTabDomId : undefined}
            className="worksplit-workbench-editor-content"
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

function createActiveEditorTabs(
  groups: readonly WorkbenchEditorGroup[],
  snapshot: Record<string, string> | undefined,
): Record<string, string> {
  const activeByGroup: Record<string, string> = {};
  for (const group of groups) {
    const restored = snapshot?.[group.id];
    const active =
      group.tabs.find((tab) => tab.id === restored) ??
      group.tabs.find((tab) => tab.id === group.defaultActiveTabId) ??
      group.tabs[0];

    if (active) {
      activeByGroup[group.id] = active.id;
    }
  }
  return activeByGroup;
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
