import {
  Actions,
  BorderNode,
  DockLocation,
  TabGroupNode,
  TabSetNode,
  type Action,
  type IJsonTabNode,
  type ILayoutApi,
  type Model,
  type Node,
} from "flexlayout-react";
import type { DragEvent } from "react";

import type { WorkbenchLayoutPolicy } from "./layout-policy";
import { tabContainer } from "./native-layout";
import type { Destination, DocumentLink, OpenOptions, OpenResult } from "./types";

type ResultHandler = (result: OpenResult) => void;
export type DocumentLinkNavigator = (
  options: OpenOptions,
  current: () => boolean,
) => Promise<OpenResult>;
const locations = [
  DockLocation.CENTER,
  DockLocation.LEFT,
  DockLocation.RIGHT,
  DockLocation.TOP,
  DockLocation.BOTTOM,
];
interface LayoutBinding {
  getApi(): ILayoutApi | null;
}
interface PendingDrag {
  owner: object;
  json: IJsonTabNode;
  api: ILayoutApi;
  binding: LayoutBinding;
  drag: Node | undefined;
  drop(destination: Destination, current: () => boolean): Promise<OpenResult>;
  notify: ResultHandler;
}

/** A short-lived insertion proof, including collapsed groups. It never determines insertion
 * semantics: the destination keeps FlexLayout's original target, DockLocation and index. */
function captureTarget(target: Node): () => boolean {
  const entries: {
    node: Node;
    parent: Node | undefined;
    children: Node[];
    opened: boolean | undefined;
  }[] = [];
  const visit = (node: Node) => {
    const children = [...node.getChildren()];
    entries.push({
      node,
      parent: node.getParent(),
      children,
      opened: node instanceof TabGroupNode ? node.isOpened() : undefined,
    });
    children.forEach(visit);
  };
  visit(target);
  return () =>
    entries.every(({ node, parent, children, opened }) => {
      const current = node.getChildren();
      return (
        node.getParent() === parent &&
        current.length === children.length &&
        current.every((child, index) => child === children[index]) &&
        (!(node instanceof TabGroupNode) || node.isOpened() === opened)
      );
    });
}

/** Native hit testing and drag imagery feed the same routed admission as a real click. */
export class DocumentLinkController {
  private binding: LayoutBinding | undefined;
  private pending: PendingDrag | undefined;
  private readonly drops = new Map<object, object>();
  private disposed = false;

  constructor(
    private readonly model: Model,
    private readonly allowMove: (drag: Node, target: Node, location: DockLocation) => boolean,
    private readonly layoutPolicy: WorkbenchLayoutPolicy | undefined,
    private readonly report: (error: unknown) => void,
    private readonly reportResult: ResultHandler,
  ) {}

  attach(getApi: () => ILayoutApi | null): () => void {
    if (this.disposed) return () => {};
    if (this.binding) throw new Error("A Worksplit instance already has a mounted Layout");
    const binding = { getApi };
    this.binding = binding;
    return () => {
      if (this.binding !== binding) return;
      this.end();
      this.drops.clear();
      this.binding = undefined;
    };
  }

  create(
    getHref: () => string | undefined,
    navigate: DocumentLinkNavigator,
    options: OpenOptions,
    onResult?: ResultHandler,
  ): DocumentLink {
    const owner = {};
    const captured: OpenOptions = Object.freeze({
      ...options,
      ...(options.destination && typeof options.destination !== "function"
        ? { destination: Object.freeze({ ...options.destination }) }
        : {}),
    });
    const notify = (result: OpenResult, ownedDrop = false) => {
      try {
        if (onResult) onResult(result);
        else if (ownedDrop) this.reportResult(result);
      } catch (error) {
        this.report(error);
      }
    };
    const execute = async (
      requested: OpenOptions,
      current: () => boolean,
      ownedDrop = false,
    ): Promise<OpenResult> => {
      let result: OpenResult;
      try {
        result = this.disposed
          ? { status: "denied", reason: "not-ready" }
          : !current()
            ? { status: "superseded" }
            : await navigate(requested, () => !this.disposed && current());
      } catch (error) {
        result = {
          status: "failed",
          phase: "prepare",
          error,
          changes: "none",
          affectedIds: [],
          cleanupErrors: [],
        };
      }
      // Explicit open has a caller; an accepted native drop has no promise consumer.
      notify(result, ownedDrop);
      return result;
    };
    return Object.freeze({
      get href() {
        return getHref();
      },
      open: (overrides?: OpenOptions) =>
        execute(
          {
            ...captured,
            ...(overrides?.presentation === "background" ? { preview: false } : {}),
            ...overrides,
          } as OpenOptions,
          () => true,
        ),
      dragStart: (event: DragEvent<HTMLElement>) => {
        if (event.defaultPrevented) return;
        this.drops.delete(owner);
        const binding = this.binding;
        const api = binding?.getApi();
        if (this.disposed || !binding || !api) {
          event.preventDefault();
          return;
        }
        this.end();
        const label =
          event.currentTarget.getAttribute("aria-label") ||
          event.currentTarget.title ||
          event.currentTarget.textContent?.trim() ||
          getHref() ||
          "Open document";
        // The detached native TabNode exists only for hit testing. Public dispatch never admits it.
        const json: IJsonTabNode = {
          id: `worksplit-drag:${crypto.randomUUID()}`,
          name: label,
          component: "worksplit:document",
          enableFloat: false,
          enablePopout: false,
        };
        const pending: PendingDrag = {
          owner,
          json,
          api,
          binding,
          drag: undefined,
          notify: (result) => notify(result, true),
          drop: (destination, current) =>
            execute(
              {
                presentation: "activate",
                preview: false,
                ...captured,
                destination,
              } as OpenOptions,
              current,
              true,
            ),
        };
        this.pending = pending;
        try {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("application/x-worksplit-document-link", json.id!);
          api.setDragComponent(event.nativeEvent, label, 10, 10);
          api.addTabWithDragAndDrop(event.nativeEvent, json, () => {
            if (this.pending === pending) this.end(owner);
          });
        } catch (error) {
          this.end(owner);
          event.preventDefault();
          this.report(error);
        }
      },
      // The browser emits dragend after an accepted drop too. Only a still-pending drag is canceled.
      dragEnd: (_event: DragEvent<HTMLElement>) => this.end(owner),
    });
  }

  /** Undefined leaves an ordinary native move with the workspace's normal drop policy. */
  allowsDrop(drag: Node, target: Node, location: DockLocation, index = -1): boolean | undefined {
    const pending = this.pending;
    if (!pending || drag.getId() !== pending.json.id) return undefined;
    if (pending.drag && pending.drag !== drag) return false;
    pending.drag = drag;
    return (
      this.binding === pending.binding &&
      pending.binding.getApi() === pending.api &&
      this.isTarget(target, location) &&
      this.allowMove(drag, target, location) &&
      this.allowsAdmission(pending.json, target, location, index)
    );
  }

  /** Called exclusively from Layout's intercepted onAction, never from public dispatch. */
  consume(action: Action): boolean {
    const pending = this.pending;
    if (!pending || action.type !== Actions.ADD_TAB || action.data.json !== pending.json)
      return false;
    this.pending = undefined;
    try {
      const target = this.model.getNodeById(action.data.toNode as string);
      const location = locations.find((value) => value.getName() === action.data.location);
      const index = action.data.index as number;
      if (!Number.isInteger(index) || index < -1) {
        pending.notify({ status: "denied", reason: "invalid-argument" });
        return true;
      }
      if (
        !target ||
        !location ||
        !pending.drag ||
        !this.isTarget(target, location) ||
        !this.allowMove(pending.drag, target, location) ||
        !this.allowsAdmission(pending.json, target, location, index)
      ) {
        pending.notify({ status: "denied", reason: "layout-policy" });
        return true;
      }
      const unchanged = captureTarget(target);
      const attempt = {};
      this.drops.set(pending.owner, attempt);
      const current = () =>
        this.drops.get(pending.owner) === attempt &&
        this.binding === pending.binding &&
        pending.binding.getApi() === pending.api &&
        this.isTarget(target, location) &&
        unchanged() &&
        this.allowMove(pending.drag!, target, location) &&
        this.allowsAdmission(pending.json, target, location, index);
      void pending.drop({ target: target.getId(), location, index }, current).finally(() => {
        if (this.drops.get(pending.owner) === attempt) this.drops.delete(pending.owner);
      });
    } catch (error) {
      pending.notify({
        status: "failed",
        phase: "prepare",
        error,
        changes: "none",
        affectedIds: [],
        cleanupErrors: [],
      });
    }
    return true;
  }

  private isTarget(target: Node, location: DockLocation): boolean {
    if (this.model.getNodeById(target.getId()) !== target || !locations.includes(location))
      return false;
    if (target instanceof TabGroupNode) {
      if (location !== DockLocation.CENTER) return false;
      const container = tabContainer(target);
      return !!container && this.isTarget(container, DockLocation.CENTER);
    }
    if (target instanceof BorderNode) {
      return location === DockLocation.CENTER;
    }
    if (!(target instanceof TabSetNode)) return false;
    let root: Node = target;
    while (root.getParent()) root = root.getParent()!;
    return root === this.model.getRootRow();
  }

  private allowsAdmission(json: IJsonTabNode, target: Node, location: DockLocation, index: number) {
    return (
      this.layoutPolicy?.allowsAction(
        this.model,
        Actions.addTab(json, target.getId(), location, index, false),
      ) ?? true
    );
  }

  private end(owner?: object) {
    const pending = this.pending;
    if (!pending || (owner && pending.owner !== owner)) return;
    this.pending = undefined;
    try {
      pending.api.endDrag();
    } catch (error) {
      this.report(error);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.end();
    this.drops.clear();
    this.binding = undefined;
  }
}
