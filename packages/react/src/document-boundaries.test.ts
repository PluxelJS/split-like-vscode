import { createRootRoute, createRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { Actions } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchInstance, type WorkbenchSnapshot } from "./index";
import { integrationState } from "./integration";

const instances: WorkbenchInstance<AnyRouter>[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((w) => w.dispose()));
});
function setup(
  loader: (id: string) => void | Promise<void> = () => {},
  snapshot?: WorkbenchSnapshot,
) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === "string" ? search.view : "edit",
    }),
    loader: ({ params }) => loader(params.id),
    staticData: { worksplit: { title: "Document" } },
  });
  const tree = root.addChildren([route]);
  const onIssue = vi.fn<(issue: unknown) => void>();
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: tree, history, defaultPendingMinMs: 0 }),
    onIssue,
    ...(snapshot ? { snapshot } : {}),
  });
  instances.push(workbench);
  const open = (id: string) =>
    workbench.open(
      { to: "/documents/$id", params: { id }, search: { view: "edit" } },
      { preview: true },
    );
  return { workbench, open, onIssue, internal: integrationState(workbench) };
}

describe("preview admission boundaries", () => {
  it("supersedes a slow preview when shell focus revokes its foreground eligibility", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { workbench, open, internal } = setup((id) => (id === "B" ? gate : undefined));
    const a = await open("A");
    if (a.status !== "committed") throw new Error(a.status);
    const pending = open("B");
    internal.focus(null, "shell");
    finish();
    expect(await pending).toEqual({ status: "superseded" });
    expect(workbench.getDocuments()).toMatchObject([{ id: a.document.id, preview: true }]);
    expect(workbench.getEditingContext()).toMatchObject({
      activeTabId: a.document.id,
      focusedArea: "shell",
    });
  });

  it("keeps explicit copies as ordinary background admissions after focus changes", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { workbench, open, internal } = setup((id) => (id === "B" ? gate : undefined));
    const a = await open("A");
    if (a.status !== "committed") throw new Error(a.status);
    const pending = workbench.open(
      { to: "/documents/$id", params: { id: "B" }, search: { view: "edit" } },
      { preview: true, newInstance: true },
    );
    internal.focus(null, "shell");
    finish();
    expect(await pending).toMatchObject({ status: "committed", document: { preview: false } });
    expect(workbench.getDocument(a.document.id)?.preview).toBe(true);
    expect(workbench.getEditingContext()).toMatchObject({
      activeTabId: a.document.id,
      focusedArea: "shell",
    });
  });

  it("navigates a lazy restored identity with different search without admitting a duplicate", async () => {
    const first = setup();
    const a = await first.open("A");
    if (a.status !== "committed") throw new Error(a.status);
    const second = setup(undefined, first.workbench.snapshot());
    const result = await second.workbench.open({
      to: "/documents/$id",
      params: { id: "A" },
      search: { view: "compare" },
    });
    expect(result).toMatchObject({
      status: "committed",
      reused: true,
      document: { id: a.document.id, href: "/documents/A?view=compare" },
    });
    expect(second.workbench.getDocuments()).toHaveLength(1);
  });

  it("retains a preview explicitly kept while its replacement is loading", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { workbench, open } = setup((id) => (id === "B" ? gate : undefined));
    const a = await open("A");
    if (a.status !== "committed") throw new Error(a.status);
    const pending = open("B");
    workbench.keep(a.document.id);
    finish();
    expect((await pending).status).toBe("committed");
    expect(workbench.getDocument(a.document.id)?.preview).toBe(false);
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("retains a preview explicitly kept by an admission observer", async () => {
    const { workbench, open, internal } = setup();
    const a = await open("A");
    if (a.status !== "committed") throw new Error(a.status);
    const observe = (action: { type: string }) => {
      if (action.type === Actions.ADD_TAB) workbench.keep(a.document.id);
    };
    internal.model.addChangeListener(observe);
    expect((await open("B")).status).toBe("committed");
    internal.model.removeChangeListener(observe);
    expect(workbench.getDocument(a.document.id)?.preview).toBe(false);
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("reports retiring-preview cleanup failure without failing the admitted document", async () => {
    const { workbench, open, internal, onIssue } = setup();
    const a = await open("A");
    if (a.status !== "committed") throw new Error(a.status);
    const cleanupError = new Error("cleanup failed");
    internal.content(a.document.id).effect(({ defer }) => {
      defer(async () => {
        throw cleanupError;
      });
    });
    const b = await open("B");
    expect(b.status).toBe("committed");
    await vi.waitFor(() =>
      expect(onIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "operation-failed",
          error: cleanupError,
          id: a.document.id,
        }),
      ),
    );
    expect(workbench.getDocument(a.document.id)).toBeNull();
    expect(workbench.getDocuments()).toHaveLength(1);
  });

  it("does not report a committed admission as a load failure when retiring guard inspection throws", async () => {
    const { workbench, open, internal, onIssue } = setup();
    const a = await open("A");
    if (a.status !== "committed") throw new Error(a.status);
    const guardError = new Error("guard read failed");
    internal.registerOwner(a.document.id, {
      isDirty: () => {
        throw guardError;
      },
    });
    const b = await open("B");
    expect(b.status).toBe("committed");
    expect(onIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: "operation-failed", error: guardError, id: a.document.id }),
    );
    expect(workbench.getDocument(a.document.id)?.preview).toBe(false);
    expect(workbench.getDocuments()).toHaveLength(2);
  });

  it("passes native Router search navigation through the same leave context", async () => {
    const { workbench, open, internal } = setup();
    const a = await open("A");
    if (a.status !== "committed") throw new Error(a.status);
    const beforeLeave = vi.fn<() => boolean>(() => true);
    internal.registerOwner(a.document.id, { isDirty: () => true, beforeLeave });
    await internal.documents
      .get(a.document.id)!
      .router!.navigate({ href: "/documents/A?view=compare" });
    expect(beforeLeave).toHaveBeenCalledWith("navigate", {
      id: a.document.id,
      from: "/documents/A?view=edit",
      to: "/documents/A?view=compare",
    });
    expect(workbench.getDocument(a.document.id)?.href).toBe("/documents/A?view=compare");
  });
});
