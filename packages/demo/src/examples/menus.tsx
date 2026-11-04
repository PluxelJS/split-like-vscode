import type { AnyRouter } from "@tanstack/react-router";
import type { MenuOptions, MenuRendererProps } from "@worksplit/react";
import { PopupMenu } from "flexlayout-react";
import { createContext, useContext, useEffect, type ReactNode } from "react";

const MenuTheme = createContext("#315c93");
export function ExampleMenuProvider({ children }: { children: ReactNode }) {
  return <MenuTheme.Provider value="#426b42">{children}</MenuTheme.Provider>;
}

/** PopupMenu's unmount cleanup restores focus. The parent passive effect then acknowledges it.
 * An animated popup would call onClosed from its actual exit-complete callback instead. */
function ExampleMenu({ open, onClosed, ...props }: MenuRendererProps) {
  const accent = useContext(MenuTheme);
  useEffect(() => {
    if (!open) onClosed();
  }, [open, onClosed]);
  return open ? (
    <PopupMenu
      {...props}
      renderItem={(item, _index, api) => (
        <div
          key={item.key}
          role="menuitem"
          tabIndex={-1}
          aria-disabled={item.disabled || undefined}
          data-example-menu-theme={accent}
          onClick={() => {
            if (!item.disabled) api.select();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            if (!item.disabled) api.select();
          }}
          style={{
            padding: "6px 12px",
            borderLeft: `3px solid ${accent}`,
            opacity: item.disabled ? 0.45 : 1,
          }}
        >
          {item.content ?? (
            <>
              {item.icon}
              {item.label}
            </>
          )}
        </div>
      )}
    />
  ) : null;
}

export function createExampleMenus<TRouter extends AnyRouter>(
  inspect: (contentId: string) => void,
): MenuOptions<TRouter> {
  return {
    render: (props) => <ExampleMenu {...props} />,
    transform: ({ node, items, instance }) =>
      instance.getContent(node.getId())
        ? [
            ...items,
            { type: "divider", key: "host-inspection-divider" },
            {
              key: "host-inspection",
              label: "Inspect content",
              onSelect: () => inspect(node.getId()),
            },
          ]
        : items,
  };
}
