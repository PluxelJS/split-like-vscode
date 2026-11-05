import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Actions, DockLocation } from "flexlayout-react";
import { useRef } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, useContentController, Workbench, type WorkbenchInstance } from "./index";
import { integrationState } from "./internal";

const instances: WorkbenchInstance<AnyRouter>[] = [];
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 700),
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
  vi.stubGlobal("scrollTo", vi.fn<typeof window.scrollTo>());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  // eslint-disable-next-line no-await-in-loop -- Finish each owned session before tearing down the next.
  for (const instance of instances.splice(0)) await instance.dispose();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Editor() {
  const input = useRef<HTMLInputElement>(null);
  useContentController({ leave: null, focus: () => input.current?.focus() });
  return <input ref={input} aria-label="Document editor" />;
}
async function setup(withController = true) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    component: withController ? Editor : () => <input aria-label="Passive editor" />,
  });
  const tree = root.addChildren([page]);
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: tree, history, defaultPendingMinMs: 0 }),
  });
  instances.push(workbench);
  await workbench.start();
  const open = async (id: string) => {
    const result = await workbench.open({ to: "/documents/$id", params: { id } });
    if (result.status !== "applied") throw new Error(result.status);
    return result.value.document.id;
  };
  return { workbench, open, internal: integrationState(workbench) };
}

describe("document focus and lifecycle ownership", () => {
  it.each(["content", "tab"] as const)(
    "returns keyboard scope when maximizing hides the focused sibling %s",
    async (origin) => {
      const { workbench, open } = await setup(false);
      const first = await open("A");
      const second = await open("B");
      const left = workbench.getDocument(first)!.containerId!;
      await workbench.dispatch(Actions.moveNode(second, left, DockLocation.RIGHT, -1));
      const view = render(<Workbench instance={workbench} />);
      const input = view.container.querySelector<HTMLInputElement>(
        `[data-worksplit-content="${second}"] input`,
      )!;
      const panel = input.closest<HTMLElement>('[role="tabpanel"]')!;
      const tab = document.getElementById(panel.getAttribute("aria-labelledby")!)!;
      const target = origin === "content" ? input : tab;
      fireEvent.pointerDown(target);
      target.focus();
      expect(document.activeElement).toBe(target);

      await act(async () => {
        expect((await workbench.dispatch(Actions.maximizeToggle(left))).status).toBe("applied");
      });
      expect(tab.closest<HTMLElement>(".flexlayout__tabset_container")!.style.display).toBe(
        "none",
      );
      // Chromium blurs CSS-hidden focus to body. JSDOM keeps it focused and then
      // refuses blur on a hidden element, so emulate that browser default here.
      const hidden: HTMLElement[] = [];
      for (let element: HTMLElement | null = target; element; element = element.parentElement)
        if (element.style.display === "none") {
          hidden.push(element);
          element.style.display = "";
        }
      target.blur();
      for (const element of hidden) element.style.display = "none";
      expect(document.activeElement).toBe(document.body);

      await waitFor(() => expect(document.activeElement).toBe(view.container.firstElementChild));
    },
  );

  it.each([
    ["content", false],
    ["tab", false],
    ["tab", true],
  ] as const)(
    "returns keyboard scope when closing the focused %s removes its DOM (synchronous native render: %s)",
    async (origin, synchronous) => {
      const { workbench, open } = await setup(false);
      const view = render(<Workbench instance={workbench} />);
      let first = "",
        second = "";
      await act(async () => {
        first = await open("A");
        second = await open("B");
      });
      const input = await screen.findByRole("textbox", { name: "Passive editor" });
      const panel = input.closest<HTMLElement>('[role="tabpanel"]')!;
      const target =
        origin === "content"
          ? input
          : document.getElementById(panel.getAttribute("aria-labelledby")!)!;
      target.focus();
      expect(document.activeElement).toBe(target);
      let removedSynchronously = false;
      if (synchronous)
        workbench.model.addChangeListener({
          onAfterAction(action) {
            if (action.type !== Actions.DELETE_TAB) return;
            flushSync(() => view.rerender(<Workbench instance={workbench} />));
            removedSynchronously = !target.isConnected;
          },
        });
      await act(async () => {
        expect((await workbench.close(second)).status).toBe("applied");
      });
      expect(workbench.getActiveDocument()?.id).toBe(first);
      expect(removedSynchronously).toBe(synchronous);
      await waitFor(() => expect(document.activeElement).toBe(view.container.firstElementChild));
    },
  );

  it.each(["body", "input", "window"] as const)(
    "does not reclaim focus after a newer outside %s intent while close awaits a decision",
    async (destination) => {
      const { workbench, open, internal } = await setup(false);
      const outside = document.createElement("input");
      document.body.append(outside);
      render(<Workbench instance={workbench} />);
      let second = "";
      await act(async () => {
        await open("A");
        second = await open("B");
      });
      const input = await screen.findByRole("textbox", { name: "Passive editor" });
      input.focus();
      let approve!: () => void;
      internal.registerController(workbench.getDocument(second)!.handle, {
        controller: {
          leave: {
            getState: () => ({ hasUnsavedChanges: false, token: 1 }),
            decide: () =>
              new Promise((resolve) => {
                approve = () => resolve({ decision: "allow", token: 1 });
              }),
          },
        },
      });
      const closing = workbench.close(second);
      await waitFor(() => expect(approve).toBeTypeOf("function"));
      if (destination === "window") fireEvent(window, new Event("blur"));
      else fireEvent.pointerDown(destination === "body" ? document.body : outside);
      if (destination === "input") outside.focus();
      else input.blur();
      await act(async () => {
        approve();
        expect((await closing).status).toBe("applied");
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(document.activeElement).toBe(destination === "input" ? outside : document.body);
      outside.remove();
    },
  );

  it.each([
    { interaction: "pointer", superseded: true },
    { interaction: "key", superseded: true },
    { interaction: "passive focus", superseded: false },
  ])(
    "handles native chrome $interaction while first-open focus is pending",
    async ({ interaction, superseded }) => {
      const { workbench, open, internal } = await setup(false);
      const id = await open("A");
      render(<Workbench instance={workbench} />);
      const input = screen.getByRole("textbox", { name: "Passive editor" });
      const panel = input.closest<HTMLElement>('[role="tabpanel"]')!;
      const tab = document.getElementById(panel.getAttribute("aria-labelledby")!)!;
      const focus = vi.fn<() => void>(() => input.focus());
      internal.registerController(workbench.getDocument(id)!.handle, {
        controller: { leave: null, focus },
      });
      expect(focus).not.toHaveBeenCalled();
      if (interaction === "pointer") fireEvent.pointerDown(tab, { button: 2 });
      if (interaction === "key") fireEvent.keyDown(tab, { key: "ArrowRight" });
      tab.focus();
      expect(document.activeElement).toBe(tab);

      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(focus).toHaveBeenCalledTimes(Number(!superseded));
      expect(document.activeElement).toBe(superseded ? tab : input);
    },
  );

  it("fulfills first-open focus after React mounts and registers the document", async () => {
    const { workbench, open } = await setup();
    render(<Workbench instance={workbench} />);
    await act(async () => {
      await open("A");
    });
    const editor = await screen.findByRole("textbox", { name: "Document editor" });
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });

  it.each(["shell", "blur", "activate"] as const)(
    "cancels late focus registration after %s",
    async (reason) => {
      const { workbench, open, internal } = await setup(false);
      const id = await open("A");
      const content = workbench.getDocument(id)!.handle;
      if (reason === "shell") internal.focus(null, "outside");
      if (reason === "blur") internal.setWindowFocus(false);
      if (reason === "activate") await open("B");
      const focus = vi.fn<() => void>();
      internal.registerController(content, { controller: { leave: null, focus } });
      await Promise.resolve();
      expect(focus).not.toHaveBeenCalled();
    },
  );

  it.each(["close", "dispose"] as const)(
    "rejects late registration after %s without restoring focus",
    async (reason) => {
      const { workbench, open, internal } = await setup(false);
      const id = await open("A");
      const content = workbench.getDocument(id)!.handle;
      if (reason === "close") await workbench.close(id);
      else await workbench.dispose();
      const focus = vi.fn<() => void>();
      expect(() =>
        internal.registerController(content, { controller: { leave: null, focus } }),
      ).toThrow("ended content");
      await Promise.resolve();
      expect(focus).not.toHaveBeenCalled();
    },
  );

  it("a pointer interaction outside the workbench cancels deferred content focus", async () => {
    const { workbench, open, internal } = await setup(false);
    render(<Workbench instance={workbench} />);
    const id = await open("A");
    const content = workbench.getDocument(id)!.handle;
    fireEvent.pointerDown(document.body);
    const focus = vi.fn<() => void>();
    internal.registerController(content, { controller: { leave: null, focus } });
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
  });

  it("reveals an activated document in another group while retaining maximized mode", async () => {
    const { workbench, open } = await setup();
    const a = await open("A");
    const b = await open("B");
    const left = workbench.model.getNodeById(a)!.getParent()!.getId();
    await workbench.dispatch(Actions.moveNode(b, left, DockLocation.RIGHT, -1));
    const right = workbench.model.getNodeById(b)!.getParent()!.getId();
    await workbench.dispatch(Actions.maximizeToggle(left));
    await workbench.activate(b);
    const layout = workbench.model;
    expect(layout.getMaximizedTabset()?.getId()).toBe(right);
    expect(layout.getActiveTabset()?.getId()).toBe(right);
    expect(workbench.getActiveDocument()?.id).toBe(b);
    await workbench.dispatch(Actions.maximizeToggle(right));
    expect(workbench.model.toJson().layout.children).toHaveLength(2);
  });

  it("refuses a second editing owner while independent resource effects keep their ownership", async () => {
    const { workbench, open, internal } = await setup(false);
    const id = await open("A");
    const disposeFirst = vi.fn<() => void>();
    const disposeSecond = vi.fn<() => void>();
    const content = workbench.getDocument(id)!.handle;
    const releaseOwner = internal.registerController(content, {
      controller: {
        leave: {
          getState: () => ({ hasUnsavedChanges: true, token: 0 }),
          decide: () => ({ decision: "deny" }),
        },
      },
    });
    const stopFirst = content.runEffect(({ defer }) => defer(disposeFirst));
    content.runEffect(({ defer }) => defer(disposeSecond));
    expect(() => internal.registerController(content, { controller: { leave: null } })).toThrow(
      "already has a controller owner",
    );
    expect(await workbench.close(id)).toEqual({ status: "denied", reason: "decision" });
    releaseOwner();
    releaseOwner();
    expect(disposeFirst).not.toHaveBeenCalled();
    expect(disposeSecond).not.toHaveBeenCalled();
    stopFirst();
    stopFirst();
    expect(disposeFirst).toHaveBeenCalledTimes(1);
    expect((await workbench.close(id)).status).toBe("denied");
    internal.registerController(content, { controller: { leave: null } });
    expect((await workbench.close(id)).status).toBe("applied");
    expect(disposeFirst).toHaveBeenCalledTimes(1);
    expect(disposeSecond).toHaveBeenCalledTimes(1);
  });
});
