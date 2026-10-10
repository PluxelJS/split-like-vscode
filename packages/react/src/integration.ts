import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import {
  createMemoryHistory,
  type AnyRouter,
  type NavigateOptions,
  type RouterHistory,
} from "@tanstack/react-router";
import { createStore } from "@tanstack/react-store";
import {
  Actions,
  DockLocation,
  Model,
  TabNode,
  TabSetNode,
  type Action,
  type IJsonModel,
  type Node,
} from "flexlayout-react";
import type { ReactNode } from "react";

import { BrowserHistoryCoordinator } from "./browser-history";
import { createDocumentHistory, navigateDocument } from "./document-history";

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
  readonly title: string;
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
  activeDocumentId: string | null;
  /** Invalidates read-only layout/catalog queries; it is not another layout tree. */
  revision: number;
  focusedTabId: string | null;
  focusedArea: WorkbenchEditingContext["focusedArea"];
  windowFocused: boolean;
}
export type NavigationResult =
  | { status: "committed"; document: WorkbenchDocument; reused: boolean }
  | { status: "rejected"; reason: "decision" | "closed" | "history-busy" | "router-blocked" }
  | { status: "superseded" }
  | { status: "failed"; stage: "load" | "navigate"; error: unknown };
export type CloseResult =
  | { status: "closed"; id: string; cleanupErrors: readonly unknown[] }
  | { status: "rejected"; reason: "decision" | "changed" }
  | { status: "superseded" }
  | { status: "failed"; error: unknown };
export interface WorkbenchContentLifecycle {
  isDirty?: () => boolean;
  /** The application must recheck its editing revision/save receipt before approving. */
  beforeLeave?: (reason: "close" | "navigate") => boolean | Promise<boolean>;
  focus?: () => void;
  save?: () => void | Promise<void>;
  dispose?: () => void | Promise<void>;
}
export interface WorkbenchTool {
  id: string;
  title: string;
  render: (context: { id: string }) => ReactNode;
}
export interface WorkbenchCommand {
  id: string;
  target: "document" | "focused";
  hotkey?: UseHotkeyDefinition["hotkey"];
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
  commands?: readonly WorkbenchCommand[];
  home?: string;
  workspaceId?: string;
  snapshot?: unknown;
  /** Trusted native policy callback; do not mutate the supplied nodes or their Model. */
  allowDrop?: (tabs: readonly TabNode[], target: Node, location: DockLocation) => boolean;
  onIssue?: (issue: {
    code: "operation-failed" | "native-identity-conflict" | "history" | "history-outside-scope";
    id?: string;
    error: unknown;
  }) => void;
}
export interface OpenDocumentOptions {
  target?: string;
  newInstance?: boolean;
  background?: boolean;
}

type DocumentSession = {
  id: string;
  href: string;
  router?: AnyRouter | undefined;
  identity?: string | undefined;
  multi: boolean;
  operation: number;
  contentVersion: number;
  closing?: Promise<CloseResult> | undefined;
  lifecycle?: WorkbenchContentLifecycle | undefined;
  release: (() => void)[];
};
type Internal = {
  model: Model;
  desktopMaximized?: string | null | undefined;
  documents: Map<string, DocumentSession>;
  store: ReturnType<typeof createStore<WorkbenchState>>;
  tools: Map<string, WorkbenchTool>;
  commands: readonly WorkbenchCommand[];
  loadDocument: (id: string) => Promise<void>;
  register: (id: string, lifecycle: WorkbenchContentLifecycle) => () => void;
  focus: (id: string | null, area: WorkbenchState["focusedArea"]) => void;
  setWindowFocus: (focused: boolean) => void;
  modelAction: (action: Action) => undefined;
  report: (error: unknown) => void;
};
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
    tabEnableRename: false,
    tabEnablePin: true,
    tabSetEnableDeleteWhenEmpty: false,
    tabSetEnableClose: false,
  },
  borders: [],
  layout: { type: "row", children: [{ type: "tabset", id: "main", children: [] }] },
});

/** One owner for the native Model and document Router lifetimes. */
export class WorkbenchInstance<TRouter extends AnyRouter> {
  private readonly state: Internal;
  private readonly resolver: TRouter;
  private browser: BrowserHistoryCoordinator | undefined;
  private disposed = false;
  private focusEpoch = 0;
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
  private disposePromise: Promise<readonly unknown[]> | undefined;

  constructor(private readonly options: WorkbenchOptions<TRouter>) {
    const layout =
      options.snapshot === undefined
        ? structuredClone(options.layout ?? defaultWorkbenchLayout())
        : this.validateSnapshot(options.snapshot);
    this.validateLayout(layout);
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
      register: (id, lifecycle) => this.register(id, lifecycle),
      focus: (id, area) => this.observeFocus(id, area),
      setWindowFocus: (windowFocused) =>
        this.state.store.setState((s) => ({
          ...s,
          windowFocused,
          ...(!windowFocused ? { focusedArea: null } : {}),
        })),
      modelAction: (action) => {
        void this.dispatch(action).catch((error: unknown) => this.issue("operation-failed", error));
        return undefined;
      },
      report: (error) => this.issue("operation-failed", error),
    };
    instances.set(this, this.state);
    model.visitNodes((node) => {
      if (node instanceof TabSetNode && node.isEnableClose())
        throw new Error(
          `Disable whole-tabset close at ${node.getId()} (tabSetEnableClose/enableClose)`,
        );
      if (!(node instanceof TabNode)) return;
      if (node.isEnableFloat() || node.isEnablePopout())
        throw new Error(`Disable unsupported popouts at ${node.getId()}`);
      if (node.getComponent() === DOCUMENT_COMPONENT) {
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
          operation: 0,
          contentVersion: 0,
          release: [],
        });
      } else if (node.getComponent() !== TOOL_COMPONENT || !tools.has(node.getId())) {
        throw new Error(`Unknown Worksplit content: ${node.getId()} (${node.getComponent()})`);
      }
    });
    model.setOnAllowDrop((drag, drop) => this.allowMove(drag, drop.node, drop.location));
    if (options.allowDrop) {
      model.visitNodes((node) => {
        if (
          node instanceof TabNode &&
          node.getParent() &&
          !options.allowDrop!([node], node.getParent()!, DockLocation.CENTER)
        )
          throw new Error(`Snapshot violates docking policy at ${node.getId()}`);
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
        this.activate(id);
      if (!this.selecting && action.type === Actions.SET_ACTIVE_TABSET) {
        const selected = model.getActiveTabset()?.getSelectedNode();
        if (selected && documents.has(selected.getId())) this.activate(selected.getId());
      }
    };
    model.addChangeListener(this.modelListener);
  }

  /** Type inference follows the application's TanStack route tree. */
  open<const TFrom extends string = string, const TTo extends string | undefined = undefined>(
    navigation: NavigateOptions<TRouter, TFrom, TTo>,
    options: OpenDocumentOptions = {},
  ): Promise<NavigationResult> {
    const location = this.resolver.buildLocation(
      navigation as Parameters<AnyRouter["buildLocation"]>[0],
    );
    return this.openHref(location.href, options, !!navigation.replace);
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
      title: metadata?.title ?? (this.state.model.getNodeById(id) as TabNode).getName(),
      navigationKey: metadata?.navigationKey ?? null,
    };
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
      activeGroupId: node?.getParent()?.getId() ?? null,
      activeTabId: s.activeDocumentId,
      focusedArea: s.focusedArea,
      focusedTabId: s.focusedTabId,
      windowFocused: s.windowFocused,
    };
  }
  getLayout(): IJsonModel {
    return structuredClone(this.state.model.toJson());
  }

  activate(id: string, options: { focus?: boolean; history?: boolean } = {}) {
    const session = this.state.documents.get(id);
    if (!session || this.disposed) return;
    const node = this.state.model.getNodeById(id);
    if (!(node instanceof TabNode)) return;
    this.selecting = true;
    try {
      if (!node.isSelected()) this.state.model.doAction(Actions.selectTab(id));
      const group = node.getParent();
      if (group instanceof TabSetNode && this.state.model.getActiveTabset() !== group)
        this.state.model.doAction(Actions.setActiveTabset(group.getId()));
    } finally {
      this.selecting = false;
    }
    ++this.focusEpoch;
    if (this.state.store.get().activeDocumentId !== id) {
      this.state.store.setState((s) => ({ ...s, activeDocumentId: id }));
    }
    this.remember(id);
    if (session.router && options.history !== false) this.browser?.publish(session.href, id, true);
    if (options.focus !== false)
      queueMicrotask(() => {
        if (this.state.store.get().activeDocumentId === id && this.state.documents.has(id)) {
          this.restoringFocus = true;
          try {
            session.lifecycle?.focus?.();
          } finally {
            this.restoringFocus = false;
          }
        }
      });
    void this.loadDocument(id).catch((error: unknown) => this.issue("operation-failed", error, id));
  }

  async close(id: string): Promise<CloseResult> {
    const session = this.state.documents.get(id);
    if (!session) return { status: "superseded" };
    if (session.closing) return session.closing;
    const closing = this.closeSessions([session]);
    session.closing = closing;
    try {
      const result = await closing;
      if (result.status === "failed") this.issue("operation-failed", result.error, id);
      if (result.status === "closed")
        result.cleanupErrors.forEach((error) => this.issue("operation-failed", error, id));
      return result;
    } finally {
      if (session.closing === closing) session.closing = undefined;
    }
  }

  async dispatch(action: Action): Promise<CloseResult | { status: "applied" | "rejected" }> {
    if (this.disposed) return { status: "rejected" };
    if (action.type === Actions.DELETE_TAB) {
      const id = action.data.node as string;
      if (this.state.documents.has(id)) return this.close(id);
      if (!this.state.tools.has(id) || !this.state.model.getNodeById(id)?.isCloseable())
        return { status: "rejected" };
      const errors = await this.releaseTool(id);
      this.state.model.doAction(action);
      this.clearRemovedFocus(new Set([id]));
      return { status: "closed", id, cleanupErrors: errors };
    }
    // Whole-group deletion is intentionally disabled: per-tab close is the audited removal path.
    if (action.type === Actions.DELETE_TABSET) return { status: "rejected" };
    const allowed = [
      Actions.SELECT_TAB,
      Actions.SET_ACTIVE_TABSET,
      Actions.MOVE_NODE,
      Actions.SET_TAB_PINNED,
      Actions.ADJUST_WEIGHTS,
      Actions.ADJUST_BORDER_SPLIT,
      Actions.MAXIMIZE_TOGGLE,
      Actions.SET_BORDER_TYPE,
    ];
    if (!allowed.includes(action.type)) return { status: "rejected" };
    if (action.type === Actions.MOVE_NODE) {
      const from = this.state.model.getNodeById(action.data.fromNode as string);
      const to = this.state.model.getNodeById(action.data.toNode as string);
      if (
        !from ||
        !to ||
        !this.allowMove(
          from,
          to,
          [
            DockLocation.CENTER,
            DockLocation.LEFT,
            DockLocation.RIGHT,
            DockLocation.TOP,
            DockLocation.BOTTOM,
          ].find((location) => location.getName() === action.data.location)!,
        )
      )
        return { status: "rejected" };
    }
    this.state.model.doAction(action);
    return { status: "applied" };
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
  connectBrowser(options: { window?: Window } = {}) {
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
          : await this.openHref(href, {}, false, current, true);
        return result.status === "committed"
          ? { id: result.document.id, href: result.document.href }
          : undefined;
      },
      (error, outside) => this.issue(outside ? "history-outside-scope" : "history", error),
    );
    const browser = this.browser;
    return () => {
      browser.dispose();
      if (this.browser === browser) this.browser = undefined;
    };
  }

  /** Start from the address bar. Restored background tabs remain lazy. */
  start(href: string): Promise<NavigationResult> {
    return this.openHref(href, {}, true);
  }

  snapshot(): WorkbenchSnapshot {
    const layout = this.getLayout();
    const update = (node: {
      type?: string | undefined;
      id?: string | undefined;
      children?: unknown[] | undefined;
      config?: unknown;
      maximized?: boolean;
    }) => {
      if (node.type === "tabset" && this.state.desktopMaximized !== undefined) {
        delete node.maximized;
        if (node.id === this.state.desktopMaximized) node.maximized = true;
      }
      if (node.type === "tab" && node.id && this.state.documents.has(node.id)) {
        const session = this.state.documents.get(node.id)!;
        node.config = { href: session.href, multi: session.multi };
      }
      node.children?.forEach((child) => update(child as Parameters<typeof update>[0]));
    };
    update(layout.layout);
    layout.borders?.forEach(update);
    return { version: 1, workspaceId: this.options.workspaceId ?? "default", layout };
  }

  dispose(): Promise<readonly unknown[]> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    ++this.openEpoch;
    this.browser?.dispose();
    this.browser = undefined;
    this.state.model.removeChangeListener(this.modelListener);
    const sessions = [...this.state.documents.values()];
    const sessionIds = new Set(sessions.map((session) => session.id));
    const otherCleanupIds = new Set(
      [...this.toolLifecycles.keys(), ...this.cleanupTasks.keys()].filter(
        (id) => !sessionIds.has(id),
      ),
    );
    this.state.documents.clear();
    for (const router of this.pending) this.releaseRouter(router);
    this.pending.clear();
    this.releaseRouter(this.resolver);
    this.state.store.setState((s) => ({
      ...s,
      activeDocumentId: null,
      focusedTabId: null,
      focusedArea: null,
      revision: s.revision + 1,
    }));
    this.disposePromise = Promise.all([
      ...sessions.map((s) => this.releaseSession(s)),
      ...[...otherCleanupIds].map((id) => this.releaseTool(id)),
    ]).then((errors) => errors.flat());
    return this.disposePromise;
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
    const epoch = options.background ? this.openEpoch : ++this.openEpoch;
    const focus = this.focusEpoch;
    const valid = () =>
      !this.disposed && current() && (options.background || epoch === this.openEpoch);
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
      if (!valid() || this.state.documents.get(exact.id) !== exact) return { status: "superseded" };
      if (!options.background && focus === this.focusEpoch)
        this.activate(exact.id, { history: !fromPop });
      return { status: "committed", document: this.getDocument(exact.id)!, reused: true };
    }
    const router = this.options.createRouter(createDocumentHistory(href));
    this.pending.add(router);
    try {
      const initialIdentity = this.identity(router, router.matchRoutes(router.state.location));
      const initialTarget = options.newInstance
        ? undefined
        : (this.preferred(
            [...this.state.documents.values()].filter((s) => s.identity === initialIdentity),
          ) ??
          (exact || undefined));
      const initialOperation = initialTarget ? ++initialTarget.operation : undefined;

      if (
        initialTarget?.href === href &&
        (!initialTarget.router ||
          (initialTarget.router.history.location.href === href &&
            !initialTarget.router.state.isLoading))
      ) {
        await this.loadDocument(initialTarget.id);
        if (!valid() || this.state.documents.get(initialTarget.id) !== initialTarget)
          return { status: "superseded" };
        if (!options.background && focus === this.focusEpoch)
          this.activate(initialTarget.id, { history: !fromPop });
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
        (initialTarget?.href === router.state.location.href
          ? initialTarget
          : this.preferred(
              [...this.state.documents.values()].filter((s) => s.identity === identity),
            ));
      if (existing) {
        const finalHref = router.state.location.href;
        if (existing.href === finalHref) {
          if (!options.background && focus === this.focusEpoch) {
            this.activate(existing.id, { history: false });
            if (!fromPop) this.browser?.publish(existing.href, existing.id, replace);
          }
          return { status: "committed", document: this.getDocument(existing.id)!, reused: true };
        }
        // A live Router remains authoritative for its own view-state transition and blockers.
        return await this.navigateSession(
          existing,
          finalHref,
          replace,
          valid,
          fromPop,
          options.background || focus !== this.focusEpoch,
        );
      }
      const id = this.freshId();
      const target =
        options.target ??
        this.state.model.getActiveTabset()?.getId() ??
        this.state.model.getFirstTabSet()?.getId();
      if (!target) throw new Error("Layout requires a central Tabset for opening documents");
      const session: DocumentSession = {
        id,
        router,
        href: router.state.location.href,
        identity,
        multi: !!options.newInstance,
        operation: 0,
        contentVersion: 0,
        release: [],
      };
      const title = this.routeMetadata(router)?.title ?? session.href;
      const node = this.state.model.doAction(
        Actions.addTab(
          {
            type: "tab",
            id,
            name: title,
            component: DOCUMENT_COMPONENT,
            config: { href: session.href, multi: session.multi },
            enableFloat: false,
            enablePopout: false,
            enableRename: false,
          },
          target,
          DockLocation.CENTER,
          -1,
          !options.background && focus === this.focusEpoch,
        ),
      ) as TabNode | undefined;
      if (!node) throw new Error(`Cannot add document to ${target}`);
      if (!this.allowMove(node, node.getParent()!, DockLocation.CENTER)) {
        this.state.model.doAction(Actions.deleteTab(id));
        throw new Error(`Docking policy rejected document in ${target}`);
      }
      this.state.documents.set(id, session);
      this.pending.delete(router);
      this.attachRouter(session);
      this.changed();
      if (!options.background && focus === this.focusEpoch) {
        this.activate(id, { history: false });
        if (!fromPop) this.browser?.publish(session.href, id, replace);
      }
      return { status: "committed", document: this.getDocument(id)!, reused: false };
    } catch (error) {
      this.issue("operation-failed", error);
      return { status: "failed", stage: "load", error };
    } finally {
      if (this.pending.delete(router)) this.releaseRouter(router);
    }
  }

  private async navigateSession(
    session: DocumentSession,
    href: string,
    replace: boolean,
    current: () => boolean,
    fromPop: boolean,
    background = false,
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
      if (current() && !background) this.activate(session.id, { history: !fromPop });
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
      if (!(await this.decide(session, "navigate")))
        return { status: "rejected", reason: "decision" };
      if (!valid() || before !== session.contentVersion) return { status: "superseded" };
      // The application's native Router blockers still run. Our one-shot approval prevents a second prompt.
      this.approved.set(session.id, href);
      this.coordinating.add(session.id);
      if (!(await navigateDocument(router, href, replace)))
        return { status: "rejected", reason: "router-blocked" };
      if (!valid()) return { status: "superseded" };
      if (
        router.state.location.href !== href &&
        router.state.location.href === session.href &&
        session.contentVersion === before
      )
        return { status: "rejected", reason: "router-blocked" };
      this.acceptRouter(session);
      if (!background && focus === this.focusEpoch) {
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
    let focus = this.focusEpoch;
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
            !(await this.decide(session, "navigate")) ||
            !this.state.documents.has(session.id) ||
            before !== session.contentVersion ||
            operation !== session.operation
          );
        },
      }),
    );
    session.release.push(
      router.subscribe("onBeforeNavigate", () => {
        focus = this.focusEpoch;
      }),
    );
    session.release.push(
      router.subscribe("onResolved", () => {
        if (!this.state.documents.has(session.id)) return;
        this.acceptRouter(session);
        if (
          !this.coordinating.has(session.id) &&
          this.state.store.get().activeDocumentId === session.id &&
          focus === this.focusEpoch
        )
          this.browser?.publish(session.href, session.id, replace);
      }),
    );
  }
  private acceptRouter(session: DocumentSession) {
    const router = session.router!;
    const href = router.state.location.href;
    if (href !== session.href) {
      session.href = href;
      ++session.contentVersion;
    }
    session.identity = this.identity(router);
    const other = [...this.state.documents.values()].find(
      (s) => s !== session && s.identity === session.identity,
    );
    if (other && !session.multi)
      this.issue(
        "native-identity-conflict",
        new Error(
          `Native navigation committed ${href}, already open in ${other.id}. Both instances remain alive; use workbench.open for deduplication.`,
        ),
        session.id,
      );
    const node = this.state.model.getNodeById(session.id);
    const title = this.routeMetadata(router)?.title;
    if (node instanceof TabNode && title && node.getName() !== title)
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
  private async decide(session: DocumentSession, reason: "close" | "navigate") {
    if (!session.lifecycle?.isDirty?.()) return true;
    return session.lifecycle.beforeLeave ? await session.lifecycle.beforeLeave(reason) : false;
  }
  private async closeSessions(sessions: DocumentSession[]): Promise<CloseResult> {
    const versions = sessions.map((s) => s.contentVersion);
    const lifecycles = sessions.map((s) => s.lifecycle);
    try {
      for (const session of sessions)
        if (!(await this.decide(session, "close")))
          return { status: "rejected", reason: "decision" };
      if (sessions.some((s) => this.state.documents.get(s.id) !== s))
        return { status: "superseded" };
      if (
        sessions.some((s, i) => s.contentVersion !== versions[i] || s.lifecycle !== lifecycles[i])
      )
        return { status: "rejected", reason: "changed" };
      const active = this.state.store.get().activeDocumentId;
      const activeSession = sessions.find((s) => s.id === active);
      const group = activeSession
        ? this.state.model.getNodeById(activeSession.id)?.getParent()?.getId()
        : undefined;
      for (const session of sessions) {
        this.state.documents.delete(session.id);
        const remembered = this.mru.indexOf(session.id);
        if (remembered !== -1) this.mru.splice(remembered, 1);
        ++session.operation;
        this.state.model.doAction(Actions.deleteTab(session.id));
      }
      this.clearRemovedFocus(new Set(sessions.map((session) => session.id)));
      if (activeSession) {
        const remaining = [...this.state.documents.values()];
        const successor =
          this.preferred(
            remaining.filter(
              (s) => this.state.model.getNodeById(s.id)?.getParent()?.getId() === group,
            ),
          ) ?? this.preferred(remaining);
        this.state.store.setState((s) => ({ ...s, activeDocumentId: null }));
        ++this.focusEpoch;
        if (successor) this.activate(successor.id);
        else this.browser?.publish(this.options.home ?? "/", undefined, true);
      }
      this.changed();
      const cleanupErrors = (await Promise.all(sessions.map((s) => this.releaseSession(s)))).flat();
      return { status: "closed", id: sessions[0]!.id, cleanupErrors };
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
  private register(id: string, lifecycle: WorkbenchContentLifecycle) {
    const session = this.state.documents.get(id);
    if (session) session.lifecycle = lifecycle;
    else if (this.state.tools.has(id)) this.toolLifecycles.set(id, lifecycle);
    else throw new Error(`Cannot register closed content ${id}`);
    return () => {
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
    try {
      if (session.router) this.releaseRouter(session.router);
    } catch (error) {
      errors.push(error);
    }
    const lifecycle = session.lifecycle;
    session.lifecycle = undefined;
    const previous = [...(this.cleanupTasks.get(session.id) ?? [])];
    errors.push(
      ...(await Promise.all([...previous, this.settleLifecycle(session.id, lifecycle)])).flat(),
    );
    return errors;
  }
  private releaseRouter(router: AnyRouter) {
    router.state.matches.forEach((match) => match.abortController.abort());
    router.clearCache();
    router.history.destroy();
  }
  private observeFocus(id: string | null, area: WorkbenchState["focusedArea"]) {
    if (id && this.state.documents.has(id) && !this.restoringFocus)
      this.activate(id, { focus: false });
    else if (!this.restoringFocus) ++this.focusEpoch;
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
    return (
      sessions.find((s) => s.id === active) ??
      this.mru.map((id) => sessions.find((s) => s.id === id)).find(Boolean) ??
      sessions[0]
    );
  }
  private freshId() {
    let id: string;
    do {
      id = `document-${this.instancePrefix}-${++this.nextId}`;
    } while (this.state.model.getNodeById(id));
    return id;
  }
  private routeMetadata(router: AnyRouter): WorkbenchRouteMetadata | undefined {
    return [...router.state.matches].toReversed().find((m) => m.staticData?.worksplit)?.staticData
      .worksplit;
  }
  private identity(router: AnyRouter, matches = router.state.matches) {
    const owner = matches.toReversed().find((m) => m.staticData?.worksplit) ?? matches.at(-1);
    if (!owner) throw new Error(`No Router match for ${router.state.location.href}`);
    const fields = owner.staticData?.worksplit?.identitySearch ?? [];
    return JSON.stringify([
      owner.routeId,
      owner.params,
      fields.map((name) => [name, owner.search[name]]),
    ]);
  }
  private allowMove(drag: Node, target: Node, location: DockLocation) {
    const tabs: TabNode[] = [];
    const collect = (node: Node) => {
      if (node instanceof TabNode) tabs.push(node);
      else node.getChildren().forEach(collect);
    };
    collect(drag);
    return this.options.allowDrop?.(tabs, target, location) ?? true;
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
    if (!candidate || typeof candidate !== "object") throw new Error("Invalid Worksplit snapshot");
    const snapshot = candidate as Record<string, unknown>;
    if (
      snapshot.version !== 1 ||
      snapshot.workspaceId !== (this.options.workspaceId ?? "default") ||
      !snapshot.layout ||
      typeof snapshot.layout !== "object"
    )
      throw new Error("Incompatible Worksplit snapshot; explicitly reset or convert it");
    return structuredClone(snapshot.layout) as IJsonModel;
  }
  private validateLayout(layout: IJsonModel) {
    if (layout.layout?.type !== "row" || !Array.isArray(layout.layout.children))
      throw new Error("Snapshot requires a native FlexLayout root row");
    if (layout.subLayouts && Object.keys(layout.subLayouts).length > 0)
      throw new Error("Snapshot popouts and sublayouts are unsupported");
    const ids = new Set<string>();
    const validate = (value: unknown, allowed: string[], path: string) => {
      if (!value || typeof value !== "object") throw new Error(`Invalid snapshot node at ${path}`);
      const node = value as Record<string, unknown>;
      if (typeof node.type !== "string" || !allowed.includes(node.type))
        throw new Error(`Unsupported snapshot node at ${path}`);
      if (node.id !== undefined) {
        if (typeof node.id !== "string" || !node.id || ids.has(node.id))
          throw new Error(`Invalid or duplicate snapshot id at ${path}`);
        ids.add(node.id);
      }
      if (node.type === "tab") {
        if (typeof node.id !== "string" || typeof node.component !== "string")
          throw new Error(`Snapshot tab requires id and component at ${path}`);
        return;
      }
      if (!Array.isArray(node.children))
        throw new Error(`Snapshot children must be an array at ${path}`);
      node.children.forEach((child, index) =>
        validate(
          child,
          node.type === "row" ? ["row", "tabset"] : ["tab"],
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
