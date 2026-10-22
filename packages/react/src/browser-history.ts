/** Browser history is an output of accepted document navigation. No Router uses it directly. */
export class BrowserHistoryCoordinator {
  private accepted: { index: number; href: string; id?: string | undefined };
  private physicalIndex: number;
  private generation = 0;
  private restoring = false;
  private pendingWrite: (() => void) | undefined;
  private disposed = false;
  private readonly key: string;
  private scope: string | undefined;
  private readonly baseIndex: number;
  private outsideDecision = false;
  private outsideAbort: AbortController | undefined;

  constructor(
    private readonly win: Window,
    workspaceId: string,
    private readonly visit: (
      href: string,
      id: string | undefined,
      current: () => boolean,
    ) => Promise<{ id?: string; href: string } | undefined>,
    private readonly report: (error: unknown, outside?: boolean) => void,
    private readonly beforeOutsideScope?: (
      href: string,
      context: { signal: AbortSignal },
    ) => boolean | Promise<boolean>,
  ) {
    this.key = `worksplit:${workspaceId}`;
    const saved = this.read(win.history.state);
    this.scope =
      saved?.scope ??
      Array.from(win.crypto.getRandomValues(new Uint32Array(4)), (value) =>
        value.toString(16),
      ).join("-");
    this.physicalIndex = saved?.index ?? 0;
    this.baseIndex = this.position(win.history.state) - this.physicalIndex;
    this.accepted = { index: this.physicalIndex, href: this.href(), id: saved?.id };
    this.write(this.accepted.href, this.accepted.id, true);
    win.addEventListener("popstate", this.onPop);
  }

  get busy() {
    return this.restoring || this.physicalIndex !== this.accepted.index;
  }

  publish(href: string, id: string | undefined, replace: boolean) {
    if (this.disposed || this.outsideDecision) return;
    ++this.generation;
    const apply = () => this.write(href, id, replace);
    if (this.busy) {
      this.pendingWrite = apply;
      this.restore();
    } else {
      apply();
    }
  }

  dispose() {
    this.disposed = true;
    this.outsideAbort?.abort();
    this.outsideAbort = undefined;
    ++this.generation;
    this.pendingWrite = undefined;
    this.win.removeEventListener("popstate", this.onPop);
  }

  // TanStack's native browser index also identifies entries owned by the outer Router.
  // Keep it monotonic while the workspace exclusively owns browser writes, so a rejected
  // cross-scope traversal can use history.go without another URL/navigation state machine.
  private position(state: unknown): number {
    const value =
      state && typeof state === "object"
        ? (state as Record<string, unknown>)["__TSR_index"]
        : undefined;
    return Number.isSafeInteger(value) ? (value as number) : 0;
  }

  private href() {
    return this.win.location.pathname + this.win.location.search + this.win.location.hash;
  }

  private read(
    state: unknown,
  ): { scope: string; index: number; id?: string | undefined } | undefined {
    if (!state || typeof state !== "object") return;
    const value = (state as Record<string, unknown>)[this.key];
    if (!value || typeof value !== "object") return;
    const { scope, index, id } = value as Record<string, unknown>;
    if (
      typeof scope === "string" &&
      (this.scope === undefined || this.scope === scope) &&
      Number.isSafeInteger(index) &&
      (id === undefined || typeof id === "string")
    )
      return { scope, index: index as number, id: id as string | undefined };
  }

  private write(href: string, id: string | undefined, replace: boolean) {
    replace ||= href === this.accepted.href;
    const index = this.accepted.index + (replace ? 0 : 1);
    const state = {
      ...this.win.history.state,
      __TSR_index: this.baseIndex + index,
      [this.key]: { scope: this.scope, index, id },
    };
    this.win.history[replace ? "replaceState" : "pushState"](state, "", href);
    this.physicalIndex = index;
    this.accepted = { index, href, id };
  }

  private restore() {
    if (this.restoring) return;
    if (this.physicalIndex === this.accepted.index) {
      this.pendingWrite?.();
      this.pendingWrite = undefined;
      return;
    }
    this.restoring = true;
    this.win.history.go(this.accepted.index - this.physicalIndex);
  }

  private onPop = (event: PopStateEvent) => {
    this.outsideAbort?.abort();
    this.outsideAbort = undefined;
    const state = this.read(event.state);
    // Entries outside this workspace are owned by the containing application.
    if (!state) {
      const token = ++this.generation;
      this.physicalIndex = this.position(event.state) - this.baseIndex;
      const report = () =>
        this.report(
          new Error("History entry is outside this Worksplit workspace; the host must handle it"),
          true,
        );
      if (!this.beforeOutsideScope) {
        report();
        return;
      }
      this.outsideDecision = true;
      const abort = new AbortController();
      this.outsideAbort = abort;
      const href = this.href();
      void Promise.resolve()
        .then(() =>
          abort.signal.aborted ? false : this.beforeOutsideScope!(href, { signal: abort.signal }),
        )
        .then(
          (allowed) => {
            if (this.disposed || token !== this.generation) return;
            this.outsideAbort = undefined;
            this.outsideDecision = false;
            return allowed ? report() : this.restore();
          },
          (error) => {
            if (this.disposed || token !== this.generation) return;
            this.outsideAbort = undefined;
            this.outsideDecision = false;
            this.report(error);
            this.restore();
          },
        );
      return;
    }
    // An owned traversal supersedes the host decision, including its publish lock.
    // Invalidate it before the restoration branch, which can otherwise return early.
    this.outsideDecision = false;
    const token = ++this.generation;
    this.physicalIndex = state.index;
    if (this.restoring) {
      this.restoring = false;
      if (state.index !== this.accepted.index) {
        this.restore();
        return;
      }
      const pending = this.pendingWrite;
      this.pendingWrite = undefined;
      pending?.();
      return;
    }
    const href = this.href();
    const current = () => !this.disposed && token === this.generation;
    void this.visit(href, state.id, current).then(
      (result) => {
        if (!current()) return undefined;
        if (result === undefined) {
          this.restore();
        } else {
          this.accepted = { index: state.index, href: result.href, id: result.id };
          // Redirects normalize this existing entry, never push another entry.
          this.write(result.href, result.id, true);
        }
        return undefined;
      },
      (error: unknown) => {
        this.report(error);
        if (current()) this.restore();
      },
    );
  };
}
