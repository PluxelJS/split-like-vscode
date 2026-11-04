import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouter,
  useRouterState,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createWorkbench, useContent, Workbench, type DocumentInfo } from "@worksplit/react";
import { Actions, DockLocation, Model, type IJsonModel } from "flexlayout-react";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Editor, EditorDocument } from "../../demo/src/examples/editor";
import type { EditorPersistence } from "../../demo/src/examples/editor-store";
import { createExampleMenus, ExampleMenuProvider } from "../../demo/src/examples/menus";

const disposals: (() => Promise<unknown>)[] = [];
const releaseGates: (() => void)[] = [];
const dialogDescriptors = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  // jsdom has no geometry or modal top layer. Router, Model, Layout, portals and hooks stay real.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 700),
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: false,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  }));
  for (const method of ["showModal", "close"]) {
    dialogDescriptors.set(
      method,
      Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method),
    );
  }
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
      this.querySelector<HTMLElement>("[autofocus]")?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
});

afterEach(async () => {
  for (const release of releaseGates.splice(0)) release();
  try {
    await act(async () => {
      // oxlint-disable-next-line no-await-in-loop -- Shared document and DOM resources must be disposed serially.
      for (const dispose of disposals.splice(0)) await dispose();
    });
  } finally {
    cleanup();
    for (const [method, descriptor] of dialogDescriptors) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
    }
    dialogDescriptors.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  releaseGates.push(() => resolve(fallback));
  return { promise, resolve };
}

async function settled<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The public operation did not settle")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A real asynchronous saved-copy service, with a gate at its persistence boundary. */
function savedCopies() {
  const saved = new Map<string, string>();
  const writes: { resource: string; text: string; complete: () => void }[] = [];
  let fail = false;
  const persistence: EditorPersistence = {
    description: "test memory persistence",
    read: (resource) => saved.get(resource) ?? "",
    async write(resource, text) {
      const gate = deferred<void>(undefined);
      const shouldFail = fail;
      fail = false;
      writes.push({ resource, text, complete: () => gate.resolve() });
      await gate.promise;
      if (shouldFail) throw new Error("The saved-copy service rejected this write");
      saved.set(resource, text);
    },
    failNextWrite() {
      fail = true;
    },
  };
  return { persistence, saved, writes };
}

function fixture(
  options: {
    tool?: boolean;
    editable?: boolean;
    read?: (name: string) => Promise<void> | void;
  } = {},
) {
  const copies = savedCopies();
  const routers = new Map<string, AnyRouter>();
  function Root() {
    const content = useContent();
    const router = useRouter();
    const resource = useRouterState({
      router,
      select: (state) => {
        const accepted = state.resolvedLocation ?? state.location;
        const match = router.matchRoutes(accepted).find((route) => route.routeId === "/edit/$name");
        return match ? String(match.params.name) : null;
      },
    });
    useEffect(() => {
      routers.set(content.id, router);
      return () => {
        routers.delete(content.id);
      };
    }, [content, router]);
    return options.editable === false ? (
      <Outlet />
    ) : (
      <EditorDocument resource={resource} persistence={copies.persistence}>
        <Outlet />
      </EditorDocument>
    );
  }
  const root = createRootRoute({ component: Root });
  const read = createRoute({
    getParentRoute: () => root,
    path: "/read/$name",
    component: () => <h1>Read {read.useParams().name}</h1>,
    loader: ({ params }) => options.read?.(params.name),
    staticData: {
      worksplit: {
        title: "Public report",
        navigationKey: "read",
        documentKey: ({ params }) => `read:${params.name}`,
      },
    },
  });
  const edit = createRoute({
    getParentRoute: () => root,
    path: "/edit/$name",
    component: Editor,
    staticData: {
      worksplit: { navigationKey: "edit", documentKey: ({ params }) => `edit:${params.name}` },
    },
  });
  const tree = root.addChildren([read, edit]);
  const makeRouter = (history: RouterHistory) =>
    createRouter({
      routeTree: tree,
      history,
      defaultPendingMs: 10_000,
      defaultPendingMinMs: 0,
      defaultStaleTime: Infinity,
    });
  const layout: IJsonModel = {
    global: { tabEnableFloat: false, tabEnablePopout: false },
    layout: { type: "row", children: [{ type: "tabset", id: "documents", children: [] }] },
    borders: options.tool
      ? [
          {
            type: "border",
            location: "bottom",
            size: 240,
            selected: 0,
            children: [{ type: "tab", id: "guard", component: "example:editor", name: "Guard" }],
          },
        ]
      : [],
  };
  const instance = createWorkbench({
    createRouter: makeRouter,
    initial: { layout },
    home: { mode: "empty", href: "/" },
    tools: {
      "example:editor": {
        render: () => (
          <EditorDocument resource="guard" persistence={copies.persistence}>
            <Editor />
          </EditorDocument>
        ),
      },
    },
  });
  disposals.push(() => instance.dispose());
  const start = async (href: string) => {
    const result = await instance.start({ href });
    expect(result).toMatchObject({ status: "applied" });
    if (result.status !== "applied" || !result.value.document)
      throw new Error("Fixture document was not admitted");
    return result.value.document;
  };
  return { instance, start, routers, makeRouter, ...copies };
}

function input(resource: string) {
  return within(
    screen.getByRole("region", { name: `Editor ${resource}` }),
  ).getByRole<HTMLTextAreaElement>("textbox", { name: "Text" });
}

function status(resource: string) {
  return within(screen.getByRole("region", { name: `Editor ${resource}` })).getByRole("status")
    .textContent;
}

async function choose(name: "Save and leave" | "Leave without saving" | "Keep editing") {
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name }));
}

function nativeTab(document: DocumentInfo) {
  const tab = globalThis.document.getElementById(`flexlayout-tabbutton-${document.id}`);
  if (!tab) throw new Error("The real native tab was not rendered");
  return tab;
}

describe("public Worksplit examples with native Router and Layout", () => {
  it("renders and closes read-only content without declaring a controller or copying the Model", async () => {
    const { instance, start } = fixture({ editable: false });
    const first = await start("/read/one");
    const model = instance.model;
    render(
      <StrictMode>
        <Workbench instance={instance} />
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: "Read one" });
    expect(model).toBeInstanceOf(Model);
    expect(first.node).toBe(model.getNodeById(first.id));
    expect(nativeTab(first)).toBeTruthy();
    let second!: Awaited<ReturnType<typeof instance.open>>;
    await act(async () => {
      second = await instance.open({ to: "/read/$name", params: { name: "two" } });
    });
    expect(second.status).toBe("applied");
    await screen.findByRole("heading", { name: "Read two" });
    await act(async () => {
      expect((await instance.close(first.id)).status).toBe("applied");
    });
    expect(instance.model).toBe(model);
    expect(instance.getDocument(first.id)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(instance.getDocuments()).toHaveLength(1);
  });

  it("runs the actual save-and-leave UI and refuses to approve edits absent from the saved basis", async () => {
    const { instance, start, writes, saved } = fixture();
    const document = await start("/edit/notes");
    render(
      <StrictMode>
        <Workbench instance={instance} />
      </StrictMode>,
    );
    await screen.findByRole("region", { name: "Editor notes" });
    fireEvent.change(input("notes"), { target: { value: "A" } });
    let first!: ReturnType<typeof instance.close>;
    await act(async () => {
      first = instance.close(document.id);
    });
    await choose("Save and leave");
    await waitFor(() => expect(writes).toHaveLength(1));
    fireEvent.change(input("notes"), { target: { value: "B" } });
    await act(async () => {
      writes[0]!.complete();
    });
    expect((await settled(first)).status).toBe("denied");
    expect(saved.get("notes")).toBe("A");
    expect(input("notes").value).toBe("B");
    expect(input("notes").disabled).toBe(false);
    expect(instance.getDocument(document.id)).not.toBeNull();

    let second!: ReturnType<typeof instance.close>;
    await act(async () => {
      second = instance.close(document.id);
    });
    await choose("Save and leave");
    await waitFor(() => expect(writes).toHaveLength(2));
    await act(async () => {
      writes[1]!.complete();
    });
    expect((await settled(second)).status).toBe("applied");
    expect(saved.get("notes")).toBe("B");
    expect(instance.getDocument(document.id)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps T1 paused while a later native navigation is denied, then releases on actual acceptance", async () => {
    const slow = deferred<void>(undefined);
    const rejected = deferred<boolean>(true);
    const { instance, start, routers } = fixture({
      read: (name) => (name === "slow" ? slow.promise : undefined),
    });
    const document = await start("/edit/notes");
    render(<Workbench instance={instance} />);
    await screen.findByRole("region", { name: "Editor notes" });
    fireEvent.change(input("notes"), { target: { value: "draft" } });
    const router = routers.get(document.id)!;
    let laterBlocker = false;
    const blocker: Parameters<RouterHistory["block"]>[0] = {
      blockerFn: ({ nextLocation }) => {
        if (nextLocation.pathname !== "/read/rejected") return false;
        laterBlocker = true;
        return rejected.promise;
      },
    };
    const unblock = router.history.block(blocker);
    let first!: Promise<void>;
    await act(async () => {
      first = router.navigate({ to: "/read/slow" });
    });
    await choose("Leave without saving");
    await waitFor(() => expect(router.history.location.pathname).toBe("/read/slow"));
    expect(instance.getDocument(document.id)?.href).toBe("/edit/notes");
    expect(input("notes").disabled).toBe(true);
    expect(status("notes")).toContain("paused for 1 leave request");

    let second!: Promise<void>;
    await act(async () => {
      second = router.navigate({ to: "/read/rejected" });
    });
    await choose("Leave without saving");
    await waitFor(() => expect(laterBlocker).toBe(true));
    expect(status("notes")).toContain("paused for 2 leave request");
    await act(async () => {
      rejected.resolve(true);
      await settled(second);
    });
    expect(input("notes").disabled).toBe(true);
    expect(status("notes")).toContain("paused for 1 leave request");
    expect(router.history.location.pathname).toBe("/read/slow");
    await act(async () => {
      slow.resolve();
    });
    await screen.findByRole("heading", { name: "Read slow" });
    await settled(first);
    expect(instance.getDocument(document.id)?.href).toBe("/read/slow");
    unblock();
    await act(async () => {
      await router.navigate({ to: "/edit/notes" });
    });
    await screen.findByRole("region", { name: "Editor notes" });
    expect(input("notes").disabled).toBe(false);
  });

  it("releases an earlier editor's close approval when a later tool in the same close batch refuses", async () => {
    const { instance, start, saved } = fixture({ tool: true });
    const document = await start("/edit/notes");
    render(<Workbench instance={instance} />);
    await screen.findByRole("region", { name: "Editor notes" });
    await screen.findByRole("region", { name: "Editor guard" });
    fireEvent.change(input("notes"), { target: { value: "document draft" } });
    fireEvent.change(input("guard"), { target: { value: "tool draft" } });
    let closing!: ReturnType<typeof instance.close>;
    await act(async () => {
      closing = instance.close([document.id, "guard"]);
    });
    expect(await screen.findByRole("heading", { name: "Leave notes?" })).toBeTruthy();
    await choose("Leave without saving");
    expect(await screen.findByRole("heading", { name: "Leave guard?" })).toBeTruthy();
    expect(input("notes").disabled).toBe(true);
    await choose("Keep editing");
    expect((await settled(closing)).status).toBe("denied");
    expect(input("notes").disabled).toBe(false);
    expect(input("notes").value).toBe("document draft");
    expect(input("guard").value).toBe("tool draft");
    expect(instance.getDocument(document.id)).not.toBeNull();
    expect(instance.getContent("guard")?.role).toBe("tool");
    expect(saved.size).toBe(0);
  });

  it("releases an accepted search-only navigation pause while preserving the same editor and draft", async () => {
    const { instance, start, routers } = fixture();
    const document = await start("/edit/notes");
    render(<Workbench instance={instance} />);
    await screen.findByRole("region", { name: "Editor notes" });
    const field = input("notes");
    fireEvent.change(field, { target: { value: "kept draft" } });
    const router = routers.get(document.id)!;
    let navigating!: Promise<void>;
    await act(async () => {
      navigating = router.navigate({ to: "/edit/notes", search: { view: "second" } });
    });
    await choose("Leave without saving");
    await act(async () => {
      await settled(navigating);
    });
    expect(router.state.location.search).toMatchObject({ view: "second" });
    expect(input("notes")).toBe(field);
    expect(field.value).toBe("kept draft");
    expect(field.disabled).toBe(false);
    expect(status("notes")).not.toContain("Editing paused");
    fireEvent.change(field, { target: { value: "next edit" } });
    expect(field.value).toBe("next edit");
    expect(instance.getDocument(document.id)).not.toBeNull();
  });

  it("keeps the same tool controller and draft through native movement and protects native deletion", async () => {
    const { instance, start, saved, writes } = fixture({ tool: true });
    const document = await start("/read/one");
    render(<Workbench instance={instance} />);
    await screen.findByRole("region", { name: "Editor guard" });
    const field = input("guard");
    fireEvent.change(field, { target: { value: "tool draft" } });
    const tool = instance.getContent("guard")!;
    const model = instance.model;
    await act(async () => {
      const moved = await instance.dispatch(
        Actions.moveNode("guard", document.containerId!, DockLocation.CENTER, -1),
      );
      expect(moved).toMatchObject({ status: "applied" });
    });
    expect(input("guard")).toBe(field);
    expect(instance.getContent("guard")?.handle).toBe(tool.handle);
    expect(instance.getContent("guard")?.role).toBe("tool");
    let deleting!: ReturnType<typeof instance.dispatch>;
    await act(async () => {
      deleting = instance.dispatch(Actions.deleteTab("guard"));
    });
    await choose("Keep editing");
    expect((await settled(deleting)).status).toBe("denied");
    expect(field.value).toBe("tool draft");
    await act(async () => {
      deleting = instance.dispatch(Actions.deleteTab("guard"));
    });
    await choose("Save and leave");
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => {
      writes[0]!.complete();
    });
    expect((await settled(deleting)).status).toBe("applied");
    expect(saved.get("guard")).toBe("tool draft");
    expect(instance.getContent("guard")).toBeNull();
    expect(instance.model).toBe(model);
  });

  it("renders the shared custom menu under its provider and finishes menu focus return before the action", async () => {
    const { instance, start, makeRouter } = fixture();
    const document = await start("/read/one");
    const observations: { id: string; active: Element | null; menu: Element | null }[] = [];
    const inspect = vi.fn<(id: string) => void>((id) => {
      observations.push({
        id,
        active: globalThis.document.activeElement,
        menu: screen.queryByRole("menu"),
      });
      screen.getByRole("button", { name: "After inspection" }).focus();
    });
    const menus = createExampleMenus<ReturnType<typeof makeRouter>>(inspect);
    render(
      <ExampleMenuProvider>
        <button type="button">After inspection</button>
        <Workbench instance={instance} menus={menus} />
      </ExampleMenuProvider>,
    );
    await screen.findByRole("heading", { name: "Read one" });
    const tab = nativeTab(document);
    tab.focus();
    fireEvent.contextMenu(tab);
    const item = await screen.findByRole("menuitem", { name: "Inspect content" });
    expect(item.getAttribute("data-example-menu-theme")).toBe("#426b42");
    fireEvent.click(item);
    await waitFor(() => expect(inspect).toHaveBeenCalledOnce());
    expect(observations).toEqual([{ id: document.id, active: tab, menu: null }]);
    await act(async () => undefined);
    expect(globalThis.document.activeElement).toBe(
      screen.getByRole("button", { name: "After inspection" }),
    );
  });
});
