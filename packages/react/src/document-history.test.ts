import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import {
  createDocumentRuntime,
  type NativeNavigation,
  type NavigationApproval,
} from "./document-history";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(
  options: {
    begin?: (navigation: NativeNavigation) => NavigationApproval;
    loader?: (id: string) => unknown;
    staleReloadMode?: "blocking" | "background";
  } = {},
) {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/$id",
    loader: ({ params }) => options.loader?.(params.id),
  });
  const issues: unknown[] = [];
  const accepted: { href: string; navigation: NativeNavigation | undefined }[] = [];
  const runtime = createDocumentRuntime({
    href: "/a",
    createRouter: (history) =>
      createRouter({
        routeTree: root.addChildren([page]),
        history,
        isServer: false,
        defaultPendingMs: 10000,
        defaultPendingMinMs: 0,
        defaultStaleReloadMode: options.staleReloadMode ?? "background",
      }),
    isCurrent: () => true,
    beginNavigation: ({ navigation }) =>
      options.begin?.(navigation) ?? { decision: true, validate: () => true, finish: () => [] },
    onAccepted: (location, navigation) => accepted.push({ href: location.href, navigation }),
    onIssue: (error) => issues.push(error),
  });
  return { runtime, issues, accepted };
}

describe("one document runtime over the real native request boundary", () => {
  it.each(["factory", "client update"] as const)(
    "destroys its supplied history and preserves the original error when %s initialization fails",
    (stage) => {
      const failure = new Error(`${stage} failed`);
      let supplied: RouterHistory | undefined;
      try {
        let thrown: unknown;
        try {
          createDocumentRuntime({
            href: "/a",
            createRouter: (history) => {
              supplied = history;
              const router = createRouter({ routeTree: createRootRoute(), history });
              if (stage === "factory") throw failure;
              vi.spyOn(router, "update").mockImplementationOnce(() => {
                throw failure;
              });
              return router;
            },
            isCurrent: () => true,
            beginNavigation: () => ({ decision: true, validate: () => true, finish: () => [] }),
            onAccepted: () => {},
            onIssue: () => {},
          });
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBe(failure);
        expect(supplied?.signal?.aborted).toBe(true);
      } finally {
        supplied?.destroy();
      }
    },
  );

  it("rejects a Router using external history without disposing that external owner", () => {
    const external = createMemoryHistory({
      initialEntries: ["/external"],
      requireNavigationApproval: true,
    });
    const router = createRouter({ routeTree: createRootRoute(), history: external });
    let supplied: RouterHistory | undefined;
    try {
      expect(() =>
        createDocumentRuntime({
          href: "/a",
          createRouter: (history) => {
            supplied = history;
            return router;
          },
          isCurrent: () => true,
          beginNavigation: () => ({ decision: true, validate: () => true, finish: () => [] }),
          onAccepted: () => {},
          onIssue: () => {},
        }),
      ).toThrow("A document Router must use its supplied native history");
      expect(supplied?.signal?.aborted).toBe(true);
      expect(external.signal.aborted).toBe(false);
    } finally {
      supplied?.destroy();
      external.destroy();
    }
  });

  it("shares initialization and returns wrapped cleanup errors without also reporting them", async () => {
    let loads = 0;
    let finishes = 0;
    const cleanup = new Error("cleanup");
    const { runtime, issues, accepted } = fixture({
      loader: () => {
        loads++;
      },
      begin: () => ({
        decision: true,
        validate: () => true,
        finish: () => {
          finishes++;
          return [cleanup];
        },
      }),
    });
    const first = runtime.start();
    expect(runtime.start()).toBe(first);
    expect((await first).status).toBe("accepted");
    expect(loads).toBe(1);
    expect(runtime.acceptedLocation?.href).toBe("/a");
    expect(accepted[0]?.navigation).toBeUndefined();
    const result = await runtime.navigate({ to: "/$id", params: { id: "b" } });
    expect(result.status).toBe("accepted");
    expect(result.cleanupErrors).toEqual([cleanup]);
    expect(issues).toEqual([]);
    expect(finishes).toBe(1);
    expect(accepted.at(-1)?.navigation).toBe(result.navigation);
    runtime.dispose();
  });

  it("reports direct native cleanup once and aborts a superseded pending decision immediately", async () => {
    const waiting = deferred();
    const cleanup = new Error("direct cleanup");
    let finished = 0;
    const { runtime, issues } = fixture({
      begin: (navigation) => ({
        decision:
          navigation.nextLocation.href === "/waiting" ? waiting.promise.then(() => true) : true,
        validate: () => true,
        finish: () => {
          finished++;
          return [cleanup];
        },
      }),
    });
    await runtime.start();
    const old = runtime.router.navigate({ to: "/$id", params: { id: "waiting" } });
    const latest = await runtime.navigate({ to: "/$id", params: { id: "b" } });
    await old;
    expect(latest.status).toBe("accepted");
    expect(latest.cleanupErrors).toEqual([cleanup]);
    expect(issues).toEqual([cleanup]);
    expect(finished).toBe(2);
    waiting.resolve();
    runtime.dispose();
  });

  it("owns cleanup for a same-location reload that actually redirects", async () => {
    let redirecting = false;
    const cleanup = new Error("redirect cleanup");
    const { runtime, issues } = fixture({
      staleReloadMode: "blocking",
      loader: (id) => {
        if (redirecting && id === "a") throw redirect({ to: "/$id", params: { id: "b" } });
      },
      begin: () => ({ decision: true, validate: () => true, finish: () => [cleanup] }),
    });
    await runtime.start();
    redirecting = true;
    const result = await runtime.navigate({ to: "/$id", params: { id: "a" } });
    expect(result.status).toBe("accepted");
    expect(runtime.acceptedLocation?.href).toBe("/b");
    expect(result.cleanupErrors).toEqual([cleanup]);
    expect(issues).toEqual([]);
    runtime.dispose();
  });

  it("reports late background redirect cleanup once without mutating an already returned native result", async () => {
    let reloading = false;
    const ready = deferred();
    const cleanup = new Error("late redirect cleanup");
    const { runtime, issues } = fixture({
      loader: async (id) => {
        if (reloading && id === "a") {
          await ready.promise;
          throw redirect({ to: "/$id", params: { id: "b" } });
        }
      },
      begin: () => ({ decision: true, validate: () => true, finish: () => [cleanup] }),
    });
    await runtime.start();
    reloading = true;
    const result = await runtime.navigate({ to: "/$id", params: { id: "a" } });
    expect(result.status).toBe("accepted");
    expect(runtime.acceptedLocation?.href).toBe("/a");
    expect(result.cleanupErrors).toEqual([]);
    ready.resolve();
    await vi.waitFor(() => expect(runtime.acceptedLocation?.href).toBe("/b"));
    expect(result.status).toBe("accepted");
    expect(result.cleanupErrors).toEqual([]);
    expect(issues).toEqual([cleanup]);
    runtime.dispose();
  });

  it("marks actual history commitment before loading and holds protection until native acceptance", async () => {
    const slow = deferred();
    let committed = false;
    const loadingCommitStates: boolean[] = [];
    let finished = 0;
    const { runtime } = fixture({
      loader: (id) => {
        if (id === "slow") {
          loadingCommitStates.push(committed);
          return slow.promise;
        }
      },
      begin: () => ({
        decision: true,
        validate: () => true,
        committed: () => {
          committed = true;
        },
        finish: () => {
          finished++;
          return [];
        },
      }),
    });
    await runtime.start();
    const pending = runtime.navigate({ to: "/$id", params: { id: "slow" } });
    await vi.waitFor(() => expect(committed).toBe(true));
    await vi.waitFor(() => expect(loadingCommitStates).toEqual([true]));
    expect(finished).toBe(0);
    slow.resolve();
    expect((await pending).status).toBe("accepted");
    expect(finished).toBe(1);
    runtime.dispose();
  });

  it("restores a real entry's state and rejects replaced entry identity", async () => {
    const { runtime } = fixture();
    await runtime.start();
    await runtime.history.push("/b", { reading: "first" }).finished;
    const first = runtime.history.location;
    await runtime.history.push("/b", { reading: "second" }).finished;
    expect((await runtime.goToEntry(first.state["__TSR_key"]!))?.status).toBe("accepted");
    expect(runtime.history.location).toBe(first);
    expect(runtime.history.location.state).toMatchObject({ reading: "first" });
    await runtime.history.replace("/c").finished;
    expect(await runtime.goToEntry(first.state["__TSR_key"]!)).toBeUndefined();
    runtime.dispose();
  });

  it("separates caller notification failure from accepted navigation and destroys a pending load", async () => {
    const slow = deferred();
    const callback = new Error("caller notification");
    const { runtime, issues, accepted } = fixture({
      loader: (id) => (id === "slow" ? slow.promise : undefined),
    });
    await runtime.start();
    const result = await runtime.navigate({
      to: "/$id",
      params: { id: "b" },
      onNavigationResult: () => {
        throw callback;
      },
    });
    expect(result.status).toBe("accepted");
    expect(issues).toEqual([callback]);
    const pending = runtime.navigate({ to: "/$id", params: { id: "slow" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.dispose()).toEqual([]);
    expect((await pending).status).toBe("superseded");
    slow.resolve();
    expect(accepted.at(-1)?.href).toBe("/b");
  });
  it("collects public controller and cache cleanup failures while ending the native history once", async () => {
    const { runtime } = fixture();
    await runtime.start();
    const controller = runtime.router.state.matches[0]!.abortController;
    const abortError = new Error("match abort failed");
    const cacheError = new Error("cache cleanup failed");
    vi.spyOn(controller, "abort").mockImplementationOnce(() => {
      throw abortError;
    });
    vi.spyOn(runtime.router, "clearCache").mockImplementationOnce(() => {
      throw cacheError;
    });
    const historyDestroy = vi.spyOn(runtime.history, "destroy");
    const reentered: (readonly unknown[])[] = [];
    runtime.history.signal.addEventListener(
      "abort",
      () => {
        reentered.push(runtime.dispose());
      },
      { once: true },
    );
    expect(runtime.dispose()).toEqual([abortError, cacheError]);
    expect(controller.signal.aborted).toBe(true);
    expect(runtime.history.signal.aborted).toBe(true);
    expect(reentered).toEqual([[]]);
    expect(runtime.dispose()).toEqual([]);
    expect(historyDestroy).toHaveBeenCalledTimes(1);
  });
});
