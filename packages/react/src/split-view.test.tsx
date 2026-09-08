import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useEffect, useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pane, SplitView, type SplitViewHandle } from "./split-view";
import { installTestResizeObserver } from "./test-resize-observer";

const resizeObserverHarness = installTestResizeObserver({ height: 400, width: 800 });

function ResizeObserverFixture(props: { readonly version: number }) {
  return (
    <div style={{ height: 400, width: 800 }}>
      <SplitView>
        <Pane id="left" defaultSize={300} minSize={100}>
          Left {props.version}
        </Pane>
        <Pane id="right" defaultSize="1fr" minSize={100}>
          Right {props.version}
        </Pane>
      </SplitView>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Content({ onUnmount }: { onUnmount: () => void }) {
  const [count, setCount] = useState(0);
  useEffect(() => onUnmount, [onUnmount]);
  return (
    <>
      <button onClick={() => setCount(count + 1)}>Count {count}</button>
      <input aria-label="Draft" defaultValue="initial" />
    </>
  );
}

describe("@worksplit/react", () => {
  it("preserves state and DOM through controlled collapse and cleans up on removal", () => {
    const unmount = vi.fn<() => void>();
    function Fixture({ visible, present = true }: { visible: boolean; present?: boolean }) {
      return (
        <SplitView>
          {present && (
            <Pane id="retained" keepMounted visible={visible} style={{ display: "flex" }}>
              <Content onUnmount={unmount} />
            </Pane>
          )}
          <Pane id="main">Main</Pane>
        </SplitView>
      );
    }
    const { rerender } = render(<Fixture visible />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    const pane = input.closest<HTMLElement>("#retained")!;
    fireEvent.change(input, { target: { value: "unsaved" } });
    fireEvent.click(screen.getByRole("button"));
    pane.scrollTop = 75;
    rerender(<Fixture visible={false} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(pane.hidden).toBe(true);
    expect(pane.hasAttribute("inert")).toBe(true);
    expect(pane.getAttribute("aria-hidden")).toBe("true");
    expect(pane.style.display).toBe("none");
    expect(unmount).not.toHaveBeenCalled();
    rerender(<Fixture visible />);
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input.value).toBe("unsaved");
    expect(screen.getByRole("button").textContent).toBe("Count 1");
    expect(pane.scrollTop).toBe(75);
    expect(pane.hidden).toBe(false);
    expect(pane.hasAttribute("inert")).toBe(false);
    expect(pane.style.display).toBe("flex");
    rerender(<Fixture visible present={false} />);
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it("mounts initially hidden retained panes and preserves them across imperative visibility changes", () => {
    const handle = createRef<SplitViewHandle>();
    render(
      <SplitView ref={handle}>
        <Pane id="retained" keepMounted defaultVisible={false}>
          <input aria-label="Retained" />
        </Pane>
        <Pane id="ordinary" defaultVisible={false}>
          <input aria-label="Ordinary" />
        </Pane>
        <Pane id="main">Main</Pane>
      </SplitView>,
    );
    const input = screen.getByLabelText("Retained");
    expect(screen.queryByLabelText("Ordinary")).toBeNull();
    expect(handle.current?.getLayout()?.visibleIds).toEqual(["main"]);
    act(() => {
      handle.current?.expandPane("retained");
      handle.current?.expandPane("ordinary");
    });
    expect(screen.getByRole("textbox", { name: "Retained" })).toBe(input);
    expect(screen.getByRole("textbox", { name: "Ordinary" })).toBeTruthy();
    act(() => {
      handle.current?.collapsePane("retained");
      handle.current?.collapsePane("ordinary");
    });
    expect(screen.getByLabelText("Retained")).toBe(input);
    expect(screen.queryByLabelText("Ordinary")).toBeNull();
    expect(handle.current?.getLayout()?.visibleIds).toEqual(["main"]);
  });

  it("renders declared panes", () => {
    render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView>
          <Pane id="left">Left</Pane>
          <Pane id="right">Right</Pane>
        </SplitView>
      </div>,
    );

    expect(screen.getByText("Left")).toBeTruthy();
    expect(screen.getByText("Right")).toBeTruthy();
  });

  it("does not schedule a layout update for equivalent pane declarations after rerender", async () => {
    const handle = createRef<SplitViewHandle>();
    const renderPane = vi.fn<(name: string) => void>();

    function PaneContent(props: { readonly name: string }) {
      renderPane(props.name);
      return <span>{props.name}</span>;
    }

    function Fixture(props: { readonly version: number }) {
      return (
        <div data-version={props.version} style={{ height: 400, width: 800 }}>
          <SplitView ref={handle}>
            <Pane id="left" defaultSize={300} minSize={100}>
              <PaneContent name="Left" />
            </Pane>
            <Pane id="right" defaultSize="1fr" minSize={100}>
              <PaneContent name="Right" />
            </Pane>
          </SplitView>
        </div>
      );
    }

    const { rerender } = render(<Fixture version={1} />);

    await waitFor(() => expect(handle.current?.getLayout()?.sizes).toEqual([300, 500]));
    renderPane.mockClear();

    rerender(<Fixture version={2} />);

    expect(renderPane.mock.calls.map(([name]) => name)).toEqual(["Left", "Right"]);
  });

  it("does not recreate layout when only pane children change", async () => {
    const handle = createRef<SplitViewHandle>();

    function Fixture(props: { readonly version: number }) {
      return (
        <div style={{ height: 400, width: 800 }}>
          <SplitView ref={handle}>
            <Pane id="left" defaultSize={300} minSize={100}>
              Left {props.version}
            </Pane>
            <Pane id="right" defaultSize="1fr" minSize={100}>
              Right {props.version}
            </Pane>
          </SplitView>
        </div>
      );
    }

    const { rerender } = render(<Fixture version={1} />);

    await waitFor(() => expect(handle.current?.getLayout()?.sizes).toEqual([300, 500]));
    const initialLayout = handle.current?.getLayout();

    rerender(<Fixture version={2} />);

    expect(screen.getByText("Left 2")).toBeTruthy();
    expect(handle.current?.getLayout()).toBe(initialLayout);
  });

  it("keeps one resize observer subscription when pane content rerenders", async () => {
    resizeObserverHarness.instances.length = 0;

    const { rerender } = render(<ResizeObserverFixture version={1} />);

    await waitFor(() => expect(screen.getByText("Right 1")).toBeTruthy());
    expect(resizeObserverHarness.instances).toHaveLength(1);

    const observer = resizeObserverHarness.instances[0]!;
    rerender(<ResizeObserverFixture version={2} />);

    expect(screen.getByText("Right 2")).toBeTruthy();
    expect(resizeObserverHarness.instances).toHaveLength(1);
    expect(observer.disconnect).not.toHaveBeenCalled();
    expect(observer.observe).toHaveBeenCalledTimes(1);
  });

  it("resizes panes from the keyboard", () => {
    const onLayout = vi.fn<NonNullable<ComponentProps<typeof SplitView>["onLayout"]>>();

    render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView onLayout={onLayout}>
          <Pane id="left" defaultSize={400} minSize={100}>
            Left
          </Pane>
          <Pane id="right" defaultSize={400} minSize={100}>
            Right
          </Pane>
        </SplitView>
      </div>,
    );

    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });

    expect(onLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({
        layout: expect.objectContaining({ sizes: [410, 390] }),
        phase: "commit",
        reason: "keyboard",
        sizeById: { left: 410, right: 390 },
        sizes: [410, 390],
      }),
    );
    expect(onLayout.mock.calls.map(([event]) => event.phase)).toEqual([
      "start",
      "change",
      "commit",
    ]);
  });

  it("emits live pointer changes but commits only when the drag ends", () => {
    const onLayout = vi.fn<NonNullable<ComponentProps<typeof SplitView>["onLayout"]>>();

    render(
      <SplitView onLayout={onLayout}>
        <Pane id="left" defaultSize={400} minSize={100}>
          Left
        </Pane>
        <Pane id="right" defaultSize={400} minSize={100}>
          Right
        </Pane>
      </SplitView>,
    );

    const sash = screen.getByRole("separator", { name: "Resize pane" });
    fireEvent.pointerDown(sash, { clientX: 400, pointerId: 1 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 440 }));

    expect(onLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "change", reason: "pointer", sizes: [440, 360] }),
    );
    expect(onLayout).not.toHaveBeenCalledWith(expect.objectContaining({ phase: "commit" }));

    fireEvent(window, new MouseEvent("pointerup", { clientX: 440 }));

    expect(onLayout).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "commit", reason: "pointer", sizes: [440, 360] }),
    );
  });

  it("rejects duplicate pane ids before creating an ambiguous layout", () => {
    expect(() =>
      render(
        <SplitView>
          <Pane id="duplicate">One</Pane>
          <Pane id="duplicate">Two</Pane>
        </SplitView>,
      ),
    ).toThrow('Duplicate pane id "duplicate"');
  });

  it("collapses and restores panes through the workspace handle", () => {
    const handle = createRef<SplitViewHandle>();

    render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView ref={handle}>
          <Pane id="left" defaultSize={300} minSize={100}>
            Left
          </Pane>
          <Pane id="editor" defaultSize="1fr" minSize={100}>
            Editor
          </Pane>
        </SplitView>
      </div>,
    );

    expect(handle.current?.getLayout()?.sizes).toEqual([300, 500]);

    act(() => handle.current?.collapsePane("left"));

    expect(handle.current?.isPaneVisible("left")).toBe(false);
    expect(handle.current?.getLayout()?.visibleIds).toEqual(["editor"]);
    expect(handle.current?.getLayout()?.sizes).toEqual([800]);

    act(() => handle.current?.expandPane("left"));

    expect(handle.current?.isPaneVisible("left")).toBe(true);
    expect(handle.current?.getLayout()?.visibleIds).toEqual(["left", "editor"]);
    expect(handle.current?.getLayout()?.sizes).toEqual([300, 500]);
  });

  it("emits pane visibility changes as event objects", () => {
    const handle = createRef<SplitViewHandle>();
    const onPaneVisibilityChange =
      vi.fn<NonNullable<ComponentProps<typeof SplitView>["onPaneVisibilityChange"]>>();

    render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView ref={handle} onPaneVisibilityChange={onPaneVisibilityChange}>
          <Pane id="left" defaultSize={300} minSize={100}>
            Left
          </Pane>
          <Pane id="editor" defaultSize="1fr" minSize={100}>
            Editor
          </Pane>
        </SplitView>
      </div>,
    );

    act(() => handle.current?.collapsePane("left"));
    act(() => handle.current?.collapsePane("left"));
    act(() => handle.current?.expandPane("left"));
    act(() => handle.current?.expandPane("left"));

    expect(onPaneVisibilityChange).toHaveBeenNthCalledWith(1, {
      id: "left",
      visible: false,
    });
    expect(onPaneVisibilityChange).toHaveBeenNthCalledWith(2, {
      id: "left",
      visible: true,
    });
    expect(onPaneVisibilityChange).toHaveBeenCalledTimes(2);
  });

  it("sets pane sizes by id without resetting unspecified panes", () => {
    const handle = createRef<SplitViewHandle>();

    render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView ref={handle}>
          <Pane id="left" defaultSize={240} minSize={100}>
            Left
          </Pane>
          <Pane id="editor" defaultSize="1fr" minSize={100}>
            Editor
          </Pane>
          <Pane id="right" defaultSize={160} minSize={100}>
            Right
          </Pane>
        </SplitView>
      </div>,
    );

    act(() => handle.current?.resizePane("left", 300));
    act(() => handle.current?.setPaneSizes({ right: 200 }));

    expect(handle.current?.getLayout()?.sizeById).toEqual({
      editor: 340,
      left: 260,
      right: 200,
    });
  });

  it("does not restore a collapsed pane by clicking the boundary sash", () => {
    const handle = createRef<SplitViewHandle>();

    render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView ref={handle}>
          <Pane id="left" defaultSize={300} minSize={100}>
            Left
          </Pane>
          <Pane id="editor" defaultSize="1fr" minSize={100}>
            Editor
          </Pane>
        </SplitView>
      </div>,
    );

    act(() => handle.current?.collapsePane("left"));

    fireEvent.click(screen.getByRole("separator", { name: "Reveal left by dragging" }));

    expect(handle.current?.isPaneVisible("left")).toBe(false);
    expect(handle.current?.getLayout()?.visibleIds).toEqual(["editor"]);
  });

  it("reveals a collapsed pane by dragging from its boundary", async () => {
    const handle = createRef<SplitViewHandle>();

    render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView ref={handle}>
          <Pane id="left" defaultSize={300} minSize={100}>
            Left
          </Pane>
          <Pane id="editor" defaultSize="1fr" minSize={100}>
            Editor
          </Pane>
        </SplitView>
      </div>,
    );

    act(() => handle.current?.collapsePane("left"));

    const boundary = screen.getByRole("separator", { name: "Reveal left by dragging" });
    act(() => {
      fireEvent.pointerDown(boundary, { clientX: 0, pointerId: 1 });
      fireEvent(window, new MouseEvent("pointermove", { clientX: 220 }));
      fireEvent(window, new MouseEvent("pointerup", { clientX: 220 }));
    });

    await waitFor(() => {
      expect(handle.current?.isPaneVisible("left")).toBe(true);
      expect(handle.current?.getLayout()?.sizes).toEqual([220, 580]);
    });
  });

  it("does not snap a pane closed when the drag reaches minimum but ends before the delay", () => {
    const handle = createRef<SplitViewHandle>();

    render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView ref={handle}>
          <Pane id="left" defaultSize={300} minSize={100} snap>
            Left
          </Pane>
          <Pane id="editor" defaultSize="1fr" minSize={100}>
            Editor
          </Pane>
        </SplitView>
      </div>,
    );

    const sash = screen.getByRole("separator", { name: "Resize pane" });
    act(() => {
      fireEvent.pointerDown(sash, { clientX: 300, pointerId: 1 });
      fireEvent(window, new MouseEvent("pointermove", { clientX: 80 }));
      fireEvent(window, new MouseEvent("pointerup", { clientX: 80 }));
    });

    expect(handle.current?.isPaneVisible("left")).toBe(true);
    expect(handle.current?.getLayout()?.sizes).toEqual([100, 700]);
  });

  it("snaps a pane closed after holding the drag beyond minimum", () => {
    vi.useFakeTimers();
    const handle = createRef<SplitViewHandle>();

    render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView ref={handle}>
          <Pane id="left" defaultSize={300} minSize={100} snap>
            Left
          </Pane>
          <Pane id="editor" defaultSize="1fr" minSize={100}>
            Editor
          </Pane>
        </SplitView>
      </div>,
    );

    const sash = screen.getByRole("separator", { name: "Resize pane" });
    act(() => {
      fireEvent.pointerDown(sash, { clientX: 300, pointerId: 1 });
      fireEvent(window, new MouseEvent("pointermove", { clientX: 40 }));
      vi.advanceTimersByTime(320);
      fireEvent(window, new MouseEvent("pointerup", { clientX: 40 }));
    });

    expect(handle.current?.isPaneVisible("left")).toBe(false);
    expect(handle.current?.getLayout()?.visibleIds).toEqual(["editor"]);
  });

  it("supports controlled pane visibility", () => {
    const { rerender } = render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView>
          <Pane id="left" defaultSize={240} visible={false}>
            Left
          </Pane>
          <Pane id="editor" defaultSize="1fr">
            Editor
          </Pane>
        </SplitView>
      </div>,
    );

    expect(screen.queryByText("Left")).toBeNull();
    expect(screen.getByText("Editor")).toBeTruthy();

    rerender(
      <div style={{ height: 400, width: 800 }}>
        <SplitView>
          <Pane id="left" defaultSize={240} visible>
            Left
          </Pane>
          <Pane id="editor" defaultSize="1fr">
            Editor
          </Pane>
        </SplitView>
      </div>,
    );

    expect(screen.getByText("Left")).toBeTruthy();
  });

  it("renders sash and collapsed boundary injection points", () => {
    const handle = createRef<SplitViewHandle>();

    render(
      <div style={{ height: 400, width: 800 }}>
        <SplitView
          ref={handle}
          renderCollapsedPane={(info) => <span>restore-{info.id}</span>}
          renderSash={(info) => <span>sash-{info.beforeId}</span>}
        >
          <Pane id="left" defaultSize={300}>
            Left
          </Pane>
          <Pane id="editor" defaultSize="1fr">
            Editor
          </Pane>
        </SplitView>
      </div>,
    );

    expect(screen.getByText("sash-left")).toBeTruthy();

    act(() => handle.current?.collapsePane("left"));

    expect(screen.getByText("restore-left")).toBeTruthy();
  });
});
