/// <reference lib="esnext.disposable" />

import { createRootRoute, createRouter, type AnyRouter } from "@tanstack/react-router";
import { newMessagePortRpcSession, RpcTarget } from "capnweb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkbench, type WorkbenchInstance } from "./index";
import { integrationState } from "./integration";

const instances: WorkbenchInstance<AnyRouter>[] = [];
const sessions: (() => void)[] = [];
const pending: (() => void)[] = [];
afterEach(async () => {
  pending.splice(0).forEach((finish) => finish());
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
  sessions.splice(0).forEach((dispose) => dispose());
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  pending.push(resolve);
  return { promise, resolve };
}
function setup(blocks = new Map<string, Promise<void>>()) {
  const opened: string[] = [];
  const released: string[] = [];
  class DocumentSession extends RpcTarget {
    constructor(readonly id: string) {
      super();
    }
    title() {
      return this.id;
    }
    [Symbol.dispose]() {
      released.push(this.id);
    }
  }
  class DocumentApi extends RpcTarget {
    async openDocument(id: string) {
      opened.push(id);
      await blocks.get(id);
      return new DocumentSession(id);
    }
  }
  const channel = new MessageChannel();
  const server = newMessagePortRpcSession(channel.port1, new DocumentApi());
  const api = newMessagePortRpcSession<DocumentApi>(channel.port2);
  sessions.push(() => {
    api[Symbol.dispose]();
    server[Symbol.dispose]();
    channel.port1.close();
    channel.port2.close();
  });
  const root = createRootRoute();
  const onIssue = vi.fn<(issue: unknown) => void>();
  const workbench = createWorkbench({
    createRouter: (history) => createRouter({ routeTree: root, history }),
    onIssue,
    tools: [{ id: "document", render: () => null }],
    layout: {
      layout: {
        children: [{ type: "tabset", children: [{ id: "document", component: "worksplit.tool" }] }],
      },
    },
  });
  instances.push(workbench);
  return {
    api,
    opened,
    released,
    workbench,
    onIssue,
    content: integrationState(workbench).content("document"),
  };
}

describe("real Cap’n Web resource ownership over isolated MessagePorts", () => {
  it("releases the page stub once while an application's duplicate retains the target", async () => {
    const { api, content, released, workbench, onIssue } = setup();
    let duplicate: Awaited<ReturnType<typeof api.openDocument>> | undefined;
    const localRelease = vi.fn<() => void>();
    const titles: string[] = [];
    content.effect(async ({ signal, defer }) => {
      const session = await api.openDocument("A");
      duplicate = session.dup();
      defer(() => {
        localRelease();
        session[Symbol.dispose]();
      });
      if (!signal.aborted) titles.push(await session.title());
    });
    await vi.waitFor(() => expect(titles).toEqual(["A"]));
    expect(await workbench.close("document")).toMatchObject({
      status: "closed",
      cleanupErrors: [],
    });
    expect(localRelease).toHaveBeenCalledTimes(1);
    expect(await duplicate!.title()).toBe("A");
    expect(released).toEqual([]);
    duplicate![Symbol.dispose]();
    await vi.waitFor(() => expect(released).toEqual(["A"]));
    expect(await workbench.dispose()).toEqual([]);
    expect(localRelease).toHaveBeenCalledTimes(1);
    expect(onIssue).not.toHaveBeenCalled();
  });

  it("cleans a stopped route's late target without publishing over the next route", async () => {
    const acquisition = gate();
    const { api, content, opened, released, workbench, onIssue } = setup(
      new Map([["A", acquisition.promise]]),
    );
    const titles: string[] = [];
    let aSignal!: AbortSignal;
    const stopA = content.effect(async ({ signal, defer }) => {
      aSignal = signal;
      const session = await api.openDocument("A");
      defer(() => session[Symbol.dispose]());
      if (signal.aborted) return;
      const title = await session.title();
      if (!signal.aborted) titles.push(title);
    });
    await vi.waitFor(() => expect(opened).toEqual(["A"]));
    stopA();
    content.effect(async ({ signal, defer }) => {
      const session = await api.openDocument("B");
      defer(() => session[Symbol.dispose]());
      if (signal.aborted) return;
      const title = await session.title();
      if (!signal.aborted) titles.push(title);
    });
    await vi.waitFor(() => expect(titles).toEqual(["B"]));
    expect(aSignal.aborted).toBe(true);
    acquisition.resolve();
    await vi.waitFor(() => expect(released).toEqual(["A"]));
    expect(titles).toEqual(["B"]);
    expect(await workbench.close("document")).toMatchObject({
      status: "closed",
      cleanupErrors: [],
    });
    await vi.waitFor(() => expect(released).toEqual(["A", "B"]));
    expect(onIssue).not.toHaveBeenCalled();
  });

  it("returns close before a pending RPC result and releases the result when it later arrives", async () => {
    const acquisition = gate();
    const { api, content, opened, released, workbench, onIssue } = setup(
      new Map([["late", acquisition.promise]]),
    );
    const titles: string[] = [];
    content.effect(async ({ signal, defer }) => {
      const session = await api.openDocument("late");
      defer(() => session[Symbol.dispose]());
      if (!signal.aborted) titles.push(await session.title());
    });
    await vi.waitFor(() => expect(opened).toEqual(["late"]));
    expect(await workbench.close("document")).toMatchObject({
      status: "closed",
      cleanupErrors: [],
    });
    expect(released).toEqual([]);
    acquisition.resolve();
    await vi.waitFor(() => expect(released).toEqual(["late"]));
    expect(titles).toEqual([]);
    expect(onIssue).not.toHaveBeenCalled();
  });
});
