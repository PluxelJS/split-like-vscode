import {
  createWorkbench,
  useContent,
  useContentController,
  useWorkbenchState,
  Workbench,
  type WorkbenchInstance,
} from "@worksplit/react";
import { Actions, DockLocation, type IJsonModel } from "flexlayout-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { createExampleMenus, ExampleMenuProvider } from "./menus";
import { createReadOnlyRouter } from "./read-only";

const layout: IJsonModel = {
  global: {
    tabEnableFloat: false,
    tabEnablePopout: false,
    tabSetEnableTabGroups: true,
    tabEnablePin: true,
  },
  borders: [
    {
      type: "border",
      location: "bottom",
      size: 180,
      selected: 0,
      children: [{ type: "tab", id: "inspector", component: "inspector", name: "Inspector" }],
    },
  ],
  layout: { type: "row", children: [{ type: "tabset", id: "documents", children: [] }] },
};

export function createToolsWorkbench(): WorkbenchInstance<ReturnType<typeof createReadOnlyRouter>> {
  const instance: WorkbenchInstance<ReturnType<typeof createReadOnlyRouter>> = createWorkbench({
    createRouter: createReadOnlyRouter,
    initial: { layout },
    home: { mode: "empty", href: "/" },
    tools: { inspector: { title: "Inspector", render: () => <Inspector instance={instance} /> } },
  });
  return instance;
}
export type ToolsInstance = ReturnType<typeof createToolsWorkbench>;

function Inspector({ instance }: { instance: ToolsInstance }) {
  const content = useContent();
  const input = useRef<HTMLInputElement>(null);
  const source = useWorkbenchState(instance, (state) => state.activeDocumentId);
  useContentController({ title: "Inspector", leave: null, focus: () => input.current?.focus() });
  return (
    <section style={{ padding: 12, display: "grid", gap: 8 }} aria-label="Inspector tool">
      <label>
        Filter <input ref={input} placeholder="Local tool state" />
      </label>
      <output>Selected document: {source ?? "none"}</output>
      <button
        type="button"
        onClick={() => {
          void instance.open(
            { to: "/read/$name", params: { name: "Balance" } },
            { source: content },
          );
        }}
      >
        Open balance from this tool
      </button>
    </section>
  );
}

function InspectionDialog({ id, close }: { id: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-label="Content inspection"
    >
      <p>Content lifetime: {id}</p>
      <button type="button" autoFocus onClick={close}>
        Close inspection
      </button>
    </dialog>
  );
}

export function ToolsExample({ instance }: { instance: ToolsInstance }) {
  const [inspected, inspect] = useState<string | null>(null);
  const menus = useMemo(
    () => createExampleMenus<ReturnType<typeof createReadOnlyRouter>>(inspect),
    [],
  );
  return (
    <ExampleMenuProvider>
      <section style={{ height: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
        <nav aria-label="Tool example" style={{ padding: 12, display: "flex", gap: 12 }}>
          <button
            type="button"
            onClick={() => {
              void instance.open({ to: "/read/$name", params: { name: "Balance" } });
            }}
          >
            Open report
          </button>
          <button
            type="button"
            onClick={() => {
              if (instance.getContent("inspector")) void instance.activate("inspector");
              else
                void instance.dispatch(
                  Actions.addTab(
                    { type: "tab", id: "inspector", component: "inspector", name: "Inspector" },
                    "border_bottom",
                    DockLocation.CENTER,
                    -1,
                  ),
                );
            }}
          >
            Show inspector
          </button>
          <span>Right-click a tab, or focus it and press Shift+F10.</span>
        </nav>
        <Workbench instance={instance} menus={menus} />
        {inspected && <InspectionDialog id={inspected} close={() => inspect(null)} />}
      </section>
    </ExampleMenuProvider>
  );
}
