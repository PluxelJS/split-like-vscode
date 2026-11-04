import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserHistoryCoordinator,
  type BrowserEntryReference,
  type BrowserVisitResult,
  type OutsideNavigation,
} from "./browser-history";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const ref = (entryKey: string): BrowserEntryReference => ({
  contentId: "document",
  lifetime: "lifetime",
  entryKey,
});
const href = () => window.location.pathname + window.location.search + window.location.hash;
const coordinators: BrowserHistoryCoordinator[] = [];
afterEach(() => {
  coordinators.splice(0).forEach((coordinator) => coordinator.dispose());
  vi.restoreAllMocks();
});

function fixture(
  options: {
    initial?: string;
    visit?: (
      href: string,
      reference: BrowserEntryReference | undefined,
      current: () => boolean,
    ) => Promise<BrowserVisitResult | undefined>;
    outside?: (href: string, context: OutsideNavigation) => Promise<boolean>;
  } = {},
) {
  window.history.replaceState({ __TSR_index: 0, host: "outside" }, "", "/outside");
  window.history.pushState({ __TSR_index: 1, host: "retained" }, "", options.initial ?? "/a");
  const issues: unknown[] = [];
  const visit = vi.fn<NonNullable<typeof options.visit>>(
    options.visit ??
      (async (targetHref, reference) => ({
        href: targetHref,
        reference: reference ?? ref(targetHref),
      })),
  );
  const outside = vi.fn<NonNullable<typeof options.outside>>(
    options.outside ?? (async () => false),
  );
  const coordinator = new BrowserHistoryCoordinator(
    window,
    "test",
    visit,
    (error) => {
      issues.push(error);
    },
    outside,
  );
  coordinators.push(coordinator);
  return { coordinator, visit, outside, issues };
}

describe("browser coordination uses real entries and explicit request ownership", () => {
  it("writes only after initial acceptance, preserves host state, and keeps same-URL distinct entries", async () => {
    const { coordinator, visit } = fixture();
    const initial = structuredClone(window.history.state);
    expect(window.history.state).toEqual(initial);
    const started = coordinator.start();
    expect(coordinator.start()).toBe(started);
    await started;
    expect(window.history.state.host).toBe("retained");
    expect(window.history.state["worksplit:test"].reference).toEqual(ref("/a"));
    const length = window.history.length;
    coordinator.publish("/a", ref("second-state"), false);
    expect(window.history.length).toBe(length + 1);
    window.history.back();
    await vi.waitFor(() => expect(visit).toHaveBeenCalledTimes(2));
    expect(visit.mock.calls.at(-1)?.[1]).toEqual(ref("/a"));
    await vi.waitFor(() =>
      expect(window.history.state["worksplit:test"].reference).toEqual(ref("/a")),
    );
  });

  it("restores a denied traversal before serializing a newer publish", async () => {
    const denied = deferred<BrowserVisitResult | undefined>();
    let calls = 0;
    const { coordinator, visit, issues } = fixture({
      visit: async (url, reference) =>
        ++calls === 2 ? denied.promise : { href: url, reference: reference ?? ref("a") },
    });
    await coordinator.start();
    coordinator.publish("/b", ref("b"), false);
    window.history.back();
    await vi.waitFor(() => expect(visit).toHaveBeenCalledTimes(2));
    expect(href()).toBe("/a");
    denied.resolve(undefined);
    await Promise.resolve();
    coordinator.publish("/c", ref("c"), false);
    await vi.waitFor(() => expect(href()).toBe("/c"));
    expect(window.history.state["worksplit:test"].index).toBe(2);
    expect(issues).toEqual([]);
    // Restoring the physical browser position did not overwrite A or B.
    window.history.back();
    await vi.waitFor(() => expect(href()).toBe("/b"));
  });

  it("lets a startup pop replace the initial pending load without settling or publishing the stale load", async () => {
    window.history.replaceState(
      { __TSR_index: 0, "worksplit:start": { scope: "restored", index: 0, reference: ref("b") } },
      "",
      "/b",
    );
    window.history.pushState(
      { __TSR_index: 1, "worksplit:start": { scope: "restored", index: 1, reference: ref("a") } },
      "",
      "/a",
    );
    const first = deferred<BrowserVisitResult | undefined>();
    const visits: string[] = [];
    const coordinator = new BrowserHistoryCoordinator(
      window,
      "start",
      async (url, reference) => {
        visits.push(url);
        return url === "/a" ? first.promise : { href: url, ...(reference ? { reference } : {}) };
      },
      (error) => {
        throw error;
      },
      async () => false,
    );
    coordinators.push(coordinator);
    const startup = coordinator.start();
    await vi.waitFor(() => expect(visits).toEqual(["/a"]));
    window.history.back();
    await expect(startup).resolves.toEqual({ href: "/b", reference: ref("b") });
    first.resolve({ href: "/obsolete", reference: ref("a") });
    await Promise.resolve();
    expect(href()).toBe("/b");
    expect(visits).toEqual(["/a", "/b"]);
  });

  it("cancels an outside decision when explicit work supersedes it and restores before publishing", async () => {
    const decision = deferred<boolean>();
    let context!: OutsideNavigation;
    const { coordinator, outside, issues } = fixture({
      outside: async (_href, request) => {
        context = request;
        return decision.promise;
      },
    });
    await coordinator.start();
    window.history.back();
    await vi.waitFor(() => expect(outside).toHaveBeenCalledTimes(1));
    expect(href()).toBe("/outside");
    expect(context.state).toEqual({ __TSR_index: 0, host: "outside" });
    coordinator.cancelPending();
    expect(context.signal.aborted).toBe(true);
    expect(context.current()).toBe(false);
    coordinator.publish("/new", ref("new"), false);
    await vi.waitFor(() => expect(href()).toBe("/new"));
    decision.resolve(true);
    await Promise.resolve();
    expect(href()).toBe("/new");
    expect(issues).toEqual([]);
  });

  it("hands off an approved outside traversal normally and releases the unique Window owner", async () => {
    const { coordinator, outside, issues } = fixture({ outside: async () => true });
    await coordinator.start();
    expect(
      () =>
        new BrowserHistoryCoordinator(
          window,
          "other",
          async () => undefined,
          () => {},
          async () => false,
        ),
    ).toThrow("already has");
    window.history.back();
    await vi.waitFor(() => expect(outside).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(href()).toBe("/outside"));
    await Promise.resolve();
    const replacement = new BrowserHistoryCoordinator(
      window,
      "other",
      async () => undefined,
      () => {},
      async () => false,
    );
    coordinators.push(replacement);
    coordinator.publish("/forbidden", ref("bad"), false);
    expect(href()).toBe("/outside");
    expect(issues).toEqual([]);
  });

  it.each(["other-workspace", "old-scope", "no-metadata"])(
    "treats %s metadata as outside without adopting the URL",
    async (kind) => {
      const { coordinator, visit, outside } = fixture();
      await coordinator.start();
      const state =
        kind === "other-workspace"
          ? { "worksplit:other": { scope: "x", index: 0 } }
          : kind === "old-scope"
            ? { "worksplit:test": { scope: "expired", index: 0 } }
            : {};
      window.history.replaceState({ __TSR_index: 1, ...state }, "", "/foreign");
      window.history.pushState({ __TSR_index: 2 }, "", "/temporary");
      window.history.back();
      await vi.waitFor(() => expect(outside).toHaveBeenCalledTimes(1));
      expect(visit).toHaveBeenCalledTimes(1);
    },
  );

  it("settles initialization on dispose and ignores a late successful loader", async () => {
    const pending = deferred<BrowserVisitResult | undefined>();
    const { coordinator } = fixture({ visit: async () => pending.promise });
    const startup = coordinator.start();
    await Promise.resolve();
    coordinator.dispose();
    await expect(startup).resolves.toBeUndefined();
    pending.resolve({ href: "/late", reference: ref("late") });
    await Promise.resolve();
    expect(href()).toBe("/a");
    expect(window.history.state["worksplit:test"]).toBeUndefined();
  });

  it("reports an unknown external position instead of guessing a restoration delta", async () => {
    window.history.replaceState({ host: "legacy" }, "", "/unindexed");
    window.history.pushState({ __TSR_index: 1 }, "", "/a");
    const issues: unknown[] = [];
    const coordinator = new BrowserHistoryCoordinator(
      window,
      "unindexed",
      async (url) => ({ href: url }),
      (error) => {
        issues.push(error);
      },
      async () => false,
    );
    coordinators.push(coordinator);
    await coordinator.start();
    const go = vi.spyOn(window.history, "go");
    window.history.back();
    await vi.waitFor(() => expect(issues).toHaveLength(1));
    expect(String(issues[0])).toContain("without a native history index");
    expect(go).not.toHaveBeenCalled();
    expect(href()).toBe("/unindexed");
    expect(window.history.state).toEqual({ host: "legacy" });
  });
});
