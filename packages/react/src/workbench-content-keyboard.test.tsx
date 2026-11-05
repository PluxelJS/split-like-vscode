import {
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Actions, DockLocation, Layout, Model } from "flexlayout-react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, Workbench, useContent } from "./index";

const disposals: (() => Promise<unknown>)[] = [];
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 1000, 700),
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string): MediaQueryList => ({
      media,
      matches: false,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })),
  );
});
afterEach(async () => {
  cleanup();
  // eslint-disable-next-line no-await-in-loop -- Finish each owned session before tearing down the next.
  for (const dispose of disposals.splice(0)) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function tab(id: string) {
  const element = document.getElementById(`flexlayout-tabbutton-${id}`);
  if (!element) throw new Error(`Native tab ${id} is missing`);
  return element;
}

function holdAnimationFrames() {
  const pending = new Map<number, FrameRequestCallback>();
  const cancel = window.cancelAnimationFrame.bind(window);
  let nextId = 10000;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextId;
    pending.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    pending.delete(id);
    cancel(id);
  });
  return () => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((callback) => callback(performance.now()));
  };
}

async function fixture() {
  let handledKey: string | undefined;
  let editorKeyHandler: ((event: KeyboardEvent<HTMLInputElement>) => void) | undefined;
  function Editor() {
    const { id } = useContent();
    return (
      <>
        <input
          aria-label={`Editor ${id}`}
          defaultValue="draft"
          onKeyDown={(event) => {
            if (event.key === handledKey) event.preventDefault();
            editorKeyHandler?.(event);
          }}
        />
        {createPortal(<input aria-label={`Dialog editor ${id}`} />, document.body)}
      </>
    );
  }
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    component: Editor,
  });
  const routeTree = root.addChildren([page]);
  const routers: AnyRouter[] = [];
  const workbench = createWorkbench({
    createRouter: (history: RouterHistory) => {
      const router = createRouter({ routeTree, history, defaultPendingMinMs: 0 });
      routers.push(router);
      return router;
    },
    initial: {
      layout: {
        borders: [
          {
            type: "border",
            location: "left",
            selected: 0,
            children: [{ type: "tab", id: "tool", name: "Tool", component: "tool" }],
          },
        ],
        layout: { type: "row", children: [{ type: "tabset", id: "main", children: [] }] },
      },
    },
    tools: { tool: { render: () => <input aria-label="Tool editor" /> } },
  });
  disposals.push(() => workbench.dispose());
  await workbench.start();
  const open = async (id: string) => {
    const result = await workbench.open({ to: "/documents/$id", params: { id } });
    if (result.status !== "applied") throw new Error(`Open ${id}: ${result.status}`);
    return result.value.document.id;
  };
  return {
    workbench,
    open,
    routers,
    handleInEditor: (key = "F6") => {
      handledKey = key;
    },
    onEditorKey: (handler: (event: KeyboardEvent<HTMLInputElement>) => void) => {
      editorKeyHandler = handler;
    },
  };
}

describe("native content focus keyboard routing", () => {
  it.each([false, true])(
    "keeps a child key handler's open in the foreground when preview=%s",
    async (preview) => {
      const { workbench, open, onEditorKey } = await fixture();
      const a = await open("A");
      render(<Workbench instance={workbench} />);
      const editor = await screen.findByRole("textbox", { name: `Editor ${a}` });
      act(() => editor.focus());
      let operation: ReturnType<typeof workbench.open> | undefined;
      onEditorKey((event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        operation = workbench.open({ to: "/documents/$id", params: { id: "B" } }, { preview });
      });
      let result: Awaited<ReturnType<typeof workbench.open>> | undefined;
      await act(async () => {
        expect(fireEvent.keyDown(editor, { key: "Enter" })).toBe(false);
        result = await operation;
      });
      expect(result).toMatchObject({
        status: "applied",
        value: { presentation: "activate", document: { preview } },
      });
      if (result?.status !== "applied") throw new Error("The key did not open its document");
      const b = result.value.document.id;
      expect(b).not.toBe(a);
      expect(workbench.getActiveDocument()?.id).toBe(b);
      expect(workbench.getContext().source?.id).toBe(b);
      expect(tab(b).getAttribute("aria-selected")).toBe("true");
    },
  );

  it("keeps activation and deferred focus started by the child key handler", async () => {
    const { workbench, open, onEditorKey } = await fixture();
    const b = await open("B");
    const a = await open("A");
    render(<Workbench instance={workbench} />);
    const editor = await screen.findByRole("textbox", { name: `Editor ${a}` });
    act(() => editor.focus());
    const flushFrames = holdAnimationFrames();
    const deferredFocus = vi.fn<() => void>();
    let operation: ReturnType<typeof workbench.activate> | undefined;
    onEditorKey((event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      operation = workbench.activate(b, { focus: deferredFocus });
    });
    await act(async () => {
      expect(fireEvent.keyDown(editor, { key: "Enter" })).toBe(false);
      expect(await operation).toMatchObject({ status: "applied" });
    });
    act(flushFrames);
    expect(deferredFocus).toHaveBeenCalledTimes(1);
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(workbench.getContext().source?.id).toBe(b);
    expect(tab(b).getAttribute("aria-selected")).toBe("true");
  });

  it("records key intent before the host's root capture handler opens a document", async () => {
    const { workbench, open } = await fixture();
    const a = await open("A");
    let operation: ReturnType<typeof workbench.open> | undefined;
    render(
      <Workbench
        instance={workbench}
        onKeyDownCapture={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          operation = workbench.open({ to: "/documents/$id", params: { id: "B" } });
        }}
      />,
    );
    const editor = await screen.findByRole("textbox", { name: `Editor ${a}` });
    act(() => editor.focus());
    let result: Awaited<ReturnType<typeof workbench.open>> | undefined;
    await act(async () => {
      expect(fireEvent.keyDown(editor, { key: "Enter" })).toBe(false);
      result = await operation;
    });
    expect(result).toMatchObject({ status: "applied", value: { presentation: "activate" } });
    if (result?.status !== "applied") throw new Error("The host key did not open its document");
    expect(workbench.getActiveDocument()?.id).toBe(result.value.document.id);
    expect(workbench.getContext().source?.id).toBe(result.value.document.id);
  });

  it("cancels an older focus request even when the child stops key propagation", async () => {
    const { workbench, open, onEditorKey } = await fixture();
    const id = await open("A");
    const onKeyDown = vi.fn<(event: KeyboardEvent<HTMLDivElement>) => void>();
    render(<Workbench instance={workbench} onKeyDown={onKeyDown} />);
    const editor = await screen.findByRole("textbox", { name: `Editor ${id}` });
    act(() => editor.focus());
    const flushFrames = holdAnimationFrames();
    const deferredFocus = vi.fn<() => void>();
    await act(async () => {
      expect(await workbench.activate(id, { focus: deferredFocus })).toMatchObject({
        status: "applied",
      });
    });
    onEditorKey((event) => event.stopPropagation());
    expect(fireEvent.keyDown(editor, { key: "a" })).toBe(true);
    expect(onKeyDown).not.toHaveBeenCalled();
    act(flushFrames);
    expect(deferredFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor);
  });

  it("cancels pending focus when typing in an already focused outside input", async () => {
    const { workbench, open } = await fixture();
    const id = await open("A");
    render(
      <>
        <input aria-label="Outside editor" />
        <Workbench instance={workbench} />
      </>,
    );
    await screen.findByRole("textbox", { name: `Editor ${id}` });
    const outside = screen.getByRole("textbox", { name: "Outside editor" });
    act(() => outside.focus());
    const flushFrames = holdAnimationFrames();
    const deferredFocus = vi.fn<() => void>();
    await act(async () => {
      expect(await workbench.activate(id, { focus: deferredFocus })).toMatchObject({
        status: "applied",
      });
    });
    expect(fireEvent.keyDown(outside, { key: "a" })).toBe(true);
    act(flushFrames);
    expect(deferredFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
    expect(workbench.getContext().source?.id).toBe(id);
  });

  it.each([
    { key: "a", handled: false },
    { key: "Enter", handled: true },
    { key: "F6", handled: false },
  ])(
    "cancels pending same-document focus for $key even when handled=$handled",
    async ({ key, handled }) => {
      const { workbench, open, handleInEditor } = await fixture();
      const id = await open("A");
      render(<Workbench instance={workbench} native={{ keyMap: { focusTabToggle: "F6" } }} />);
      const editor = await screen.findByRole("textbox", { name: `Editor ${id}` });
      act(() => editor.focus());
      const flushFrames = holdAnimationFrames();
      const deferredFocus = vi.fn<() => void>();
      await act(async () => {
        expect(await workbench.activate(id, { focus: deferredFocus })).toMatchObject({
          status: "applied",
        });
      });
      expect(deferredFocus).not.toHaveBeenCalled();
      if (handled) handleInEditor(key);
      const nativeToggle = key === "F6" && !handled;
      expect(fireEvent.keyDown(editor, { key })).toBe(!handled && !nativeToggle);
      act(flushFrames);
      expect(deferredFocus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(nativeToggle ? tab(id) : editor);
      expect(workbench.getContext().source?.id).toBe(id);
    },
  );

  it("keeps pending same-document focus through an automatic focus return", async () => {
    const { workbench, open } = await fixture();
    const id = await open("A");
    render(<Workbench instance={workbench} />);
    const editor = await screen.findByRole("textbox", { name: `Editor ${id}` });
    const contentRoot = editor.closest<HTMLElement>("[data-worksplit-content]")!;
    act(() => contentRoot.focus());
    const flushFrames = holdAnimationFrames();
    const deferredFocus = vi.fn<() => void>();
    await act(async () => {
      expect(await workbench.activate(id, { focus: deferredFocus })).toMatchObject({
        status: "applied",
      });
    });
    act(() => editor.focus());
    expect(deferredFocus).not.toHaveBeenCalled();
    act(flushFrames);
    expect(deferredFocus).toHaveBeenCalledTimes(1);
    expect(workbench.getContext().source?.id).toBe(id);
  });

  it.each(["native blur", "outside focus", "window blur"] as const)(
    "keeps only current activated focus through native visibility blur after %s",
    async (interruption) => {
      const outsideFocus = interruption === "outside focus";
      const windowBlur = interruption === "window blur";
      const { workbench, open } = await fixture();
      const a = await open("A");
      const b = await open("B");
      render(
        <>
          <input aria-label="Outside editor" />
          <Workbench instance={workbench} />
        </>,
      );
      const previous = await screen.findByRole("textbox", { name: `Editor ${b}` });
      const outside = screen.getByRole("textbox", { name: "Outside editor" });
      act(() => previous.focus());
      const flushFrames = holdAnimationFrames();
      const deferredFocus = vi.fn<() => void>(() =>
        screen.getByRole("textbox", { name: `Editor ${a}` }).focus(),
      );
      await act(async () => {
        const activating = workbench.activate(a, { focus: deferredFocus });
        // Browsers blur an editor to body when native selection/maximization
        // hides its panel. jsdom needs that browser visibility effect supplied.
        if (outsideFocus) outside.focus();
        else previous.blur();
        if (windowBlur) fireEvent.blur(window);
        expect(await activating).toMatchObject({ status: "applied" });
      });
      const target = await screen.findByRole("textbox", { name: `Editor ${a}` });
      expect(document.activeElement).toBe(outsideFocus ? outside : document.body);
      act(flushFrames);
      expect(deferredFocus).toHaveBeenCalledTimes(outsideFocus || windowBlur ? 0 : 1);
      expect(document.activeElement).toBe(
        outsideFocus ? outside : windowBlur ? document.body : target,
      );
      expect(workbench.getContext().source?.id).toBe(a);
      expect(workbench.getContext().windowFocused).toBe(!windowBlur);
    },
  );

  it("does not adopt a portal owner's document or route its key to the native panel", async () => {
    const { workbench, open } = await fixture();
    const a = await open("A");
    render(<Workbench instance={workbench} native={{ keyMap: { focusTabToggle: "F6" } }} />);
    await screen.findByRole("textbox", { name: `Editor ${a}` });
    let b = "";
    await act(async () => {
      b = await open("B");
    });
    const editorB = await screen.findByRole("textbox", { name: `Editor ${b}` });
    act(() => editorB.focus());
    const portal = screen.getByRole("textbox", { name: `Dialog editor ${a}` });
    act(() => portal.focus());
    expect(fireEvent.keyDown(portal, { key: "F6" })).toBe(true);
    expect(document.activeElement).toBe(portal);
    expect(workbench.getActiveDocument()?.id).toBe(b);
    expect(workbench.getContext().source?.id).toBe(b);
  });

  it("establishes the upstream 0.11.1 portal focus baseline with the bare native Layout", async () => {
    render(
      <Layout
        model={Model.fromJson({
          layout: {
            type: "row",
            children: [
              {
                type: "tabset",
                children: [{ type: "tab", id: "baseline", name: "Baseline", component: "editor" }],
              },
            ],
          },
        })}
        factory={() => <input aria-label="Bare native editor" />}
        keyMap={{ focusTabToggle: "F6" }}
      />,
    );
    const editor = await screen.findByRole("textbox", { name: "Bare native editor" });
    act(() => tab("baseline").focus());
    expect(fireEvent.keyDown(tab("baseline"), { key: "F6" })).toBe(false);
    expect(document.activeElement).toBe(editor);
    expect(fireEvent.keyDown(editor, { key: "F6" })).toBe(true);
    expect(document.activeElement).toBe(editor);
  });

  it("hands only the native focus toggle back to the native panel after docking, preserving routers, drafts, and editor key handling", async () => {
    const { workbench, open, routers, handleInEditor } = await fixture();
    const a = await open("A");
    render(
      <Workbench
        instance={workbench}
        native={{ keyMap: { focusTabToggle: "F6", focusNextTabset: "Ctrl+F6" } }}
      />,
    );
    const editorA = await screen.findByRole("textbox", { name: `Editor ${a}` });
    fireEvent.change(editorA, { target: { value: "keep draft" } });
    let b = "";
    await act(async () => {
      b = await open("B");
    });
    const editorB = await screen.findByRole("textbox", { name: `Editor ${b}` });
    const target = workbench.model.getNodeById(a)?.getParent()?.getId();
    if (!target) throw new Error("Document has no native container");
    await act(async () => {
      expect(
        await workbench.dispatch(Actions.moveNode(b, target, DockLocation.RIGHT, -1)),
      ).toMatchObject({ status: "applied" });
    });
    const originalRouters = [...routers];
    act(() => tab(b).focus());
    expect(fireEvent.keyDown(tab(b), { key: "F6" })).toBe(false);
    expect(document.activeElement).toBe(editorB);
    expect(fireEvent.keyDown(editorB, { key: "F6" })).toBe(false);
    expect(document.activeElement).toBe(tab(b));
    expect(screen.getByRole("textbox", { name: `Editor ${a}` })).toBe(editorA);
    expect((editorA as HTMLInputElement).value).toBe("keep draft");
    expect(routers).toEqual(originalRouters);
    act(() => editorA.focus());
    for (const key of ["ArrowLeft", " ", "a", "Enter"])
      expect(fireEvent.keyDown(editorA, { key })).toBe(true);
    expect(fireEvent.keyDown(editorA, { key: "F6", ctrlKey: true })).toBe(true);
    expect(document.activeElement).toBe(editorA);
    const dialogEditor = screen.getByRole("textbox", { name: `Dialog editor ${a}` });
    act(() => dialogEditor.focus());
    expect(fireEvent.keyDown(dialogEditor, { key: "F6" })).toBe(true);
    expect(document.activeElement).toBe(dialogEditor);
    act(() => editorA.focus());
    handleInEditor();
    expect(fireEvent.keyDown(editorA, { key: "F6" })).toBe(false);
    expect(document.activeElement).toBe(editorA);
    const tool = screen.getByRole("textbox", { name: "Tool editor" });
    act(() => tool.focus());
    expect(fireEvent.keyDown(tool, { key: "F6" })).toBe(false);
    expect(document.activeElement).toBe(tab("tool"));
  });

  it("uses the current native custom key and respects a disabled toggle without recreating content", async () => {
    const { workbench, open } = await fixture();
    const id = await open("A");
    const view = render(
      <Workbench instance={workbench} native={{ keyMap: { focusTabToggle: "Ctrl+Alt+q" } }} />,
    );
    const editor = await screen.findByRole("textbox", { name: `Editor ${id}` });
    act(() => editor.focus());
    expect(fireEvent.keyDown(editor, { key: "F6" })).toBe(true);
    expect(document.activeElement).toBe(editor);
    expect(fireEvent.keyDown(editor, { key: "Q", ctrlKey: true, altKey: true })).toBe(false);
    expect(document.activeElement).toBe(tab(id));
    // The native runtime accepts explicit undefined although its optional TS slot is exact.
    const disabledKeyMap = { focusTabToggle: "F6" };
    Reflect.set(disabledKeyMap, "focusTabToggle", undefined);
    view.rerender(<Workbench instance={workbench} native={{ keyMap: disabledKeyMap }} />);
    act(() => editor.focus());
    expect(fireEvent.keyDown(editor, { key: "Q", ctrlKey: true, altKey: true })).toBe(true);
    expect(document.activeElement).toBe(editor);
    expect(screen.getByRole("textbox", { name: `Editor ${id}` })).toBe(editor);
  });
});
