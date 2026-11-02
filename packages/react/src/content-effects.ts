/** The lifetime of one effect. Register acquired resources immediately with defer. */
export interface WorkbenchContentEffect {
  readonly signal: AbortSignal;
  defer(cleanup: () => void | Promise<void>): void;
}

type Cleanup = () => void | Promise<void>;
type CleanupTask = {
  promise: Promise<unknown[]>;
  finish: (errors: unknown[]) => void;
  cleanup: Cleanup;
  owner?: object;
};
type Effect = {
  controller: AbortController;
  ended: boolean;
  cleanups: CleanupTask[];
};

/** One content instance's effects and unsettled cleanups. No setup Promise is a drain task. */
export class ContentEffects {
  private closed = false;
  private readonly effects = new Set<Effect>();
  private readonly tasks = new Set<CleanupTask>();

  constructor(
    private readonly assertCurrent: () => void,
    private readonly report: (error: unknown) => void,
  ) {}

  effect(setup: (effect: WorkbenchContentEffect) => void | Promise<void>): () => void {
    this.assertCurrent();
    if (this.closed) throw new Error("Cannot start an effect on closed content");
    const effect: Effect = { controller: new AbortController(), ended: false, cleanups: [] };
    this.effects.add(effect);
    const stop = () => this.stop(effect);
    const fail = (error: unknown) => {
      const { signal } = effect.controller;
      const cancelled = signal.aborted && Object.is(error, signal.reason);
      stop();
      if (!cancelled) this.report(error);
    };
    try {
      const result = setup({
        signal: effect.controller.signal,
        defer: (cleanup) => {
          const late = this.closed || effect.ended;
          const task = this.task(cleanup, !late);
          if (late) void this.run(task);
          else effect.cleanups.push(task);
        },
      });
      void Promise.resolve(result).catch(fail);
    } catch (error) {
      fail(error);
    }
    return stop;
  }

  /** Freeze and claim before any abort listener/cleanup runs, across all closing contents. */
  prepareClose(owner: object): { stop: () => void; result: Promise<unknown[]> } {
    this.closed = true;
    const tasks = [...this.tasks];
    for (const task of tasks) task.owner ??= owner;
    const effects = [...this.effects];
    return {
      stop: () => effects.forEach((effect) => this.stop(effect)),
      result: Promise.all(tasks.map((task) => task.promise)).then((results) =>
        results.flatMap((errors, index) => (tasks[index]!.owner === owner ? errors : [])),
      ),
    };
  }

  private task(cleanup: Cleanup, tracked: boolean): CleanupTask {
    let finish!: CleanupTask["finish"];
    const promise = new Promise<unknown[]>((resolve) => {
      finish = resolve;
    });
    const task: CleanupTask = { cleanup, promise, finish };
    if (tracked) this.tasks.add(task);
    void promise.then((errors) => {
      this.tasks.delete(task);
      if (!task.owner) {
        // Mark responsibility before invoking a possibly reentrant host reporter.
        task.owner = {};
        errors.forEach((error) => this.report(error));
      }
      return undefined;
    });
    return task;
  }

  private stop(effect: Effect): void {
    if (effect.ended) return;
    effect.ended = true;
    this.effects.delete(effect);
    const cleanups = effect.cleanups.splice(0).toReversed();
    try {
      effect.controller.abort();
    } catch (error) {
      this.report(error);
    }
    // Start the first cleanup synchronously. Continue in reverse acquisition order even
    // after failure; late defer calls take their own immediate, untracked cleanup path.
    void (async () => {
      // eslint-disable-next-line no-await-in-loop -- Protocol resources release in reverse acquisition order.
      for (const task of cleanups) await this.run(task);
    })();
  }

  private async run(task: CleanupTask): Promise<void> {
    let errors: unknown[] = [];
    try {
      await task.cleanup();
    } catch (error) {
      errors = [error];
    }
    task.finish(errors);
  }
}
