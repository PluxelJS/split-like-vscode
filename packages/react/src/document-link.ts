import {
  Actions,
  DockLocation,
  TabSetNode,
  type Action,
  type IJsonTabNode,
  type ILayoutApi,
  type Model,
  type Node,
} from "flexlayout-react";
import type { DragEvent } from "react";

import type { NavigationResult, OpenDocumentOptions, WorkbenchDocument } from "./integration";
import type { WorkbenchLayoutPolicy } from "./layout-policy";

/** The same routed destination for a normal activation and an explicit drag handle. */
export interface DocumentLink {
  /** Deferred destinations have no URL until their resolver has completed. */
  readonly href: string | undefined;
  readonly options: Readonly<OpenDocumentOptions>;
  open(overrides?: OpenDocumentOptions): Promise<NavigationResult>;
  /** Bind only to an explicit draggable handle; keep the readable text selectable. */
  dragStart(event: DragEvent<HTMLElement>): void;
  dragEnd(): void;
}

export type DocumentLinkResultHandler = (result: NavigationResult) => void;
export type DocumentLinkNavigator = (
  options: OpenDocumentOptions,
  current: () => boolean,
) => Promise<NavigationResult>;

const locations = [
  DockLocation.CENTER,
  DockLocation.LEFT,
  DockLocation.RIGHT,
  DockLocation.TOP,
  DockLocation.BOTTOM,
];
type PendingDrag = {
  owner: object;
  json: IJsonTabNode;
  api: ILayoutApi;
  open: (options: OpenDocumentOptions) => Promise<NavigationResult>;
  notify: DocumentLinkResultHandler;
};

/** Per-workbench bridge: native hit testing, followed by ordinary routed admission. */
export class DocumentLinkController {
  private binding: { getApi: () => ILayoutApi | null } | undefined;
  private pending: PendingDrag | undefined;
  private disposed = false;

  constructor(
    private readonly model: Model,
    private readonly allowMove: (drag: Node, target: Node, location: DockLocation) => boolean,
    private readonly layoutPolicy: WorkbenchLayoutPolicy | undefined,
    private readonly keep: (id: string) => WorkbenchDocument | null,
    private readonly report: (error: unknown) => void,
  ) {}

  attach(getApi: () => ILayoutApi | null): () => void {
    if (this.disposed) return () => {};
    if (this.binding) throw new Error("A Worksplit instance already has a mounted Layout");
    const binding = { getApi };
    this.binding = binding;
    return () => {
      if (this.binding !== binding) return;
      this.end();
      this.binding = undefined;
    };
  }

  create(
    getHref: () => string | undefined,
    navigate: DocumentLinkNavigator,
    options: OpenDocumentOptions,
    onResult?: DocumentLinkResultHandler,
  ): DocumentLink {
    const owner = {};
    const captured = Object.freeze({
      ...options,
      ...(options.placement ? { placement: Object.freeze({ ...options.placement }) } : {}),
    });
    const notify = (result: NavigationResult) => {
      try {
        onResult?.(result);
      } catch (error) {
        this.report(error);
      }
    };
    const execute = async (
      overrides: OpenDocumentOptions = {},
      dropped = false,
      binding = this.binding,
    ): Promise<NavigationResult> => {
      let result: NavigationResult;
      try {
        if (this.disposed) result = { status: "rejected", reason: "closed" };
        else {
          const requested = { ...captured, ...overrides };
          if (dropped) {
            delete requested.placement;
            requested.preview = false;
            requested.preserveFocus = false;
            requested.background = false;
          }
          result = await navigate(
            requested,
            () => !this.disposed && (!dropped || this.binding === binding),
          );
          if (dropped && result.status === "committed") {
            const document = this.keep(result.document.id);
            if (document) result = { ...result, document };
          }
        }
      } catch (error) {
        result = { status: "failed", stage: "load", error };
      }
      notify(result);
      return result;
    };
    return Object.freeze({
      get href() {
        return getHref();
      },
      options: captured,
      open: (overrides?: OpenDocumentOptions) => execute(overrides),
      dragStart: (event: DragEvent<HTMLElement>) => {
        if (event.defaultPrevented) return;
        const binding = this.binding;
        const api = binding?.getApi();
        if (this.disposed || !api) {
          event.preventDefault();
          notify({ status: "rejected", reason: "closed" });
          return;
        }
        this.end();
        const label =
          event.currentTarget.closest("[aria-label]")?.getAttribute("aria-label") ||
          event.currentTarget.title ||
          event.currentTarget.parentElement?.textContent?.trim() ||
          getHref() ||
          "Open document";
        // Native add-drag uses a detached TabNode for hit testing. This JSON is never
        // admitted by dispatch; only the exact active descriptor can request open().
        const json: IJsonTabNode = {
          id: `worksplit-drag:${crypto.randomUUID()}`,
          name: label,
          component: "worksplit.document",
          config: getHref() ? { href: getHref() } : {},
          enableFloat: false,
          enablePopout: false,
        };
        const pending: PendingDrag = {
          owner,
          json,
          api,
          open: (placement) => execute(placement, true, binding),
          notify,
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
          notify({ status: "failed", stage: "load", error });
        }
      },
      dragEnd: () => this.end(owner),
    });
  }

  /** Undefined means this is an ordinary native move, owned by the existing policy. */
  allowsDrop(drag: Node, target: Node, location: DockLocation): boolean | undefined {
    const pending = this.pending;
    if (!pending || drag.getId() !== pending.json.id) return undefined;
    return (
      this.isTarget(target, location) &&
      this.allowMove(drag, target, location) &&
      this.allowsAdmission(pending.json, target, location)
    );
  }

  /** Called only by Layout's private onAction bridge, never by public dispatch. */
  consume(action: Action): boolean {
    const pending = this.pending;
    if (!pending || action.type !== Actions.ADD_TAB || action.data.json !== pending.json)
      return false;
    this.pending = undefined;
    try {
      const target = this.model.getNodeById(action.data.toNode as string);
      const location = locations.find((value) => value.getName() === action.data.location);
      if (
        !target ||
        !location ||
        !this.isTarget(target, location) ||
        !this.allowsAdmission(pending.json, target, location)
      ) {
        pending.notify({ status: "rejected", reason: "layout-policy" });
        return true;
      }
      void pending.open({ target: target.getId(), location });
    } catch (error) {
      pending.notify({ status: "failed", stage: "load", error });
    }
    return true;
  }

  private isTarget(target: Node, location: DockLocation): target is TabSetNode {
    if (
      !(target instanceof TabSetNode) ||
      this.model.getNodeById(target.getId()) !== target ||
      !locations.includes(location)
    )
      return false;
    let root: Node = target;
    while (root.getParent()) root = root.getParent()!;
    return root === this.model.getRootRow();
  }

  private allowsAdmission(json: IJsonTabNode, target: Node, location: DockLocation) {
    return (
      this.layoutPolicy?.allowsAction(
        this.model,
        Actions.addTab(json, target.getId(), location, -1, false),
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

  dispose() {
    this.disposed = true;
    this.end();
    this.binding = undefined;
  }
}
