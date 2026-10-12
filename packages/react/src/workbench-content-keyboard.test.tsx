import {
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Actions, DockLocation, Layout, Model } from "flexlayout-react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, Workbench, useWorkbenchContent } from "./index";

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
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function tab(id: string) {
  const element = document.getElementById(`flexlayout-tabbutton-${id}`);
  if (!element) throw new Error(`Native tab ${id} is missing`);
  return element;
}
function fixture() {
  let handleToggle = false;
  function Editor() {
    const { id } = useWorkbenchContent();
    return (
      <>
        <input
          aria-label={`Editor ${id}`}
          defaultValue="draft"
          onKeyDown={(event) => {
            if (handleToggle && event.key === "F6") event.preventDefault();
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
    layout: {
      borders: [
        {
          type: "border",
          location: "left",
          selected: 0,
          children: [{ type: "tab", id: "tool", name: "Tool", component: "worksplit.tool" }],
        },
      ],
      layout: { type: "row", children: [{ type: "tabset", id: "main", children: [] }] },
    },
    tools: [{ id: "tool", render: () => <input aria-label="Tool editor" /> }],
  });
  disposals.push(() => workbench.dispose());
  const open = async (id: string) => {
    const result = await workbench.open({ to: "/documents/$id", params: { id } });
    if (result.status !== "committed") throw new Error(`Open ${id}: ${result.status}`);
    return result.document.id;
  };
  return {
    workbench,
    open,
    routers,
    handleInEditor: () => {
      handleToggle = true;
    },
  };
}

describe("native content focus keyboard routing", () => {
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
    const { workbench, open, routers, handleInEditor } = fixture();
    const a = await open("A");
    render(
      <Workbench
        workbench={workbench}
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
    const target = Model.fromJson(workbench.getLayout()).getNodeById(a)?.getParent()?.getId();
    if (!target) throw new Error("Document has no native container");
    await act(async () => {
      expect(await workbench.dispatch(Actions.moveNode(b, target, DockLocation.RIGHT, -1))).toEqual(
        { status: "applied" },
      );
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
    const { workbench, open } = fixture();
    const id = await open("A");
    const view = render(
      <Workbench workbench={workbench} native={{ keyMap: { focusTabToggle: "Ctrl+Alt+q" } }} />,
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
    view.rerender(<Workbench workbench={workbench} native={{ keyMap: disabledKeyMap }} />);
    act(() => editor.focus());
    expect(fireEvent.keyDown(editor, { key: "Q", ctrlKey: true, altKey: true })).toBe(true);
    expect(document.activeElement).toBe(editor);
    expect(screen.getByRole("textbox", { name: `Editor ${id}` })).toBe(editor);
  });
});
