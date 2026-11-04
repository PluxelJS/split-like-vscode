import { describe, expect, it } from "vitest";

import { LeaveAttempt } from "./leave-attempt";

describe("leave attempt resources", () => {
  it("a refused successor releases only its own pause while the predecessor is loading", () => {
    const pauses = new Set<object>();
    const pause = () => {
      const reference = {};
      pauses.add(reference);
      return () => pauses.delete(reference);
    };
    const first = new LeaveAttempt(() => {});
    const second = new LeaveAttempt(() => {});
    first.defer(pause());
    second.defer(pause());
    expect(LeaveAttempt.end([second])).toEqual([]);
    expect(pauses.size).toBe(1);
    expect(first.signal.aborted).toBe(false);
    expect(LeaveAttempt.end([first, second])).toEqual([]);
    expect(pauses.size).toBe(0);
  });

  it("marks a whole batch ended before abort listeners register or end another participant", () => {
    const first = new LeaveAttempt(() => {});
    const second = new LeaveAttempt(() => {});
    const events: string[] = [];
    first.defer(() => events.push("first"));
    second.defer(() => events.push("second acquired first"));
    second.defer(() => events.push("second acquired last"));
    first.signal.addEventListener("abort", () => {
      second.defer(() => events.push("late second"));
      expect(LeaveAttempt.end([second])).toEqual([]);
    });
    expect(LeaveAttempt.end([first, second, first])).toEqual([]);
    expect(events).toEqual([
      "late second",
      "first",
      "second acquired last",
      "second acquired first",
    ]);
    expect(second.signal.aborted).toBe(true);
    expect(LeaveAttempt.end([first, second])).toEqual([]);
  });

  it("returns known release failures and reports late failures without skipping releases", () => {
    const reported: unknown[] = [];
    const attempt = new LeaveAttempt((error) => reported.push(error));
    const known = new Error("known release");
    const late = new Error("late release");
    let released = 0;
    attempt.defer(() => {
      ++released;
    });
    attempt.defer(() => {
      throw known;
    });
    expect(LeaveAttempt.end([attempt])).toEqual([known]);
    expect(released).toBe(1);
    expect(reported).toEqual([]);
    attempt.defer(() => {
      throw late;
    });
    expect(reported).toEqual([late]);
    expect(LeaveAttempt.end([attempt])).toEqual([]);
  });
});
