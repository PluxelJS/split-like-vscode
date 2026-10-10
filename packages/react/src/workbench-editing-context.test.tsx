import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTestResizeObserver } from "./test-resize-observer";
import {
  Workbench,
  type WorkbenchEditingContext,
  type WorkbenchEditorArrangement,
  type WorkbenchEditorTab,
  type WorkbenchHandle,
  type WorkbenchView,
} from "./workbench";

installTestResizeObserver({ height: 600, width: 900 });

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tabs: WorkbenchEditorTab[] = ["origin", "left-two", "preview", "right-two"].map((id) => ({
  id,
  renderContent: () => <input aria-label={`${id} editor`} />,
  title: id,
}));
const arrangement: WorkbenchEditorArrangement = {
  groups: [
    { activeTabId: "origin", id: "left", tabIds: ["origin", "left-two"] },
    { activeTabId: "preview", id: "right", tabIds: ["preview", "right-two"] },
  ],
  layout: {
    children: [
      { node: { groupId: "left", type: "group" } },
      { node: { groupId: "right", type: "group" } },
    ],
    id: "root",
    orientation: "horizontal",
    type: "split",
  },
};
const defaultLayout = {
  editorArrangement: arrangement,
  panelPosition: "bottom" as const,
  value: { version: 1 as const },
  version: 1 as const,
};

function observeContext(handle: ReturnType<typeof createRef<WorkbenchHandle>>) {
  return vi.fn<(context: WorkbenchEditingContext) => void>((context) => {
    expect(handle.current?.getEditingContext()).toEqual(context);
  });
}

async function focus(element: HTMLElement) {
  await act(async () => {
    element.focus();
    await Promise.resolve();
  });
}

describe("Workbench editing context", () => {
  it("renders an empty catalog fallback without an editor identity through open and close transitions", async () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    const fallback = <button type="button">Open a document</button>;
    const { container, rerender, unmount } = render(
      <Workbench
        ref={handle}
        editorTabs={[]}
        editor={fallback}
        onEditingContextChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Open a document" })).toBeTruthy();
    expect(handle.current?.getLayout().editorArrangement?.groups).toEqual([]);
    expect(handle.current?.getValue().activeEditorTabs).toEqual({});
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: null,
      activeTabId: null,
    });
    expect(container.querySelector("[data-worksplit-editor-group]")).toBeNull();
    await focus(screen.getByRole("button", { name: "Open a document" }));
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: null,
      activeTabId: null,
      focusedArea: "editor",
    });

    rerender(
      <Workbench
        ref={handle}
        editorTabs={tabs}
        editor={fallback}
        onEditingContextChange={onChange}
      />,
    );
    expect(screen.queryByRole("button", { name: "Open a document" })).toBeNull();
    expect(handle.current?.getEditingContext().activeTabId).toBe("origin");

    rerender(
      <Workbench
        ref={handle}
        editorTabs={[]}
        editor={fallback}
        onEditingContextChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Open a document" })).toBeTruthy();
    expect(handle.current?.getLayout().editorArrangement?.groups).toEqual([]);
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: null,
      activeTabId: null,
    });

    unmount();
    render(<Workbench ref={handle} editor="Single editor" />);
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "main",
      activeTabId: "editor",
    });
  });

  it("initializes a valid editor and changes global group for an already selected tab", () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    const { container, rerender } = render(
      <Workbench
        ref={handle}
        defaultLayout={defaultLayout}
        editorTabs={tabs}
        onEditingContextChange={onChange}
      />,
    );
    expect(handle.current?.getEditingContext()).toEqual({
      activeGroupId: "left",
      activeTabId: "origin",
      focusedArea: null,
      windowFocused: true,
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      container
        .querySelector('[data-worksplit-editor-group="left"]')
        ?.getAttribute("data-worksplit-current-editor-group"),
    ).toBe("true");

    act(() => {
      handle.current?.activateEditorTab("right", "preview");
      expect(handle.current?.getEditingContext().activeGroupId).toBe("right");
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(
      container
        .querySelector('[data-worksplit-editor-group="left"]')
        ?.getAttribute("data-worksplit-current-editor-group"),
    ).toBe("false");
    expect(
      container
        .querySelector('[data-worksplit-editor-group="right"]')
        ?.getAttribute("data-worksplit-current-editor-group"),
    ).toBe("true");
    rerender(
      <Workbench
        ref={handle}
        defaultLayout={defaultLayout}
        editorTabs={[...tabs]}
        onEditingContextChange={onChange}
      />,
    );
    act(() => handle.current?.activateEditorTab("right", "preview"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("selects clicked, keyboard and context-menu tabs without publishing a background group's old tab", async () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    const onMenu = vi.fn<() => void>(() => {
      expect(handle.current?.getEditingContext().activeTabId).toBe("left-two");
    });
    render(
      <Workbench
        ref={handle}
        defaultLayout={defaultLayout}
        editorTabs={tabs}
        onEditingContextChange={onChange}
        onEditorTabContextMenu={onMenu}
      />,
    );
    onChange.mockClear();
    const targetTab = screen.getByRole("tab", { name: "right-two" });
    fireEvent.pointerDown(targetTab, { button: 0 });
    await focus(targetTab);
    expect(handle.current?.getValue().activeEditorTabs["right"]).toBe("preview");
    fireEvent.click(targetTab);
    expect(handle.current?.getEditingContext().activeTabId).toBe("right-two");
    expect(onChange.mock.calls.map(([context]) => context.activeTabId)).not.toContain("preview");

    fireEvent.keyDown(targetTab, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "preview" }));
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "right",
      activeTabId: "preview",
      focusedArea: "editor",
    });
    fireEvent.contextMenu(screen.getByRole("tab", { name: "left-two" }));
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(handle.current?.getEditingContext().activeGroupId).toBe("left");
  });

  it("retains the editor through native DOM sidebar, sibling-React portal, header and window focus", async () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    const reactFocus = vi.fn<() => void>();
    const portalContainer = document.createElement("div");
    const views: WorkbenchView[] = [
      {
        defaultActive: true,
        id: "explorer",
        part: "primary",
        renderContent: () => <input aria-label="Explorer" />,
      },
      {
        defaultActive: true,
        defaultVisible: true,
        id: "assistant",
        part: "secondary",
        renderContent: () => (
          <div
            ref={(element) => {
              if (element && portalContainer.parentElement !== element) {
                element.append(portalContainer);
              }
            }}
          />
        ),
      },
      {
        defaultActive: true,
        defaultVisible: true,
        id: "terminal",
        part: "panel",
        renderContent: () => <input aria-label="Terminal" />,
      },
    ];
    const { container } = render(
      <>
        <input aria-label="Header" />
        <Workbench
          ref={handle}
          defaultLayout={defaultLayout}
          editorTabs={tabs}
          onEditingContextChange={onChange}
          onFocusCapture={reactFocus}
          views={views}
        />
        {createPortal(<input aria-label="Assistant portal" />, portalContainer)}
      </>,
    );

    fireEvent.pointerDown(screen.getByLabelText("preview editor"), { button: 0 });
    await focus(screen.getByLabelText("preview editor"));
    expect(handle.current?.getEditingContext().activeGroupId).toBe("right");
    await focus(screen.getByLabelText("Explorer"));
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "right",
      activeTabId: "preview",
      focusedArea: "primary",
    });

    reactFocus.mockClear();
    await focus(screen.getByLabelText("Assistant portal"));
    expect(reactFocus).not.toHaveBeenCalled();
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "right",
      activeTabId: "preview",
      focusedArea: "secondary",
    });
    expect(
      container.querySelector(".worksplit-workbench")?.getAttribute("data-worksplit-focused-area"),
    ).toBe("secondary");

    await focus(screen.getByLabelText("Terminal"));
    expect(handle.current?.getEditingContext().focusedArea).toBe("panel");
    await focus(screen.getByLabelText("Header"));
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "right",
      activeTabId: "preview",
      focusedArea: null,
    });
    fireEvent.blur(window);
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "right",
      activeTabId: "preview",
      windowFocused: false,
    });
    expect(
      container
        .querySelector(".worksplit-workbench")
        ?.getAttribute("data-worksplit-window-focused"),
    ).toBe("false");
    fireEvent.focus(window);
    expect(handle.current?.getEditingContext().windowFocused).toBe(true);
  });

  it("activates successful tab moves and follows the current tab synchronously", () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    render(
      <Workbench
        ref={handle}
        defaultLayout={defaultLayout}
        editorTabs={tabs}
        onEditingContextChange={onChange}
      />,
    );
    act(() => {
      handle.current?.moveEditorTab({
        sourceGroupId: "right",
        tabId: "preview",
        target: { groupId: "left", index: 2, kind: "tab-strip" },
      });
      expect(handle.current?.getEditingContext()).toMatchObject({
        activeGroupId: "left",
        activeTabId: "preview",
      });
      handle.current?.activateEditorTab("left", "origin");
    });
    expect(handle.current?.getEditingContext().activeTabId).toBe("origin");
    act(() => {
      handle.current?.moveEditorTab({
        sourceGroupId: "left",
        tabId: "origin",
        target: { groupId: "right", index: 0, kind: "tab-strip" },
      });
      expect(handle.current?.getEditingContext()).toMatchObject({
        activeGroupId: "right",
        activeTabId: "origin",
      });
    });
    expect(handle.current?.getEditingContext().activeGroupId).toBe("right");
    act(() => {
      handle.current?.moveEditorTab({
        sourceGroupId: "left",
        tabId: "left-two",
        target: { groupId: "right", index: 1, kind: "tab-strip" },
      });
      expect(handle.current?.getEditingContext()).toMatchObject({
        activeGroupId: "right",
        activeTabId: "left-two",
      });
    });
  });

  it("activates an unselected dragged tab at its destination only after the drop", () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    render(
      <Workbench
        ref={handle}
        defaultLayout={defaultLayout}
        editorTabs={tabs}
        onEditingContextChange={onChange}
      />,
    );
    onChange.mockClear();
    const dragged = screen.getByRole("tab", { name: "left-two" });
    const target = screen.getByRole("tab", { name: "preview" });
    const targetStrip = target.closest<HTMLElement>("[data-worksplit-editor-tabs]")!;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn<() => HTMLElement>(() => targetStrip),
    });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      bottom: 35,
      height: 35,
      left: 500,
      right: 600,
      top: 0,
      width: 100,
      x: 500,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(dragged, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 590, clientY: 10 });
    expect(handle.current?.getEditingContext().activeTabId).toBe("origin");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(document, { clientX: 590, clientY: 10 });
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "right",
      activeTabId: "left-two",
    });
    expect(onChange.mock.calls.map(([context]) => context.activeTabId)).toEqual(["left-two"]);
  });

  it("keeps editing context when a tab move is vetoed", () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    render(
      <Workbench
        ref={handle}
        defaultLayout={defaultLayout}
        editorTabs={tabs}
        onEditingContextChange={onChange}
        canMoveEditorTab={() => false}
      />,
    );
    onChange.mockClear();
    act(() => {
      handle.current?.moveEditorTab({
        sourceGroupId: "right",
        tabId: "right-two",
        target: { groupId: "left", index: 1, kind: "tab-strip" },
      });
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(handle.current?.getEditingContext().activeTabId).toBe("origin");
  });

  it("reads accepted controlled selection and never emits a rejected proposal", () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    const onArrangement = vi.fn<(next: WorkbenchEditorArrangement) => void>();
    render(
      <Workbench
        ref={handle}
        editorArrangement={arrangement}
        editorTabs={tabs}
        onEditingContextChange={onChange}
        onEditorArrangementChange={onArrangement}
      />,
    );
    onChange.mockClear();
    act(() => {
      handle.current?.activateEditorTab("left", "left-two");
      expect(handle.current?.getEditingContext().activeTabId).toBe("origin");
      handle.current?.moveEditorTab({
        sourceGroupId: "left",
        tabId: "origin",
        target: { groupId: "right", index: 0, kind: "tab-strip" },
      });
      expect(handle.current?.getEditingContext().activeGroupId).toBe("left");
    });
    expect(onArrangement).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();
    expect(handle.current?.getLayout().editorArrangement?.groups).toEqual(arrangement.groups);
  });

  it("publishes only the final controlled preview placement and retains the origin DOM focus", async () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    function ControlledWorkbench() {
      const [accepted, setAccepted] = useState(arrangement);
      return (
        <Workbench
          ref={handle}
          editorArrangement={accepted}
          editorTabs={tabs}
          onEditingContextChange={onChange}
          onEditorArrangementChange={setAccepted}
        />
      );
    }
    render(<ControlledWorkbench />);
    const originInput = screen.getByLabelText("origin editor");
    await focus(originInput);
    onChange.mockClear();
    act(() => {
      handle.current?.restoreEditorGroups();
      handle.current?.moveEditorTab({
        sourceGroupId: "right",
        tabId: "preview",
        target: {
          kind: "split",
          newGroupId: "preview-group",
          position: "right",
          targetGroupId: "left",
        },
      });
      handle.current?.activateEditorTab("preview-group", "preview");
      handle.current?.activateEditorTab("left", "origin");
      expect(handle.current?.getEditingContext().activeTabId).toBe("origin");
    });
    expect(handle.current?.getLayout().editorArrangement?.groups).toContainEqual({
      activeTabId: "preview",
      id: "preview-group",
      tabIds: ["preview"],
    });
    expect(document.activeElement).toBe(originInput);
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      handle.current?.activateEditorTab("preview-group", "preview");
      handle.current?.maximizeEditorGroup("preview-group");
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "preview-group",
      activeTabId: "preview",
    });
  });

  it("converges controlled moves, closing tabs, removing the current group and an empty catalog", () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    const { rerender } = render(
      <Workbench
        ref={handle}
        editorArrangement={arrangement}
        editorTabs={tabs}
        onEditingContextChange={onChange}
      />,
    );
    const moved: WorkbenchEditorArrangement = {
      ...arrangement,
      groups: [
        { activeTabId: "left-two", id: "left", tabIds: ["left-two"] },
        { activeTabId: "origin", id: "right", tabIds: ["origin", "preview", "right-two"] },
      ],
    };
    rerender(
      <Workbench
        ref={handle}
        editorArrangement={moved}
        editorTabs={tabs}
        onEditingContextChange={onChange}
      />,
    );
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "right",
      activeTabId: "origin",
    });

    onChange.mockClear();
    const withoutOrigin = tabs.filter((tab) => tab.id !== "origin");
    rerender(
      <Workbench
        ref={handle}
        editorArrangement={moved}
        editorTabs={withoutOrigin}
        onEditingContextChange={onChange}
      />,
    );
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "right",
      activeTabId: "preview",
    });
    expect(onChange.mock.calls.map(([context]) => context.activeTabId)).toEqual(["preview"]);

    onChange.mockClear();
    rerender(
      <Workbench
        ref={handle}
        editorArrangement={moved}
        editorTabs={tabs.filter((tab) => tab.id === "left-two")}
        onEditingContextChange={onChange}
      />,
    );
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: "left",
      activeTabId: "left-two",
    });
    expect(onChange.mock.calls.map(([context]) => context.activeTabId)).toEqual(["left-two"]);

    onChange.mockClear();
    rerender(
      <Workbench
        ref={handle}
        editorArrangement={moved}
        editorTabs={[]}
        onEditingContextChange={onChange}
      />,
    );
    expect(handle.current?.getEditingContext()).toMatchObject({
      activeGroupId: null,
      activeTabId: null,
    });
    expect(onChange.mock.calls.map(([context]) => context.activeTabId)).toEqual([null]);
  });

  it("cleans up native DOM and window listeners on unmount", async () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange = observeContext(handle);
    const documentRemoval = vi.spyOn(document, "removeEventListener");
    const windowRemoval = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <Workbench
        ref={handle}
        defaultLayout={defaultLayout}
        editorTabs={tabs}
        onEditingContextChange={onChange}
      />,
    );
    await focus(screen.getByLabelText("origin editor"));
    onChange.mockClear();
    unmount();
    for (const name of ["focusin", "focusout", "pointerdown"]) {
      expect(documentRemoval.mock.calls.some(([type]) => type === name)).toBe(true);
    }
    for (const name of ["focus", "blur"]) {
      expect(windowRemoval.mock.calls.some(([type]) => type === name)).toBe(true);
    }
    fireEvent.focusIn(document.body);
    fireEvent.pointerDown(document.body);
    fireEvent.blur(window);
    expect(onChange).not.toHaveBeenCalled();
  });
});
