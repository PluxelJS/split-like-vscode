import { useHotkeys } from "@tanstack/react-hotkeys";
import { RouterProvider, type AnyRouter } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { Layout, type ILayoutApi, type ILayoutProps, type TabNode } from "flexlayout-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

import {
  integrationState,
  type WorkbenchContentLifecycle,
  type WorkbenchInstance,
  type WorkbenchState,
} from "./integration";

interface PendingLifecycle {
  lifecycle: WorkbenchContentLifecycle;
  unregister: () => void;
}
function createContentContext(id: string, instance: WorkbenchInstance<AnyRouter>) {
  let pending: PendingLifecycle | undefined;
  return {
    id,
    instance,
    takePendingLifecycle: () => {
      const previous = pending;
      pending = undefined;
      return previous;
    },
    deferLifecycle: (teardown: PendingLifecycle) => {
      pending = teardown;
      queueMicrotask(() => {
        if (pending !== teardown) return;
        pending = undefined;
        teardown.unregister();
      });
    },
  };
}
const ContentContext = createContext<ReturnType<typeof createContentContext> | null>(null);
const defaultEmpty = <p>Open a document to begin.</p>;
const rejectExternalDrag = () => undefined;

export interface WorkbenchProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "dangerouslySetInnerHTML"
> {
  /** A real instance returned by createWorkbench or constructed with WorkbenchInstance. */
  workbench: WorkbenchInstance<AnyRouter>;
  navigation?: ReactNode;
  empty?: ReactNode;
  /** Native Layout ref. Mutations are intercepted; use dispatch for insertion/close receipts. */
  layoutRef?: Ref<ILayoutApi>;
  /** Native Layout props. Borrow nodes/Model for presentation/defaults/observers; dispatch mutations. */
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
  workbench: WorkbenchInstance<AnyRouter>,
  selector: (state: WorkbenchState) => T,
): T {
  return useStore(integrationState(workbench).store, selector);
}

/** Content lifetime registration is independent of route matching or docking position. */
export function useWorkbenchContent() {
  const context = useContext(ContentContext);
  if (!context) throw new Error("Content must render inside a Worksplit document or tool");
  const internal = integrationState(context.instance);
  return useMemo(() => {
    const node = internal.model.getNodeById(context.id);
    return {
      id: context.id,
      register: (lifecycle: WorkbenchContentLifecycle) =>
        internal.register(context.id, lifecycle, node),
      executeCommand: (id: string) =>
        context.instance.executeCommand(id, { contentId: context.id }),
    };
  }, [context, internal]);
}
export function useWorkbenchContentLifecycle(lifecycle: WorkbenchContentLifecycle) {
  const content = useWorkbenchContent();
  const context = useContext(ContentContext)!;
  useEffect(() => {
    const pending = context.takePendingLifecycle();
    // Replaying the same effect retains its live resources. A genuinely new owner first
    // releases the old registration; a second still-mounted owner remains an error.
    const reconnect = pending?.lifecycle === lifecycle;
    if (pending && !reconnect) pending.unregister();
    const unregister = reconnect ? pending.unregister : content.register(lifecycle);
    return () => {
      context.deferLifecycle({ lifecycle, unregister });
    };
  }, [content, context, lifecycle]);
}

const Content = memo(function Content({
  id,
  instance,
}: {
  id: string;
  instance: WorkbenchInstance<AnyRouter>;
}) {
  const internal = integrationState(instance);
  const router = useStore(internal.store, () => internal.documents.get(id)?.router);
  const tool = internal.tools.get(id);
  const context = useMemo(() => createContentContext(id, instance), [id, instance]);
  useEffect(() => {
    if (!tool) void internal.loadDocument(id);
  }, [id, internal, tool]);
  return (
    <ContentContext.Provider value={context}>
      <div
        className="worksplit-content"
        role="presentation"
        data-worksplit-content={id}
        data-worksplit-role={tool ? "tool" : "document"}
        onKeyDown={(event) => {
          if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
          // Native content portals and Tab panels are siblings in the React tree.
          // Hand only the panel's configured focus toggle to its existing native handler.
          const panel = event.currentTarget.closest<HTMLElement>('[role="tabpanel"]');
          const parts = panel?.getAttribute("aria-keyshortcuts")?.split("+");
          const key = parts?.pop();
          const win = event.currentTarget.ownerDocument.defaultView;
          if (!panel || !parts || !key || !win) return;
          const has = (modifier: string) => parts.some((part) => part.toLowerCase() === modifier);
          if (
            event.key.toLowerCase() !== key.toLowerCase() ||
            event.ctrlKey !== has("control") ||
            event.shiftKey !== has("shift") ||
            event.altKey !== has("alt") ||
            event.metaKey !== has("meta")
          )
            return;
          const accepted = !panel.dispatchEvent(
            new win.KeyboardEvent("keydown", {
              key: event.key,
              code: event.code,
              location: event.location,
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              altKey: event.altKey,
              metaKey: event.metaKey,
              repeat: event.repeat,
              bubbles: true,
              cancelable: true,
            }),
          );
          if (accepted) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
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

export function Workbench({
  workbench,
  navigation,
  empty = defaultEmpty,
  native,
  layoutRef,
  className,
  ...rootProps
}: WorkbenchProps) {
  const internal = integrationState(workbench);
  const root = useRef<HTMLDivElement>(null);
  const factory = useMemo(
    () => (node: TabNode) => <Content id={node.getId()} instance={workbench} />,
    [workbench],
  );
  const placeholder = useMemo(() => () => <div className="worksplit-empty">{empty}</div>, [empty]);
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
      if (!(target instanceof Element) || !element.contains(target)) {
        internal.focus(null, null);
        return;
      }
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
      {...rootProps}
      ref={root}
      className={`worksplit-workbench${navigation ? " worksplit-with-navigation" : ""}${className ? ` ${className}` : ""}`}
    >
      {navigation && (
        <nav className="worksplit-navigation" aria-label="Workspace">
          {navigation}
        </nav>
      )}
      <div className="worksplit-native-layout">
        <Layout
          {...native}
          ref={layoutRef}
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
  );
}
