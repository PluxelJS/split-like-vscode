import { createMemoryHistory, type RouterHistory } from "@tanstack/react-router";

const refusals = new WeakMap<RouterHistory, Set<() => void>>();

/** Observe public blocker outcomes: memory history does not settle Router.navigate on refusal. */
export function createDocumentHistory(href: string): RouterHistory {
  const history = createMemoryHistory({ initialEntries: [href] });
  const listeners = new Set<() => void>();
  refusals.set(history, listeners);
  const block = history.block.bind(history);
  history.block = (options) =>
    block({
      ...options,
      blockerFn: async (args) => {
        const refused = await options.blockerFn(args);
        if (refused) listeners.forEach((listener) => listener());
        return refused;
      },
    });
  return history;
}

export async function navigateDocument(
  router: {
    history: RouterHistory;
    navigate: (options: { href: string; replace: boolean }) => Promise<void>;
  },
  href: string,
  replace: boolean,
): Promise<boolean> {
  const listeners = refusals.get(router.history)!;
  let refused!: () => void;
  const blocked = new Promise<false>((resolve) => {
    refused = () => resolve(false);
  });
  listeners.add(refused);
  try {
    return await Promise.race([router.navigate({ href, replace }).then(() => true), blocked]);
  } finally {
    listeners.delete(refused);
  }
}
