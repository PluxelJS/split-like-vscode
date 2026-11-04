import type { AnyRouter, ParsedLocation } from "@tanstack/react-router";
import type { TabNode } from "flexlayout-react";

import type { ContentEffects } from "./content-effects";
import type { DocumentRuntime } from "./document-history";
import type { ContentController, ContentHandle, ContentInfo, ToolDefinition } from "./types";

/** One stable React registration. Only committed declarations replace controller. */
export interface ControllerOwner {
  controller: ContentController;
}

interface ContentBase {
  readonly id: string;
  readonly lifetime: string;
  readonly node: TabNode;
  readonly handle: ContentHandle;
  readonly effects: ContentEffects;
  closed: boolean;
  manualTitle: boolean;
  owner: ControllerOwner | undefined;
  ownerRevision: number;
  hadProtection: boolean;
  root: HTMLElement | undefined;
  projection: ContentInfo | undefined;
}
export interface DocumentRecord extends ContentBase {
  readonly role: "document";
  href: string;
  preview: boolean;
  key: string | undefined;
  accepted: ParsedLocation | undefined;
  acceptedRevision: number;
  runtime: DocumentRuntime<AnyRouter> | undefined;
  initialization: Promise<void> | undefined;
  ready: boolean;
}
export interface ToolRecord extends ContentBase {
  readonly role: "tool";
  readonly definition: ToolDefinition;
}
export type ContentRecord = DocumentRecord | ToolRecord;
