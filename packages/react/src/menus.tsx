import type { AnyRouter } from "@tanstack/react-router";
import {
  Actions,
  BorderNode,
  ContextMenuBuilder,
  DockLocation,
  getNodeContextMenuItem,
  PopupMenu,
  TabGroupNode,
  TabNode,
  TabSetNode,
  type Action,
  type ILayoutProps,
  type IPopupMenuItem,
  type PopupMenuEntry,
  type Node,
} from "flexlayout-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { integrationState } from "./internal";
import { tabContainer, tabsIn } from "./native-layout";
import type {
  CloseTarget,
  MenuOptions,
  MenuRendererProps,
  OperationResult,
  WorkbenchInstance,
} from "./types";

type MenuNode = TabNode | TabSetNode | BorderNode | TabGroupNode;
type MenuTask = () => void;
interface MenuSession {
  node: MenuNode;
  parent: Node | undefined;
  anchor: HTMLElement;
  open: boolean;
  valid: boolean;
  executing: boolean;
  settled: boolean;
  pending: MenuTask | undefined;
  afterClosed: MenuTask | undefined;
  props: Omit<MenuRendererProps, "open">;
  render: MenuOptions["render"];
}

/** PopupMenu restores focus in its passive unmount cleanup. This parent's passive effect
 * acknowledges that cleanup, without guessing frames or transition durations. */
function DefaultMenu({ open, onClosed, ...props }: MenuRendererProps) {
  useEffect(() => {
    if (!open) onClosed();
  }, [open, onClosed]);
  return open ? <PopupMenu {...props} /> : null;
}

export function useWorkbenchMenus<TRouter extends AnyRouter>(
  instance: WorkbenchInstance<TRouter>,
  options: false | MenuOptions<TRouter> | undefined,
  root: RefObject<HTMLDivElement | null>,
) {
  const internal = integrationState(instance);
  const session = useRef<MenuSession | null>(null);
  const [display, setDisplay] = useState<{
    props: MenuRendererProps;
    render: MenuOptions["render"];
  } | null>(null);
  const isCurrent = (menu: MenuSession) =>
    session.current === menu &&
    menu.valid &&
    internal.store.state.lifecycle === "running" &&
    instance.model.getNodeById(menu.node.getId()) === menu.node &&
    menu.node.getParent() === menu.parent &&
    menu.anchor.isConnected;
  const close = useCallback((menu: MenuSession) => {
    if (session.current !== menu || menu.settled || !menu.open) return;
    menu.open = false;
    setDisplay({ props: { ...menu.props, open: false }, render: menu.render });
  }, []);
  const run = (menu: MenuSession, task: MenuTask) => {
    if (!isCurrent(menu)) return;
    try {
      task();
    } catch (error) {
      internal.report(error);
    }
  };
  const queue = (menu: MenuSession, task: MenuTask) => {
    if (!isCurrent(menu)) return;
    if (menu.executing) run(menu, task);
    else if (menu.open && !menu.settled) {
      menu.pending = task;
      close(menu);
    }
  };
  const report = (operation: Promise<OperationResult<unknown>>) => {
    void operation.then(internal.reportResult, internal.report);
  };
  const onClosed = (menu: MenuSession) => {
    if (session.current !== menu || menu.settled || menu.open) return;
    menu.settled = true;
    menu.executing = true;
    const task = menu.pending;
    menu.pending = undefined;
    if (task) run(menu, task);
    menu.executing = false;
    if (session.current !== menu) return;
    session.current = null;
    setDisplay(null);
    if (!menu.valid) internal.returnFocus();
    menu.afterClosed?.();
  };
  const cancel = useCallback(
    (menu: MenuSession) => {
      menu.valid = false;
      menu.pending = undefined;
      menu.afterClosed = undefined;
      close(menu);
    },
    [close],
  );

  const openMenu: NonNullable<ILayoutProps["onContextMenu"]> = (node, event) => {
    if (options === false || internal.store.state.lifecycle !== "running") return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = event.currentTarget;
    const point = { x: event.clientX, y: event.clientY };
    const show = () => {
      if (!anchor.isConnected || instance.model.getNodeById(node.getId()) !== node) return;
      const menuContainer = node.getLayoutRef() ?? root.current;
      const menu: MenuSession = {
        node,
        parent: node.getParent(),
        anchor,
        open: true,
        valid: true,
        executing: false,
        settled: false,
        pending: undefined,
        afterClosed: undefined,
        render: options?.render,
        props: {
          anchor: point,
          items: [],
          ...(menuContainer ? { container: menuContainer } : {}),
          returnFocusTo: anchor,
          onClose: () => close(menu),
          onClosed: () => onClosed(menu),
        },
      };
      session.current = menu;
      const references = new Map<string, Node>();
      for (let current: Node | undefined = node; current; current = current.getParent()) {
        references.set(current.getId(), current);
      }
      for (const child of tabContainer(node)?.getChildren() ?? [])
        references.set(child.getId(), child);
      const dispatch = (action: Action) =>
        // Embedded native editors (for example group colors) do not close the menu.
        // Entry callbacks already wait for onClosed through protect/queue below.
        run(menu, () => {
          const ids = [
            action.data.node,
            action.data.fromNode,
            action.data.toNode,
            action.data.tabNode,
            action.data.tabsetNode,
          ].filter((id): id is string => typeof id === "string");
          if (
            ids.some(
              (id) => !references.has(id) || instance.model.getNodeById(id) !== references.get(id),
            )
          )
            return;
          report(instance.dispatch(action));
        });
      const builder = new ContextMenuBuilder(node, {
        includeDisabled: true,
        onAction: dispatch,
        closeMenu: () => close(menu),
      });
      const addClose = (
        key: "close" | "closeOthers" | "closeRight" | "closeGroup",
        target: CloseTarget,
      ) => {
        const item =
          key === "closeGroup"
            ? { key, label: options?.labels?.closeGroup ?? "Close Group" }
            : getNodeContextMenuItem(node, key, { includeDisabled: true });
        if (!item) return;
        const targets = internal.closeTargets(target);
        builder.addCustom({
          ...item,
          disabled: !targets?.length,
          onSelect: () => report(instance.close(target)),
        });
      };
      if (node instanceof TabNode) {
        const document = instance.getDocument(node.getId());
        if (document) {
          builder.addCustom({
            key: "keepOpen",
            label: options?.labels?.keepOpen ?? "Keep Open",
            disabled: !document.preview,
            onSelect: () => report(instance.keepOpen(node.getId())),
          });
          builder.addCustom({
            key: "duplicate",
            label: options?.labels?.duplicate ?? "Duplicate",
            onSelect: () => report(instance.duplicate(node.getId())),
          });
        }
        builder.add("pin").add("rename");
        const container = tabContainer(node);
        if (container instanceof TabSetNode && container.isEnableTabGroups()) {
          builder.add("addToNewGroup").add("addToGroup");
        }
        builder.add("removeFromGroup");
        builder.addDivider();
        if (container instanceof TabSetNode) {
          for (const [key, location, label] of [
            ["splitRight", DockLocation.RIGHT, "Split Right"],
            ["splitDown", DockLocation.BOTTOM, "Split Down"],
          ] as const) {
            const action = Actions.moveNode(node.getId(), container.getId(), location, -1);
            builder.addCustom({
              key,
              label: options?.labels?.[key] ?? label,
              disabled:
                tabsIn(container).length < 2 ||
                node.isPinned() ||
                !node.isEnableDrag() ||
                !instance.canDispatch(action),
              onSelect: () => dispatch(action),
            });
          }
          const maximize = new ContextMenuBuilder(container, {
            includeDisabled: true,
            onAction: dispatch,
          })
            .add("maximize")
            .build();
          for (const item of maximize) if (item.type !== "divider") builder.addCustom(item);
        }
        builder.addDivider();
        addClose("close", node.getId());
        addClose("closeOthers", { scope: "others", target: node });
        if (container instanceof TabSetNode)
          addClose("closeRight", { scope: "right", target: node });
      } else if (node instanceof TabGroupNode) {
        builder.addStandard().addDivider();
        addClose("closeGroup", {
          scope: "all",
          target: node,
        });
      } else if (node instanceof TabSetNode) {
        builder.add("maximize").addDivider();
        addClose("closeGroup", {
          scope: "all",
          target: node,
        });
      } else {
        builder.add("borderType").addDivider();
        addClose("closeGroup", {
          scope: "all",
          target: node,
        });
      }
      const protect = (entries: PopupMenuEntry[]) =>
        entries.map((entry): PopupMenuEntry => {
          if (entry.type === "divider" || !entry.onSelect) return entry;
          const select = entry.onSelect;
          return {
            ...entry,
            onSelect: (item: IPopupMenuItem) => {
              if (!entry.disabled)
                queue(menu, () => {
                  const result = select(item);
                  // Host callbacks may be async despite the native callback's void signature.
                  void Promise.resolve(result).catch(internal.report);
                });
            },
          };
        });
      try {
        const items = protect(
          builder.build().map((entry) => {
            if (entry.type === "divider" || !(tabContainer(node) instanceof BorderNode))
              return entry;
            // Native menus gate group controls on TabSet.enableTabGroups. A restored or moved
            // border group already exists and its native Actions remain supported.
            const action =
              node instanceof TabGroupNode && entry.key === "toggleOpen"
                ? Actions.updateNodeAttributes(node.getId(), { opened: !node.isOpened() })
                : node instanceof TabGroupNode && entry.key === "ungroup"
                  ? Actions.ungroup(node.getId())
                  : node instanceof TabNode && entry.key === "removeFromGroup"
                    ? Actions.removeTabFromGroup(node.getId())
                    : undefined;
            if (action) entry.disabled = !instance.canDispatch(action);
            return entry;
          }),
        );
        menu.props.items = protect(options?.transform?.({ node, items, instance }) ?? items);
      } catch (error) {
        session.current = null;
        internal.report(error);
      }
      setDisplay(
        session.current === menu
          ? { props: { ...menu.props, open: menu.open }, render: menu.render }
          : null,
      );
    };
    const previous = session.current;
    if (previous) {
      cancel(previous);
      previous.afterClosed = show;
    } else show();
  };

  useEffect(() => {
    const checkSession = () => {
      const menu = session.current;
      if (
        menu &&
        (options === false ||
          internal.store.get().lifecycle !== "running" ||
          internal.model.getNodeById(menu.node.getId()) !== menu.node ||
          menu.node.getParent() !== menu.parent ||
          !menu.anchor.isConnected)
      )
        cancel(menu);
    };
    checkSession();
    // Native resize/selection revisions do not need a React render. Only canceling
    // an invalid open popup updates this component's display state.
    const subscription = internal.store.subscribe(checkSession);
    return () => subscription.unsubscribe();
  }, [internal, options, cancel]);
  useEffect(() => {
    const model = internal.model;
    const element = root.current;
    const Observer = element?.ownerDocument.defaultView?.MutationObserver;
    if (!element || !Observer) return;
    const observer = new Observer(() => {
      const menu = session.current;
      if (menu && !menu.anchor.isConnected) cancel(menu);
    });
    observer.observe(element, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      const menu = session.current;
      if (menu && menu.node.getModel() === model) {
        menu.valid = false;
        menu.pending = undefined;
        menu.afterClosed = undefined;
        session.current = null;
        setDisplay(null);
      }
    };
  }, [internal, root, cancel]);
  return {
    onContextMenu: openMenu,
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if (
        options === false ||
        event.defaultPrevented ||
        !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
      )
        return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-worksplit-content], [role=menu]")) return;
      const win = target.ownerDocument.defaultView;
      if (!win) return;
      const rect = target.getBoundingClientRect();
      const handled = !target.dispatchEvent(
        new win.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    popup: display ? (
      display.render ? (
        display.render(display.props)
      ) : (
        <DefaultMenu {...display.props} />
      )
    ) : null,
  };
}
