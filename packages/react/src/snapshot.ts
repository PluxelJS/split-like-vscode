import type { AnyRouter } from "@tanstack/react-router";
import type { IJsonModel, IJsonTabNode } from "flexlayout-react";

import type { WorkbenchOptions, WorkbenchSnapshot } from "./types";

export const DOCUMENT_COMPONENT = "worksplit:document";
export const defaultWorkbenchLayout = (): IJsonModel => ({
  global: {
    tabEnableFloat: false,
    tabEnablePopout: false,
    tabEnablePin: true,
    tabEnableRename: true,
    tabSetEnableTabGroups: true,
  },
  borders: [],
  layout: { type: "row", children: [] },
});
export function checkHref(href: string): void {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//"))
    throw new TypeError(`Expected an in-workspace path, received ${String(href)}`);
}
export function tabMetadata(tab: IJsonTabNode): {
  href?: string;
  preview?: boolean;
  manualTitle?: boolean;
} {
  const config: unknown = tab.config;
  if (config !== undefined && (!config || typeof config !== "object" || Array.isArray(config)))
    throw new TypeError(
      "Content config must be an object for the reserved config.worksplit namespace",
    );
  const data: unknown = (config as Record<string, unknown> | undefined)?.worksplit;
  if (data === undefined) return {};
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new TypeError("Invalid config.worksplit");
  const metadata = data as Record<string, unknown>;
  if (
    Object.keys(metadata).some((key) => !["href", "preview", "manualTitle"].includes(key)) ||
    (metadata.href !== undefined && typeof metadata.href !== "string") ||
    (metadata.preview !== undefined && typeof metadata.preview !== "boolean") ||
    (metadata.manualTitle !== undefined && typeof metadata.manualTitle !== "boolean")
  )
    throw new TypeError("Invalid Worksplit content recovery metadata");
  return metadata as { href?: string; preview?: boolean; manualTitle?: boolean };
}

/** Strict v2 input only. Native configuration stays native; this does not convert old snapshots. */
export function initialLayout<TRouter extends AnyRouter>(
  options: WorkbenchOptions<TRouter>,
  workspaceId: string,
): {
  layout: IJsonModel;
  activeDocumentId: string | undefined;
} {
  let activeDocumentId: string | undefined;
  const serialized = options.initial && "snapshot" in options.initial;
  let layout: IJsonModel;
  if (serialized) {
    const value = options.initial!.snapshot;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new TypeError("Invalid Worksplit snapshot");
    const snapshot = value as WorkbenchSnapshot;
    if (
      snapshot.version !== 2 ||
      snapshot.workspaceId !== workspaceId ||
      !snapshot.layout ||
      typeof snapshot.layout !== "object" ||
      Array.isArray(snapshot.layout) ||
      (snapshot.activeDocumentId !== undefined && typeof snapshot.activeDocumentId !== "string")
    )
      throw new TypeError("Incompatible Worksplit snapshot; explicitly reset it");
    layout = structuredClone(snapshot.layout);
    activeDocumentId = snapshot.activeDocumentId;
  } else {
    layout = structuredClone(options.initial?.layout ?? defaultWorkbenchLayout());
  }
  validateLayout(layout, !!serialized);
  layout.global = { ...defaultWorkbenchLayout().global, ...layout.global };
  return { layout, activeDocumentId };
}

export function validateLayout(layout: IJsonModel, serialized: boolean): void {
  const popouts = (layout as IJsonModel & { popouts?: Record<string, unknown> }).popouts;
  if (
    (layout.subLayouts && Object.keys(layout.subLayouts).length) ||
    (popouts && Object.keys(popouts).length)
  )
    throw new TypeError("Popouts and sublayouts are unsupported");
  if (layout.global?.tabEnableFloat || layout.global?.tabEnablePopout)
    throw new TypeError("Floating and popout content is unsupported");
  const ids = new Set<string>();
  const visit = (value: unknown, allowed: string[], path: string): void => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new TypeError(`Invalid native node at ${path}`);
    const node = value as Record<string, unknown>;
    let type = node.type;
    if (type === undefined && !serialized)
      type = allowed.includes("tab") ? "tab" : allowed.length === 1 ? allowed[0] : undefined;
    if (typeof type !== "string" || !allowed.includes(type))
      throw new TypeError(`Unsupported native node at ${path}`);
    if (type === "border") {
      if (!["left", "right", "top", "bottom"].includes(node.location as string))
        throw new TypeError(`Invalid native border at ${path}`);
      const borderId = `border_${String(node.location)}`;
      if (node.id !== undefined && node.id !== borderId)
        throw new TypeError(`Border id must match its native location at ${path}`);
      if (ids.has(borderId)) throw new TypeError(`Duplicate native border id at ${path}`);
      ids.add(borderId);
    }
    if (node.id !== undefined && type !== "border") {
      if (typeof node.id !== "string" || !node.id || ids.has(node.id))
        throw new TypeError(`Invalid or duplicate native id at ${path}`);
      ids.add(node.id);
    }
    if (type === "tab") {
      if (
        typeof node.component !== "string" ||
        node.children !== undefined ||
        node.subLayoutId !== undefined ||
        node.enableFloat ||
        node.enablePopout
      )
        throw new TypeError(`Invalid or unsupported native content at ${path}`);
      const metadata = tabMetadata(node as unknown as IJsonTabNode);
      if (node.component === DOCUMENT_COMPONENT) {
        if (typeof metadata.href !== "string")
          throw new TypeError(`Document requires config.worksplit.href at ${path}`);
        checkHref(metadata.href);
      } else if (metadata.href !== undefined || metadata.preview !== undefined) {
        throw new TypeError(`Tools cannot contain document recovery metadata at ${path}`);
      }
      return;
    }
    if (serialized && !Array.isArray(node.children))
      throw new TypeError(`Snapshot requires children at ${path}`);
    if (node.children === undefined) return;
    if (!Array.isArray(node.children)) throw new TypeError(`Invalid children at ${path}`);
    node.children.forEach((child, index) =>
      visit(
        child,
        type === "row" ? ["row", "tabset"] : type === "tabgroup" ? ["tab"] : ["tab", "tabgroup"],
        `${path}.children[${index}]`,
      ),
    );
  };
  if (layout.borders !== undefined && !Array.isArray(layout.borders))
    throw new TypeError("Invalid native borders");
  layout.borders?.forEach((border, index) => visit(border, ["border"], `borders[${index}]`));
  visit(layout.layout, ["row"], "layout");
}
