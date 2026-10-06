import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installTestResizeObserver } from "./test-resize-observer";
import {
  Workbench,
  type WorkbenchEditorArrangement,
  type WorkbenchEditorGroup,
  type WorkbenchHandle,
  type WorkbenchEditorTab,
  type WorkbenchView,
} from "./workbench";

installTestResizeObserver({ height: 600, width: 900 });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const views: WorkbenchView[] = [
  {
    defaultActive: true,
    icon: <span>E</span>,
    id: "explorer",
    part: "primary",
    renderContent: () => <div>Explorer View</div>,
    title: "Explorer",
  },
  {
    defaultActive: true,
    icon: <span>T</span>,
    id: "terminal",
    part: "panel",
    renderContent: () => <div>Terminal View</div>,
    title: "Terminal",
  },
  {
    defaultActive: true,
    icon: <span>I</span>,
    id: "inspector",
    part: "secondary",
    renderContent: () => <div>Inspector View</div>,
    title: "Inspector",
  },
];

const editorGroups: WorkbenchEditorGroup[] = [
  {
    id: "left",
    tabs: [
      {
        id: "app",
        renderContent: () => <div>App editor</div>,
        title: "App.tsx",
      },
      {
        id: "workbench",
        renderContent: () => <div>Workbench editor</div>,
        title: "Workbench.tsx",
      },
    ],
  },
  {
    id: "right",
    tabs: [
      {
        id: "preview",
        renderContent: () => <div>Preview editor</div>,
        title: "Preview",
      },
    ],
  },
];

const recursiveEditorGroups: WorkbenchEditorGroup[] = [
  ...editorGroups,
  {
    id: "bottom",
    tabs: [
      {
        id: "terminal",
        renderContent: () => <div>Embedded terminal</div>,
        title: "Terminal",
      },
    ],
  },
];

const flatEditorTabs: WorkbenchEditorTab[] = [
  {
    id: "app",
    renderContent: () => <div>App editor</div>,
    title: "App.tsx",
  },
  {
    id: "preview",
    renderContent: () => <div>Preview editor</div>,
    title: "Preview",
  },
];

const splitArrangement: WorkbenchEditorArrangement = {
  groups: [
    { activeTabId: "app", id: "left", tabIds: ["app"] },
    { activeTabId: "preview", id: "right", tabIds: ["preview"] },
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

function RerenderingWorkbench(props: { readonly version: number }) {
  return (
    <Workbench
      editor={<div>Editor {props.version}</div>}
      views={views.map((view) => ({ ...view }))}
    />
  );
}

describe("Workbench", () => {
  it("supports editor-only usage without an empty activity bar", () => {
    render(<Workbench editor="Editor" />);

    expect(screen.getByText("Editor")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Workbench views" })).toBeNull();
  });

  it("rejects ambiguous view and editor tab ids", () => {
    expect(() =>
      render(
        <Workbench
          editor={<div>Editor</div>}
          views={[views[0]!, { ...views[0]!, title: "Duplicate" }]}
        />,
      ),
    ).toThrow('Duplicate workbench view id "explorer"');

    expect(() =>
      render(
        <Workbench
          editorGroups={[
            {
              id: "main",
              tabs: [
                { id: "same", renderContent: () => "One" },
                { id: "same", renderContent: () => "Two" },
              ],
            },
          ]}
        />,
      ),
    ).toThrow('Duplicate tab id "same" in editor group "main"');
  });

  it("toggles active views from the activity bar", () => {
    const handle = createRef<WorkbenchHandle>();

    render(<Workbench ref={handle} editor={<div>Editor</div>} views={views} />);

    expect(handle.current?.getValue().visibleParts.primary).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Explorer" }));

    expect(handle.current?.getValue().visibleParts.primary).toBe(false);
    expect(handle.current?.getValue().activeEditorTabs).toEqual({ main: "editor" });
  });

  it("runs built-in commands", () => {
    const handle = createRef<WorkbenchHandle>();

    render(<Workbench ref={handle} editor={<div>Editor</div>} views={views} />);

    expect(handle.current?.getLayout().panelPosition).toBe("bottom");

    act(() => {
      expect(handle.current?.runCommand("workbench.action.togglePanelPosition")).toBe(true);
    });

    expect(handle.current?.getLayout().panelPosition).toBe("right");
  });

  it("resets to declared default state", () => {
    const handle = createRef<WorkbenchHandle>();

    render(
      <Workbench
        ref={handle}
        defaultLayout={{
          panelPosition: "right",
          value: { version: 1, visibleParts: { primary: false } },
          version: 1,
        }}
        editor={<div>Editor</div>}
        views={views}
      />,
    );

    expect(handle.current?.getLayout().panelPosition).toBe("right");
    expect(handle.current?.getValue().visibleParts.primary).toBe(false);

    act(() => handle.current?.togglePanelPosition());
    act(() => handle.current?.showPart("primary"));

    expect(handle.current?.getLayout().panelPosition).toBe("bottom");
    expect(handle.current?.getValue().visibleParts.primary).toBe(true);

    act(() => handle.current?.resetLayout());

    expect(handle.current?.getLayout().panelPosition).toBe("right");
    expect(handle.current?.getValue().visibleParts.primary).toBe(false);
  });

  it("dispatches built-in command keybindings from the workbench root", () => {
    const handle = createRef<WorkbenchHandle>();

    render(<Workbench ref={handle} editor={<div>Editor</div>} views={views} />);

    fireEvent.keyDown(screen.getByRole("application"), {
      ctrlKey: true,
      key: "j",
    });

    expect(handle.current?.getValue().visibleParts.panel).toBe(false);
  });

  it("keeps one document keydown subscription when workbench content rerenders", () => {
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const { rerender } = render(<RerenderingWorkbench version={1} />);
    const keydownSubscriptions = () =>
      addEventListener.mock.calls.filter(([event]) => event === "keydown").length;
    const keydownUnsubscriptions = () =>
      removeEventListener.mock.calls.filter(([event]) => event === "keydown").length;

    expect(keydownSubscriptions()).toBe(1);
    rerender(<RerenderingWorkbench version={2} />);

    expect(screen.getByText("Editor 2")).toBeTruthy();
    expect(keydownSubscriptions()).toBe(1);
    expect(keydownUnsubscriptions()).toBe(0);
  });

  it("does not dispatch command keybindings from editable targets", () => {
    const handle = createRef<WorkbenchHandle>();

    render(<Workbench ref={handle} editor={<input aria-label="Editor input" />} views={views} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Editor input" }), {
      ctrlKey: true,
      key: "j",
    });

    expect(handle.current?.getValue().visibleParts.panel).toBe(true);
  });

  it("respects prevented keydown events from consumers", () => {
    const handle = createRef<WorkbenchHandle>();

    render(
      <Workbench
        ref={handle}
        editor={<div>Editor</div>}
        onKeyDown={(event) => event.preventDefault()}
        views={views}
      />,
    );

    fireEvent.keyDown(screen.getByRole("application"), {
      ctrlKey: true,
      key: "j",
    });

    expect(handle.current?.getValue().visibleParts.panel).toBe(true);
  });

  it("lets user commands override built-in commands by id", () => {
    const handle = createRef<WorkbenchHandle>();
    const run = vi.fn<() => void>();

    render(
      <Workbench
        ref={handle}
        commands={[{ id: "workbench.action.togglePanelPosition", run }]}
        editor={<div>Editor</div>}
        views={views}
      />,
    );

    act(() => {
      expect(handle.current?.runCommand("workbench.action.togglePanelPosition")).toBe(true);
    });

    expect(run).toHaveBeenCalledOnce();
    expect(handle.current?.getLayout().panelPosition).toBe("bottom");
  });

  it("passes workbench actions to render slots", () => {
    const handle = createRef<WorkbenchHandle>();

    render(
      <Workbench
        ref={handle}
        editor={<div>Editor</div>}
        renderPartHeader={({ actions, part, view }) => (
          <button onClick={() => actions.hidePart(part)} type="button">
            Hide {view.title}
          </button>
        )}
        views={views}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide Explorer" }));

    expect(handle.current?.getValue().visibleParts.primary).toBe(false);
  });

  it("does not emit value changes for unchanged part visibility", () => {
    const handle = createRef<WorkbenchHandle>();
    const onValueChange = vi.fn<NonNullable<ComponentProps<typeof Workbench>["onValueChange"]>>();

    render(
      <Workbench
        ref={handle}
        editor={<div>Editor</div>}
        onValueChange={onValueChange}
        views={views}
      />,
    );

    act(() => handle.current?.hidePart("primary"));
    act(() => handle.current?.hidePart("primary"));

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        visibleParts: expect.objectContaining({ primary: false }),
      }),
    );
  });

  it("composes consecutive actions from the latest pending state", () => {
    const handle = createRef<WorkbenchHandle>();

    render(<Workbench ref={handle} editor={<div>Editor</div>} views={views} />);

    act(() => {
      handle.current?.hidePart("primary");
      handle.current?.hidePart("secondary");
    });

    expect(handle.current?.getValue().visibleParts).toEqual({
      panel: true,
      primary: false,
      secondary: false,
    });
  });

  it("composes controlled action proposals without mutating the accepted value", () => {
    const handle = createRef<WorkbenchHandle>();
    const onValueChange = vi.fn<NonNullable<ComponentProps<typeof Workbench>["onValueChange"]>>();
    const value = {
      activeByPart: {
        panel: "terminal",
        primary: "explorer",
        secondary: "inspector",
      },
      activeEditorTabs: { main: "editor" },
      version: 1 as const,
      visibleParts: { panel: true, primary: true, secondary: true },
    };

    render(
      <Workbench
        ref={handle}
        editor={<div>Editor</div>}
        onValueChange={onValueChange}
        value={value}
        views={views}
      />,
    );

    act(() => {
      handle.current?.hidePart("primary");
      handle.current?.hidePart("secondary");
    });

    expect(onValueChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        visibleParts: { panel: true, primary: false, secondary: false },
      }),
    );
    expect(handle.current?.getValue()).toEqual(value);
  });

  it("keeps render-slot actions stable when inline descriptors rerender", () => {
    const observedActions: unknown[] = [];

    function Fixture(props: { readonly version: number }) {
      return (
        <Workbench
          editor={<div>Editor {props.version}</div>}
          renderPartHeader={({ actions, view }) => {
            observedActions.push(actions);
            return <span>{view.title}</span>;
          }}
          views={views.map((view) => ({ ...view }))}
        />
      );
    }

    const { rerender } = render(<Fixture version={1} />);
    const firstActions = observedActions.at(-1);
    observedActions.length = 0;

    rerender(<Fixture version={2} />);

    expect(observedActions).not.toHaveLength(0);
    expect(observedActions.every((actions) => actions === firstActions)).toBe(true);
  });

  it("renders editor groups and tracks active editor tabs", () => {
    const handle = createRef<WorkbenchHandle>();

    render(<Workbench ref={handle} editorGroups={editorGroups} views={views} />);

    expect(screen.getByText("App editor")).toBeTruthy();
    expect(screen.getByText("Preview editor")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Workbench.tsx" }));

    expect(screen.getByText("Workbench editor")).toBeTruthy();
    expect(handle.current?.getValue().activeEditorTabs).toEqual({
      left: "workbench",
      right: "preview",
    });
    expect(handle.current?.getLayout().value.activeEditorTabs).toEqual({
      left: "workbench",
      right: "preview",
    });
    expect(handle.current?.getAreaLayout("editorGroups")).toBeTruthy();

    const appTab = screen.getByRole("tab", { name: "App.tsx" });
    appTab.focus();
    fireEvent.keyDown(appTab, { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: "Workbench.tsx" }).tabIndex).toBe(0);
    expect(screen.getByRole("tabpanel", { name: "Workbench.tsx" })).toBeTruthy();
  });

  it("owns flat editor tab placement and moves tabs atomically", () => {
    const handle = createRef<WorkbenchHandle>();
    render(<Workbench ref={handle} editorTabs={flatEditorTabs} />);

    act(() => {
      handle.current?.moveEditorTab({
        sourceGroupId: "main",
        tabId: "preview",
        target: {
          kind: "split",
          newGroupId: "right",
          position: "right",
          targetGroupId: "main",
        },
      });
    });

    expect(handle.current?.getLayout().editorArrangement?.groups).toEqual([
      { activeTabId: "app", id: "main", tabIds: ["app"] },
      { activeTabId: "preview", id: "right", tabIds: ["preview"] },
    ]);
    expect(screen.getByText("App editor")).toBeTruthy();
    expect(screen.getByText("Preview editor")).toBeTruthy();
  });

  it("proposes controlled editor arrangements without mutating accepted placement", () => {
    const handle = createRef<WorkbenchHandle>();
    const onChange =
      vi.fn<NonNullable<ComponentProps<typeof Workbench>["onEditorArrangementChange"]>>();
    render(
      <Workbench
        ref={handle}
        editorArrangement={splitArrangement}
        editorTabs={flatEditorTabs}
        onEditorArrangementChange={onChange}
      />,
    );

    act(() => {
      handle.current?.moveEditorTab({
        sourceGroupId: "left",
        tabId: "app",
        target: { groupId: "right", index: 1, kind: "tab-strip" },
      });
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        groups: [{ activeTabId: "app", id: "right", tabIds: ["preview", "app"] }],
      }),
    );
    expect(handle.current?.getLayout().editorArrangement?.groups).toEqual(splitArrangement.groups);
  });

  it("persists and restores editor arrangements", () => {
    const firstHandle = createRef<WorkbenchHandle>();
    const first = render(
      <Workbench ref={firstHandle} editorTabs={flatEditorTabs} storageKey="flat-editor-tabs" />,
    );
    act(() => {
      firstHandle.current?.moveEditorTab({
        sourceGroupId: "main",
        tabId: "preview",
        target: {
          kind: "split",
          newGroupId: "right",
          position: "right",
          targetGroupId: "main",
        },
      });
    });
    const expected = firstHandle.current?.getLayout().editorArrangement;
    first.unmount();

    const restored = createRef<WorkbenchHandle>();
    render(<Workbench ref={restored} editorTabs={flatEditorTabs} storageKey="flat-editor-tabs" />);

    expect(restored.current?.getLayout().editorArrangement).toEqual(expected);
  });

  it("lets a full tab renderer own the only button while retaining tab behavior", () => {
    render(
      <Workbench
        editorTabs={flatEditorTabs}
        renderEditorTab={({ tab, tabProps }) => (
          <button {...tabProps} data-custom-tab={tab.id}>
            Custom {tab.title}
          </button>
        )}
      />,
    );

    const preview = screen.getByRole("tab", { name: "Custom Preview" });
    expect(preview.getAttribute("data-custom-tab")).toBe("preview");
    fireEvent.click(preview);
    expect(screen.getByText("Preview editor")).toBeTruthy();
    expect(preview.tabIndex).toBe(0);
  });

  it("moves a tab through pointer drop on another tab strip", () => {
    const handle = createRef<WorkbenchHandle>();
    render(
      <Workbench
        ref={handle}
        defaultLayout={{
          editorArrangement: splitArrangement,
          panelPosition: "bottom",
          value: { version: 1 },
          version: 1,
        }}
        editorTabs={flatEditorTabs}
      />,
    );
    const appTab = screen.getByRole("tab", { name: "App.tsx" });
    const previewTab = screen.getByRole("tab", { name: "Preview" });
    const targetStrip = previewTab.closest<HTMLElement>("[data-worksplit-editor-tabs]")!;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn<(x: number, y: number) => Element>(() => targetStrip),
    });
    vi.spyOn(previewTab, "getBoundingClientRect").mockReturnValue({
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

    fireEvent.pointerDown(appTab, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { clientX: 590, clientY: 10 });
    fireEvent.pointerUp(document, { clientX: 590, clientY: 10 });

    expect(handle.current?.getLayout().editorArrangement?.groups).toEqual([
      { activeTabId: "app", id: "right", tabIds: ["preview", "app"] },
    ]);
  });

  it("renders and restores recursive editor grid topology", () => {
    const handle = createRef<WorkbenchHandle>();
    const editorLayout = {
      children: [
        { node: { groupId: "left", type: "group" as const }, size: 480 },
        {
          node: {
            children: [
              { node: { groupId: "right", type: "group" as const } },
              { node: { groupId: "bottom", type: "group" as const } },
            ],
            id: "right-stack",
            orientation: "vertical" as const,
            type: "split" as const,
          },
        },
      ],
      id: "root",
      orientation: "horizontal" as const,
      type: "split" as const,
    };

    const { container } = render(
      <Workbench
        ref={handle}
        defaultLayout={{
          editorLayout,
          panelPosition: "bottom",
          value: { version: 1 },
          version: 1,
        }}
        editorGroups={recursiveEditorGroups}
      />,
    );

    expect(screen.getByText("App editor")).toBeTruthy();
    expect(screen.getByText("Preview editor")).toBeTruthy();
    expect(screen.getByText("Embedded terminal")).toBeTruthy();
    expect(
      [...container.querySelectorAll(".worksplit-workbench-editor-split")].map((element) =>
        element.getAttribute("data-orientation"),
      ),
    ).toEqual(["horizontal", "vertical"]);
    expect(handle.current?.getLayout().editorLayout).toMatchObject(editorLayout);
  });

  it("moves existing groups without taking ownership of their content", () => {
    const handle = createRef<WorkbenchHandle>();

    render(<Workbench ref={handle} editorGroups={recursiveEditorGroups} />);

    act(() => {
      handle.current?.moveEditorGroup({
        groupId: "bottom",
        position: "bottom",
        targetGroupId: "right",
      });
    });

    const layout = handle.current?.getLayout().editorLayout;
    expect(layout?.type).toBe("split");
    expect(layout?.type === "split" ? layout.children[1]?.node : undefined).toMatchObject({
      children: [
        { node: { groupId: "right", type: "group" } },
        { node: { groupId: "bottom", type: "group" } },
      ],
      id: "split",
      orientation: "vertical",
      type: "split",
    });
    expect(screen.getByText("Embedded terminal")).toBeTruthy();
  });

  it("maximizes a group without removing sibling content from the DOM", () => {
    const handle = createRef<WorkbenchHandle>();
    const { container } = render(<Workbench ref={handle} editorGroups={recursiveEditorGroups} />);

    act(() => handle.current?.maximizeEditorGroup("right"));

    expect(handle.current?.getLayout().maximizedEditorGroupId).toBe("right");
    expect(screen.getByText("App editor")).toBeTruthy();
    expect(container.querySelectorAll(".worksplit-workbench-editor-maximized-hidden")).toHaveLength(
      2,
    );

    act(() => handle.current?.restoreEditorGroups());

    expect(handle.current?.getLayout().maximizedEditorGroupId).toBeUndefined();
    expect(container.querySelector(".worksplit-workbench-editor-maximized-hidden")).toBeNull();
  });

  it("persists and restores recursive editor grid operations", () => {
    const firstHandle = createRef<WorkbenchHandle>();
    const first = render(
      <Workbench
        ref={firstHandle}
        editorGroups={recursiveEditorGroups}
        storageKey="recursive-grid"
      />,
    );

    act(() => {
      firstHandle.current?.moveEditorGroup({
        groupId: "bottom",
        position: "bottom",
        targetGroupId: "right",
      });
      firstHandle.current?.maximizeEditorGroup("right");
    });

    const persisted = JSON.parse(window.localStorage.getItem("recursive-grid") ?? "null") as {
      editorLayout?: { type?: string };
      maximizedEditorGroupId?: string;
    };
    expect(persisted.editorLayout?.type).toBe("split");
    expect(persisted.maximizedEditorGroupId).toBe("right");

    const expectedEditorLayout = firstHandle.current?.getLayout().editorLayout;
    first.unmount();
    const restoredHandle = createRef<WorkbenchHandle>();
    render(
      <Workbench
        ref={restoredHandle}
        editorGroups={recursiveEditorGroups}
        storageKey="recursive-grid"
      />,
    );

    expect(restoredHandle.current?.getLayout().editorLayout).toEqual(expectedEditorLayout);
    expect(restoredHandle.current?.getLayout().maximizedEditorGroupId).toBe("right");
  });

  it("fails fast for invalid authored editor topology", () => {
    expect(() =>
      render(
        <Workbench
          defaultLayout={{
            editorLayout: { groupId: "left", type: "group" },
            panelPosition: "bottom",
            value: { version: 1 },
            version: 1,
          }}
          editorGroups={editorGroups}
        />,
      ),
    ).toThrow('Editor layout is missing editor group "right"');
  });

  it("reconciles topology when consumers remove an owned group", () => {
    const handle = createRef<WorkbenchHandle>();
    const defaultLayout = {
      editorLayout: {
        children: [
          { node: { groupId: "left", type: "group" as const } },
          { node: { groupId: "right", type: "group" as const } },
        ],
        id: "root",
        orientation: "horizontal" as const,
        type: "split" as const,
      },
      panelPosition: "bottom" as const,
      value: { version: 1 as const },
      version: 1 as const,
    };
    const { rerender } = render(
      <Workbench ref={handle} defaultLayout={defaultLayout} editorGroups={editorGroups} />,
    );

    rerender(
      <Workbench ref={handle} defaultLayout={defaultLayout} editorGroups={[editorGroups[0]!]} />,
    );

    expect(screen.queryByText("Preview editor")).toBeNull();
    expect(handle.current?.getLayout().editorLayout).toEqual({
      groupId: "left",
      type: "group",
    });
  });

  it("restores layout snapshots with split sizes", () => {
    const handle = createRef<WorkbenchHandle>();

    render(<Workbench ref={handle} editor={<div>Editor</div>} views={views} />);

    act(() => {
      handle.current?.restoreLayout({
        panelPosition: "right",
        areaSizes: {
          workbench: {
            "workbench:editor": 540,
            "workbench:panel": 180,
            "workbench:primary": 180,
            "workbench:secondary": 120,
          },
        },
        version: 1,
        value: {
          activeByPart: {
            panel: "terminal",
            primary: "explorer",
            secondary: "inspector",
          },
          version: 1,
          visibleParts: {
            panel: true,
            primary: true,
            secondary: false,
          },
        },
      });
    });

    const snapshot = handle.current?.getLayout();
    expect(snapshot?.panelPosition).toBe("right");
    expect(handle.current?.getValue().visibleParts.secondary).toBe(false);
    expect(snapshot?.areaSizes?.workbench?.["workbench:primary"]).toBe(180);
  });

  it("persists a resized sidebar's expanded size while hidden and restores it after remount", () => {
    const firstHandle = createRef<WorkbenchHandle>();
    const options = {
      partSizes: { primary: { default: 280, min: 220, max: 420 } },
      storageKey: "hidden-sidebar-size",
      views: [views[0]!],
    };
    const first = render(<Workbench ref={firstHandle} editor="Editor" {...options} />);
    const sash = screen.getByRole("separator", { name: "Resize pane" });
    fireEvent.keyDown(sash, { key: "ArrowRight" });
    fireEvent.keyDown(sash, { key: "ArrowRight" });
    expect(firstHandle.current?.getAreaLayout("workbench")?.sizeById["workbench:primary"]).toBe(
      300,
    );
    act(() => firstHandle.current?.hidePart("primary"));
    // Current geometry remains zero; the persisted size represents the user's expanded intent.
    expect(firstHandle.current?.getAreaLayout("workbench")?.sizeById["workbench:primary"]).toBe(0);
    expect(firstHandle.current?.getLayout().areaSizes?.workbench?.["workbench:primary"]).toBe(300);
    const persisted = JSON.parse(window.localStorage.getItem(options.storageKey) ?? "null");
    expect(persisted.value.visibleParts.primary).toBe(false);
    expect(persisted.areaSizes.workbench["workbench:primary"]).toBe(300);
    first.unmount();

    const restoredHandle = createRef<WorkbenchHandle>();
    render(<Workbench ref={restoredHandle} editor="Editor" {...options} />);
    expect(restoredHandle.current?.getValue().visibleParts.primary).toBe(false);
    expect(restoredHandle.current?.getLayout().areaSizes?.workbench?.["workbench:primary"]).toBe(
      300,
    );
    act(() => restoredHandle.current?.showPart("primary"));
    expect(restoredHandle.current?.getAreaLayout("workbench")?.sizeById["workbench:primary"]).toBe(
      300,
    );
  });

  it.each([
    { defaultSize: 280, expected: 280 },
    { defaultSize: "35%", expected: 315 },
  ] as const)(
    "restores an initially hidden sidebar's $defaultSize default after remount",
    ({ defaultSize, expected }) => {
      const firstHandle = createRef<WorkbenchHandle>();
      const options = {
        partSizes: { primary: { default: defaultSize, min: 220, max: 420 } },
        storageKey: "initially-hidden-sidebar-size",
        views: [views[0]!],
      };
      const first = render(
        <Workbench
          ref={firstHandle}
          defaultLayout={{
            version: 1,
            panelPosition: "bottom",
            value: { version: 1, visibleParts: { primary: false } },
          }}
          editor="Editor"
          {...options}
        />,
      );
      expect(
        firstHandle.current?.getLayout().areaSizes?.workbench?.["workbench:primary"],
      ).toBeUndefined();
      first.unmount();

      const restoredHandle = createRef<WorkbenchHandle>();
      render(<Workbench ref={restoredHandle} editor="Editor" {...options} />);
      expect(restoredHandle.current?.getValue().visibleParts.primary).toBe(false);
      act(() => restoredHandle.current?.showPart("primary"));
      expect(
        restoredHandle.current?.getAreaLayout("workbench")?.sizeById["workbench:primary"],
      ).toBe(expected);
    },
  );

  it("keeps resized editor sizes through maximize, persistence and restoration", () => {
    const firstHandle = createRef<WorkbenchHandle>();
    const options = { editorTabs: flatEditorTabs, storageKey: "maximized-editor-sizes" };
    const first = render(
      <Workbench
        ref={firstHandle}
        defaultLayout={{
          version: 1,
          panelPosition: "bottom",
          value: { version: 1 },
          editorArrangement: splitArrangement,
        }}
        {...options}
      />,
    );
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize pane" }), {
      key: "ArrowRight",
    });
    const before = firstHandle.current?.getLayout();
    expect(before?.areaSizes?.editorGroups?.["workbench:editor-group:left"]).toBe(460);
    act(() => firstHandle.current?.maximizeEditorGroup("left"));
    expect(firstHandle.current?.getLayout().editorArrangement?.layout).toEqual(
      before?.editorArrangement?.layout,
    );
    expect(firstHandle.current?.getLayout().areaSizes?.editorGroups).toEqual(
      before?.areaSizes?.editorGroups,
    );
    first.unmount();

    const restoredHandle = createRef<WorkbenchHandle>();
    render(<Workbench ref={restoredHandle} {...options} />);
    expect(restoredHandle.current?.getLayout().editorArrangement?.maximizedGroupId).toBe("left");
    expect(restoredHandle.current?.getLayout().editorArrangement?.layout).toEqual(
      before?.editorArrangement?.layout,
    );
    act(() => restoredHandle.current?.restoreEditorGroups());
    expect(restoredHandle.current?.getAreaLayout("editorGroups")?.sizeById).toEqual({
      "workbench:editor-group:left": 460,
      "workbench:editor-group:right": 440,
    });
  });

  it.each([
    { defaultSize: 280, expected: 280 },
    { defaultSize: "35%", expected: 315 },
  ] as const)(
    "ignores an old hidden zero size and first reveals the $defaultSize default",
    ({ defaultSize, expected }) => {
      const storageKey = "old-hidden-zero-size";
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 1,
          panelPosition: "bottom",
          value: { version: 1, visibleParts: { primary: false } },
          areaSizes: { workbench: { "workbench:primary": 0 } },
        }),
      );
      const handle = createRef<WorkbenchHandle>();
      render(
        <Workbench
          ref={handle}
          editor="Editor"
          views={[views[0]!]}
          storageKey={storageKey}
          partSizes={{ primary: { default: defaultSize, min: 220, max: 420 } }}
        />,
      );
      expect(handle.current?.getValue().visibleParts.primary).toBe(false);
      expect(handle.current?.getAreaLayout("workbench")?.sizeById["workbench:primary"]).toBe(0);
      act(() => handle.current?.showPart("primary"));
      expect(handle.current?.getAreaLayout("workbench")?.sizeById["workbench:primary"]).toBe(
        expected,
      );
      expect(handle.current?.getLayout().areaSizes?.workbench?.["workbench:primary"]).toBe(
        expected,
      );
    },
  );

  it("does not emit value changes when restoring equivalent state", () => {
    const handle = createRef<WorkbenchHandle>();
    const onValueChange = vi.fn<NonNullable<ComponentProps<typeof Workbench>["onValueChange"]>>();

    render(
      <Workbench
        ref={handle}
        editor={<div>Editor</div>}
        onValueChange={onValueChange}
        views={views}
      />,
    );

    act(() => {
      handle.current?.restoreLayout(handle.current.getLayout());
    });

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
