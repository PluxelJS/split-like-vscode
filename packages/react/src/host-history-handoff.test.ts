import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { Actions } from "flexlayout-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type StartResult } from "./index";
import { integrationState } from "./integration";

const disposals: (() => void | Promise<unknown>)[] = [];
const pendingDecisions: (() => void)[] = [];
const pickerHref = "/host/picker?from=login#communities";
const documentHref = (id: string) => `/workspace/documents/${id}?view=edit#editor-${id}`;
const browserHref = () => window.location.pathname + window.location.search + window.location.hash;
const nativeIndex = (state: object = window.history.state) =>
  Reflect.get(state, "__TSR_index") as number;

afterEach(async () => {
  pendingDecisions.splice(0).forEach((finish) => finish());
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function decision() {
  let resolve!: (allowed: boolean) => void;
  const promise = new Promise<boolean>((finish) => {
    resolve = finish;
  });
  pendingDecisions.push(() => resolve(false));
  return { promise, resolve };
}

function committed(result: StartResult) {
  expect(result.status).toBe("committed");
  if (result.status !== "committed") throw new Error(`Document was ${result.status}`);
  return result.document;
}

async function setup(
  beforeOutsideScope?: (
    href: string,
    context: { signal: AbortSignal },
  ) => boolean | Promise<boolean>,
) {
  window.history.replaceState(null, "", "/host/login");
  const root = createRootRoute();
  const login = createRoute({ getParentRoute: () => root, path: "/host/login" });
  const picker = createRoute({ getParentRoute: () => root, path: "/host/picker" });
  const home = createRoute({ getParentRoute: () => root, path: "/workspace" });
  const document = createRoute({
    getParentRoute: () => root,
    path: "/workspace/documents/$id",
    validateSearch: (search: Record<string, unknown>) => ({
      view: typeof search.view === "string" ? search.view : "edit",
    }),
    staticData: { worksplit: { title: "Document" } },
  });
  const routeTree = root.addChildren([login, picker, home, document]);
  const makeRouter = (history: RouterHistory) =>
    createRouter({ routeTree, history, defaultPendingMinMs: 0, defaultStaleTime: Infinity });

  // The containing application creates the entries, including its native browser index.
  // It relinquishes browser history before the workspace attaches its coordinator.
  const outerHistory = createBrowserHistory();
  disposals.push(() => outerHistory.destroy());
  const outer = makeRouter(outerHistory);
  await outer.load();
  await outer.navigate({ href: pickerHref });
  outerHistory.flush();
  const outsideIndex = nativeIndex();
  await outer.navigate({
    to: "/workspace/documents/$id",
    params: { id: "A" },
    search: { view: "edit" },
    hash: "editor-A",
  });
  outerHistory.flush();
  const entryIndex = nativeIndex();
  expect(entryIndex).toBe(outsideIndex + 1);
  expect(browserHref()).toBe(documentHref("A"));
  outerHistory.destroy();

  const issues = vi.fn<(issue: unknown) => void>();
  const workbench = createWorkbench({
    createRouter: makeRouter,
    workspaceId: "host-history-handoff",
    home: "/workspace",
    homeMode: "empty",
    onIssue: issues,
  });
  disposals.push(() => workbench.dispose());
  workbench.connectBrowser(beforeOutsideScope ? { beforeOutsideScope } : {});
  const a = committed(await workbench.start(documentHref("A")));
  // href-only callers must retain the public NavigateOptions contract despite this
  // Router having both required params and a typed search schema on document routes.
  const b = committed(await workbench.open({ href: documentHref("B") }));
  const c = committed(await workbench.open({ href: documentHref("C") }));
  expect(workbench.getDocuments()).toHaveLength(3);
  expect(browserHref()).toBe(c.href);
  expect(nativeIndex()).toBe(entryIndex + 2);
  return { workbench, issues, a, b, c, outsideIndex, entryIndex, makeRouter };
}

describe("browser history handoff to the containing Router", () => {
  it("restores the current document and native index after rejecting a multi-entry traversal", async () => {
    const beforeOutsideScope = vi.fn<() => boolean>(() => false);
    const { workbench, issues, c, entryIndex } = await setup(beforeOutsideScope);
    const documents = workbench.getDocuments();

    window.history.go(-3);
    await vi.waitFor(() => {
      expect(beforeOutsideScope).toHaveBeenCalledExactlyOnceWith(
        pickerHref,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(browserHref()).toBe(c.href);
      expect(nativeIndex()).toBe(entryIndex + 2);
    });
    expect(workbench.getActiveDocument()?.id).toBe(c.id);
    expect(workbench.getDocuments()).toEqual(documents);
    expect(issues).not.toHaveBeenCalled();

    // Rejection restored the actual history position, so ordinary Back/Forward still
    // traverses owned documents rather than a fabricated replacement entry.
    window.history.back();
    await vi.waitFor(() => {
      expect(browserHref()).toBe(documentHref("B"));
      expect(workbench.getActiveDocument()?.href).toBe(documentHref("B"));
    });
    window.history.forward();
    await vi.waitFor(() => {
      expect(browserHref()).toBe(c.href);
      expect(workbench.getActiveDocument()?.id).toBe(c.id);
    });
    expect(beforeOutsideScope).toHaveBeenCalledTimes(1);
    expect(issues).not.toHaveBeenCalled();
  });

  it("reports an approved outside entry once and suppresses publishing while confirmation is pending", async () => {
    const approval = decision();
    const beforeOutsideScope = vi.fn<(href: string) => Promise<boolean>>(() => approval.promise);
    const { workbench, issues, c, outsideIndex } = await setup(beforeOutsideScope);
    const documents = workbench.getDocuments();
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");

    window.history.go(-3);
    await vi.waitFor(() => {
      expect(beforeOutsideScope).toHaveBeenCalledExactlyOnceWith(
        pickerHref,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(browserHref()).toBe(pickerHref);
    });
    expect(nativeIndex()).toBe(outsideIndex);
    expect(issues).not.toHaveBeenCalled();

    // Explicit activation normally publishes the active document's location. A pending
    // host decision owns this outside address until its approval/refusal is settled.
    expect(workbench.activate(c.id, { focus: false })).toBe(true);
    await Promise.resolve();
    expect(browserHref()).toBe(pickerHref);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(await workbench.open({ href: documentHref("D") })).toMatchObject({
      status: "rejected",
      reason: "history-busy",
    });

    approval.resolve(true);
    await vi.waitFor(() => {
      expect(issues).toHaveBeenCalledExactlyOnceWith({
        code: "history-outside-scope",
        error: expect.any(Error),
      });
    });
    expect(browserHref()).toBe(pickerHref);
    expect(nativeIndex()).toBe(outsideIndex);
    expect(workbench.getActiveDocument()?.id).toBe(c.id);
    expect(workbench.getDocuments()).toEqual(documents);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("restores the owned entry and reports the original failure when the host decision rejects", async () => {
    const failure = new Error("The host could not settle its leave decision");
    const beforeOutsideScope = vi.fn<(href: string) => Promise<boolean>>(async () => {
      throw failure;
    });
    const { workbench, issues, c, entryIndex } = await setup(beforeOutsideScope);

    window.history.go(-3);
    await vi.waitFor(() => {
      expect(beforeOutsideScope).toHaveBeenCalledExactlyOnceWith(
        pickerHref,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(browserHref()).toBe(c.href);
      expect(nativeIndex()).toBe(entryIndex + 2);
      expect(issues).toHaveBeenCalledExactlyOnceWith({ code: "history", error: failure });
    });
    expect(workbench.getActiveDocument()?.id).toBe(c.id);
    expect(workbench.getDocuments()).toHaveLength(3);
  });

  it.each([true, false])(
    "resumes ordinary publishing after an owned pop supersedes a pending outside decision (%s)",
    async (allowed) => {
      const approval = decision();
      const beforeOutsideScope = vi.fn<(href: string) => Promise<boolean>>(() => approval.promise);
      const { workbench, issues, a } = await setup(beforeOutsideScope);
      window.history.go(-3);
      await vi.waitFor(() => {
        expect(browserHref()).toBe(pickerHref);
        expect(beforeOutsideScope).toHaveBeenCalledExactlyOnceWith(
          pickerHref,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });
      window.history.forward();
      await vi.waitFor(() => {
        expect(browserHref()).toBe(a.href);
        expect(workbench.getActiveDocument()?.id).toBe(a.id);
      });
      const d = committed(await workbench.open({ href: documentHref("D") }));
      expect(browserHref()).toBe(d.href);
      approval.resolve(allowed);
      await Promise.resolve();
      await Promise.resolve();
      expect(issues).not.toHaveBeenCalled();
      expect(browserHref()).toBe(d.href);
      window.history.back();
      await vi.waitFor(() => {
        expect(browserHref()).toBe(a.href);
        expect(workbench.getActiveDocument()?.id).toBe(a.id);
      });
    },
  );

  it.each(["batch", "individual"])(
    "preserves the departure entry and releases each document once when closing %s with history disabled",
    async (mode) => {
      const { workbench, c } = await setup();
      const documents = workbench.getDocuments();
      const nativeState = structuredClone(window.history.state);
      const releases = new Map(documents.map((document) => [document.id, 0]));
      for (const document of documents)
        integrationState(workbench).register(document.id, {
          dispose: () => {
            releases.set(document.id, releases.get(document.id)! + 1);
          },
        });

      const closed: { result: unknown; href: string; state: unknown }[] = [];
      if (mode === "batch") {
        closed.push({
          result: await workbench.dispatch(
            Actions.group(documents.map((document) => Actions.deleteTab(document.id))),
            { history: false },
          ),
          href: browserHref(),
          state: structuredClone(window.history.state),
        });
      } else {
        for (const document of documents.toReversed()) {
          // Each intermediate close chooses a surviving document without publishing it.
          closed.push({
            // eslint-disable-next-line no-await-in-loop -- Exercise sequential host handoff closes.
            result: await workbench.close(document.id, { history: false }),
            href: browserHref(),
            state: structuredClone(window.history.state),
          });
        }
      }

      for (const record of closed) {
        expect(record.result).toMatchObject({ status: "closed", cleanupErrors: [] });
        expect(record.href).toBe(c.href);
        expect(record.state).toEqual(nativeState);
      }
      expect(workbench.getDocuments()).toHaveLength(0);
      expect(workbench.getActiveDocument()).toBeNull();
      expect(browserHref()).toBe(c.href);
      expect(window.history.state).toEqual(nativeState);
      expect([...releases.values()]).toEqual([1, 1, 1]);
      await workbench.dispose();
      expect([...releases.values()]).toEqual([1, 1, 1]);
    },
  );

  it("cancels the native close transaction when an owned traversal supersedes the host confirmation", async () => {
    const approval = decision();
    let closeResult: unknown;
    let signal: AbortSignal | undefined;
    const beforeOutsideScope = vi.fn<
      (href: string, context: { signal: AbortSignal }) => Promise<boolean>
    >(async (_href, context) => {
      signal = context.signal;
      closeResult = await workbench.dispatch(
        Actions.group(workbench.getDocuments().map((document) => Actions.deleteTab(document.id))),
        { history: false, signal: context.signal },
      );
      return Reflect.get(closeResult as object, "status") === "closed";
    });
    const { workbench, issues, a } = await setup(beforeOutsideScope);
    const documents = workbench.getDocuments();
    const released = vi.fn<() => void>();
    const beforeLeave = vi.fn<() => Promise<boolean>>(() => approval.promise);
    for (const document of documents)
      integrationState(workbench).register(document.id, {
        isDirty: () => true,
        getCloseRevision: () => 1,
        beforeLeave,
        dispose: released,
      });
    window.history.go(-3);
    await vi.waitFor(() => expect(beforeLeave).toHaveBeenCalledTimes(1));
    expect(signal?.aborted).toBe(false);
    window.history.forward();
    await vi.waitFor(() => {
      expect(workbench.getActiveDocument()?.id).toBe(a.id);
      expect(browserHref()).toBe(a.href);
      expect(signal?.aborted).toBe(true);
      expect(closeResult).toEqual({ status: "superseded" });
    });
    // Even a non-cooperating host that approves the stale dialog later cannot remove content.
    approval.resolve(true);
    await Promise.resolve();
    expect(workbench.getDocuments()).toEqual(documents);
    expect(released).not.toHaveBeenCalled();
    expect(issues).not.toHaveBeenCalled();
    expect(await workbench.close(a.id)).toMatchObject({ status: "closed", cleanupErrors: [] });
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("restores the last document on return after an approved host handoff closes all content", async () => {
    const beforeOutsideScope = vi.fn<() => Promise<boolean>>(() => leave());
    const { workbench, issues, c, makeRouter } = await setup(beforeOutsideScope);
    const nativeState = structuredClone(window.history.state);
    let releases = 0;
    for (const document of workbench.getDocuments())
      integrationState(workbench).register(document.id, {
        dispose: () => {
          releases += 1;
        },
      });
    const leave = async () => {
      const outsideState = structuredClone(window.history.state);
      const result = await workbench.dispatch(
        Actions.group(workbench.getDocuments().map((document) => Actions.deleteTab(document.id))),
        { history: false },
      );
      expect(result).toMatchObject({ status: "closed", cleanupErrors: [] });
      expect(browserHref()).toBe(pickerHref);
      expect(window.history.state).toEqual(outsideState);
      return true;
    };

    window.history.go(-3);
    await vi.waitFor(() => {
      expect(issues).toHaveBeenCalledExactlyOnceWith({
        code: "history-outside-scope",
        error: expect.any(Error),
      });
      expect(releases).toBe(3);
    });
    expect(beforeOutsideScope).toHaveBeenCalledExactlyOnceWith(
      pickerHref,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await workbench.dispose();
    expect(releases).toBe(3);

    window.history.go(3);
    await vi.waitFor(() => {
      expect(browserHref()).toBe(c.href);
      expect(window.history.state).toEqual(nativeState);
    });
    const restored = createWorkbench({
      createRouter: makeRouter,
      workspaceId: "host-history-handoff",
      home: "/workspace",
      homeMode: "empty",
    });
    disposals.push(() => restored.dispose());
    restored.connectBrowser();
    const document = committed(await restored.start(browserHref()));
    expect(document.href).toBe(c.href);
    expect(restored.getActiveDocument()?.href).toBe(c.href);
    expect(restored.getDocuments()).toHaveLength(1);
    expect(nativeIndex()).toBe(nativeIndex(nativeState));
    expect(releases).toBe(3);
  });

  it("publishes the empty home after an ordinary close without history options", async () => {
    const { workbench, c, entryIndex } = await setup();
    expect(browserHref()).toBe(c.href);
    expect(
      await workbench.dispatch(
        Actions.group(workbench.getDocuments().map((document) => Actions.deleteTab(document.id))),
      ),
    ).toMatchObject({ status: "closed", cleanupErrors: [] });
    expect(workbench.getDocuments()).toHaveLength(0);
    expect(browserHref()).toBe("/workspace");
    expect(nativeIndex()).toBe(entryIndex + 2);
  });
});
