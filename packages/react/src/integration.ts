import { createMemoryHistory, type AnyRouter, type ParsedLocation } from "@tanstack/react-router";
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
  type ModelChangeListener,
  type IJsonTabNode,
  type ILayoutApi,
  type Node,
} from "flexlayout-react";

import {
  BrowserHistoryCoordinator,
  type BrowserEntryReference,
  type BrowserVisitResult,
} from "./browser-history";
import { ContentEffects } from "./content-effects";
import type { ContentRecord, ControllerOwner, DocumentRecord } from "./content-record";
import {
  createDocumentRuntime,
  type NativeNavigation,
  type DocumentRuntime,
} from "./document-history";
import { DocumentLinkController } from "./document-link";
import { applySplitRatio, centralTabsets } from "./document-placement";
import { installIntegration } from "./internal";
import { LeaveAttempt } from "./leave-attempt";
import { actionsIn, closedGroup, revealTab, tabContainer, tabsIn } from "./native-layout";
import { checkHref, DOCUMENT_COMPONENT, initialLayout, tabMetadata } from "./snapshot";
import type {
  ActivateOptions,
  Applied,
  CloseOptions,
  CloseResult,
  CloseTarget,
  CloseWorkspaceOptions,
  ContentController,
  ContentHandle,
  ContentInfo,
  ContainerInfo,
  DenialReason,
  Destination,
  DocumentInfo,
  DocumentNavigationOptions,
  DisposeResult,
  Failed,
  LeaveDecision,
  LeaveRequest,
  LeaveState,
  LeaveToken,
  LinkOptions,
  OpenOptions,
  OpenResult,
  OperationResult,
  PlacementContext,
  StartOptions,
  StartResult,
  ToolDefinition,
  WorkbenchContext,
  WorkbenchInstance,
  WorkbenchOptions,
  WorkbenchSnapshot,
  WorkbenchState,
} from "./types";

// The public methods retain the caller's route parameters; this internal boundary passes
// the unchanged native options to the router selected for the document.
type RuntimeNavigation = Parameters<DocumentRuntime<AnyRouter>["navigate"]>[0];
const applied = <T>(value: T, cleanupErrors: readonly unknown[] = []): Applied<T> => ({
  status: "applied",
  value,
  cleanupErrors,
});
const denied = (reason: DenialReason): { status: "denied"; reason: DenialReason } => ({
  status: "denied",
  reason,
});
const superseded = { status: "superseded" } as const;
function failed(
  error: unknown,
  phase: Failed["phase"] = "prepare",
  affectedIds: readonly string[] = [],
  cleanupErrors: readonly unknown[] = [],
): Failed {
  return {
    status: "failed",
    phase,
    error,
    changes: affectedIds.length ? "some" : "none",
    affectedIds,
    cleanupErrors,
  };
}
function validToken(token: LeaveToken): void {
  if (
    !(typeof token === "string"
      ? token.length > 0
      : typeof token === "number" && Number.isSafeInteger(token))
  )
    throw new TypeError("Leave tokens must be nonempty strings or finite safe integers");
}
function stateOf(controller: { getState(): LeaveState }): LeaveState {
  const state = controller.getState();
  if (!state || typeof state.hasUnsavedChanges !== "boolean")
    throw new TypeError("Invalid leave state");
  validToken(state.token);
  return { hasUnsavedChanges: state.hasUnsavedChanges, token: state.token };
}
function same<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validNavigation(navigation: RuntimeNavigation): boolean {
  if (
    !navigation ||
    navigation.reloadDocument !== undefined ||
    navigation.ignoreBlocker !== undefined ||
    Object.hasOwn(navigation, "navigation") ||
    (navigation.to !== undefined &&
      (typeof navigation.to !== "string" ||
        navigation.to.startsWith("//") ||
        URL.canParse(navigation.to)))
  )
    return false;
  if (navigation.href !== undefined) {
    try {
      checkHref(navigation.href);
    } catch {
      return false;
    }
  }
  return true;
}
interface Approval {
  readonly attempt: LeaveAttempt;
  readonly decision: Promise<boolean>;
  validate(): boolean;
  finish(): readonly unknown[];
  committed(): void;
}
interface BrowserVisitSource {
  readonly current: () => boolean;
  readonly signal: AbortSignal;
  pending: boolean;
}
interface OpenCapture {
  source: ContentRecord | undefined;
  sourceContainer: TabSetNode | BorderNode | undefined;
  anchor: TabSetNode | undefined;
  destination: { value: Destination; target: Node; children: readonly Node[] } | undefined;
  focus: number;
  order: number;
  presentation: "activate" | "reveal" | "background";
  current?: () => boolean;
}

/** The sole owner of native Model, content records, and their finite lifetimes. */
class WorkbenchSession<TRouter extends AnyRouter> implements WorkbenchInstance<TRouter> {
  readonly model: Model;
  private readonly records = new Map<string, ContentRecord>();
  // Pending native ADDs carry admission callbacks, never a second content lifetime.
  private readonly admissions = new Map<string, (node: TabNode) => void>();
  private readonly reportedResults = new WeakSet<object>();
  private readonly reportedCleanups = new WeakSet<object>();
  private readonly attempts = new Map<
    LeaveAttempt,
    { record: ContentRecord | undefined; committed: boolean }
  >();
  private readonly workspaceId: string;
  private readonly options: WorkbenchOptions<TRouter>;
  private readonly store;
  private readonly mru: string[] = [];
  private readonly prefix = crypto.randomUUID();
  private sequence = 0;
  private phase: WorkbenchState["lifecycle"] = "created";
  private startInput: StartOptions | undefined;
  private startPromise: Promise<StartResult> | undefined;
  private disposePromise: Promise<DisposeResult> | undefined;
  private view: { getLayout: () => ILayoutApi | null; root: HTMLElement } | undefined;
  private focusEpoch = 0;
  private focusing = false;
  private focusRequest:
    | {
        record: ContentRecord;
        epoch: number;
        owner: ControllerOwner | undefined;
        callback?: () => void;
        cancel?: () => void;
      }
    | undefined;
  private autoTitle = 0;
  private selecting = 0;
  private restoredActive: string | undefined;
  private projections: readonly DocumentInfo[] = [];
  private containers: readonly ContainerInfo[] = [];
  private context: WorkbenchContext | undefined;
  private readonly closing = new Map<
    ContentRecord,
    { members: readonly ContentRecord[]; promise: Promise<CloseResult> }
  >();
  private workspaceClosing:
    | Promise<OperationResult<{ snapshot: WorkbenchSnapshot | null }>>
    | undefined;
  private workspaceCloseRequest: { destination: string | undefined; handoff: boolean } | undefined;
  private readonly pendingRouters = new Set<DocumentRuntime<AnyRouter>>();
  private readonly previewEpochs = new WeakMap<object, number>();
  private browser: BrowserHistoryCoordinator | undefined;
  private readonly browserRequests = new WeakMap<NativeNavigation, BrowserVisitSource>();
  private readonly links: DocumentLinkController;
  private readonly modelListener: ModelChangeListener;
  private readonly movedPreviews = new WeakMap<Action, Set<ContentRecord>>();
  private readonly priorSelection = new WeakMap<Action, Node | undefined>();

  constructor(options: WorkbenchOptions<TRouter>) {
    this.options = {
      ...options,
      ...(options.tools ? { tools: { ...options.tools } } : {}),
      ...(options.home ? { home: { ...options.home } } : {}),
    };
    if (options.home) checkHref(options.home.href);
    const initial = initialLayout(options);
    this.workspaceId = initial.workspaceId;
    this.restoredActive = initial.activeDocumentId;
    this.model = Model.fromJson(initial.layout);
    if (options.layoutPolicy && !options.layoutPolicy.allows(this.model))
      throw new TypeError("Initial layout violates the layout policy");
    this.store = createStore<WorkbenchState>({
      lifecycle: "created",
      revision: 0,
      snapshotRevision: 0,
      activeDocumentId: null,
      activeContainerId: this.model.getActiveTabset()?.getId() ?? null,
      focusedContentId: null,
      source: null,
      windowFocused: false,
    });
    this.model.visitNodes((node) => {
      if (!(node instanceof TabNode)) return;
      const metadata = tabMetadata(node.toJson());
      if (node.getComponent() === DOCUMENT_COMPONENT) {
        const record = this.makeRecord(node, "document");
        Object.assign(record, {
          href: metadata.href!,
          preview: metadata.preview === true && !node.isPinned(),
          manualTitle: metadata.manualTitle === true,
        });
      } else {
        const definition = this.resolveTool(node.toJson());
        if (!definition) throw new TypeError(`Unknown tool definition ${node.getComponent()}`);
        const record = this.makeRecord(node, definition);
        record.manualTitle = metadata.manualTitle === true;
      }
      const config: unknown = node.getConfig();
      if (config && typeof config === "object" && Object.hasOwn(config, "worksplit")) {
        const host = { ...config } as Record<string, unknown>;
        delete host.worksplit;
        this.model.doAction(Actions.updateNodeAttributes(node.getId(), { config: host }));
      }
      if (node.isEnableFloat() || node.isEnablePopout())
        throw new TypeError("Floating and popout content is unsupported");
    });
    const previews = new Set<string>();
    for (const record of this.records.values())
      if (record.role === "document" && record.preview) {
        const scope = this.previewScope(record.node);
        if (previews.has(scope))
          throw new TypeError("Initial layout contains multiple previews in the same scope");
        previews.add(scope);
      }
    this.links = new DocumentLinkController(
      this.model,
      (drag, target, location) => this.allowMove(drag, target, location),
      this.options.layoutPolicy,
      (error) => this.issue(error),
      (result) => this.reportResult(result),
    );
    this.modelListener = {
      onBeforeAction: (action) => {
        this.priorSelection.set(action, this.model.getActiveTabset()?.getSelectedNode());
        const moved = new Set<ContentRecord>();
        for (const leaf of actionsIn(action))
          if (leaf.type === Actions.MOVE_NODE) {
            const from = this.model.getNodeById(leaf.data.fromNode);
            if (from)
              for (const tab of tabsIn(from)) {
                const record = this.records.get(tab.getId());
                if (record) moved.add(record);
              }
          }
        if (moved.size) this.movedPreviews.set(action, moved);
      },
      onAfterAction: (action) => this.modelChanged(action),
    };
    this.model.addChangeListener(this.modelListener);
    this.model.setOnAllowDrop(
      (drag, drop) =>
        this.links.allowsDrop(drag, drop.node, drop.location, drop.index) ??
        (this.allowMove(drag, drop.node, drop.location) &&
          (this.options.layoutPolicy?.allowsDrop(
            this.model,
            drag,
            drop.node,
            drop.location,
            drop.index,
          ) ??
            true)),
    );
    installIntegration(this, {
      model: this.model,
      store: this.store,
      getRecord: (id) => this.records.get(id),
      loadDocument: async (content) => {
        const record = this.recordFor(content);
        if (this.phase === "running" && record?.role === "document") await this.initialize(record);
      },
      registerController: (content, owner) => this.registerController(content, owner),
      updateController: (content, owner, controller) =>
        this.updateController(content, owner, controller),
      bindLayout: (getLayout, root) => this.bindLayout(getLayout, root),
      bindContentRoot: (content, root) => {
        const record = this.recordFor(content);
        if (record) {
          record.root = root ?? undefined;
          this.scheduleFocus();
        }
      },
      focus: (id, origin, intent) => this.observeFocus(id, origin, intent),
      setWindowFocus: (windowFocused) => {
        if (!windowFocused) this.cancelFocus();
        this.store.setState((state) => ({ ...state, windowFocused }));
      },
      modelAction: (action) => {
        if (this.links.consume(action)) return undefined;
        void this.dispatch(action).then((result) => this.reportResult(result));
        return undefined;
      },
      closeTargets: (target) => this.closeTargets(target),
      report: (error) => this.issue(error),
      reportResult: (result) => this.reportResult(result),
    });
  }

  private live(record: ContentRecord): boolean {
    return (
      !record.closed &&
      this.phase !== "disposed" &&
      this.records.get(record.id) === record &&
      this.model.getNodeById(record.id) === record.node
    );
  }
  private recordFor(handle: ContentHandle): ContentRecord | undefined {
    const record = this.records.get(handle.id);
    return record && record.handle === handle && this.live(record) ? record : undefined;
  }
  private makeRecord(node: TabNode, role: "document" | ToolDefinition): ContentRecord {
    const id = node.getId();
    if (this.records.has(id)) throw new TypeError(`Duplicate content ${id}`);
    const effects = new ContentEffects(
      () => {
        if (!this.live(record)) throw new Error("Content instance has ended");
      },
      (error) => this.issue(error, id),
    );
    const handle: ContentHandle = Object.freeze({ id, runEffect: effects.effect.bind(effects) });
    const base = {
      id,
      lifetime: crypto.randomUUID(),
      node,
      handle,
      effects,
      closed: false,
      manualTitle: false,
      owner: undefined,
      ownerRevision: 0,
      hadProtection: false,
      root: undefined,
      projection: undefined,
    };
    const record: ContentRecord =
      role === "document"
        ? {
            ...base,
            role: "document",
            href: "/",
            preview: false,
            key: undefined,
            accepted: undefined,
            acceptedRevision: 0,
            runtime: undefined,
            initialization: undefined,
            ready: false,
          }
        : { ...base, role: "tool", definition: role };
    this.records.set(id, record);
    return record;
  }
  private resolveTool(tab: IJsonTabNode): ToolDefinition | undefined {
    if (!tab.component || tab.component === DOCUMENT_COMPONENT) return;
    tabMetadata(tab);
    const definition =
      this.options.tools?.[tab.component] ??
      this.options.resolveTool?.(tab.component, structuredClone(tab));
    if (definition && typeof definition.render !== "function")
      throw new TypeError("Tool definitions require render");
    return definition;
  }
  private changed(persistent = false): void {
    this.store.setState((state) => ({
      ...state,
      lifecycle: this.phase,
      revision: state.revision + 1,
      snapshotRevision: state.snapshotRevision + Number(persistent),
    }));
  }
  private issue(error: unknown, id?: string): void {
    try {
      if (this.options.onIssue)
        this.options.onIssue({ code: "operation-failed", error, ...(id ? { id } : {}) });
      // eslint-disable-next-line no-console -- Unhandled native/resource issues remain observable.
      else console.error("Worksplit issue", error);
    } catch (reporterError) {
      // eslint-disable-next-line no-console -- A throwing host reporter cannot suppress the original issue.
      console.error("Worksplit issue reporter failed", reporterError, error);
    }
  }
  private reportResult(result: OperationResult<unknown>): void {
    // Coalesced native close observers share the same completed receipt.
    if (this.reportedResults.has(result)) return;
    this.reportedResults.add(result);
    if (result.status === "failed") this.issue(result.error);
    if (
      (result.status === "applied" || result.status === "failed") &&
      !this.reportedCleanups.has(result.cleanupErrors)
    ) {
      this.reportedCleanups.add(result.cleanupErrors);
      result.cleanupErrors.forEach((error) => this.issue(error));
    }
  }
  private modelChanged(action: Action): void {
    // The library listener precedes external observers: an admitted native Tab always
    // exposes its final record, even when an observer synchronously reenters.
    for (const [id, admit] of this.admissions) {
      const node = this.model.getNodeById(id);
      if (node instanceof TabNode) {
        this.admissions.delete(id);
        admit(node);
      }
    }
    for (const leaf of actionsIn(action)) {
      if (
        !this.autoTitle &&
        (leaf.type === Actions.RENAME_TAB ||
          (leaf.type === Actions.UPDATE_NODE_ATTRIBUTES &&
            Object.hasOwn(leaf.data.json ?? {}, "name")))
      ) {
        const record = this.records.get(leaf.data.node ?? leaf.data.tabNode);
        if (record) record.manualTitle = true;
      }
    }
    for (const record of this.records.values())
      if (record.role === "document" && record.preview && record.node.isPinned())
        record.preview = false;
    const moved = this.movedPreviews.get(action);
    this.movedPreviews.delete(action);
    for (const record of moved ?? [])
      if (record.role === "document" && record.preview) {
        const scope = this.previewScope(record.node);
        if (
          [...this.records.values()].some(
            (other) =>
              other !== record &&
              !moved?.has(other) &&
              other.role === "document" &&
              other.preview &&
              this.previewScope(other.node) === scope,
          )
        )
          record.preview = false;
      }
    const scopes = new Set<string>();
    // Native pin and moves end only the affected preview's replaceable status.
    for (const record of this.records.values())
      if (record.role === "document" && record.preview) {
        const scope = this.previewScope(record.node);
        if (scopes.has(scope)) record.preview = false;
        else scopes.add(scope);
      }
    const contextSource = this.store.get().source;
    const source = contextSource ? this.recordFor(contextSource) : undefined;
    if (source) {
      const containerId = tabContainer(source.node)?.getId() ?? null;
      if (containerId !== this.store.get().activeContainerId)
        this.store.setState((state) => ({ ...state, activeContainerId: containerId }));
    }
    this.changed(true);
    if (!this.selecting) {
      let selected: ContentRecord | undefined;
      const active = this.model.getActiveTabset()?.getSelectedNode();
      for (const leaf of actionsIn(action)) {
        if ([Actions.SELECT_TAB, Actions.MOVE_NODE, Actions.ADD_TAB].includes(leaf.type)) {
          const node = this.model.getNodeById(
            leaf.data.tabNode ?? leaf.data.fromNode ?? leaf.data.json?.id,
          );
          if (node instanceof TabNode && node.isSelected() && !closedGroup(node))
            selected = this.records.get(node.getId());
        }
        if (
          leaf.type === Actions.SET_ACTIVE_TABSET ||
          (active !== this.priorSelection.get(action) &&
            [
              Actions.MOVE_NODE,
              Actions.ADD_TAB_TO_NEW_GROUP,
              Actions.REMOVE_TAB_FROM_GROUP,
              Actions.UNGROUP,
              Actions.SET_TAB_PINNED,
              Actions.UPDATE_NODE_ATTRIBUTES,
            ].includes(leaf.type))
        ) {
          // Moving a tab into an open Border may select it independently of the central
          // Tabset. A native group move, collapse or removal follows the final central selection.
          if (
            !(
              leaf.type === Actions.MOVE_NODE &&
              selected?.node === this.model.getNodeById(leaf.data.fromNode)
            )
          )
            selected = active instanceof TabNode ? this.records.get(active.getId()) : undefined;
        }
      }
      if (selected && this.live(selected)) {
        this.browser?.cancelPending();
        this.cancelFocus();
        this.acceptActivity(selected, false);
        if (selected.role === "document") this.publishActive("activate");
      }
    }
    this.priorSelection.delete(action);
  }

  getContent(id: string): ContentInfo | null {
    const record = this.records.get(id);
    if (!record || !this.live(record)) return null;
    const container = tabContainer(record.node);
    const parent = record.node.getParent();
    const max = this.model.getMaximizedTabset();
    const visible =
      !!this.view &&
      !!container &&
      record.node.isSelected() &&
      !closedGroup(record.node) &&
      (container instanceof BorderNode ? container.isShowing() : !max || max === container);
    const fields: ContentInfo = {
      id,
      handle: record.handle,
      role: record.role,
      node: record.node,
      containerId: container?.getId() ?? null,
      tabGroupId: parent instanceof TabGroupNode ? parent.getId() : null,
      title: record.node.getName(),
      visible,
    };
    const next: ContentInfo =
      record.role === "document"
        ? ({
            ...fields,
            role: "document",
            href: record.href,
            preview: record.preview,
            navigationKey: this.routeMetadata(record, "navigationKey") ?? null,
          } as DocumentInfo)
        : fields;
    const previous = record.projection;
    if (
      previous &&
      Object.keys(next).every((key) =>
        Object.is(Reflect.get(next, key), Reflect.get(previous, key)),
      )
    )
      return previous;
    record.projection = Object.freeze(next);
    return record.projection;
  }
  getDocument(id: string): DocumentInfo | null {
    const content = this.getContent(id);
    return content?.role === "document" ? (content as DocumentInfo) : null;
  }
  getDocuments(): readonly DocumentInfo[] {
    const next = [...this.records.values()].flatMap((record) => {
      const doc = this.getDocument(record.id);
      return doc ? [doc] : [];
    });
    if (!same(next, this.projections)) this.projections = Object.freeze(next);
    return this.projections;
  }
  getActiveDocument(): DocumentInfo | null {
    const id = this.store.get().activeDocumentId;
    return id ? this.getDocument(id) : null;
  }
  getContainers(): readonly ContainerInfo[] {
    const nodes: (TabSetNode | BorderNode)[] = [...centralTabsets(this.model)];
    this.model.visitNodes((node) => {
      if (node instanceof BorderNode) nodes.push(node);
    });
    const next = nodes.map((node) => {
      const selected = node.getSelectedNode();
      const tabIds = tabsIn(node).map((tab) => tab.getId());
      const selectedId = selected instanceof TabNode ? selected.getId() : null;
      const previous = this.containers.find((item) => item.node === node);
      return previous && previous.selectedId === selectedId && same(previous.tabIds, tabIds)
        ? previous
        : Object.freeze({
            id: node.getId(),
            kind: node instanceof BorderNode ? ("border" as const) : ("tabset" as const),
            node,
            tabIds: Object.freeze(tabIds),
            selectedId,
          });
    });
    if (!same(next, this.containers)) this.containers = Object.freeze(next);
    return this.containers;
  }
  getContext(): WorkbenchContext {
    const { activeDocumentId, activeContainerId, focusedContentId, source, windowFocused } =
      this.store.get();
    const next = { activeDocumentId, activeContainerId, focusedContentId, source, windowFocused };
    if (
      !this.context ||
      Object.keys(next).some((key) => Reflect.get(next, key) !== Reflect.get(this.context!, key))
    )
      this.context = Object.freeze(next);
    return this.context;
  }

  private registerController(content: ContentHandle, owner: ControllerOwner): () => void {
    const record = this.recordFor(content);
    if (!record) throw new Error("Cannot register a controller on ended content");
    if (record.owner && record.owner !== owner)
      throw new Error("Content already has a controller owner");
    record.owner = owner;
    record.ownerRevision++;
    record.hadProtection ||= owner.controller.leave !== null;
    this.updateTitle(record);
    this.scheduleFocus();
    this.changed();
    return () => {
      if (record.owner !== owner) return;
      record.owner = undefined;
      record.ownerRevision++;
      this.endAttempts(record, true).forEach((error) => this.issue(error, record.id));
      if (this.focusRequest?.record === record && this.focusRequest.owner === owner)
        this.cancelFocus();
      this.changed();
    };
  }
  private updateController(
    content: ContentHandle,
    owner: ControllerOwner,
    controller: ContentController,
  ): void {
    if (!controller || !Object.hasOwn(controller, "leave") || controller.leave === undefined)
      throw new TypeError("Controllers must declare leave explicitly");
    if (
      controller.leave &&
      (typeof controller.leave.getState !== "function" ||
        typeof controller.leave.decide !== "function")
    )
      throw new TypeError("A leave guard requires getState and decide");
    const record = this.recordFor(content);
    const shapeChanged = (owner.controller.leave === null) !== (controller.leave === null);
    owner.controller = controller;
    if (!record || record.owner !== owner) return;
    if (shapeChanged) {
      record.ownerRevision++;
      this.endAttempts(record, true).forEach((error) => this.issue(error, record.id));
    }
    record.hadProtection ||= controller.leave !== null;
    this.updateTitle(record);
    this.scheduleFocus();
    if (shapeChanged) this.changed();
  }
  private newAttempt(record?: ContentRecord): LeaveAttempt {
    const attempt = new LeaveAttempt((error) => this.issue(error, record?.id));
    this.attempts.set(attempt, { record, committed: false });
    attempt.signal.addEventListener(
      "abort",
      () => {
        this.attempts.delete(attempt);
      },
      { once: true },
    );
    return attempt;
  }
  private endAttempts(record: ContentRecord, pendingOnly = false): unknown[] {
    return LeaveAttempt.end(
      [...this.attempts]
        .filter(([, state]) => state.record === record && (!pendingOnly || !state.committed))
        .map(([attempt]) => attempt),
    );
  }
  private beginApproval(
    record: ContentRecord,
    reason: LeaveRequest["reason"],
    to?: ParsedLocation,
    destination: string | null = null,
  ): Approval {
    const attempt = this.newAttempt(record);
    const owner = record.owner;
    const revision = record.ownerRevision;
    const locationRevision = record.role === "document" ? record.acceptedRevision : 0;
    let token: LeaveToken | undefined;
    let allowed = false;
    const guard = owner?.controller.leave;
    const validate = () =>
      this.live(record) &&
      !attempt.signal.aborted &&
      record.owner === owner &&
      record.ownerRevision === revision &&
      (record.role !== "document" || record.acceptedRevision === locationRevision) &&
      (guard
        ? allowed && Object.is(stateOf(owner!.controller.leave!).token, token)
        : !record.hadProtection || !!owner);
    const decision = (async () => {
      if (!this.live(record) || (!owner && record.hadProtection)) return false;
      if (!guard) {
        allowed = true;
        return true;
      }
      const state = stateOf(guard);
      const location =
        record.role === "document"
          ? (record.accepted ?? record.runtime?.router.state.resolvedLocation ?? null)
          : null;
      const detail =
        reason === "navigate"
          ? { reason, from: location!, to: to! }
          : reason === "leave-workspace"
            ? { reason, location, destination }
            : { reason, location };
      const result: LeaveDecision = await guard.decide({
        ...detail,
        content: record.handle,
        state,
        signal: attempt.signal,
        defer: attempt.defer,
      } as LeaveRequest);
      if (result?.decision !== "allow") return false;
      validToken(result.token);
      token = result.token;
      allowed = true;
      return !attempt.signal.aborted;
    })();
    const cancelled = new Promise<false>((resolve) => {
      if (attempt.signal.aborted) resolve(false);
      else attempt.signal.addEventListener("abort", () => resolve(false), { once: true });
    });
    return {
      attempt,
      decision: Promise.race([decision, cancelled]),
      validate,
      finish: () => LeaveAttempt.end([attempt]),
      committed: () => {
        const state = this.attempts.get(attempt);
        if (state) state.committed = true;
      },
    };
  }

  private bindLayout(getLayout: () => ILayoutApi | null, root: HTMLElement): () => void {
    if (this.view) throw new Error("A Worksplit instance can bind only one Layout");
    const binding = { getLayout, root };
    const stopLinks = this.links.attach(getLayout);
    this.view = binding;
    this.changed();
    this.scheduleFocus();
    return () => {
      if (this.view !== binding) return;
      stopLinks();
      this.view = undefined;
      this.cancelFocus();
      this.changed();
    };
  }
  private cancelFocus(): void {
    this.focusEpoch++;
    this.focusRequest?.cancel?.();
    this.focusRequest = undefined;
  }
  private scheduleFocus(): void {
    const request = this.focusRequest;
    if (!request || !this.view || !request.record.root || request.cancel) return;
    const win = request.record.root.ownerDocument.defaultView;
    const run = () => {
      delete request.cancel;
      if (
        this.focusRequest !== request ||
        request.epoch !== this.focusEpoch ||
        !this.live(request.record) ||
        !this.view ||
        !request.record.root ||
        (request.owner && request.record.owner !== request.owner)
      )
        return;
      this.focusRequest = undefined;
      this.focusing = true;
      try {
        (
          request.callback ??
          request.record.owner?.controller.focus ??
          (() => request.record.root?.focus())
        )();
      } catch (error) {
        this.issue(error, request.record.id);
      } finally {
        this.focusing = false;
      }
    };
    if (win) {
      const frame = win.requestAnimationFrame(run);
      request.cancel = () => win.cancelAnimationFrame(frame);
    } else queueMicrotask(run);
  }
  private observeFocus(
    id: string | null,
    origin: "content" | "chrome" | "outside",
    intent = false,
  ): void {
    const record = id ? this.records.get(id) : undefined;
    const changedSource = !!record && this.store.get().source !== record.handle;
    if (!this.focusing && origin !== "chrome" && (origin === "outside" || intent || changedSource))
      this.cancelFocus();
    if (record && this.live(record) && origin === "content") {
      // Closing a native dialog restores focus to its opener. Returning to the
      // same source must not revoke that document's pending browser traversal.
      if (!this.focusing && (intent || changedSource)) this.browser?.cancelPending();
      this.acceptActivity(record, false);
      if (!this.focusing && (intent || changedSource) && record.role === "document")
        this.publishActive("activate");
    }
    this.store.setState((state) => ({
      ...state,
      focusedContentId: record?.id ?? null,
      source: record?.handle ?? state.source,
      windowFocused: origin !== "outside" || state.windowFocused,
    }));
  }
  private acceptActivity(record: ContentRecord, focus: boolean, callback?: () => void): void {
    const container = tabContainer(record.node);
    const before = this.store.get().activeDocumentId;
    if (record.role === "document") {
      const at = this.mru.indexOf(record.id);
      if (at >= 0) this.mru.splice(at, 1);
      this.mru.unshift(record.id);
    }
    this.store.setState((state) => ({
      ...state,
      activeDocumentId: record.role === "document" ? record.id : state.activeDocumentId,
      activeContainerId: container?.getId() ?? null,
      source: record.handle,
      snapshotRevision:
        state.snapshotRevision + Number(record.role === "document" && before !== record.id),
    }));
    if (focus) {
      this.cancelFocus();
      this.focusRequest = {
        record,
        epoch: this.focusEpoch,
        owner: record.owner,
        ...(callback ? { callback } : {}),
      };
      this.scheduleFocus();
    }
  }
  private routeMetadata(
    record: DocumentRecord,
    field: "title" | "navigationKey",
  ): string | undefined {
    return record.runtime?.router.state.matches
      .toReversed()
      .find((match) => match.staticData?.worksplit?.[field] !== undefined)?.staticData.worksplit?.[
      field
    ];
  }
  private updateTitle(record: ContentRecord): void {
    if (record.manualTitle || !this.live(record)) return;
    const title =
      record.owner?.controller.title ??
      (record.role === "document"
        ? (this.routeMetadata(record, "title") ?? record.href)
        : record.definition.title);
    if (title === undefined || title === record.node.getName()) return;
    this.autoTitle++;
    try {
      this.model.doAction(Actions.renameTab(record.id, title));
    } finally {
      this.autoTitle--;
    }
  }
  private previewScope(node: Node): string {
    return this.options.previewScope === "workspace"
      ? "workspace"
      : (tabContainer(node)?.getId() ?? node.getId());
  }

  private identity(router: AnyRouter, location: ParsedLocation): string {
    const matches = router.matchRoutes(location);
    const owner = matches
      .toReversed()
      .find((match) => match.staticData?.worksplit?.documentKey !== undefined);
    if (owner) {
      const key = owner.staticData.worksplit!.documentKey!({
        params: owner.params,
        search: owner.search,
        location,
      });
      if (typeof key !== "string" || !key)
        throw new TypeError("documentKey must return a nonempty string");
      return JSON.stringify(["route", owner.routeId, key]);
    }
    return JSON.stringify(["url", location.pathname, location.searchStr]);
  }
  private findDocument(
    key: string,
    matcher: AnyRouter,
    exclude?: DocumentRecord,
  ): DocumentRecord | undefined {
    const candidates = [...this.records.values()].filter((record): record is DocumentRecord => {
      if (record.role !== "document" || record === exclude || !this.live(record)) return false;
      if (record.key === undefined) {
        const history = createMemoryHistory({ initialEntries: [record.href] });
        try {
          record.key = this.identity(matcher, matcher.parseLocation(history.location));
        } finally {
          history.destroy();
        }
      }
      return record.key === key;
    });
    const active = candidates.find((record) => record.id === this.store.get().activeDocumentId);
    if (active) return active;
    for (const id of this.mru) {
      const candidate = candidates.find((record) => record.id === id);
      if (candidate) return candidate;
    }
    const selected = this.model.getActiveTabset()?.getSelectedNode();
    return candidates.find((record) => record.node === selected) ?? candidates[0];
  }
  private runtime(href: string, existing?: DocumentRecord, source?: BrowserVisitSource) {
    let owner = existing;
    const runtime: DocumentRuntime<AnyRouter> = createDocumentRuntime<AnyRouter>({
      href,
      createRouter: this.options.createRouter,
      isCurrent: (): boolean =>
        this.phase !== "disposed" && (owner ? this.live(owner) : this.pendingRouters.has(runtime)),
      beginNavigation: ({ to, navigation }) => {
        if (!owner)
          return {
            decision: true,
            validate: () => this.phase !== "disposed" && !source?.signal.aborted,
            finish: () => [],
          };
        const approval = this.beginApproval(owner, "navigate", to);
        const visit = this.browserRequests.get(navigation);
        if (!visit?.pending) return approval;
        let cancel!: (allowed: boolean) => void;
        const cancelled = new Promise<boolean>((resolve) => {
          cancel = resolve;
        });
        const abort = () => cancel(false);
        visit.signal.addEventListener("abort", abort, { once: true });
        if (visit.signal.aborted) abort();
        return {
          decision: Promise.race([approval.decision, cancelled]),
          validate: () =>
            !visit.signal.aborted && (!visit.pending || visit.current()) && approval.validate(),
          committed: () => approval.committed?.(),
          finish: () => {
            visit.signal.removeEventListener("abort", abort);
            return approval.finish();
          },
        };
      },
      onAccepted: (location, navigation) => {
        if (owner && this.live(owner)) this.acceptLocation(owner, location, navigation);
      },
      onIssue: (error) => this.issue(error, owner?.id),
    });
    if (!existing) this.pendingRouters.add(runtime);
    const cancelCandidate = () => {
      if (owner) return;
      this.pendingRouters.delete(runtime);
      runtime.dispose().forEach((error) => this.issue(error));
    };
    source?.signal.addEventListener("abort", cancelCandidate, { once: true });
    runtime.history.signal.addEventListener(
      "abort",
      () => source?.signal.removeEventListener("abort", cancelCandidate),
      { once: true },
    );
    if (source?.signal.aborted) cancelCandidate();
    return {
      runtime,
      adopt: (record: DocumentRecord) => {
        source?.signal.removeEventListener("abort", cancelCandidate);
        owner = record;
        this.pendingRouters.delete(runtime);
        record.runtime = runtime;
      },
    };
  }
  private acceptLocation(
    record: DocumentRecord,
    location: ParsedLocation,
    navigation?: NativeNavigation,
  ): void {
    const changed =
      record.accepted?.state["__TSR_key"] !== location.state["__TSR_key"] ||
      record.href !== location.publicHref;
    record.accepted = location;
    record.href = location.publicHref;
    if (changed) record.acceptedRevision++;
    record.key = undefined;
    try {
      record.key = this.identity(record.runtime!.router, location);
      this.updateTitle(record);
    } finally {
      this.changed(changed);
    }
    if (
      changed &&
      navigation &&
      record.ready &&
      this.store.get().activeDocumentId === record.id &&
      !this.browserRequests.get(navigation)?.pending
    ) {
      let original = navigation;
      while (original.parent) original = original.parent;
      this.browser?.publish(record.href, this.reference(record), original.action === "REPLACE");
    }
  }
  private publishActive(reason: "open" | "activate" | "close"): void {
    if (!this.browser) return;
    const active = this.store.get().activeDocumentId;
    const record = active ? this.records.get(active) : undefined;
    const href = record?.role === "document" ? record.href : this.options.home?.href;
    if (href === undefined) return;
    this.browser.publish(
      href,
      record?.role === "document" ? this.reference(record) : undefined,
      reason !== "open" || this.browser.acceptedHref === href,
    );
  }
  private initialize(record: DocumentRecord): Promise<void> {
    if (record.ready) return Promise.resolve();
    if (record.initialization) return record.initialization;
    record.initialization = (async () => {
      if (!this.live(record)) return;
      const runtime = record.runtime ?? this.runtime(record.href, record).runtime;
      record.runtime = runtime;
      const result = await runtime.start();
      if (result.status === "failed") throw result.error;
      if (result.status !== "accepted" || !this.live(record)) return;
      record.ready = true;
      if (runtime.acceptedLocation) this.acceptLocation(record, runtime.acceptedLocation);
      this.changed();
    })();
    return record.initialization;
  }

  private captureOpen(
    options: OpenOptions,
  ): OpenCapture | { status: "denied"; reason: DenialReason } {
    const presentation = options.presentation ?? "activate";
    if (
      !["activate", "reveal", "background"].includes(presentation) ||
      (presentation === "background" && options.preview)
    )
      return denied("invalid-argument");
    const source = options.source
      ? this.recordFor(options.source)
      : this.store.get().source
        ? this.recordFor(this.store.get().source!)
        : undefined;
    if (options.source && !source) return denied("missing-content");
    if (presentation === "reveal" && !source) return denied("focus-conflict");
    const sourceContainer = source ? tabContainer(source.node) : undefined;
    const anchor =
      sourceContainer instanceof TabSetNode
        ? sourceContainer
        : (this.model.getActiveTabset() ?? centralTabsets(this.model)[0]);
    let destination: OpenCapture["destination"];
    if (options.destination && typeof options.destination !== "function") {
      const target = this.model.getNodeById(options.destination.target);
      if (!target) return denied("layout-policy");
      destination = {
        value: { ...options.destination },
        target,
        children: [...target.getChildren()],
      };
    }
    return {
      source,
      sourceContainer,
      anchor,
      destination,
      focus: this.focusEpoch,
      order: 0,
      presentation,
    };
  }
  private claimOpen(capture: OpenCapture, browser = false): void {
    if (capture.presentation === "activate") {
      if (!browser) this.browser?.cancelPending();
      this.cancelFocus();
    }
    capture.focus = this.focusEpoch;
    capture.order = ++this.sequence;
  }
  private captureCurrent(capture: OpenCapture): boolean {
    return (
      this.phase !== "disposed" &&
      (!capture.current || capture.current()) &&
      (!capture.source ||
        (this.live(capture.source) &&
          tabContainer(capture.source.node) === capture.sourceContainer)) &&
      (!capture.anchor || this.model.getNodeById(capture.anchor.getId()) === capture.anchor) &&
      (!capture.destination ||
        (this.model.getNodeById(capture.destination.target.getId()) ===
          capture.destination.target &&
          (capture.destination.value.index === undefined ||
            capture.destination.value.index < 0 ||
            same(capture.destination.children, capture.destination.target.getChildren()))))
    );
  }
  private openPresentation(capture: OpenCapture, preview: boolean | undefined) {
    if (capture.presentation === "background" || capture.focus === this.focusEpoch)
      return capture.presentation;
    return capture.presentation === "activate" && !preview ? "background" : null;
  }
  private canPlace(
    tab: IJsonTabNode,
    destination: Destination,
    capture: OpenCapture,
    presentation = capture.presentation,
  ): boolean {
    if (!this.captureCurrent(capture)) return false;
    const target = this.model.getNodeById(destination.target);
    const location = destination.location;
    if (
      !target ||
      ![
        DockLocation.CENTER,
        DockLocation.LEFT,
        DockLocation.RIGHT,
        DockLocation.TOP,
        DockLocation.BOTTOM,
      ].includes(location)
    )
      return false;
    if (
      destination.index !== undefined &&
      (!Number.isSafeInteger(destination.index) || destination.index < -1)
    )
      return false;
    if (target instanceof BorderNode || target instanceof TabGroupNode) {
      if (
        location !== DockLocation.CENTER ||
        destination.ratio !== undefined ||
        (target instanceof TabGroupNode && tab.pinned)
      )
        return false;
    } else if (target instanceof RowNode) {
      if (
        target !== this.model.getRootRow() ||
        centralTabsets(this.model).length ||
        location !== DockLocation.CENTER
      )
        return false;
    } else if (!(target instanceof TabSetNode)) return false;
    if (
      destination.ratio !== undefined &&
      (!(target instanceof TabSetNode) ||
        location === DockLocation.CENTER ||
        !Number.isFinite(destination.ratio) ||
        destination.ratio <= 0 ||
        destination.ratio >= 1)
    )
      return false;
    const container =
      target instanceof TabSetNode || target instanceof BorderNode ? target : tabContainer(target);
    if (container && !container.isEnableDrop()) return false;
    if (
      target instanceof TabSetNode &&
      location !== DockLocation.CENTER &&
      !target.isEnableDivide()
    )
      return false;
    if (
      destination.index !== undefined &&
      destination.index >= 0 &&
      destination.index > target.getChildren().length
    )
      return false;
    if (
      presentation === "reveal" &&
      (capture.focus !== this.focusEpoch ||
        !capture.source ||
        (container === capture.sourceContainer && location === DockLocation.CENTER) ||
        (this.model.getMaximizedTabset() &&
          (!(container instanceof BorderNode) || capture.sourceContainer instanceof TabSetNode)))
    )
      return false;
    if (
      presentation === "background" &&
      (!(container instanceof TabSetNode || container instanceof BorderNode) ||
        location !== DockLocation.CENTER ||
        !container.getSelectedNode())
    )
      return false;
    const action = Actions.addTab(
      tab,
      destination.target,
      location,
      destination.index ?? -1,
      presentation !== "background",
    );
    if (this.options.layoutPolicy && !this.options.layoutPolicy.allowsAction(this.model, action))
      return false;
    if (this.options.allowDrop) {
      const temporary = Model.fromJson({
        global: this.model.getGlobalAttributes(),
        layout: { type: "row", children: [{ type: "tabset", children: [tab] }] },
      });
      const node = temporary.getNodeById(tab.id!);
      if (!(node instanceof TabNode) || !this.allowMove(node, target, location)) return false;
    }
    return true;
  }
  private defaultDestination(capture: OpenCapture): Destination | null {
    const target = capture.anchor ?? centralTabsets(this.model)[0] ?? this.model.getRootRow();
    return target ? { target: target.getId(), location: DockLocation.CENTER } : null;
  }

  open<const TFrom extends string = string, const TTo extends string | undefined = ".">(
    navigation: DocumentNavigationOptions<TRouter, TFrom, TTo>,
    options: OpenOptions = {},
  ): Promise<OpenResult> {
    return this.openDocument(navigation as unknown as RuntimeNavigation, options);
  }
  private async openDocument(
    navigation: RuntimeNavigation,
    options: OpenOptions,
    request: { starting?: boolean; capture?: OpenCapture; browser?: BrowserVisitSource } = {},
  ): Promise<OpenResult> {
    if (this.phase !== "running" && !(request.starting && this.phase === "starting"))
      return denied("not-ready");
    const source = request.browser;
    let prepared: ReturnType<WorkbenchSession<TRouter>["runtime"]> | undefined;
    let previewApproval: Approval | undefined;
    let oldPreview: DocumentRecord | undefined;
    let removedPreview: DocumentRecord | undefined;
    let admitted: DocumentRecord | undefined;
    const cleanupErrors: unknown[] = [];
    try {
      if (
        !validNavigation(navigation) ||
        (options.reuse !== undefined && !["preserve", "navigate", "new"].includes(options.reuse))
      )
        return denied("invalid-argument");
      const capture = request.capture ?? this.captureOpen(options);
      if ("status" in capture) return capture;
      if (source) capture.current = source.current;
      if (!this.captureCurrent(capture)) return superseded;
      prepared = this.runtime(
        capture.source?.role === "document"
          ? capture.source.href
          : (this.options.home?.href ?? "/"),
        undefined,
        source,
      );
      const router = prepared.runtime.router;
      const location = router.buildLocation(
        navigation as Parameters<AnyRouter["buildLocation"]>[0],
      );
      if (location.external) return denied("invalid-argument");
      checkHref(location.publicHref);
      const requestedKey = this.identity(router, location);
      if (!this.captureCurrent(capture)) return superseded;
      // Plain targets fail their synchronous URL/key validation before claiming intent.
      // A lazy entrance already claimed the same capture before awaiting its resolver.
      if (!capture.order) this.claimOpen(capture, !!source);
      const reuse = options.reuse ?? "preserve";
      const useExisting = async (record: DocumentRecord): Promise<OpenResult> => {
        if (!this.captureCurrent(capture)) return superseded;
        await this.initialize(record);
        if (!this.captureCurrent(capture) || !this.live(record)) return superseded;
        let navigated = false;
        if (reuse === "navigate") {
          if (capture.presentation === "reveal" && record === capture.source)
            return denied("focus-conflict");
          const result = await record.runtime!.navigate(navigation);
          cleanupErrors.push(...result.cleanupErrors);
          if (result.status === "failed") return failed(result.error, "prepare", [], cleanupErrors);
          if (result.status === "denied") {
            cleanupErrors.forEach((error) => this.issue(error));
            return denied("decision");
          }
          if (result.status === "superseded") {
            cleanupErrors.forEach((error) => this.issue(error));
            return superseded;
          }
          navigated = true;
        }
        if (
          !this.captureCurrent(capture) ||
          (capture.presentation !== "background" && capture.focus !== this.focusEpoch)
        ) {
          return navigated && this.live(record)
            ? applied(
                {
                  document: this.getDocument(record.id)!,
                  reused: true,
                  presentation: "background",
                },
                cleanupErrors,
              )
            : superseded;
        }
        const result = this.present(record, capture.presentation, capture.source);
        if (result.status !== "applied") return result;
        if (!options.preview) record.preview = false;
        this.changed(true);
        if (capture.presentation === "activate" && !source) this.publishActive("activate");
        return applied(
          {
            document: this.getDocument(record.id)!,
            reused: true,
            presentation: capture.presentation,
          },
          cleanupErrors,
        );
      };
      if (reuse !== "new") {
        const match = this.findDocument(requestedKey, router);
        if (match) return await useExisting(match);
      }
      const loaded = await prepared.runtime.navigate({ ...navigation, replace: true });
      cleanupErrors.push(...loaded.cleanupErrors);
      if (loaded.status === "failed") return failed(loaded.error, "prepare", [], cleanupErrors);
      if (loaded.status === "denied") return denied("decision");
      if (loaded.status !== "accepted" || !this.captureCurrent(capture)) return superseded;
      const accepted = prepared.runtime.acceptedLocation;
      if (!accepted) return failed(new Error("Router did not accept a location"));
      const key = this.identity(router, accepted);
      if (reuse !== "new") {
        const match = this.findDocument(key, router);
        if (match) return await useExisting(match);
      }
      const initialPresentation = this.openPresentation(capture, options.preview);
      if (!initialPresentation) return superseded;
      let presentation = initialPresentation;
      const id = `document-${this.prefix}-${++this.sequence}`;
      const title =
        router.state.matches
          .toReversed()
          .find((match) => match.staticData?.worksplit?.title !== undefined)?.staticData.worksplit
          ?.title ?? accepted.publicHref;
      const tab: IJsonTabNode = {
        type: "tab",
        id,
        component: DOCUMENT_COMPONENT,
        name: title,
        enableFloat: false,
        enablePopout: false,
      };
      const context: PlacementContext = {
        model: this.model,
        source: capture.source ? this.getContent(capture.source.id) : null,
        anchor: capture.anchor ?? null,
        containers: this.getContainers(),
        previews: this.getDocuments().filter((doc) => doc.preview),
        mru: [...this.mru],
        defaultDestination: this.defaultDestination(capture),
        canPlace: (destination) => this.canPlace(tab, destination, capture, presentation),
      };
      const destination =
        typeof options.destination === "function"
          ? options.destination(context)
          : (capture.destination?.value ?? context.defaultDestination);
      if (!destination || !this.canPlace(tab, destination, capture, presentation))
        return denied("layout-policy");
      const target = this.model.getNodeById(destination.target)!;
      const targetChildren = [...target.getChildren()];
      const scope =
        this.options.previewScope === "workspace"
          ? this.model
          : destination.location === DockLocation.CENTER
            ? (tabContainer(target) ?? target)
            : undefined;
      if (options.preview && scope) {
        if ((this.previewEpochs.get(scope) ?? 0) > capture.order) return superseded;
        this.previewEpochs.set(scope, capture.order);
        oldPreview = [...this.records.values()].find(
          (record): record is DocumentRecord =>
            record.role === "document" &&
            record.preview &&
            (scope === this.model || tabContainer(record.node) === scope),
        );
        if (oldPreview) {
          if (
            !(
              oldPreview.owner?.controller.leave &&
              stateOf(oldPreview.owner.controller.leave).hasUnsavedChanges
            )
          ) {
            previewApproval = this.beginApproval(oldPreview, "replace-preview");
            await previewApproval.decision;
          }
        }
      }
      if (
        !this.captureCurrent(capture) ||
        this.model.getNodeById(destination.target) !== target ||
        (destination.index !== undefined &&
          destination.index >= 0 &&
          !same(targetChildren, target.getChildren())) ||
        (options.preview && scope && this.previewEpochs.get(scope) !== capture.order)
      )
        return superseded;
      const finalPresentation = this.openPresentation(capture, options.preview);
      if (!finalPresentation) return superseded;
      presentation = finalPresentation;
      if (!this.canPlace(tab, destination, capture, presentation)) return denied("layout-policy");
      const action = Actions.addTab(
        tab,
        destination.target,
        destination.location,
        destination.index ?? -1,
        presentation !== "background",
      );
      let commitError: unknown;
      const admission: { record?: DocumentRecord } = {};
      this.admissions.set(id, (node) => {
        const record = this.makeRecord(node, "document") as DocumentRecord;
        prepared!.adopt(record);
        record.ready = true;
        record.accepted = accepted;
        record.acceptedRevision = 1;
        record.href = accepted.publicHref;
        record.key = key;
        admission.record = record;
      });
      this.selecting++;
      try {
        this.model.doAction(action);
      } catch (error) {
        commitError = error;
      } finally {
        this.selecting--;
        this.admissions.delete(id);
      }
      admitted = admission.record;
      if (!admitted)
        return failed(commitError ?? new Error("Native ADD did not admit content"), "commit");
      if (!this.live(admitted))
        return failed(
          commitError ?? new Error("Admitted content ended during native observers"),
          "commit",
          [id],
        );
      const node = admitted.node;
      if (destination.ratio !== undefined && target instanceof TabSetNode) {
        const added = tabContainer(node);
        if (!(added instanceof TabSetNode) || added === target)
          commitError ??= new Error("Native split did not create a new TabSet");
        else
          try {
            applySplitRatio(this.model, target, added, destination.ratio);
          } catch (error) {
            commitError ??= error;
          }
      }
      const presented = this.present(admitted, presentation, capture.source);
      if (presented.status !== "applied")
        commitError ??= new Error(`Admitted content could not use ${presentation} presentation`);
      if (oldPreview && this.live(oldPreview)) {
        if (
          oldPreview.preview &&
          previewApproval &&
          previewApproval.validate() &&
          oldPreview.node.isEnableClose() &&
          !oldPreview.node.isPinned()
        ) {
          try {
            this.model.doAction(Actions.deleteTab(oldPreview.id));
          } catch (error) {
            commitError ??= error;
          }
          if (this.model.getNodeById(oldPreview.id) !== oldPreview.node)
            removedPreview = oldPreview;
          else oldPreview.preview = false;
        } else oldPreview.preview = false;
      }
      admitted.preview = options.preview === true && !admitted.node.isPinned();
      if (previewApproval) {
        cleanupErrors.push(...previewApproval.finish());
        previewApproval = undefined;
      }
      this.changed(true);
      if (presentation === "activate" && !source) this.publishActive("open");
      // Publish this commit before ending old effects: their cleanup can reenter,
      // and an asynchronous cleanup must not delay preview state or browser URL.
      const document = this.getDocument(admitted.id);
      if (!document) commitError ??= new Error("Admitted content ended during commit");
      if (removedPreview) {
        const retired = removedPreview;
        removedPreview = undefined;
        cleanupErrors.push(...(await this.release([retired])));
      }
      if (commitError) return failed(commitError, "commit", [admitted.id], cleanupErrors);
      return applied({ document: document!, reused: false, presentation }, cleanupErrors);
    } catch (error) {
      if (removedPreview) {
        const retired = removedPreview;
        removedPreview = undefined;
        cleanupErrors.push(...(await this.release([retired])));
      }
      return failed(
        error,
        admitted ? "commit" : "prepare",
        admitted ? [admitted.id] : [],
        cleanupErrors,
      );
    } finally {
      if (previewApproval) previewApproval.finish().forEach((error) => this.issue(error));
      if (prepared && this.pendingRouters.delete(prepared.runtime))
        prepared.runtime.dispose().forEach((error) => this.issue(error));
    }
  }

  private present(
    record: ContentRecord,
    presentation: "activate" | "reveal" | "background",
    source?: ContentRecord,
    focus?: () => void,
  ): OperationResult<ContentInfo> {
    if (!this.live(record)) return denied("missing-content");
    if (presentation === "background") return applied(this.getContent(record.id)!);
    const container = tabContainer(record.node);
    if (
      presentation === "reveal" &&
      (!source ||
        !this.live(source) ||
        tabContainer(source.node) === container ||
        (this.model.getMaximizedTabset() && container instanceof TabSetNode))
    )
      return denied("focus-conflict");
    this.selecting++;
    try {
      revealTab(this.model, record.node);
      if (presentation === "activate") {
        const max = this.model.getMaximizedTabset();
        if (max && container instanceof TabSetNode && max !== container)
          this.model.doAction(Actions.maximizeToggle(container.getId()));
        if (container instanceof TabSetNode)
          this.model.doAction(Actions.setActiveTabset(container.getId()));
        this.acceptActivity(record, true, focus);
      }
    } catch (error) {
      return failed(error, "commit", [record.id]);
    } finally {
      this.selecting--;
    }
    return applied(this.getContent(record.id)!);
  }
  async activate(id: string, options: ActivateOptions = {}): Promise<OperationResult<ContentInfo>> {
    if (this.phase !== "running") return denied("not-ready");
    this.browser?.cancelPending();
    const record = this.records.get(id);
    if (!record || !this.live(record)) return denied("missing-content");
    try {
      const source = options.source
        ? this.recordFor(options.source)
        : this.store.get().source
          ? this.recordFor(this.store.get().source!)
          : undefined;
      if (options.source && !source) return denied("missing-content");
      const result = this.present(
        record,
        options.presentation ?? "activate",
        source,
        options.focus,
      );
      if (
        result.status === "applied" &&
        options.presentation !== "reveal" &&
        record.role === "document"
      )
        this.publishActive("activate");
      return result;
    } catch (error) {
      return failed(error);
    }
  }
  keepOpen(id: string): Promise<OperationResult<DocumentInfo>> {
    if (this.phase !== "running") return Promise.resolve(denied("not-ready"));
    const record = this.records.get(id);
    if (!record || record.role !== "document" || !this.live(record))
      return Promise.resolve(denied("missing-content"));
    if (record.preview) {
      record.preview = false;
      this.changed(true);
    }
    return Promise.resolve(applied(this.getDocument(id)!));
  }
  duplicate(id: string, options: Omit<OpenOptions, "reuse" | "preview"> = {}): Promise<OpenResult> {
    const doc = this.getDocument(id);
    if (!doc) return Promise.resolve(denied("missing-content"));
    return this.open({ href: doc.href } as DocumentNavigationOptions<TRouter>, {
      source: doc.handle,
      ...options,
      reuse: "new",
      preview: false,
    });
  }
  async save(id: string): Promise<OperationResult<void>> {
    if (this.phase !== "running") return denied("not-ready");
    const record = this.records.get(id);
    if (!record || !this.live(record)) return denied("missing-content");
    const save = record.owner?.controller.save;
    if (!save) return denied("missing-capability");
    try {
      await save();
      return applied(undefined);
    } catch (error) {
      return failed(error);
    }
  }

  private closeTargets(target: CloseTarget): readonly TabNode[] | null {
    if (typeof target === "string" || Array.isArray(target)) {
      const ids = typeof target === "string" ? [target] : [...new Set(target)];
      const records = ids.map((id) => this.records.get(id));
      if (
        records.some(
          (record) =>
            !record || !this.live(record) || !record.node.isEnableClose() || record.node.isPinned(),
        )
      )
        return null;
      return records.map((record) => record!.node);
    }
    const range = target as Exclude<CloseTarget, string | readonly string[]>;
    const node = range.target;
    if (this.model.getNodeById(node.getId()) !== node) return null;
    let nodes: TabNode[];
    if (
      range.scope === "all" &&
      (node instanceof TabSetNode || node instanceof BorderNode || node instanceof TabGroupNode)
    )
      nodes = tabsIn(node);
    else if (node instanceof TabNode && (range.scope === "others" || range.scope === "right")) {
      const container = tabContainer(node);
      if (!container || (range.scope === "right" && !(container instanceof TabSetNode)))
        return null;
      const all = tabsIn(container);
      nodes =
        range.scope === "others"
          ? all.filter((tab) => tab !== node)
          : all.slice(all.indexOf(node) + 1);
    } else return null;
    return nodes.filter((tab) => tab.isEnableClose() && !tab.isPinned());
  }
  close(target: CloseTarget, options: CloseOptions = {}): Promise<CloseResult> {
    return this.closeScope(() => this.closeTargets(target), options);
  }
  private closeScope(
    select: () => readonly TabNode[] | null,
    options: CloseOptions = {},
  ): Promise<CloseResult> {
    if (this.phase !== "running") return Promise.resolve(denied("not-ready"));
    if (this.workspaceClosing) return Promise.resolve(denied("busy"));
    let nodes: readonly TabNode[] | null;
    try {
      nodes = select();
    } catch (error) {
      return Promise.resolve(failed(error));
    }
    if (!nodes) return Promise.resolve(denied("not-closeable"));
    const members = nodes.map((node) => this.records.get(node.getId()));
    if (members.some((record) => !record)) return Promise.resolve(denied("missing-content"));
    const records = members as ContentRecord[];
    const existing = records.map((record) => this.closing.get(record)).find(Boolean);
    if (existing)
      return same(existing.members, records) ? existing.promise : Promise.resolve(denied("busy"));
    if (!records.length) return Promise.resolve(applied({ closedIds: [] }));
    let resolve!: (result: CloseResult) => void;
    const promise = new Promise<CloseResult>((done) => {
      resolve = done;
    });
    const batch = { members: records, promise };
    records.forEach((record) => this.closing.set(record, batch));
    const settle = (result: CloseResult) => {
      records.forEach((record) => {
        if (this.closing.get(record) === batch) this.closing.delete(record);
      });
      resolve(result);
    };
    void this.performClose(
      records,
      () => {
        const current = select();
        return !!current && same(current, nodes!);
      },
      options,
    ).then(settle, (error) => settle(failed(error)));
    return promise;
  }
  private async performClose(
    records: readonly ContentRecord[],
    scopeCurrent: () => boolean,
    options: CloseOptions,
  ): Promise<CloseResult> {
    const approvals: Approval[] = [];
    const removed: ContentRecord[] = [];
    let phase: Failed["phase"] = "prepare";
    const containers = records.map((record) => tabContainer(record.node));
    let endAbort!: () => void;
    const cancelled = new Promise<false>((resolve) => {
      endAbort = () => resolve(false);
    });
    const onAbort = () => {
      LeaveAttempt.end(approvals.map((approval) => approval.attempt)).forEach((error) =>
        this.issue(error),
      );
      endAbort();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const errors: unknown[] = [];
    try {
      if (options.signal?.aborted) return superseded;
      for (const record of records) {
        const approval = this.beginApproval(record, "close");
        approvals.push(approval);
        // eslint-disable-next-line no-await-in-loop -- One host decision dialog at a time; all approvals are rechecked before commit.
        if (!(await Promise.race([approval.decision, cancelled])))
          return options.signal?.aborted ? superseded : denied("decision");
        if (options.signal?.aborted) return superseded;
      }
      if (!scopeCurrent() || !approvals.every((approval) => approval.validate()))
        return denied("state-changed");
      phase = "commit";
      for (const [index, record] of records.entries()) {
        for (let remaining = index; remaining < records.length; remaining++) {
          const current = records[remaining]!;
          if (
            !approvals[remaining]!.validate() ||
            !current.node.isEnableClose() ||
            current.node.isPinned() ||
            tabContainer(current.node) !== containers[remaining]
          )
            throw new Error("Close approval changed during native removal");
        }
        let mutationError: unknown;
        try {
          this.model.doAction(Actions.deleteTab(record.id));
        } catch (error) {
          mutationError = error;
        }
        for (const member of records)
          if (this.model.getNodeById(member.id) !== member.node && !removed.includes(member)) {
            member.closed = true;
            removed.push(member);
          }
        if (mutationError) throw mutationError;
        if (!removed.includes(record))
          throw new Error("Native close did not remove the approved content");
      }
      const cleanup = this.release(removed);
      errors.push(...LeaveAttempt.end(approvals.map((approval) => approval.attempt)));
      errors.push(...(await cleanup));
      return applied({ closedIds: removed.map((record) => record.id) }, errors);
    } catch (error) {
      const cleanup = this.release(removed);
      errors.push(...LeaveAttempt.end(approvals.map((approval) => approval.attempt)));
      errors.push(...(await cleanup));
      return failed(
        error,
        phase,
        removed.map((record) => record.id),
        errors,
      );
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      LeaveAttempt.end(approvals.map((approval) => approval.attempt)).forEach((error) =>
        this.issue(error),
      );
    }
  }
  private release(records: readonly ContentRecord[]): Promise<unknown[]> {
    const unique = [...new Set(records)].filter((record) => this.records.get(record.id) === record);
    unique.forEach((record) => {
      record.closed = true;
      this.records.delete(record.id);
    });
    const owner = {};
    const effects = unique.map((record) => record.effects.prepareClose(owner));
    const errors: unknown[] = [];
    for (const record of unique) {
      errors.push(...this.endAttempts(record));
      if (this.focusRequest?.record === record) this.cancelFocus();
      if (record.role === "document") errors.push(...(record.runtime?.dispose() ?? []));
      const index = this.mru.indexOf(record.id);
      if (index >= 0) this.mru.splice(index, 1);
    }
    effects.forEach((effect) => effect.stop());
    this.store.setState((state) => ({
      ...state,
      activeDocumentId:
        state.activeDocumentId && this.records.has(state.activeDocumentId)
          ? state.activeDocumentId
          : null,
      focusedContentId:
        state.focusedContentId && this.records.has(state.focusedContentId)
          ? state.focusedContentId
          : null,
      source: state.source && this.recordFor(state.source) ? state.source : null,
    }));
    if (this.phase === "running" && !this.getActiveDocument()) {
      const selected = centralTabsets(this.model)
        .map((container) => container.getSelectedNode())
        .find(
          (node) => node instanceof TabNode && this.records.get(node.getId())?.role === "document",
        );
      const next =
        selected instanceof TabNode
          ? this.records.get(selected.getId())
          : (this.records.get(this.mru[0] ?? "") ??
            [...this.records.values()].find((record) => record.role === "document"));
      if (next && this.live(next)) this.acceptActivity(next, false);
      this.publishActive("close");
    }
    this.changed(true);
    return Promise.all(effects.map((effect) => effect.result)).then((results) => [
      ...errors,
      ...results.flat(),
    ]);
  }

  closeWorkspace(
    options: CloseWorkspaceOptions = {},
  ): Promise<OperationResult<{ snapshot: WorkbenchSnapshot | null }>> {
    if (this.phase !== "running") return Promise.resolve(denied("not-ready"));
    return this.beginWorkspaceClose(options);
  }
  private beginWorkspaceClose(
    options: CloseWorkspaceOptions,
    onCommitted?: (snapshot: WorkbenchSnapshot | null, cleanup: Promise<DisposeResult>) => void,
  ): Promise<OperationResult<{ snapshot: WorkbenchSnapshot | null }>> {
    if (this.workspaceClosing)
      return this.workspaceCloseRequest?.destination === options.destination &&
        this.workspaceCloseRequest?.handoff === !!onCommitted
        ? this.workspaceClosing
        : Promise.resolve(denied("busy"));
    if (this.closing.size) return Promise.resolve(denied("busy"));
    let resolve!: (result: OperationResult<{ snapshot: WorkbenchSnapshot | null }>) => void;
    const promise = new Promise<OperationResult<{ snapshot: WorkbenchSnapshot | null }>>((done) => {
      resolve = done;
    });
    this.workspaceClosing = promise;
    this.workspaceCloseRequest = { destination: options.destination, handoff: !!onCommitted };
    const settle = (result: OperationResult<{ snapshot: WorkbenchSnapshot | null }>) => {
      if (this.workspaceClosing === promise) {
        this.workspaceClosing = undefined;
        this.workspaceCloseRequest = undefined;
      }
      resolve(result);
    };
    void this.performWorkspaceClose(options, onCommitted).then(settle, (error) =>
      settle(failed(error)),
    );
    return promise;
  }
  private async performWorkspaceClose(
    options: CloseWorkspaceOptions,
    onCommitted?: (snapshot: WorkbenchSnapshot | null, cleanup: Promise<DisposeResult>) => void,
  ): Promise<OperationResult<{ snapshot: WorkbenchSnapshot | null }>> {
    const records = [...this.records.values()];
    const approvals: Approval[] = [];
    const workspaceAttempt = this.newAttempt();
    let workspaceToken: LeaveToken | undefined;
    const guard = this.options.workspaceLeave;
    const initialPhase = this.phase;
    const valid = () =>
      this.phase === initialPhase &&
      (initialPhase === "running" || initialPhase === "starting") &&
      !options.signal?.aborted &&
      same([...this.records.values()], records) &&
      approvals.every((approval) => approval.validate()) &&
      (!guard || Object.is(stateOf(guard).token, workspaceToken));
    let abort!: () => void;
    const cancelled = new Promise<false>((resolve) => {
      abort = () => resolve(false);
    });
    workspaceAttempt.signal.addEventListener("abort", () => abort(), { once: true });
    const onAbort = () => {
      LeaveAttempt.end([
        ...approvals.map((approval) => approval.attempt),
        workspaceAttempt,
      ]).forEach((error) => this.issue(error));
      abort();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (options.signal?.aborted) return superseded;
      for (const record of records) {
        const approval = this.beginApproval(
          record,
          "leave-workspace",
          undefined,
          options.destination ?? null,
        );
        approvals.push(approval);
        // eslint-disable-next-line no-await-in-loop -- One host decision dialog at a time; all approvals are rechecked before commit.
        if (!(await Promise.race([approval.decision, cancelled])))
          return options.signal?.aborted ? superseded : denied("decision");
      }
      if (guard) {
        const result = await Promise.race([
          Promise.resolve(
            guard.decide({
              reason: "leave-workspace",
              state: stateOf(guard),
              destination: options.destination ?? null,
              signal: workspaceAttempt.signal,
              defer: workspaceAttempt.defer,
            }),
          ),
          cancelled,
        ]);
        if (!result || result.decision !== "allow")
          return options.signal?.aborted ? superseded : denied("decision");
        validToken(result.token);
        workspaceToken = result.token;
      }
      if (!valid()) return denied("state-changed");
      const snapshot =
        this.options.captureSnapshotOnClose && this.phase === "running"
          ? this.createSnapshot()
          : null;
      if (!valid()) return denied("state-changed");
      const cleanup = this.dispose();
      const errors = LeaveAttempt.end([
        ...approvals.map((approval) => approval.attempt),
        workspaceAttempt,
      ]);
      onCommitted?.(snapshot, cleanup);
      const result = await cleanup;
      return applied({ snapshot }, [...errors, ...result.cleanupErrors]);
    } catch (error) {
      return failed(error);
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      LeaveAttempt.end([
        ...approvals.map((approval) => approval.attempt),
        workspaceAttempt,
      ]).forEach((error) => this.issue(error));
    }
  }
  dispose(): Promise<DisposeResult> {
    if (this.disposePromise) return this.disposePromise;
    let resolve!: (result: DisposeResult) => void;
    this.disposePromise = new Promise((done) => {
      resolve = done;
    });
    this.phase = "disposed";
    const errors: unknown[] = [];
    const safely = (action: () => void) => {
      try {
        action();
      } catch (error) {
        errors.push(error);
      }
    };
    safely(() => this.cancelFocus());
    safely(() => this.browser?.dispose());
    safely(() => this.links.dispose());
    safely(() => this.model.removeChangeListener(this.modelListener));
    errors.push(...LeaveAttempt.end([...this.attempts.keys()]));
    for (const runtime of this.pendingRouters) errors.push(...runtime.dispose());
    this.pendingRouters.clear();
    safely(() => this.view?.getLayout()?.endDrag());
    void this.release([...this.records.values()]).then(
      (cleanup) => resolve(applied(undefined, [...errors, ...cleanup])),
      (error) => resolve(failed(error, "commit", [], errors)),
    );
    this.changed();
    return this.disposePromise;
  }

  createSnapshot(): WorkbenchSnapshot {
    if (this.phase !== "running") throw new Error("Snapshots require a running workbench");
    const revision = this.store.get().snapshotRevision;
    const records = [...this.records.values()];
    const layout = this.model.toJson();
    if (
      this.phase !== "running" ||
      revision !== this.store.get().snapshotRevision ||
      !same(records, [...this.records.values()]) ||
      !records.every((record) => this.live(record))
    )
      throw new Error("Layout or content changed during snapshot export");
    const annotate = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (node.type === "tab") {
        const record = this.records.get(node.id as string);
        if (!record) throw new Error("Snapshot contains unowned native content");
        const config = node.config as Record<string, unknown> | undefined;
        node.config = {
          ...config,
          worksplit:
            record.role === "document"
              ? { href: record.href, preview: record.preview, manualTitle: record.manualTitle }
              : { manualTitle: record.manualTitle },
        };
      }
      if (Array.isArray(node.children)) node.children.forEach(annotate);
    };
    annotate(layout.layout);
    layout.borders?.forEach(annotate);
    const activeDocumentId = this.getActiveDocument()?.id;
    return structuredClone({
      version: 2,
      workspaceId: this.workspaceId,
      layout,
      ...(activeDocumentId ? { activeDocumentId } : {}),
    });
  }

  private allowMove(drag: Node, target: Node, location: DockLocation): boolean {
    const policy = this.options.allowDrop;
    if (!policy) return true;
    const tabs = tabsIn(drag);
    if (!policy(tabs, target, location)) return false;
    const container = tabContainer(target);
    return !container || container === target || policy(tabs, container, location);
  }
  private canBatch(action: Action, leaves: readonly Action[]): boolean {
    if (!leaves.length) return false;
    if (leaves.every((leaf) => leaf.type === Actions.DELETE_TAB))
      return leaves.every((leaf) => this.closeTargets(leaf.data.node) !== null);
    // Resource admission and deletion need their own settlement. Combining them with native
    // display actions would otherwise expose a partly applied group before guard completion.
    if (
      leaves.some((leaf) =>
        [Actions.ADD_TAB, Actions.DELETE_TAB, Actions.DELETE_TABSET].includes(leaf.type),
      )
    )
      return false;
    if (!leaves.every((leaf) => this.canDispatch(leaf))) return false;
    if (leaves.some((leaf) => leaf.type === Actions.MOVE_NODE)) {
      if (this.options.allowDrop) return false;
      if (
        leaves.some(
          (leaf) =>
            leaf.type === Actions.MOVE_NODE && leaf.data.location !== DockLocation.CENTER.getName(),
        )
      )
        return false;
      if (this.options.layoutPolicy && !this.options.layoutPolicy.allowsAction(this.model, action))
        return false;
    }
    const mayDisappear = new Set<Node>();
    const changedPermissions = new Set<Node>();
    for (const leaf of leaves) {
      const references = [
        leaf.data.node,
        leaf.data.tabNode,
        leaf.data.tabsetNode,
        leaf.data.nodeId,
        leaf.data.fromNode,
        leaf.data.toNode,
      ]
        .filter((id): id is string => typeof id === "string")
        .map((id) => this.model.getNodeById(id));
      if (
        references.some((node) => node && (mayDisappear.has(node) || changedPermissions.has(node)))
      )
        return false;
      const node = references[0];
      if (
        leaf.type === Actions.UPDATE_NODE_ATTRIBUTES ||
        leaf.type === Actions.UPDATE_MODEL_ATTRIBUTES
      ) {
        // Appearance stays native. Capability changes can alter later preflight decisions,
        // so those updates remain scalar; no copied whitelist of native display attributes.
        if (
          Object.keys(leaf.data.json).some((key) =>
            /(?:^enable|Enable|^rootOrientationVertical$)/u.test(key),
          )
        )
          return false;
      }
      if (leaf.type === Actions.SET_TAB_PINNED && node) changedPermissions.add(node);
      if (leaf.type === Actions.REMOVE_TAB_FROM_GROUP && node) {
        const group = node.getParent();
        if (!group || mayDisappear.has(group)) return false;
        if (group.getChildren().length === 1) mayDisappear.add(group);
      }
      if (leaf.type === Actions.UNGROUP && node) mayDisappear.add(node);
      if (leaf.type === Actions.MOVE_NODE && node) {
        const target = this.model.getNodeById(leaf.data.toNode);
        for (
          let parent = node.getParent();
          parent && parent !== target && !(parent instanceof RowNode);
          parent = parent.getParent()
        ) {
          // Conservative dependency check: later actions may still name surviving tabs, but
          // cannot depend on a group/container that native tidy could remove in this batch.
          if (tabsIn(parent).every((tab) => tabsIn(node).includes(tab))) mayDisappear.add(parent);
        }
      }
    }
    return true;
  }
  canDispatch(action: Action): boolean {
    if (this.phase !== "running") return false;
    try {
      const leaves = actionsIn(action);
      if (leaves.length !== 1) return this.canBatch(action, leaves);
      const leaf = leaves[0]!;
      if (leaf.type === Actions.DELETE_TAB) return this.closeTargets(leaf.data.node) !== null;
      if (leaf.type === Actions.DELETE_TABSET) {
        const node = this.model.getNodeById(leaf.data.node);
        return node instanceof TabSetNode && node.isEnableClose();
      }
      if (leaf.type === Actions.ADD_TAB) {
        const json = leaf.data.json as IJsonTabNode;
        if (
          !json ||
          (json.type !== undefined && json.type !== "tab") ||
          Object.hasOwn(json, "children") ||
          (json.id !== undefined &&
            (typeof json.id !== "string" || !json.id || this.model.getNodeById(json.id))) ||
          !this.resolveTool(json) ||
          json.enableFloat ||
          json.enablePopout ||
          json.subLayoutId
        )
          return false;
        const location = [
          DockLocation.CENTER,
          DockLocation.LEFT,
          DockLocation.RIGHT,
          DockLocation.TOP,
          DockLocation.BOTTOM,
        ].find((value) => value.getName() === leaf.data.location);
        if (!location) return false;
        // Native tool ADD owns its select flag, including admission into a closed Border.
        // Document background presentation constraints do not reinterpret a native Action.
        const capture = this.captureOpen({});
        return (
          !("status" in capture) &&
          this.canPlace(
            { ...json, id: json.id ?? `candidate-${this.prefix}` },
            { target: leaf.data.toNode, location, index: leaf.data.index },
            capture,
          )
        );
      }
      if (leaf.type === Actions.MOVE_NODE) {
        const from = this.model.getNodeById(leaf.data.fromNode),
          to = this.model.getNodeById(leaf.data.toNode);
        const location = [
          DockLocation.CENTER,
          DockLocation.LEFT,
          DockLocation.RIGHT,
          DockLocation.TOP,
          DockLocation.BOTTOM,
        ].find((value) => value.getName() === leaf.data.location);
        if (
          !from ||
          !to ||
          !location ||
          from === to ||
          (from instanceof TabNode && from.isPinned())
        )
          return false;
        if (
          !(
            from instanceof TabNode ||
            from instanceof TabSetNode ||
            from instanceof TabGroupNode
          ) ||
          !from.isEnableDrag()
        )
          return false;
        for (let ancestor: Node | undefined = to; ancestor; ancestor = ancestor.getParent())
          if (ancestor === from) return false;
        if (
          !(
            to instanceof TabSetNode ||
            to instanceof BorderNode ||
            to instanceof TabGroupNode ||
            to instanceof RowNode
          )
        )
          return false;
        const container = tabContainer(to);
        if (
          (container && !container.isEnableDrop()) ||
          (to instanceof TabSetNode && location !== DockLocation.CENTER && !to.isEnableDivide()) ||
          ((to instanceof BorderNode || to instanceof TabGroupNode) &&
            location !== DockLocation.CENTER)
        )
          return false;
        if (
          !Number.isSafeInteger(leaf.data.index) ||
          leaf.data.index < -1 ||
          leaf.data.index > to.getChildren().length
        )
          return false;
        return (
          this.allowMove(from, to, location) &&
          (this.options.layoutPolicy?.allowsAction(this.model, action) ?? true)
        );
      }
      if (
        leaf.type === Actions.UPDATE_NODE_ATTRIBUTES ||
        leaf.type === Actions.UPDATE_MODEL_ATTRIBUTES
      ) {
        const attributes = leaf.data.json as Record<string, unknown>;
        if (
          !attributes ||
          ["component", "id", "type", "children", "subLayoutId"].some((key) =>
            Object.hasOwn(attributes, key),
          ) ||
          ["enableFloat", "enablePopout", "tabEnableFloat", "tabEnablePopout"].some(
            (key) =>
              Object.hasOwn(attributes, key) &&
              attributes[key] !== false &&
              attributes[key] !== undefined,
          )
        )
          return false;
        if (Object.hasOwn(attributes, "config")) {
          const old = this.model.getNodeById(leaf.data.node);
          if (!(old instanceof TabNode)) return false;
          const config = attributes.config;
          if (
            !config ||
            typeof config !== "object" ||
            Array.isArray(config) ||
            Object.hasOwn(config, "worksplit")
          )
            return false;
          const record = this.records.get(old.getId());
          if (record?.role === "tool" && !this.resolveTool({ ...old.toJson(), config }))
            return false;
        }
        return (
          leaf.type === Actions.UPDATE_MODEL_ATTRIBUTES || !!this.model.getNodeById(leaf.data.node)
        );
      }
      const node = this.model.getNodeById(
        leaf.data.node ?? leaf.data.tabNode ?? leaf.data.tabsetNode ?? leaf.data.nodeId,
      );
      switch (leaf.type) {
        case Actions.SELECT_TAB:
          return node instanceof TabNode && this.getContent(node.getId()) !== null;
        case Actions.SET_ACTIVE_TABSET:
          return (
            (leaf.data.layoutId === undefined || leaf.data.layoutId === Model.MAIN_LAYOUT_ID) &&
            (leaf.data.tabsetNode === undefined || node instanceof TabSetNode)
          );
        case Actions.ADJUST_BORDER_SPLIT:
          return (
            node instanceof BorderNode &&
            Number.isFinite(leaf.data.size) &&
            leaf.data.size >= node.getMinSize() &&
            leaf.data.size <= node.getMaxSize()
          );
        case Actions.MAXIMIZE_TOGGLE:
          return node instanceof TabSetNode && node.isEnableMaximize();
        case Actions.RENAME_TAB:
          return (
            node instanceof TabNode && node.isEnableRename() && typeof leaf.data.text === "string"
          );
        case Actions.ADJUST_WEIGHTS:
          return (
            node instanceof RowNode &&
            Array.isArray(leaf.data.weights) &&
            leaf.data.weights.length === node.getChildren().length &&
            leaf.data.weights.every(
              (weight: unknown) =>
                typeof weight === "number" && Number.isFinite(weight) && weight > 0,
            )
          );
        case Actions.SET_TAB_PINNED:
          return (
            node instanceof TabNode &&
            node.isEnablePin() &&
            tabContainer(node) instanceof TabSetNode &&
            typeof leaf.data.pinned === "boolean"
          );
        case Actions.SET_BORDER_TYPE:
          return node instanceof BorderNode && ["split", "overlay"].includes(leaf.data.borderType);
        case Actions.ADD_TAB_TO_NEW_GROUP:
          return (
            node instanceof TabNode &&
            !node.isPinned() &&
            (!(tabContainer(node) instanceof TabSetNode) ||
              (tabContainer(node) as TabSetNode).isEnableTabGroups())
          );
        case Actions.REMOVE_TAB_FROM_GROUP:
          return node instanceof TabNode && node.getParent() instanceof TabGroupNode;
        case Actions.UNGROUP:
          return node instanceof TabGroupNode;
        default:
          return false;
      }
    } catch {
      return false;
    }
  }
  async dispatch(action: Action): Promise<OperationResult<void>> {
    if (this.phase !== "running") return denied("not-ready");
    const leaves = actionsIn(action);
    if (!this.canDispatch(action)) return denied("unsupported-action");
    if (leaves.every((leaf) => leaf.type === Actions.DELETE_TAB)) {
      const result = await this.close(leaves.map((leaf) => leaf.data.node as string));
      return result.status === "applied" ? applied(undefined, result.cleanupErrors) : result;
    }
    const leaf = leaves[0]!;
    if (leaf.type === Actions.DELETE_TABSET) {
      const node = this.model.getNodeById(leaf.data.node) as TabSetNode;
      const result = await this.closeScope(() =>
        this.model.getNodeById(node.getId()) === node && node.isEnableClose()
          ? node
              .getChildren()
              .filter((child) => child.isCloseable())
              .flatMap(tabsIn)
          : null,
      );
      if (result.status !== "applied") return result;
      // Native DELETE_TABSET preserves non-closeable direct children (including a protected
      // group). Never delete new content admitted while an already removed member cleans up.
      if (this.model.getNodeById(node.getId()) === node && node.getChildren().length === 0) {
        try {
          this.model.doAction(leaf);
        } catch (error) {
          return failed(error, "commit", result.value.closedIds, result.cleanupErrors);
        }
      }
      return applied(undefined, result.cleanupErrors);
    }
    let admissionId: string | undefined;
    const admitted: ContentRecord[] = [];
    const revision = this.store.get().snapshotRevision;
    try {
      let native = action;
      if (leaf.type === Actions.ADD_TAB) {
        const json: IJsonTabNode = {
          ...leaf.data.json,
          id: leaf.data.json.id ?? `tool-${this.prefix}-${++this.sequence}`,
        };
        const definition = this.resolveTool(json);
        if (!definition) return denied("invalid-argument");
        admissionId = json.id!;
        this.admissions.set(admissionId, (node) => {
          admitted.push(this.makeRecord(node, definition));
        });
        if (leaf.data.json.id === undefined)
          native = Actions.addTab(
            json,
            leaf.data.toNode,
            [
              DockLocation.CENTER,
              DockLocation.LEFT,
              DockLocation.RIGHT,
              DockLocation.TOP,
              DockLocation.BOTTOM,
            ].find((location) => location.getName() === leaf.data.location)!,
            leaf.data.index,
            leaf.data.select,
          );
      }
      this.model.doAction(native);
      if (admissionId && !admitted.length) throw new Error("Native tool ADD did not admit content");
      for (const record of admitted) {
        if (!this.live(record)) throw new Error("Tool ended during native observers");
        this.updateTitle(record);
      }
      return applied(undefined);
    } catch (error) {
      const ids = admitted.length
        ? admitted.map((record) => record.id)
        : revision !== this.store.get().snapshotRevision
          ? [
              ...new Set(
                leaves.flatMap((item) =>
                  [item.data.node, item.data.tabNode, item.data.fromNode, item.data.toNode].filter(
                    (id): id is string => typeof id === "string",
                  ),
                ),
              ),
            ]
          : [];
      return failed(error, "commit", ids);
    } finally {
      if (admissionId) this.admissions.delete(admissionId);
    }
  }

  createLink<const TFrom extends string = string, const TTo extends string | undefined = ".">(
    navigation:
      | DocumentNavigationOptions<TRouter, TFrom, TTo>
      | (() =>
          | DocumentNavigationOptions<TRouter, TFrom, TTo>
          | Promise<DocumentNavigationOptions<TRouter, TFrom, TTo>>),
    options: LinkOptions = {},
  ) {
    let href: string | undefined;
    if (
      typeof navigation !== "function" &&
      validNavigation(navigation as unknown as RuntimeNavigation)
    ) {
      const sourceHandle = options.source ?? this.store.get().source;
      const source = sourceHandle ? this.recordFor(sourceHandle) : undefined;
      const borrowed = source?.role === "document" ? source.runtime?.router : undefined;
      const temporary = borrowed
        ? undefined
        : this.runtime(
            source?.role === "document" ? source.href : (this.options.home?.href ?? "/"),
          );
      try {
        const location = (borrowed ?? temporary!.runtime.router).buildLocation(
          navigation as Parameters<AnyRouter["buildLocation"]>[0],
        );
        if (!location.external) {
          checkHref(location.publicHref);
          href = location.publicHref;
        }
      } finally {
        if (temporary) {
          this.pendingRouters.delete(temporary.runtime);
          temporary.runtime.dispose().forEach((error) => this.issue(error));
        }
      }
    }
    const { onResult, ...captured } = options;
    return this.links.create(
      () => href,
      async (requested, current) => {
        if (this.phase !== "running") return denied("not-ready");
        if (!current()) return superseded;
        const capture = this.captureOpen(requested);
        if ("status" in capture) return capture;
        capture.current = current;
        try {
          if (typeof navigation === "function") this.claimOpen(capture);
          const target = typeof navigation === "function" ? await navigation() : navigation;
          if (!current() || !this.captureCurrent(capture)) return superseded;
          const result = await this.openDocument(
            target as unknown as RuntimeNavigation,
            requested,
            { capture },
          );
          if (result.status === "applied") href = result.value.document.href;
          return result;
        } catch (error) {
          return failed(error);
        }
      },
      captured as OpenOptions,
      onResult,
    );
  }

  start(options: StartOptions = {}): Promise<StartResult> {
    if (this.phase === "disposed") return Promise.resolve(denied("not-ready"));
    const old = this.startInput;
    if (this.startPromise) {
      const sameInput =
        old?.href === options.href &&
        old?.browser?.window === options.browser?.window &&
        old?.browser?.onOutsideNavigate === options.browser?.onOutsideNavigate &&
        !!old?.browser === !!options.browser;
      return sameInput ? this.startPromise : Promise.resolve(denied("invalid-argument"));
    }
    if (options.browser && options.href !== undefined)
      return Promise.resolve(denied("invalid-argument"));
    this.startInput = options.browser ? { browser: { ...options.browser } } : { ...options };
    this.phase = "starting";
    this.changed();
    let resolve!: (result: StartResult) => void;
    this.startPromise = new Promise((done) => {
      resolve = done;
    });
    void this.startSession(options).then(resolve, async (error) => {
      await this.dispose();
      resolve(failed(error));
    });
    return this.startPromise;
  }
  private async startSession(options: StartOptions): Promise<StartResult> {
    let result: StartResult;
    if (options.browser) {
      const browserOptions = options.browser;
      if (!this.options.home) throw new TypeError("Browser sessions require an explicit home URL");
      const win = browserOptions.window ?? window;
      this.browser = new BrowserHistoryCoordinator(
        win,
        this.workspaceId,
        (href, reference, current, signal) => this.visitBrowser(href, reference, current, signal),
        (error) => this.issue(error),
        async (href, context) => {
          const close = await this.beginWorkspaceClose(
            { destination: href, signal: context.signal },
            (snapshot, cleanup) => {
              try {
                const returned = browserOptions.onOutsideNavigate({
                  href,
                  state: context.state,
                  snapshot,
                  cleanup,
                });
                void Promise.resolve(returned).catch((error) => this.issue(error));
              } catch (error) {
                this.issue(error);
              }
            },
          );
          if (close.status === "failed") this.reportResult(close);
          return close.status === "applied";
        },
      );
      const accepted = await this.browser.start();
      if (!accepted || this.phase === "disposed") {
        await this.dispose();
        return superseded;
      }
      result = applied({ document: this.getActiveDocument(), href: accepted.href });
    } else {
      const restored =
        options.href === undefined
          ? (this.records.get(this.restoredActive ?? "") ??
            [...this.records.values()].find(
              (record) => record.role === "document" && record.node.isSelected(),
            ))
          : undefined;
      if (restored?.role === "document") {
        await this.initialize(restored);
        if (this.phase === "disposed") return superseded;
        const presentation = this.present(restored, "activate");
        if (presentation.status !== "applied") return presentation;
        result = applied({ document: this.getDocument(restored.id), href: restored.href });
      } else {
        const href = options.href ?? this.options.home?.href ?? "/";
        checkHref(href);
        if (
          (!this.options.home || this.options.home.mode === "empty") &&
          href === (this.options.home?.href ?? "/")
        )
          result = applied({ document: null, href });
        else {
          const opened = await this.openDocument({ href }, {}, { starting: true });
          result =
            opened.status === "applied"
              ? applied(
                  { document: opened.value.document, href: opened.value.document.href },
                  opened.cleanupErrors,
                )
              : opened;
        }
      }
    }
    if (this.phase === "disposed") return superseded;
    if (result.status === "applied") {
      this.phase = "running";
      this.changed();
    } else await this.dispose();
    return result;
  }
  private reference(record: DocumentRecord): BrowserEntryReference | undefined {
    const key = record.accepted?.state["__TSR_key"];
    return key ? { contentId: record.id, lifetime: record.lifetime, entryKey: key } : undefined;
  }
  private async visitBrowser(
    href: string,
    reference: BrowserEntryReference | undefined,
    current: () => boolean,
    signal: AbortSignal,
  ): Promise<BrowserVisitResult | undefined> {
    if (!current() || this.phase === "disposed") return;
    const source: BrowserVisitSource = { current, signal, pending: true };
    const claim = (navigation: NativeNavigation) => {
      if (source.pending) this.browserRequests.set(navigation, source);
    };
    try {
      if (!reference && this.options.home?.mode === "empty" && href === this.options.home.href) {
        const active =
          this.records.get(this.store.get().activeDocumentId ?? this.restoredActive ?? "") ??
          [...this.records.values()].find(
            (record) => record.role === "document" && record.node.isSelected(),
          ) ??
          [...this.records.values()].find((record) => record.role === "document");
        if (active?.role === "document") {
          await this.initialize(active);
          if (!current() || !this.live(active) || !active.ready) return;
          const shown = this.present(active, "activate");
          if (shown.status !== "applied") return;
          const ref = this.reference(active);
          return { href: active.href, ...(ref ? { reference: ref } : {}) };
        }
        this.store.setState((state) => ({ ...state, activeDocumentId: null }));
        return { href };
      }
      const record = reference ? this.records.get(reference.contentId) : undefined;
      if (
        record?.role === "document" &&
        record.lifetime === reference!.lifetime &&
        record.runtime?.history.getEntry(reference!.entryKey)
      ) {
        const outcome = await record.runtime.goToEntry(reference!.entryKey, {
          onNavigationStart: claim,
        });
        outcome?.cleanupErrors.forEach((error) => this.issue(error, record.id));
        if (outcome?.status === "failed") this.issue(outcome.error, record.id);
        if (!current() || outcome?.status !== "accepted" || !this.live(record)) return;
        const shown = this.present(record, "activate");
        if (shown.status !== "applied") return;
        const ref = this.reference(record);
        return { href: record.href, ...(ref ? { reference: ref } : {}) };
      }
      const opened = await this.openDocument(
        { href, onNavigationStart: claim },
        { reuse: "new" },
        { starting: this.phase === "starting", browser: source },
      );
      this.reportResult(opened);
      if (!current() || opened.status !== "applied") return;
      const accepted = this.records.get(opened.value.document.id) as DocumentRecord;
      const ref = this.reference(accepted);
      return { href: accepted.href, ...(ref ? { reference: ref } : {}) };
    } finally {
      source.pending = false;
    }
  }
}

export function createWorkbench<TRouter extends AnyRouter>(
  options: WorkbenchOptions<TRouter>,
): WorkbenchInstance<TRouter> {
  return new WorkbenchSession(options);
}
