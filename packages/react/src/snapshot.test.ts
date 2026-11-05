import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench } from "./integration";

const root = createRootRoute();
const page = createRoute({ getParentRoute: () => root, path: "/$id" });
const routeTree = root.addChildren([page]);
const routerFactory = (history: RouterHistory) => createRouter({ history, routeTree });
const instances: ReturnType<typeof createWorkbench>[] = [];
afterEach(async () => {
  // eslint-disable-next-line no-await-in-loop -- Each session owns its own cleanup boundary.
  for (const instance of instances.splice(0)) await instance.dispose();
});

function create(options: Omit<Parameters<typeof createWorkbench>[0], "createRouter"> = {}) {
  const instance = createWorkbench({ createRouter: routerFactory, ...options });
  instances.push(instance);
  return instance;
}

describe("public snapshot restoration", () => {
  it("round-trips a default session without making the host extract identity from unknown JSON", async () => {
    const original = create();
    await original.start();
    const opened = await original.open({ href: "/report" });
    expect(opened.status).toBe("applied");
    const snapshot = original.createSnapshot();
    const restored = create({ initial: { snapshot: JSON.parse(JSON.stringify(snapshot)) } });
    expect(await restored.start()).toMatchObject({ status: "applied", value: { href: "/report" } });
    expect(restored.createSnapshot()).toEqual(snapshot);
    expect(restored.getActiveDocument()?.handle).not.toBe(original.getActiveDocument()?.handle);
  });

  it("uses an explicit workspace identity as a restore constraint before creating a Router", async () => {
    const original = create({ workspaceId: "project-a" });
    await original.start();
    const snapshot = original.createSnapshot();
    const factory = vi.fn<typeof routerFactory>(routerFactory);
    expect(() =>
      createWorkbench({
        createRouter: factory,
        workspaceId: "project-b",
        initial: { snapshot },
      }),
    ).toThrow("Incompatible Worksplit snapshot");
    expect(factory).not.toHaveBeenCalled();
    const restored = create({ workspaceId: "project-a", initial: { snapshot } });
    expect((await restored.start()).status).toBe("applied");
    expect(restored.createSnapshot().workspaceId).toBe("project-a");
  });

  it.each([undefined, null, "", 12])(
    "rejects malformed saved identity %s without adopting it",
    async (workspaceId) => {
      const original = create();
      await original.start();
      const snapshot: unknown = { ...original.createSnapshot(), workspaceId };
      expect(() => create({ initial: { snapshot } })).toThrow("Incompatible Worksplit snapshot");
    },
  );

  it("gives unrelated fresh sessions independent identities", async () => {
    const first = create();
    const second = create();
    await first.start();
    await second.start();
    expect(first.createSnapshot().workspaceId).not.toBe(second.createSnapshot().workspaceId);
  });
});
