import { useHotkeys } from "@tanstack/react-hotkeys";
import { RouterProvider, type AnyRouter } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { Layout, type ILayoutProps, type TabNode } from "flexlayout-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  integrationState,
  type WorkbenchContentLifecycle,
  type WorkbenchInstance,
  type WorkbenchState,
} from "./integration";
import { connectResponsiveLayout } from "./responsive-layout";

type RenderInstance = Pick<
  WorkbenchInstance<AnyRouter>,
  "activate" | "getDocument" | "executeCommand" | "getEditingContext"
>;
const ContentContext = createContext<{ id: string; instance: RenderInstance } | null>(null);
const defaultEmpty = <p>Open a document to begin.</p>;
const rejectExternalDrag = () => undefined;

export interface WorkbenchProps {
  workbench: RenderInstance;
  navigation?: ReactNode;
  empty?: ReactNode;
  /** Native Layout props. Callbacks borrow trusted nodes/Model; submit mutations through dispatch. */
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

export function useWorkbenchState<T>(
  workbench: RenderInstance,
  selector: (state: WorkbenchState) => T,
): T {
  return useStore(integrationState(workbench).store, selector);
}

/** Content lifetime registration is independent of route matching or docking position. */
export function useWorkbenchContent() {
  const context = useContext(ContentContext);
  if (!context) throw new Error("Content must render inside a Worksplit document or tool");
  return useMemo(
    () => ({
      id: context.id,
      register: (lifecycle: WorkbenchContentLifecycle) =>
        integrationState(context.instance).register(context.id, lifecycle),
      executeCommand: (id: string) =>
        context.instance.executeCommand(id, { contentId: context.id }),
    }),
    [context],
  );
}
export function useWorkbenchContentLifecycle(lifecycle: WorkbenchContentLifecycle) {
  const content = useWorkbenchContent();
  useEffect(() => content.register(lifecycle), [content, lifecycle]);
}

const Content = memo(function Content({ id, instance }: { id: string; instance: RenderInstance }) {
  const internal = integrationState(instance);
  const router = useStore(internal.store, () => internal.documents.get(id)?.router);
  const tool = internal.tools.get(id);
  const context = useMemo(() => ({ id, instance }), [id, instance]);
  useEffect(() => {
    if (!tool) void internal.loadDocument(id);
  }, [id, internal, tool]);
  return (
    <ContentContext.Provider value={context}>
      <div
        className="worksplit-content"
        data-worksplit-content={id}
        data-worksplit-role={tool ? "tool" : "document"}
      >
        {tool ? (
          tool.render({ id })
        ) : router ? (
          <RouterProvider router={router} />
        ) : (
          <p role="status">Loading document…</p>
        )}
      </div>
    </ContentContext.Provider>
  );
});

function DocumentSwitcher({ workbench }: { workbench: RenderInstance }) {
  const internal = integrationState(workbench);
  useStore(internal.store, (state) => `${state.revision}:${state.activeDocumentId}`);
  return (
    <select
      className="worksplit-document-switcher"
      aria-label="Open document"
      value={internal.store.get().activeDocumentId ?? ""}
      onChange={(event) => workbench.activate(event.target.value)}
    >
      <option value="" disabled>
        Open document
      </option>
      {[...internal.documents.keys()].map((id) => (
        <option key={id} value={id}>
          {workbench.getDocument(id)?.href}
        </option>
      ))}
    </select>
  );
}

export function Workbench({ workbench, navigation, empty = defaultEmpty, native }: WorkbenchProps) {
  const internal = integrationState(workbench);
  const root = useRef<HTMLDivElement>(null);
  const factory = useMemo(
    () => (node: TabNode) => <Content id={node.getId()} instance={workbench} />,
    [workbench],
  );
  const placeholder = useMemo(() => () => <div className="worksplit-empty">{empty}</div>, [empty]);
  const [narrow, setNarrow] = useState(false);
  const modelObserver = native?.onModelChange;
  const observeModel = useMemo<NonNullable<ILayoutProps["onModelChange"]>>(
    () => (model, action) => {
      try {
        modelObserver?.(model, action);
      } catch (error) {
        internal.report(error);
      }
    },
    [internal, modelObserver],
  );
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    return connectResponsiveLayout(internal, element, setNarrow);
  }, [internal]);
  useHotkeys(
    internal.commands.flatMap((command) =>
      command.hotkey
        ? [
            {
              hotkey: command.hotkey,
              callback: () => {
                void workbench.executeCommand(command.id).catch(internal.report);
              },
              options: { ignoreInputs: command.ignoreInputs ?? true, stopPropagation: false },
            },
          ]
        : [],
    ),
    { target: root },
  );
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const doc = element.ownerDocument;
    const win = doc.defaultView!;
    const observe = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !element.contains(target)) return;
      const content = target.closest<HTMLElement>("[data-worksplit-content]");
      if (content)
        internal.focus(
          content.dataset.worksplitContent!,
          content.dataset.worksplitRole === "tool" ? "tool" : "document",
        );
      else internal.focus(null, "shell");
    };
    const focus = (event: Event) => observe(event.target);
    const out = () =>
      queueMicrotask(() => {
        if (!element.contains(doc.activeElement)) internal.focus(null, null);
      });
    const focused = () => {
      internal.setWindowFocus(true);
      observe(doc.activeElement);
    };
    const blurred = () => internal.setWindowFocus(false);
    doc.addEventListener("focusin", focus);
    doc.addEventListener("pointerdown", focus, true);
    doc.addEventListener("focusout", out);
    win.addEventListener("focus", focused);
    win.addEventListener("blur", blurred);
    return () => {
      doc.removeEventListener("focusin", focus);
      doc.removeEventListener("pointerdown", focus, true);
      doc.removeEventListener("focusout", out);
      win.removeEventListener("focus", focused);
      win.removeEventListener("blur", blurred);
    };
  }, [internal]);
  return (
    <div
      ref={root}
      className={`worksplit-workbench${navigation ? " worksplit-with-navigation" : ""}`}
    >
      {navigation && (
        <nav className="worksplit-navigation" aria-label="Workspace">
          {navigation}
        </nav>
      )}
      <div className="worksplit-layout">
        {narrow && <DocumentSwitcher workbench={workbench} />}
        <div className="worksplit-native-layout">
          <Layout
            {...native}
            model={internal.model}
            factory={factory}
            onAction={internal.modelAction}
            onModelChange={observeModel}
            onExternalDrag={rejectExternalDrag}
            supportsPopout={false}
            invalidateTabContentOnParentRender={native?.invalidateTabContentOnParentRender ?? false}
            onTabSetPlaceHolder={native?.onTabSetPlaceHolder ?? placeholder}
          />
        </div>
      </div>
    </div>
  );
}
