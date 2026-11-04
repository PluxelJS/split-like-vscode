import type {
  AnyRouter,
  NavigateOptions,
  ParsedLocation,
  RouterHistory,
  AnyRouteMatch,
} from "@tanstack/react-router";
import type {
  Action,
  BorderNode,
  DockLocation,
  IJsonModel,
  IJsonTabNode,
  Model,
  Node,
  TabGroupNode,
  TabNode,
  TabSetNode,
} from "flexlayout-react";
import type { ReactNode, DragEvent } from "react";

import type { ContentEffect } from "./content-effects";
import type { WorkbenchLayoutPolicy } from "./layout-policy";
export type LeaveToken = string | number;
export interface LeaveState {
  readonly hasUnsavedChanges: boolean;
  readonly token: LeaveToken;
}
export type LeaveDecision =
  | { decision: "allow"; token: LeaveToken }
  | { decision: "deny"; reason?: string };
interface LeaveBase {
  readonly content: ContentHandle;
  readonly state: LeaveState;
  readonly signal: AbortSignal;
  defer(cleanup: () => void): void;
}
export type LeaveRequest = LeaveBase &
  (
    | { reason: "navigate"; from: ParsedLocation; to: ParsedLocation }
    | { reason: "close" | "replace-preview"; location: ParsedLocation | null }
    | { reason: "leave-workspace"; location: ParsedLocation | null; destination: string | null }
  );
export interface LeaveGuard {
  getState(): LeaveState;
  decide(request: LeaveRequest): LeaveDecision | Promise<LeaveDecision>;
}
export interface ContentController {
  title?: string;
  leave: LeaveGuard | null;
  save?: () => void | Promise<void>;
  focus?: () => void;
}
export interface ContentHandle {
  readonly id: string;
  runEffect(setup: (effect: ContentEffect) => void | Promise<void>): () => void;
}
export interface WorkspaceLeaveRequest {
  readonly reason: "leave-workspace";
  readonly state: LeaveState;
  readonly destination: string | null;
  readonly signal: AbortSignal;
  defer(cleanup: () => void): void;
}
export interface WorkspaceLeave {
  getState(): LeaveState;
  decide(request: WorkspaceLeaveRequest): LeaveDecision | Promise<LeaveDecision>;
}
export type DenialReason =
  | "decision"
  | "missing-content"
  | "missing-capability"
  | "layout-policy"
  | "focus-conflict"
  | "busy"
  | "not-ready"
  | "state-changed"
  | "unsupported-action"
  | "invalid-argument"
  | "not-closeable"
  | "controller-unavailable";
export interface Applied<T> {
  status: "applied";
  value: T;
  cleanupErrors: readonly unknown[];
}
export interface Failed {
  status: "failed";
  phase: "prepare" | "commit";
  error: unknown;
  changes: "none" | "some";
  affectedIds: readonly string[];
  cleanupErrors: readonly unknown[];
}
export type OperationResult<T> =
  | Applied<T>
  | { status: "denied"; reason: DenialReason; detail?: string }
  | { status: "superseded" }
  | Failed;
export interface ContentInfo {
  readonly id: string;
  readonly handle: ContentHandle;
  readonly role: "document" | "tool";
  readonly node: TabNode;
  readonly containerId: string | null;
  readonly tabGroupId: string | null;
  readonly title: string;
  readonly visible: boolean;
}
export interface DocumentInfo extends ContentInfo {
  readonly role: "document";
  readonly href: string;
  readonly preview: boolean;
  readonly navigationKey: string | null;
}
export interface ContainerInfo {
  readonly id: string;
  readonly kind: "tabset" | "border";
  readonly node: TabSetNode | BorderNode;
  readonly tabIds: readonly string[];
  readonly selectedId: string | null;
}
export interface WorkbenchContext {
  readonly activeDocumentId: string | null;
  readonly activeContainerId: string | null;
  readonly focusedContentId: string | null;
  readonly source: ContentHandle | null;
  readonly windowFocused: boolean;
}
export interface WorkbenchState extends WorkbenchContext {
  readonly lifecycle: "created" | "starting" | "running" | "disposed";
  readonly revision: number;
  readonly snapshotRevision: number;
}
export interface Destination {
  target: string;
  location: DockLocation;
  index?: number;
  ratio?: number;
}
export interface PlacementContext {
  readonly model: Model;
  readonly source: ContentInfo | null;
  readonly anchor: TabSetNode | null;
  readonly containers: readonly ContainerInfo[];
  readonly previews: readonly DocumentInfo[];
  readonly mru: readonly string[];
  readonly defaultDestination: Destination | null;
  canPlace(destination: Destination): boolean;
}
export type DestinationResolver = (context: PlacementContext) => Destination | null;
export type OpenPresentation =
  | { presentation?: "activate" | "reveal"; preview?: boolean }
  | { presentation: "background"; preview?: false };
export type OpenOptions = OpenPresentation & {
  source?: ContentHandle;
  reuse?: "preserve" | "navigate" | "new";
  destination?: Destination | DestinationResolver;
};
export type ActivateOptions = { source?: ContentHandle } & (
  | { presentation?: "activate"; focus?: () => void }
  | { presentation: "reveal"; focus?: never }
);
export type CloseTarget =
  | string
  | readonly string[]
  | { scope: "others" | "right"; target: TabNode }
  | { scope: "all"; target: TabSetNode | BorderNode | TabGroupNode };
export interface CloseOptions {
  signal?: AbortSignal;
}
export interface CloseWorkspaceOptions extends CloseOptions {
  destination?: string;
}
export interface WorkbenchSnapshot {
  version: 2;
  workspaceId: string;
  layout: IJsonModel;
  activeDocumentId?: string;
}
export type OpenResult = OperationResult<{
  document: DocumentInfo;
  reused: boolean;
  presentation: "activate" | "reveal" | "background";
}>;
export type CloseResult = OperationResult<{ closedIds: readonly string[] }>;
export type StartResult = OperationResult<{ document: DocumentInfo | null; href: string }>;
export type DisposeResult = Applied<void> | Failed;
export interface BrowserHandoff {
  readonly href: string;
  readonly state: unknown;
  readonly snapshot: WorkbenchSnapshot | null;
  readonly cleanup: Promise<DisposeResult>;
}
export interface BrowserOptions {
  window?: Window;
  onOutsideNavigate(handoff: BrowserHandoff): void;
}
export type StartOptions =
  | { href?: string; browser?: never }
  | { browser: BrowserOptions; href?: never };
export interface ToolDefinition {
  title?: string;
  render(context: { content: ContentHandle; node: TabNode }): ReactNode;
}
export interface WorkbenchRouteMetadata {
  title?: string;
  navigationKey?: string;
  documentKey?: (context: {
    params: AnyRouteMatch["params"];
    search: AnyRouteMatch["search"];
    location: ParsedLocation;
  }) => string;
}
export interface WorkbenchOptions<TRouter extends AnyRouter> {
  createRouter(history: RouterHistory): TRouter;
  initial?: { layout: IJsonModel; snapshot?: never } | { snapshot: unknown; layout?: never };
  tools?: Readonly<Record<string, ToolDefinition>>;
  resolveTool?: (definitionKey: string, tab: Readonly<IJsonTabNode>) => ToolDefinition | undefined;
  home?: { mode: "empty" | "route"; href: string };
  workspaceId?: string;
  previewScope?: "container" | "workspace";
  layoutPolicy?: WorkbenchLayoutPolicy;
  allowDrop?: (tabs: readonly TabNode[], target: Node, location: DockLocation) => boolean;
  workspaceLeave?: WorkspaceLeave;
  captureSnapshotOnClose?: boolean;
  onIssue?: (issue: { code: "operation-failed" | "history"; error: unknown; id?: string }) => void;
}
export type LinkOptions = OpenOptions & { onResult?: (result: OpenResult) => void };
export type DocumentNavigationOptions<
  TRouter extends AnyRouter,
  TFrom extends string = string,
  TTo extends string | undefined = ".",
> = NavigateOptions<TRouter, TFrom, TTo> & {
  reloadDocument?: never;
  ignoreBlocker?: never;
  navigation?: never;
};
export interface DocumentLink {
  readonly href: string | undefined;
  open(overrides?: OpenOptions): Promise<OpenResult>;
  dragStart(event: DragEvent<HTMLElement>): void;
  dragEnd(event: DragEvent<HTMLElement>): void;
}
export interface WorkbenchInstance<TRouter extends AnyRouter> {
  readonly model: Model;
  open<const TFrom extends string = string, const TTo extends string | undefined = ".">(
    navigation: DocumentNavigationOptions<TRouter, TFrom, TTo>,
    options?: OpenOptions,
  ): Promise<OpenResult>;
  createLink<const TFrom extends string = string, const TTo extends string | undefined = ".">(
    navigation:
      | DocumentNavigationOptions<TRouter, TFrom, TTo>
      | (() =>
          | DocumentNavigationOptions<TRouter, TFrom, TTo>
          | Promise<DocumentNavigationOptions<TRouter, TFrom, TTo>>),
    options?: OpenOptions & { onResult?: (result: OpenResult) => void },
  ): DocumentLink;
  duplicate(id: string, options?: Omit<OpenOptions, "reuse" | "preview">): Promise<OpenResult>;
  keepOpen(id: string): Promise<OperationResult<DocumentInfo>>;
  activate(id: string, options?: ActivateOptions): Promise<OperationResult<ContentInfo>>;
  save(id: string): Promise<OperationResult<void>>;
  close(target: CloseTarget, options?: CloseOptions): Promise<CloseResult>;
  closeWorkspace(
    options?: CloseWorkspaceOptions,
  ): Promise<OperationResult<{ snapshot: WorkbenchSnapshot | null }>>;
  dispatch(action: Action): Promise<OperationResult<void>>;
  canDispatch(action: Action): boolean;
  getContent(id: string): ContentInfo | null;
  getDocument(id: string): DocumentInfo | null;
  getDocuments(): readonly DocumentInfo[];
  getActiveDocument(): DocumentInfo | null;
  getContainers(): readonly ContainerInfo[];
  getContext(): WorkbenchContext;
  createSnapshot(): WorkbenchSnapshot;
  start(options?: StartOptions): Promise<StartResult>;
  dispose(): Promise<DisposeResult>;
}

import type { ILayoutApi, ILayoutProps, IPopupMenuProps, PopupMenuEntry } from "flexlayout-react";
// Native item callbacks are already guarded and queued by the library.
import type { HTMLAttributes, Ref } from "react";
export interface MenuRendererProps extends IPopupMenuProps {
  readonly open: boolean;
  /** Call only once the actual popup is removed and its focus-return cleanup completed.
   * onClose merely requests open=false; selecting an item runs after onClosed. */
  onClosed(): void;
}
export interface MenuOptions<TRouter extends AnyRouter = AnyRouter> {
  labels?: Partial<
    Record<"keepOpen" | "duplicate" | "splitRight" | "splitDown" | "closeGroup", string>
  >;
  transform?: (context: {
    node: TabNode | TabSetNode | BorderNode | TabGroupNode;
    items: PopupMenuEntry[];
    instance: WorkbenchInstance<TRouter>;
  }) => PopupMenuEntry[];
  render?: (props: MenuRendererProps) => ReactNode;
}
export interface WorkbenchProps<TRouter extends AnyRouter = AnyRouter> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "dangerouslySetInnerHTML"
> {
  instance: WorkbenchInstance<TRouter>;
  empty?: ReactNode;
  layoutRef?: Ref<ILayoutApi>;
  menus?: false | MenuOptions<TRouter>;
  native?: Omit<
    ILayoutProps,
    | "model"
    | "factory"
    | "onAction"
    | "onExternalDrag"
    | "supportsPopout"
    | "popoutClassName"
    | "popoutURL"
    | "popoutWindowName"
    | "constrainFloatPanels"
    | "renderPopoutContent"
    | "onPopoutOpen"
    | "onPopoutClose"
  >;
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    worksplit?: WorkbenchRouteMetadata;
  }
}
