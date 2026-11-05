import { RouterProvider, type AnyRouter } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { Layout, type ILayoutApi, type ILayoutProps, type TabNode } from "flexlayout-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import type { ControllerOwner } from "./content-record";
import { integrationState } from "./internal";
import { useWorkbenchMenus } from "./menus";
import type {
  ContentController,
  ContentHandle,
  WorkbenchInstance,
  WorkbenchProps,
  WorkbenchState,
} from "./types";

const ContentContext = createContext<{
  content: ContentHandle;
  instance: object;
} | null>(null);
const defaultEmpty = <p>Open a document to begin.</p>;
const rejectExternalDrag = () => undefined;

export function useWorkbenchState<TRouter extends AnyRouter, T>(
  instance: WorkbenchInstance<TRouter>,
  selector: (state: WorkbenchState) => T,
): T {
  return useStore(integrationState(instance).store, selector);
}

/** Borrow the current content lifetime without declaring a controller owner. */
export function useContent(): ContentHandle {
  const context = useContext(ContentContext);
  if (!context) throw new Error("Content must render inside a Worksplit document or tool");
  return context.content;
}

/** Declare the sole controller for this content. Only committed renders update callbacks. */
export function useContentController(controller: ContentController): void {
  const context = useContext(ContentContext);
  if (!context) throw new Error("Content must render inside a Worksplit document or tool");
  const { content, instance } = context;
  const internal = integrationState(instance);
  const owner = useMemo<ControllerOwner>(() => ({ controller: { leave: null } }), []);
  useLayoutEffect(() => internal.updateController(content, owner, controller));
  // Suspense hides layout effects, but does not relinquish the passive lifetime owner.
  useEffect(() => internal.registerController(content, owner), [content, internal, owner]);
}

const Content = memo(function Content({ node, instance }: { node: TabNode; instance: object }) {
  const internal = integrationState(instance);
  const id = node.getId();
  const lifecycle = useStore(internal.store, (state) => state.lifecycle);
  const record = internal.getRecord(id);
  const ready = useStore(internal.store, () => {
    const current = internal.getRecord(id);
    return current?.role === "document" ? current.ready : current !== undefined;
  });
  const content = useStore(internal.store, () => internal.getRecord(id)?.handle);
  const context = useMemo(() => (content ? { content, instance } : null), [content, instance]);
  const bindRoot = (root: HTMLDivElement | null) => {
    if (content) internal.bindContentRoot(content, root);
  };
  useEffect(() => {
    if (lifecycle === "running" && content && record?.role === "document") {
      void internal.loadDocument(content).catch(internal.report);
    }
  }, [content, internal, lifecycle, record]);
  if (!record || !context || record.node !== node || lifecycle === "disposed") return null;
  return (
    <ContentContext.Provider value={context}>
      <div
        ref={bindRoot}
        className="worksplit-content"
        role="presentation"
        tabIndex={-1}
        data-worksplit-content={id}
        data-worksplit-role={record.role}
        onKeyDown={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return;
          if (event.defaultPrevented) return;
          // Native content portals and tab panels are React siblings. Forward only the panel's
          // configured focus toggle to its existing native keyboard handler.
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
        {lifecycle !== "running" || !ready ? (
          <p role="status">Loading document…</p>
        ) : record.role === "tool" ? (
          record.definition.render({ content: record.handle, node })
        ) : record.runtime ? (
          <RouterProvider router={record.runtime.router} />
        ) : (
          <p role="status">Loading document…</p>
        )}
      </div>
    </ContentContext.Provider>
  );
});

export function Workbench<TRouter extends AnyRouter>({
  instance,
  empty = defaultEmpty,
  native,
  layoutRef,
  menus,
  className,
  onKeyDown,
  ...rootProps
}: WorkbenchProps<TRouter>) {
  if (menus !== false && native?.onContextMenu) {
    throw new Error("Set menus={false} when supplying native.onContextMenu");
  }
  const internal = integrationState(instance);
  const root = useRef<HTMLDivElement>(null);
  const nativeLayout = useRef<ILayoutApi>(null);
  useImperativeHandle(layoutRef, () => nativeLayout.current!);
  useEffect(() => {
    if (root.current) return internal.bindLayout(() => nativeLayout.current, root.current);
  }, [internal]);
  const menu = useWorkbenchMenus(instance, menus, root);
  const factory = useMemo(
    () => (node: TabNode) => <Content node={node} instance={instance} />,
    [instance],
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
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const doc = element.ownerDocument;
    const win = doc.defaultView!;
    let active = true;
    const observe = (target: EventTarget | null, intent = false) => {
      if (!(target instanceof win.Element) || !element.contains(target)) {
        internal.focus(null, "outside");
        return;
      }
      const content = target.closest<HTMLElement>("[data-worksplit-content]");
      if (content) internal.focus(content.dataset.worksplitContent!, "content", intent);
      else internal.focus(null, "chrome");
    };
    const focus = (event: Event) => observe(event.target);
    // Capture intent before a host or child handler starts work from the same event.
    // The actual DOM target keeps portal keys from claiming their React owner's content.
    const intent = (event: Event) => observe(event.target, true);
    const out = () =>
      queueMicrotask(() => {
        if (!active || element.contains(doc.activeElement)) return;
        // Native panel visibility can blur the old editor to body before the
        // activated content receives focus. That is not a new outside owner;
        // outside focus/input and window blur have their own cancellation events.
        const target = doc.activeElement;
        const passive = !target || target === doc.body || target === doc.documentElement;
        internal.focus(null, passive ? "blur" : "outside");
      });
    const focused = () => {
      internal.setWindowFocus(true);
      observe(doc.activeElement);
    };
    const blurred = () => internal.setWindowFocus(false);
    doc.addEventListener("focusin", focus);
    doc.addEventListener("pointerdown", intent, true);
    doc.addEventListener("keydown", intent, true);
    doc.addEventListener("focusout", out);
    win.addEventListener("focus", focused);
    win.addEventListener("blur", blurred);
    return () => {
      active = false;
      doc.removeEventListener("focusin", focus);
      doc.removeEventListener("pointerdown", intent, true);
      doc.removeEventListener("keydown", intent, true);
      doc.removeEventListener("focusout", out);
      win.removeEventListener("focus", focused);
      win.removeEventListener("blur", blurred);
    };
  }, [internal]);
  return (
    <div
      role="presentation"
      {...rootProps}
      ref={root}
      className={`worksplit-workbench${className ? ` ${className}` : ""}`}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        menu.onKeyDown(event);
      }}
    >
      <div className="worksplit-native-layout">
        <Layout
          {...native}
          ref={nativeLayout}
          model={internal.model}
          factory={factory}
          onAction={internal.modelAction}
          onModelChange={observeModel}
          {...(menus === false ? {} : { onContextMenu: menu.onContextMenu })}
          onExternalDrag={rejectExternalDrag}
          supportsPopout={false}
          invalidateTabContentOnParentRender={native?.invalidateTabContentOnParentRender ?? false}
          onTabSetPlaceHolder={native?.onTabSetPlaceHolder ?? placeholder}
        />
      </div>
      {menu.popup}
    </div>
  );
}
