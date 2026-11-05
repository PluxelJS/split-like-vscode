import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocumentRecord } from "./content-record";
import { createWorkbench } from "./integration";
import { integrationState } from "./internal";
import type {
  BrowserHandoff,
  ContentController,
  LeaveRequest,
  WorkbenchInstance,
  WorkbenchSnapshot,
} from "./types";

const workbenches: WorkbenchInstance<ReturnType<typeof factory>>[] = [];
const deferredReleases: (() => void)[] = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  deferredReleases.push(() => resolve());
  return { promise, resolve };
}
function factory(history: RouterHistory, loader?: (id: string, signal: AbortSignal) => unknown) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/$id",
    loader: ({ params, abortController }) => loader?.(params.id, abortController.signal),
  });
  return createRouter({
    history,
    routeTree: root.addChildren([page]),
    defaultPendingMs: 10000,
    defaultPendingMinMs: 0,
  });
}
const href = () => window.location.pathname + window.location.search + window.location.hash;
function documentRecord(instance: object, id: string): DocumentRecord {
  const record = integrationState(instance).getRecord(id);
  if (record?.role !== "document") throw new Error("Missing actual document record");
  return record;
}
function fixture(
  options: {
    loader?: (id: string, signal: AbortSignal) => unknown;
    prepared?: boolean;
    snapshot?: WorkbenchSnapshot;
  } = {},
) {
  if (!options.prepared) {
    window.history.replaceState({ __TSR_index: 0, host: "outside" }, "", "/outside");
    window.history.pushState({ __TSR_index: 1, host: "workspace" }, "", "/a");
  }
  const issues: unknown[] = [];
  const handoffs: BrowserHandoff[] = [];
  const instance = createWorkbench({
    workspaceId: "browser-instance",
    createRouter: (history) => factory(history, options.loader),
    home: { mode: "empty", href: "/home" },
    captureSnapshotOnClose: true,
    initial: options.snapshot
      ? { snapshot: options.snapshot }
      : {
          layout: {
            global: { tabEnableFloat: false, tabEnablePopout: false },
            layout: { type: "row", children: [{ type: "tabset", id: "documents", children: [] }] },
          },
        },
    onIssue: (issue) => {
      issues.push(issue.error);
    },
  });
  workbenches.push(instance);
  return {
    instance,
    issues,
    handoffs,
    start: () =>
      instance.start({
        browser: {
          window,
          onOutsideNavigate: (handoff) => {
            handoffs.push(handoff);
          },
        },
      }),
  };
}
afterEach(async () => {
  deferredReleases.splice(0).forEach((release) => release());
  // eslint-disable-next-line no-await-in-loop -- Finish each owned session before tearing down the next.
  for (const instance of workbenches.splice(0)) await instance.dispose();
  vi.restoreAllMocks();
});

describe("Worksplit browser visits use live document entry identities", () => {
  it("rebinds the exact restored copy without adding tabs on repeated browser startup", async () => {
    let current = fixture();
    await current.start();
    await current.instance.open({ to: "/$id", params: { id: "b" } });
    const copy = await current.instance.duplicate(current.instance.getActiveDocument()!.id);
    expect(copy.status).toBe("applied");
    const activeId = current.instance.getActiveDocument()!.id;
    const ids = current.instance.getDocuments().map((document) => document.id);
    for (let reload = 0; reload < 2; reload++) {
      const oldReference = window.history.state["worksplit:browser-instance"].reference;
      const snapshot = current.instance.createSnapshot();
      // eslint-disable-next-line no-await-in-loop -- A reload terminates one session before restoring its snapshot.
      await current.instance.dispose();
      current = fixture({ prepared: true, snapshot });
      // eslint-disable-next-line no-await-in-loop -- Each new browser attachment owns the next native history reference.
      expect((await current.start()).status).toBe("applied");
      expect(current.instance.getDocuments().map((document) => document.id)).toEqual(ids);
      expect(current.instance.getActiveDocument()?.id).toBe(activeId);
      const record = documentRecord(current.instance, activeId);
      expect(record.runtime?.history.length).toBe(1);
      expect(window.history.state["worksplit:browser-instance"].reference).toEqual({
        contentId: activeId,
        lifetime: record.lifetime,
        entryKey: record.runtime!.history.location.state["__TSR_key"],
      });
      expect(record.lifetime).not.toBe(oldReference.lifetime);
      expect(current.issues).toEqual([]);
    }
  });

  it("does not rebind a restored reference whose browser href differs from the snapshot", async () => {
    const first = fixture();
    await first.start();
    const original = first.instance.getActiveDocument()!;
    const snapshot = first.instance.createSnapshot();
    await first.instance.dispose();
    window.history.replaceState(window.history.state, "", "/b");
    const second = fixture({ prepared: true, snapshot });
    expect((await second.start()).status).toBe("applied");
    expect(second.instance.getDocument(original.id)?.href).toBe("/a");
    expect(second.instance.getDocuments()).toHaveLength(2);
    expect(second.instance.getActiveDocument()?.href).toBe("/b");
    expect(second.instance.getActiveDocument()?.id).not.toBe(original.id);
    expect(second.issues).toEqual([]);
  });

  it("opens a new lifetime for a stale browser reference after restored startup has finished", async () => {
    const first = fixture();
    await first.start();
    const originalId = first.instance.getActiveDocument()!.id;
    await documentRecord(first.instance, originalId).runtime!.history.push("/a", {
      reading: "later entry",
    }).finished;
    await first.instance.duplicate(originalId);
    const snapshot = first.instance.createSnapshot();
    const ids = first.instance.getDocuments().map((document) => document.id);
    await first.instance.dispose();
    const second = fixture({ prepared: true, snapshot });
    await second.start();
    expect(second.instance.getDocuments()).toHaveLength(2);
    window.history.back();
    await vi.waitFor(() => expect(second.instance.getDocuments()).toHaveLength(3));
    expect(second.instance.getActiveDocument()?.href).toBe("/a");
    expect(ids).not.toContain(second.instance.getActiveDocument()?.id);
    expect(window.history.state["worksplit:browser-instance"].reference.contentId).toBe(
      second.instance.getActiveDocument()?.id,
    );
    expect(second.issues).toEqual([]);
  });

  it("does not create browser visits for an unchanged GO or boundary BACK/FORWARD", async () => {
    const { instance, start } = fixture();
    await start();
    const runtime = documentRecord(instance, instance.getActiveDocument()!.id).runtime!;
    const push = vi.spyOn(window.history, "pushState");
    await runtime.history.go(0).finished;
    await runtime.history.back().finished;
    await runtime.history.forward().finished;
    expect(push).not.toHaveBeenCalled();
    expect(href()).toBe("/a");
  });

  it("restores same-URL states and distinguishes native document BACK from browser BACK", async () => {
    const { instance, start, issues } = fixture();
    expect((await start()).status).toBe("applied");
    const record = documentRecord(instance, instance.getActiveDocument()!.id);
    const runtime = record.runtime!;
    await runtime.history.push("/b", { reading: "first" }).finished;
    const first = runtime.history.location;
    await runtime.history.push("/b", { reading: "second" }).finished;
    const second = runtime.history.location;
    expect(window.history.state["worksplit:browser-instance"].reference.entryKey).toBe(
      second.state["__TSR_key"],
    );
    const push = vi.spyOn(window.history, "pushState");
    window.history.back();
    await vi.waitFor(() => expect(runtime.history.location).toBe(first));
    expect(runtime.router.state.resolvedLocation?.state).toMatchObject({ reading: "first" });
    expect(push).not.toHaveBeenCalled();
    window.history.forward();
    await vi.waitFor(() => expect(runtime.history.location).toBe(second));
    await runtime.history.back().finished;
    expect(runtime.history.location).toBe(first);
    expect(push).toHaveBeenCalledTimes(1);
    window.history.back();
    await vi.waitFor(() => expect(runtime.history.location).toBe(second));
    expect(runtime.router.state.resolvedLocation?.state).toMatchObject({ reading: "second" });
    expect(issues).toEqual([]);
  });

  it("opens a fresh document for a replaced original entry and rebinds the visited browser entry", async () => {
    const { instance, start, issues } = fixture();
    await start();
    const original = documentRecord(instance, instance.getActiveDocument()!.id);
    const runtime = original.runtime!;
    await runtime.history.push("/b", { reading: "expired" }).finished;
    const removedKey = runtime.history.location.state["__TSR_key"]!;
    await runtime.history.push("/c").finished;
    await runtime.history.back().finished;
    await runtime.history.replace("/d").finished;
    expect(runtime.history.getEntry(removedKey)).toBeUndefined();
    window.history.go(-2);
    await vi.waitFor(() => expect(instance.getActiveDocument()?.href).toBe("/b"));
    const replacement = instance.getActiveDocument()!;
    expect(replacement.id).not.toBe(original.id);
    expect(original.href).toBe("/d");
    expect(runtime.history.location.href).toBe("/d");
    expect(instance.getDocuments()).toHaveLength(2);
    expect(window.history.state["worksplit:browser-instance"].reference.contentId).toBe(
      replacement.id,
    );
    expect(
      documentRecord(instance, replacement.id).runtime?.history.location.state,
    ).not.toHaveProperty("reading");
    expect(issues).toEqual([]);
  });

  it("cancels a waiting browser traversal before commit when a public open supersedes it", async () => {
    const { instance, start, issues } = fixture();
    await start();
    const record = documentRecord(instance, instance.getActiveDocument()!.id);
    await record.runtime!.history.push("/b").finished;
    await record.runtime!.history.push("/c").finished;
    const waiting = deferred();
    const requests: LeaveRequest[] = [];
    let paused = 0;
    const controller: ContentController = {
      leave: {
        getState: () => ({ hasUnsavedChanges: true, token: 1 }),
        decide: async (request) => {
          requests.push(request);
          paused++;
          request.defer(() => {
            paused--;
          });
          await waiting.promise;
          return { decision: "allow", token: 1 };
        },
      },
    };
    integrationState(instance).registerController(record.handle, { controller });
    window.history.back();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(paused).toBe(1);
    expect(record.runtime!.history.location.href).toBe("/c");
    const opened = await instance.open({ to: "/$id", params: { id: "new" } });
    expect(opened.status).toBe("applied");
    await vi.waitFor(() => expect(href()).toBe("/new"));
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(paused).toBe(0);
    expect(record.runtime!.history.location.href).toBe("/c");
    waiting.resolve();
    await Promise.resolve();
    expect(record.runtime!.history.location.href).toBe("/c");
    expect(instance.getActiveDocument()?.href).toBe("/new");
    expect(issues).toEqual([]);
  });

  it.each(["direct", "lazy-link"] as const)(
    "keeps an in-flight browser traversal independent of a %s background open",
    async (entrance) => {
      const { instance, start, issues } = fixture();
      await start();
      const record = documentRecord(instance, instance.getActiveDocument()!.id);
      await record.runtime!.history.push("/b").finished;
      await record.runtime!.history.push("/c").finished;
      const waiting = deferred();
      const requests: LeaveRequest[] = [];
      integrationState(instance).registerController(record.handle, {
        controller: {
          leave: {
            getState: () => ({ hasUnsavedChanges: true, token: 1 }),
            decide: async (request) => {
              requests.push(request);
              await waiting.promise;
              return { decision: "allow", token: 1 };
            },
          },
        },
      });
      window.history.back();
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      const navigation = { to: "/$id" as const, params: { id: "background" } };
      const opened = await (entrance === "direct"
        ? instance.open(navigation, { presentation: "background" })
        : instance.createLink(async () => navigation, { presentation: "background" }).open());
      expect(opened).toMatchObject({ status: "applied", value: { presentation: "background" } });
      expect(requests[0]!.signal.aborted).toBe(false);
      expect(record.runtime!.history.location.href).toBe("/c");
      waiting.resolve();
      await vi.waitFor(() => expect(instance.getActiveDocument()?.href).toBe("/b"));
      expect(href()).toBe("/b");
      expect(issues).toEqual([]);
    },
  );

  it.each([
    ["href", "https://example.test/external"],
    ["to", "https://example.test/external"],
    ["to", "//example.test/external"],
  ] as const)(
    "rejects external %s=%s before canceling a pending browser traversal",
    async (field, target) => {
      const { instance, start, issues } = fixture();
      await start();
      const record = documentRecord(instance, instance.getActiveDocument()!.id);
      await record.runtime!.history.push("/b").finished;
      await record.runtime!.history.push("/c").finished;
      const waiting = deferred();
      const requests: LeaveRequest[] = [];
      integrationState(instance).registerController(record.handle, {
        controller: {
          leave: {
            getState: () => ({ hasUnsavedChanges: true, token: 1 }),
            decide: async (request) => {
              requests.push(request);
              await waiting.promise;
              return { decision: "allow", token: 1 };
            },
          },
        },
      });
      window.history.back();
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      // JavaScript consumers can submit targets outside the registered route tree.
      const result = await instance.open({ [field]: target } as Parameters<
        typeof instance.open
      >[0]);
      expect(result.status).toBe("denied");
      expect(result).toMatchObject({ reason: "invalid-argument" });
      expect(requests[0]!.signal.aborted).toBe(false);
      waiting.resolve();
      await vi.waitFor(() => expect(instance.getActiveDocument()?.href).toBe("/b"));
      expect(href()).toBe("/b");
      expect(issues).toEqual([]);
    },
  );

  it("restores a denied browser visit without rewriting native entry state", async () => {
    const { instance, start, issues } = fixture();
    await start();
    const record = documentRecord(instance, instance.getActiveDocument()!.id);
    await record.runtime!.history.push("/b", { reading: "first" }).finished;
    await record.runtime!.history.push("/c", { reading: "current" }).finished;
    const accepted = record.runtime!.history.location;
    let asks = 0;
    integrationState(instance).registerController(record.handle, {
      controller: {
        leave: {
          getState: () => ({ hasUnsavedChanges: true, token: 1 }),
          decide: () => {
            asks++;
            return { decision: "deny" };
          },
        },
      },
    });
    window.history.back();
    await vi.waitFor(() => expect(asks).toBe(1));
    await vi.waitFor(() => expect(href()).toBe("/c"));
    expect(record.runtime!.history.location).toBe(accepted);
    expect(accepted.state).toMatchObject({ reading: "current" });
    expect(issues).toEqual([]);
  });

  it("replaces a pending startup target and destroys its stale native load", async () => {
    window.history.replaceState(
      { __TSR_index: 0, "worksplit:browser-instance": { scope: "restored", index: 0 } },
      "",
      "/b",
    );
    window.history.pushState(
      { __TSR_index: 1, "worksplit:browser-instance": { scope: "restored", index: 1 } },
      "",
      "/a",
    );
    const slow = deferred();
    let entered = false;
    let oldSignal: AbortSignal | undefined;
    const { instance, start, issues } = fixture({
      prepared: true,
      loader: (id, signal) => {
        if (id === "a") {
          entered = true;
          oldSignal = signal;
          return slow.promise;
        }
      },
    });
    const startup = start();
    await vi.waitFor(() => expect(entered).toBe(true));
    window.history.back();
    expect((await startup).status).toBe("applied");
    expect(instance.getActiveDocument()?.href).toBe("/b");
    expect(instance.getDocuments()).toHaveLength(1);
    expect(oldSignal?.aborted).toBe(true);
    slow.resolve();
    await Promise.resolve();
    expect(instance.getDocuments()).toHaveLength(1);
    expect(href()).toBe("/b");
    expect(issues).toEqual([]);
  });

  it("keeps background acceptance out of the browser until the document is activated", async () => {
    const { instance, start, issues } = fixture();
    await start();
    const opened = await instance.open(
      { to: "/$id", params: { id: "b" } },
      { presentation: "background" },
    );
    expect(opened.status).toBe("applied");
    if (opened.status !== "applied") throw new Error("Missing background document");
    const record = documentRecord(instance, opened.value.document.id);
    await record.runtime!.history.push("/c").finished;
    expect(href()).toBe("/a");
    expect(instance.getActiveDocument()?.href).toBe("/a");
    const push = vi.spyOn(window.history, "pushState");
    expect((await instance.activate(record.id)).status).toBe("applied");
    expect(href()).toBe("/c");
    expect(push).not.toHaveBeenCalled();
    expect(issues).toEqual([]);
  });

  it("uses normal approved handoff after synchronous termination and exposes its cleanup", async () => {
    const { instance, start, issues, handoffs } = fixture();
    await start();
    const record = documentRecord(instance, instance.getActiveDocument()!.id);
    let allow = false;
    let asks = 0;
    integrationState(instance).registerController(record.handle, {
      controller: {
        leave: {
          getState: () => ({ hasUnsavedChanges: true, token: 1 }),
          decide: () => {
            asks++;
            return allow ? { decision: "allow", token: 1 } : { decision: "deny" };
          },
        },
      },
    });
    window.history.back();
    await vi.waitFor(() => expect(asks).toBe(1));
    await vi.waitFor(() => expect(href()).toBe("/a"));
    expect(handoffs).toEqual([]);
    allow = true;
    window.history.back();
    await vi.waitFor(() => expect(handoffs).toHaveLength(1));
    const handoff = handoffs[0]!;
    expect(handoff.href).toBe("/outside");
    expect(handoff.state).toEqual({ __TSR_index: 0, host: "outside" });
    expect(handoff.snapshot?.version).toBe(2);
    expect((await handoff.cleanup).status).toBe("applied");
    expect(instance.getDocuments()).toHaveLength(0);
    expect((await instance.open({ to: "/$id", params: { id: "late" } })).status).toBe("denied");
    expect(issues).toEqual([]);
  });

  it("restores the accepted native index after a denied multi-entry outside traversal", async () => {
    const { instance, start, issues } = fixture();
    await start();
    await instance.open({ to: "/$id", params: { id: "b" } });
    await instance.open({ to: "/$id", params: { id: "c" } });
    const record = documentRecord(instance, instance.getDocuments()[0]!.id);
    let asks = 0;
    integrationState(instance).registerController(record.handle, {
      controller: {
        leave: {
          getState: () => ({ hasUnsavedChanges: true, token: 1 }),
          decide: () => {
            asks++;
            return { decision: "deny" };
          },
        },
      },
    });
    const index = window.history.state["__TSR_index"];
    window.history.go(-3);
    await vi.waitFor(() => expect(asks).toBe(1));
    await vi.waitFor(() => expect(href()).toBe("/c"));
    expect(window.history.state["__TSR_index"]).toBe(index);
    expect(instance.getDocuments()).toHaveLength(3);
    expect(issues).toEqual([]);
  });

  it("reports a failed outside decision and restores the accepted entry without terminating content", async () => {
    const { instance, start, issues, handoffs } = fixture();
    await start();
    const record = documentRecord(instance, instance.getActiveDocument()!.id);
    const failure = new Error("The save service is unavailable");
    integrationState(instance).registerController(record.handle, {
      controller: {
        leave: {
          getState: () => ({ hasUnsavedChanges: true, token: 1 }),
          decide: () => {
            throw failure;
          },
        },
      },
    });
    window.history.back();
    await vi.waitFor(() => expect(issues).toEqual([failure]));
    await vi.waitFor(() => expect(href()).toBe("/a"));
    expect(handoffs).toEqual([]);
    expect(instance.getDocuments()).toHaveLength(1);
  });

  it("aborts an outside leave batch when an owned traversal supersedes it", async () => {
    const { instance, start, issues, handoffs } = fixture();
    await start();
    const a = instance.getActiveDocument()!;
    await instance.open({ to: "/$id", params: { id: "b" } });
    const wait = deferred();
    const requests: LeaveRequest[] = [];
    let paused = 0;
    const controller: ContentController = {
      leave: {
        getState: () => ({ hasUnsavedChanges: true, token: 1 }),
        decide: async (request) => {
          requests.push(request);
          paused++;
          request.defer(() => {
            paused--;
          });
          await wait.promise;
          return { decision: "allow", token: 1 };
        },
      },
    };
    integrationState(instance).registerController(a.handle, { controller });
    window.history.go(-2);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    window.history.forward();
    await vi.waitFor(() => expect(instance.getActiveDocument()?.id).toBe(a.id));
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(paused).toBe(0);
    wait.resolve();
    await Promise.resolve();
    expect(instance.getDocuments()).toHaveLength(2);
    expect(handoffs).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("recreates a document lifetime after a host handoff and return to its old browser reference", async () => {
    const first = fixture();
    await first.start();
    const old = first.instance.getActiveDocument()!;
    let releases = 0;
    old.handle.runEffect(({ defer }) =>
      defer(() => {
        releases++;
      }),
    );
    window.history.back();
    await vi.waitFor(() => expect(first.handoffs).toHaveLength(1));
    await first.handoffs[0]!.cleanup;
    expect(releases).toBe(1);
    window.history.forward();
    await vi.waitFor(() => expect(href()).toBe("/a"));
    const second = fixture({ prepared: true });
    expect((await second.start()).status).toBe("applied");
    const reopened = second.instance.getActiveDocument()!;
    expect(reopened.id).not.toBe(old.id);
    expect(documentRecord(second.instance, reopened.id).runtime!.history.length).toBe(1);
    expect(second.instance.getDocuments()).toHaveLength(1);
    expect(window.history.state["worksplit:browser-instance"].reference.contentId).toBe(
      reopened.id,
    );
    expect(first.issues).toEqual([]);
    expect(second.issues).toEqual([]);
  });
});
