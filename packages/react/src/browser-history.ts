/** References only: the native document history owns entries and their state. */
export interface BrowserEntryReference {
  readonly contentId: string;
  readonly lifetime: string;
  readonly entryKey: string;
}

export interface BrowserVisitResult {
  readonly href: string;
  readonly reference?: BrowserEntryReference;
}

export interface OutsideNavigation {
  readonly signal: AbortSignal;
  readonly state: unknown;
  current(): boolean;
}

interface OwnedEntry {
  readonly scope: string;
  readonly index: number;
  readonly reference?: BrowserEntryReference;
}

interface AcceptedEntry extends BrowserVisitResult {
  readonly index: number;
  readonly position: number;
}

const connections = new WeakMap<Window, BrowserHistoryCoordinator>();

/** Browser entries are an output of native acceptance, never a Router's history. */
export class BrowserHistoryCoordinator {
  private accepted: AcceptedEntry | undefined;
  private physicalPosition: number | undefined;
  private generation = 0;
  private restoring = false;
  private pendingWrite: (() => void) | undefined;
  private disposed = false;
  private readonly key: string;
  private readonly scope: string;
  private readonly basePosition: number;
  private readonly nativeBasePosition: number;
  private readonly navigationPositions: boolean;
  private outsideAbort: AbortController | undefined;
  private visitAbort: AbortController | undefined;
  private initialization: Promise<BrowserVisitResult | undefined> | undefined;
  private settleInitialization: ((result: BrowserVisitResult | undefined) => void) | undefined;

  constructor(
    private readonly win: Window,
    workspaceId: string,
    private readonly visit: (
      href: string,
      reference: BrowserEntryReference | undefined,
      current: () => boolean,
      signal: AbortSignal,
    ) => Promise<BrowserVisitResult | undefined>,
    private readonly report: (error: unknown) => void,
    /** true means the host has synchronously committed termination and handoff. */
    private readonly outside: (href: string, context: OutsideNavigation) => Promise<boolean>,
  ) {
    if (connections.has(win))
      throw new Error("This Window already has a Worksplit browser connection");
    this.key = `worksplit:${workspaceId}`;
    const saved = this.read(win.history.state, false);
    this.scope =
      saved?.scope ??
      Array.from(win.crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16)).join("-");
    // A new connection can assign its initial native position; subsequent outside
    // entries need the outer Router's native index or the public Navigation API.
    this.navigationPositions = this.navigationPosition() !== undefined;
    this.physicalPosition = this.position(win.history.state) ?? 0;
    this.basePosition = this.physicalPosition - (saved?.index ?? 0);
    this.nativeBasePosition =
      (this.nativePosition(win.history.state) ?? this.physicalPosition) - (saved?.index ?? 0);
    connections.set(win, this);
    win.addEventListener("popstate", this.onPop);
  }

  /** The latest valid startup traversal settles this one shared initialization. */
  get acceptedHref(): string | undefined {
    return this.accepted?.href;
  }

  start(): Promise<BrowserVisitResult | undefined> {
    if (this.initialization) return this.initialization;
    this.initialization = new Promise((resolve) => {
      this.settleInitialization = resolve;
    });
    if (this.disposed) this.finishInitialization(undefined);
    else this.visitEntry(this.read(this.win.history.state) ?? { scope: this.scope, index: 0 });
    return this.initialization;
  }

  /** Explicit work supersedes a pending traversal or outside leave decision. */
  cancelPending(): void {
    if (this.disposed) return;
    ++this.generation;
    this.outsideAbort?.abort();
    this.outsideAbort = undefined;
    this.visitAbort?.abort();
    this.visitAbort = undefined;
    this.pendingWrite = undefined;
    this.restore();
  }

  publish(href: string, reference: BrowserEntryReference | undefined, replace: boolean): void {
    if (this.disposed) return;
    ++this.generation;
    this.outsideAbort?.abort();
    this.outsideAbort = undefined;
    this.visitAbort?.abort();
    this.visitAbort = undefined;
    const apply = () => this.write(href, reference, replace);
    if (this.restoring || (this.accepted && this.physicalPosition !== this.accepted.position)) {
      this.pendingWrite = apply;
      this.restore();
    } else apply();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.outsideAbort?.abort();
    this.outsideAbort = undefined;
    this.visitAbort?.abort();
    this.visitAbort = undefined;
    ++this.generation;
    this.pendingWrite = undefined;
    this.win.removeEventListener("popstate", this.onPop);
    if (connections.get(this.win) === this) connections.delete(this.win);
    this.finishInitialization(undefined);
  }

  private finishInitialization(result: BrowserVisitResult | undefined): void {
    const settle = this.settleInitialization;
    this.settleInitialization = undefined;
    settle?.(result);
  }

  private position(state: unknown): number | undefined {
    return this.navigationPositions ? this.navigationPosition() : this.nativePosition(state);
  }

  private nativePosition(state: unknown): number | undefined {
    const value =
      state && typeof state === "object"
        ? (state as Record<string, unknown>)["__TSR_index"]
        : undefined;
    return Number.isSafeInteger(value) ? (value as number) : undefined;
  }

  private navigationPosition(): number | undefined {
    const navigation = (this.win as Window & { navigation?: { currentEntry?: { index: number } } })
      .navigation;
    const index = navigation?.currentEntry?.index;
    return Number.isSafeInteger(index) && index! >= 0 ? index : undefined;
  }

  private href(): string {
    return this.win.location.pathname + this.win.location.search + this.win.location.hash;
  }

  private read(state: unknown, sameScope = true): OwnedEntry | undefined {
    if (!state || typeof state !== "object") return;
    const value = (state as Record<string, unknown>)[this.key];
    if (!value || typeof value !== "object") return;
    const { scope, index, reference } = value as Record<string, unknown>;
    if (
      typeof scope !== "string" ||
      !scope ||
      (sameScope && scope !== this.scope) ||
      !Number.isSafeInteger(index)
    )
      return;
    if (reference !== undefined) {
      if (!reference || typeof reference !== "object") return;
      const { contentId, lifetime, entryKey } = reference as Record<string, unknown>;
      if (
        typeof contentId !== "string" ||
        typeof lifetime !== "string" ||
        typeof entryKey !== "string"
      )
        return;
      return { scope, index: index as number, reference: { contentId, lifetime, entryKey } };
    }
    return { scope, index: index as number };
  }

  private write(
    href: string,
    reference: BrowserEntryReference | undefined,
    replace: boolean,
  ): void {
    const index = (this.accepted?.index ?? 0) + (replace || !this.accepted ? 0 : 1);
    const position = this.basePosition + index;
    const state = {
      ...this.win.history.state,
      __TSR_index: this.nativeBasePosition + index,
      [this.key]: { scope: this.scope, index, reference },
    };
    this.win.history[replace || !this.accepted ? "replaceState" : "pushState"](state, "", href);
    this.physicalPosition = position;
    this.accepted = { index, position, href, ...(reference ? { reference } : {}) };
  }

  private restore(): void {
    if (this.disposed || this.restoring || !this.accepted) return;
    if (this.physicalPosition === undefined) {
      this.pendingWrite = undefined;
      this.report(
        new Error(
          "Cannot restore an outside entry without a native history index or Navigation API position",
        ),
      );
      return;
    }
    if (this.physicalPosition === this.accepted.position) {
      const pending = this.pendingWrite;
      this.pendingWrite = undefined;
      pending?.();
      return;
    }
    this.restoring = true;
    this.win.history.go(this.accepted.position - this.physicalPosition);
  }

  private visitEntry(state: OwnedEntry): void {
    this.visitAbort?.abort();
    const abort = new AbortController();
    this.visitAbort = abort;
    const token = ++this.generation;
    const href = this.href();
    const current = () => !this.disposed && !abort.signal.aborted && token === this.generation;
    void Promise.resolve()
      .then(() =>
        current() ? this.visit(href, state.reference, current, abort.signal) : undefined,
      )
      .then(
        (result) => {
          if (!current()) return;
          this.visitAbort = undefined;
          if (!result) {
            this.restore();
            this.finishInitialization(undefined);
            return;
          }
          this.accepted = {
            ...result,
            index: state.index,
            position: this.basePosition + state.index,
          };
          // A redirect normalizes the traversed entry and binds its new lifetime.
          this.write(result.href, result.reference, true);
          this.finishInitialization(result);
          return;
        },
        (error: unknown) => {
          if (!current()) return;
          this.visitAbort = undefined;
          this.report(error);
          this.restore();
          this.finishInitialization(undefined);
        },
      );
  }

  private onPop = (event: PopStateEvent): void => {
    if (this.disposed) return;
    this.outsideAbort?.abort();
    this.outsideAbort = undefined;
    this.visitAbort?.abort();
    this.visitAbort = undefined;
    const state = this.read(event.state);
    this.physicalPosition = state ? this.basePosition + state.index : this.position(event.state);
    if (this.restoring) {
      this.restoring = false;
      if (this.physicalPosition !== this.accepted?.position) {
        this.restore();
        return;
      }
      const pending = this.pendingWrite;
      this.pendingWrite = undefined;
      pending?.();
      return;
    }
    if (state) {
      this.visitEntry(state);
      return;
    }
    const token = ++this.generation;
    const abort = new AbortController();
    this.outsideAbort = abort;
    const current = () => !this.disposed && !abort.signal.aborted && token === this.generation;
    const href = this.href();
    void Promise.resolve()
      .then(() =>
        current()
          ? this.outside(href, { signal: abort.signal, state: event.state, current })
          : false,
      )
      .then(
        (allowed) => {
          if (!current()) return;
          this.outsideAbort = undefined;
          if (allowed) this.dispose();
          else {
            this.restore();
            this.finishInitialization(undefined);
          }
          return;
        },
        (error: unknown) => {
          if (!current()) return;
          this.outsideAbort = undefined;
          this.report(error);
          this.restore();
          this.finishInitialization(undefined);
        },
      );
  };
}
