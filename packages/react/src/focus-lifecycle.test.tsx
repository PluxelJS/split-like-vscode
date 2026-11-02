import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Actions, DockLocation, Model } from "flexlayout-react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, useWorkbenchContent, Workbench, type WorkbenchInstance } from "./index";
import { integrationState } from "./integration";

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
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Editor() {
  const input = useRef<HTMLInputElement>(null);
  useWorkbenchContent({ focus: () => input.current?.focus() });
  return <input ref={input} aria-label="Document editor" />;
}
function setup() {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    component: Editor,
  });
  const tree = root.addChildren([page]);
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: tree, history, defaultPendingMinMs: 0 }),
  });
  instances.push(workbench);
  const open = async (id: string) => {
    const result = await workbench.open({ to: "/documents/$id", params: { id } });
    if (result.status !== "committed") throw new Error(result.status);
    return result.document.id;
  };
  return { workbench, open, internal: integrationState(workbench) };
}

describe("document focus and lifecycle ownership", () => {
  it("fulfills first-open focus after React mounts and registers the document", async () => {
    const { workbench, open } = setup();
    render(<Workbench workbench={workbench} />);
    await act(async () => {
      await open("A");
    });
    const editor = await screen.findByRole("textbox", { name: "Document editor" });
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });

  it.each(["shell", "blur", "activate"] as const)(
    "cancels late focus registration after %s",
    async (reason) => {
      const { open, internal } = setup();
      const id = await open("A");
      if (reason === "shell") internal.focus(null, "shell");
      if (reason === "blur") internal.setWindowFocus(false);
      if (reason === "activate") await open("B");
      const focus = vi.fn<() => void>();
      internal.registerOwner(id, { focus });
      await Promise.resolve();
      expect(focus).not.toHaveBeenCalled();
    },
  );

  it.each(["close", "dispose"] as const)(
    "rejects late registration after %s without restoring focus",
    async (reason) => {
      const { workbench, open, internal } = setup();
      const id = await open("A");
      if (reason === "close") await workbench.close(id);
      else await workbench.dispose();
      const focus = vi.fn<() => void>();
      expect(() => internal.registerOwner(id, { focus })).toThrow("closed content");
      await Promise.resolve();
      expect(focus).not.toHaveBeenCalled();
    },
  );

  it("a pointer interaction outside the workbench cancels deferred content focus", async () => {
    const { workbench, open, internal } = setup();
    render(<Workbench workbench={workbench} />);
    const id = await open("A");
    fireEvent.pointerDown(document.body);
    const focus = vi.fn<() => void>();
    internal.registerOwner(id, { focus });
    await Promise.resolve();
    expect(focus).not.toHaveBeenCalled();
  });

  it("reveals an activated document in another group while retaining maximized mode", async () => {
    const { workbench, open } = setup();
    const a = await open("A");
    const b = await open("B");
    const left = Model.fromJson(workbench.getLayout()).getNodeById(a)!.getParent()!.getId();
    await workbench.dispatch(Actions.moveNode(b, left, DockLocation.RIGHT, -1));
    const right = Model.fromJson(workbench.getLayout()).getNodeById(b)!.getParent()!.getId();
    await workbench.dispatch(Actions.maximizeToggle(left));
    workbench.activate(b);
    const layout = Model.fromJson(workbench.getLayout());
    expect(layout.getMaximizedTabset()?.getId()).toBe(right);
    expect(layout.getActiveTabset()?.getId()).toBe(right);
    expect(workbench.getActiveDocument()?.id).toBe(b);
    await workbench.dispatch(Actions.maximizeToggle(right));
    expect(workbench.getLayout().layout.children).toHaveLength(2);
  });

  it("refuses a second editing owner while independent resource effects keep their ownership", async () => {
    const { workbench, open, internal } = setup();
    const id = await open("A");
    const disposeFirst = vi.fn<() => void>();
    const disposeSecond = vi.fn<() => void>();
    const releaseOwner = internal.registerOwner(id, { isDirty: () => true });
    const content = internal.content(id);
    const stopFirst = content.effect(({ defer }) => defer(disposeFirst));
    content.effect(({ defer }) => defer(disposeSecond));
    expect(() => internal.registerOwner(id, {})).toThrow("already has a lifecycle owner");
    expect(await workbench.close(id)).toEqual({ status: "rejected", reason: "decision" });
    releaseOwner();
    releaseOwner();
    expect(disposeFirst).not.toHaveBeenCalled();
    expect(disposeSecond).not.toHaveBeenCalled();
    stopFirst();
    stopFirst();
    expect(disposeFirst).toHaveBeenCalledTimes(1);
    await workbench.close(id);
    expect(disposeFirst).toHaveBeenCalledTimes(1);
    expect(disposeSecond).toHaveBeenCalledTimes(1);
  });
});
