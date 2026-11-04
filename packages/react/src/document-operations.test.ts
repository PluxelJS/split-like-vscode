import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { Actions, DockLocation } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchSnapshot, type LeaveRequest } from "./index";
import { integrationState } from "./internal";
/* eslint-disable no-await-in-loop -- Native scenarios and resource teardown deliberately run in order. */
import type { LeaveDecision } from "./types";

const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
});
const nav = (id: string, filter = "", source = "S") => ({
  to: "/sources/$source/documents/$id" as const,
  params: { source, id },
  search: { filter },
});
async function setup(snapshot?: WorkbenchSnapshot) {
  const load = vi.fn<(id: string) => void>();
  const root = createRootRoute();
  const document = createRoute({
    getParentRoute: () => root,
    path: "/sources/$source/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      filter: typeof search.filter === "string" ? search.filter : "",
    }),
    loader: ({ params }) => {
      load(params.id);
    },
    staticData: {
      worksplit: {
        title: "Document",
        documentKey: ({ params }) => `${params.source}:${params.id}`,
      },
    },
  });
  const alias = createRoute({
    getParentRoute: () => root,
    path: "/alias",
    beforeLoad: () => {
      throw redirect(nav("B"));
    },
  });
  const routeTree = root.addChildren([document, alias]);
  const workbench = createWorkbench({
    workspaceId: "document-operations",
    createRouter: (history: RouterHistory) =>
      createRouter({ routeTree, history, defaultPendingMinMs: 0, defaultStaleTime: Infinity }),
    ...(snapshot ? { initial: { snapshot } } : {}),
  });
  disposals.push(() => workbench.dispose());
  await workbench.start();
  const open = async (id: string, preview = false) => {
    const result = await workbench.open(nav(id), { preview });
    if (result.status !== "applied") throw new Error(result.status);
    return result.value.document.id;
  };
  return { workbench, open, load };
}
function deny(workbench: Awaited<ReturnType<typeof setup>>["workbench"], id: string) {
  const decide = vi.fn<() => LeaveDecision>(() => ({ decision: "deny" as const }));
  integrationState(workbench).registerController(workbench.getContent(id)!.handle, {
    controller: { leave: { getState: () => ({ hasUnsavedChanges: true, token: 1 }), decide } },
  });
  return decide;
}
describe("document entrances and replaceable previews", () => {
  it.each(["close", "dispose", "next-preview"] as const)(
    "settles the admitted preview before old cleanup waits through %s",
    async (next) => {
      const { workbench, open } = await setup();
      const a = await open("A", true);
      let finishCleanup!: () => void;
      const cleanup = new Promise<void>((resolve) => {
        finishCleanup = resolve;
      });
      workbench.getContent(a)!.handle.runEffect(({ defer }) => defer(() => cleanup));
      const opening = workbench.open(nav("B"), { preview: true });
      try {
        await vi.waitFor(() =>
          expect(workbench.getDocuments().some((doc) => doc.href.includes("/B"))).toBe(true),
        );
        const b = workbench.getDocuments().find((doc) => doc.href.includes("/B"))!;
        let previews: string[] = [];
        if (next === "close") await workbench.close(b.id);
        else if (next === "dispose") await workbench.dispose();
        else previews = [await open("C", true)];
        expect(workbench.getDocument(b.id)).toBeNull();
        expect(
          workbench
            .getDocuments()
            .filter((doc) => doc.preview)
            .map((doc) => doc.id),
        ).toEqual(previews);
        finishCleanup();
        expect(await opening).toMatchObject({
          status: "applied",
          value: { document: { id: b.id, href: b.href, preview: true } },
        });
      } finally {
        finishCleanup();
        await opening;
      }
    },
  );
  it.each(["explicit", "context"] as const)(
    "resolves relative link hrefs from the %s source document",
    async (sourceKind) => {
      const { workbench } = await setup();
      await workbench.open(nav("A", "", "S"));
      const second = await workbench.open(nav("B", "", "T"));
      if (second.status !== "applied") throw new Error(second.status);
      const link = workbench.createLink(
        {
          from: "/sources/$source/documents/$id",
          to: ".",
          params: true,
          search: { filter: "cash" },
        },
        {
          ...(sourceKind === "explicit" ? { source: second.value.document.handle } : {}),
          reuse: "navigate",
        },
      );
      expect(link.href).toBe("/sources/T/documents/B?filter=cash");
      expect(await link.open()).toMatchObject({
        status: "applied",
        value: { document: { id: second.value.document.id, href: link.href } },
      });
    },
  );
  it("preserves an existing custom identity without changing its filters or asking its guard", async () => {
    const { workbench, load } = await setup();
    const first = await workbench.open(nav("A", "cash"));
    if (first.status !== "applied") throw new Error(first.status);
    const decide = deny(workbench, first.value.document.id);
    const count = load.mock.calls.length;
    expect(await workbench.open(nav("A"))).toMatchObject({
      status: "applied",
      value: {
        reused: true,
        document: { id: first.value.document.id, href: first.value.document.href },
      },
    });
    expect(decide).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(count);
    expect((await workbench.open(nav("A"), { reuse: "navigate" })).status).toBe("denied");
    expect(decide).toHaveBeenCalledOnce();
  });
  it("deduplicates the final redirect without replacing an unrelated preview", async () => {
    const { workbench, open } = await setup();
    const b = await workbench.open(nav("B", "cash"));
    if (b.status !== "applied") throw new Error(b.status);
    const a = await open("A", true);
    expect(await workbench.open({ to: "/alias" }, { preview: true })).toMatchObject({
      status: "applied",
      value: { document: { id: b.value.document.id, href: b.value.document.href, preview: false } },
    });
    expect(workbench.getDocument(a)?.preview).toBe(true);
    expect(workbench.getDocuments()).toHaveLength(2);
  });
  it("replaces a clean preview with a fresh lifetime and retains ordinary comparisons", async () => {
    const { workbench, open } = await setup();
    const permanent = await open("A");
    const b = await open("B", true);
    const disposed = vi.fn<() => void>();
    workbench.getContent(b)!.handle.runEffect((effect) => effect.defer(disposed));
    const c = await open("C", true);
    expect(c).not.toBe(b);
    expect(workbench.getDocument(b)).toBeNull();
    expect(disposed).toHaveBeenCalledOnce();
    expect(workbench.getDocuments().map((doc) => doc.id)).toEqual([permanent, c]);
    expect(workbench.getDocument(c)?.preview).toBe(true);
    await workbench.keepOpen(c);
    await open("D", true);
    expect(workbench.getDocument(c)?.preview).toBe(false);
    expect((await workbench.close(c)).status).toBe("applied");
  });
  it("keeps dirty and pinned previews without asking an interactive decision", async () => {
    const { workbench, open } = await setup();
    const a = await open("A", true);
    const decide = deny(workbench, a);
    const b = await open("B", true);
    expect(workbench.getDocument(a)?.preview).toBe(false);
    expect(decide).not.toHaveBeenCalled();
    await workbench.dispatch(Actions.setTabPinned(b, true));
    await open("C", true);
    expect(workbench.getDocuments()).toHaveLength(3);
    expect(workbench.getDocuments().filter((doc) => doc.preview)).toHaveLength(1);
  });
  it("keeps the previous preview when destination admission fails", async () => {
    const { workbench, open } = await setup();
    const a = await open("A", true);
    expect(
      (
        await workbench.open(nav("B"), {
          preview: true,
          destination: { target: "missing", location: DockLocation.CENTER },
        })
      ).status,
    ).toBe("denied");
    expect(workbench.getDocuments()).toMatchObject([{ id: a, preview: true }]);
  });
  it("creates ordinary independent copies and returns an invalid-argument result for background previews", async () => {
    const { workbench, open } = await setup();
    const a = await open("A", true);
    expect(await workbench.duplicate(a)).toMatchObject({
      status: "applied",
      value: { reused: false, document: { preview: false } },
    });
    expect(await workbench.duplicate("missing")).toMatchObject({
      status: "denied",
      reason: "missing-content",
    });
    // @ts-expect-error Runtime JS consumers receive the same explicit rejection.
    expect(await workbench.open(nav("B"), { preview: true, presentation: "background" })).toEqual({
      status: "denied",
      reason: "invalid-argument",
    });
  });
  it.each(["document", "explicit"] as const)(
    "duplicates an inactive document into its %s source container",
    async (sourceKind) => {
      const { workbench, open } = await setup();
      const a = await open("A");
      const aContainer = workbench.getDocument(a)!.containerId!;
      const other = await workbench.open(nav("B"), {
        destination: { target: aContainer, location: DockLocation.RIGHT },
      });
      if (other.status !== "applied") throw new Error(other.status);
      const b = other.value.document;
      expect(b.containerId).not.toBe(aContainer);
      const source = sourceKind === "explicit" ? b.handle : undefined;
      const result = await workbench.duplicate(a, source ? { source } : {});
      expect(result).toMatchObject({
        status: "applied",
        value: {
          reused: false,
          document: {
            href: workbench.getDocument(a)!.href,
            containerId: source ? b.containerId : aContainer,
            preview: false,
          },
        },
      });
      expect(workbench.getDocuments()).toHaveLength(3);
    },
  );
  it("restores a preview and reuses its declared identity across filters", async () => {
    const first = await setup();
    const a = await first.workbench.open(nav("A", "cash"), { preview: true });
    if (a.status !== "applied") throw new Error(a.status);
    const second = await setup(first.workbench.createSnapshot());
    expect(await second.workbench.open(nav("A"), { preview: true })).toMatchObject({
      status: "applied",
      value: {
        reused: true,
        document: { id: a.value.document.id, href: a.value.document.href, preview: true },
      },
    });
    await second.open("B", true);
    expect(second.workbench.getDocument(a.value.document.id)).toBeNull();
  });
  it("supplies native locations and finite attempt context to same-document view changes", async () => {
    const { workbench, open } = await setup();
    const a = await open("A");
    const decide = vi.fn<(request: LeaveRequest) => LeaveDecision>((request: LeaveRequest) =>
      request.reason === "navigate" && request.from.pathname === request.to.pathname
        ? { decision: "allow" as const, token: 1 }
        : { decision: "deny" as const },
    );
    integrationState(workbench).registerController(workbench.getContent(a)!.handle, {
      controller: { leave: { getState: () => ({ hasUnsavedChanges: true, token: 1 }), decide } },
    });
    expect((await workbench.open(nav("A", "cash"), { reuse: "navigate" })).status).toBe("applied");
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "navigate",
        content: workbench.getContent(a)!.handle,
        from: expect.objectContaining({ pathname: "/sources/S/documents/A" }),
        to: expect.objectContaining({ searchStr: "?filter=cash" }),
      }),
    );
    expect((await workbench.close(a)).status).toBe("denied");
    expect(decide).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "close" }));
  });
});
