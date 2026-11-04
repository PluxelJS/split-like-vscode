import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createWorkbench,
  Workbench,
  type MenuRendererProps,
  type OperationResult,
} from "@worksplit/react";
import { Actions, DockLocation, PopupMenu, TabGroupNode } from "flexlayout-react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTestResizeObserver } from "./test-resize-observer";

const disposals: (() => Promise<unknown>)[] = [];
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 700),
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
  installTestResizeObserver({ width: 1000, height: 700 });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(async () => {
  await act(async () => {
    for (const dispose of disposals.splice(0)) {
      // oxlint-disable-next-line no-await-in-loop -- Workspaces release shared DOM resources serially.
      await dispose();
    }
  });
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function applied<T>(result: OperationResult<T>): T {
  if (result.status !== "applied") throw new Error(`Unexpected ${JSON.stringify(result)}`);
  return result.value;
}
async function fixture() {
  const root = createRootRoute({ component: Outlet });
  const item = createRoute({
    getParentRoute: () => root,
    path: "/item/$id",
    component: () => <p>Read only</p>,
  });
  const routeTree = root.addChildren([item]);
  const instance = createWorkbench({
    createRouter: (history) => createRouter({ routeTree, history, defaultPendingMinMs: 0 }),
    home: { mode: "empty", href: "/" },
    initial: {
      layout: {
        global: { tabEnablePin: true, tabSetEnableTabGroups: true },
        borders: [{ type: "border", location: "right", children: [] }],
        layout: { type: "row", children: [{ type: "tabset", id: "main", children: [] }] },
      },
    },
  });
  disposals.push(() => instance.dispose());
  applied(await instance.start());
  const open = async (id: string) => {
    const document = applied(await instance.open({ to: "/item/$id", params: { id } })).document;
    applied(await instance.dispatch(Actions.renameTab(document.id, id)));
    return document;
  };
  const first = await open("A");
  return { instance, first, open };
}

describe("native default Worksplit menus", () => {
  it("opens from the keyboard and disables a split that cannot create another pane", async () => {
    const { instance } = await fixture();
    render(<Workbench instance={instance} />);
    const tab = await screen.findByRole("tab", { name: "A" });
    tab.focus();
    fireEvent.keyDown(tab, { key: "F10", shiftKey: true });
    expect(await screen.findByRole("menu")).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Split Right" }).getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(instance.getDocuments()).toHaveLength(2));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves the original tab when splitting and never duplicates its content", async () => {
    const { instance, first, open } = await fixture();
    await open("B");
    render(<Workbench instance={instance} />);
    fireEvent.contextMenu(await screen.findByRole("tab", { name: "A" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Split Right" }));
    await waitFor(() =>
      expect(
        instance.getContainers().filter((container) => container.kind === "tabset"),
      ).toHaveLength(2),
    );
    expect(instance.getDocuments()).toHaveLength(2);
    expect(instance.getDocument(first.id)?.handle).toBe(first.handle);
  });

  it("keeps native group rename/color controls and closes every collapsed member", async () => {
    const { instance, first, open } = await fixture();
    const second = await open("B");
    applied(await instance.dispatch(Actions.addTabToNewGroup(first.id, "Reports", "#426b42")));
    const group = instance.model.getNodeById(first.id)?.getParent();
    expect(group).toBeInstanceOf(TabGroupNode);
    if (!(group instanceof TabGroupNode)) throw new Error("Missing native group");
    applied(
      await instance.dispatch(Actions.moveNode(second.id, group.getId(), DockLocation.CENTER, -1)),
    );
    render(<Workbench instance={instance} />);
    const pill = await screen.findByRole("button", { name: "Reports" });
    fireEvent.keyDown(pill, { key: "ContextMenu" });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    const rename = screen.getByRole("textbox");
    fireEvent.change(rename, { target: { value: "Renamed reports" } });
    fireEvent.keyDown(rename, { key: "Enter" });
    await waitFor(() => expect(group.getName()).toBe("Renamed reports"));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Renamed reports" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Group color/i })[0]!);
    await waitFor(() => expect(group.getColor()).not.toBe("#426b42"));
    await act(async () => {
      applied(
        await instance.dispatch(Actions.updateNodeAttributes(group.getId(), { opened: false })),
      );
    });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Renamed reports" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Close Group" }));
    await waitFor(() => expect(instance.getDocuments()).toHaveLength(0));
  });

  it("collapses, removes members and ungroups an existing native border group", async () => {
    const { instance, first, open } = await fixture();
    const second = await open("B");
    applied(await instance.dispatch(Actions.addTabToNewGroup(first.id, "Reports", "#426b42")));
    const group = instance.model.getNodeById(first.id)?.getParent();
    if (!(group instanceof TabGroupNode)) throw new Error("Missing native group");
    applied(
      await instance.dispatch(Actions.moveNode(second.id, group.getId(), DockLocation.CENTER, -1)),
    );
    applied(
      await instance.dispatch(
        Actions.moveNode(group.getId(), "border_right", DockLocation.CENTER, -1),
      ),
    );
    render(<Workbench instance={instance} />);
    fireEvent.contextMenu(await screen.findByRole("button", { name: "Reports" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Collapse" }));
    await waitFor(() => expect(group.isOpened()).toBe(false));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Reports" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Expand" }));
    await waitFor(() => expect(group.isOpened()).toBe(true));
    fireEvent.contextMenu(await screen.findByRole("tab", { name: "A" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from group" }));
    await waitFor(() =>
      expect(instance.model.getNodeById(first.id)?.getParent()?.getId()).toBe("border_right"),
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Reports" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ungroup" }));
    await waitFor(() => expect(instance.model.getNodeById(group.getId())).toBeUndefined());
    expect(instance.model.getNodeById(second.id)?.getParent()?.getId()).toBe("border_right");
    expect(instance.getDocument(first.id)?.handle).toBe(first.handle);
    expect(instance.getDocument(second.id)?.handle).toBe(second.handle);
  });

  it("discards a chosen host callback when its original node disappears before exit completes", async () => {
    const { instance, first } = await fixture();
    const closed: (() => void)[] = [];
    const selected = vi.fn<() => void>();
    function AnimatedMenu({ open, onClosed, ...props }: MenuRendererProps) {
      useEffect(() => {
        if (!open) closed.push(onClosed);
      }, [open, onClosed]);
      return open ? <PopupMenu {...props} /> : null;
    }
    render(
      <Workbench
        instance={instance}
        menus={{
          render: (props) => <AnimatedMenu {...props} />,
          transform: ({ items }) => [
            ...items,
            { key: "host", label: "Host operation", onSelect: selected },
          ],
        }}
      />,
    );
    fireEvent.contextMenu(await screen.findByRole("tab", { name: "A" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Host operation" }));
    expect(selected).not.toHaveBeenCalled();
    await act(async () => {
      applied(await instance.close(first.id));
    });
    act(() => {
      closed.forEach((done) => done());
    });
    expect(selected).not.toHaveBeenCalled();
  });
});
