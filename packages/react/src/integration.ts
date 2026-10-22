import type { RegisterableHotkey } from "@tanstack/react-hotkeys";
import {
  createMemoryHistory,
  type AnyRouter,
  type NavigateOptions,
  type RouterHistory,
} from "@tanstack/react-router";
import { createStore } from "@tanstack/react-store";
import {
  Actions,
  BorderNode,
  DockLocation,
  Model,
  RowNode,
  TabGroupNode,
  TabNode,
  TabSetNode,
  type Action,
  type IJsonModel,
  type IJsonTabNode,
  type Node,
} from "flexlayout-react";
import type { ReactNode } from "react";

import { BrowserHistoryCoordinator } from "./browser-history";
import { createDocumentHistory, navigateDocument } from "./document-history";
import type { WorkbenchLayoutPolicy } from "./layout-policy";
import { actionsIn, closedGroup, revealTab, tabContainer, tabsIn } from "./native-layout";

export interface WorkbenchRouteMetadata {
  title?: string;
  navigationKey?: string;
  /** Search fields that change document identity. Arrays retain their order. */
  identitySearch?: readonly string[];
}
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    worksplit?: WorkbenchRouteMetadata;
  }
}

export interface WorkbenchDocument {
  readonly id: string;
  readonly href: string;
  /** Current native TabSet or Border; TabGroups do not create another container. */
  readonly containerId: string;
  readonly title: string;
  /** Replaceable workspace preview; independent of native pinned/closeable state. */
  readonly preview: boolean;
  readonly navigationKey: string | null;
}
export interface WorkbenchEditingContext {
  activeGroupId: string | null;
  activeTabId: string | null;
  focusedArea: "document" | "tool" | "shell" | null;
  focusedTabId: string | null;
  windowFocused: boolean;
}
export interface WorkbenchState {
  readonly activeDocumentId: string | null;
  /** Invalidates read-only layout/catalog queries; it is not another layout tree. */
  readonly revision: number;
  readonly focusedTabId: string | null;
  readonly focusedArea: WorkbenchEditingContext["focusedArea"];
  readonly windowFocused: boolean;
}
export type NavigationResult =
  | { status: "committed"; document: WorkbenchDocument; reused: boolean }
  | {
      status: "rejected";
      reason:
        | "decision"
        | "closed"
        | "history-busy"
        | "router-blocked"
        | "layout-policy"
        | "focus-conflict";
    }
  | { status: "superseded" }
  | { status: "failed"; stage: "load" | "navigate"; error: unknown };
/** Startup can accept a document-free home without manufacturing a route document. */
export type StartResult = NavigationResult | { status: "empty"; href: string };
export type CloseResult =
  | { status: "closed"; id: string; cleanupErrors: readonly unknown[] }
  | {
      status: "rejected";
      reason: "decision" | "changed" | "closing" | "not-closeable" | "revision-required";
    }
  | { status: "superseded" }
  | { status: "failed"; error: unknown };
export interface WorkbenchLeaveContext {
  id: string;
  from?: string;
  to?: string;
  /** A host traversal may be superseded while its close confirmation is open. */
  signal?: AbortSignal;
}
export interface WorkbenchContentLifecycle {
  isDirty?: () => boolean;
  /** Existing application editing revision. Dirty multi-content close requires this token. */
  getCloseRevision?: () => string | number;
  /** The application must recheck its editing revision/save receipt before approving. */
  beforeLeave?: (
    reason: "close" | "navigate",
    context: WorkbenchLeaveContext,
  ) => boolean | Promise<boolean>;
  focus?: () => void;
  save?: () => void | Promise<void>;
  dispose?: () => void | Promise<void>;
}
export interface WorkbenchTool {
  id: string;
  render: (context: { id: string }) => ReactNode;
}
export interface WorkbenchCommand {
  id: string;
  target: "document" | "focused";
  hotkey?: RegisterableHotkey;
  /** Inputs are ignored by default. Set false for an intentional editor command. */
  ignoreInputs?: boolean;
  execute: (target: { id: string; document: WorkbenchDocument | null }) => void | Promise<void>;
}
export interface WorkbenchSnapshot {
  version: 1;
  workspaceId: string;
  layout: IJsonModel;
}
export interface WorkbenchOptions<TRouter extends AnyRouter> {
  createRouter: (history: RouterHistory) => TRouter;
  layout?: IJsonModel;
  tools?: readonly WorkbenchTool[];
  /** Pure resolver for non-static tool tabs during restore and native ADD_TAB validation.
   * Return undefined for unknown/invalid definitions. Returned id must equal tab.id.
   * Receives detached JSON; may run more than once without committing a tool.
   */
  resolveTool?: (tab: Readonly<IJsonTabNode>) => WorkbenchTool | undefined;
  commands?: readonly WorkbenchCommand[];
  home?: string;
  /** Empty applies only to start(home) and owned home history anchors; open remains routed. */
  homeMode?: "route" | "empty";
  workspaceId?: string;
  snapshot?: unknown;
  /** Optional native topology limits, checked before new document admission. */
  layoutPolicy?: WorkbenchLayoutPolicy;
  /** Trusted native policy callback; do not mutate the supplied nodes or their Model. */
  allowDrop?: (tabs: readonly TabNode[], target: Node, location: DockLocation) => boolean;
  onIssue?: (issue: {
    code: "operation-failed" | "native-identity-conflict" | "history" | "history-outside-scope";
    id?: string;
    error: unknown;
  }) => void;
}
export interface OpenDocumentOptions {
  /** Native TabSet/Border target, captured at invocation and revalidated before admission. */
  target?: string;
  /** New admission only; defaults to CENTER. Edge locations require a central TabSet. */
  location?: DockLocation;
  /** Reveal a separate pane while retaining the active document, URL and DOM focus. */
  preserveFocus?: boolean;
  newInstance?: boolean;
  background?: boolean;
  /** Reveal a matching document with its existing location. Default honors the requested URL. */
  reuse?: "navigate" | "preserve";
  /** One replaceable preview per workspace. Explicit copies are always ordinary documents. */
  preview?: boolean;
}

type DocumentSession = {
  id: string;
  href: string;
  router?: AnyRouter | undefined;
  identity?: string | undefined;
  multi: boolean;
  preview: boolean;
  operation: number;
  contentVersion: number;
  lifecycle?: WorkbenchContentLifecycle | undefined;
  release: (() => void)[];
};
class FocusConflict extends Error {}
type OpenPresentation = {
  focus: number;
  background: boolean;
  preserve: DocumentSession | undefined;
  focusedContent: Node | undefined;
  replace: boolean;
  fromPop: boolean;
};
type Internal = {
  model: Model;
  documents: Map<string, DocumentSession>;
  store: ReturnType<typeof createStore<WorkbenchState>>;
  tools: Map<string, WorkbenchTool>;
  commands: readonly WorkbenchCommand[];
  loadDocument: (id: string) => Promise<void>;
  register: (id: string, lifecycle: WorkbenchContentLifecycle, expectedNode?: Node) => () => void;
  focus: (id: string | null, area: WorkbenchState["focusedArea"]) => void;
  setWindowFocus: (focused: boolean) => void;
  modelAction: (action: Action) => undefined;
  report: (error: unknown) => void;
};
type CloseActionResult = CloseResult | { status: "applied" };
type CloseScope = {
  node: TabNode | TabSetNode;
  members: readonly TabNode[];
  closing: readonly TabNode[];
};
function sameMembers(before: readonly TabNode[], after: readonly TabNode[]) {
  const expected = new Set(before);
  return expected.size === after.length && after.every((tab) => expected.has(tab));
}
const instances = new WeakMap<object, Internal>();
export function integrationState(instance: object): Internal {
  const state = instances.get(instance);
  if (!state) throw new Error("Unknown Worksplit instance");
  return state;
}

const DOCUMENT_COMPONENT = "worksplit.document";
const TOOL_COMPONENT = "worksplit.tool";
export const defaultWorkbenchLayout = (): IJsonModel => ({
  global: {
    tabEnableFloat: false,
    tabEnablePopout: false,
    tabEnablePin: true,
    tabSetEnableTabGroups: true,
  },
  borders: [],
  layout: { type: "row", children: [] },
});

/** One owner for the native Model and document Router lifetimes. */
export class WorkbenchInstance<TRouter extends AnyRouter> {
  private readonly state: Internal;
  private readonly resolver: TRouter;
  private browser: BrowserHistoryCoordinator | undefined;
  private disposed = false;
  private focusEpoch = 0;
  private pendingFocus:
    | { id: string; epoch: number; node: TabNode; cancel?: () => void }
    | undefined;
  private openEpoch = 0;
  private nextId = 0;
  private readonly instancePrefix = Array.from(
    crypto.getRandomValues(new Uint32Array(4)),
    (value) => value.toString(16).padStart(8, "0"),
  ).join("");
  private selecting = false;
  private restoringFocus = false;
  private readonly mru: string[] = [];
  private readonly modelListener: (action: Action) => void;
  private readonly pending = new Set<AnyRouter>();
  private readonly closing = new Map<
    string,
    { key: string; promise: Promise<CloseActionResult>; signal?: AbortSignal }
  >();
  private disposePromise: Promise<readonly unknown[]> | undefined;

  constructor(private readonly options: WorkbenchOptions<TRouter>) {
    const layout =
      options.snapshot === undefined
        ? structuredClone(options.layout ?? defaultWorkbenchLayout())
        : this.validateSnapshot(options.snapshot);
    this.validateLayout(layout, options.snapshot !== undefined);
    const model = Model.fromJson(layout);
    const documents = new Map<string, DocumentSession>();
    const tools = new Map((options.tools ?? []).map((tool) => [tool.id, tool]));
    if (tools.size !== (options.tools?.length ?? 0)) throw new Error("Duplicate Worksplit tool id");
    this.state = {
      model,
      documents,
      tools,
      commands: options.commands ?? [],
      store: createStore<WorkbenchState>({
        activeDocumentId: null,
        revision: 0,
        focusedTabId: null,
        focusedArea: null,
        windowFocused: typeof document !== "undefined" && document.hasFocus(),
      }),
      loadDocument: (id) => this.loadDocument(id),
      register: (id, lifecycle, expectedNode) => this.register(id, lifecycle, expectedNode),
      focus: (id, area) => this.observeFocus(id, area),
      setWindowFocus: (windowFocused) => {
        if (!windowFocused) this.cancelContentFocus();
        this.state.store.setState((s) => ({
          ...s,
          windowFocused,
          ...(!windowFocused ? { focusedArea: null } : {}),
        }));
      },
      modelAction: (action) => {
        void this.dispatch(action).catch((error: unknown) => this.issue("operation-failed", error));
        return undefined;
      },
      report: (error) => this.issue("operation-failed", error),
    };
    instances.set(this, this.state);
    model.visitNodes((node) => {
      if (!(node instanceof TabNode)) return;
      if (node.isEnableFloat() || node.isEnablePopout())
        throw new Error(`Disable unsupported popouts at ${node.getId()}`);
      if (node.getComponent() === DOCUMENT_COMPONENT) {
        if (tools.has(node.getId()))
          throw new Error(`Worksplit tool id ${node.getId()} conflicts with a document identity`);
        const config: unknown = node.getConfig();
        if (
          !config ||
          typeof config !== "object" ||
          typeof (config as Record<string, unknown>).href !== "string"
        )
          throw new Error(`Document ${node.getId()} requires config.href`);
        const href = (config as { href: string }).href;
        this.checkHref(href);
        documents.set(node.getId(), {
          id: node.getId(),
          href,
          multi: (config as Record<string, unknown>).multi === true,
          preview: (config as Record<string, unknown>).preview === true && !node.isPinned(),
          operation: 0,
          contentVersion: 0,
          release: [],
        });
      } else {
        const tool =
          node.getComponent() === TOOL_COMPONENT ? this.resolveTool(node.toJson()) : undefined;
        if (!tool)
          throw new Error(`Unknown Worksplit content: ${node.getId()} (${node.getComponent()})`);
        tools.set(node.getId(), tool);
      }
    });
    if ([...documents.values()].filter((session) => session.preview).length > 1)
      throw new Error("A workspace snapshot may contain only one preview");
    if (options.layoutPolicy && !options.layoutPolicy.allows(model))
      throw new Error("Snapshot violates layout policy; explicitly convert it before restoring");
    model.setOnAllowDrop(
      (drag, drop) =>
        this.allowMove(drag, drop.node, drop.location) &&
        (options.layoutPolicy?.allowsDrop(model, drag, drop.node, drop.location, drop.index) ??
          true),
    );
    if (options.allowDrop) {
      model.visitNodes((node) => {
        if (
          node instanceof TabNode &&
          node.getParent() &&
          !this.allowMove(node, node.getParent()!, DockLocation.CENTER)
        )
          throw new Error(`Snapshot violates docking policy at ${node.getId()}`);
        if (
          node instanceof TabGroupNode &&
          node.getParent() &&
          !this.allowMove(node, node.getParent()!, DockLocation.CENTER)
        )
          throw new Error(`Snapshot violates group docking policy at ${node.getId()}`);
      });
    }
    this.resolver = options.createRouter(
      createMemoryHistory({ initialEntries: [options.home ?? "/"] }),
    );
    this.modelListener = (action) => {
      this.changed();
      const id =
        typeof action.data.tabNode === "string"
          ? action.data.tabNode
          : typeof action.data.node === "string"
            ? action.data.node
            : undefined;
      if (
        !this.selecting &&
        action.type === Actions.SELECT_TAB &&
        id &&
        documents.has(id) &&
        (model.getNodeById(id) as TabNode).isSelected()
      )
        this.activate(id, { focus: false });
      if (!this.selecting && action.type === Actions.SET_ACTIVE_TABSET)
        this.activateSelected(model.getActiveTabset());
    };
    model.addChangeListener(this.modelListener);
  }

  /** Type inference follows the application's TanStack route tree. */
  open<const TFrom extends string = string, const TTo extends string | undefined = ".">(
    navigation: NavigateOptions<TRouter, TFrom, TTo>,
    options: OpenDocumentOptions = {},
  ): Promise<NavigationResult> {
    const location = this.resolver.buildLocation(
      navigation as Parameters<AnyRouter["buildLocation"]>[0],
    );
    return this.openHref(location.publicHref, options, !!navigation.replace);
  }

  /** Copy committed view conditions, never a draft, into a new ordinary document lifetime. */
  duplicate(
    id: string,
    options: Pick<OpenDocumentOptions, "target" | "background" | "location" | "preserveFocus"> = {},
  ): Promise<NavigationResult> {
    const session = this.state.documents.get(id);
    if (!session || this.disposed) return Promise.resolve({ status: "rejected", reason: "closed" });
    return this.openHref(session.href, { ...options, newInstance: true }, false);
  }

  getDocument(id: string): WorkbenchDocument | null {
    const session = this.state.documents.get(id);
    if (!session) return null;
    const metadata = [...(session.router?.state.matches ?? [])]
      .toReversed()
      .find((m) => m.staticData?.worksplit)?.staticData.worksplit;
    return {
      id,
      href: session.href,
      containerId: tabContainer(this.state.model.getNodeById(id))!.getId(),
      title: (this.state.model.getNodeById(id) as TabNode).getName(),
      preview: session.preview,
      navigationKey: metadata?.navigationKey ?? null,
    };
  }
  /** Keep a preview as an ordinary, still-closeable document. Does not pin the native tab. */
  keep(id: string): void {
    const session = this.state.documents.get(id);
    if (!session?.preview || this.disposed) return;
    session.preview = false;
    this.changed();
  }
  getDocuments(): readonly WorkbenchDocument[] {
    return [...this.state.documents.keys()].map((id) => this.getDocument(id)!);
  }
  getActiveDocument(): WorkbenchDocument | null {
    const id = this.state.store.get().activeDocumentId;
    return id ? this.getDocument(id) : null;
  }
  getEditingContext(): WorkbenchEditingContext {
    const s = this.state.store.get();
    const node = s.activeDocumentId ? this.state.model.getNodeById(s.activeDocumentId) : undefined;
    return {
      activeGroupId: tabContainer(node)?.getId() ?? null,
      activeTabId: s.activeDocumentId,
      focusedArea: s.focusedArea,
      focusedTabId: s.focusedTabId,
      windowFocused: s.windowFocused,
    };
  }
  /** Returns detached native FlexLayout JSON. */
  getLayout(): IJsonModel {
    return structuredClone(this.state.model.toJson());
  }

  /** Reveal existing document/tool content; false means missing or disposed. Tools preserve the document URL. */
  activate(id: string, options: { focus?: boolean; history?: boolean } = {}): boolean {
    const session = this.state.documents.get(id);
    if (this.disposed || (!session && !this.state.tools.has(id))) return false;
    const node = this.state.model.getNodeById(id);
    if (!(node instanceof TabNode)) return false;
    const selecting = this.selecting;
    this.selecting = true;
    try {
      const group = revealTab(this.state.model, node);
      const maximized = this.state.model.getMaximizedTabset();
      // Selecting an obscured tab does not reveal it in FlexLayout. Follow the explicit
      // document target while retaining the user's maximized workspace mode.
      if (group instanceof TabSetNode && maximized && maximized !== group)
        this.state.model.doAction(Actions.maximizeToggle(group.getId()));
      if (group instanceof TabSetNode && this.state.model.getActiveTabset() !== group)
        this.state.model.doAction(Actions.setActiveTabset(group.getId()));
    } finally {
      this.selecting = selecting;
    }
    this.cancelContentFocus();
    if (session) {
      if (this.state.store.get().activeDocumentId !== id)
        this.state.store.setState((s) => ({ ...s, activeDocumentId: id }));
      this.remember(id);
      if (session.router && options.history !== false)
        this.browser?.publish(session.href, id, true);
      void this.loadDocument(id).catch((error: unknown) =>
        this.issue("operation-failed", error, id),
      );
    }
    if (options.focus !== false) {
      this.pendingFocus = { id, epoch: this.focusEpoch, node };
      this.restoreContentFocus(id);
    }
    return true;
  }

  async close(
    id: string,
    options: { history?: boolean; signal?: AbortSignal } = {},
  ): Promise<CloseResult> {
    if (
      this.disposed ||
      !(this.state.model.getNodeById(id) instanceof TabNode) ||
      (!this.state.documents.has(id) && !this.state.tools.has(id))
    )
      return { status: "superseded" };
    return this.closeAction(
      Actions.deleteTab(id),
      options.history !== false,
      options.signal,
    ) as Promise<CloseResult>;
  }

  /** Synchronous eligibility only. Close still makes asynchronous content decisions. */
  canDispatch(action: Action): boolean {
    if (this.disposed) return false;
    const actions = actionsIn(action);
    if (actions.length === 0) return false;
    const removals = actions.filter(
      (a) => a.type === Actions.DELETE_TAB || a.type === Actions.DELETE_TABSET,
    );
    if (removals.length > 0)
      return (
        removals.length === actions.length &&
        removals.every((a) => {
          const node = this.state.model.getNodeById(a.data.node as string);
          return a.type === Actions.DELETE_TAB
            ? node instanceof TabNode && node.isCloseable()
            : node instanceof TabSetNode && node.isEnableClose();
        })
      );
    if (actions.length !== 1 && actions.some((a) => a.type === Actions.ADD_TAB)) return false;
    if (
      this.options.allowDrop &&
      actions.length > 1 &&
      actions.some((a) =>
        [
          Actions.MOVE_NODE,
          Actions.ADD_TAB_TO_NEW_GROUP,
          Actions.UNGROUP,
          Actions.REMOVE_TAB_FROM_GROUP,
        ].includes(a.type),
      )
    )
      return false;
    return (
      actions.every((a) => this.allowLayoutAction(a)) &&
      (this.options.layoutPolicy?.allowsAction(this.state.model, action) ?? true)
    );
  }

  /** Close actions may preserve the current browser entry when handing off to the host. */
  async dispatch(
    action: Action,
    options: { history?: boolean; signal?: AbortSignal } = {},
  ): Promise<CloseResult | { status: "applied" | "rejected" }> {
    if (this.disposed) return { status: "rejected" };
    const actions = actionsIn(action);
    const removals = actions.filter(
      (a) => a.type === Actions.DELETE_TAB || a.type === Actions.DELETE_TABSET,
    );
    if (removals.length > 0)
      return removals.length === actions.length
        ? this.closeAction(action, options.history !== false, options.signal)
        : { status: "rejected" };
    if (!this.canDispatch(action)) return { status: "rejected" };
    return { status: this.applyLayoutAction(action, actions) ? "applied" : "rejected" };
  }

  private resolveTool(tab: IJsonTabNode): WorkbenchTool | undefined {
    const predefined = this.options.tools?.find((tool) => tool.id === tab.id);
    if (predefined) return predefined;
    const tool = this.options.resolveTool?.(structuredClone(tab));
    if (tool && (tool.id !== tab.id || typeof tool.render !== "function"))
      throw new Error(`Resolved Worksplit tool must render its declared id ${tab.id}`);
    return tool;
  }

  private allowToolAdmission(action: Action): boolean {
    const model = this.state.model;
    const json = action.data.json as Record<string, unknown>;
    if (
      !json ||
      typeof json !== "object" ||
      Array.isArray(json) ||
      typeof json.id !== "string" ||
      !json.id ||
      this.state.documents.has(json.id) ||
      model.getNodeById(json.id) ||
      this.closing.has(json.id) ||
      (json.type !== undefined && json.type !== TabNode.TYPE) ||
      json.component !== TOOL_COMPONENT ||
      json.children !== undefined ||
      json.subLayoutId !== undefined ||
      ["enableFloat", "enablePopout"].some((key) => json[key] !== undefined && json[key] !== false)
    )
      return false;
    if (!this.resolveTool(json as IJsonTabNode)) return false;
    const target = model.getNodeById(action.data.toNode as string);
    if (
      !(
        target instanceof TabSetNode ||
        target instanceof BorderNode ||
        target instanceof TabGroupNode ||
        target instanceof RowNode
      ) ||
      ![
        DockLocation.CENTER,
        DockLocation.LEFT,
        DockLocation.RIGHT,
        DockLocation.TOP,
        DockLocation.BOTTOM,
      ].some((location) => location.getName() === action.data.location)
    )
      return false;
    let live = false;
    model.visitNodes((node) => {
      if (node === target) live = true;
    });
    if (!live) return false;
    if (this.options.allowDrop) {
      // Validate a detached candidate before publishing insertion or mounting resources.
      const candidate = Model.fromJson(model.toJson());
      candidate.doAction(action);
      const tab = candidate.getNodeById(json.id);
      const destination = candidate.getNodeById(target.getId());
      const location = [
        DockLocation.CENTER,
        DockLocation.LEFT,
        DockLocation.RIGHT,
        DockLocation.TOP,
        DockLocation.BOTTOM,
      ].find((entry) => entry.getName() === action.data.location)!;
      if (!(tab instanceof TabNode) || !destination || !this.allowMove(tab, destination, location))
        return false;
    }
    return true;
  }

  private allowLayoutAction(action: Action): boolean {
    const model = this.state.model;
    const data = action.data;
    switch (action.type) {
      case Actions.ADD_TAB:
        return this.allowToolAdmission(action);
      case Actions.MOVE_NODE: {
        const from = model.getNodeById(data.fromNode as string);
        const to = model.getNodeById(data.toNode as string);
        const location = [
          DockLocation.CENTER,
          DockLocation.LEFT,
          DockLocation.RIGHT,
          DockLocation.TOP,
          DockLocation.BOTTOM,
        ].find((candidate) => candidate.getName() === data.location);
        return !!from && !!to && !!location && this.allowMove(from, to, location);
      }
      case Actions.ADD_TAB_TO_NEW_GROUP:
      case Actions.REMOVE_TAB_FROM_GROUP:
      case Actions.UNGROUP: {
        const node = model.getNodeById(data.node as string);
        if (!node) return false;
        const target = action.type === Actions.UNGROUP ? node.getParent() : tabContainer(node);
        return !!target && this.allowMove(node, target, DockLocation.CENTER);
      }
      case Actions.UPDATE_NODE_ATTRIBUTES: {
        const node = model.getNodeById(data.node as string);
        const json = data.json as Record<string, unknown>;
        if (!node || !json || typeof json !== "object" || Array.isArray(json)) return false;
        // Preserve native display/layout attributes. Identity and document session configuration
        // belong to the coordinator; floating/sub-layout content has a different lifetime owner.
        if (["id", "type", "component", "subLayoutId", "children"].some((key) => key in json))
          return false;
        if (
          node instanceof TabNode &&
          "config" in json &&
          (this.state.documents.has(node.getId()) ||
            (this.state.tools.has(node.getId()) &&
              !this.options.tools?.some((tool) => tool.id === node.getId())))
        )
          return false;
        return !["enableFloat", "enablePopout"].some(
          (key) => key in json && json[key] !== false && json[key] !== undefined,
        );
      }
      case Actions.UPDATE_MODEL_ATTRIBUTES: {
        const json = data.json as Record<string, unknown>;
        return (
          !!json &&
          typeof json === "object" &&
          !Array.isArray(json) &&
          !["tabEnableFloat", "tabEnablePopout"].some(
            (key) => key in json && json[key] !== false && json[key] !== undefined,
          )
        );
      }
      case Actions.RENAME_TAB:
      case Actions.SELECT_TAB:
      case Actions.SET_ACTIVE_TABSET:
      case Actions.SET_TAB_PINNED:
      case Actions.ADJUST_WEIGHTS:
      case Actions.ADJUST_BORDER_SPLIT:
      case Actions.MAXIMIZE_TOGGLE:
      case Actions.SET_BORDER_TYPE:
        return true;
      default:
        return false;
    }
  }

  private activateSelected(container: TabSetNode | BorderNode | undefined) {
    const selected = container?.getSelectedNode();
    if (selected && this.state.documents.has(selected.getId()))
      this.activate(selected.getId(), { focus: false });
  }

  private applyLayoutAction(action: Action, actions: readonly Action[]): boolean {
    const model = this.state.model;
    // A batch with one leaf has the same selection/move meaning as that native Action.
    // Execute the original batch so native notifications and observers retain its identity.
    const operation = actions.length === 1 ? actions[0]! : action;
    const admittedTool =
      operation.type === Actions.ADD_TAB
        ? this.resolveTool(operation.data.json as IJsonTabNode)
        : undefined;
    if (operation.type === Actions.ADD_TAB && !admittedTool) return false;
    const activeSet = model.getActiveTabset();
    const previousSet = activeSet?.getId();
    const previousSelected = activeSet?.getSelectedNode()?.getId();
    const activeId = this.state.store.get().activeDocumentId;
    const current = activeId ? model.getNodeById(activeId) : undefined;
    let movesActive = false;
    if (operation.type === Actions.MOVE_NODE) {
      let ancestor = current;
      while (ancestor) {
        if (ancestor.getId() === operation.data.fromNode) {
          movesActive = true;
          break;
        }
        ancestor = ancestor.getParent();
      }
    }
    const container = tabContainer(current);
    const selectedHere = container?.getSelectedNode()?.getId();
    const selecting = this.selecting;
    this.selecting = true;
    if (admittedTool) this.state.tools.set(admittedTool.id, admittedTool);
    try {
      model.doAction(action);
    } finally {
      this.selecting = selecting;
      if (
        admittedTool &&
        !model.getNodeById(admittedTool.id) &&
        !this.options.tools?.some((tool) => tool.id === admittedTool.id)
      )
        this.state.tools.delete(admittedTool.id);
    }
    // Native ADD_TAB can return a detached node when a destination ignores insertion (e.g.
    // a pinned tab into a TabGroup). updateIdMap has now rebuilt from the actual native tree.
    if (
      operation.type === Actions.ADD_TAB &&
      !(model.getNodeById((operation.data.json as { id: string }).id) instanceof TabNode)
    )
      return false;
    for (const session of this.state.documents.values()) {
      const node = model.getNodeById(session.id);
      if (session.preview && node instanceof TabNode && node.isPinned()) this.keep(session.id);
    }
    if (selecting) return true;
    // Native selection cancels pending foreground work, including queued content focus.
    if (
      actions.some(
        (a) =>
          a.type === Actions.SET_ACTIVE_TABSET ||
          a.type === Actions.MOVE_NODE ||
          (a.type === Actions.SELECT_TAB &&
            model.getNodeById(a.data.tabNode as string) instanceof TabNode),
      )
    )
      this.cancelContentFocus();
    // A single native selection owns only that tab. Selecting a tool or collapsing a Border
    // must not reactivate an unrelated central document or steal the native strip's focus.
    if (operation.type === Actions.SELECT_TAB) {
      const selected = model.getNodeById(operation.data.tabNode as string);
      if (selected instanceof TabNode && selected.isSelected()) {
        if (this.state.documents.has(selected.getId()))
          this.activate(selected.getId(), { focus: false });
      }
      return true;
    }
    // Moving an active document that stays selected changes its placement, not its identity
    // or URL. Native source selection repair is not another foreground navigation request.
    if (movesActive && current instanceof TabNode && current.isSelected()) return true;
    // Native batches notify only once. Derive their final central selection without replaying
    // the pipeline. A Border/tool-only selection must not activate an unrelated central tab.
    const explicit = actions.some(
      (a) =>
        a.type === Actions.SET_ACTIVE_TABSET ||
        (a.type === Actions.SELECT_TAB &&
          this.state.documents.has(a.data.tabNode as string) &&
          tabContainer(model.getNodeById(a.data.tabNode as string)) instanceof TabSetNode),
    );
    const finalSet = model.getActiveTabset();
    const centralChanged =
      previousSet !== finalSet?.getId() ||
      previousSelected !== finalSet?.getSelectedNode()?.getId();
    if (centralChanged || explicit) {
      this.activateSelected(finalSet);
    } else if (
      selectedHere === activeId &&
      container?.getSelectedNode()?.getId() !== selectedHere
    ) {
      this.activateSelected(container);
    }
    return true;
  }

  async executeCommand(id: string, options: { contentId?: string } = {}) {
    const command = this.state.commands.find((c) => c.id === id);
    if (this.disposed) return;
    if (!command) throw new Error(`Unknown Worksplit command: ${id}`);
    const s = this.state.store.get();
    const target =
      command.target === "document" ? s.activeDocumentId : (options.contentId ?? s.focusedTabId);
    if (
      target &&
      (this.state.documents.has(target) ||
        (this.state.tools.has(target) && this.state.model.getNodeById(target)))
    )
      await command.execute({ id: target, document: this.getDocument(target) });
  }
  async save(id: string) {
    const session = this.state.documents.get(id);
    if (session && !this.disposed) await session.lifecycle?.save?.();
  }

  /** Explicitly attach to a browser workspace; returns the listener cleanup. */
  connectBrowser(
    options: {
      window?: Window;
      beforeOutsideScope?: (
        href: string,
        context: { signal: AbortSignal },
      ) => boolean | Promise<boolean>;
    } = {},
  ) {
    if (this.disposed) throw new Error("This Worksplit instance is disposed");
    if (this.browser) throw new Error("This Worksplit instance already owns browser history");
    const win = options.window ?? window;
    this.browser = new BrowserHistoryCoordinator(
      win,
      this.options.workspaceId ?? "default",
      async (href, hint, current) => {
        const session = hint ? this.state.documents.get(hint) : undefined;
        const result = session
          ? await this.navigateSession(session, href, false, current, true)
          : this.isEmptyHome(href)
            ? await this.startHome(current, true)
            : await this.openHref(href, {}, false, current, true);
        return result.status === "committed"
          ? { id: result.document.id, href: result.document.href }
          : result.status === "empty"
            ? { href: result.href }
            : undefined;
      },
      (error, outside) => this.issue(outside ? "history-outside-scope" : "history", error),
      options.beforeOutsideScope,
    );
    const browser = this.browser;
    return () => {
      browser.dispose();
      if (this.browser === browser) this.browser = undefined;
    };
  }

  /** Start from the address bar. Native render-on-demand defaults keep restored background tabs lazy. */
  start(href: string): Promise<StartResult> {
    return this.isEmptyHome(href) ? this.startHome() : this.openHref(href, {}, true);
  }

  private isEmptyHome(href: string) {
    return this.options.homeMode === "empty" && href === (this.options.home ?? "/");
  }

  private async startHome(
    current: () => boolean = () => true,
    fromPop = false,
  ): Promise<StartResult> {
    if (this.disposed) return { status: "rejected", reason: "closed" };
    if (!fromPop && this.browser?.busy) return { status: "rejected", reason: "history-busy" };
    if (!current()) return { status: "superseded" };
    const epoch = ++this.openEpoch;
    this.cancelContentFocus();
    const focus = this.focusEpoch;
    const valid = () =>
      !this.disposed && current() && epoch === this.openEpoch && focus === this.focusEpoch;
    const { model, documents } = this.state;
    const activeId = this.state.store.get().activeDocumentId;
    const selectedId = model.getActiveTabset()?.getSelectedNode()?.getId();
    let selected = selectedId ? documents.get(selectedId) : undefined;
    if (!selected)
      model.visitNodes((node) => {
        if (!selected && (node instanceof TabSetNode || node instanceof BorderNode)) {
          const id = node.getSelectedNode()?.getId();
          if (id) selected = documents.get(id);
        }
      });
    const session =
      (activeId ? documents.get(activeId) : undefined) ??
      selected ??
      this.preferred([...documents.values()]);
    if (!session) {
      this.state.store.setState((state) => ({ ...state, activeDocumentId: null }));
      const href = this.options.home ?? "/";
      if (!fromPop) this.browser?.publish(href, undefined, true);
      return { status: "empty", href };
    }
    try {
      await this.loadDocument(session.id);
      // A visible restored tab may already have started loading through the React binding.
      // Its Router still owns the final URL; do not normalize a home anchor to a stale href.
      if (session.router) await this.settle(session.router);
      if (!valid() || documents.get(session.id) !== session) return { status: "superseded" };
      this.activate(session.id, { history: false });
      if (!fromPop) this.browser?.publish(session.href, session.id, true);
      return { status: "committed", document: this.getDocument(session.id)!, reused: true };
    } catch (error) {
      if (!valid()) return { status: "superseded" };
      this.issue("operation-failed", error, session.id);
      return { status: "failed", stage: "load", error };
    }
  }

  snapshot(): WorkbenchSnapshot {
    const layout = this.getLayout();
    const update = (node: {
      type?: string | undefined;
      id?: string | undefined;
      children?: unknown[] | undefined;
      config?: unknown;
    }) => {
      if (node.type === "tab" && node.id && this.state.documents.has(node.id)) {
        const session = this.state.documents.get(node.id)!;
        node.config = {
          href: session.href,
          multi: session.multi,
          ...(session.preview ? { preview: true } : {}),
        };
      }
      node.children?.forEach((child) => update(child as Parameters<typeof update>[0]));
    };
    update(layout.layout);
    layout.borders?.forEach(update);
    return { version: 1, workspaceId: this.options.workspaceId ?? "default", layout };
  }

  /**
   * Immediately stops admission and releases owned resources without dirty/save decisions.
   * Repeated calls share one Promise, which resolves with errors after cleanup settles.
   */
  dispose(): Promise<readonly unknown[]> {
    if (this.disposePromise) return this.disposePromise;
    let finish!: (errors: readonly unknown[]) => void;
    this.disposePromise = new Promise((resolve) => {
      finish = resolve;
    });
    this.disposed = true;
    this.cancelContentFocus();
    ++this.openEpoch;
    const errors: unknown[] = [];
    const browser = this.browser;
    this.browser = undefined;
    try {
      browser?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.state.model.removeChangeListener(this.modelListener);
    } catch (error) {
      errors.push(error);
    }
    const sessions = [...this.state.documents.values()];
    const sessionIds = new Set(sessions.map((session) => session.id));
    const otherCleanupIds = new Set(
      [...this.toolLifecycles.keys(), ...this.cleanupTasks.keys()].filter(
        (id) => !sessionIds.has(id),
      ),
    );
    this.state.documents.clear();
    const pending = [...this.pending];
    this.pending.clear();
    for (const router of pending) errors.push(...this.releaseRouter(router));
    errors.push(...this.releaseRouter(this.resolver));
    try {
      this.state.store.setState((s) => ({
        ...s,
        activeDocumentId: null,
        focusedTabId: null,
        focusedArea: null,
        revision: s.revision + 1,
      }));
    } catch (error) {
      errors.push(error);
    }
    void Promise.allSettled([
      ...sessions.map((s) => this.releaseSession(s)),
      ...[...otherCleanupIds].map((id) => this.releaseTool(id)),
    ]).then((results) => {
      return finish([
        ...errors,
        ...results.flatMap((result) =>
          result.status === "fulfilled" ? result.value : [result.reason],
        ),
      ]);
    });
    return this.disposePromise;
  }

  private checkPreservedContainer(
    container: Node | undefined,
    presentation: OpenPresentation,
    targetId?: string,
  ) {
    const source = presentation.preserve;
    if (!source || presentation.focus !== this.focusEpoch) return;
    const model = this.state.model;
    if (source.id !== targetId && container === tabContainer(model.getNodeById(source.id)))
      throw new FocusConflict("preserveFocus requires a separate document container");
    const focused = presentation.focusedContent;
    if (
      focused &&
      focused.getId() !== targetId &&
      model.getNodeById(focused.getId()) === focused &&
      container === tabContainer(focused)
    )
      throw new FocusConflict("preserveFocus cannot hide the focused content");
  }

  private checkPresentation(
    session: DocumentSession,
    href: string,
    presentation: OpenPresentation,
  ) {
    const source = presentation.preserve;
    if (!source) return;
    if (session === source && href !== source.href)
      throw new FocusConflict("preserveFocus cannot navigate the source document");
    this.checkPreservedContainer(
      tabContainer(this.state.model.getNodeById(session.id)),
      presentation,
      session.id,
    );
  }

  private revealDocument(session: DocumentSession, presentation: OpenPresentation) {
    if (presentation.background || presentation.focus !== this.focusEpoch) return;
    const source = presentation.preserve;
    if (!source) {
      this.activate(session.id, { history: false });
      if (!presentation.fromPop)
        this.browser?.publish(session.href, session.id, presentation.replace);
      return;
    }
    this.checkPresentation(session, session.href, presentation);
    if (this.state.documents.get(source.id) !== source) return;
    const model = this.state.model;
    const node = model.getNodeById(session.id);
    if (!(node instanceof TabNode)) return;
    const hidden = closedGroup(node);
    const maximized = model.getMaximizedTabset();
    const container = tabContainer(node);
    if (
      session === source &&
      node.isSelected() &&
      !hidden &&
      (!(container instanceof BorderNode) || container.isShowing()) &&
      (!(container instanceof TabSetNode) || !maximized || maximized === container)
    )
      return;
    const active = model.getActiveTabset();
    const selecting = this.selecting;
    this.selecting = true;
    try {
      if (maximized) model.doAction(Actions.maximizeToggle(maximized.getId()));
      revealTab(model, node);
      if (active && model.getActiveTabset() !== active)
        model.doAction(Actions.setActiveTabset(active.getId()));
    } finally {
      this.selecting = selecting;
    }
  }

  private async openHref(
    href: string,
    options: OpenDocumentOptions,
    replace: boolean,
    current: () => boolean = () => true,
    fromPop = false,
  ): Promise<NavigationResult> {
    if (this.disposed) return { status: "rejected", reason: "closed" };
    if (!fromPop && this.browser?.busy) return { status: "rejected", reason: "history-busy" };
    this.checkHref(href);
    if (options.preview && !options.newInstance && options.background)
      throw new Error("A preview cannot open in the background");
    const epoch = options.background ? this.openEpoch : ++this.openEpoch;
    const focus = this.focusEpoch;
    if (options.preserveFocus && options.background)
      return { status: "rejected", reason: "focus-conflict" };
    const sourceId = this.state.store.get().activeDocumentId;
    const source = sourceId ? this.state.documents.get(sourceId) : undefined;
    if (options.preserveFocus && !source) return { status: "rejected", reason: "focus-conflict" };
    const editing = this.state.store.get();
    const focusedId =
      editing.focusedArea === "document" || editing.focusedArea === "tool"
        ? editing.focusedTabId
        : null;
    const presentation: OpenPresentation = {
      focus,
      focusedContent: focusedId ? this.state.model.getNodeById(focusedId) : undefined,
      background: !!options.background,
      preserve: options.preserveFocus ? source : undefined,
      replace,
      fromPop,
    };
    const location = options.location ?? DockLocation.CENTER;
    const initialPreview =
      options.preview && !options.newInstance && options.location === undefined
        ? [...this.state.documents.values()].find((session) => session.preview)
        : undefined;
    const target =
      options.target ??
      (initialPreview
        ? tabContainer(this.state.model.getNodeById(initialPreview.id))?.getId()
        : undefined) ??
      this.state.model.getActiveTabset()?.getId() ??
      this.state.model.getFirstTabSet()?.getId();
    const targetNode = target ? this.state.model.getNodeById(target) : undefined;
    const valid = () =>
      !this.disposed &&
      current() &&
      (options.background || epoch === this.openEpoch) &&
      (!options.preview || options.newInstance || focus === this.focusEpoch);
    let router: AnyRouter | undefined;
    try {
      // Exact accepted URLs can be reused without speculative loaders.
      const active = this.state.store.get().activeDocumentId;
      const exact =
        !options.newInstance &&
        this.preferred([...this.state.documents.values()].filter((s) => s.href === href));
      if (
        exact &&
        (!active || exact.id === active) &&
        (!exact.router ||
          (exact.router.history.location.href === href && !exact.router.state.isLoading))
      ) {
        await this.loadDocument(exact.id);
        if (!valid() || this.state.documents.get(exact.id) !== exact)
          return { status: "superseded" };
        this.checkPresentation(exact, exact.href, presentation);
        this.revealDocument(exact, { ...presentation, replace: true });
        return { status: "committed", document: this.getDocument(exact.id)!, reused: true };
      }
      router = this.options.createRouter(createDocumentHistory(href));
      this.pending.add(router);
      const initialIdentity = this.identity(router, router.matchRoutes(router.state.location));
      const initialTarget = options.newInstance
        ? undefined
        : (this.preferred(
            [...this.state.documents.values()].filter(
              (s) => this.sessionIdentity(s) === initialIdentity,
            ),
          ) ??
          (exact || undefined));
      const initialOperation = initialTarget ? ++initialTarget.operation : undefined;

      if (
        initialTarget &&
        (initialTarget.href === href || options.reuse === "preserve") &&
        (!initialTarget.router ||
          (initialTarget.router.history.location.href === initialTarget.href &&
            !initialTarget.router.state.isLoading))
      ) {
        await this.loadDocument(initialTarget.id);
        if (!valid() || this.state.documents.get(initialTarget.id) !== initialTarget)
          return { status: "superseded" };
        this.checkPresentation(initialTarget, initialTarget.href, presentation);
        this.revealDocument(initialTarget, { ...presentation, replace: true });
        return { status: "committed", document: this.getDocument(initialTarget.id)!, reused: true };
      }
      await router.load();
      // A redirect starts another real Router load. Await it via the public lifecycle event.
      await this.settle(router);
      if (!valid()) return { status: "superseded" };
      if (
        initialTarget &&
        (this.state.documents.get(initialTarget.id) !== initialTarget ||
          initialTarget.operation !== initialOperation)
      )
        return { status: "superseded" };
      const identity = this.identity(router);
      const existing =
        !options.newInstance &&
        (initialTarget?.href === router.state.location.publicHref
          ? initialTarget
          : this.preferred(
              [...this.state.documents.values()].filter(
                (s) => this.sessionIdentity(s) === identity,
              ),
            ));
      if (existing) {
        const finalHref = router.state.location.publicHref;
        if (existing.href === finalHref || options.reuse === "preserve") {
          this.checkPresentation(existing, existing.href, presentation);
          this.revealDocument(existing, presentation);
          return { status: "committed", document: this.getDocument(existing.id)!, reused: true };
        }
        this.checkPresentation(existing, finalHref, presentation);
        // A live Router remains authoritative for its own view-state transition and blockers.
        return await this.navigateSession(
          existing,
          finalHref,
          replace,
          valid,
          fromPop,
          options.background || focus !== this.focusEpoch || !!options.preserveFocus,
          presentation,
        );
      }
      const preview = !!options.preview && !options.newInstance;
      const previousPreview = preview
        ? [...this.state.documents.values()].find((session) => session.preview)
        : undefined;
      const id = this.freshId();
      if (!target) throw new Error("Layout requires a central Tabset for opening documents");
      // fromJson can leave pruned empty Tabsets in the upstream idMap until its next Action.
      // Validate the live tree rather than admitting content into a detached old container.
      let liveTarget = false;
      this.state.model.visitNodes((node) => {
        if (node === targetNode && (node instanceof TabSetNode || node instanceof BorderNode))
          liveTarget = true;
      });
      if (!liveTarget) throw new Error(`Cannot add document to missing Tabset or Border ${target}`);
      if (
        ![
          DockLocation.CENTER,
          DockLocation.LEFT,
          DockLocation.RIGHT,
          DockLocation.TOP,
          DockLocation.BOTTOM,
        ].includes(location)
      )
        throw new Error("Unsupported document docking location");
      if (targetNode instanceof BorderNode && location !== DockLocation.CENTER)
        throw new Error("A Border only accepts center document admission");
      if (location === DockLocation.CENTER) this.checkPreservedContainer(targetNode, presentation);
      const session: DocumentSession = {
        id,
        router,
        href: router.state.location.publicHref,
        identity,
        multi: !!options.newInstance,
        preview,
        operation: 0,
        contentVersion: 0,
        release: [],
      };
      const title = this.routeMetadata(router)?.title ?? session.href;
      const model = this.state.model;
      const previousActive = model.getActiveTabset();
      const destination = targetNode as TabSetNode | BorderNode;
      const previousSelected = destination.getSelectedNode();
      const restoreSelection = () => {
        const actions: Action[] = [];
        let liveSelected = false;
        let liveActive = false;
        model.visitNodes((node) => {
          if (node === previousSelected) liveSelected = true;
          if (node === previousActive) liveActive = true;
        });
        if (
          previousSelected instanceof TabNode &&
          liveSelected &&
          tabContainer(previousSelected) === destination &&
          !previousSelected.isSelected()
        )
          actions.push(Actions.selectTab(previousSelected.getId()));
        if (
          previousActive &&
          liveActive &&
          (model.getActiveTabset() !== previousActive || actions.length > 0)
        )
          actions.push(Actions.setActiveTabset(previousActive.getId()));
        if (actions.length === 0) return;
        const selecting = this.selecting;
        this.selecting = true;
        try {
          model.doAction(actions.length === 1 ? actions[0]! : Actions.group(actions));
        } finally {
          this.selecting = selecting;
        }
      };
      const insertion = Actions.addTab(
        {
          type: "tab",
          id,
          name: title,
          component: DOCUMENT_COMPONENT,
          config: { href: session.href, multi: session.multi },
          enableFloat: false,
          enablePopout: false,
        },
        target,
        location,
        -1,
        false,
      );
      if (this.options.layoutPolicy && !this.options.layoutPolicy.allowsAction(model, insertion))
        return { status: "rejected", reason: "layout-policy" };
      const weights = new Map<RowNode | TabSetNode, number>();
      if (location !== DockLocation.CENTER)
        model.visitNodes((node) => {
          if (node instanceof RowNode || node instanceof TabSetNode)
            weights.set(node, node.getWeight());
        });
      let provisionalContainer: TabSetNode | BorderNode | undefined;
      try {
        const node = model.doAction(insertion) as TabNode | undefined;
        if (!node || model.getNodeById(id) !== node)
          throw new Error(`Cannot add document to ${target}`);
        provisionalContainer = tabContainer(node);
        // Admission is provisional until policy approval. Foreground selection belongs to
        // activate below; native ADD may still change the active Tabset even with select:false.
        if (
          !this.allowMove(node, destination, location) ||
          (this.options.layoutPolicy && !this.options.layoutPolicy.allows(model))
        )
          throw new Error(`Docking policy rejected document in ${target}`);
        if (options.background || options.preserveFocus || focus !== this.focusEpoch)
          restoreSelection();
      } catch (error) {
        const errors = [error];
        provisionalContainer ??= tabContainer(model.getNodeById(id));
        const retained = () => {
          let live = false;
          model.visitNodes((node) => {
            if (node instanceof TabNode && node.getId() === id) live = true;
          });
          return live;
        };
        if (retained()) {
          try {
            model.doAction(Actions.deleteTab(id));
          } catch (cleanupError) {
            errors.push(cleanupError);
          }
        }
        if (retained())
          errors.push(new Error(`Provisional document ${id} remains in the native layout`));
        try {
          if (
            provisionalContainer instanceof TabSetNode &&
            !weights.has(provisionalContainer) &&
            location !== DockLocation.CENTER &&
            provisionalContainer.getChildren().length === 0 &&
            model.getNodeById(provisionalContainer.getId()) === provisionalContainer
          )
            model.doAction(Actions.deleteTabset(provisionalContainer.getId()));
          for (const [node, weight] of weights) {
            if (model.getNodeById(node.getId()) === node && node.getWeight() !== weight)
              model.doAction(Actions.updateNodeAttributes(node.getId(), { weight }));
          }
          restoreSelection();
        } catch (restoreError) {
          errors.push(restoreError);
        }
        throw errors.length === 1
          ? error
          : new AggregateError(errors, `Failed to discard provisional document ${id}`);
      }
      const retirePreview =
        previousPreview?.preview === true && previousPreview !== presentation.preserve;
      if (previousPreview) this.keep(previousPreview.id);
      this.state.documents.set(id, session);
      this.pending.delete(router);
      this.attachRouter(session);
      this.changed();
      this.revealDocument(session, presentation);
      // Admission has succeeded before retiring the previous preview. A new Router/content id
      // gives resource owners a real lifetime boundary; no same-path React state is repurposed.
      // Dirty, protected or already-closing content is kept, never implicitly discarded.
      if (
        retirePreview &&
        previousPreview &&
        this.state.documents.get(previousPreview.id) === previousPreview
      ) {
        try {
          const previousNode = model.getNodeById(previousPreview.id);
          if (
            previousNode instanceof TabNode &&
            previousNode.isCloseable() &&
            !previousPreview.lifecycle?.isDirty?.() &&
            !this.closing.has(previousPreview.id)
          )
            void this.close(previousPreview.id);
        } catch (error) {
          // Retirement is post-admission cleanup. Keep the old document and preserve the
          // committed receipt even if an application getter cannot establish safe removal.
          this.issue("operation-failed", error, previousPreview.id);
        }
      }
      return { status: "committed", document: this.getDocument(id)!, reused: false };
    } catch (error) {
      if (error instanceof FocusConflict) return { status: "rejected", reason: "focus-conflict" };
      this.issue("operation-failed", error);
      return { status: "failed", stage: "load", error };
    } finally {
      if (router && this.pending.delete(router))
        this.releaseRouter(router).forEach((error) => this.issue("operation-failed", error));
    }
  }

  private async navigateSession(
    session: DocumentSession,
    href: string,
    replace: boolean,
    current: () => boolean,
    fromPop: boolean,
    background = false,
    presentation?: OpenPresentation,
  ): Promise<NavigationResult> {
    await this.loadDocument(session.id);
    if (!this.state.documents.has(session.id) || !session.router)
      return { status: "rejected", reason: "closed" };
    const operation = ++session.operation;
    if (
      session.href === href &&
      session.router.history.location.href === href &&
      !session.router.state.isLoading
    ) {
      if (current()) {
        if (presentation) this.revealDocument(session, presentation);
        else if (!background) this.activate(session.id, { history: !fromPop });
      }
      return current()
        ? { status: "committed", document: this.getDocument(session.id)!, reused: true }
        : { status: "superseded" };
    }
    const router = session.router;
    const focus = this.focusEpoch;
    const before = session.contentVersion;
    const valid = () =>
      current() &&
      this.state.documents.get(session.id) === session &&
      operation === session.operation;
    try {
      if (!(await this.decide(session, "navigate", href)))
        return { status: "rejected", reason: "decision" };
      if (!valid() || before !== session.contentVersion) return { status: "superseded" };
      // The application's native Router blockers still run. Our one-shot approval prevents a second prompt.
      this.approved.set(session.id, href);
      this.coordinating.add(session.id);
      if (!(await navigateDocument(router, href, replace)))
        return { status: "rejected", reason: "router-blocked" };
      if (!valid()) return { status: "superseded" };
      if (
        router.state.location.publicHref !== href &&
        router.state.location.publicHref === session.href &&
        session.contentVersion === before
      )
        return { status: "rejected", reason: "router-blocked" };
      this.acceptRouter(session);
      if (presentation) this.revealDocument(session, presentation);
      else if (!background && focus === this.focusEpoch) {
        this.activate(session.id, { history: false });
        if (!fromPop) this.browser?.publish(session.href, session.id, replace);
      }
      return { status: "committed", document: this.getDocument(session.id)!, reused: true };
    } catch (error) {
      this.issue("operation-failed", error, session.id);
      return { status: "failed", stage: "navigate", error };
    } finally {
      this.approved.delete(session.id);
      this.coordinating.delete(session.id);
    }
  }

  private readonly approved = new Map<string, string>();
  private readonly coordinating = new Set<string>();
  private attachRouter(session: DocumentSession) {
    const router = session.router!;
    let replace = false;
    session.release.push(router.history.subscribe(router.load));
    session.release.push(
      router.history.block({
        enableBeforeUnload: false,
        blockerFn: async ({
          nextLocation,
          action,
        }: {
          nextLocation: { href: string };
          action: string;
        }) => {
          replace = action === "REPLACE";
          if (!this.state.documents.has(session.id)) return true;
          if (this.approved.get(session.id) === nextLocation.href) {
            this.approved.delete(session.id);
            return false;
          }
          const before = session.contentVersion;
          const operation = ++session.operation;
          return (
            !(await this.decide(session, "navigate", nextLocation.href)) ||
            !this.state.documents.has(session.id) ||
            before !== session.contentVersion ||
            operation !== session.operation
          );
        },
      }),
    );
    session.release.push(
      router.subscribe("onResolved", () => {
        if (!this.state.documents.has(session.id)) return;
        this.acceptRouter(session);
        // URL publication follows the active document's accepted location. Focus can
        // change inside that document when navigation replaces the clicked control;
        // it must not leave the browser URL pointing at the previous search state.
        if (
          !this.coordinating.has(session.id) &&
          this.state.store.get().activeDocumentId === session.id
        )
          this.browser?.publish(session.href, session.id, replace);
      }),
    );
  }
  private acceptRouter(session: DocumentSession) {
    const router = session.router!;
    const href = router.state.location.publicHref;
    const identity = this.identity(router);
    // A lazy restored tab already owns its native name. Compare its saved location before
    // accepting the new href; loading or view-state changes are not content replacements.
    const identityChanged = this.sessionIdentity(session) !== identity;
    if (href !== session.href) {
      session.href = href;
      ++session.contentVersion;
    }
    session.identity = identity;
    const other = [...this.state.documents.values()].find(
      (s) => s !== session && s.identity === session.identity,
    );
    // Reloading an accepted ordinary owner beside an explicit copy is not a new collision.
    if (identityChanged && other && !session.multi)
      this.issue(
        "native-identity-conflict",
        new Error(
          `Native navigation committed ${href}, already open in ${other.id}. Both instances remain alive; use workbench.open for deduplication.`,
        ),
        session.id,
      );
    const node = this.state.model.getNodeById(session.id);
    const title = this.routeMetadata(router)?.title;
    if (identityChanged && node instanceof TabNode && title && node.getName() !== title)
      this.state.model.doAction(Actions.renameTab(session.id, title));
    this.changed();
  }
  private async settle(router: AnyRouter) {
    if (!router.state.isLoading && router.state.matches.every((m) => m.status !== "pending"))
      return;
    await new Promise<void>((resolve) => {
      const off = router.subscribe("onResolved", () => {
        off();
        resolve();
      });
    });
  }
  private async loadDocument(id: string) {
    const session = this.state.documents.get(id);
    if (!session || session.router || this.disposed) return;
    const router = this.options.createRouter(createDocumentHistory(session.href));
    session.router = router;
    this.attachRouter(session);
    await router.load();
    await this.settle(router);
    if (this.state.documents.get(id) === session) this.acceptRouter(session);
  }
  private async decide(session: DocumentSession, reason: "close" | "navigate", to?: string) {
    if (!session.lifecycle?.isDirty?.()) return true;
    return session.lifecycle.beforeLeave
      ? await session.lifecycle.beforeLeave(reason, {
          id: session.id,
          from: session.href,
          ...(to ? { to } : {}),
        })
      : false;
  }
  /** Interpret removal effects only. Model remains the sole layout authority. */
  private closeAction(
    action: Action,
    history = true,
    signal?: AbortSignal,
  ): Promise<CloseActionResult> {
    if (signal?.aborted) return Promise.resolve({ status: "superseded" });
    const model = this.state.model;
    const actions = actionsIn(action);
    const key = JSON.stringify([history, actions.map((a) => [a.type, a.data.node]).toSorted()]);
    for (const a of actions) {
      const pending = this.closing.get(a.data.node as string);
      if (pending)
        return Promise.resolve(
          pending.key === key && pending.signal === signal
            ? pending.promise
            : { status: "rejected", reason: "closing" },
        );
    }
    const scopes: CloseScope[] = [];
    for (const a of actions) {
      const node = model.getNodeById(a.data.node as string);
      if (a.type === Actions.DELETE_TAB && node instanceof TabNode) {
        if (!node.isCloseable())
          return Promise.resolve({ status: "rejected", reason: "not-closeable" });
        scopes.push({ node, members: [node], closing: [node] });
      } else if (a.type === Actions.DELETE_TABSET && node instanceof TabSetNode) {
        if (!node.isEnableClose())
          return Promise.resolve({ status: "rejected", reason: "not-closeable" });
        scopes.push({
          node,
          members: tabsIn(node),
          // Native Tabset close skips non-closeable children, including a group with a
          // non-closeable member. Preserve that meaning; don't close part of that group.
          closing: node
            .getChildren()
            .filter((child) => child.isCloseable())
            .flatMap(tabsIn),
        });
      } else return Promise.resolve({ status: "superseded" });
    }
    const tabs = [
      ...new Map(
        scopes.flatMap((scope) => scope.closing).map((tab) => [tab.getId(), tab]),
      ).values(),
    ];
    const reserved = new Set(
      scopes.flatMap((scope) => [scope.node.getId(), ...scope.members.map((tab) => tab.getId())]),
    );
    for (const id of reserved) {
      const pending = this.closing.get(id);
      if (pending) return Promise.resolve({ status: "rejected", reason: "closing" });
    }
    let finish!: (result: CloseActionResult) => void;
    const promise = new Promise<CloseActionResult>((resolve) => {
      finish = resolve;
    });
    for (const id of reserved)
      this.closing.set(id, { key, promise, ...(signal ? { signal } : {}) });
    // Reserve before invoking application decisions, including synchronous/reentrant ones.
    void this.runCloseAction(scopes, tabs, history, signal).then((result) => {
      for (const id of reserved)
        if (this.closing.get(id)?.promise === promise) this.closing.delete(id);
      finish(result);
      if (result.status === "failed") this.issue("operation-failed", result.error);
      if (result.status === "closed")
        result.cleanupErrors.forEach((error) => this.issue("operation-failed", error, result.id));
      return undefined;
    });
    return promise;
  }

  private async runCloseAction(
    scopes: CloseScope[],
    tabs: TabNode[],
    history: boolean,
    signal?: AbortSignal,
  ): Promise<CloseActionResult> {
    const sessions = tabs.flatMap((tab) => {
      const session = this.state.documents.get(tab.getId());
      return session ? [session] : [];
    });
    const versions = sessions.map((s) => s.contentVersion);
    const lifecycles = sessions.map((s) => s.lifecycle);
    const tools = tabs.filter((tab) => this.state.tools.has(tab.getId()));
    const toolLifecycles = tools.map((tab) => this.toolLifecycles.get(tab.getId()));
    try {
      const contentLifecycles = tabs.map(
        (tab) =>
          this.state.documents.get(tab.getId())?.lifecycle ?? this.toolLifecycles.get(tab.getId()),
      );
      const dirty = contentLifecycles.map((lifecycle) => lifecycle?.isDirty?.() ?? false);
      const revisionReaders = contentLifecycles.map((lifecycle) => lifecycle?.getCloseRevision);
      const revisions = revisionReaders.map((read, i) => read?.call(contentLifecycles[i]));
      if (
        tabs.length > 1 &&
        contentLifecycles.some((_lifecycle, i) => dirty[i] && !revisionReaders[i])
      )
        return { status: "rejected", reason: "revision-required" };
      for (const [index, lifecycle] of contentLifecycles.entries()) {
        if (this.disposed || signal?.aborted) return { status: "superseded" };
        if (!lifecycle?.isDirty?.()) continue;
        if (tabs.length > 1 && !lifecycle.getCloseRevision)
          return { status: "rejected", reason: "revision-required" };
        const id = tabs[index]!.getId();
        const from = this.state.documents.get(id)?.href;
        const decision = Promise.resolve(
          lifecycle.beforeLeave?.("close", {
            id,
            ...(from ? { from } : {}),
            ...(signal ? { signal } : {}),
          }),
        );
        // eslint-disable-next-line no-await-in-loop -- Dirty decisions may display a dialog; ask in strip order.
        const approved = await (signal
          ? new Promise<boolean | undefined>((resolve, reject) => {
              const abort = () => resolve(false);
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
              void decision.then(
                (value) => {
                  signal.removeEventListener("abort", abort);
                  return resolve(value);
                },
                (error) => {
                  signal.removeEventListener("abort", abort);
                  reject(error);
                },
              );
            })
          : decision);
        if (signal?.aborted) return { status: "superseded" };
        if (!approved) return { status: "rejected", reason: "decision" };
      }
      if (
        this.disposed ||
        signal?.aborted ||
        sessions.some((s) => this.state.documents.get(s.id) !== s)
      )
        return { status: "superseded" };
      if (
        sessions.some(
          (s, i) => s.contentVersion !== versions[i] || s.lifecycle !== lifecycles[i],
        ) ||
        tools.some((tab, i) => this.toolLifecycles.get(tab.getId()) !== toolLifecycles[i]) ||
        contentLifecycles.some((lifecycle, i) => {
          const read = lifecycle?.getCloseRevision;
          // Withdrawing a revision provider cannot disable an already approved member's recheck.
          return (
            Boolean(read) !== Boolean(revisionReaders[i]) ||
            (read && !Object.is(read.call(lifecycle), revisions[i])) ||
            (!dirty[i] && lifecycle?.isDirty?.())
          );
        }) ||
        tabs.some(
          (tab) => !tab.isCloseable() || this.state.model.getNodeById(tab.getId()) !== tab,
        ) ||
        scopes.some((scope) => {
          if (this.state.model.getNodeById(scope.node.getId()) !== scope.node) return true;
          if (scope.node instanceof TabNode) return false;
          return (
            !scope.node.isEnableClose() ||
            !sameMembers(scope.members, tabsIn(scope.node)) ||
            !sameMembers(
              scope.closing,
              scope.node
                .getChildren()
                .filter((child) => child.isCloseable())
                .flatMap(tabsIn),
            )
          );
        })
      )
        return { status: "rejected", reason: "changed" };
      const active = this.state.store.get().activeDocumentId;
      const group = active
        ? tabContainer(this.state.model.getNodeById(active))?.getId()
        : undefined;
      // FlexLayout 0.11.1 DELETE_TABSET calls .delete() on a TabGroup, which has no such method.
      // Expand approved leaves through native Actions, then let the native Tabset action tidy
      // its empty/group-free or non-closeable remainder. No custom layout repair or fork.
      const removals = [
        ...tabs.map((tab) => Actions.deleteTab(tab.getId())),
        ...[
          ...new Set(
            scopes
              .filter((scope) => scope.node instanceof TabSetNode)
              .map((scope) => scope.node.getId()),
          ),
        ].map((id) => Actions.deleteTabset(id)),
      ];
      const selecting = this.selecting;
      const errors: unknown[] = [];
      let removed = tabs;
      this.selecting = true;
      try {
        if (removals.length > 0)
          this.state.model.doAction(removals.length === 1 ? removals[0]! : Actions.group(removals));
      } catch (error) {
        // An observer can throw after native mutation. Inspect the actual native tree and
        // settle removed lifetimes rather than reporting a refusal and leaking their Routers.
        const live = new Set<string>();
        this.state.model.visitNodes((node) => {
          if (node instanceof TabNode) live.add(node.getId());
        });
        removed = tabs.filter((tab) => !live.has(tab.getId()));
        if (removed.length === 0) return { status: "failed", error };
        errors.push(error);
      } finally {
        this.selecting = selecting;
      }
      const ids = new Set(removed.map((tab) => tab.getId()));
      for (const session of sessions)
        if (ids.has(session.id)) {
          this.state.documents.delete(session.id);
          ++session.operation;
        }
      try {
        for (let i = this.mru.length - 1; i >= 0; --i)
          if (ids.has(this.mru[i]!)) this.mru.splice(i, 1);
        this.clearRemovedFocus(ids);
        const activeNow = this.state.store.get().activeDocumentId;
        if (activeNow !== null && ids.has(activeNow)) {
          const remaining = [...this.state.documents.values()];
          const successor =
            this.preferred(
              remaining.filter(
                (s) => tabContainer(this.state.model.getNodeById(s.id))?.getId() === group,
              ),
            ) ?? this.preferred(remaining);
          this.state.store.setState((s) => ({ ...s, activeDocumentId: null }));
          this.cancelContentFocus();
          if (successor) this.activate(successor.id, { history });
          else if (history) this.browser?.publish(this.options.home ?? "/", undefined, true);
        }
        this.changed();
      } catch (error) {
        errors.push(error);
      }
      const cleanupErrors = (
        await Promise.all([
          ...sessions.filter((s) => ids.has(s.id)).map((s) => this.releaseSession(s)),
          ...tools
            .filter((tab) => ids.has(tab.getId()))
            .map((tab) => this.releaseTool(tab.getId())),
        ])
      ).flat();
      cleanupErrors.push(...errors);
      if (removed.length !== tabs.length)
        return {
          status: "failed",
          error: new AggregateError(
            cleanupErrors,
            `Native close partially applied; removed ${[...ids].join(", ")}`,
          ),
        };
      return removed.length > 0
        ? { status: "closed", id: removed[0]!.getId(), cleanupErrors }
        : { status: "applied" };
    } catch (error) {
      return { status: "failed", error };
    }
  }
  private toolLifecycles = new Map<string, WorkbenchContentLifecycle>();
  private readonly cleanupTasks = new Map<string, Set<Promise<unknown[]>>>();
  private settleLifecycle(
    id: string,
    lifecycle: WorkbenchContentLifecycle | undefined,
  ): Promise<unknown[]> {
    const task = (async () => {
      try {
        await lifecycle?.dispose?.();
        return [];
      } catch (error) {
        return [error];
      }
    })();
    let tasks = this.cleanupTasks.get(id);
    if (!tasks) {
      tasks = new Set();
      this.cleanupTasks.set(id, tasks);
    }
    tasks.add(task);
    void task.then(() => {
      tasks.delete(task);
      if (tasks.size === 0) this.cleanupTasks.delete(id);
      return undefined;
    });
    return task;
  }
  private register(id: string, lifecycle: WorkbenchContentLifecycle, expectedNode?: Node) {
    const node = this.state.model.getNodeById(id);
    if (
      this.disposed ||
      !(node instanceof TabNode) ||
      (expectedNode !== undefined && expectedNode !== node)
    )
      throw new Error(`Cannot register closed content ${id}`);
    const session = this.state.documents.get(id);
    if (session?.lifecycle || this.toolLifecycles.has(id))
      throw new Error(`Content ${id} already has a lifecycle owner`);
    if (session) session.lifecycle = lifecycle;
    else if (this.state.tools.has(id)) this.toolLifecycles.set(id, lifecycle);
    else throw new Error(`Cannot register closed content ${id}`);
    this.restoreContentFocus(id);
    return () => {
      if (this.state.model.getNodeById(id) !== node) return;
      if (session?.lifecycle !== lifecycle && this.toolLifecycles.get(id) !== lifecycle) return;
      if (session?.lifecycle === lifecycle) session.lifecycle = undefined;
      if (this.toolLifecycles.get(id) === lifecycle) this.toolLifecycles.delete(id);
      void this.settleLifecycle(id, lifecycle).then((errors) => {
        errors.forEach((error) => this.issue("operation-failed", error, id));
        return undefined;
      });
    };
  }
  private async releaseTool(id: string): Promise<unknown[]> {
    const lifecycle = this.toolLifecycles.get(id);
    this.toolLifecycles.delete(id);
    if (!this.options.tools?.some((tool) => tool.id === id)) this.state.tools.delete(id);
    const previous = [...(this.cleanupTasks.get(id) ?? [])];
    return (await Promise.all([...previous, this.settleLifecycle(id, lifecycle)])).flat();
  }
  private async releaseSession(session: DocumentSession): Promise<unknown[]> {
    const errors: unknown[] = [];
    session.release.splice(0).forEach((release) => {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    });
    if (session.router) errors.push(...this.releaseRouter(session.router));
    const lifecycle = session.lifecycle;
    session.lifecycle = undefined;
    const previous = [...(this.cleanupTasks.get(session.id) ?? [])];
    errors.push(
      ...(await Promise.all([...previous, this.settleLifecycle(session.id, lifecycle)])).flat(),
    );
    return errors;
  }
  private releaseRouter(router: AnyRouter): unknown[] {
    const errors: unknown[] = [];
    try {
      for (const match of router.state.matches) {
        try {
          match.abortController.abort();
        } catch (error) {
          errors.push(error);
        }
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      router.clearCache();
    } catch (error) {
      errors.push(error);
    }
    try {
      router.history.destroy();
    } catch (error) {
      errors.push(error);
    }
    return errors;
  }
  private cancelContentFocus() {
    ++this.focusEpoch;
    this.pendingFocus?.cancel?.();
    this.pendingFocus = undefined;
  }
  private restoreContentFocus(id: string) {
    const request = this.pendingFocus;
    const session = this.state.documents.get(id);
    const lifecycle = () => session?.lifecycle ?? this.toolLifecycles.get(id);
    if (!request || request.id !== id || !lifecycle()?.focus) return;
    // Native Layout applies panel visibility during its render. Mounted content
    // must wait for the next frame before a browser can accept DOM focus.
    const win = request.node.getWindow();
    request.cancel?.();
    const restore = () => {
      delete request.cancel;
      if (
        this.disposed ||
        this.pendingFocus !== request ||
        request.epoch !== this.focusEpoch ||
        this.state.model.getNodeById(id) !== request.node ||
        (session &&
          (this.state.store.get().activeDocumentId !== id ||
            this.state.documents.get(id) !== session))
      )
        return;
      const focus = lifecycle()?.focus;
      // A route can unmount between scheduling and commit. Keep the request available
      // for the next owner, provided no user interaction has superseded it.
      if (!focus) return;
      this.pendingFocus = undefined;
      this.restoringFocus = true;
      try {
        focus();
      } catch (error) {
        this.issue("operation-failed", error, id);
      } finally {
        this.restoringFocus = false;
      }
    };
    if (win) {
      const frame = win.requestAnimationFrame(restore);
      request.cancel = () => win.cancelAnimationFrame(frame);
    } else queueMicrotask(restore);
  }
  private observeFocus(id: string | null, area: WorkbenchState["focusedArea"]) {
    if (id && this.state.documents.has(id) && !this.restoringFocus)
      this.activate(id, { focus: false });
    else if (!this.restoringFocus) this.cancelContentFocus();
    this.state.store.setState((s) => ({
      ...s,
      focusedTabId: id,
      focusedArea: area,
      windowFocused: area === null ? s.windowFocused : true,
    }));
  }
  private changed() {
    this.state.store.setState((s) => ({ ...s, revision: s.revision + 1 }));
  }
  private clearRemovedFocus(ids: ReadonlySet<string>) {
    if (this.pendingFocus && ids.has(this.pendingFocus.id)) this.cancelContentFocus();
    this.state.store.setState((s) =>
      s.focusedTabId && ids.has(s.focusedTabId)
        ? { ...s, focusedTabId: null, focusedArea: null }
        : s,
    );
  }
  private remember(id: string) {
    const index = this.mru.indexOf(id);
    if (index !== -1) this.mru.splice(index, 1);
    this.mru.unshift(id);
  }
  private preferred(sessions: DocumentSession[]) {
    const active = this.state.store.get().activeDocumentId;
    const current = sessions.find((s) => s.id === active);
    if (current) return current;
    const candidates = new Map(sessions.map((s) => [s.id, s]));
    for (const id of this.mru) {
      const candidate = candidates.get(id);
      if (candidate) return candidate;
    }
    // Restored documents are lazy: no active session or MRU exists until startup accepts
    // a URL. Preserve the native selected comparison when several instances match it.
    const selected = this.state.model.getActiveTabset()?.getSelectedNode();
    if (selected) {
      const candidate = candidates.get(selected.getId());
      if (candidate) return candidate;
    }
    return sessions[0];
  }
  private freshId() {
    let id: string;
    do {
      id = `document-${this.instancePrefix}-${++this.nextId}`;
    } while (this.state.model.getNodeById(id) || this.state.tools.has(id));
    return id;
  }
  private routeMetadata(router: AnyRouter): WorkbenchRouteMetadata | undefined {
    return [...router.state.matches].toReversed().find((m) => m.staticData?.worksplit)?.staticData
      .worksplit;
  }
  private sessionIdentity(session: DocumentSession): string | undefined {
    if (session.identity) return session.identity;
    // Lazy restored documents have no Router yet. Match their saved location with the same
    // real route definition, without starting loaders or retaining a second Router per tab.
    const history = createMemoryHistory({ initialEntries: [session.href] });
    const location = this.resolver.parseLocation(history.location);
    return this.identity(this.resolver, this.resolver.matchRoutes(location));
  }
  private identity(router: AnyRouter, matches = router.state.matches) {
    const owner = matches.toReversed().find((m) => m.staticData?.worksplit) ?? matches.at(-1);
    if (!owner) throw new Error(`No Router match for ${router.state.location.publicHref}`);
    const fields = owner.staticData?.worksplit?.identitySearch ?? [];
    // Host metadata uses runtime keys; a registered Router may give each match a
    // closed search schema without a string index signature.
    const search = owner.search as Record<string, unknown>;
    return JSON.stringify([
      owner.routeId,
      owner.params,
      fields.map((name) => [name, search[name]]),
    ]);
  }
  private allowMove(drag: Node, target: Node, location: DockLocation) {
    const policy = this.options.allowDrop;
    if (!policy) return true;
    const tabs = tabsIn(drag);
    if (!policy(tabs, target, location)) return false;
    // Keep the actual native drop target, and also check the containing space. A TabGroup
    // nested in a Border must not bypass a central-only docking policy.
    const container = tabContainer(target);
    return !container || container === target || policy(tabs, container, location);
  }
  private checkHref(href: string) {
    if (!href.startsWith("/") || href.startsWith("//"))
      throw new Error(`Expected an in-workspace path, received ${href}`);
  }
  private issue(
    code: "operation-failed" | "native-identity-conflict" | "history" | "history-outside-scope",
    error: unknown,
    id?: string,
  ) {
    this.options.onIssue?.({ code, error, ...(id ? { id } : {}) });
  }
  private validateSnapshot(candidate: unknown): IJsonModel {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error("Invalid Worksplit snapshot");
    const snapshot = candidate as Record<string, unknown>;
    if (
      snapshot.version !== 1 ||
      snapshot.workspaceId !== (this.options.workspaceId ?? "default") ||
      !snapshot.layout ||
      typeof snapshot.layout !== "object" ||
      Array.isArray(snapshot.layout)
    )
      throw new Error("Incompatible Worksplit snapshot; explicitly reset or convert it");
    return structuredClone(snapshot.layout) as IJsonModel;
  }
  private validateLayout(layout: IJsonModel, serialized: boolean) {
    const popouts = (layout as IJsonModel & { popouts?: Record<string, unknown> }).popouts;
    if (
      (layout.subLayouts && Object.keys(layout.subLayouts).length > 0) ||
      (popouts && Object.keys(popouts).length > 0)
    )
      throw new Error("Snapshot popouts and sublayouts are unsupported");
    if (layout.global?.tabEnableFloat || layout.global?.tabEnablePopout)
      throw new Error("Worksplit does not support floating or popout content");
    const ids = new Set<string>();
    const validate = (value: unknown, allowed: string[], path: string) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`Invalid snapshot node at ${path}`);
      const node = value as Record<string, unknown>;
      // A saved Model must carry its serialized structure. Only native layout initializers
      // may use FlexLayout's omitted root/Border/tab types and container children.
      if (serialized && typeof node.type !== "string")
        throw new Error(`Snapshot node requires explicit type at ${path}`);
      let type = node.type;
      if (type === undefined) {
        if (allowed.includes("tab")) type = "tab";
        else if (allowed.length === 1) type = allowed[0];
      }
      if (typeof type !== "string" || !allowed.includes(type))
        throw new Error(`Unsupported snapshot node at ${path}`);
      if (node.id !== undefined) {
        if (typeof node.id !== "string" || !node.id || ids.has(node.id))
          throw new Error(`Invalid or duplicate snapshot id at ${path}`);
        ids.add(node.id);
      }
      if (type === "tab") {
        if (typeof node.component !== "string")
          throw new Error(`Snapshot tab requires component at ${path}`);
        if (node.children !== undefined)
          throw new Error(`Snapshot tab cannot contain children at ${path}`);
        if (node.subLayoutId !== undefined)
          throw new Error(`Snapshot sublayout content is unsupported at ${path}`);
        return;
      }
      if (serialized && !Array.isArray(node.children))
        throw new Error(`Snapshot container requires children array at ${path}`);
      if (node.children === undefined) return;
      if (!Array.isArray(node.children))
        throw new Error(`Snapshot children must be an array at ${path}`);
      node.children.forEach((child, index) =>
        validate(
          child,
          type === "row" ? ["row", "tabset"] : type === "tabgroup" ? ["tab"] : ["tab", "tabgroup"],
          `${path}.children[${index}]`,
        ),
      );
    };
    validate(layout.layout, ["row"], "layout");
    if (layout.borders !== undefined && !Array.isArray(layout.borders))
      throw new Error("Snapshot borders must be an array");
    layout.borders?.forEach((border, index) => validate(border, ["border"], `borders[${index}]`));
  }
}

export function createWorkbench<TRouter extends AnyRouter>(
  options: WorkbenchOptions<TRouter>,
): WorkbenchInstance<TRouter> {
  return new WorkbenchInstance(options);
}
