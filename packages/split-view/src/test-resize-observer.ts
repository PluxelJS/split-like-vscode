import { vi } from "vitest";

export interface TestResizeObserverInstance {
  readonly disconnect: ReturnType<typeof vi.fn<() => void>>;
  readonly observe: ReturnType<typeof vi.fn<(target: Element) => void>>;
  readonly unobserve: ReturnType<typeof vi.fn<(target: Element) => void>>;
}

export interface TestResizeObserverHarness {
  readonly instances: TestResizeObserverInstance[];
}

export function installTestResizeObserver(size: {
  height: number;
  width: number;
}): TestResizeObserverHarness {
  const instances: TestResizeObserverInstance[] = [];

  class TestResizeObserver implements ResizeObserver {
    private callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      instances.push(this);
    }

    observe = vi.fn<(target: Element) => void>((target) => {
      const contentRect: DOMRectReadOnly = {
        bottom: size.height,
        height: size.height,
        left: 0,
        right: size.width,
        toJSON: () => ({
          height: size.height,
          width: size.width,
          x: 0,
          y: 0,
        }),
        top: 0,
        width: size.width,
        x: 0,
        y: 0,
      };
      const boxSize: ResizeObserverSize = {
        blockSize: size.height,
        inlineSize: size.width,
      };

      this.callback(
        [
          {
            borderBoxSize: [boxSize],
            contentBoxSize: [boxSize],
            contentRect,
            devicePixelContentBoxSize: [boxSize],
            target,
          },
        ],
        this,
      );
    });

    disconnect = vi.fn<() => void>();
    unobserve = vi.fn<(target: Element) => void>();
  }

  globalThis.ResizeObserver = TestResizeObserver;
  return { instances };
}
