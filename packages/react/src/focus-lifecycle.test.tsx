import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Actions, DockLocation } from "flexlayout-react";
import { useRef } from "react";
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
