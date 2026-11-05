import { createStore } from "@tanstack/react-store";
import type { Action, ILayoutApi, Model, TabNode } from "flexlayout-react";

import type { ContentRecord, ControllerOwner } from "./content-record";
import type {
  CloseTarget,
  ContentController,
  ContentHandle,
  OperationResult,
  WorkbenchState,
} from "./types";

/** Borrowed by the React view only; not a public state or lifetime owner. */
export interface IntegrationState {
  readonly model: Model;
  readonly store: ReturnType<typeof createStore<WorkbenchState>>;
  getRecord(id: string): ContentRecord | undefined;
  loadDocument(content: ContentHandle): Promise<void>;
  registerController(content: ContentHandle, owner: ControllerOwner): () => void;
  updateController(
    content: ContentHandle,
    owner: ControllerOwner,
    controller: ContentController,
  ): void;
  bindLayout(getLayout: () => ILayoutApi | null, root: HTMLElement): () => void;
  bindContentRoot(content: ContentHandle, root: HTMLElement | null): void;
  /** Returning focus to the same source is distinct from a fresh pointer interaction. */
  focus(
    id: string | null,
    origin: "content" | "chrome" | "outside" | "blur",
    intent?: boolean,
  ): void;
  returnFocus(): void;
  setWindowFocus(focused: boolean): void;
  modelAction(action: Action): undefined;
  closeTargets(target: CloseTarget): readonly TabNode[] | null;
  report(error: unknown): void;
  reportResult(result: OperationResult<unknown>): void;
}
const states = new WeakMap<object, IntegrationState>();
export function installIntegration(instance: object, state: IntegrationState): void {
  states.set(instance, state);
}
export function integrationState(instance: object): IntegrationState {
  const state = states.get(instance);
  if (!state) throw new Error("Unknown Worksplit instance");
  return state;
}
