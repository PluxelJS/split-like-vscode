/** One leave decision's temporary resources, independent of a content effect. */
export class LeaveAttempt {
  private readonly controller = new AbortController();
  private cleanups: (() => void)[] = [];
  private ended = false;
  private readonly report: (error: unknown) => void;

  constructor(report: (error: unknown) => void) {
    this.report = report;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Late resources belong to the original attempt and are released immediately. */
  defer = (cleanup: () => void): void => {
    if (!this.ended) {
      this.cleanups.push(cleanup);
      return;
    }
    try {
      cleanup();
    } catch (error) {
      this.report(error);
    }
  };

  /** Mark every participant ended before an abort listener can reenter the batch. */
  static end(attempts: readonly LeaveAttempt[]): unknown[] {
    const pending = [...new Set(attempts)].flatMap((attempt) => {
      if (attempt.ended) return [];
      attempt.ended = true;
      return [{ attempt, cleanups: attempt.cleanups.splice(0).toReversed() }];
    });
    const errors: unknown[] = [];
    for (const { attempt, cleanups } of pending) {
      try {
        attempt.controller.abort();
      } catch (error) {
        errors.push(error);
      }
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
    }
    return errors;
  }
}
