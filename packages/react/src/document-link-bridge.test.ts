import {
  Actions,
  DockLocation,
  Model,
  type IJsonTabNode,
  type ILayoutApi,
  type Node,
} from "flexlayout-react";
import type { DragEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentLinkController, type DocumentLinkNavigator } from "./document-link";
import type { OpenOptions, OpenResult } from "./types";

const controllers: DocumentLinkController[] = [];
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
});

function fixture(options: OpenOptions = {}, navigate?: DocumentLinkNavigator) {
  const model = Model.fromJson({
    global: { tabSetEnableTabGroups: true },
    layout: {
      type: "row",
      children: [
        {
          type: "tabset",
          id: "main",
          children: [
            { type: "tab", id: "a", component: "tool" },
            { type: "tab", id: "b", component: "tool" },
          ],
        },
      ],
    },
    borders: [{ type: "border", location: "bottom", children: [] }],
  });
  model.doAction(Actions.addTabToNewGroup("a", "Group"));
  const group = model.getNodeById("a")!.getParent()!;
  let json: IJsonTabNode | undefined;
  const endDrag = vi.fn<ILayoutApi["endDrag"]>();
  const api = {
    endDrag,
    setDragComponent: vi.fn<ILayoutApi["setDragComponent"]>(),
    addTabWithDragAndDrop: vi.fn<ILayoutApi["addTabWithDragAndDrop"]>((_event, value) => {
      json = value;
    }),
  } as unknown as ILayoutApi;
  const allowMove = vi.fn<(drag: Node, target: Node, location: DockLocation) => boolean>(
    () => true,
  );
  const report = vi.fn<(error: unknown) => void>();
  const reportResult = vi.fn<(value: OpenResult) => void>();
  const controller = new DocumentLinkController(model, allowMove, undefined, report, reportResult);
  controllers.push(controller);
  const detach = controller.attach(() => api);
  const destination = vi.fn<DocumentLinkNavigator>(
    navigate ?? (async () => ({ status: "denied", reason: "decision" })),
  );
  const result = vi.fn<(value: OpenResult) => void>();
  const link = controller.create(() => "/item/a", destination, options, result);
  const element = document.createElement("span");
  element.setAttribute("aria-label", "Drag report");
  const event = {
    currentTarget: element,
    defaultPrevented: false,
    nativeEvent: new Event("dragstart"),
    dataTransfer: {
      effectAllowed: "none",
      setData: vi.fn<(format: string, value: string) => void>(),
    },
    preventDefault: vi.fn<() => void>(),
  } as unknown as DragEvent<HTMLElement>;
  const start = () => {
    link.dragStart(event);
    if (!json) throw new Error("Native drag descriptor missing");
    // The native Layout makes a detached TabNode for a new-tab drag. This test supplies an
    // independent native node through the public Model API; actual mouse hit testing is browser-tested.
    const drag = Model.fromJson({
      layout: { type: "row", children: [{ type: "tabset", children: [json] }] },
    }).getNodeById(json.id!)!;
    return drag;
  };
  const drop = (target: Node, index: number, drag: Node) => {
    expect(controller.allowsDrop(drag, target, DockLocation.CENTER, index)).toBe(true);
    expect(
      controller.consume(Actions.addTab(json!, target.getId(), DockLocation.CENTER, index)),
    ).toBe(true);
  };
  return {
    model,
    group,
    link,
    start,
    drop,
    detach,
    endDrag,
    event,
    controller,
    destination,
    result,
    allowMove,
    report,
  };
}

describe("document link native bridge", () => {
  it("does not resolve or notify for a canceled drag", () => {
    const f = fixture();
    f.start();
    f.link.dragEnd(f.event);
    expect(f.endDrag).toHaveBeenCalledOnce();
    expect(f.destination).not.toHaveBeenCalled();
    expect(f.result).not.toHaveBeenCalled();
  });

  it.each(["main", "border_bottom", "group"] as const)(
    "keeps the native %s target and index",
    async (name) => {
      const clickDestination = vi.fn<() => null>(() => null);
      const f = fixture({ destination: clickDestination });
      const target = name === "group" ? f.group : f.model.getNodeById(name)!;
      f.drop(target, 0, f.start());
      f.link.dragEnd(f.event);
      await vi.waitFor(() => expect(f.result).toHaveBeenCalledOnce());
      expect(f.destination).toHaveBeenCalledOnce();
      expect(f.destination.mock.calls[0]![0]).toMatchObject({
        destination: { target: target.getId(), location: DockLocation.CENTER, index: 0 },
        presentation: "activate",
        preview: false,
      });
      expect(clickDestination).not.toHaveBeenCalled();
      expect(f.model.getNodeById(target.getId())).toBe(target);
    },
  );

  it("retains explicit presentation and preview instead of forcing a drop policy", async () => {
    const f = fixture({ presentation: "reveal", preview: true });
    f.drop(f.group, -1, f.start());
    await vi.waitFor(() => expect(f.result).toHaveBeenCalledOnce());
    expect(f.destination.mock.calls[0]![0]).toMatchObject({
      presentation: "reveal",
      preview: true,
    });
  });

  it.each(["reorder", "regroup", "remove", "detach", "replace-drag"] as const)(
    "invalidates a deferred drop after %s without changing the insertion index",
    async (change) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const f = fixture({}, async (_options, current) => {
        await gate;
        return current() ? { status: "denied", reason: "decision" } : { status: "superseded" };
      });
      const target = change === "regroup" ? f.group : f.model.getNodeById("main")!;
      f.drop(target, 0, f.start());
      if (change === "reorder")
        f.model.doAction(Actions.moveNode("b", "main", DockLocation.CENTER, 0));
      if (change === "regroup") f.model.doAction(Actions.ungroup(f.group.getId()));
      if (change === "remove") {
        f.model.doAction(Actions.ungroup(f.group.getId()));
        f.model.doAction(Actions.deleteTabset("main"));
        if (f.model.getNodeById("main")) throw new Error("Failed to remove the fixture target");
      }
      if (change === "detach") f.detach();
      if (change === "replace-drag") f.start();
      release();
      await vi.waitFor(() => expect(f.result).toHaveBeenCalledWith({ status: "superseded" }));
      expect(f.result).toHaveBeenCalledOnce();
      expect(f.destination.mock.calls[0]![0].destination).toMatchObject({ index: 0 });
    },
  );

  it("does not cancel an unrelated click while a drop is awaiting its destination", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = fixture({}, async (_options, current) => {
      await gate;
      return current() ? { status: "denied", reason: "decision" } : { status: "superseded" };
    });
    f.drop(f.group, 0, f.start());
    const clicked = f.link.open();
    release();
    await clicked;
    await vi.waitFor(() => expect(f.result).toHaveBeenCalledTimes(2));
    expect(f.result.mock.calls.every(([value]) => value.status === "denied")).toBe(true);
  });
});
