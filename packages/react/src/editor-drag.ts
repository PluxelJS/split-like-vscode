import type { EditorArrangement, EditorGridDirection, MoveEditorTabOptions } from "@worksplit/core";

export interface EditorDropRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

export type EditorGroupDropPosition = EditorGridDirection | "center";

export function resolveEditorGroupDropPosition(
  rect: EditorDropRect,
  clientX: number,
  clientY: number,
  edgeRatio = 0.1,
  previousPosition?: EditorGridDirection,
): EditorGroupDropPosition {
  if (rect.width <= 0 || rect.height <= 0) {
    return "center";
  }

  const distances: readonly [EditorGridDirection, number][] = [
    ["left", (clientX - rect.left) / rect.width],
    ["right", (rect.right - clientX) / rect.width],
    ["top", (clientY - rect.top) / rect.height],
    ["bottom", (rect.bottom - clientY) / rect.height],
  ];
  if (
    previousPosition &&
    distances.some(([edge, distance]) => edge === previousPosition && distance <= 1 / 3)
  ) {
    return previousPosition;
  }
  const nearest = distances.toSorted((left, right) => left[1] - right[1])[0];
  return nearest && nearest[1] <= edgeRatio ? nearest[0] : "center";
}

export function resolveTabInsertionIndex(
  tabs: readonly Pick<DOMRect, "left" | "right">[],
  clientX: number,
): number {
  const index = tabs.findIndex((tab) => clientX < tab.left + (tab.right - tab.left) / 2);
  return index < 0 ? tabs.length : index;
}

export interface EditorTabDragHandle {
  cancel(): void;
  invalidateGeometry(): void;
}

interface EditorTabDragOptions {
  clientX: number;
  clientY: number;
  newGroupId: string;
  pointerId: number;
  sourceGroupId: string;
  tabId: string;
  title: string;
  readArrangement(): EditorArrangement;
  resolveMove(options: MoveEditorTabOptions): EditorArrangement | null;
  onDrop(options: MoveEditorTabOptions, arrangement: EditorArrangement): void;
  onDragStart(): void;
  onDragEnd(dragged: boolean): void;
}

interface EditorGroupGeometry {
  content: HTMLElement;
  contentRect: EditorDropRect;
  element: HTMLElement;
  groupId: string;
  strip: HTMLElement | null;
  stripRect: EditorDropRect | null;
  tabs: readonly { id: string; rect: EditorDropRect }[];
}

interface EditorDragGeometry {
  groups: ReadonlyMap<HTMLElement, EditorGroupGeometry>;
  originX: number;
  originY: number;
}

interface EditorDropPreview {
  arrangement: EditorArrangement | null;
  groupId: string;
  kind: "center" | "split" | "tab-strip";
  options: MoveEditorTabOptions;
  position?: EditorGridDirection;
  rect: EditorDropRect;
}

/** Owns one pointer gesture. Feedback never changes tab placement or renders React content. */
export function beginEditorTabDrag(
  root: HTMLElement,
  options: EditorTabDragOptions,
): EditorTabDragHandle {
  const ownerDocument = root.ownerDocument;
  const ownerWindow = ownerDocument.defaultView!;
  let point = { x: options.clientX, y: options.clientY };
  let dragging = false;
  let finished = false;
  let frame: number | undefined;
  let geometry: EditorDragGeometry | undefined;
  let geometryDirty = true;
  let geometryArrangement: EditorArrangement | undefined;
  let previousSplit: { groupId: string; position: EditorGridDirection } | undefined;
  let layer: HTMLDivElement | undefined;
  let indicator: HTMLDivElement | undefined;
  let ghost: HTMLDivElement | undefined;
  let indicatorKey: string | undefined;
  let ghostAllowed: boolean | undefined;
  const observed = new Set<Element>();

  const scheduleFrame = () => {
    if (!dragging || finished || frame !== undefined) {
      return;
    }
    frame = ownerWindow.requestAnimationFrame(() => {
      frame = undefined;
      try {
        const preview = readPreview();
        if (finished) {
          return;
        }
        writeFeedback(preview);
        observeGeometry();
      } catch (error) {
        cleanup();
        throw error;
      }
    });
  };

  const invalidateGeometry = () => {
    geometryDirty = true;
    scheduleFrame();
  };
  const observer = new (ownerWindow.ResizeObserver ?? ResizeObserver)(invalidateGeometry);

  const readGeometry = (): EditorDragGeometry => {
    const rootRect = readDropRect(root);
    const groups = new Map<HTMLElement, EditorGroupGeometry>();
    for (const element of root.querySelectorAll<HTMLElement>("[data-worksplit-editor-group]")) {
      if (element.closest(".worksplit-workbench") !== root) {
        continue;
      }
      const groupId = element.getAttribute("data-worksplit-editor-group")!;
      const content = element.querySelector<HTMLElement>(
        ":scope > [data-worksplit-editor-content]",
      );
      if (!content) {
        continue;
      }
      const strip = element.querySelector<HTMLElement>(":scope > [data-worksplit-editor-tabs]");
      groups.set(element, {
        content,
        contentRect: readDropRect(content),
        element,
        groupId,
        strip,
        stripRect: strip ? readDropRect(strip) : null,
        tabs: [...(strip?.querySelectorAll<HTMLElement>("[data-worksplit-editor-tab]") ?? [])].map(
          (tab) => ({
            id: tab.getAttribute("data-worksplit-editor-tab")!,
            rect: readDropRect(tab),
          }),
        ),
      });
    }
    return {
      groups,
      originX: rootRect.left + root.clientLeft,
      originY: rootRect.top + root.clientTop,
    };
  };

  const observeGeometry = () => {
    const next = new Set<Element>([root]);
    for (const group of geometry?.groups.values() ?? []) {
      next.add(group.element);
      next.add(group.content);
      if (group.strip) {
        next.add(group.strip);
      }
    }
    for (const element of observed) {
      if (!next.has(element)) {
        observer.unobserve(element);
        observed.delete(element);
      }
    }
    for (const element of next) {
      if (!observed.has(element)) {
        observed.add(element);
        observer.observe(element);
      }
    }
  };

  const readPreview = (): EditorDropPreview | null => {
    const arrangement = options.readArrangement();
    if (geometryDirty || geometryArrangement !== arrangement || !geometry) {
      geometry = readGeometry();
      geometryArrangement = arrangement;
      geometryDirty = false;
    }
    const target = ownerDocument.elementFromPoint(point.x, point.y);
    const element = target?.closest<HTMLElement>("[data-worksplit-editor-group]");
    const group = element ? geometry.groups.get(element) : undefined;
    const source = arrangement.groups.find((candidate) => candidate.id === options.sourceGroupId);
    if (!group || !source?.tabIds.includes(options.tabId)) {
      previousSplit = undefined;
      return null;
    }
    let preview: Omit<EditorDropPreview, "arrangement">;
    if (group.strip && target && group.strip.contains(target) && group.stripRect) {
      const rawIndex = resolveTabInsertionIndex(
        group.tabs.map((tab) => tab.rect),
        point.x,
      );
      const sourceIndex = group.tabs.findIndex((tab) => tab.id === options.tabId);
      const index =
        group.groupId === options.sourceGroupId && sourceIndex >= 0 && rawIndex > sourceIndex
          ? rawIndex - 1
          : rawIndex;
      const lineX =
        group.tabs[rawIndex]?.rect.left ?? group.tabs.at(-1)?.rect.right ?? group.stripRect.left;
      const left = Math.max(group.stripRect.left, Math.min(lineX, group.stripRect.right - 2));
      preview = {
        groupId: group.groupId,
        kind: "tab-strip",
        options: {
          sourceGroupId: options.sourceGroupId,
          tabId: options.tabId,
          target: { groupId: group.groupId, index, kind: "tab-strip" },
        },
        rect: { ...group.stripRect, left, right: left + 2, width: 2 },
      };
    } else {
      const position = resolveEditorGroupDropPosition(
        group.contentRect,
        point.x,
        point.y,
        0.1,
        previousSplit?.groupId === group.groupId ? previousSplit.position : undefined,
      );
      const targetGroup = arrangement.groups.find((candidate) => candidate.id === group.groupId);
      if (!targetGroup) {
        previousSplit = undefined;
        return null;
      }
      preview = {
        groupId: group.groupId,
        kind: position === "center" ? "center" : "split",
        options: {
          sourceGroupId: options.sourceGroupId,
          tabId: options.tabId,
          target:
            position === "center"
              ? {
                  groupId: group.groupId,
                  index:
                    targetGroup.tabIds.length - (group.groupId === options.sourceGroupId ? 1 : 0),
                  kind: "tab-strip",
                }
              : {
                  kind: "split",
                  newGroupId: options.newGroupId,
                  position,
                  targetGroupId: group.groupId,
                },
        },
        ...(position === "center" ? {} : { position }),
        rect:
          position === "center" ? group.contentRect : splitDropRect(group.contentRect, position),
      };
    }
    const next = options.resolveMove(preview.options);
    previousSplit =
      next && preview.position ? { groupId: group.groupId, position: preview.position } : undefined;
    return { ...preview, arrangement: next };
  };

  // Every rectangle read above finishes before feedback is created or updated.
  const writeFeedback = (preview: EditorDropPreview | null) => {
    if (!layer) {
      layer = ownerDocument.createElement("div");
      layer.className = "worksplit-workbench-editor-drag-layer";
      layer.setAttribute("aria-hidden", "true");
      indicator = ownerDocument.createElement("div");
      ghost = ownerDocument.createElement("div");
      ghost.className = "worksplit-workbench-editor-drag-ghost";
      ghost.textContent = options.title;
      ghost.setAttribute("data-worksplit-editor-drag", options.tabId);
      layer.append(indicator, ghost);
      root.append(layer);
      root.classList.add("worksplit-workbench-editor-dragging");
    }
    const allowed = preview?.arrangement !== null && preview !== null;
    if (ghostAllowed !== allowed) {
      ghostAllowed = allowed;
      ghost!.classList.toggle("worksplit-workbench-editor-drag-blocked", !allowed);
      ghost!.setAttribute("data-worksplit-drop-allowed", String(allowed));
      root.classList.toggle("worksplit-workbench-editor-drag-blocked", !allowed);
    }
    ghost!.style.transform = `translate(${point.x - geometry!.originX + 12}px, ${point.y - geometry!.originY + 16}px)`;
    const key =
      preview && allowed
        ? [
            preview.kind,
            preview.position,
            preview.groupId,
            preview.rect.left,
            preview.rect.top,
            preview.rect.width,
            preview.rect.height,
            geometry!.originX,
            geometry!.originY,
          ].join(":")
        : "blocked";
    if (key === indicatorKey) {
      return;
    }
    indicatorKey = key;
    indicator!.hidden = !allowed;
    if (!preview || !allowed) {
      return;
    }
    indicator!.className =
      preview.kind === "tab-strip"
        ? "worksplit-workbench-editor-tab-drop"
        : `worksplit-workbench-editor-drop worksplit-workbench-editor-drop-${preview.position ?? "center"}`;
    indicator!.setAttribute("data-worksplit-drop-group", preview.groupId);
    indicator!.setAttribute("data-worksplit-drop-kind", preview.kind);
    indicator!.style.left = `${preview.rect.left - geometry!.originX}px`;
    indicator!.style.top = `${preview.rect.top - geometry!.originY}px`;
    indicator!.style.width = `${preview.rect.width}px`;
    indicator!.style.height = `${preview.rect.height}px`;
  };

  const cleanup = () => {
    if (finished) {
      return;
    }
    finished = true;
    if (frame !== undefined) {
      ownerWindow.cancelAnimationFrame(frame);
    }
    observer.disconnect();
    ownerDocument.removeEventListener("pointermove", handleMove);
    ownerDocument.removeEventListener("pointerup", handleUp);
    ownerDocument.removeEventListener("pointercancel", handleCancel);
    ownerDocument.removeEventListener("keydown", handleKeyDown, true);
    ownerDocument.removeEventListener("scroll", invalidateGeometry, true);
    ownerWindow.removeEventListener("resize", invalidateGeometry);
    ownerWindow.removeEventListener("blur", cleanup);
    layer?.remove();
    root.classList.remove(
      "worksplit-workbench-editor-dragging",
      "worksplit-workbench-editor-drag-blocked",
    );
    options.onDragEnd(dragging);
  };

  const handleMove = (event: PointerEvent) => {
    if (event.pointerId !== options.pointerId) {
      return;
    }
    point = { x: event.clientX, y: event.clientY };
    if (!dragging) {
      if (Math.hypot(point.x - options.clientX, point.y - options.clientY) < 4) {
        return;
      }
      dragging = true;
      options.onDragStart();
    }
    event.preventDefault();
    scheduleFrame();
  };
  const handleUp = (event: PointerEvent) => {
    if (event.pointerId !== options.pointerId) {
      return;
    }
    point = { x: event.clientX, y: event.clientY };
    // Pointerup may arrive before the queued frame, or carry a newer hit point.
    try {
      geometryDirty = true;
      const preview = dragging ? readPreview() : null;
      cleanup();
      if (preview?.arrangement) {
        options.onDrop(preview.options, preview.arrangement);
      }
    } catch (error) {
      cleanup();
      throw error;
    }
  };
  const handleCancel = (event: PointerEvent) => {
    if (event.pointerId === options.pointerId) {
      cleanup();
    }
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (dragging) {
        event.preventDefault();
      }
      cleanup();
    }
  };

  ownerDocument.addEventListener("pointermove", handleMove);
  ownerDocument.addEventListener("pointerup", handleUp);
  ownerDocument.addEventListener("pointercancel", handleCancel);
  ownerDocument.addEventListener("keydown", handleKeyDown, true);
  ownerDocument.addEventListener("scroll", invalidateGeometry, true);
  ownerWindow.addEventListener("resize", invalidateGeometry);
  ownerWindow.addEventListener("blur", cleanup);
  return { cancel: cleanup, invalidateGeometry };
}

function readDropRect(element: HTMLElement): EditorDropRect {
  const rect = element.getBoundingClientRect();
  // DOMRect fields are prototype accessors; object spread does not copy them.
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  };
}

function splitDropRect(rect: EditorDropRect, position: EditorGridDirection): EditorDropRect {
  switch (position) {
    case "left":
      return { ...rect, right: rect.left + rect.width / 2, width: rect.width / 2 };
    case "right":
      return { ...rect, left: rect.left + rect.width / 2, width: rect.width / 2 };
    case "top":
      return { ...rect, bottom: rect.top + rect.height / 2, height: rect.height / 2 };
    case "bottom":
      return { ...rect, top: rect.top + rect.height / 2, height: rect.height / 2 };
  }
}
