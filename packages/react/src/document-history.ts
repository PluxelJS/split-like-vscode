import {
  createMemoryHistory,
  type AnyRouter,
  type NavigateOptions,
  type ParsedLocation,
  type RouterHistory,
} from "@tanstack/react-router";

type DocumentHistory = ReturnType<typeof createMemoryHistory>;
export type NativeNavigation = ReturnType<DocumentHistory["push"]>;
type LoadOptions = NonNullable<Parameters<AnyRouter["load"]>[0]>;
export type NativeNavigationOutcome = Parameters<NonNullable<LoadOptions["onNavigationResult"]>>[0];

/** Created synchronously so cancellation can release a still-waiting decision. */
export interface NavigationApproval {
  readonly decision: boolean | Promise<boolean>;
  validate(): boolean;
  /** Native history wrote the request; owner unmount cannot end its protection. */
  committed?(): void;
  finish(): readonly unknown[];
}

export interface DocumentNavigationResult extends NativeNavigationOutcome {
  readonly cleanupErrors: readonly unknown[];
}

export interface DocumentRuntimeOptions<TRouter extends AnyRouter> {
  readonly href: string;
  createRouter(history: RouterHistory): TRouter;
  isCurrent(): boolean;
  beginNavigation(request: {
    readonly navigation: NativeNavigation;
    readonly from: ParsedLocation;
    readonly to: ParsedLocation;
  }): NavigationApproval;
  onAccepted(location: ParsedLocation, navigation: NativeNavigation | undefined): void;
  onIssue(error: unknown): void;
}

/** Owned by one document's ContentRecord; it does not own a content registry. */
export interface DocumentRuntime<TRouter extends AnyRouter> {
  readonly history: DocumentHistory;
  readonly router: TRouter;
  readonly acceptedLocation: ParsedLocation | undefined;
  start(): Promise<DocumentNavigationResult>;
  navigate<const TFrom extends string = string, const TTo extends string | undefined = ".">(
    navigation: NavigateOptions<TRouter, TFrom, TTo>,
  ): Promise<DocumentNavigationResult>;
  /** Missing means the original entry was replaced/truncated, not a URL match. */
  goToEntry(
    key: string,
    options?: Pick<LoadOptions, "onNavigationStart">,
  ): Promise<DocumentNavigationResult | undefined>;
  dispose(): readonly unknown[];
}

interface OperationOwner {
  readonly cleanupErrors: unknown[];
  finished: boolean;
}

interface DecisionRecord {
  readonly approval: NavigationApproval;
  readonly owner: OperationOwner | undefined;
  ended: boolean;
}

export function createDocumentRuntime<TRouter extends AnyRouter>(
  options: DocumentRuntimeOptions<TRouter>,
): DocumentRuntime<TRouter> {
  const history = createMemoryHistory({
    initialEntries: [options.href],
    requireNavigationApproval: true,
  });
  const report = (error: unknown) => {
    try {
      options.onIssue(error);
    } catch (reportError) {
      // eslint-disable-next-line no-console -- A failing host reporter must not interrupt native settlement.
      console.error(reportError);
    }
  };
  let router: TRouter;
  try {
    router = options.createRouter(history);
    if (router.history !== history)
      throw new Error("A document Router must use its supplied native history");
    // A Worksplit document is a client session even in a non-DOM test process.
    router.update({ isServer: false });
  } catch (error) {
    // The runtime has not been returned to its owner yet. End only the history
    // allocated here, including when a factory returns a foreign Router.
    try {
      history.destroy();
    } catch (cleanupError) {
      report(cleanupError);
    }
    throw error;
  }
  const owners = new WeakMap<NativeNavigation, OperationOwner>();
  const decisions = new WeakMap<NativeNavigation, DecisionRecord>();
  let initialization: Promise<DocumentNavigationResult> | undefined;
  let disposed = false;
  const current = () => !disposed && !history.signal.aborted && options.isCurrent();
  const finish = (record: DecisionRecord) => {
    if (record.ended) return;
    record.ended = true;
    let errors: readonly unknown[];
    try {
      errors = record.approval.finish();
    } catch (error) {
      errors = [error];
    }
    if (record.owner && !record.owner.finished) record.owner.cleanupErrors.push(...errors);
    else errors.forEach(report);
  };

  const stopBlocker = history.block({
    blockerFn: async ({ navigation, nextLocation }) => {
      if (!navigation || !current()) return true;
      const approval = options.beginNavigation({
        navigation,
        from: router.state.resolvedLocation ?? router.state.location,
        to: router.parseLocation(nextLocation),
      });
      const record: DecisionRecord = { approval, owner: owners.get(navigation), ended: false };
      decisions.set(navigation, record);
      navigation.signal.addEventListener("abort", () => finish(record), { once: true });
      // getState/decide may synchronously reenter before beginNavigation returns.
      if (navigation.signal.aborted || !current()) {
        finish(record);
        return true;
      }
      return !(await approval.decision) || !current() || navigation.signal.aborted;
    },
    beforeCommit: ({ navigation }) => {
      const record = navigation && decisions.get(navigation);
      if (!record || record.ended || !current()) return false;
      const valid = record.approval.validate();
      return valid && !record.ended && current();
    },
  });
  // Association by actual entry identity, bounded by each native request. A
  // same-location reload after acceptance has no entry request to manufacture.
  const pendingEntries = new Map<string, NativeNavigation>();
  const stopEntries = history.subscribe(({ navigation }) => {
    if (!navigation) return;
    let approval = navigation;
    while (approval.parent) approval = approval.parent;
    decisions.get(approval)?.approval.committed?.();
    const key = navigation.nextLocation.state["__TSR_key"];
    if (!key) return;
    pendingEntries.set(key, navigation);
    const remove = () => {
      if (pendingEntries.get(key) === navigation) pendingEntries.delete(key);
    };
    navigation.signal.addEventListener("abort", remove, { once: true });
    if (navigation.signal.aborted) remove();
  });
  const stopHistory = history.subscribe(router.load);
  const stopAccepted = router.subscribe("onResolved", () => {
    if (!current()) return;
    const accepted = router.state.resolvedLocation;
    if (!accepted) return;
    try {
      const key = accepted.state["__TSR_key"];
      options.onAccepted(accepted, key ? pendingEntries.get(key) : undefined);
    } catch (error) {
      report(error);
    }
  });

  const execute = async (
    run: (
      callbacks: Pick<LoadOptions, "onNavigationStart" | "onNavigationResult">,
    ) => Promise<void>,
    original?: Pick<LoadOptions, "onNavigationStart" | "onNavigationResult">,
  ): Promise<DocumentNavigationResult> => {
    if (!current()) return { status: "superseded", cleanupErrors: [] };
    const owner: OperationOwner = { cleanupErrors: [], finished: false };
    let outcome: NativeNavigationOutcome | undefined;
    try {
      await run({
        onNavigationStart: (navigation) => {
          if (!owner.finished) owners.set(navigation, owner);
          try {
            original?.onNavigationStart?.(navigation);
          } catch (error) {
            report(error);
          }
        },
        onNavigationResult: (result) => {
          outcome = result;
          owner.finished = true;
          try {
            original?.onNavigationResult?.(result);
          } catch (error) {
            report(error);
          }
        },
      });
    } catch (error) {
      // A native result already describes any effects before the exception.
      outcome ??= { status: "failed", error };
    }
    owner.finished = true;
    return {
      ...(outcome ?? {
        status: "failed",
        error: new Error("Native navigation did not report its result"),
      }),
      cleanupErrors: [...owner.cleanupErrors],
    };
  };

  return {
    history,
    router,
    get acceptedLocation() {
      return router.state.resolvedLocation;
    },
    start() {
      return (initialization ??= execute((callbacks) => router.load(callbacks)));
    },
    navigate(navigation) {
      return execute((callbacks) => router.navigate({ ...navigation, ...callbacks }), navigation);
    },
    async goToEntry(key, callbacks) {
      const entry = history.getEntry(key);
      if (!entry || !current()) return;
      if (history.location === entry && router.state.resolvedLocation?.state["__TSR_key"] === key) {
        return { status: "accepted", cleanupErrors: [] };
      }
      const owner: OperationOwner = { cleanupErrors: [], finished: false };
      const request = history.go(
        entry.state["__TSR_index"] - history.location.state["__TSR_index"],
        {
          onNavigationStart: (navigation) => {
            owners.set(navigation, owner);
            try {
              callbacks?.onNavigationStart?.(navigation);
            } catch (error) {
              report(error);
            }
          },
        },
      );
      const status = await request.finished;
      owner.finished = true;
      return {
        status,
        navigation: request,
        error: request.error,
        cleanupErrors: [...owner.cleanupErrors],
      };
    },
    dispose() {
      if (disposed) return [];
      disposed = true;
      const errors: unknown[] = [];
      const controllers = new Set(router.state.matches.map((match) => match.abortController));
      for (const cleanup of [
        ...[...controllers].map((controller) => () => controller.abort()),
        () => history.destroy(),
        stopAccepted,
        stopEntries,
        stopHistory,
        stopBlocker,
        () => router.clearCache(),
      ]) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      return errors;
    },
  };
}
