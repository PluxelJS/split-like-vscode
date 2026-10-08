/* oxlint-disable react/refs -- Stable refs back the imperative split layout and resize APIs. */
import {
  createSplitLayout,
  resizeAtSash,
  resizeSplitLayout,
  setPaneSize,
  parsePaneSize,
  type PaneConstraints,
  type PaneSizeValue,
  type PaneSnapshot,
  type SplitLayout,
  type SplitOrientation,
} from "@worksplit/core";
import {
  Children,
  Fragment,
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

const PANE_COMPONENT = Symbol.for("@worksplit/react/pane");
const COLLAPSED_REVEAL_THRESHOLD = 24;
const DEFAULT_SNAP = false;
const DEFAULT_SNAP_COLLAPSE_DELAY = 320;
const DEFAULT_SNAP_INTENT_THRESHOLD = 2;

export interface PaneProps extends HTMLAttributes<HTMLDivElement> {
  id: string;
  children: ReactNode;
  minSize?: number | undefined;
  maxSize?: number | undefined;
  defaultSize?: PaneSizeValue | undefined;
  defaultVisible?: boolean | undefined;
  priority?: PaneConstraints["priority"] | undefined;
  collapsedSize?: number | undefined;
  visible?: boolean | undefined;
  /** Mount content even while collapsed. Effects continue running while hidden. */
  keepMounted?: boolean | undefined;
  snap?: boolean | undefined;
  snapThreshold?: number | undefined;
  snapCollapseDelay?: number | undefined;
}

export interface SplitViewHandle {
  reset(): void;
  setPaneSizes(sizeById: Record<string, number>): void;
  resizePane(id: string, size: number): void;
  collapsePane(id: string): void;
  expandPane(id: string): void;
  togglePane(id: string): void;
  isPaneVisible(id: string): boolean;
  getLayout(): SplitLayout | null;
}

export interface SplitViewLayoutEvent {
  layout: SplitLayout;
  sizes: number[];
  sizeById: Record<string, number>;
  reason: SplitViewLayoutReason;
  phase: SplitViewLayoutPhase;
}

export type SplitViewLayoutPhase = "start" | "change" | "commit";

export type SplitViewLayoutReason = "pointer" | "keyboard" | "visibility" | "reset" | "imperative";

export interface SplitViewPaneVisibilityChange {
  id: string;
  visible: boolean;
}

export interface SplitViewSashRenderInfo {
  index: number;
  beforeId: string;
  afterId: string;
  orientation: SplitOrientation;
  disabled: boolean;
  offset: number;
  layout: SplitLayout;
}

export interface SplitViewCollapsedRenderInfo {
  id: string;
  pane: PaneSnapshot;
  index: number;
  edge: "start" | "end" | "between";
  orientation: SplitOrientation;
  disabled: boolean;
  offset: number;
  layout: SplitLayout;
}

export interface SplitViewProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onChange"
> {
  children: ReactNode;
  orientation?: SplitOrientation | undefined;
  defaultSizeById?: Record<string, number | undefined> | undefined;
  sashSize?: number;
  disabled?: boolean;
  proportionalResize?: boolean;
  onLayout?: (event: SplitViewLayoutEvent) => void;
  onPaneVisibilityChange?: (event: SplitViewPaneVisibilityChange) => void;
  renderSash?: (info: SplitViewSashRenderInfo) => ReactNode;
  renderCollapsedPane?: (info: SplitViewCollapsedRenderInfo) => ReactNode;
}

type PaneElement = ReactElement<PaneProps> & {
  type: { [PANE_COMPONENT]?: boolean };
};

export const Pane = forwardRef<HTMLDivElement, PaneProps>(function Pane(props, ref) {
  const {
    children,
    defaultSize: _defaultSize,
    defaultVisible: _defaultVisible,
    maxSize: _maxSize,
    minSize: _minSize,
    priority: _priority,
    collapsedSize: _collapsedSize,
    visible: _visible,
    keepMounted: _keepMounted,
    snap: _snap,
    snapThreshold: _snapThreshold,
    snapCollapseDelay: _snapCollapseDelay,
    ...rest
  } = props;
  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  );
}) as ReturnType<typeof forwardRef<HTMLDivElement, PaneProps>> & { [PANE_COMPONENT]: boolean };

Pane[PANE_COMPONENT] = true;

export const SplitView = forwardRef<SplitViewHandle, SplitViewProps>(
  function SplitView(props, ref) {
    const {
      children,
      className,
      defaultSizeById,
      disabled = false,
      onLayout,
      onPaneVisibilityChange,
      orientation = "horizontal",
      proportionalResize = true,
      renderCollapsedPane,
      renderSash,
      sashSize = 8,
      style,
      ...rest
    } = props;

    const containerRef = useRef<HTMLDivElement | null>(null);
    const layoutRef = useRef<SplitLayout | null>(null);
    const dragRef = useRef<{
      sashIndex: number;
      startPosition: number;
      startLayout: SplitLayout;
      snapBefore?: DragSnapState | undefined;
      snapAfter?: DragSnapState | undefined;
    } | null>(null);
    const dragCleanupRef = useRef<(() => void) | null>(null);
    const defaultSizeByIdRef = useRef<Record<string, number>>(compactSizeSnapshot(defaultSizeById));
    const sizeSnapshotRef = useRef<Record<string, number>>(defaultSizeByIdRef.current);
    const visibilityRef = useRef<Record<string, boolean>>({});
    const [containerSize, setContainerSize] = useState(0);
    const [layout, setLayout] = useState<SplitLayout | null>(null);
    const [visibility, setVisibility] = useState<Record<string, boolean>>({});

    const paneElements = useMemo(() => validatePanes(collectPanes(children)), [children]);
    const paneModelSignature = useMemo(
      () => createPaneModelSignature(paneElements),
      [paneElements],
    );
    const paneModelElements = useStablePaneModelElements(paneElements, paneModelSignature);
    const paneModels = useMemo<PaneConstraints[]>(() => {
      return paneModelElements.map((pane, index) => ({
        id: pane.props.id || `pane-${index}`,
        minSize: pane.props.minSize,
        maxSize: pane.props.maxSize,
        collapsedSize: pane.props.collapsedSize,
        defaultSize: pane.props.defaultSize,
        priority: pane.props.priority,
        visible: resolvePaneVisible(pane, visibility),
      }));
    }, [paneModelElements, visibility]);

    const publishLayout = useCallback(
      (
        next: SplitLayout,
        reason: SplitViewLayoutReason,
        phase: SplitViewLayoutPhase = "change",
      ) => {
        if (sameSplitLayout(layoutRef.current, next)) {
          return;
        }
        layoutRef.current = next;
        sizeSnapshotRef.current = mergeVisibleSizes(sizeSnapshotRef.current, next);
        setLayout(next);
        onLayout?.(createLayoutEvent(next, reason, phase));
      },
      [onLayout],
    );

    const reset = useCallback(() => {
      if (containerSize <= 0) {
        return;
      }
      publishLayout(
        createSplitLayout({
          panes: paneModels,
          containerSize,
          sizeById: defaultSizeByIdRef.current,
        }),
        "reset",
        "commit",
      );
    }, [containerSize, paneModels, publishLayout]);

    const setPaneVisibility = useCallback(
      (id: string, nextVisible: boolean) => {
        const pane = paneElements.find((element) => element.props.id === id);
        if (!pane) {
          return;
        }
        if (resolvePaneVisible(pane, visibilityRef.current) === nextVisible) {
          return;
        }

        if (pane.props.visible === undefined) {
          const nextVisibility = { ...visibilityRef.current, [id]: nextVisible };
          visibilityRef.current = nextVisibility;
          setVisibility(nextVisibility);
        }
        onPaneVisibilityChange?.({ id, visible: nextVisible });
      },
      [onPaneVisibilityChange, paneElements],
    );

    const revealPane = useCallback(
      (id: string, size?: number, reason: SplitViewLayoutReason = "visibility", commit = true) => {
        const pane = paneModels.find((model) => model.id === id);
        const paneElement = paneElements.find((element) => element.props.id === id);
        if (!pane) {
          return;
        }

        let nextSizeSnapshot = sizeSnapshotRef.current;
        if (size !== undefined) {
          const minSize = pane.minSize ?? 48;
          const maxSize = pane.maxSize ?? Number.POSITIVE_INFINITY;
          nextSizeSnapshot = {
            ...sizeSnapshotRef.current,
            [id]: Math.max(minSize, Math.min(size, maxSize)),
          };
          sizeSnapshotRef.current = nextSizeSnapshot;
        }

        if (paneElement?.props.visible === undefined && containerSize > 0) {
          const revealedLayout = createSplitLayout({
            containerSize,
            panes: paneModels.map((model) =>
              model.id === id ? { ...model, visible: true } : model,
            ),
            sizeById: nextSizeSnapshot,
          });
          const restoredSize = size ?? preferredRestoreSize(pane, nextSizeSnapshot, containerSize);
          publishLayout(
            typeof restoredSize === "number" && Number.isFinite(restoredSize)
              ? setPaneSize(revealedLayout, id, restoredSize)
              : revealedLayout,
            reason,
            commit ? "commit" : "change",
          );
        }
        setPaneVisibility(id, true);
      },
      [containerSize, paneElements, paneModels, publishLayout, setPaneVisibility],
    );

    const collapsePane = useCallback(
      (id: string, size?: number, reason: SplitViewLayoutReason = "visibility", commit = true) => {
        const paneElement = paneElements.find((element) => element.props.id === id);
        if (!paneElement) {
          return;
        }

        const current = layoutRef.current;
        const currentPane = current?.panes.find((pane) => pane.id === id);
        if (currentPane?.visible) {
          sizeSnapshotRef.current = {
            ...sizeSnapshotRef.current,
            [id]: size ?? currentPane.size,
          };
        }

        if (paneElement.props.visible === undefined && containerSize > 0) {
          publishLayout(
            createSplitLayout({
              containerSize,
              panes: paneModels.map((model) =>
                model.id === id ? { ...model, visible: false } : model,
              ),
              sizeById: sizeSnapshotRef.current,
            }),
            reason,
            commit ? "commit" : "change",
          );
        }
        setPaneVisibility(id, false);
      },
      [containerSize, paneElements, paneModels, publishLayout, setPaneVisibility],
    );

    useImperativeHandle(
      ref,
      () => ({
        collapsePane(id) {
          collapsePane(id);
        },
        expandPane(id) {
          revealPane(id);
        },
        getLayout() {
          return layoutRef.current;
        },
        isPaneVisible(id) {
          return paneModels.some((pane) => pane.id === id && pane.visible);
        },
        reset,
        setPaneSizes(sizeById) {
          if (containerSize <= 0) {
            return;
          }
          const nextSizeById = { ...sizeSnapshotRef.current, ...sizeById };
          sizeSnapshotRef.current = nextSizeById;
          publishLayout(
            createSplitLayout({ panes: paneModels, containerSize, sizeById: nextSizeById }),
            "imperative",
            "commit",
          );
        },
        resizePane(id, size) {
          const current = layoutRef.current;
          if (!current) {
            return;
          }
          publishLayout(setPaneSize(current, id, size), "imperative", "commit");
        },
        togglePane(id) {
          const isVisible = paneModels.some((pane) => pane.id === id && pane.visible);
          setPaneVisibility(id, !isVisible);
        },
      }),
      [
        collapsePane,
        containerSize,
        paneModels,
        publishLayout,
        reset,
        revealPane,
        setPaneVisibility,
      ],
    );

    useResizeObserver(containerRef, (entry) => {
      const rect = entry.contentRect;
      setContainerSize(orientation === "horizontal" ? rect.width : rect.height);
    });

    useIsomorphicLayoutEffect(() => {
      if (containerSize <= 0 || paneModels.length === 0) {
        return;
      }

      const current = layoutRef.current;
      const visibilityChanged =
        current && !sameIds(current.visibleIds, paneModels.filter(isPaneVisible).map(getPaneId));
      let next =
        current && !visibilityChanged
          ? resizeSplitLayout(current, paneModels, containerSize, proportionalResize)
          : createSplitLayout({
              panes: paneModels,
              containerSize,
              sizeById: {
                ...defaultSizeByIdRef.current,
                ...sizeSnapshotRef.current,
              },
            });
      if (current && visibilityChanged) {
        next = restoreNewlyVisiblePaneSizes(current, next, sizeSnapshotRef.current);
      }

      layoutRef.current = next;
      if (!visibilityChanged) {
        sizeSnapshotRef.current = mergeVisibleSizes(sizeSnapshotRef.current, next);
      }
      if (!sameSplitLayout(current, next)) {
        layoutRef.current = next;
        setLayout(next);
      }
    }, [containerSize, paneModels, proportionalResize]);

    useEffect(() => () => dragCleanupRef.current?.(), []);

    const resizeSash = useCallback(
      (sashIndex: number, delta: number, reason: SplitViewLayoutReason) => {
        const current = layoutRef.current;
        if (!current) {
          return null;
        }
        const next = resizeAtSash(current, sashIndex, delta);
        if (!sameSizes(current.sizes, next.sizes)) {
          publishLayout(next, reason);
        }
        return next;
      },
      [publishLayout],
    );

    const startDrag = useCallback(
      (sashIndex: number, event: PointerEvent<HTMLDivElement>) => {
        if (disabled || !layoutRef.current) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragCleanupRef.current?.();

        dragRef.current = {
          sashIndex,
          snapAfter: createDragSnapState(layoutRef.current, paneElements, sashIndex, "after"),
          snapBefore: createDragSnapState(layoutRef.current, paneElements, sashIndex, "before"),
          startLayout: layoutRef.current,
          startPosition: orientation === "horizontal" ? event.clientX : event.clientY,
        };
        document.body.classList.add("worksplit-resizing");
        onLayout?.(createLayoutEvent(layoutRef.current, "pointer", "start"));

        const handleMove = (moveEvent: globalThis.PointerEvent) => {
          const drag = dragRef.current;
          if (!drag) {
            return;
          }
          moveEvent.preventDefault();
          const position = orientation === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
          const delta = position - drag.startPosition;
          const snapped =
            updateDragSnap(
              drag.snapBefore,
              delta,
              (id, size) => collapsePane(id, size, "pointer", false),
              (id, size) => revealPane(id, size, "pointer", false),
            ) ||
            updateDragSnap(
              drag.snapAfter,
              delta,
              (id, size) => collapsePane(id, size, "pointer", false),
              (id, size) => revealPane(id, size, "pointer", false),
            );
          const next = resizeAtSash(drag.startLayout, drag.sashIndex, delta);
          if (snapped) {
            return;
          }
          if (!sameSizes(layoutRef.current?.sizes, next.sizes)) {
            publishLayout(next, "pointer");
          }
        };

        const cleanup = () => {
          clearDragSnapTimers(dragRef.current);
          window.removeEventListener("pointermove", handleMove);
          window.removeEventListener("pointerup", handleEnd);
          window.removeEventListener("pointercancel", handleEnd);
          document.body.classList.remove("worksplit-resizing");
          dragCleanupRef.current = null;
        };

        const handleEnd = () => {
          const current = layoutRef.current;
          dragRef.current = null;
          cleanup();
          if (current) {
            onLayout?.(createLayoutEvent(current, "pointer", "commit"));
          }
        };

        dragCleanupRef.current = cleanup;
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleEnd, { once: true });
        window.addEventListener("pointercancel", handleEnd, { once: true });
      },
      [collapsePane, disabled, onLayout, orientation, paneElements, publishLayout, revealPane],
    );

    const startCollapsedDrag = useCallback(
      (boundary: CollapsedBoundary, event: PointerEvent<HTMLDivElement>) => {
        if (disabled) {
          return;
        }

        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragCleanupRef.current?.();

        const startPosition = orientation === "horizontal" ? event.clientX : event.clientY;
        document.body.classList.add("worksplit-resizing");

        const handleMove = (moveEvent: globalThis.PointerEvent) => {
          moveEvent.preventDefault();
          const position = orientation === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
          const revealSize = (position - startPosition) * boundary.direction;
          if (!Number.isFinite(revealSize) || revealSize < COLLAPSED_REVEAL_THRESHOLD) {
            return;
          }

          const current = layoutRef.current;
          if (current?.visibleIds.includes(boundary.pane.id)) {
            publishLayout(setPaneSize(current, boundary.pane.id, revealSize), "pointer");
            return;
          }

          revealPane(boundary.pane.id, revealSize, "pointer", false);
        };

        const cleanup = () => {
          window.removeEventListener("pointermove", handleMove);
          window.removeEventListener("pointerup", handleEnd);
          window.removeEventListener("pointercancel", handleEnd);
          document.body.classList.remove("worksplit-resizing");
          dragCleanupRef.current = null;
        };

        const handleEnd = () => {
          const current = layoutRef.current;
          cleanup();
          if (current) {
            onLayout?.(createLayoutEvent(current, "pointer", "commit"));
          }
        };

        dragCleanupRef.current = cleanup;
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleEnd, { once: true });
        window.addEventListener("pointercancel", handleEnd, { once: true });
      },
      [disabled, onLayout, orientation, publishLayout, revealPane],
    );

    const handleSashKeyDown = useCallback(
      (sashIndex: number, event: React.KeyboardEvent<HTMLDivElement>) => {
        if (disabled) {
          return;
        }

        const direction = keyToDeltaDirection(event.key, orientation);
        if (direction === 0) {
          return;
        }

        event.preventDefault();
        const current = layoutRef.current;
        if (!current) {
          return;
        }

        onLayout?.(createLayoutEvent(current, "keyboard", "start"));
        const step = event.shiftKey ? 50 : 10;
        const next = resizeSash(sashIndex, direction * step, "keyboard");
        if (next) {
          onLayout?.(createLayoutEvent(next, "keyboard", "commit"));
        }
      },
      [disabled, onLayout, orientation, resizeSash],
    );

    const handleCollapsedSashKeyDown = useCallback(
      (boundary: CollapsedBoundary, event: React.KeyboardEvent<HTMLDivElement>) => {
        if (disabled || keyToDeltaDirection(event.key, orientation) !== boundary.direction) {
          return;
        }

        event.preventDefault();
        revealPane(
          boundary.pane.id,
          restoredPaneSize(
            boundary.pane,
            sizeSnapshotRef.current,
            layoutRef.current?.containerSize ?? 0,
          ),
          "keyboard",
          true,
        );
      },
      [disabled, orientation, revealPane],
    );

    const rootClassName = [
      "worksplit",
      `worksplit-${orientation}`,
      disabled ? "worksplit-disabled" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        {...rest}
        ref={containerRef}
        className={rootClassName}
        data-orientation={orientation}
        style={{ "--worksplit-sash-size": `${sashSize}px`, ...style } as CSSProperties}
      >
        {paneElements.map((source) => {
          const item = layout?.items.find((candidate) => candidate.id === source.props.id);
          const shown = Boolean(item && resolvePaneVisible(source, visibility));
          if (!shown && !source.props.keepMounted) {
            return null;
          }

          return cloneElement(source, {
            key: source.props.id,
            hidden: shown ? source.props.hidden : true,
            inert: shown ? source.props.inert : true,
            "aria-hidden": shown ? source.props["aria-hidden"] : true,
            className: ["worksplit-pane", source.props.className].filter(Boolean).join(" "),
            style: {
              ...(item ? paneStyle(orientation, item.offset, item.size) : {}),
              ...source.props.style,
              ...(!shown ? { display: "none" } : {}),
            },
          });
        })}
        {layout?.items.slice(0, -1).map((item, index) => (
          <div
            aria-controls={`${item.id} ${layout.items[index + 1]!.id}`}
            aria-disabled={disabled || undefined}
            aria-label="Resize pane"
            aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
            aria-valuemax={separatorMax(layout, index)}
            aria-valuemin={separatorMin(layout, index)}
            aria-valuenow={layout.offsets[index + 1]}
            className="worksplit-sash"
            key={`${item.id}-sash`}
            onDoubleClick={reset}
            onKeyDown={(event) => handleSashKeyDown(index, event)}
            onPointerDown={(event) => startDrag(index, event)}
            role="separator"
            style={sashStyle(orientation, layout.offsets[index + 1]!, sashSize)}
            tabIndex={disabled ? -1 : 0}
          >
            {renderSash?.({
              afterId: layout.items[index + 1]!.id,
              beforeId: item.id,
              disabled,
              index,
              layout,
              offset: layout.offsets[index + 1]!,
              orientation,
            })}
          </div>
        ))}
        {layout &&
          getCollapsedBoundaries(layout).map((boundary) => (
            <div
              aria-disabled={disabled || undefined}
              aria-label={`Reveal ${boundary.pane.id} by dragging`}
              aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
              className="worksplit-sash worksplit-collapsed-sash"
              data-edge={boundary.edge}
              data-pane-id={boundary.pane.id}
              key={`${boundary.pane.id}-collapsed-sash`}
              onKeyDown={(event) => handleCollapsedSashKeyDown(boundary, event)}
              onPointerDown={(event) => startCollapsedDrag(boundary, event)}
              role="separator"
              style={sashStyle(orientation, boundary.offset, sashSize)}
              tabIndex={disabled ? -1 : 0}
            >
              {renderCollapsedPane?.({
                disabled,
                edge: boundary.edge,
                id: boundary.pane.id,
                index: boundary.index,
                layout,
                offset: boundary.offset,
                orientation,
                pane: boundary.pane,
              })}
            </div>
          ))}
      </div>
    );
  },
);

interface CollapsedBoundary {
  pane: PaneSnapshot;
  index: number;
  edge: "start" | "end" | "between";
  offset: number;
  direction: 1 | -1;
}

interface DragSnapState {
  pane: PaneSnapshot;
  collapseDelta: number;
  delay: number;
  threshold: number;
  timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  side: "before" | "after";
  size: number;
  snapped: boolean;
}

function getCollapsedBoundaries(layout: SplitLayout): CollapsedBoundary[] {
  const boundaries: CollapsedBoundary[] = [];

  layout.panes.forEach((pane, index) => {
    if (pane.visible) {
      return;
    }

    const previous = findVisiblePane(layout.panes, index, -1);
    const next = findVisiblePane(layout.panes, index, 1);
    if (previous && next) {
      boundaries.push({
        direction: 1,
        edge: "between",
        index,
        offset: next.offset,
        pane,
      });
      return;
    }
    if (next) {
      boundaries.push({
        direction: 1,
        edge: "start",
        index,
        offset: next.offset,
        pane,
      });
      return;
    }
    if (previous) {
      boundaries.push({
        direction: -1,
        edge: "end",
        index,
        offset: previous.offset + previous.size,
        pane,
      });
    }
  });

  return boundaries;
}

function findVisiblePane(
  panes: readonly PaneSnapshot[],
  startIndex: number,
  step: 1 | -1,
): PaneSnapshot | undefined {
  for (let index = startIndex + step; index >= 0 && index < panes.length; index += step) {
    const pane = panes[index];
    if (pane?.visible) {
      return pane;
    }
  }
  return undefined;
}

function createDragSnapState(
  layout: SplitLayout,
  panes: readonly PaneElement[],
  sashIndex: number,
  side: "before" | "after",
): DragSnapState | undefined {
  const pane = side === "before" ? layout.items[sashIndex] : layout.items[sashIndex + 1];
  const source = pane ? panes.find((element) => element.props.id === pane.id) : undefined;
  if (!pane || !source || !isPaneSnapEnabled(source)) {
    return undefined;
  }

  const threshold = resolveSnapThreshold(source, pane.minSize);
  const delay = resolveSnapCollapseDelay(source);
  const deltaToMinimum = side === "before" ? pane.minSize - pane.size : pane.size - pane.minSize;

  return {
    collapseDelta: deltaToMinimum,
    delay,
    pane,
    side,
    size: pane.size,
    snapped: false,
    threshold,
    timeout: undefined,
  };
}

function updateDragSnap(
  snap: DragSnapState | undefined,
  delta: number,
  collapsePane: (id: string, size?: number) => void,
  revealPane: (id: string, size?: number) => void,
): boolean {
  if (!snap || !Number.isFinite(delta)) {
    return false;
  }

  if (snap.snapped) {
    if (shouldRevealSnap(snap, delta)) {
      snap.snapped = false;
      revealPane(snap.pane.id, snap.size);
      return false;
    }
    return true;
  }

  if (!shouldArmCollapseSnap(snap, delta)) {
    clearDragSnapTimer(snap);
    return false;
  }

  if (!snap.timeout) {
    snap.timeout = globalThis.setTimeout(() => {
      snap.timeout = undefined;
      snap.snapped = true;
      collapsePane(snap.pane.id, snap.size);
    }, snap.delay);
  }

  return false;
}

function shouldArmCollapseSnap(snap: DragSnapState, delta: number): boolean {
  return snap.side === "before"
    ? delta <= snap.collapseDelta - snap.threshold
    : delta >= snap.collapseDelta + snap.threshold;
}

function shouldRevealSnap(snap: DragSnapState, delta: number): boolean {
  return snap.side === "before"
    ? delta >= snap.collapseDelta + snap.threshold
    : delta <= snap.collapseDelta - snap.threshold;
}

function clearDragSnapTimers(
  drag: {
    snapBefore?: DragSnapState | undefined;
    snapAfter?: DragSnapState | undefined;
  } | null,
): void {
  clearDragSnapTimer(drag?.snapBefore);
  clearDragSnapTimer(drag?.snapAfter);
}

function clearDragSnapTimer(snap: DragSnapState | undefined): void {
  if (!snap?.timeout) {
    return;
  }
  globalThis.clearTimeout(snap.timeout);
  snap.timeout = undefined;
}

function isPaneSnapEnabled(pane: PaneElement): boolean {
  return pane.props.snap ?? DEFAULT_SNAP;
}

function resolveSnapThreshold(pane: PaneElement, minSize: number): number {
  return Math.max(0, pane.props.snapThreshold ?? Math.min(DEFAULT_SNAP_INTENT_THRESHOLD, minSize));
}

function resolveSnapCollapseDelay(pane: PaneElement): number {
  return Math.max(0, pane.props.snapCollapseDelay ?? DEFAULT_SNAP_COLLAPSE_DELAY);
}

function collectPanes(children: ReactNode): PaneElement[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) {
      return [];
    }
    if (child.type === Fragment) {
      return collectPanes((child.props as { children?: ReactNode }).children);
    }
    return (child.type as { [PANE_COMPONENT]?: boolean })[PANE_COMPONENT]
      ? [child as PaneElement]
      : [];
  });
}

function createPaneModelSignature(panes: readonly PaneElement[]): string {
  return panes
    .map((pane, index) => {
      const props = pane.props;
      const id = props.id || `pane-${index}`;
      return [
        id,
        props.minSize,
        props.maxSize,
        props.collapsedSize,
        props.defaultSize,
        props.defaultVisible,
        props.priority,
        props.visible,
      ]
        .map((value) => String(value))
        .join(":");
    })
    .join("|");
}

function useStablePaneModelElements(
  paneElements: readonly PaneElement[],
  signature: string,
): readonly PaneElement[] {
  const ref = useRef<{ elements: readonly PaneElement[]; signature: string } | null>(null);
  if (!ref.current || ref.current.signature !== signature) {
    ref.current = { elements: paneElements, signature };
  }
  return ref.current.elements;
}

function resolvePaneVisible(pane: PaneElement, visibility: Record<string, boolean>): boolean {
  if (pane.props.visible !== undefined) {
    return pane.props.visible;
  }
  const stored = visibility[pane.props.id];
  if (stored !== undefined) {
    return stored;
  }
  return pane.props.defaultVisible !== false;
}

function mergeVisibleSizes(
  previous: Record<string, number>,
  layout: SplitLayout,
): Record<string, number> {
  const next = { ...previous };
  for (const pane of layout.panes) {
    if (pane.visible) {
      next[pane.id] = pane.size;
    }
  }
  return next;
}

function createLayoutEvent(
  layout: SplitLayout,
  reason: SplitViewLayoutReason,
  phase: SplitViewLayoutPhase,
): SplitViewLayoutEvent {
  return {
    layout,
    phase,
    reason,
    sizeById: { ...layout.sizeById },
    sizes: layout.sizes.slice(),
  };
}

function validatePanes(panes: readonly PaneElement[]): PaneElement[] {
  const ids = new Set<string>();
  for (const pane of panes) {
    const { id, minSize, maxSize } = pane.props;
    if (!id.trim()) {
      throw new Error("[Worksplit] Pane ids must be non-empty strings.");
    }
    if (ids.has(id)) {
      throw new Error(`[Worksplit] Duplicate pane id "${id}".`);
    }
    if (minSize !== undefined && maxSize !== undefined && minSize > maxSize) {
      throw new Error(
        `[Worksplit] Pane "${id}" has minSize ${minSize} greater than maxSize ${maxSize}.`,
      );
    }
    ids.add(id);
  }
  return [...panes];
}

function compactSizeSnapshot(
  value: Record<string, number | undefined> | undefined,
): Record<string, number> {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => {
      return typeof entry[1] === "number" && Number.isFinite(entry[1]);
    }),
  );
}

function isPaneVisible(pane: PaneConstraints): boolean {
  return pane.visible !== false;
}

function getPaneId(pane: PaneConstraints): string {
  return pane.id;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function keyToDeltaDirection(key: string, orientation: SplitOrientation): -1 | 0 | 1 {
  if (orientation === "horizontal") {
    if (key === "ArrowLeft") {
      return -1;
    }
    if (key === "ArrowRight") {
      return 1;
    }
    return 0;
  }

  if (key === "ArrowUp") {
    return -1;
  }
  if (key === "ArrowDown") {
    return 1;
  }
  return 0;
}

function sameSizes(left: readonly number[] | undefined, right: readonly number[]): boolean {
  return Boolean(
    left && left.length === right.length && left.every((size, index) => size === right[index]),
  );
}

function sameSplitLayout(left: SplitLayout | null, right: SplitLayout): boolean {
  return Boolean(
    left &&
    left.containerSize === right.containerSize &&
    left.contentSize === right.contentSize &&
    sameSizes(left.sizes, right.sizes) &&
    sameSizes(left.offsets, right.offsets) &&
    sameIds(left.visibleIds, right.visibleIds) &&
    samePaneSnapshots(left.panes, right.panes),
  );
}

function samePaneSnapshots(left: readonly PaneSnapshot[], right: readonly PaneSnapshot[]): boolean {
  return (
    left.length === right.length &&
    left.every((pane, index) => {
      const next = right[index];
      if (!next) {
        return false;
      }
      return (
        pane.id === next.id &&
        pane.collapsedSize === next.collapsedSize &&
        pane.defaultSize === next.defaultSize &&
        pane.maxSize === next.maxSize &&
        pane.minSize === next.minSize &&
        pane.offset === next.offset &&
        pane.priority === next.priority &&
        pane.size === next.size &&
        pane.visible === next.visible
      );
    })
  );
}

function separatorMin(layout: SplitLayout, sashIndex: number): number {
  return layout.items.slice(0, sashIndex + 1).reduce((offset, item) => offset + item.minSize, 0);
}

function separatorMax(layout: SplitLayout, sashIndex: number): number {
  return (
    layout.containerSize -
    layout.items.slice(sashIndex + 1).reduce((offset, item) => offset + item.minSize, 0)
  );
}

function preferredRestoreSize(
  pane: Pick<PaneConstraints, "id" | "defaultSize">,
  snapshots: Readonly<Record<string, number>>,
  containerSize: number,
): number | undefined {
  const remembered = snapshots[pane.id];
  return typeof remembered === "number" && Number.isFinite(remembered) && remembered > 0
    ? remembered
    : parsePaneSize(pane.defaultSize, containerSize);
}

function restoredPaneSize(
  pane: PaneSnapshot,
  snapshots: Record<string, number>,
  containerSize: number,
): number {
  const size = preferredRestoreSize(pane, snapshots, containerSize) ?? pane.minSize;
  return Math.max(pane.minSize, Math.min(size, pane.maxSize));
}

function restoreNewlyVisiblePaneSizes(
  previous: SplitLayout,
  next: SplitLayout,
  snapshots: Record<string, number>,
): SplitLayout {
  let restored = next;
  for (const pane of next.panes) {
    const wasVisible = previous.panes.some((previousPane) => {
      return previousPane.id === pane.id && previousPane.visible;
    });
    const snapshot = preferredRestoreSize(pane, snapshots, next.containerSize);
    if (pane.visible && !wasVisible && typeof snapshot === "number" && Number.isFinite(snapshot)) {
      restored = setPaneSize(restored, pane.id, snapshot);
    }
  }
  return restored;
}

function paneStyle(orientation: SplitOrientation, offset: number, size: number): CSSProperties {
  if (orientation === "horizontal") {
    return { left: offset, width: size, top: 0, bottom: 0 };
  }
  return { top: offset, height: size, left: 0, right: 0 };
}

function sashStyle(orientation: SplitOrientation, offset: number, sashSize: number): CSSProperties {
  const half = sashSize / 2;
  if (orientation === "horizontal") {
    return { left: offset - half, width: sashSize, top: 0, bottom: 0 };
  }
  return { top: offset - half, height: sashSize, left: 0, right: 0 };
}

function useResizeObserver(
  ref: React.RefObject<HTMLElement | null>,
  onResize: (entry: ResizeObserverEntry) => void,
): void {
  const onResizeRef = useRef(onResize);

  useIsomorphicLayoutEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        onResizeRef.current(entry);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
