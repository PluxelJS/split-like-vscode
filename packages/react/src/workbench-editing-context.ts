/* oxlint-disable react/refs -- The synchronous handle reads the last editing operation and accepted arrangement. */
import type { EditorArrangement } from "@worksplit/core";
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

export type WorkbenchEditingContext = {
  activeGroupId: string | null;
  activeTabId: string | null;
  focusedArea: "editor" | "primary" | "secondary" | "panel" | null;
  windowFocused: boolean;
};

type EditingAnchor = Pick<WorkbenchEditingContext, "activeGroupId" | "activeTabId">;

export function useWorkbenchEditingContext(options: {
  arrangementRef: RefObject<EditorArrangement>;
  rootRef: RefObject<HTMLDivElement | null>;
  activateEditorTabRef: RefObject<(groupId: string, tabId: string) => void>;
  onChange: ((context: WorkbenchEditingContext) => void) | undefined;
}) {
  const { arrangementRef, rootRef, activateEditorTabRef, onChange } = options;
  const anchorRef = useRef<EditingAnchor>({ activeGroupId: null, activeTabId: null });
  const windowFocusedRef = useRef(typeof document !== "undefined" && document.hasFocus());
  const publishedRef = useRef<WorkbenchEditingContext | null>(null);
  const onChangeRef = useRef(onChange);
  const [, setRevision] = useState(0);
  onChangeRef.current = onChange;

  const invalidate = useCallback(() => setRevision((revision) => revision + 1), []);
  const getEditingContext = useCallback((): WorkbenchEditingContext => {
    const arrangement = arrangementRef.current;
    const anchor = anchorRef.current;
    // The previous tab is only an identity anchor for moves. Selection is always read
    // from the accepted arrangement, including when a controlled proposal is rejected.
    const group =
      arrangement.groups.find((candidate) => candidate.tabIds.includes(anchor.activeTabId ?? "")) ??
      arrangement.groups.find(
        (candidate) => candidate.id === anchor.activeGroupId && candidate.activeTabId,
      ) ??
      arrangement.groups.find((candidate) => candidate.activeTabId);
    const root = rootRef.current;
    return {
      activeGroupId: group?.id ?? null,
      activeTabId: group?.activeTabId ?? null,
      focusedArea:
        root && windowFocusedRef.current
          ? focusedAreaForTarget(root, root.ownerDocument.activeElement)
          : null,
      windowFocused: windowFocusedRef.current,
    };
  }, [arrangementRef, rootRef]);

  const activateEditingContext = useCallback(
    (groupId: string, tabId: string) => {
      const previous = getEditingContext();
      anchorRef.current = { activeGroupId: groupId, activeTabId: tabId };
      if (!sameEditingContext(previous, getEditingContext())) {
        invalidate();
      }
    },
    [getEditingContext, invalidate],
  );

  const publishEditingContext = useCallback(
    (renderedContext: WorkbenchEditingContext) => {
      const context = getEditingContext();
      anchorRef.current = {
        activeGroupId: context.activeGroupId,
        activeTabId: context.activeTabId,
      };
      // Removing focused content can change DOM focus during the commit itself.
      if (!sameEditingContext(renderedContext, context)) {
        invalidate();
      }
      if (!publishedRef.current || !sameEditingContext(publishedRef.current, context)) {
        publishedRef.current = { ...context };
        onChangeRef.current?.(context);
      }
    },
    [getEditingContext, invalidate],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    const ownerDocument = root?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    if (!root || !ownerDocument || !ownerWindow) {
      return;
    }
    let mounted = true;
    const activateTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !root.contains(target)) {
        return;
      }
      const groupElement = target.closest<HTMLElement>("[data-worksplit-editor-group]");
      const groupId = groupElement?.dataset["worksplitEditorGroup"];
      if (!groupId) {
        return;
      }
      const tab = target.closest<HTMLElement>("[data-worksplit-editor-tab]");
      // Tab decorations and close buttons outside the native tab must not first
      // activate the group's previous tab. Content uses the accepted selected tab.
      if (!tab && !target.closest("[data-worksplit-editor-content]")) {
        return;
      }
      const tabId =
        tab?.dataset["worksplitEditorTab"] ??
        arrangementRef.current.groups.find((group) => group.id === groupId)?.activeTabId;
      if (
        tab &&
        arrangementRef.current.groups.find((group) => group.id === groupId)?.activeTabId !== tabId
      ) {
        // A drag press does not select another tab. Click, roving keys and the
        // context-menu handler select it atomically with the global editor group.
        return;
      }
      if (tabId) {
        activateEditorTabRef.current(groupId, tabId);
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      activateTarget(event.target);
      invalidate();
    };
    const handleFocusOut = () => {
      queueMicrotask(() => {
        if (mounted) {
          invalidate();
        }
      });
    };
    const handlePointerDown = (event: PointerEvent) => activateTarget(event.target);
    const handleWindowFocus = () => {
      windowFocusedRef.current = true;
      invalidate();
    };
    const handleWindowBlur = () => {
      windowFocusedRef.current = false;
      invalidate();
    };

    // Native listeners also observe portals mounted into a part from another
    // React tree. DOM focus never clears the remembered editor selection.
    ownerDocument.addEventListener("focusin", handleFocusIn);
    ownerDocument.addEventListener("focusout", handleFocusOut);
    ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
    ownerWindow.addEventListener("focus", handleWindowFocus);
    ownerWindow.addEventListener("blur", handleWindowBlur);
    return () => {
      mounted = false;
      ownerDocument.removeEventListener("focusin", handleFocusIn);
      ownerDocument.removeEventListener("focusout", handleFocusOut);
      ownerDocument.removeEventListener("pointerdown", handlePointerDown, true);
      ownerWindow.removeEventListener("focus", handleWindowFocus);
      ownerWindow.removeEventListener("blur", handleWindowBlur);
    };
  }, [activateEditorTabRef, arrangementRef, invalidate, rootRef]);

  return {
    editingContext: getEditingContext(),
    getEditingContext,
    activateEditingContext,
    publishEditingContext,
  };
}

function focusedAreaForTarget(
  root: HTMLElement,
  target: EventTarget | null,
): WorkbenchEditingContext["focusedArea"] {
  if (!(target instanceof Element) || !root.contains(target)) {
    return null;
  }
  if (target.closest(".worksplit-workbench-editor")) {
    return "editor";
  }
  const part = target.closest<HTMLElement>("[data-worksplit-part]")?.dataset["worksplitPart"];
  return part === "primary" || part === "secondary" || part === "panel" ? part : null;
}

function sameEditingContext(left: WorkbenchEditingContext, right: WorkbenchEditingContext) {
  return (
    left.activeGroupId === right.activeGroupId &&
    left.activeTabId === right.activeTabId &&
    left.focusedArea === right.focusedArea &&
    left.windowFocused === right.windowFocused
  );
}
