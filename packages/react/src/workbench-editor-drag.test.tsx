import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createEditorArrangement } from "@worksplit/core";
import { createRef, type ComponentProps, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installTestResizeObserver } from "./test-resize-observer";
import {
  Workbench,
  type WorkbenchEditorArrangement,
  type WorkbenchEditorTabContentContext,
  type WorkbenchHandle,
} from "./workbench";

const resizeObservers = installTestResizeObserver({ height: 600, width: 1000 });
type MovePolicy = NonNullable<ComponentProps<typeof Workbench>["canMoveEditorTab"]>;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function frameHarness() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  return {
    get pending() {
      return frames.size;
    },
    flush() {
      const callbacks = [...frames.values()];
      frames.clear();
      act(() => callbacks.forEach((callback) => callback(0)));
    },
  };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}

const initial = createEditorArrangement({
  groups: [
    { id: "source", tabIds: ["a", "b"], activeTabId: "a" },
    { id: "target", tabIds: ["c"] },
  ],
});

function quadrantArrangement(sourceTabs = ["a", "b"]): WorkbenchEditorArrangement {
  return createEditorArrangement({
    groups: [
      { id: "source", tabIds: sourceTabs },
      { id: "target", tabIds: ["c"] },
      { id: "third", tabIds: ["d"] },
      { id: "fourth", tabIds: ["e"] },
    ],
    layout: {
      type: "split",
      id: "rows",
      orientation: "vertical",
      children: [
        {
          node: {
            type: "split",
            id: "top",
            orientation: "horizontal",
            children: [
              { node: { type: "group", groupId: "source" } },
              { node: { type: "group", groupId: "target" } },
            ],
          },
        },
        {
          node: {
            type: "split",
            id: "bottom",
            orientation: "horizontal",
            children: [
              { node: { type: "group", groupId: "third" } },
              { node: { type: "group", groupId: "fourth" } },
            ],
          },
        },
      ],
    },
  });
}

function mountWorkbench(
  arrangement = initial,
  policy: MovePolicy = () => true,
  storageKey?: string,
) {
  const handle = createRef<WorkbenchHandle>();
  const onChange =
    vi.fn<NonNullable<ComponentProps<typeof Workbench>["onEditorArrangementChange"]>>();
  const renderContent = vi.fn<(context: WorkbenchEditorTabContentContext) => ReactNode>(
    (context) => <div>{context.tab.id} content</div>,
  );
  const tabs = arrangement.groups.flatMap((group) =>
    group.tabIds.map((id) => ({ id, title: id, renderContent })),
  );
  const renderWorkbench = (canMoveEditorTab: MovePolicy) => (
    <Workbench
      ref={handle}
      editorTabs={tabs}
      defaultLayout={{
        editorArrangement: arrangement,
        panelPosition: "bottom",
        value: { version: 1 },
        version: 1,
      }}
      canMoveEditorTab={canMoveEditorTab}
      onEditorArrangementChange={onChange}
      {...(storageKey ? { storageKey } : {})}
    />
  );
  const view = render(renderWorkbench(policy));
  const root = view.container.querySelector<HTMLElement>(".worksplit-workbench")!;
  const rectReaders = [
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(0, 0, 1000, 600)),
  ];
  for (const [index, group] of arrangement.groups.entries()) {
    const left = arrangement.groups.length === 1 ? 0 : (index % 2) * 500;
    const top = arrangement.groups.length > 2 ? Math.floor(index / 2) * 300 : 0;
    const width = arrangement.groups.length === 1 ? 1000 : 500;
    const height = arrangement.groups.length > 2 ? 300 : 600;
    const content = root.querySelector<HTMLElement>(
      `[data-worksplit-editor-content="${group.id}"]`,
    )!;
    const strip = root.querySelector<HTMLElement>(`[data-worksplit-editor-tabs="${group.id}"]`)!;
    rectReaders.push(
      vi
        .spyOn(content, "getBoundingClientRect")
        .mockReturnValue(rect(left, top + 36, width, height - 36)),
    );
    rectReaders.push(
      vi.spyOn(strip, "getBoundingClientRect").mockReturnValue(rect(left, top, width, 36)),
    );
    [...strip.querySelectorAll<HTMLElement>("[data-worksplit-editor-tab]")].forEach(
      (tab, tabIndex) => {
        rectReaders.push(
          vi
            .spyOn(tab, "getBoundingClientRect")
            .mockReturnValue(rect(left + tabIndex * 120, top, 120, 36)),
        );
      },
    );
  }
  let hit: Element | null = null;
  const hitTest = vi.fn<(x: number, y: number) => Element | null>(() => hit);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
  return {
    handle,
    hitTest,
    onChange,
    renderContent,
    root,
    view,
    content(groupId: string) {
      return root.querySelector<HTMLElement>(`[data-worksplit-editor-content="${groupId}"]`)!;
    },
    setHit(groupId: string, part: "content" | "tabs" = "content") {
      hit = root.querySelector(`[data-worksplit-editor-${part}="${groupId}"]`);
    },
    setHitTest(callback: (x: number, y: number) => Element | null) {
      hitTest.mockImplementation(callback);
    },
    rectReads() {
      return rectReaders.reduce((sum, reader) => sum + reader.mock.calls.length, 0);
    },
    rerenderPolicy(next: MovePolicy) {
      view.rerender(renderWorkbench(next));
    },
  };
}

function down(tabId = "b", pointerId = 1) {
  fireEvent.pointerDown(screen.getByRole("tab", { name: tabId }), {
    button: 0,
    clientX: 140,
    clientY: 18,
    pointerId,
  });
}

function move(clientX: number, clientY: number, pointerId = 1) {
  fireEvent.pointerMove(document, { clientX, clientY, pointerId });
}

function up(clientX: number, clientY: number, pointerId = 1) {
  fireEvent.pointerUp(document, { clientX, clientY, pointerId });
}

describe("Workbench editor drag", () => {
  it("keeps keyboard focus and activation together through custom tab wrappers", () => {
    render(
      <Workbench
        editorTabs={["a", "b", "c"].map((id) => ({ id, title: id, renderContent: () => id }))}
        renderEditorTab={({ tab, tabProps }) => (
          <div>
            <button {...tabProps}>{tab.title}</button>
            <button type="button" aria-label={`${tab.id} actions`}>
              ⋯
            </button>
          </div>
        )}
      />,
    );
    const a = screen.getByRole("tab", { name: "a" });
    const b = screen.getByRole("tab", { name: "b" });
    const c = screen.getByRole("tab", { name: "c" });
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(document.activeElement).toBe(b);
    expect(b.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(b, { key: "End" });
    expect(document.activeElement).toBe(c);
    expect(c.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(c, { key: "Home" });
    expect(document.activeElement).toBe(a);
    expect(a.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(a, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(c);
    expect(c.getAttribute("aria-selected")).toBe("true");
  });

  it("coalesces feedback frames, caches rectangles, and keeps inactive source content mounted until drop", () => {
    const frames = frameHarness();
    const fixture = mountWorkbench();
    const renders = fixture.renderContent.mock.calls.length;
    fixture.setHit("target");
    down();
    for (let index = 0; index < 30; index++) move(700 + index, 300);
    expect(frames.pending).toBe(1);
    frames.flush();
    frames.flush(); // Initial ResizeObserver deliveries invalidate once.
    const overlay = fixture.root.querySelector<HTMLElement>(
      ".worksplit-workbench-editor-drop-center",
    )!;
    expect([
      overlay.style.left,
      overlay.style.top,
      overlay.style.width,
      overlay.style.height,
    ]).toEqual(["500px", "36px", "500px", "564px"]);
    expect(fixture.root.querySelector(".worksplit-workbench-editor-tab-drop")).toBeNull();
    const reads = fixture.rectReads();
    for (let index = 0; index < 20; index++) move(710 + index, 310);
    expect(frames.pending).toBe(1);
    frames.flush();
    expect(fixture.rectReads()).toBe(reads);
    expect(fixture.renderContent).toHaveBeenCalledTimes(renders);
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(fixture.handle.current?.getLayout().editorArrangement?.groups).toEqual(initial.groups);
    expect(screen.getByRole("tab", { name: "a" }).getAttribute("aria-selected")).toBe("true");
    up(720, 310);
    expect(fixture.handle.current?.getLayout().editorArrangement?.groups).toEqual([
      { activeTabId: "a", id: "source", tabIds: ["a"] },
      { activeTabId: "b", id: "target", tabIds: ["c", "b"] },
    ]);
    expect(fixture.onChange).toHaveBeenCalledTimes(1);
    expect(fixture.root.querySelector(".worksplit-workbench-editor-drag-layer")).toBeNull();
  });

  it("vetoes pointer and imperative candidates before callbacks, pending placement, or persistence", () => {
    const frames = frameHarness();
    const policy = vi.fn<MovePolicy>((_options, next) => next.groups.length <= 4);
    const arrangement = quadrantArrangement();
    const fixture = mountWorkbench(arrangement, policy, "bounded-drag");
    const persisted = window.localStorage.getItem("bounded-drag");
    fixture.setHit("target");
    down();
    move(995, 140);
    frames.flush();
    expect(fixture.root.querySelector("[data-worksplit-drop-allowed=false]")).toBeTruthy();
    expect(fixture.root.classList.contains("worksplit-workbench-editor-drag-blocked")).toBe(true);
    expect(fixture.root.querySelector(".worksplit-workbench-editor-drop:not([hidden])")).toBeNull();
    expect(policy.mock.calls.some(([, next]) => next.groups.length === 5)).toBe(true);
    up(995, 140);
    act(() =>
      fixture.handle.current?.moveEditorTab({
        sourceGroupId: "source",
        tabId: "b",
        target: {
          kind: "split",
          newGroupId: "illegal",
          position: "right",
          targetGroupId: "target",
        },
      }),
    );
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(fixture.handle.current?.getLayout().editorArrangement?.groups).toEqual(
      arrangement.groups,
    );
    expect(window.localStorage.getItem("bounded-drag")).toBe(persisted);
    act(() =>
      fixture.handle.current?.moveEditorTab({
        sourceGroupId: "source",
        tabId: "b",
        target: { groupId: "fourth", index: 1, kind: "tab-strip" },
      }),
    );
    expect(fixture.onChange).toHaveBeenCalledTimes(1);
    expect(
      fixture.handle.current?.getLayout().editorArrangement?.groups.map((group) => group.id),
    ).toEqual(["source", "target", "third", "fourth"]);
    expect(fixture.handle.current?.getLayout().editorArrangement?.groups.at(-1)?.tabIds).toEqual([
      "e",
      "b",
    ]);
  });

  it("evaluates removal of the final source tab and reuses one split id for preview and submission", () => {
    const frames = frameHarness();
    const policy = vi.fn<MovePolicy>((_options, next) => next.groups.length <= 4);
    const fixture = mountWorkbench(quadrantArrangement(["a"]), policy);
    fixture.setHit("target");
    down("a");
    move(995, 140);
    frames.flush();
    move(920, 140); // Retain the accepted edge as the pointer moves inward.
    frames.flush();
    expect(
      fixture.root.querySelector(".worksplit-workbench-editor-drop-right:not([hidden])"),
    ).toBeTruthy();
    expect(fixture.handle.current?.getLayout().editorArrangement?.groups[0]?.id).toBe("source");
    up(920, 140);
    const splitMoves = policy.mock.calls.filter(([options]) => options.target.kind === "split");
    const ids = new Set(
      splitMoves.map(([options]) =>
        options.target.kind === "split" ? options.target.newGroupId : "",
      ),
    );
    expect(ids.size).toBe(1);
    expect(
      splitMoves.every(
        ([, next]) =>
          next.groups.length === 4 && next.groups.every((group) => group.id !== "source"),
      ),
    ).toBe(true);
    expect(fixture.onChange).toHaveBeenCalledWith(splitMoves.at(-1)![1]);
    expect(
      fixture.handle.current?.getLayout().editorArrangement?.groups.map((group) => group.id),
    ).toContain([...ids][0]);
  });

  it("blocks a sole tab's own edge and already satisfied insertion without advertising a split", () => {
    const frames = frameHarness();
    const policy = vi.fn<MovePolicy>(() => true);
    const arrangement = createEditorArrangement({ groups: [{ id: "source", tabIds: ["a"] }] });
    const fixture = mountWorkbench(arrangement, policy);
    fixture.setHit("source");
    down("a");
    move(995, 300);
    frames.flush();
    expect(fixture.root.querySelector("[data-worksplit-drop-allowed=false]")).toBeTruthy();
    expect(fixture.root.querySelector(".worksplit-workbench-editor-drop:not([hidden])")).toBeNull();
    up(995, 300);
    fixture.setHit("source", "tabs");
    down("a");
    move(20, 18);
    frames.flush();
    expect(
      fixture.root.querySelector(".worksplit-workbench-editor-tab-drop:not([hidden])"),
    ).toBeNull();
    up(20, 18);
    expect(policy).not.toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
  });

  it("shows a strip insertion line without altering strip geometry", () => {
    const frames = frameHarness();
    const fixture = mountWorkbench();
    fixture.setHit("target", "tabs");
    down();
    move(590, 18);
    frames.flush();
    const line = fixture.root.querySelector<HTMLElement>(".worksplit-workbench-editor-tab-drop")!;
    expect([line.style.left, line.style.top, line.style.width, line.style.height]).toEqual([
      "620px",
      "0px",
      "2px",
      "36px",
    ]);
    expect(line.closest("[data-worksplit-editor-tabs]")).toBeNull();
    expect(fixture.root.querySelector(".worksplit-workbench-editor-drop")).toBeNull();
    up(590, 18);
    expect(fixture.handle.current?.getLayout().editorArrangement?.groups.at(-1)?.tabIds).toEqual([
      "c",
      "b",
    ]);
  });

  it.each([
    ["left", 505, 300, [500, 36, 250, 564]],
    ["right", 995, 300, [750, 36, 250, 564]],
    ["top", 750, 40, [500, 36, 500, 282]],
    ["bottom", 750, 595, [500, 318, 500, 282]],
  ] as const)(
    "preserves native DOMRect geometry for the %s half preview",
    (position, x, y, dimensions) => {
      const nativeRect = rect(500, 36, 500, 564);
      expect(nativeRect).toBeInstanceOf(DOMRect);
      expect(Object.hasOwn(nativeRect, "top")).toBe(false);
      const frames = frameHarness();
      const fixture = mountWorkbench();
      fixture.setHit("target");
      down();
      move(x, y);
      frames.flush();
      const overlay = fixture.root.querySelector<HTMLElement>(
        `.worksplit-workbench-editor-drop-${position}`,
      )!;
      expect([
        overlay.style.left,
        overlay.style.top,
        overlay.style.width,
        overlay.style.height,
      ]).toEqual(dimensions.map((value) => `${value}px`));
      up(x, y);
      expect(fixture.onChange).toHaveBeenCalledTimes(1);
    },
  );

  it("refreshes the pointerup hit point before a pending feedback frame can run", () => {
    const frames = frameHarness();
    const fixture = mountWorkbench();
    const sourceStrip = fixture.root.querySelector("[data-worksplit-editor-tabs=source]");
    const targetStrip = fixture.root.querySelector("[data-worksplit-editor-tabs=target]");
    fixture.setHitTest((x) => (x < 500 ? sourceStrip : targetStrip));
    down();
    move(20, 18);
    expect(frames.pending).toBe(1);
    up(900, 18);
    expect(fixture.handle.current?.getLayout().editorArrangement?.groups.at(-1)?.tabIds).toEqual([
      "c",
      "b",
    ]);
    expect(frames.pending).toBe(0);
    expect(fixture.root.querySelector(".worksplit-workbench-editor-drag-layer")).toBeNull();
    frames.flush();
    expect(fixture.onChange).toHaveBeenCalledTimes(1);
  });

  it("rechecks the latest policy before release", () => {
    const frames = frameHarness();
    const fixture = mountWorkbench();
    fixture.setHit("target");
    down();
    move(700, 300);
    frames.flush();
    expect(fixture.root.querySelector("[data-worksplit-drop-allowed=true]")).toBeTruthy();
    const reject = vi.fn<MovePolicy>(() => false);
    fixture.rerenderPolicy(reject);
    up(700, 300);
    expect(reject).toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(fixture.root.querySelector(".worksplit-workbench-editor-drag-layer")).toBeNull();
  });

  it("refreshes cached wrapper rectangles on captured scroll and resize", () => {
    const frames = frameHarness();
    const fixture = mountWorkbench();
    fixture.setHit("target");
    down();
    move(700, 300);
    frames.flush();
    frames.flush();
    const reads = fixture.rectReads();
    vi.mocked(fixture.content("target").getBoundingClientRect).mockReturnValue(
      rect(500, 50, 500, 530),
    );
    fireEvent.scroll(fixture.content("target"));
    frames.flush();
    expect(fixture.rectReads()).toBeGreaterThan(reads);
    expect(
      fixture.root.querySelector<HTMLElement>(".worksplit-workbench-editor-drop-center")?.style.top,
    ).toBe("50px");
    const scrolledReads = fixture.rectReads();
    fireEvent(window, new Event("resize"));
    frames.flush();
    expect(fixture.rectReads()).toBeGreaterThan(scrolledReads);
    up(700, 300);
  });

  it.each(["pointercancel", "Escape", "blur", "unmount"] as const)(
    "releases feedback, frames, observer and listeners on %s",
    (reason) => {
      const frames = frameHarness();
      const fixture = mountWorkbench();
      fixture.setHit("target");
      down();
      const observer = resizeObservers.instances.at(-1)!;
      move(700, 300);
      frames.flush();
      move(710, 300);
      up(710, 300, 2);
      fireEvent.pointerCancel(document, { pointerId: 2 });
      expect(fixture.root.querySelector(".worksplit-workbench-editor-drag-layer")).toBeTruthy();
      if (reason === "pointercancel") fireEvent.pointerCancel(document, { pointerId: 1 });
      else if (reason === "Escape") fireEvent.keyDown(document, { key: "Escape" });
      else if (reason === "blur") fireEvent(window, new Event("blur"));
      else fixture.view.unmount();
      expect(frames.pending).toBe(0);
      expect(observer.disconnect).toHaveBeenCalledTimes(1);
      expect(fixture.root.querySelector(".worksplit-workbench-editor-drag-layer")).toBeNull();
      expect(fixture.root.classList.contains("worksplit-workbench-editor-dragging")).toBe(false);
      const hits = fixture.hitTest.mock.calls.length;
      move(720, 300);
      up(720, 300);
      fireEvent.scroll(document);
      frames.flush();
      expect(fixture.hitTest).toHaveBeenCalledTimes(hits);
      expect(fixture.onChange).not.toHaveBeenCalled();
    },
  );

  it("cleans an existing gesture before rethrowing a policy failure", () => {
    const frames = frameHarness();
    const policy = vi.fn<MovePolicy>(() => true);
    const fixture = mountWorkbench(initial, policy);
    fixture.setHit("target");
    down();
    move(700, 300);
    frames.flush();
    expect(fixture.root.querySelector(".worksplit-workbench-editor-drag-layer")).toBeTruthy();
    policy.mockImplementation(() => {
      throw new Error("policy failed");
    });
    move(710, 300);
    expect(() => frames.flush()).toThrow("policy failed");
    expect(fixture.root.querySelector(".worksplit-workbench-editor-drag-layer")).toBeNull();
    expect(frames.pending).toBe(0);
    move(720, 300);
    up(720, 300);
    frames.flush();
    expect(fixture.onChange).not.toHaveBeenCalled();
  });

  it("uses accepted controlled placement ahead of an obsolete stored seven-column arrangement", () => {
    const obsolete = createEditorArrangement({
      groups: Array.from({ length: 7 }, (_, index) => ({
        id: `old-${index}`,
        tabIds: [`tab-${index}`],
      })),
    });
    const accepted = quadrantArrangement(["a", "b"]);
    const handle = createRef<WorkbenchHandle>();
    window.localStorage.setItem(
      "migrated",
      JSON.stringify({
        editorArrangement: obsolete,
        editorLayout: obsolete.layout,
        panelPosition: "bottom",
        value: { version: 1 },
        version: 1,
      }),
    );
    const tabs = [...obsolete.groups.flatMap((group) => group.tabIds), "a", "b", "c", "d", "e"].map(
      (id) => ({ id, renderContent: () => id }),
    );
    const controlled = {
      ...accepted,
      groups: accepted.groups.map((group, index) =>
        index === 0
          ? Object.assign({}, group, {
              tabIds: [...group.tabIds, ...obsolete.groups.flatMap((old) => old.tabIds)],
            })
          : group,
      ),
    };
    const { container } = render(
      <Workbench
        ref={handle}
        editorArrangement={controlled}
        editorTabs={tabs}
        storageKey="migrated"
      />,
    );
    expect(container.querySelectorAll("[data-worksplit-editor-group]")).toHaveLength(4);
    expect(handle.current?.getLayout().editorArrangement?.groups).toEqual(controlled.groups);
    const persisted = JSON.parse(window.localStorage.getItem("migrated")!) as {
      editorArrangement: WorkbenchEditorArrangement;
    };
    expect(persisted.editorArrangement.groups).toEqual(controlled.groups);
    expect(persisted.editorArrangement.groups.flatMap((group) => group.tabIds)).toHaveLength(12);
  });
});
