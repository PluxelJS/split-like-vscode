/** Same native-boundary regression for the workspace and an independent install.
 * Run: node --conditions=browser scripts/navigation-gate-regression.mjs <consumer-root>
 * Uses only public Router/history exports and public receipt extensions in the
 * distributed patch. Native background paths and real Provider mount/unmount
 * are both covered.
 */
/* eslint-disable no-await-in-loop -- Native history operations and shared Router/DOM fixtures must settle in sequence. */
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const consumerRoot = resolve(process.argv[2] ?? "packages/react");
const requireConsumer = createRequire(resolve(consumerRoot, "package.json"));
const requireRouter = createRequire(requireConsumer.resolve("@tanstack/react-router"));
const { JSDOM } = await import(pathToFileURL(requireConsumer.resolve("jsdom")));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.self = dom.window;
globalThis.scrollTo = () => {};
const commonjs = process.argv.includes("--cjs");
const baseline = process.argv.includes("--baseline");
const {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
} = commonjs
  ? requireConsumer("@tanstack/react-router")
  : await import(
      pathToFileURL(requireConsumer.resolve("@tanstack/react-router")).href.replace(
        "/dist/cjs/index.cjs",
        "/dist/esm/index.js",
      )
    );

function deferred() {
  let settle;
  const promise = new Promise((done) => {
    settle = done;
  });
  return { promise, resolve: settle };
}
async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Unsettled native operation: ${label}`)), 2500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function until(ready, label) {
  await within(
    (async () => {
      while (!ready()) await new Promise((done) => setTimeout(done, 0));
    })(),
    label,
  );
}
async function fixture({ entries = ["/a"], initialIndex, loader, subscribe = true } = {}) {
  const history = createMemoryHistory({
    initialEntries: entries,
    initialIndex,
    requireNavigationApproval: true,
  });
  if (!baseline)
    assert.equal(
      typeof history.completeNavigation,
      "function",
      "The installed history lacks the required receipt patch",
    );
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/$id",
    loader: loader ?? (() => undefined),
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history,
    isServer: false,
    defaultPendingMs: 10000,
    defaultPendingMinMs: 0,
    defaultStaleTime: 0,
  });
  await within(router.load(), "initial load");
  const stop = subscribe ? history.subscribe(router.load) : () => {};
  return {
    history,
    router,
    stop: () => {
      stop();
      history.destroy();
    },
  };
}
let passed = 0;
const writeLine = (value) => process.stdout.write(`${value}\n`);
async function check(name, run) {
  await run();
  passed++;
  writeLine(`PASS ${name}`);
}

if (baseline) {
  const history = createMemoryHistory({ initialEntries: ["/a", "/b"] });
  let checks = 0;
  history.block({
    blockerFn: () => {
      checks++;
      return true;
    },
  });
  history.back();
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(checks, 0);
  assert.equal(history.location.href, "/a");
  history.destroy();
  writeLine("REPRODUCED unpatched BACK bypasses memory blocker");

  const late = createMemoryHistory({ initialEntries: ["/a"] });
  const wait = deferred();
  late.block({
    blockerFn: ({ nextLocation }) => (nextLocation.href === "/slow" ? wait.promise : false),
  });
  late.push("/slow");
  late.push("/b");
  await until(() => late.location.href === "/b", "baseline T2 commit");
  wait.resolve(false);
  await until(() => late.location.href === "/slow", "baseline late T1 commit");
  assert.equal(late.length, 3);
  assert.equal(late.location.state["__TSR_index"], 1);
  late.destroy();
  writeLine("REPRODUCED unpatched old blocker commits late with stale index");

  const denied = await fixture();
  denied.history.block({ blockerFn: () => true });
  let settled = false;
  void denied.router.navigate({ to: "/b" }).then(() => {
    settled = true;
    return undefined;
  });
  await new Promise((done) => setTimeout(done, 30));
  assert.equal(settled, false);
  assert.equal(denied.history.location.href, "/a");
  denied.stop();
  writeLine("REPRODUCED unpatched native navigate remains unsettled after refusal");

  let reload = false;
  const redirected = await fixture({
    loader: ({ params }) => {
      if (reload && params.id === "a") throw redirect({ to: "/$id", params: { id: "b" } });
    },
  });
  checks = 0;
  redirected.history.block({
    blockerFn: () => {
      checks++;
      return true;
    },
  });
  reload = true;
  await within(redirected.router.invalidate(), "baseline reload");
  assert.equal(checks, 0);
  assert.equal(redirected.history.location.href, "/b");
  redirected.stop();
  writeLine("REPRODUCED unpatched reload redirect bypasses approval");
  dom.window.close();
  process.exit(0);
}

await check(
  "standalone memory history settles every committed request without a Router or observer acknowledgement",
  async () => {
    const history = createMemoryHistory({ initialEntries: ["/a"] });
    const observer = deferred();
    let notices = 0;
    let ended = 0;
    const receipts = [];
    history.subscribe(() => {
      notices++;
      return observer.promise;
    });
    for (let index = 0; index < 128; index++) {
      const receipt = history.replace(`/entry-${index}`, undefined, {
        onNavigationStart: (navigation) => {
          navigation.signal.addEventListener("abort", () => ended++, { once: true });
        },
      });
      receipts.push(receipt);
      assert.equal(await within(receipt.finished, "standalone history completion"), "accepted");
      assert.equal(await receipt.committed, true);
      assert.equal(receipt.signal.aborted, true);
      assert.equal(history.length, 1);
    }
    assert.equal(notices, receipts.length);
    assert.equal(ended, receipts.length);
    history.destroy();
    assert.ok(receipts.every((receipt) => receipt.result === "accepted"));
    observer.resolve();
  },
);

await check(
  "standalone reentrant history accepts both real writes and ends denied or destroyed attempts",
  async () => {
    const history = createMemoryHistory({ initialEntries: ["/a"] });
    let newer;
    history.subscribe(({ location }) => {
      if (location.href === "/b") newer = history.push("/c");
    });
    const first = history.push("/b");
    assert.equal(await within(first.finished, "standalone reentrant predecessor"), "accepted");
    assert.equal(await within(newer.finished, "standalone reentrant successor"), "accepted");
    assert.equal(history.location.href, "/c");
    assert.equal(history.location.state["__TSR_index"], 2);
    const stop = history.block({ blockerFn: () => true });
    assert.equal(await within(history.back().finished, "standalone refusal"), "denied");
    assert.equal(history.location.href, "/c");
    stop();
    const waiting = deferred();
    history.block({ blockerFn: () => waiting.promise });
    const pending = history.push("/pending");
    history.destroy();
    assert.equal(await within(pending.finished, "standalone destruction"), "superseded");
    assert.equal(await pending.committed, false);
    waiting.resolve(false);
  },
);

await check("destroy releases native registrations and does not retain late owners", async () => {
  const history = createMemoryHistory({ initialEntries: ["/a"] });
  // eslint-disable-next-line no-underscore-dangle -- This method is part of the exported native RouterHistory interface.
  const blockerCount = () => history._getBlockers().length;
  const before = history.block({ blockerFn: () => false });
  const subscribed = history.subscribe(() => {});
  history.signal.addEventListener("abort", () => {
    history.block({ blockerFn: () => false });
    history.subscribe(() => {});
  });
  history.destroy();
  history.destroy();
  assert.equal(blockerCount(), 0);
  assert.equal(history.subscribers.size, 0);
  const late = history.block({ blockerFn: () => false });
  const lateSubscription = history.subscribe(() => {});
  assert.equal(blockerCount(), 0);
  assert.equal(history.subscribers.size, 0);
  before();
  subscribed();
  late();
  lateSubscription();
  const navigation = history.push("/after-disposal");
  assert.equal(await within(navigation.finished, "late history request"), "superseded");
  assert.equal(await navigation.committed, false);
  assert.equal(history.location.href, "/a");
});

for (const subscribe of [true, false]) {
  await check(
    `Router claims completion before a slow accepted load (history subscription=${subscribe})`,
    async () => {
      const slow = deferred();
      const { history, router, stop } = await fixture({
        subscribe,
        loader: ({ params }) => (params.id === "slow" ? slow.promise : undefined),
      });
      let receipt;
      let completion = false;
      const pending = router.navigate({
        to: "/slow",
        onNavigationStart: (navigation) => {
          receipt = navigation;
          void navigation.finished.then(() => {
            completion = true;
            return undefined;
          });
        },
      });
      await until(
        () => receipt !== undefined && history.location.href === "/slow",
        "slow entry commit",
      );
      assert.equal(await receipt.committed, true);
      assert.equal(completion, false);
      assert.equal(receipt.signal.aborted, false);
      assert.equal(router.state.resolvedLocation.href, "/a");
      slow.resolve();
      await within(pending, "claimed Router acceptance");
      assert.equal(await receipt.finished, "accepted");
      assert.equal(router.state.resolvedLocation.href, "/slow");
      stop();
    },
  );
}

await check(
  "all five native history operations run blockers, retain entries/state on denial, and settle",
  async () => {
    const { history, router, stop } = await fixture({
      entries: ["/a", "/b", "/c"],
      initialIndex: 1,
    });
    const actions = [];
    let deny = false;
    history.block({
      blockerFn: ({ action, navigation }) => {
        assert.ok(navigation);
        actions.push(action);
        return deny;
      },
    });
    const operations = [
      () => history.push("/d", { value: 1 }),
      () => history.replace("/e", { value: 2 }),
      () => history.go(-1),
      () => history.back(),
      () => history.forward(),
    ];
    const locations = ["/d", "/e", "/b", "/a", "/b"];
    for (const [index, operation] of operations.entries()) {
      assert.equal(await within(operation().finished, "history operation"), "accepted");
      assert.equal(router.state.resolvedLocation.href, locations[index]);
    }
    assert.deepEqual(actions, ["PUSH", "REPLACE", "GO", "BACK", "FORWARD"]);
    let notices = 0;
    history.subscribe(() => {
      notices++;
    });
    deny = true;
    for (const operation of operations) {
      const previous = history.location;
      const length = history.length;
      const receipt = operation();
      assert.equal(await within(receipt.finished, "blocked history operation"), "denied");
      assert.equal(await receipt.committed, false);
      assert.equal(history.location, previous);
      assert.equal(history.length, length);
    }
    assert.equal(notices, 0);
    await within(router.navigate({ to: "/denied" }), "denied native navigate");
    assert.equal(history.location.href, "/b");
    stop();
  },
);

await check(
  "full-chain final review rejects stale approvals without successful notification",
  async () => {
    const { history, router, stop } = await fixture();
    let token = {};
    const approved = new WeakMap();
    const last = deferred();
    let lastStarted = false;
    history.block({
      blockerFn: ({ navigation }) => {
        approved.set(navigation, token);
        return false;
      },
      beforeCommit: ({ navigation }) => approved.get(navigation) === token,
    });
    history.block({
      blockerFn: () => {
        lastStarted = true;
        return last.promise;
      },
    });
    let notices = 0;
    history.subscribe(() => {
      notices++;
    });
    const pending = router.navigate({ to: "/b" });
    await until(() => lastStarted, "final blocker entered after approval");
    token = {};
    last.resolve(false);
    await within(pending, "final-check refusal");
    assert.equal(history.location.href, "/a");
    assert.equal(notices, 0);
    stop();
  },
);

await check(
  "T1 waiting in a later blocker cannot commit after T2; native T1 settles even before that blocker",
  async () => {
    const { history, router, stop } = await fixture();
    const wait = deferred();
    const requests = [];
    history.block({
      blockerFn: ({ navigation }) => {
        requests.push(navigation);
        return false;
      },
    });
    history.block({
      blockerFn: ({ nextLocation }) => (nextLocation.href === "/slow" ? wait.promise : false),
    });
    const first = router.navigate({ to: "/slow" });
    await until(() => requests.length === 1, "T1 start");
    await within(router.navigate({ to: "/b" }), "T2 acceptance");
    await within(first, "T1 native supersession before blocker completion");
    assert.equal(await requests[0].finished, "superseded");
    wait.resolve(false);
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(history.location.href, "/b");
    assert.equal(history.location.state["__TSR_index"], 1);
    assert.equal(history.length, 2);
    stop();
  },
);

await check(
  "a GO captures its real target; a subsequent replace invalidates the waiting traversal",
  async () => {
    const { history, router, stop } = await fixture({ entries: ["/a", "/b", "/c"] });
    const later = deferred();
    let entered = false;
    history.block({
      blockerFn: ({ action }) => {
        if (action === "GO") {
          entered = true;
          return later.promise;
        }
        return false;
      },
    });
    const old = history.go(-2);
    await until(() => entered, "GO blocker");
    await within(router.navigate({ to: "/replacement", replace: true }), "replace while GO waits");
    assert.equal(await within(old.finished, "superseded GO"), "superseded");
    later.resolve(false);
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(history.location.href, "/replacement");
    assert.equal(history.location.state["__TSR_index"], 2);
    stop();
  },
);

await check(
  "same href entries have distinct identity/state, replace invalidates entry, branch truncation is real",
  async () => {
    const { history, stop } = await fixture();
    await within(history.push("/b", { parent: "first" }).finished, "same href 1");
    const first = history.location;
    await within(history.push("/b", { parent: "second" }).finished, "same href 2");
    const second = history.location;
    assert.notEqual(first.state["__TSR_key"], second.state["__TSR_key"]);
    await within(history.back().finished, "back to first identity");
    assert.equal(history.location, first);
    assert.equal(history.location.state.parent, "first");
    await within(history.replace("/c").finished, "replace identity");
    assert.equal(history.getEntry(first.state["__TSR_key"]), undefined);
    await within(history.push("/d").finished, "truncate identity");
    assert.equal(history.getEntry(second.state["__TSR_key"]), undefined);
    assert.equal(history.location.state["__TSR_index"], 2);
    stop();
  },
);

await check(
  "synchronous subscriber reentry cannot overwrite a newer location or strand either native receipt",
  async () => {
    const { history, stop } = await fixture();
    let newer;
    history.subscribe(({ location }) => {
      if (location.href === "/b") newer = history.push("/c");
    });
    const first = history.push("/b");
    await within(first.finished, "reentered predecessor");
    await within(newer.finished, "reentered successor");
    assert.equal(history.location.href, "/c");
    assert.equal(history.location.state["__TSR_index"], 2);
    stop();
  },
);

await check(
  "a rejected T2 releases only its own pause while committed T1 is still loading; onResolved precedes release",
  async () => {
    const slow = deferred();
    const { history, router, stop } = await fixture({
      loader: ({ params }) => (params.id === "slow" ? slow.promise : undefined),
    });
    let pauses = 0;
    const from = [];
    history.block({
      blockerFn: ({ navigation }) => {
        pauses++;
        from.push(router.state.resolvedLocation.href);
        void navigation.finished.then(() => {
          pauses--;
          return undefined;
        });
        return false;
      },
    });
    history.block({ blockerFn: ({ nextLocation }) => nextLocation.href === "/b" });
    let protectedAtAccept = false;
    router.subscribe("onResolved", () => {
      if (router.state.resolvedLocation.href === "/slow") protectedAtAccept = pauses === 1;
    });
    const first = router.navigate({ to: "/slow" });
    await until(() => history.location.href === "/slow", "T1 history commit");
    await within(router.navigate({ to: "/b" }), "T2 denial while T1 loads");
    assert.equal(pauses, 1);
    assert.deepEqual(from, ["/a", "/a"]);
    slow.resolve(undefined);
    await within(first, "T1 acceptance");
    assert.equal(protectedAtAccept, true);
    assert.equal(pauses, 0);
    stop();
  },
);

await check(
  "actual multi-hop redirect inherits its approved transition and releases once after final native acceptance",
  async () => {
    const { history, router, stop } = await fixture({
      loader: ({ params }) => {
        if (params.id === "alias") throw redirect({ to: "/$id", params: { id: "alias2" } });
        if (params.id === "alias2") throw redirect({ to: "/$id", params: { id: "b" } });
      },
    });
    let asks = 0;
    let pauses = 0;
    history.block({
      blockerFn: ({ navigation }) => {
        asks++;
        pauses++;
        void navigation.finished.then(() => {
          pauses--;
          return undefined;
        });
        return false;
      },
    });
    await within(router.navigate({ to: "/alias" }), "approved redirect chain");
    assert.equal(history.location.href, "/b");
    assert.equal(router.state.resolvedLocation.href, "/b");
    assert.equal(asks, 1);
    assert.equal(pauses, 0);
    stop();
  },
);

await check(
  "an unapproved reload cannot borrow a previous committed-but-loading navigation approval",
  async () => {
    const slow = deferred();
    let reload = false;
    const { history, router, stop } = await fixture({
      loader: ({ params }) => {
        if (params.id !== "slow") return;
        if (reload) throw redirect({ to: "/$id", params: { id: "b" } });
        return slow.promise;
      },
    });
    let asks = 0;
    history.block({
      blockerFn: ({ nextLocation }) => {
        asks++;
        return nextLocation.href === "/b";
      },
    });
    const first = router.navigate({ to: "/slow" });
    await until(() => history.location.href === "/slow", "approved pending T1");
    reload = true;
    await within(router.invalidate(), "unapproved reload redirect");
    await within(first, "old navigation retired by reload");
    assert.equal(asks, 2);
    assert.equal(history.location.href, "/slow");
    assert.equal(router.state.resolvedLocation.href, "/a");
    slow.resolve();
    stop();
  },
);

await check(
  "loader errors are accepted error pages and release the approved navigation",
  async () => {
    const { history, router, stop } = await fixture({
      loader: ({ params }) => {
        if (params.id === "error") throw new Error("expected route error");
      },
    });
    let request;
    history.block({
      blockerFn: ({ navigation }) => {
        request = navigation;
        return false;
      },
    });
    await within(router.navigate({ to: "/error" }), "accepted error page");
    assert.equal(await request.finished, "accepted");
    assert.equal(router.state.resolvedLocation.href, "/error");
    assert.equal(router.state.matches.at(-1).status, "error");
    stop();
  },
);

await check("destroy settles a native request that never entered Router pending", async () => {
  const { history, router, stop } = await fixture();
  const wait = deferred();
  let request;
  history.block({
    blockerFn: ({ navigation }) => {
      request = navigation;
      return wait.promise;
    },
  });
  const pending = router.navigate({ to: "/b" });
  await until(() => request, "uncommitted request");
  history.destroy();
  await within(pending, "destroyed native navigate");
  assert.equal(await request.finished, "superseded");
  wait.resolve(false);
  assert.equal(history.location.href, "/a");
  stop();
});

await check(
  "destroy retires an already committed slow native load and prevents later publication",
  async () => {
    const slow = deferred();
    const { history, router, stop } = await fixture({
      subscribe: false,
      loader: ({ params }) => (params.id === "slow" ? slow.promise : undefined),
    });
    const pending = router.navigate({ to: "/slow" });
    await until(() => router.state.location.href === "/slow", "committed slow load");
    history.destroy();
    await within(pending, "destroyed committed native navigate");
    slow.resolve();
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(router.state.resolvedLocation.href, "/a");
    stop();
  },
);

for (const reload of ["same-location navigate", "invalidate", "load", "error retry"]) {
  await check(
    `${reload}: an unapproved redirect cannot bypass the blocker and the native call settles`,
    async () => {
      let mode = reload === "error retry" ? "error" : "initial";
      const { history, router, stop } = await fixture({
        loader: ({ params }) => {
          if (params.id !== "a") return;
          if (mode === "error") throw new Error("retryable loader");
          if (mode === "redirect") throw redirect({ to: "/$id", params: { id: "b" } });
        },
      });
      let asks = 0;
      history.block({
        blockerFn: () => {
          asks++;
          return true;
        },
      });
      mode = "redirect";
      const operation =
        reload === "same-location navigate"
          ? router.navigate({ to: "/a" })
          : reload === "load"
            ? router.load()
            : router.invalidate();
      await within(operation, reload);
      assert.equal(asks, 1);
      assert.equal(history.location.href, "/a");
      assert.equal(router.state.resolvedLocation.href, "/a");
      assert.equal(router.state.status, "idle");
      stop();
    },
  );
}

await check(
  "a normal reload of the pending entry keeps the original editor paused until actual acceptance",
  async () => {
    const slow = deferred();
    const { history, router, stop } = await fixture({
      loader: ({ params }) => (params.id === "slow" ? slow.promise : undefined),
    });
    let pauses = 0;
    let asks = 0;
    history.block({
      blockerFn: ({ navigation }) => {
        asks++;
        pauses++;
        void navigation.finished.then(() => {
          pauses--;
          return undefined;
        });
        return false;
      },
    });
    const first = router.navigate({ to: "/slow" });
    await until(() => router.state.location.href === "/slow", "initial load of approved entry");
    const reload = router.load();
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(pauses, 1);
    assert.equal(router.state.resolvedLocation.href, "/a");
    slow.resolve();
    await within(reload, "reload accepts original approved entry");
    await within(first, "original approval settled by reload acceptance");
    assert.equal(router.state.resolvedLocation.href, "/slow");
    assert.equal(pauses, 0);
    assert.equal(asks, 1);
    stop();
  },
);

await check(
  "cancellation callback reentry keeps the latest request owned and settles every superseded native caller",
  async () => {
    const { history, router, stop } = await fixture();
    const never = deferred();
    let firstReceipt;
    let nested;
    history.block({
      blockerFn: ({ navigation, nextLocation }) => {
        if (nextLocation.href === "/first") {
          firstReceipt = navigation;
          navigation.signal.addEventListener(
            "abort",
            () => {
              nested = router.navigate({ to: "/nested" });
            },
            { once: true },
          );
          return never.promise;
        }
        return nextLocation.href === "/nested" ? never.promise : false;
      },
    });
    const first = router.navigate({ to: "/first" });
    await until(() => firstReceipt, "first blocked request");
    const replaced = router.navigate({ to: "/replaced" });
    await within(first, "first cancellation");
    await within(replaced, "outer caller superseded by its cancellation callback");
    assert.ok(nested);
    await within(router.navigate({ to: "/last" }), "final caller");
    await within(nested, "nested caller superseded without waiting its blocker");
    assert.equal(history.location.href, "/last");
    never.resolve(false);
    stop();
  },
);

for (const event of ["onBeforeNavigate", "onBeforeLoad", "onLoad", "onResolved"]) {
  await check(
    `throwing ${event} observer is reported by native emit without stranding acceptance`,
    async () => {
      const { history, router, stop } = await fixture();
      const failure = new Error(`expected ${event} failure`);
      let request;
      history.block({
        blockerFn: ({ navigation }) => {
          request = navigation;
          return false;
        },
      });
      router.subscribe(event, () => {
        throw failure;
      });
      const reports = [];
      /* eslint-disable no-console -- Capture and restore the upstream emit error sink to verify observer failures are reported. */
      const original = console.error;
      console.error = (error) => reports.push(error);
      try {
        await within(router.navigate({ to: "/b" }), `observer ${event}`);
      } finally {
        console.error = original;
      }
      /* eslint-enable no-console */
      assert.equal(await request.finished, "accepted");
      assert.deepEqual(reports, [failure]);
      stop();
    },
  );
}

for (const event of ["onBeforeNavigate", "onLoad"]) {
  await check(`synchronous destroy from ${event} prevents later native publication`, async () => {
    const { history, router, stop } = await fixture();
    let resolved = 0;
    router.subscribe("onResolved", () => {
      resolved++;
    });
    router.subscribe(event, () => history.destroy());
    await within(router.navigate({ to: "/b" }), `destroy in ${event}`);
    assert.equal(resolved, 0);
    assert.equal(router.state.resolvedLocation.href, "/a");
    stop();
  });
}

await check(
  "history observer failure settles the associated native caller and exposes the exact error",
  async () => {
    const { history, router, stop } = await fixture();
    const failure = new Error("history observer");
    let request;
    history.block({
      blockerFn: ({ navigation }) => {
        request = navigation;
        return false;
      },
    });
    history.subscribe(() => {
      throw failure;
    });
    await assert.rejects(
      within(router.navigate({ to: "/b" }), "history observer failure"),
      failure,
    );
    assert.equal(await request.finished, "failed");
    assert.equal(request.error, failure);
    stop();
  },
);

await check(
  "destroy terminates a reload with no history request and prevents its late publication",
  async () => {
    const slow = deferred();
    let reloading = false;
    const { history, router, stop } = await fixture({
      loader: () => (reloading ? slow.promise : undefined),
    });
    reloading = true;
    const pending = router.invalidate();
    await new Promise((done) => setTimeout(done, 0));
    history.destroy();
    await within(pending, "destroyed reload");
    slow.resolve();
    stop();
  },
);

await check(
  "an observer-only history subscription does not suppress the background Router load",
  async () => {
    const { history, router, stop } = await fixture({ subscribe: false });
    let notifications = 0;
    history.subscribe(() => {
      notifications++;
    });
    await within(router.navigate({ to: "/b" }), "observer-only background");
    assert.equal(router.state.resolvedLocation.href, "/b");
    assert.equal(notifications, 1);
    stop();
  },
);

for (const owner of [false, true]) {
  await check(
    `real RouterProvider mount/unmount restores background settlement (lifetime subscriber=${owner})`,
    async () => {
      const React = requireConsumer("react");
      const { createRoot } = requireConsumer("react-dom/client");
      const { history, router, stop } = await fixture({ subscribe: owner });
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      await React.act(async () => {
        root.render(
          React.createElement(
            React.StrictMode,
            null,
            React.createElement(RouterProvider, { router }),
          ),
        );
      });
      await React.act(async () => {
        root.unmount();
      });
      assert.equal(history.subscribers.has(router.load), owner);
      let loads = 0;
      router.subscribe("onBeforeNavigate", () => {
        loads++;
      });
      await within(router.navigate({ to: "/b" }), "background after Provider unmount");
      assert.equal(router.state.resolvedLocation.href, "/b");
      assert.equal(loads, 1);
      container.remove();
      stop();
    },
  );
}

await check(
  "background Router without RouterProvider or a history subscriber settles accepted, denied and redirect calls",
  async () => {
    const { history, router, stop } = await fixture({
      subscribe: false,
      loader: ({ params }) => {
        if (params.id === "alias") throw redirect({ to: "/$id", params: { id: "b" } });
      },
    });
    let deny = true;
    history.block({ blockerFn: () => deny });
    await within(router.navigate({ to: "/b" }), "background denied");
    assert.equal(router.state.resolvedLocation.href, "/a");
    deny = false;
    await within(router.navigate({ to: "/alias" }), "background redirect");
    assert.equal(router.state.resolvedLocation.href, "/b");
    stop();
  },
);

await check(
  "per-invocation native result callback identifies accepted, denied, superseded and same-location reload redirect outcomes exactly once",
  async () => {
    const wait = deferred();
    let reloadRedirect = false;
    const { history, router, stop } = await fixture({
      loader: ({ params }) => {
        if (reloadRedirect && params.id === "b")
          throw redirect({ to: "/$id", params: { id: "denied" } });
      },
    });
    history.block({
      blockerFn: ({ nextLocation }) =>
        nextLocation.href === "/slow" ? wait.promise : nextLocation.href === "/denied",
    });
    const results = { first: [], denied: [], accepted: [], reload: [] };
    const first = router.navigate({
      to: "/slow",
      onNavigationResult: (r) => results.first.push(r.status),
    });
    await within(
      router.navigate({ to: "/denied", onNavigationResult: (r) => results.denied.push(r.status) }),
      "callback denied",
    );
    await within(first, "callback superseded");
    await within(
      router.navigate({ to: "/b", onNavigationResult: (r) => results.accepted.push(r.status) }),
      "callback accepted",
    );
    reloadRedirect = true;
    await within(
      router.navigate({ to: "/b", onNavigationResult: (r) => results.reload.push(r.status) }),
      "callback reload redirect",
    );
    assert.deepEqual(results, {
      first: ["superseded"],
      denied: ["denied"],
      accepted: ["accepted"],
      reload: ["denied"],
    });
    wait.resolve(false);
    stop();
  },
);

await check(
  "a result callback throw is reported once after acceptance without changing the receipt",
  async () => {
    const { history, router, stop } = await fixture();
    const failure = new Error("caller result callback");
    let calls = 0;
    let request;
    history.block({
      blockerFn: ({ navigation }) => {
        request = navigation;
        return false;
      },
    });
    await assert.rejects(
      within(
        router.navigate({
          to: "/b",
          onNavigationResult: () => {
            calls++;
            throw failure;
          },
        }),
        "throwing callback",
      ),
      failure,
    );
    assert.equal(calls, 1);
    assert.equal(await request.finished, "accepted");
    assert.equal(router.state.resolvedLocation.href, "/b");
    stop();
  },
);

for (const mode of ["navigate", "destroy"]) {
  await check(
    `synchronous ${mode} from the final beforeCommit cannot publish the old request`,
    async () => {
      const { history, router, stop } = await fixture();
      let newer;
      const notices = [];
      history.subscribe(({ location }) => notices.push(location.href));
      history.block({
        blockerFn: () => false,
        beforeCommit: ({ nextLocation }) => {
          if (nextLocation.href === "/first") {
            if (mode === "destroy") history.destroy();
            else newer = router.navigate({ to: "/newer" });
          }
          return true;
        },
      });
      await within(router.navigate({ to: "/first" }), "reentrant final review");
      if (newer) await within(newer, "newer final review request");
      assert.equal(notices.includes("/first"), false);
      assert.equal(history.location.href, mode === "destroy" ? "/a" : "/newer");
      stop();
    },
  );
}

await check(
  "native transaction lifetime listeners remain bounded across repeated navigation",
  async () => {
    const { history, router, stop } = await fixture();
    for (let index = 0; index < 24; index++) {
      await within(router.navigate({ to: `/page${index}` }), "repeated native navigation");
      assert.equal(getEventListeners(history.signal, "abort").length, 1);
    }
    stop();
    assert.equal(getEventListeners(history.signal, "abort").length, 0);
  },
);

await check(
  "destroy terminates an initial native load before any history request exists",
  async () => {
    const slow = deferred();
    const history = createMemoryHistory({
      initialEntries: ["/a"],
      requireNavigationApproval: true,
    });
    const root = createRootRoute();
    const page = createRoute({
      getParentRoute: () => root,
      path: "/a",
      loader: () => slow.promise,
    });
    const router = createRouter({
      routeTree: root.addChildren([page]),
      history,
      isServer: false,
      defaultPendingMs: 10000,
    });
    const pending = router.load();
    await new Promise((done) => setTimeout(done, 0));
    history.destroy();
    await within(pending, "destroyed initial load");
    slow.resolve();
  },
);

await check(
  "a native parse failure before load transaction creation settles a background navigation and its callback",
  async () => {
    const { history, router, stop } = await fixture({ subscribe: false });
    const failure = new Error("parse search failure");
    const original = router.options.parseSearch;
    let fail = false;
    router.update({
      parseSearch: (search) => {
        if (fail) throw failure;
        return original(search);
      },
    });
    let receipt;
    history.block({
      blockerFn: ({ navigation }) => {
        receipt = navigation;
        fail = true;
        return false;
      },
    });
    const results = [];
    await assert.rejects(
      within(
        router.navigate({ to: "/b", onNavigationResult: (result) => results.push(result.status) }),
        "native parse failure",
      ),
      failure,
    );
    assert.equal(await receipt.finished, "failed");
    assert.deepEqual(results, ["failed"]);
    stop();
  },
);

await check(
  "same-location hop inside an actual approved redirect chain retains its approval",
  async () => {
    let visited = 0;
    const { history, router, stop } = await fixture({
      loader: ({ params }) => {
        if (params.id === "alias") {
          visited++;
          throw redirect({ to: "/$id", params: { id: visited === 1 ? "alias" : "b" } });
        }
      },
    });
    let asks = 0;
    history.block({
      blockerFn: () => {
        asks++;
        return false;
      },
    });
    const outcomes = [];
    await within(
      router.navigate({ to: "/alias", onNavigationResult: (r) => outcomes.push(r.status) }),
      "same-location redirect hop",
    );
    assert.equal(asks, 1);
    assert.equal(history.location.href, "/b");
    assert.deepEqual(outcomes, ["accepted"]);
    stop();
  },
);

await check(
  "onNavigationStart claims the exact request before blockers and also follows same-location reload redirect",
  async () => {
    let reloading = false;
    const { history, router, stop } = await fixture({
      loader: ({ params }) => {
        if (reloading && params.id === "a") throw redirect({ to: "/$id", params: { id: "b" } });
      },
    });
    const claimed = new WeakSet();
    let starts = 0;
    history.block({
      blockerFn: ({ navigation }) => {
        assert.ok(claimed.has(navigation));
        return false;
      },
    });
    reloading = true;
    await within(
      router.navigate({
        to: "/a",
        onNavigationStart: (navigation) => {
          starts++;
          claimed.add(navigation);
        },
      }),
      "reload claim",
    );
    assert.equal(starts, 1);
    assert.equal(router.state.resolvedLocation.href, "/b");
    stop();
  },
);

await check(
  "onNavigationStart synchronous reentry and throw settle every native request without history rollback",
  async () => {
    const { history, router, stop } = await fixture();
    let newer;
    const outcomes = [];
    await within(
      router.navigate({
        to: "/old",
        onNavigationStart: () => {
          newer = router.navigate({ to: "/new" });
        },
        onNavigationResult: (r) => outcomes.push(r.status),
      }),
      "start callback reentry",
    );
    await within(newer, "start callback successor");
    assert.deepEqual(outcomes, ["superseded"]);
    assert.equal(history.location.href, "/new");
    const failure = new Error("start observer");
    const failed = [];
    await assert.rejects(
      within(
        router.navigate({
          to: "/bad",
          onNavigationStart: () => {
            throw failure;
          },
          onNavigationResult: (r) => failed.push(r.status),
        }),
        "start callback throw",
      ),
      failure,
    );
    assert.deepEqual(failed, ["failed"]);
    assert.equal(history.location.href, "/new");
    stop();
  },
);

await check(
  "initial load and successful same-location reload report accepted exactly once",
  async () => {
    const history = createMemoryHistory({
      initialEntries: ["/a"],
      requireNavigationApproval: true,
    });
    const root = createRootRoute();
    const page = createRoute({ getParentRoute: () => root, path: "/$id" });
    const router = createRouter({ routeTree: root.addChildren([page]), history, isServer: false });
    const results = [];
    await within(
      router.load({ onNavigationResult: (result) => results.push(result.status) }),
      "initial accepted load",
    );
    assert.deepEqual(results, ["accepted"]);
    await within(
      router.navigate({ to: "/a", onNavigationResult: (result) => results.push(result.status) }),
      "accepted same-location reload",
    );
    assert.deepEqual(results, ["accepted", "accepted"]);
    assert.equal(router.state.resolvedLocation.href, "/a");
    history.destroy();
  },
);

writeLine(
  JSON.stringify({
    passed,
    reactRouter: requireConsumer("@tanstack/react-router/package.json").version,
    routerCore: requireRouter("@tanstack/router-core/package.json").version,
    history: requireRouter("@tanstack/history/package.json").version,
    routerProviderMountUnmountCovered: true,
    format: commonjs ? "commonjs" : "esm",
  }),
);
dom.window.close();
