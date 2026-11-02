import { expect, it, vi } from "vitest";

import { ContentEffects, type WorkbenchContentEffect } from "./content-effects";

function gate<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("cleans each effect in reverse acquisition order while independent effects settle concurrently", async () => {
  const report = vi.fn<(error: unknown) => void>();
  const effects = new ContentEffects(() => {}, report);
  const order: string[] = [];
  const slow = gate();
  const failure = new Error("release");
  effects.effect(({ defer }) => {
    defer(() => {
      order.push("first");
    });
    defer(async () => {
      order.push("second");
      await slow.promise;
      throw failure;
    });
  });
  effects.effect(({ defer }) => {
    defer(() => {
      order.push("independent");
    });
  });
  const closing = effects.prepareClose({});
  closing.stop();
  expect(order).toEqual(["second", "independent"]);
  slow.resolve();
  expect(await closing.result).toEqual([failure]);
  expect(order).toEqual(["second", "independent", "first"]);
  expect(report).not.toHaveBeenCalled();
});

it("freezes before abort/reentrant defer and does not wait for late resources or setup", async () => {
  const report = vi.fn<(error: unknown) => void>();
  const effects = new ContentEffects(() => {}, report);
  const known = gate();
  const late = gate();
  const setup = gate();
  let context!: WorkbenchContentEffect;
  const lateFailure = new Error("late cleanup");
  effects.effect(async (effect) => {
    context = effect;
    effect.defer(() => known.promise);
    effect.signal.addEventListener("abort", () => {
      effect.defer(async () => {
        await late.promise;
        throw lateFailure;
      });
    });
    await setup.promise;
  });
  const closing = effects.prepareClose({});
  closing.stop();
  expect(context.signal.aborted).toBe(true);
  known.resolve();
  expect(await closing.result).toEqual([]);
  expect(report).not.toHaveBeenCalled();
  late.resolve();
  setup.resolve();
  await tick();
  expect(report).toHaveBeenCalledExactlyOnceWith(lateFailure);
});

it("lets close claim unfinished React stop cleanups and a later dispose only wait", async () => {
  const report = vi.fn<(error: unknown) => void>();
  const effects = new ContentEffects(() => {}, report);
  const slow = gate();
  const failure = new Error("claimed release");
  const release = vi.fn<() => Promise<void>>(async () => {
    await slow.promise;
    throw failure;
  });
  const stop = effects.effect(({ defer }) => {
    defer(release);
  });
  stop();
  const close = effects.prepareClose({});
  const dispose = effects.prepareClose({});
  close.stop();
  dispose.stop();
  stop();
  slow.resolve();
  expect(await close.result).toEqual([failure]);
  expect(await dispose.result).toEqual([]);
  expect(release).toHaveBeenCalledOnce();
  expect(report).not.toHaveBeenCalled();
});

it("does not replay an already reported stop failure into a later close", async () => {
  const report = vi.fn<(error: unknown) => void>();
  const effects = new ContentEffects(() => {}, report);
  const failure = new Error("reported release");
  const stop = effects.effect(({ defer }) => {
    defer(() => {
      throw failure;
    });
  });
  stop();
  await tick();
  expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  const closing = effects.prepareClose({});
  closing.stop();
  expect(await closing.result).toEqual([]);
});

it("marks stop before abort listeners and cleanups reenter stop or defer", async () => {
  const report = vi.fn<(error: unknown) => void>();
  const effects = new ContentEffects(() => {}, report);
  const release = vi.fn<() => void>();
  const lateRelease = vi.fn<() => void>();
  const stop = effects.effect(({ defer, signal }) => {
    signal.addEventListener("abort", () => {
      stop();
      defer(lateRelease);
    });
    defer(() => {
      stop();
      release();
    });
  });
  stop();
  stop();
  const closing = effects.prepareClose({});
  closing.stop();
  expect(await closing.result).toEqual([]);
  expect(release).toHaveBeenCalledOnce();
  expect(lateRelease).toHaveBeenCalledOnce();
});

it("supervises accepted setup failures and retains cleanup failures", async () => {
  const report = vi.fn<(error: unknown) => void>();
  const effects = new ContentEffects(() => {}, report);
  const setupFailure = new Error("setup");
  const cleanupFailure = new Error("cleanup");
  const release = vi.fn<() => never>(() => {
    throw cleanupFailure;
  });
  expect(() =>
    effects.effect(({ defer }) => {
      defer(release);
      throw setupFailure;
    }),
  ).not.toThrow();
  await tick();
  expect(release).toHaveBeenCalledOnce();
  expect(report.mock.calls.map(([error]) => error)).toEqual([setupFailure, cleanupFailure]);
});

it("only suppresses cancellation matching this effect's own signal reason", async () => {
  const report = vi.fn<(error: unknown) => void>();
  const effects = new ContentEffects(() => {}, report);
  const ready = gate();
  const failure = new Error("unrelated failure after abort");
  const first = effects.effect(async ({ signal }) => {
    await ready.promise;
    throw signal.reason;
  });
  const second = effects.effect(async () => {
    await ready.promise;
    throw failure;
  });
  first();
  second();
  ready.resolve();
  await tick();
  expect(report).toHaveBeenCalledExactlyOnceWith(failure);
});

it("rejects closed effect admission before executing setup", async () => {
  const effects = new ContentEffects(() => {}, vi.fn<(error: unknown) => void>());
  const closing = effects.prepareClose({});
  closing.stop();
  await closing.result;
  const setup = vi.fn<() => void>();
  expect(() => effects.effect(setup)).toThrow("closed content");
  expect(setup).not.toHaveBeenCalled();
});
